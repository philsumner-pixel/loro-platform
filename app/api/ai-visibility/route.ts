import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// AI visibility — the inbound half.
//
// Answers: which engines are crawling us, how fast after publication, which
// articles have never been seen, and how often a real user question triggered
// a live fetch. This is the diagnostic layer outbound-only tools can't provide.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: Request) {
  const days = Number(new URL(req.url).searchParams.get('days') ?? 30)
  const sb = getSupabase()
  const since = new Date(Date.now() - days * 86400_000).toISOString()

  const { data: hits } = await sb
    .from('loro_bot_hits')
    .select('bot_name, is_live_fetch, ts, article_slug')
    .gte('ts', since)

  const rows = hits ?? []

  // Activity per bot
  const byBot: Record<string, { hits: number; live: number; last: string }> = {}
  for (const h of rows) {
    const b = (byBot[h.bot_name] ??= { hits: 0, live: 0, last: h.ts })
    b.hits++
    if (h.is_live_fetch) b.live++
    if (h.ts > b.last) b.last = h.ts
  }

  const [
    { data: coverage },
    { data: crawlSeries },
    { data: citeSeries },
    { data: sov },
    { data: lanes },
    { data: articlePerf },
  ] = await Promise.all([
    sb.rpc('loro_crawl_coverage', { days }),
    sb.rpc('loro_crawl_timeseries', { days }),
    sb.rpc('loro_citation_timeseries', { days: Math.max(days, 90) }),
    sb.rpc('loro_share_of_voice', { days, top_n: 20 }),
    sb.rpc('loro_lane_performance', { days }),
    sb.rpc('loro_article_performance', { days: Math.max(days, 90) }),
  ])

  interface CoverageRow {
    article_slug: string; headline: string; published_at: string
    bots_seen: number; bot_names: string[] | null
    hours_to_first_crawl: number | null; live_fetches: number
  }
  const cov = (coverage ?? []) as CoverageRow[]

  const uncrawled = cov.filter(c => !c.bots_seen)
  const crawled = cov.filter(c => c.bots_seen > 0)
  const times = crawled
    .map(c => c.hours_to_first_crawl)
    .filter((n): n is number => typeof n === 'number' && n >= 0)

  return NextResponse.json({
    window_days: days,
    totals: {
      bot_hits: rows.length,
      live_fetches: rows.filter(h => h.is_live_fetch).length,
      distinct_bots: Object.keys(byBot).length,
      articles_in_window: cov.length,
      articles_crawled: crawled.length,
      articles_never_crawled: uncrawled.length,
      median_hours_to_first_crawl: times.length
        ? Number(times.sort((a, b) => a - b)[Math.floor(times.length / 2)].toFixed(1))
        : null,
    },
    by_bot: Object.entries(byBot)
      .map(([name, v]) => ({ bot: name, ...v }))
      .sort((a, b) => b.hits - a.hits),
    // These are the action list: published but never seen by any engine.
    never_crawled: uncrawled.slice(0, 25).map(c => ({
      slug: c.article_slug, headline: c.headline, published_at: c.published_at,
    })),
    crawl_timeseries: crawlSeries ?? [],
    citation_timeseries: citeSeries ?? [],
    share_of_voice: sov ?? [],
    lane_performance: lanes ?? [],
    article_performance: articlePerf ?? [],
    coverage: crawled.slice(0, 50).map(c => ({
      slug: c.article_slug,
      headline: c.headline,
      bots_seen: c.bots_seen,
      bots: c.bot_names,
      hours_to_first_crawl: c.hours_to_first_crawl,
      live_fetches: c.live_fetches,
    })),
  })
}
