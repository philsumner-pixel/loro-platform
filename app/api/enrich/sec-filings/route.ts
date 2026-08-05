import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startRun, completeRun } from '@/lib/ingest/utils'

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
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ')

  // Tags to spaces, entities to characters.
  text = text.replace(/<[^>]+>/g, ' ')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')

  // Collapse whitespace and the long rules EDGAR loves.
  text = text.replace(/[_=–—-]{4,}/g, ' ').replace(/\s+/g, ' ').trim()

  return text
}

/** 8-K item codes carry the meaning — surface them explicitly. */
function extractItems(text: string): string[] {
  const items = new Set<string>()
  const re = /Item\s+(\d\.\d{2})/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) items.add(m[1])
  return [...items].sort()
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

    let batch = priority ?? []
    if (batch.length < limit) {
      const { data: rest } = await sb
        .from('loro_source_events')
        .select('id, url, event_type, raw_content')
        .eq('source', 'sec_daily_index')
        .is('content_enriched_at', null)
        .not('event_type', 'in', `(${PRIORITY.join(',')})`)
        .limit(limit - batch.length)
      batch = [...batch, ...(rest ?? [])]
    }

    for (const ev of batch) {
      attempted++
      try {
        const res = await fetch(ev.url as string, {
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
