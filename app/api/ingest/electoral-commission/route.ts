import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── ELECTORAL COMMISSION: DONATIONS & LOANS ─────────────────────────────
// Completes the influence circuit. Parliament's interests API tells us what an
// MP DECLARED (with a Companies House number for corporate donors); the EC
// register tells us what was actually GIVEN to parties and regulated donees.
// Cross-referencing the two is where discrepancies live.
//
// CADENCE MATTERS: this is not a firehose. Parties are published quarterly,
// regulated donees monthly. So this runs MONTHLY, not on a short cron — a
// heavy poller here would be both pointless and rude, and the EC explicitly
// reserves the right to throttle excessive use.
//
// Licence: Open Government Licence. Attribution required and recorded in the
// source registry: "Contains Electoral Commission Information © Electoral
// Commission and/or database right".
//
// ?probe=1 tries the candidate export endpoints and reports which respond,
// because the export URL isn't formally documented.

export const runtime = 'nodejs'
export const maxDuration = 60

const UA = 'Loro Intelligence (contact: hello@loro.media)'
const BASE = 'https://search.electoralcommission.org.uk'

// Rows written per run — keeps each invocation inside maxDuration. Re-running
// continues from where it left off because dedupe is on a composite key.
const PAGE_SIZE = 400

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Candidate export endpoints, tried in order. */
function candidates(fromDate: string): string[] {
  const q = [
    'start=0',
    'rows=1000',
    `query=`,
    `sort=AcceptedDate`,
    `order=desc`,
    `et=pp&et=ppm&et=tp&et=perpar&et=rd`,          // entity types
    `date=Accepted`,
    `from=${fromDate}`,
    `to=`,
    `prePoll=false`,
    `postPoll=true`,
    `register=gb&register=ni&register=none`,
    `optCols=Bequest&optCols=CompanyRegistrationNumber&optCols=Postcode`,
  ].join('&')

  return [
    `${BASE}/api/csv/Donations?${q}`,
    `${BASE}/Api/Csv/Donations?${q}`,
    `${BASE}/api/search/Donations?${q}`,
  ]
}

/** Minimal RFC4180-ish CSV parser — handles quoted fields with commas. */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); field = ''
      if (row.some(v => v.trim() !== '')) rows.push(row)
      row = []
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field || row.length) { row.push(field); if (row.some(v => v.trim())) rows.push(row) }

  if (rows.length < 2) return []
  const header = rows[0].map(h => h.trim())
  return rows.slice(1).map(r =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))
  )
}

function pick(o: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const hit = Object.keys(o).find(x => x.toLowerCase() === k.toLowerCase())
    if (hit && o[hit]) return o[hit]
  }
  return ''
}

/** EC dates arrive as dd/mm/yyyy. */
function toIso(d: string): string | null {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  const iso = d.match(/^(\d{4}-\d{2}-\d{2})/)
  return iso ? iso[1] : null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const probe = url.searchParams.get('probe') === '1'
  const months = Number(url.searchParams.get('months') ?? 3)

  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!probe && cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const from = new Date(Date.now() - months * 31 * 86400_000)
  const fromDate = `${String(from.getDate()).padStart(2, '0')}%2F${String(from.getMonth() + 1).padStart(2, '0')}%2F${from.getFullYear()}`

  if (probe) {
    const out: Array<Record<string, unknown>> = []
    for (const u of candidates(fromDate)) {
      try {
        const res = await fetch(u, {
          headers: { 'User-Agent': UA, Accept: 'text/csv,application/json,*/*' },
          signal: AbortSignal.timeout(25000),
        })
        const body = await res.text()
        out.push({
          url: u,
          status: res.status,
          content_type: res.headers.get('content-type'),
          length: body.length,
          head: body.slice(0, 300),
        })
        if (res.ok && body.length > 200) break
      } catch (e) {
        out.push({ url: u, error: e instanceof Error ? e.message.slice(0, 80) : 'failed' })
      }
    }
    return NextResponse.json({ probe: true, attempts: out })
  }

  const runId = await startRun('electoral_commission')
  const sb = getSupabase()
  const errors: string[] = []
  let found = 0
  let inserted = 0, dupes = 0, pending = 0

  try {
    let csv = ''
    let usedUrl = ''
    for (const u of candidates(fromDate)) {
      try {
        const res = await fetch(u, {
          headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' },
          signal: AbortSignal.timeout(30000),
        })
        if (!res.ok) continue
        const body = await res.text()
        if (body.length > 200 && body.includes(',')) { csv = body; usedUrl = u; break }
      } catch { /* try next candidate */ }
    }

    if (!csv) {
      await completeRun(runId, { found: 0, new: 0, duplicate: 0 }, ['no export endpoint responded'])
      return NextResponse.json({ ok: false, reason: 'No export endpoint responded — run ?probe=1' })
    }

    const allRecords = parseCsv(csv)

    // The API's from= filter does not appear to apply — a six-month request
    // returned 93,277 rows, i.e. the full register. Filter in code instead.
    const cutoff = new Date(Date.now() - months * 31 * 86400_000)
      .toISOString().slice(0, 10)
    const records = allRecords.filter(r => {
      const d = toIso(pick(r, 'AcceptedDate', 'Accepted date', 'ReceivedDate'))
      return d ? d >= cutoff : false
    })
    found = records.length

    const rows = records.map(r => {
      const donor = pick(r, 'DonorName', 'Donor name', 'Donor')
      const donee = pick(r, 'RegulatedEntityName', 'Regulated entity', 'Entity name')
      const value = pick(r, 'Value', 'Amount')
      const accepted = pick(r, 'AcceptedDate', 'Accepted date', 'ReceivedDate')
      const companyNo = pick(r, 'CompanyRegistrationNumber', 'Company registration number')
      const donorStatus = pick(r, 'DonorStatus', 'Donor status')
      const type = pick(r, 'DonationType', 'Donation type', 'Type')
      const ecRef = pick(r, 'ECRef', 'EC reference', 'Ref')
      const numericValue = Number(value.replace(/[£,]/g, '')) || null

      // Composite key: ECRef when present, otherwise donor+donee+date+value.
      // Without this, every record lacking an ECRef shared one fallback URL
      // and collided on dedupe.
      const dedupeKey = ecRef
        ? `ec:${ecRef}`
        : `ec:${donor}|${donee}|${accepted}|${value}`.replace(/\s+/g, ' ').slice(0, 300)

      return {
        source: 'electoral_commission',
        event_type: 'political_donation',
        external_id: dedupeKey,
        event_date: toIso(accepted) ?? new Date().toISOString().slice(0, 10),
        // Composite key: many records have no ECRef, and a shared fallback URL
        // made them all collide on dedupe.
        url: ecRef
          ? `${BASE}/Search/Donations?ecRef=${encodeURIComponent(ecRef)}`
          : `${BASE}/Search/Donations#${encodeURIComponent(
              [donee, donor, accepted, value].filter(Boolean).join('|')
            )}`,
        raw_content: {
          title: donor && donee
            ? `${donee} accepted ${value || 'a donation'} from ${donor}`
            : 'Political donation reported',
          description: [
            donor && donee ? `${donee} reported accepting ${value} from ${donor}.` : null,
            donorStatus ? `Donor status: ${donorStatus}.` : null,
            type ? `Type: ${type}.` : null,
            companyNo ? `Donor company number ${companyNo}.` : null,
            accepted ? `Accepted ${accepted}.` : null,
          ].filter(Boolean).join(' '),
          donor, donee, value_gbp: numericValue,
          donor_company_number: companyNo || null,
          donor_status: donorStatus || null,
          donation_type: type || null,
        },
        source_metadata: {
          ec_ref: ecRef || null,
          // Join key to Companies House AND to the Parliament interests feed,
          // which carries the same identifier.
          donor_company_number: companyNo || null,
          value_gbp: numericValue,
          donee, donor,
          attribution: 'Contains Electoral Commission Information © Electoral Commission and/or database right',
        },
        processed: false,
      }
    }).filter(r => r.raw_content.donor || r.raw_content.donee)

    if (rows.length) {
      const { data: seen } = await sb
        .from('loro_source_events')
        .select('external_id')
        .eq('source', 'electoral_commission')

      const seenSet = new Set(
        (seen ?? []).map(s => s.external_id as string).filter(Boolean)
      )
      const allFresh = rows.filter(r => !seenSet.has(r.external_id as string))
      dupes = rows.length - allFresh.length
      // Cap per run for the function time limit; the monthly job works
      // through any remainder on the next pass rather than re-reading the
      // same first N.
      const fresh = allFresh.slice(0, 500)

      if (fresh.length) {
        // The unique index on (source, external_id) is PARTIAL, so ON CONFLICT
        // can't target it. The collisions were anyway WITHIN the batch — the
        // CSV contains rows that produce identical composite keys — so dedupe
        // in memory first. Then write in chunks, because a plain bulk insert
        // fails the entire batch on one collision and a single duplicate was
        // discarding 1,000 otherwise-good records.
        const byKey = new Map<string, typeof fresh[number]>()
        for (const r of fresh) {
          const k = r.external_id as string
          if (k && !byKey.has(k)) byKey.set(k, r)
        }
        const unique = [...byKey.values()]

        for (let i = 0; i < unique.length; i += 100) {
          const chunk = unique.slice(i, i + 100)
          const { data: ins, error } = await sb
            .from('loro_source_events').insert(chunk).select('id')
          if (error) {
            if (errors.length < 3) errors.push(`chunk ${i}: ${error.message.slice(0, 90)}`)
            continue
          }
          inserted += ins?.length ?? 0
        }
      }
    }

    await completeRun(runId, { found, new: inserted, duplicate: dupes }, errors)
    return NextResponse.json({
      ok: true, endpoint: usedUrl, parsed: found,
      inserted, duplicates: dupes,
      in_window: found, remaining: Math.max(0, found - dupes - inserted),
      errors: errors.slice(0, 3),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await completeRun(runId, { found, new: inserted, duplicate: dupes }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
