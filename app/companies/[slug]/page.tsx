import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export const revalidate = 300

interface PageProps { params: { slug: string } }

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

async function getEntityData(slug: string) {
  const sb = getSupabase()

  const { data: entity } = await sb
    .from('loro_entities')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!entity) return null

  const [scoreRes, historyRes, candidatesRes, sentimentRes] = await Promise.all([
    sb.from('loro_entity_scores_latest')
      .select('*')
      .eq('entity_id', entity.id)
      .single(),
    sb.from('loro_entity_scores')
      .select('score_date, loro_score, score_delta, regulatory_score, sentiment_score, news_score, ownership_score')
      .eq('entity_id', entity.id)
      .order('score_date', { ascending: false })
      .limit(30),
    sb.from('loro_story_candidates')
      .select('id, headline, anomaly_score, detected_at, editorial_opportunity, novelty_status, status')
      .contains('entity_ids', [entity.id])
      .neq('status', 'discarded')
      .order('anomaly_score', { ascending: false })
      .limit(5),
    sb.from('loro_sentiment_events')
      .select('source, subreddit, title, url, upvotes, sentiment, intensity, posted_at')
      .eq('entity_id', entity.id)
      .not('sentiment', 'is', null)
      .order('posted_at', { ascending: false })
      .limit(6),
  ])

  return {
    entity,
    score: scoreRes.data,
    history: historyRes.data ?? [],
    candidates: candidatesRes.data ?? [],
    sentiment: sentimentRes.data ?? [],
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const data = await getEntityData(params.slug)
  if (!data) return { title: 'Not found' }
  return {
    title: `${data.entity.name} — Loro Payment Intelligence`,
    description: `Loro Payment Intelligence Score and regulatory signals for ${data.entity.name}.`,
  }
}

function ScoreGauge({ score }: { score: number }) {
  const colour = score >= 80 ? '#B33A1A' : score >= 60 ? '#D97706' : score >= 40 ? '#1A3A6B' : '#5A7A8A'
  const label = score >= 80 ? 'High activity' : score >= 60 ? 'Elevated' : score >= 40 ? 'Normal' : 'Quiet'
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <svg width="160" height="90" viewBox="0 0 160 90">
          {/* Background arc */}
          <path d="M 15 85 A 65 65 0 0 1 145 85" fill="none" stroke="#E4E4E4" strokeWidth="10" strokeLinecap="round"/>
          {/* Score arc */}
          <path
            d="M 15 85 A 65 65 0 0 1 145 85"
            fill="none" stroke={colour} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 204} 204`}
          />
          {/* Score text */}
          <text x="80" y="75" textAnchor="middle" fontSize="32" fontWeight="700" fill="#0A0A0A"
            fontFamily="'IBM Plex Mono', monospace">{Math.round(score)}</text>
        </svg>
      </div>
      <div style={{ fontSize: 11, color: colour, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: -8 }}>{label}</div>
    </div>
  )
}

function Sparkline({ history }: { history: Array<{ score_date: string; loro_score: number | null }> }) {
  const points = history.slice().reverse().filter(h => h.loro_score != null)
  if (points.length < 2) return <div style={{ fontSize: 12, color: '#BCBCBC' }}>Building history…</div>
  const scores = points.map(p => p.loro_score as number)
  const min = Math.min(...scores), max = Math.max(...scores)
  const range = max - min || 10
  const w = 300, h = 48
  const pts = scores.map((s, i) => `${(i / (scores.length - 1)) * w},${h - ((s - min) / range) * (h - 8) - 4}`)
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      <polyline points={pts.join(' ')} fill="none" stroke="#1A3A6B" strokeWidth="1.5" strokeLinejoin="round"/>
      {pts.map((pt, i) => {
        const [x, y] = pt.split(',').map(Number)
        return <circle key={i} cx={x} cy={y} r="2" fill="#1A3A6B" opacity="0.5"/>
      })}
    </svg>
  )
}

function SubScoreBar({ label, score, weight, colour = '#1A3A6B' }: { label: string; score: number | null; weight: number; colour?: string }) {
  const s = score ?? 50
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: '#5A5A5A' }}>{label}</span>
        <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: '#8A8A8A' }}>
          {Math.round(s)}/100 <span style={{ opacity: 0.5 }}>·{Math.round(weight * 100)}%</span>
        </span>
      </div>
      <div style={{ height: 4, background: '#F3F1EC', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${s}%`, background: colour, borderRadius: 2, transition: 'width 0.6s ease' }}/>
      </div>
    </div>
  )
}

export default async function CompanyPage({ params }: PageProps) {
  const data = await getEntityData(params.slug)
  if (!data) notFound()
  const { entity, score, history, candidates, sentiment } = data

  const loroScore = score?.loro_score ?? null
  const delta = score?.score_delta ?? null

  return (
    <>
      <Masthead />

      {/* Entity hero */}
      <div style={{ background: '#0A0A0A', borderBottom: '1px solid #1A1A1A', padding: '32px 0' }}>
        <div className="loro-wrap">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#5A5A5A', marginBottom: 8 }}>
                {entity.entity_type} · {entity.jurisdiction}
                {entity.companies_house_id && <span style={{ marginLeft: 12 }}>CH {entity.companies_house_id}</span>}
                {entity.sec_cik && <span style={{ marginLeft: 12 }}>CIK {entity.sec_cik}</span>}
              </div>
              <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 700, color: '#F5F5F4', marginBottom: 8, lineHeight: 1.2 }}>
                {entity.name}
              </h1>
              {loroScore !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: '#5A5A5A', letterSpacing: '0.06em' }}>LORO SCORE</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 28, fontWeight: 700, color: loroScore >= 70 ? '#F59E0B' : '#F5F5F4' }}>
                    {Math.round(loroScore)}
                  </div>
                  {delta !== null && (
                    <div style={{ fontSize: 13, fontFamily: "'IBM Plex Mono', monospace", color: delta >= 0 ? '#4CAF50' : '#F44336', fontWeight: 500 }}>
                      {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
                    </div>
                  )}
                  {score?.score_percentile && (
                    <div style={{ fontSize: 11, color: '#5A5A5A' }}>
                      {Math.round(score.score_percentile)}th percentile
                    </div>
                  )}
                </div>
              )}
            </div>
            {loroScore !== null && <ScoreGauge score={loroScore} />}
          </div>
        </div>
      </div>

      <div className="loro-wrap" style={{ padding: '40px 0 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 40 }}>

          {/* Sub-scores */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A8A8A', marginBottom: 20 }}>
              Score breakdown
            </div>
            {loroScore !== null ? (
              <>
                <SubScoreBar label="Regulatory activity" score={score?.regulatory_score ?? null} weight={0.35} colour="#B33A1A"/>
                <SubScoreBar label="Social sentiment" score={score?.sentiment_score ?? null} weight={0.25} colour="#1A3A6B"/>
                <SubScoreBar label="News momentum" score={score?.news_score ?? null} weight={0.20} colour="#2D7A2D"/>
                <SubScoreBar label="Ownership intelligence" score={score?.ownership_score ?? null} weight={0.15} colour="#7C3AED"/>
                <SubScoreBar label="Market data" score={score?.market_score ?? null} weight={0.05} colour="#5A7A8A"/>
                <div style={{ fontSize: 11, color: '#BCBCBC', marginTop: 8, lineHeight: 1.7 }}>
                  Score updated daily. Normalised against {entity.name}&apos;s own baseline — 
                  50 = normal, 75+ = significantly elevated.
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: '#BCBCBC', padding: '20px 0' }}>
                Score calculating — data is being collected. Check back tomorrow for the first score.
              </div>
            )}
          </div>

          {/* 30-day history */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A8A8A', marginBottom: 20 }}>
              30-day history
            </div>
            <Sparkline history={history}/>
            {score && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 20 }}>
                {[
                  { label: 'Regulatory events (7d)', value: score.regulatory_events_7d ?? '—' },
                  { label: 'Avg anomaly score', value: score.avg_anomaly_score_7d != null ? `${score.avg_anomaly_score_7d}/10` : '—' },
                  { label: 'Sentiment posts (7d)', value: score.sentiment_posts_7d ?? '—' },
                  { label: 'Net sentiment', value: score.sentiment_net_7d != null ? `${(score.sentiment_net_7d * 100).toFixed(0)}%` : '—' },
                  { label: 'News articles (7d)', value: score.news_articles_7d ?? '—' },
                  { label: 'News velocity', value: score.news_velocity != null ? `${score.news_velocity}×` : '—' },
                  { label: 'PDMR events (14d)', value: score.pdmr_events_7d ?? '—' },
                  { label: 'Insider direction', value: score.insider_direction ?? '—' },
                ].map(item => (
                  <div key={item.label} style={{ padding: '10px 14px', background: '#F3F1EC', border: '1px solid #E4E4E4' }}>
                    <div style={{ fontSize: 10, color: '#8A8A8A', marginBottom: 3 }}>{item.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", color: '#0A0A0A' }}>{String(item.value)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Story candidates */}
        {candidates.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A8A8A', marginBottom: 16 }}>
              Recent signals — {candidates.length} story candidate{candidates.length > 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#E4E4E4' }}>
              {candidates.map(c => (
                <div key={c.id} style={{ background: '#FAFAFA', padding: '14px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#0A0A0A', lineHeight: 1.4, marginBottom: 4 }}>{c.headline}</div>
                    <div style={{ fontSize: 11, color: '#8A8A8A' }}>
                      {c.editorial_opportunity?.replace(/_/g,' ')} · {new Date(c.detected_at).toLocaleDateString('en-GB')}
                    </div>
                  </div>
                  {c.anomaly_score && (
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, fontWeight: 700, color: c.anomaly_score >= 8 ? '#B33A1A' : '#5A5A5A', flexShrink: 0 }}>
                      {c.anomaly_score.toFixed(1)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Social sentiment feed */}
        {sentiment.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A8A8A', marginBottom: 16 }}>
              Social sentiment — recent mentions
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#E4E4E4' }}>
              {sentiment.map((s, i) => {
                const sentColour = s.sentiment === 'positive' ? '#2D7A2D' : s.sentiment === 'negative' ? '#B33A1A' : '#5A5A5A'
                return (
                  <div key={i} style={{ background: '#FAFAFA', padding: '12px 20px', borderLeft: `3px solid ${sentColour}` }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 500, color: '#8A8A8A', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        {s.source === 'reddit' ? `r/${s.subreddit}` : 'Hacker News'}
                      </span>
                      <span style={{ fontSize: 10, color: sentColour, fontWeight: 500 }}>{s.sentiment}</span>
                      {s.intensity && <span style={{ fontSize: 10, color: '#BCBCBC' }}>{s.intensity}</span>}
                      <span style={{ fontSize: 10, color: '#BCBCBC', marginLeft: 'auto' }}>
                        ↑{s.upvotes} · {new Date(s.posted_at).toLocaleDateString('en-GB')}
                      </span>
                    </div>
                    {s.url
                      ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#0A0A0A', textDecoration: 'none', lineHeight: 1.4 }}>{s.title}</a>
                      : <div style={{ fontSize: 13, color: '#0A0A0A', lineHeight: 1.4 }}>{s.title}</div>
                    }
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Subscriber gate notice */}
        <div style={{ marginTop: 40, padding: '20px 24px', background: '#F3F1EC', border: '1px solid #E4E4E4', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#0A0A0A', marginBottom: 4 }}>
              Loro score alerts for {entity.name}
            </div>
            <div style={{ fontSize: 12, color: '#8A8A8A' }}>
              Get notified when the Loro Score moves more than 10 points — the signal that precedes editorial coverage.
            </div>
          </div>
          <a href="/subscribe" style={{ padding: '8px 20px', background: '#1A3A6B', color: '#FFF', fontSize: 12, fontWeight: 500, textDecoration: 'none', whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>
            Subscribe to alerts
          </a>
        </div>
      </div>

      <SiteFooter />
    </>
  )
}
