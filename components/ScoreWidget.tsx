import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

export const revalidate = 300

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

async function getTopScores() {
  const sb = getSupabase()
  const { data } = await sb
    .from('loro_entity_scores_latest')
    .select('entity_name, entity_slug, loro_score, score_delta, insider_direction, pdmr_events_7d, regulatory_events_7d')
    .not('loro_score', 'is', null)
    .order('loro_score', { ascending: false })
    .limit(5)
  return data ?? []
}

function scoreColour(score: number): string {
  if (score >= 80) return '#B33A1A'
  if (score >= 65) return '#D97706'
  if (score >= 50) return '#1A3A6B'
  return '#8A8A8A'
}

export default async function ScoreWidget() {
  const scores = await getTopScores()
  if (!scores.length) return null

  return (
    <div className="loro-section-wrap" style={{ marginTop: 32 }}>
      <div className="loro-section-hd" style={{ marginBottom: 1 }}>
        <span className="loro-section-title">Intelligence signals</span>
        <Link href="/intelligence" className="loro-section-link">
          All sources →
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1, background: 'var(--border)' }}>
        {scores.map((s: {
          entity_name: string; entity_slug: string; loro_score: number | null
          score_delta: number | null; insider_direction: string | null
          pdmr_events_7d: number | null; regulatory_events_7d: number | null
        }) => {
          const score = s.loro_score ?? 0
          const delta = s.score_delta
          const colour = scoreColour(score)
          return (
            <Link
              key={s.entity_slug}
              href={`/companies/${s.entity_slug}`}
              style={{ textDecoration: 'none', display: 'block', background: 'var(--bg)', padding: '16px 18px', borderTop: `2px solid ${colour}` }}
            >
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink)', marginBottom: 6, lineHeight: 1.3 }}>
                {s.entity_name}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 24, fontWeight: 700, color: colour, lineHeight: 1 }}>
                  {Math.round(score)}
                </span>
                {delta !== null && (
                  <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: delta >= 0 ? '#2D7A2D' : '#B33A1A', fontWeight: 500 }}>
                    {delta >= 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(1)}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(s.regulatory_events_7d ?? 0) > 0 && (
                  <span style={{ fontSize: 9, color: 'var(--ink5)', padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 10 }}>
                    {s.regulatory_events_7d} events
                  </span>
                )}
                {s.insider_direction && s.insider_direction !== 'none' && (
                  <span style={{ fontSize: 9, color: 'var(--ink5)', padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 10 }}>
                    {s.insider_direction}
                  </span>
                )}
              </div>
            </Link>
          )
        })}
      </div>

      <div style={{ padding: '10px 0', fontSize: 10, color: 'var(--ink5)', letterSpacing: '0.04em' }}>
        Loro Payment Intelligence Score — updated daily · <Link href="/intelligence" style={{ color: 'var(--ink5)' }}>About the score →</Link>
      </div>
    </div>
  )
}
