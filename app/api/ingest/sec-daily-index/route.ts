import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

// ── SEC DAILY INDEX FIREHOSE ────────────────────────────────────────────
// Passive sniffing, not watchlist polling.
//
// The existing /api/ingest/sec-edgar route asks "give me filings for these
// 11 CIKs". This route asks "give me EVERY filing today" and discovers the
// entities as it goes. Entities become an OUTPUT of ingestion, not an input.
//
// Source: https://www.sec.gov/Archives/edgar/daily-index/
// form.<date>.idx lists every filing: form type | company | CIK | date | file
//
// Cron: hourly. The index is republished through the day, and dedupe by
// accession number makes re-reading it cheap.

export const runtime = 'nodejs'
export const maxDuration = 60

// Form types worth keeping. The firehose is broad but not indiscriminate —
// these are the forms that actually carry story signal.
const FORMS_OF_INTEREST = new Set([
  '8-K',      // material events
  '4',        // insider dealing
  '13D', 'SC 13D', 'SC 13D/A',   // activist / >5% stakes
  '13G', 'SC 13G', 'SC 13G/A',   // passive >5% stakes
  '10-Q', '10-K',                 // periodic reports
  '424B4', 'S-1', 'S-1/A',        // offerings / IPO
  'DEF 14A',                      // proxy — pay, board, votes
  '25', '25-NSE',                 // delisting
  'NT 10-K', 'NT 10-Q',           // late filing — often a signal
])

const UA = 'Loro Intelligence (contact: hello@loro.media)'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Most recent weekday index that should exist (SEC publishes on business days). */
function candidateDates(back: number): string[] {
  const out: string[] = []
  const d = new Date()
  while (out.length < back) {
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) {
      out.push(d.toISOString().slice(0, 10))
    }
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}

function indexUrl(dateIso: string): string {
  const [y, m, dd] = dateIso.split('-')
  const q = Math.floor((parseInt(m, 10) - 1) / 3) + 1
  return `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${y}${m}${dd}.idx`
}

interface Filing {
  form: string
  company: string
  cik: string
  dateFiled: string
  fileName: string
  accession: string
}

/**
 * Parse form.idx. Fixed-width, space-padded. Rather than relying on header
 * detection or column offsets (both of which vary), split on runs of 2+ spaces
 * and anchor from the END of the line: filename, date and CIK are the last
 * three fields, so a company name containing double spaces can't shift them.
 */
function parseFormIdx(text: string): Filing[] {
  const out: Filing[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^-{5,}/.test(line)) continue

    const parts = line.split(/\s{2,}/).map(p => p.trim()).filter(Boolean)
    if (parts.length < 5) continue

    const fileName = parts[parts.length - 1]
    const dateFiled = parts[parts.length - 2]
    const cik = parts[parts.length - 3]
    const form = parts[0]
    const company = parts.slice(1, parts.length - 3).join(' ')

    // Validate rather than trust position — skips headers and stray lines.
    // NB: the real file uses YYYYMMDD (no dashes), not ISO.
    if (!/^\d{8}$/.test(dateFiled)) continue
    if (!/^\d{1,10}$/.test(cik)) continue
    if (!fileName.includes('edgar/data/')) continue
    if (!form || !company) continue

    out.push({
      form,
      company,
      cik: cik.replace(/^0+/, ''),
      dateFiled: `${dateFiled.slice(0, 4)}-${dateFiled.slice(4, 6)}-${dateFiled.slice(6, 8)}`,
      fileName,
      accession: fileName.split('/').pop()?.replace('.txt', '') ?? fileName,
    })
  }
  return out
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startRun('sec_daily_index')
  const sb = getSupabase()
  const errors: string[] = []
  let found = 0, kept = 0, inserted = 0, dupes = 0, newEntities = 0

  try {
    // Try today, then walk back — today's index may not be published yet.
    let filings: Filing[] = []
    let usedDate = ''
    const attempts: Array<{ url: string; status: number | string; lines?: number; parsed?: number; sample?: string[] }> = []

    for (const date of candidateDates(6)) {
      const url = indexUrl(date)
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, Accept: 'text/plain,*/*' },
          signal: AbortSignal.timeout(20000),
        })
        if (!res.ok) { attempts.push({ url, status: res.status }); continue }
        const text = await res.text()
        const parsed = parseFormIdx(text)
        attempts.push({ url, status: res.status, lines: text.split('\n').length, parsed: parsed.length, sample: text.split(/\r?\n/).slice(0, 12).map(l => l.slice(0, 120)) })
        if (parsed.length) { filings = parsed; usedDate = date; break }
      } catch (e) {
        attempts.push({ url, status: e instanceof Error ? e.message.slice(0, 60) : 'fetch failed' })
      }
    }

    if (!filings.length) {
      await completeRun(runId, { found: 0, new: 0, duplicate: 0 }, ['no index available'])
      return NextResponse.json({ ok: false, reason: 'No daily index available yet', attempts })
    }

    found = filings.length
    const interesting = filings.filter(f => FORMS_OF_INTEREST.has(f.form))
    kept = interesting.length

    // Batched, not row-by-row: the first version did a SELECT + possible
    // INSERT per filing and timed out after ~145 entities with 0 events
    // written. Everything below is set-based.
    const batch = interesting.slice(0, 120)

    // 1. Which accessions do we already have?
    const { data: seen } = await sb
      .from('loro_source_events')
      .select('source_metadata')
      .eq('source', 'sec_daily_index')
      .gte('event_date', usedDate)

    const seenSet = new Set(
      (seen ?? [])
        .map(r => (r.source_metadata as { accession?: string })?.accession)
        .filter(Boolean) as string[]
    )
    const todo = batch.filter(f => !seenSet.has(f.accession))
    dupes = batch.length - todo.length
    if (!todo.length) {
      await completeRun(runId, { found, new: 0, duplicate: dupes }, errors)
      return NextResponse.json({ ok: true, index_date: usedDate, filings_in_index: found, forms_of_interest: kept, inserted: 0, duplicates: dupes, new_entities_discovered: 0 })
    }

    // 2. Resolve entities in bulk.
    const ciks = [...new Set(todo.map(f => f.cik.padStart(10, '0')))]
    const { data: known } = await sb
      .from('loro_entities')
      .select('id, sec_cik')
      .in('sec_cik', ciks)

    const cikToId = new Map<string, string>(
      (known ?? []).map(e => [e.sec_cik as string, e.id as string])
    )

    const missing = todo.filter(f => !cikToId.has(f.cik.padStart(10, '0')))
    const uniqueMissing = new Map<string, string>()
    for (const f of missing) uniqueMissing.set(f.cik.padStart(10, '0'), f.company)

    if (uniqueMissing.size) {
      const { data: created, error: entErr } = await sb
        .from('loro_entities')
        .insert([...uniqueMissing.entries()].map(([cik, name]) => ({
          name,
          entity_type: 'company',
          jurisdiction: 'US',
          sec_cik: cik,
          notes: 'Auto-discovered from SEC daily index',
        })))
        .select('id, sec_cik')
      if (entErr) errors.push(`entities: ${entErr.message}`)
      for (const e of created ?? []) cikToId.set(e.sec_cik as string, e.id as string)
      newEntities = created?.length ?? 0
    }

    // 3. Insert events in one go.
    const rows = todo.map(f => ({
      source: 'sec_daily_index',
      event_type: `sec_${f.form.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`,
      entity_id: cikToId.get(f.cik.padStart(10, '0')) ?? null,
      event_date: f.dateFiled,
      url: `https://www.sec.gov/Archives/${f.fileName}`,
      raw_content: {
        title: `${f.company} filed ${f.form}`,
        description: `SEC form ${f.form} filed by ${f.company} (CIK ${f.cik}) on ${f.dateFiled}.`,
        form: f.form,
        company: f.company,
        cik: f.cik,
      },
      source_metadata: { accession: f.accession, index_date: usedDate, form: f.form },
      processed: false,
    }))

    const { data: ins, error: insErr } = await sb
      .from('loro_source_events')
      .insert(rows)
      .select('id')
    if (insErr) errors.push(`events: ${insErr.message}`)
    inserted = ins?.length ?? 0

    await completeRun(runId, { found, new: inserted, duplicate: dupes }, errors)

    return NextResponse.json({
      ok: true,
      index_date: usedDate,
      filings_in_index: found,
      forms_of_interest: kept,
      inserted,
      duplicates: dupes,
      new_entities_discovered: newEntities,
      errors: errors.slice(0, 3),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await completeRun(runId, { found, new: inserted, duplicate: dupes }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
