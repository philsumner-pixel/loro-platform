import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun, stripTags, stripScriptAndStyle } from '@/lib/ingest/utils'

// ── CONTENT ENRICHMENT ──────────────────────────────────────────────────
// Why this exists: the corpus was embedded but the embeddings were near
// worthless. Events carried metadata, not content — "ARCH CAPITAL GROUP LTD.
// filed 10-Q" — so vectors encoded the FORM TYPE and semantic clustering could
// only ever group "things of the same form type". Garbage in, garbage out.
//
// This fetches the actual filing text and writes it back, then clears the
// embedding so the next embed run re-vectorises against real substance.
//
// Priority order matters: 8-K describes material events and is where the
// stories are; 10-K/10-Q are long and mostly boilerplate, so they're enriched
// only after the 8-Ks are done, and truncated hard.

export const runtime = 'nodejs'
export const maxDuration = 60

const UA = 'Loro Intelligence (contact: hello@loro.media)'

// SEC asks for no more than 10 requests/second. We stay well under.
const REQUEST_GAP_MS = 220

// Forms worth the fetch, in priority order.
const PRIORITY = ['sec_8_k', 'sec_sc_13d', 'sec_sc_13g', 'sec_4', 'sec_25', 'sec_nt_10_k', 'sec_nt_10_q']
const MAX_CHARS = 6000

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Strip SGML/HTML wrapper from an EDGAR document down to readable prose.
 * EDGAR .txt submissions carry multiple <DOCUMENT> blocks plus XBRL noise.
 */
function extractText(raw: string): string {
  let text = raw

  // Drop XBRL / XML blocks and the SEC header wrapper — pure noise.
  text = text.replace(/<XBRL[\s\S]*?<\/XBRL>/gi, ' ')
  text = text.replace(/<TYPE>(?:EX-|GRAPHIC|ZIP|EXCEL|JSON|XML)[\s\S]*?<\/DOCUMENT>/gi, ' ')
  text = text.replace(/<SEC-HEADER>[\s\S]*?<\/SEC-HEADER>/gi, ' ')
  text = text.replace(/<head[\s\S]*?<\/head>/gi, ' ')
  // Same defect as the FCA route carried alert #20 and #19: '</script>' does
  // not match '</script bar>', which HTML treats as a valid end tag, so the
  // script body survived into the embedded text.
  text = stripScriptAndStyle(text)

  // Tags to spaces. stripTags repeats until stable — one pass can reassemble
  // the tag it removed.
  text = stripTags(text, ' ')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')

  // Collapse whitespace and the long rules EDGAR loves.
  text = text.replace(/[_=–—-]{4,}/g, ' ').replace(/\s+/g, ' ').trim()

  // Every 8-K opens with several hundred characters of identical cover-page
  // boilerplate (SEC address, Exchange Act citation, checkbox paragraphs,
  // registrant address block). Left in, it dominates similarity and every
  // filing looks alike. Skip to the first Item heading, which is where the
  // actual disclosure begins.
  const firstItem = text.search(/Item\s+\d\.\d{2}/i)
  if (firstItem > 0) {
    text = text.slice(firstItem)
  } else {
    // No Item heading (Form 4, SC 13D etc) — drop the known cover-page
    // preamble if present.
    text = text.replace(
      /^.*?(?:Securities Exchange Act of 1934|CURRENT REPORT|SECURITIES AND EXCHANGE COMMISSION)\s*/i,
      ''
    )
  }

  // Trailing signature blocks add nothing and repeat across filings.
  text = text.replace(/\s+Pursuant to the requirements of the Securities Exchange Act[\s\S]*$/i, '')

  return text.trim()
}

/** 8-K item codes carry the meaning — surface them explicitly. */
function extractItems(text: string): string[] {
  const items = new Set<string>()
  const re = /Item\s+(\d\.\d{2})/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) items.add(m[1])
  return [...items].sort()
}

/**
 * Turn a full-submission .txt URL into the primary document URL using EDGAR's
 * filing index JSON. Falls back to the original if the index can't be read.
 *   .../edgar/data/<cik>/<accession-with-dashes>.txt
 *   -> .../edgar/data/<cik>/<accession-no-dashes>/<primaryDocument>
 */
async function resolvePrimaryDocument(txtUrl: string): Promise<string> {
  const m = txtUrl.match(/\/edgar\/data\/(\d+)\/([\d-]+)\.txt$/)
  if (!m) return txtUrl
  const [, cik, accession] = m
  const bare = accession.replace(/-/g, '')
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${bare}/index.json`

  try {
    const res = await fetch(indexUrl, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return txtUrl
    const json = await res.json() as {
      directory?: { item?: Array<{ name?: string; size?: string }> }
    }
    const items = json.directory?.item ?? []

    // Prefer a modestly sized .htm that isn't an exhibit or XBRL artefact.
    const candidate = items
      .filter(i => i.name && /\.html?$/i.test(i.name))
      .filter(i => !/^(ex|R\d|Financial_Report)/i.test(i.name!))
      .filter(i => Number(i.size ?? 0) > 0 && Number(i.size ?? 0) < 2_000_000)
      .sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0]

    return candidate?.name
      ? `https://www.sec.gov/Archives/edgar/data/${cik}/${bare}/${candidate.name}`
      : txtUrl
  } catch {
    return txtUrl
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Diagnostic: fetch one document and report sizes at each stage, so a
  // silent 'too_short' can be traced instead of guessed at.
  const debugUrl = url.searchParams.get('debug')
  if (debugUrl) {
    const res = await fetch(debugUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html,text/plain,*/*' },
      signal: AbortSignal.timeout(20000),
    })
    const raw = await res.text()
    const stripped = extractText(raw)
    return NextResponse.json({
      status: res.status,
      content_type: res.headers.get('content-type'),
      raw_length: raw.length,
      raw_head: raw.slice(0, 400),
      extracted_length: stripped.length,
      extracted_head: stripped.slice(0, 400),
    })
  }

  const limit = Math.min(Number(url.searchParams.get('limit') ?? 12), 25)
  const runId = await startRun('content_enrichment')
  const sb = getSupabase()
  const errors: string[] = []
  let attempted = 0, enriched = 0, skipped = 0

  try {
    // Priority forms first, then anything else from the firehose.
    const { data: priority } = await sb
      .from('loro_source_events')
      .select('id, url, event_type, raw_content')
      .eq('source', 'sec_daily_index')
      .is('content_enriched_at', null)
      .in('event_type', PRIORITY)
      .limit(limit)

    // Deliberately NO fallback to 10-K/10-Q. Those full submissions run to
    // 5MB across 60+ documents and are almost entirely boilerplate and XBRL —
    // fetching them costs a lot and yields nothing a story could use.
    const batch = priority ?? []

    for (const ev of batch) {
      attempted++
      try {
        // The stored URL is the full submission (.txt) — for a large filer that
        // is megabytes of concatenated documents and XBRL. Resolve the PRIMARY
        // document from the filing index instead: for an 8-K that is a small,
        // readable HTML file containing the actual disclosure.
        const target = await resolvePrimaryDocument(ev.url as string)
        const res = await fetch(target, {
          headers: { 'User-Agent': UA, Accept: 'text/html,text/plain,*/*' },
          signal: AbortSignal.timeout(15000),
        })
        await sleep(REQUEST_GAP_MS)

        if (!res.ok) {
          errors.push(`${res.status} ${ev.event_type}`)
          // Mark attempted so a permanently missing document isn't retried
          // forever, but keep the reason.
          await sb.from('loro_source_events')
            .update({ content_enriched_at: new Date().toISOString(),
                      enrichment_status: `http_${res.status}` })
            .eq('id', ev.id)
          skipped++
          continue
        }

        const raw = await res.text()
        const text = extractText(raw).slice(0, MAX_CHARS)

        if (text.length < 200) {
          await sb.from('loro_source_events')
            .update({ content_enriched_at: new Date().toISOString(),
                      enrichment_status: 'too_short' })
            .eq('id', ev.id)
          skipped++
          continue
        }

        const existing = (ev.raw_content ?? {}) as Record<string, unknown>
        const items = extractItems(text)

        await sb.from('loro_source_events')
          .update({
            raw_content: {
              ...existing,
              // description is what the embedder reads — replace the template
              // with real substance.
              description: text,
              ...(items.length ? { item_codes: items } : {}),
            },
            content_enriched_at: new Date().toISOString(),
            enrichment_status: 'ok',
            // Force re-embedding against the enriched content.
            embedding: null,
            embedding_input: null,
          })
          .eq('id', ev.id)

        enriched++
      } catch (e) {
        errors.push(`${ev.event_type}: ${e instanceof Error ? e.message.slice(0, 60) : 'failed'}`)
        skipped++
      }
    }

    await completeRun(runId, { found: attempted, new: enriched, duplicate: skipped }, errors)
    return NextResponse.json({
      ok: true, attempted, enriched, skipped,
      errors: errors.slice(0, 5),
      note: 'Enriched events have embedding cleared and will re-vectorise on the next embed run.',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await completeRun(runId, { found: attempted, new: enriched, duplicate: skipped }, [msg])
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
