import { createClient } from '@supabase/supabase-js'
import type { Metadata } from 'next'
import TickerStrip from '@/components/TickerStrip'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'
import LaneNav from '@/components/LaneNav'

// Public source diagnostics.
//
// Three audiences, one page: readers and answer engines see provenance —
// exactly which primary registers Loro reads, under what licence; investors
// see the pipeline is real and instrumented; and editorially it's the
// integrity check on the semantic engine, because a silent source means the
// corpus is quietly going stale.

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Sources — Loro',
  description:
    'Every primary source Loro reads, its publisher and licence, when it last delivered, and how much it has contributed. Published openly because provenance is the product.',
}

interface Health {
  slug: string; label: string; publisher: string | null
  lane_slug: string | null; jurisdiction: string | null
  source_url: string | null; licence: string | null; description: string | null
  status: string; last_run: string | null; hours_since: number | null
  runs_24h: number; failures_24h: number; failure_rate: number | null
  events_7d: number; events_total: number
}

const STATUS_COPY: Record<string, { label: string; tone: string; help: string }> = {
  healthy:    { label: 'Live',      tone: 'ok',   help: 'Collecting normally' },
  quiet:      { label: 'Quiet',     tone: 'warn', help: 'Running, but nothing new this week' },
  failing:    { label: 'Failing',   tone: 'bad',  help: 'Most recent attempts errored' },
  silent:     { label: 'Silent',    tone: 'bad',  help: 'Has not run when it should have' },
  'never run':{ label: 'Not yet',   tone: 'idle', help: 'Connected but not yet collected' },
  paused:     { label: 'Paused',    tone: 'idle', help: 'Deliberately disabled' },
}

interface Stage {
  stage: string; pending: number; done: number
  pct_done: number | null; status: string
}

async function getStages(): Promise<Stage[]> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data } = await sb.rpc('loro_pipeline_stages')
    return (data ?? []) as Stage[]
  } catch {
    return []
  }
}

async function getHealth(): Promise<Health[]> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data } = await sb.rpc('loro_source_health')
    return (data ?? []) as Health[]
  } catch {
    return []
  }
}

function ago(hours: number | null): string {
  if (hours == null) return '—'
  if (hours < 1) return `${Math.round(hours * 60)} min ago`
  if (hours < 48) return `${Math.round(hours)} hours ago`
  return `${Math.round(hours / 24)} days ago`
}

export default async function SourcesPage() {
  const [health, stages] = await Promise.all([getHealth(), getStages()])
  const live = health.filter(h => h.status === 'healthy').length
  const totalEvents = health.reduce((n, h) => n + Number(h.events_total || 0), 0)
  const week = health.reduce((n, h) => n + Number(h.events_7d || 0), 0)

  return (
    <>
      <TickerStrip />
      <Masthead />
      <LaneNav />

      <main className="loro-sources">
        <header className="loro-sources-head">
          <h1>Sources</h1>
          <p>
            Loro is built on primary records — the filings, registers and disclosures
            that are published but rarely read. This page shows every source we read,
            who publishes it, under what licence, and whether it is currently
            delivering. We publish it openly because provenance is the product.
          </p>
        </header>

        <div className="loro-sources-stats">
          <div><span className="n">{health.length}</span><span className="k">Sources connected</span></div>
          <div><span className="n">{live}</span><span className="k">Collecting now</span></div>
          <div><span className="n">{week.toLocaleString()}</span><span className="k">Records this week</span></div>
          <div><span className="n">{totalEvents.toLocaleString()}</span><span className="k">Records held</span></div>
        </div>

        {stages.length > 0 && (
          <section className="loro-pipeline">
            <h2>Processing pipeline</h2>
            <p>
              Collecting a record is only the first step. Each stage below turns raw
              filings into something the engine can reason over. We show the backlogs
              because a stage falling behind is how a corpus quietly goes stale while
              every source still reports as live.
            </p>
            <div className="loro-pipeline-grid">
              {stages.map(st => (
                <div key={st.stage} className={`loro-stage ${st.status}`}>
                  <div className="loro-stage-top">
                    <span className="name">{st.stage}</span>
                    <span className={`badge ${st.status}`}>{st.status}</span>
                  </div>
                  <div className="loro-stage-bar">
                    <span style={{ width: `${st.pct_done ?? 0}%` }} />
                  </div>
                  <div className="loro-stage-meta">
                    {Number(st.done).toLocaleString()} processed
                    {st.pending > 0 && ` · ${Number(st.pending).toLocaleString()} queued`}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {health.length === 0 ? (
          <p className="loro-sources-empty">Source status is temporarily unavailable.</p>
        ) : (
          <div className="loro-sources-list">
            {health.map(h => {
              const s = STATUS_COPY[h.status] ?? { label: h.status, tone: 'idle', help: '' }
              return (
                <article key={h.slug} className="loro-source">
                  <div className="loro-source-top">
                    <div>
                      <h2>{h.label}</h2>
                      <div className="loro-source-pub">
                        {h.publisher}
                        {h.jurisdiction ? ` · ${h.jurisdiction}` : ''}
                        {h.licence ? ` · ${h.licence}` : ''}
                      </div>
                    </div>
                    <span className={`loro-source-status ${s.tone}`} title={s.help}>
                      {s.label}
                    </span>
                  </div>

                  {h.description && <p className="loro-source-desc">{h.description}</p>}

                  <dl className="loro-source-metrics">
                    <div><dt>Last collected</dt><dd>{ago(h.hours_since)}</dd></div>
                    <div><dt>Checks (24h)</dt><dd>{h.runs_24h}</dd></div>
                    <div><dt>New records (7d)</dt><dd>{Number(h.events_7d).toLocaleString()}</dd></div>
                    <div><dt>Total held</dt><dd>{Number(h.events_total).toLocaleString()}</dd></div>
                  </dl>

                  {h.source_url && (
                    <a className="loro-source-link" href={h.source_url} target="_blank" rel="noopener nofollow">
                      Publisher&rsquo;s data service &rarr;
                    </a>
                  )}
                </article>
              )
            })}
          </div>
        )}

        <section className="loro-sources-note">
          <h3>How to read this</h3>
          <p>
            <strong>Live</strong> means the source is being checked on schedule and
            delivering. <strong>Quiet</strong> means it is being checked and working,
            but the register itself has published nothing new — normal for sources that
            report in bursts. <strong>Failing</strong> or <strong>Silent</strong> means
            we have a collection problem, and we would rather show that than hide it:
            a source that stops without anyone noticing is how an intelligence product
            quietly goes stale.
          </p>
        </section>
      </main>

      <SiteFooter />
    </>
  )
}
