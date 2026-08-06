import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── UK SANCTIONS LIST ───────────────────────────────────────────────────
// Since 28 January 2026 this is the SINGLE official source for all UK
// sanctions designations — the OFSI Consolidated List closed on that date and
// no longer updates, so anything still reading OFSI is reading stale data.
//
// High signal, low volume: a designation naming a company or individual is
// checkable against the entity graph Loro already holds — political donors,
// contract winners, company officers. A donor or public supplier appearing
// here is not a routine filing.
//
// The published file URL carries a content hash that changes on every
// publication, so the link is DISCOVERED from the GOV.UK landing page rather
// than hardcoded. Hardcoding it would break silently at the next update.
//
// ?probe=1 reports which link was discovered and the shape found.

export const runtime = 'nodejs'
export const maxDuration = 60

const LANDING = 'https://www.gov.uk/government/publications/the-uk-sanctions-list'
const UA = 'Loro Intelligence (contact: hello@loro.media)'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Captured during discovery so a failure reports what WAS on the page rather
// than just saying nothing matched.
let lastDiscovery: Record<string, unknown> = {}

/** Find the CSV (preferred) or XML asset link on the publication page. */
async function discoverAssetUrl(): Promise<{ url: string; format: string } | null> {
  const res = await fetch(LANDING, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`landing page ${res.status}`)
  const html = await res.text()

  // Widened: GOV.UK has served attachments from more than one host over time,
  // so match any absolute link with a data extension rather than assuming
  // assets.publishing.service.gov.uk.
  const links = [...html.matchAll(/https?:\/\/[^"'\s<>]+\.(?:csv|xml|ods|odt)(?:\?[^"'\s<>]*)?/gi)]
    .map(m => m[0].replace(/&amp;/g, '&'))

  lastDiscovery = {
    total_links_seen: (html.match(/https?:\/\//g) ?? []).length,
    data_links: [...new Set(links)].slice(0, 12),
  }

  const csv = links.find(l => /\.csv(\?|$)/i.test(l))
  if (csv) return { url: csv, format: 'csv' }
  const xml = links.find(l => /\.xml(\?|$)/i.test(l))
  if (xml) return { url: xml, format: 'xml' }
  return null
}

/** RFC4180-ish CSV parse — quoted fields may contain commas and newlines. */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') {
      row.push(field); field = ''
      if (row.some(v => v.trim())) rows.push(row)
      row = []
    } else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); if (row.some(v => v.trim())) rows.push(row) }
  if (rows.length < 2) return []

  // The file carries preamble lines before the real header — find the row
  // that actually contains the identifying columns.
  const headerIdx = rows.findIndex(r =>
    r.some(c => /unique\s*id/i.test(c)) && r.some(c => /name/i.test(c)))
  if (headerIdx === -1) return []

  const header = rows[headerIdx].map(h => h.trim())
  return rows.slice(headerIdx + 1).map(r =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))
  )
}

function pick(o: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const hit = Object.keys(o).find(x => x.toLowerCase().replace(/\s+/g, '') === k.toLowerCase().replace(/\s+/g, ''))
    if (hit && o[hit]) return o[hit]
  }
  return ''
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const probe = url.searchParams.get('probe') === '1'

  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!probe && cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = probe ? '' : await startRun('uk_sanctions')
  const sb = getSupabase()
  const errors: string[] = []
  let found = 0, inserted = 0, dupes = 0

  try {
    const asset = await discoverAssetUrl()
    if (!asset) {
      return NextResponse.json({
        ok: false,
        reason: 'No CSV or XML asset link found on the landing page',
        discovery: lastDiscovery,
      })
    }

    const res = await fetch(asset.url, {
      headers: { 'User-Agent': UA, Accept: 'text/csv,application/xml,*/*' },
      signal: AbortSignal.timeout(35000),
    })
    if (!res.ok) throw new Error(`asset ${res.status}`)
    const body = await res.text()

    if (asset.format !== 'csv') {
      return NextResponse.json({
        ok: false, discovered: asset,
        reason: 'Only CSV parsing is implemented; the page currently offers XML.',
        head: body.slice(0, 300),
      })
    }

    const records = parseCsv(body)
    found = records.length

    if (probe) {
      return NextResponse.json({
        probe: true, discovered: asset,
        bytes: body.length, parsed: found,
        columns: records[0] ? Object.keys(records[0]).slice(0, 25) : null,
        sample: records[0] ?? null,
      })
    }

    // Only recent changes are news — the full list runs to thousands of
    // standing designations.
    const cutoff = new Date(Date.now() - 60 * 86400_000)

    const rows = records.map(r => {
      const uid = pick(r, 'Unique ID', 'UniqueID')
      const name = pick(r, 'Name 6', 'Name6', 'Full Name', 'Name')
      const type = pick(r, 'Individual, Entity, Ship', 'Designation Type', 'Type')
      const regime = pick(r, 'Regime Name', 'Regime')
      const updated = pick(r, 'Last Updated', 'LastUpdated')
      const reasons = pick(r, 'UK Statement of Reasons', 'Statement of Reasons', 'OtherInformation')
      const measures = pick(r, 'Sanctions Imposed', 'Sanctions Imposed Indicators')
      // Another join key into the entity graph: a designated ENTITY often
      // carries its company registration number.
      const regNo = pick(r, 'Business registration number (s)', 'Business registration numbers')
      const country = pick(r, 'Address Country')
      const parent = pick(r, 'Parent company')

      const d = updated.match(/(\d{2})\/(\d{2})\/(\d{4})/)
      const iso = d ? `${d[3]}-${d[2]}-${d[1]}` : updated.slice(0, 10)

      return { uid, name, type, regime, iso, reasons, measures, regNo, country, parent }
    })
    .filter(r => r.uid && r.name)
    .filter(r => {
      const t = Date.parse(r.iso)
      return Number.isFinite(t) ? new Date(t) >= cutoff : false
    })
    .slice(0, 200)
    .map(r => ({
      source: 'uk_sanctions',
      event_type: 'sanctions_designation',
      event_date: r.iso,
      url: `https://search-uk-sanctions-list.service.gov.uk/?search=${encodeURIComponent(r.name)}`,
      raw_content: {
        title: `${r.name} designated under UK sanctions${r.regime ? ` (${r.regime})` : ''}`,
        description:
          `${r.name}${r.type ? `, a designated ${r.type.toLowerCase()}` : ''}, appears on the UK Sanctions List` +
          `${r.regime ? ` under the ${r.regime} regime` : ''}, last updated ${r.iso}. ` +
          (r.measures ? `Measures: ${r.measures}. ` : '') +
          (r.reasons ? `Statement of reasons: ${String(r.reasons).slice(0, 900)}` : ''),
        designated_name: r.name,
        designation_type: r.type,
        regime: r.regime,
        business_registration_number: r.regNo || null,
        country: r.country || null,
        parent_company: r.parent || null,
      },
      source_metadata: {
        unique_id: r.uid,
        regime: r.regime,
        business_registration_number: r.regNo || null,
        designation_type: r.type,
        last_updated: r.iso,
        attribution: 'Contains public sector information licensed under the Open Government Licence v3.0',
      },
      processed: false,
    }))

    if (rows.length) {
      const ids = rows.map(r => (r.source_metadata as Record<string, unknown>).unique_id as string)
      const { data: seen } = await sb
        .from('loro_source_events')
        .select('source_metadata').eq('source', 'uk_sanctions').limit(5000)
      const seenSet = new Set(
        (seen ?? []).map(s => (s.source_metadata as Record<string, unknown>)?.unique_id as string)
      )
      const fresh = rows.filter((_, i) => !seenSet.has(ids[i]))
      dupes = rows.length - fresh.length

      if (fresh.length) {
        const { data: ins, error } = await sb
          .from('loro_source_events').insert(fresh).select('id')
        if (error) errors.push(`insert: ${error.message}`)
        inserted = ins?.length ?? 0
      }
    }

    await completeRun(runId, { found, new: inserted, duplicate: dupes }, errors)
    return NextResponse.json({
      ok: true, discovered: asset.url,
      total_in_list: found, recent_changes: rows.length,
      inserted, duplicates: dupes, errors: errors.slice(0, 3),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    if (!probe) await completeRun(runId, { found, new: inserted, duplicate: dupes }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
