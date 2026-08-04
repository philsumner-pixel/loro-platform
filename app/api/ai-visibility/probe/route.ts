import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// OUTBOUND CITATION PROBE
//
// Asks an answer engine real questions and records whether Loro appears in the
// citations. Combined with loro_bot_hits (inbound crawler logs) this completes
// the diagnosis:
//   never crawled + not cited = access problem (robots, rendering, gating)
//   crawled + not cited       = content problem (retrievable, not quotable)
//   crawled + cited           = win
//
// DISCIPLINE (from the Princeton/Georgia Tech findings): a single prompt tells
// you nothing — responses are volatile and 40-60% of cited sources change
// month over month. Run a representative set repeatedly and read the trend
// over 30-90 days, never a single run.
//
// Engine: Claude with the web_search tool. Architected so other engines can be
// added as separate `engine` values without changing the schema.

export const runtime = 'nodejs'
export const maxDuration = 60

const OUR_DOMAINS = ['loro.media', 'loro-platform.vercel.app']

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface ContentBlock {
  type?: string
  text?: string
  citations?: Array<{ url?: string; title?: string }>
  content?: Array<{ type?: string; title?: string; url?: string }>
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

/** Pull every cited URL out of a Claude response with web_search. */
function extractCitations(blocks: ContentBlock[]): string[] {
  const urls = new Set<string>()
  for (const b of blocks) {
    for (const c of b.citations ?? []) {
      if (c.url) urls.add(c.url)
    }
    // web_search_tool_result blocks carry the raw results
    for (const r of b.content ?? []) {
      if (r?.url) urls.add(r.url)
    }
  }
  return [...urls]
}

async function probeClaude(prompt: string, apiKey: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_PROBE_MODEL || 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    }),
    signal: AbortSignal.timeout(45000),
  })

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }

  const data = await res.json()
  const blocks = (data.content ?? []) as ContentBlock[]
  const urls = extractCitations(blocks)
  const answer = blocks
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text as string)
    .join('\n')

  return { urls, answer }
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 4)
  const sb = getSupabase()

  // Oldest-probed prompts first, so the whole set gets covered over time
  // rather than the same few being re-run.
  const { data: prompts } = await sb
    .from('loro_citation_prompts')
    .select('id, prompt, lane_slug')
    .eq('is_active', true)
    .limit(50)

  if (!prompts?.length) {
    return NextResponse.json({ ok: true, message: 'No active prompts' })
  }

  const { data: recent } = await sb
    .from('loro_citation_probes')
    .select('prompt_id, run_at')
    .order('run_at', { ascending: false })
    .limit(200)

  const lastRun = new Map<string, string>()
  for (const r of recent ?? []) {
    if (r.prompt_id && !lastRun.has(r.prompt_id)) lastRun.set(r.prompt_id, r.run_at)
  }

  const queue = [...prompts].sort((a, b) => {
    const ta = lastRun.get(a.id) ?? ''
    const tb = lastRun.get(b.id) ?? ''
    return ta.localeCompare(tb)
  }).slice(0, limit)

  const results: Array<Record<string, unknown>> = []

  for (const p of queue) {
    try {
      const { urls, answer } = await probeClaude(p.prompt, apiKey)
      const domains = [...new Set(urls.map(domainOf).filter(Boolean))]
      const ours = urls.filter(u => OUR_DOMAINS.some(d => domainOf(u) === d))

      await sb.from('loro_citation_probes').insert({
        engine: 'claude-web-search',
        prompt_id: p.id,
        prompt: p.prompt,
        lane_slug: p.lane_slug,
        loro_cited: ours.length > 0,
        loro_urls: ours,
        cited_domains: domains,
        citation_count: urls.length,
        answer_excerpt: answer.slice(0, 1000),
      })

      results.push({
        prompt: p.prompt,
        loro_cited: ours.length > 0,
        citations: urls.length,
        top_domains: domains.slice(0, 6),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'probe failed'
      await sb.from('loro_citation_probes').insert({
        engine: 'claude-web-search',
        prompt_id: p.id,
        prompt: p.prompt,
        lane_slug: p.lane_slug,
        loro_cited: false,
        error: message,
      })
      results.push({ prompt: p.prompt, error: message })
    }
  }

  return NextResponse.json({
    ok: true,
    probed: results.length,
    cited: results.filter(r => r.loro_cited).length,
    results,
    note: 'Single runs are noise. Read the trend across 30-90 days.',
  })
}
