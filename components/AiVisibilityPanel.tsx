'use client'

import { useEffect, useState } from 'react'

// AI visibility dashboard.
//
// Structured around the diagnosis, not a score:
//   never crawled + not cited = access problem (robots, rendering, gating)
//   crawled + not cited       = content problem (retrievable, not quotable)
//   crawled + cited           = win
//
// Share of voice is deliberately prominent: knowing WHO owns the answers on
// our beat is more actionable than knowing our own percentage.

interface Totals {
  bot_hits: number; live_fetches: number; distinct_bots: number
  articles_in_window: number; articles_crawled: number
  articles_never_crawled: number; median_hours_to_first_crawl: number | null
}
interface Sov { domain: string; citations: number; share_pct: number; prompts_appeared: number }
interface CiteDay { day: string; probes: number; cited: number; citation_rate: number | null }
interface LanePerf { lane_slug: string; probes: number; cited: number; citation_rate: number | null; articles: number }
interface ArticlePerf {
  slug: string; headline: string; published_at: string; lane_slug: string | null
  citation_count: number; key_fact_count: number
  has_answer_block: boolean; has_lead_image: boolean
  bots_seen: number; live_fetches: number; hours_to_first_crawl: number | null
}
interface BotRow { bot: string; hits: number; live: number; last: string }
interface Payload {
  totals: Totals; by_bot: BotRow[]; share_of_voice: Sov[]
  citation_timeseries: CiteDay[]; lane_performance: LanePerf[]
  article_performance: ArticlePerf[]
  never_crawled: Array<{ slug: string; headline: string; published_at: string }>
}

const LANE_LABEL: Record<string, string> = {
  'ownership-control': 'Ownership & Control',
  'regulation-enforcement': 'Regulation & Enforcement',
  'money-markets': 'Money & Markets',
  'policy-politics': 'Policy & Politics',
  'energy-sustainability': 'Energy & Sustainability',
  'technology-infrastructure': 'Technology & Infrastructure',
  unassigned: 'Unassigned',
}

export default function AiVisibilityPanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ai-visibility?days=${days}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [days])

  if (loading) return <div className="loro-nr-empty">Loading visibility data…</div>
  if (!data) return <div className="loro-nr-empty">Couldn&apos;t load visibility data.</div>

  const t = data.totals
  const ourShare = data.share_of_voice.find(s =>
    s.domain.includes('loro')
  )

  return (
    <div className="loro-aiv">
      <div className="loro-aiv-head">
        <div>
          <h2>AI visibility</h2>
          <p>
            Whether answer engines are reading Loro, and whether they cite it.
            Read as a trend — a single run is noise, since 40–60% of cited
            sources change month to month.
          </p>
        </div>
        <div className="loro-aiv-range">
          {[7, 30, 90].map(d => (
            <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Headline numbers */}
      <div className="loro-aiv-stats">
        <div className="stat">
          <div className="n">{t.bot_hits.toLocaleString()}</div>
          <div className="k">Crawler hits</div>
        </div>
        <div className="stat">
          <div className="n">{t.live_fetches.toLocaleString()}</div>
          <div className="k">Live fetches</div>
          <div className="h">Someone asked a question and an engine fetched us</div>
        </div>
        <div className="stat">
          <div className="n">{t.distinct_bots}</div>
          <div className="k">Engines seen</div>
        </div>
        <div className="stat">
          <div className="n">
            {t.median_hours_to_first_crawl != null ? `${t.median_hours_to_first_crawl}h` : '—'}
          </div>
          <div className="k">Median time to first crawl</div>
        </div>
        <div className={`stat${t.articles_never_crawled ? ' warn' : ''}`}>
          <div className="n">{t.articles_never_crawled}</div>
          <div className="k">Never crawled</div>
          <div className="h">Published but no engine has fetched them</div>
        </div>
        <div className="stat">
          <div className="n">{ourShare ? `${ourShare.share_pct}%` : '0%'}</div>
          <div className="k">Our share of voice</div>
        </div>
      </div>

      {/* Diagnosis — the point of having both feeds */}
      <div className="loro-aiv-diagnosis">
        <div className="dx">
          <span className="lbl access">Access problem</span>
          <span className="v">{t.articles_never_crawled}</span>
          <span className="d">Never crawled — check robots, rendering, gating, internal links</span>
        </div>
        <div className="dx">
          <span className="lbl content">Content problem</span>
          <span className="v">{Math.max(0, t.articles_crawled - (ourShare?.citations ?? 0))}</span>
          <span className="d">Crawled but not cited — retrievable, not quotable. Add figures, named sources, an answer block</span>
        </div>
        <div className="dx">
          <span className="lbl win">Winning</span>
          <span className="v">{ourShare?.citations ?? 0}</span>
          <span className="d">Cited — capture what these had and repeat it</span>
        </div>
      </div>

      {/* Share of voice */}
      <section>
        <h3>Who owns the answers on our beat</h3>
        <p className="sub">
          Every domain cited in response to our probe questions. This is the
          competitive set — and the gap to attack.
        </p>
        {data.share_of_voice.length === 0 ? (
          <div className="loro-nr-empty">No probe data yet.</div>
        ) : (
          <div className="loro-aiv-sov">
            {data.share_of_voice.map(s => (
              <div key={s.domain} className={`row${s.domain.includes('loro') ? ' us' : ''}`}>
                <span className="dom">{s.domain}</span>
                <span className="bar"><span style={{ width: `${Math.min(100, s.share_pct * 3)}%` }} /></span>
                <span className="pct">{s.share_pct}%</span>
                <span className="cnt">{s.citations} citations · {s.prompts_appeared} questions</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Citation trend */}
      <section>
        <h3>Citation rate over time</h3>
        {data.citation_timeseries.length === 0 ? (
          <div className="loro-nr-empty">No probes recorded yet. The daily probe runs at 07:00.</div>
        ) : (
          <table className="loro-aiv-table">
            <thead><tr><th>Date</th><th className="num">Probes</th><th className="num">Cited</th><th className="num">Rate</th></tr></thead>
            <tbody>
              {data.citation_timeseries.slice(0, 14).map(d => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td className="num">{d.probes}</td>
                  <td className="num">{d.cited}</td>
                  <td className="num">{d.citation_rate ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Per-lane */}
      <section>
        <h3>By lane</h3>
        {data.lane_performance.length === 0 ? (
          <div className="loro-nr-empty">No lane data yet.</div>
        ) : (
          <table className="loro-aiv-table">
            <thead><tr><th>Lane</th><th className="num">Articles</th><th className="num">Probes</th><th className="num">Cited</th><th className="num">Rate</th></tr></thead>
            <tbody>
              {data.lane_performance.map(l => (
                <tr key={l.lane_slug}>
                  <td>{LANE_LABEL[l.lane_slug] ?? l.lane_slug}</td>
                  <td className="num">{l.articles}</td>
                  <td className="num">{l.probes}</td>
                  <td className="num">{l.cited}</td>
                  <td className="num">{l.citation_rate ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Attribution — what's working */}
      <section>
        <h3>What&apos;s working</h3>
        <p className="sub">
          Article features against crawl outcome. Over time this shows whether
          answer blocks, source citations and key facts actually earn attention.
        </p>
        {data.article_performance.length === 0 ? (
          <div className="loro-nr-empty">No published articles in this window.</div>
        ) : (
          <table className="loro-aiv-table">
            <thead>
              <tr>
                <th>Article</th>
                <th className="num">Sources</th>
                <th className="num">Facts</th>
                <th className="num">Answer</th>
                <th className="num">Engines</th>
                <th className="num">Live</th>
                <th className="num">Hrs to crawl</th>
              </tr>
            </thead>
            <tbody>
              {data.article_performance.slice(0, 25).map(a => (
                <tr key={a.slug}>
                  <td className="hl">{a.headline}</td>
                  <td className="num">{a.citation_count}</td>
                  <td className="num">{a.key_fact_count}</td>
                  <td className="num">{a.has_answer_block ? '✓' : '—'}</td>
                  <td className="num">{a.bots_seen}</td>
                  <td className="num">{a.live_fetches}</td>
                  <td className="num">{a.hours_to_first_crawl ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Action list */}
      {data.never_crawled.length > 0 && (
        <section>
          <h3>Published but never crawled</h3>
          <p className="sub">The action list. If an engine has never fetched it, it can never cite it.</p>
          <ul className="loro-aiv-list">
            {data.never_crawled.map(a => (
              <li key={a.slug}>
                <a href={`/news/${a.slug}`} target="_blank" rel="noopener">{a.headline}</a>
                <span>{new Date(a.published_at).toLocaleDateString('en-GB')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Per-engine */}
      <section>
        <h3>By engine</h3>
        {data.by_bot.length === 0 ? (
          <div className="loro-nr-empty">No crawler activity recorded yet.</div>
        ) : (
          <table className="loro-aiv-table">
            <thead><tr><th>Engine</th><th className="num">Hits</th><th className="num">Live fetches</th><th>Last seen</th></tr></thead>
            <tbody>
              {data.by_bot.map(b => (
                <tr key={b.bot}>
                  <td>{b.bot}</td>
                  <td className="num">{b.hits}</td>
                  <td className="num">{b.live}</td>
                  <td>{new Date(b.last).toLocaleString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
