import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'
import EntityLandscape from './EntityLandscape'
import type { EntityScore } from './EntityLandscape'

export const metadata: Metadata = {
  title: 'Intelligence Dashboard - Loro',
  description: 'Live Loro Payment Intelligence Score landscape across all monitored entities.',
}

export const revalidate = 300

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function timeAgo(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000)
  const d = Math.floor(h / 24)
  if (d > 1) return `${d}d ago`
  if (d === 1) return 'Yesterday'
  if (h > 0) return `${h}h ago`
  return 'Just now'
}

function oppLabel(s: string | null) {
  return { exclusive: 'Exclusive', depth_play: 'Depth', angle_play: 'Angle', context_only: 'Context' }[s ?? ''] ?? ''
}

async function getDashboardData() {
  const sb = getSupabase()
  const [scoresRes, candidatesRes, runsRes, eventsRes] = await Promise.all([
    sb.from('loro_entity_scores_latest')
      .select('entity_id,entity_name,entity_slug,jurisdiction,loro_score,score_delta,score_percentile,regulatory_score,sentiment_score,news_score,ownership_score,market_score,regulatory_events_7d,avg_anomaly_score_7d,sentiment_posts_7d,news_articles_7d,pdmr_events_7d,insider_direction,alert_triggered,score_date')
      .not('loro_score', 'is', null)
      .order('loro_score', { ascending: false }),
    sb.from('loro_story_candidates')
      .select('id,headline,category,anomaly_score,editorial_opportunity,novelty_status,detected_at,status')
      .gte('anomaly_score', 6)
      .neq('status', 'discarded')
      .order('anomaly_score', { ascending: false })
      .limit(6),
    sb.from('loro_ingest_runs')
      .select('source,status,events_new,events_found,started_at,errors')
      .order('started_at', { ascending: false })
      .limit(24),
    sb.from('loro_source_events')
      .select('source')
  ])

  const eventsBySource: Record<string, number> = {}
  for (const e of eventsRes.data ?? []) {
    eventsBySource[e.source] = (eventsBySource[e.source] ?? 0) + 1
  }

  return {
    scores:          (scoresRes.data ?? []) as EntityScore[],
    candidates:      candidatesRes.data ?? [],
    runs:            runsRes.data ?? [],
    eventsBySource,
    totalEvents:     eventsRes.data?.length ?? 0,
  }
}

const SOURCE_LABELS: Record<string, string> = {
  fca_pdmr:         'FCA PDMR',
  sec_form4:        'SEC Form 4',
  sec_8k:           'SEC 8-K',
  companies_house:  'Companies House',
  rss_monitoring:   'RSS News',
  bis_statistics:   'BIS / ECB',
}

export default async function DashboardPage() {
  const { scores, candidates, runs, eventsBySource, totalEvents } = await getDashboardData()

  const topMovers = scores.slice(0, 5)
  const alerts    = scores.filter(s => s.alert_triggered)

  const lastRun: Record<string, { at: string; new: number; status: string }> = {}
  for (const r of runs) {
    if (!lastRun[r.source]) lastRun[r.source] = { at: r.started_at, new: r.events_new ?? 0, status: r.status }
  }

  return (
    <>
      <Masthead />

      {/* Dashboard header */}
      <div style={{ borderBottom: '1px solid var(--color-border-tertiary)', padding: '28px 0 20px', background: 'var(--color-background-primary)' }}>
        <div className="loro-wrap">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
                Intelligence dashboard
              </div>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px,3vw,30px)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.15 }}>
                Payment entity signal landscape
              </h1>
            </div>
            {/* Summary stats */}
            <div style={{ display: 'flex', gap: 1, background: 'var(--color-border-tertiary)' }}>
              {[
                { label: 'Entities', value: scores.length },
                { label: 'Source events', value: totalEvents },
                { label: 'Candidates', value: candidates.length },
                { label: 'Alerts', value: alerts.length },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--color-background-primary)', padding: '10px 18px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1 }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', marginTop: 3, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="loro-wrap" style={{ padding: '32px 0 72px' }}>

        {/* Entity landscape chart */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ height: 3, background: '#1A3A6B', marginBottom: 16 }} />
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>
                Loro payment intelligence
              </div>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>
                Entity signal landscape
              </h2>
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              X axis: Regulatory events (7d) &nbsp;·&nbsp; Y axis: Loro Score &nbsp;·&nbsp; Dot size: signal intensity
            </div>
          </div>
          <EntityLandscape entities={scores} />
          <div style={{ marginTop: 10, fontSize: 10, color: 'var(--color-text-tertiary)' }}>
            Loro Score based on regulatory signals, social sentiment, news momentum and ownership intelligence. Updated daily.
            Velocity data builds after 7+ days of scoring.
          </div>
        </div>

        {/* Score leaders + Candidates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--color-border-tertiary)', marginBottom: 32 }}>

          {/* Score leaders */}
          <div style={{ background: 'var(--color-background-primary)', padding: '22px 24px' }}>
            <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 16 }}>
              Score leaders
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--color-border-tertiary)' }}>
              {topMovers.map((e, rank) => (
                <Link key={e.entity_id} href={`/companies/${e.entity_slug}`}
                  style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 12, padding: '12px 16px', alignItems: 'center', background: 'var(--color-background-primary)', textDecoration: 'none' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                    {rank + 1}
                  </span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                      {e.entity_name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                      {e.jurisdiction}
                      {(e.regulatory_events_7d ?? 0) > 0 && ` · ${e.regulatory_events_7d} events`}
                      {e.insider_direction && e.insider_direction !== 'none' && ` · ${e.insider_direction}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 500, color: e.loro_score >= 50 ? '#A32D2D' : '#1A3A6B', lineHeight: 1 }}>
                      {Math.round(e.loro_score)}
                    </div>
                    {e.score_delta != null && (
                      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: e.score_delta >= 0 ? '#2D7A2D' : '#A32D2D' }}>
                        {e.score_delta > 0 ? '+' : ''}{e.score_delta.toFixed(1)}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
            <Link href="/intelligence" style={{ display: 'block', marginTop: 12, fontSize: 11, color: 'var(--color-text-tertiary)', textDecoration: 'none' }}>
              Intelligence sources
            </Link>
          </div>

          {/* High-signal candidates */}
          <div style={{ background: 'var(--color-background-primary)', padding: '22px 24px' }}>
            <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 16 }}>
              High-signal candidates
            </div>
            {candidates.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
                No high-signal candidates yet. The pattern detector runs every 2 hours.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--color-border-tertiary)' }}>
                {candidates.map((c: {
                  id: string; headline: string; category: string
                  anomaly_score: number | null; editorial_opportunity: string | null
                  novelty_status: string; detected_at: string; status: string
                }) => (
                  <div key={c.id} style={{ background: 'var(--color-background-primary)', padding: '11px 14px', borderLeft: `2px solid ${c.novelty_status === 'novel' ? '#A32D2D' : c.novelty_status === 'lightly_covered' ? '#A16207' : 'var(--color-border-tertiary)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1.4, marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {c.headline}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                          {c.category}
                          {c.editorial_opportunity && ` · ${oppLabel(c.editorial_opportunity)}`}
                          {` · ${timeAgo(c.detected_at)}`}
                        </div>
                      </div>
                      {c.anomaly_score && (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: c.anomaly_score >= 8 ? '#A32D2D' : 'var(--color-text-secondary)', flexShrink: 0 }}>
                          {c.anomaly_score.toFixed(1)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link href="/newsroom" style={{ display: 'block', marginTop: 12, fontSize: 11, color: 'var(--color-text-tertiary)', textDecoration: 'none' }}>
              Open newsroom
            </Link>
          </div>
        </div>

        {/* Source activity */}
        <div>
          <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 14 }}>
            Source activity
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1, background: 'var(--color-border-tertiary)' }}>
            {Object.entries(SOURCE_LABELS).map(([key, label]) => {
              const last = lastRun[key]
              const count = eventsBySource[key] ?? 0
              return (
                <div key={key} style={{ background: 'var(--color-background-primary)', padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: last ? (last.status === 'completed' ? '#2D7A2D' : last.status === 'partial' ? '#A16207' : '#888') : '#333' }} />
                    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)' }}>{label}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 500, color: count > 0 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', lineHeight: 1, marginBottom: 3 }}>
                    {count}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                    {count > 0 ? 'events' : 'no events yet'}
                  </div>
                  {last && (
                    <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                      {timeAgo(last.at)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

      </div>
      <SiteFooter />
    </>
  )
}
