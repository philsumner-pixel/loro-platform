import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── UK PARLIAMENT ───────────────────────────────────────────────────────
// Fills the Policy & Politics lane, which has had zero candidates because
// every source so far is financial.
//
// Two feeds, both free, no key, Open Parliament Licence:
//   interests-api.parliament.uk    Register of Members' Financial Interests
//   commonsvotes-api.parliament.uk Commons divisions (votes)
//
// Joined to Companies House and Electoral Commission later, this is the
// declared-interest -> company -> donation -> vote circuit that produces
// genuinely uncovered stories. Nobody does that join at scale.
//
// ?probe=1 returns the raw upstream shape without writing anything — added
// from the outset because guessing at response shapes cost several deploy
// cycles on the SEC firehose.

export const runtime = 'nodejs'
export const maxDuration = 60

const UA = 'Loro Intelligence (contact: hello@loro.media)'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(28000),
  })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

/** Shape-tolerant array extraction — these APIs wrap results differently. */
function asArray(payload: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    for (const k of keys) {
      const v = obj[k]
      if (Array.isArray(v)) return v as Array<Record<string, unknown>>
    }
    // Parliament APIs often wrap each item as { value: {...} }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) return v as Array<Record<string, unknown>>
    }
  }
  return []
}

function unwrap(item: Record<string, unknown>): Record<string, unknown> {
  const v = item.value
  return (v && typeof v === 'object' ? v : item) as Record<string, unknown>
}

function str(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const probe = url.searchParams.get('probe') === '1'

  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!probe && cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // OrderBy on this endpoint is slow enough to time out; take a smaller
  // page unsorted and dedupe on interest id instead.
  // Paginate: a single page of 20 gave almost nothing to cross-check against
  // the Electoral Commission's thousands of donation records. Skip is advanced
  // per page; OrderBy is still avoided because it times out on this endpoint.
  const INTEREST_PAGES = Number(url.searchParams.get('pages') ?? 4) // 10 pages exceeds the 60s function limit; the endpoint is slow
  const interestUrls = Array.from({ length: INTEREST_PAGES }, (_, i) =>
    `https://interests-api.parliament.uk/api/v1/Interests?Take=20&Skip=${i * 20}`)
  const INTERESTS = interestUrls[0]
  const DIVISIONS = 'https://commonsvotes-api.parliament.uk/data/divisions.json/search?queryParameters.take=25'

  if (probe) {
    const out: Record<string, unknown> = {}
    for (const [name, u] of [['interests', INTERESTS], ['divisions', DIVISIONS]] as const) {
      try {
        const raw = await getJson(u)
        const arr = asArray(raw, ['items', 'value', 'results', 'Divisions'])
        out[name] = {
          url: u,
          top_level_type: Array.isArray(raw) ? 'array' : typeof raw,
          top_level_keys: Array.isArray(raw) ? null : Object.keys(raw as object).slice(0, 12),
          extracted_count: arr.length,
          first_item_keys: arr[0] ? Object.keys(unwrap(arr[0])).slice(0, 25) : null,
          first_item: arr[0] ? unwrap(arr[0]) : null,
        }
      } catch (e) {
        out[name] = { url: u, error: e instanceof Error ? e.message : 'failed' }
      }
    }
    return NextResponse.json({ probe: true, ...out })
  }

  const runId = await startRun('uk_parliament')
  const sb = getSupabase()
  const errors: string[] = []
  let found = 0, inserted = 0, dupes = 0

  try {
    const rows: Array<Record<string, unknown>> = []

    // ── Register of Members' Financial Interests ──────────────────────
    try {
      const items: Array<Record<string, unknown>> = []
      for (const u of interestUrls) {
        try {
          const raw = await getJson(u)
          const page = asArray(raw, ['items', 'value', 'results'])
          if (!page.length) break
          items.push(...page)
        } catch { break }
      }
      found += items.length

      for (const wrapped of items) {
        const it = unwrap(wrapped)
        const id = str(it, 'id', 'interestId')
        if (!id) continue

        const member = (it.member && typeof it.member === 'object'
          ? it.member : {}) as Record<string, unknown>
        const category = (it.category && typeof it.category === 'object'
          ? it.category : {}) as Record<string, unknown>

        // The fields array carries the structured detail — donor name, value,
        // and crucially DonorCompanyIdentifier, which is a Companies House
        // registration number. That is the join key from a declared donation
        // to the company's filings, and on to voting behaviour.
        const fields: Record<string, string> = {}
        if (Array.isArray(it.fields)) {
          for (const f of it.fields as Array<Record<string, unknown>>) {
            const name = typeof f?.name === 'string' ? f.name : null
            const value = f?.value
            if (name && value != null && value !== '') fields[name] = String(value)
          }
        }

        const memberName = str(member, 'nameDisplayAs', 'nameListAs') ?? 'Unknown member'
        const party = str(member, 'party')
        const constituency = str(member, 'memberFrom')
        const categoryName = str(category, 'name') ?? 'Registered interest'
        const donor = fields.DonorCompanyName || fields.DonorName || null
        const value = fields.Value ? `£${Number(fields.Value).toLocaleString('en-GB')}` : null

        const title = donor && value
          ? `${memberName} (${party ?? 'unknown party'}) registered ${value} from ${donor}`
          : `${memberName}: ${categoryName}`

        rows.push({
          source: 'uk_parliament_interests',
          event_type: 'registered_interest',
          event_date: (str(it, 'registrationDate', 'publishedDate') ?? new Date().toISOString()).slice(0, 10),
          url: `https://interests-api.parliament.uk/api/v1/Interests/${id}`,
          raw_content: {
            title,
            description: [
              str(it, 'summary'),
              categoryName,
              party && constituency ? `${party}, ${constituency}` : null,
              fields.DonorStatus ? `Donor status: ${fields.DonorStatus}` : null,
              fields.ReceivedDate ? `Received ${fields.ReceivedDate}` : null,
            ].filter(Boolean).join('. '),
            member: memberName,
            party,
            constituency,
            category: categoryName,
            donor,
            value_gbp: fields.Value ? Number(fields.Value) : null,
            donor_company_number: fields.DonorCompanyIdentifier ?? null,
          },
          source_metadata: {
            interest_id: id,
            member_id: str(member, 'id'),
            category_id: str(category, 'id'),
            // Join key to Companies House — the donation -> company -> filings
            // -> votes circuit.
            donor_company_number: fields.DonorCompanyIdentifier ?? null,
            donor_status: fields.DonorStatus ?? null,
            value_gbp: fields.Value ? Number(fields.Value) : null,
          },
          processed: false,
        })
      }
    } catch (e) {
      errors.push(`interests: ${e instanceof Error ? e.message : 'failed'}`)
    }

    // ── Commons divisions (votes) ─────────────────────────────────────
    try {
      const raw = await getJson(DIVISIONS)
      const items = asArray(raw, ['items', 'value', 'results'])
      found += items.length

      for (const wrapped of items) {
        const d = unwrap(wrapped)
        const id = str(d, 'DivisionId', 'divisionId', 'id')
        const title = str(d, 'Title', 'title') ?? 'Commons division'
        if (!id) continue

        const ayes = str(d, 'AyeCount', 'ayeCount') ?? '?'
        const noes = str(d, 'NoCount', 'noCount') ?? '?'

        rows.push({
          source: 'uk_parliament_divisions',
          event_type: 'commons_division',
          event_date: (str(d, 'Date', 'date') ?? new Date().toISOString()).slice(0, 10),
          url: `https://votes.parliament.uk/Votes/Commons/Division/${id}`,
          raw_content: {
            title: `Commons division: ${title}`,
            description: `Ayes ${ayes}, Noes ${noes}. ${title}`,
            ayes, noes,
          },
          source_metadata: { division_id: id },
          processed: false,
        })
      }
    } catch (e) {
      errors.push(`divisions: ${e instanceof Error ? e.message : 'failed'}`)
    }

    // Dedupe against what we already hold, then bulk insert.
    if (rows.length) {
      const urls = rows.map(r => r.url as string)
      const { data: seen } = await sb
        .from('loro_source_events')
        .select('url')
        .in('url', urls)

      const seenSet = new Set((seen ?? []).map(s => s.url as string))
      const fresh = rows.filter(r => !seenSet.has(r.url as string))
      dupes = rows.length - fresh.length

      if (fresh.length) {
        const { data: ins, error } = await sb
          .from('loro_source_events')
          .insert(fresh)
          .select('id')
        if (error) errors.push(`insert: ${error.message}`)
        inserted = ins?.length ?? 0
      }
    }

    await completeRun(runId, { found, new: inserted, duplicate: dupes }, errors)
    return NextResponse.json({ ok: true, found, inserted, duplicates: dupes, errors: errors.slice(0, 4) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await completeRun(runId, { found, new: inserted, duplicate: dupes }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
