import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/ingest/utils'

export async function GET() {
  const sb = getSupabase()

  const [runs, eventCounts, pubStatus] = await Promise.all([
    // Last 20 ingest runs
    sb.from('loro_ingest_runs')
      .select('source, status, started_at, completed_at, events_found, events_new, events_duplicate, errors')
      .order('started_at', { ascending: false })
      .limit(20),

    // Event count per source
    sb.from('loro_source_events')
      .select('source')
      .then(async ({ data }) => {
        if (!data) return {}
        return data.reduce((acc: Record<string, number>, r) => {
          acc[r.source] = (acc[r.source] ?? 0) + 1
          return acc
        }, {})
      }),

    // News coverage publication status
    sb.from('loro_monitored_publications')
      .select('slug, name, tier, active, last_polled_at')
      .order('tier', { ascending: true }),

    // News coverage count
  ])

  const { count: newsCoverageCount } = await sb
    .from('loro_news_coverage')
    .select('*', { count: 'exact', head: true })

  const { count: candidateCount } = await sb
    .from('loro_story_candidates')
    .select('*', { count: 'exact', head: true })
    .neq('status', 'discarded')

  return NextResponse.json({
    summary: {
      total_source_events: Object.values(eventCounts as Record<string, number>).reduce((a, b) => a + b, 0),
      total_news_coverage: newsCoverageCount,
      active_candidates: candidateCount,
    },
    events_by_source: eventCounts,
    recent_runs: runs.data ?? [],
    monitored_publications: pubStatus.data ?? [],
  })
}
