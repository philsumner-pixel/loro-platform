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

/** The .idx is fixed-width-ish, pipe-free, with a dashed header separator. */
function parseFormIdx(text: string): Filing[] {
  const lines = text.split('\n')
  const start = lines.findIndex(l => /^-{5,}/.test(l))
  if (start === -1) return []

  const out: Filing[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue
    // Columns: Form Type | Company Name | CIK | Date Filed | File Name
    const m = line.match(/^(.{1,12}?)\s{2,}(.+?)\s{2,}(\d{1,10})\s+(\d{4}-\d{2}-\d{2})\s+(\S+)\s*$/)
    if (!m) continue
    const [, form, company, cik, dateFiled, fileName] = m
    const accession = fileName.split('/').pop()?.replace('.txt', '') ?? fileName
    out.push({
      form: form.trim(),
      company: company.trim(),
      cik: cik.replace(/^0+/, ''),
      dateFiled,
      fileName,
      accession,
    })
  }
  return out
}

/** Discover/attach the entity. Entities accumulate from the stream. */
async function resolveEntity(
  sb: ReturnType<typeof getSupabase>,
  company: string,
  cik: string,
  cache: Map<string, string>
): Promise<string | null> {
  const padded = cik.padStart(10, '0')
  if (cache.has(padded)) return cache.get(padded)!

  const { data: existing } = await sb
    .from('loro_entities')
    .select('id')
    .eq('sec_cik', padded)
    .maybeSingle()

  if (existing?.id) {
    cache.set(padded, existing.id)
    return existing.id
  }

  // New entity discovered in the wild — create it.
  const { data: created, error } = await sb
    .from('loro_entities')
    .insert({
      name: company,
      entity_type: 'company',
      jurisdiction: 'US',
      sec_cik: padded,
      notes: 'Auto-discovered from SEC daily index',
    })
    .select('id')
    .single()

  if (error || !created) return null
  cache.set(padded, created.id)
  return created.id
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
    const attempts: Array<{ url: string; status: number | string; lines?: number; parsed?: number }> = []

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
        attempts.push({ url, status: res.status, lines: text.split('\n').length, parsed: parsed.length })
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

    // Cap per run so we stay inside maxDuration; dedupe makes repeats cheap.
    const batch = interesting.slice(0, 400)
    const cache = new Map<string, string>()

    // Which accessions do we already have?
    const accessions = batch.map(f => f.accession)
    const { data: seen } = await sb
      .from('loro_source_events')
      .select('source_metadata')
      .eq('source', 'sec_daily_index')
      .in('source_metadata->>accession', accessions.slice(0, 200))

    const seenSet = new Set(
      (seen ?? []).map(r => (r.source_metadata as { accession?: string })?.accession).filter(Boolean)
    )

    for (const f of batch) {
      if (seenSet.has(f.accession)) { dupes++; continue }

      const before = cache.size
      const entityId = await resolveEntity(sb, f.company, f.cik, cache)
      if (cache.size > before) newEntities++

      const { error } = await sb.from('loro_source_events').insert({
        source: 'sec_daily_index',
        event_type: `sec_${f.form.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        entity_id: entityId,
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
      })

      if (error) {
        if (!errors.length) errors.push(`insert: ${error.message}`)
      } else inserted++
    }

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
