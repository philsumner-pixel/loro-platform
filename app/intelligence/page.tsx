import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Intelligence Sources — Loro',
  description: 'The data infrastructure behind Loro payments intelligence. Connected regulatory sources, monitoring coverage, and roadmap.',
}

export const revalidate = 300 // refresh every 5 minutes

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

async function getSourceData() {
  const sb = getSupabase()

  const [runsRes, eventsRes, coverageRes, candidatesRes] = await Promise.all([
    sb.from('loro_ingest_runs')
      .select('source, status, events_new, events_found, started_at, errors')
      .order('started_at', { ascending: false })
      .limit(100),
    sb.from('loro_source_events')
      .select('source')
      .then(r => r),
    sb.from('loro_news_coverage')
      .select('publication, ingested_at')
      .order('ingested_at', { ascending: false }),
    sb.from('loro_story_candidates')
      .select('status, anomaly_score, detected_at')
      .not('status', 'eq', 'discarded'),
  ])

  // Aggregate events by source
  const eventsBySource: Record<string, number> = {}
  for (const evt of eventsRes.data ?? []) {
    eventsBySource[evt.source] = (eventsBySource[evt.source] ?? 0) + 1
  }

  // Last successful run per source
  const lastRun: Record<string, { at: string; found: number; status: string }> = {}
  for (const run of runsRes.data ?? []) {
    if (!lastRun[run.source]) {
      lastRun[run.source] = {
        at: run.started_at,
        found: run.events_found ?? 0,
        status: run.status,
      }
    }
  }

  // News coverage by publication
  const pubCounts: Record<string, number> = {}
  for (const item of coverageRes.data ?? []) {
    pubCounts[item.publication] = (pubCounts[item.publication] ?? 0) + 1
  }

  return {
    eventsBySource,
    lastRun,
    pubCounts,
    totalEvents: eventsRes.data?.length ?? 0,
    totalCoverage: coverageRes.data?.length ?? 0,
    totalCandidates: candidatesRes.data?.length ?? 0,
    highScoreCandidates: candidatesRes.data?.filter(c => (c.anomaly_score ?? 0) >= 8).length ?? 0,
    lastUpdated: new Date().toISOString(),
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (d > 1) return `${d} days ago`
  if (d === 1) return 'Yesterday'
  if (h > 0) return `${h}h ago`
  return 'Just now'
}

interface Source {
  id: string
  name: string
  jurisdiction: string
  type: string
  description: string
  status: 'live' | 'building' | 'roadmap'
  frequency?: string
  dataKey?: string
  url?: string
  editorial_value: 'critical' | 'high' | 'medium'
}

// Sources are read from loro_source_registry rather than hardcoded here.
// The previous hardcoded list went stale within days — it still advertised
// sec_form4, sec_8k and bis_statistics as live after they were retired or
// paused, and knew nothing about the eight sources connected since. Anything
// connected now appears here automatically.
async function getRegistrySources(): Promise<Source[]> {
  try {
    const sb = getSupabase()
    const { data } = await sb.rpc('loro_source_health')

    interface H {
      slug: string; label: string; publisher: string | null
      lane_slug: string | null; jurisdiction: string | null
      source_url: string | null; licence: string | null; description: string | null
      status: string; events_total: number
    }

    return ((data ?? []) as H[]).map(h => ({
      id: h.slug,
      name: h.label,
      jurisdiction: h.jurisdiction ?? 'INTL',
      type: LANE_TYPE[h.lane_slug ?? ''] ?? 'Intelligence',
      // Registry health maps onto the page's own vocabulary: anything actively
      // collecting reads as live; paused sources are shown honestly rather
      // than hidden, because a retired source is part of the story.
      status: h.status === 'paused' ? 'building'
            : h.status === 'never run' ? 'building'
            : 'live',
      frequency: h.status === 'paused' ? 'Paused' : undefined,
      dataKey: h.slug,
      editorial_value: h.events_total > 500 ? 'critical'
                     : h.events_total > 50 ? 'high' : 'medium',
      description: [
        h.description,
        h.publisher ? `Published by ${h.publisher}.` : null,
        h.licence ? `Licence: ${h.licence}.` : null,
      ].filter(Boolean).join(' '),
      url: h.source_url ?? undefined,
    }))
  } catch {
    return []
  }
}

const JURISDICTION_LABELS: Record<string, string> = {
  GB: 'United Kingdom', UK: 'United Kingdom', US: 'United States',
  EU: 'European Union', INTL: 'International',
}

const LANE_TYPE: Record<string, string> = {
  'ownership-control': 'Ownership Intelligence',
  'regulation-enforcement': 'Regulatory Intelligence',
  'money-markets': 'Market Intelligence',
  'policy-politics': 'Political Intelligence',
  'energy-sustainability': 'Energy Intelligence',
  'technology-infrastructure': 'Technology Intelligence',
}

// Still-to-connect sources, kept as a deliberate roadmap. These are named
// targets rather than aspirations — each has a known, free, structured feed.
const ROADMAP: Source[] = [
  { id: 'land_registry', name: 'HM Land Registry — Overseas Ownership', jurisdiction: 'GB',
    type: 'Ownership Intelligence', status: 'roadmap', frequency: 'Monthly',
    editorial_value: 'high',
    description: 'Overseas companies owning UK property. Joins to the donor and contractor company numbers Loro already holds.' },
  { id: 'charity_commission', name: 'Charity Commission — Trustees', jurisdiction: 'GB',
    type: 'Ownership Intelligence', status: 'roadmap', frequency: 'Weekly',
    editorial_value: 'medium',
    description: 'Charity trustees and linked charities, cross-referenceable with Companies House officers to surface trustee/director crossover.' },
  { id: 'insolvency', name: 'Insolvency Register', jurisdiction: 'GB',
    type: 'Regulatory Intelligence', status: 'roadmap', frequency: 'Daily',
    editorial_value: 'high',
    description: 'Company insolvencies and director disqualifications, joining on company number to the existing entity graph.' },
  { id: 'hansard', name: 'Hansard — Parliamentary Debates', jurisdiction: 'GB',
    type: 'Political Intelligence', status: 'roadmap', frequency: 'Daily',
    editorial_value: 'high',
    description: 'Full debate transcripts, letting declared interests and donations be checked against what a member actually said.' },
  { id: 'lobbying', name: 'Register of Consultant Lobbyists', jurisdiction: 'GB',
    type: 'Political Intelligence', status: 'roadmap', frequency: 'Monthly',
    editorial_value: 'medium',
    description: 'Declared lobbying activity, completing the influence picture alongside donations and interests.' },
  { id: 'icij', name: 'ICIJ Offshore Leaks', jurisdiction: 'INTL',
    type: 'Ownership Intelligence', status: 'roadmap', frequency: 'On publication',
    editorial_value: 'medium',
    description: 'Panama, Pandora and FinCEN datasets for offshore structures behind UK and US entities.' },
]

const STATUS_LABEL: Record<string, string> = {
  live: 'Live', building: 'Building', roadmap: 'Roadmap',
}

export default async function IntelligencePage() {
  const [data, registrySources] = await Promise.all([getSourceData(), getRegistrySources()])
  const liveSources = registrySources.filter(s => s.status === 'live')
  const buildingSources = registrySources.filter(s => s.status === 'building')
  const roadmapSources = ROADMAP

  return (
    <>
      <Masthead />

      {/* Signal Core — the live source map. Hero above, structured detail
          below: the graph does the immediate comprehension, the text carries
          the licence, cadence and provenance that make it credible — and stays
          crawlable, which the canvas is not. */}
      <section aria-label="Live source map">
        <iframe
          src="/signal-core.html"
          title="Loro Signal Core — live map of connected primary sources"
          loading="lazy"
          style={{
            display: 'block', width: '100%', height: 'min(78vh, 720px)',
            border: 0, background: '#060910',
          }}
        />
        <div className="loro-wrap" style={{ padding: '10px 0 0' }}>
          <p style={{ fontSize: 12, color: 'var(--ink5)', lineHeight: 1.6, margin: 0 }}>
            Live map of the registers currently feeding the engine, drawn from the same
            source registry as the detail below. Connect a source and it appears here.
            {' '}<a href="/signal-core.html" style={{ color: 'var(--blue-mid, #2C5AA0)' }}>Open full screen →</a>
          </p>
        </div>
      </section>

      <div className="loro-wrap" style={{ padding: '48px 0 80px' }}>

        {/* Header */}
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 32, marginBottom: 40 }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink5)', marginBottom: 12 }}>
            Intelligence Infrastructure
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.15, marginBottom: 16 }}>
            Loro Intelligence Sources
          </h1>
          <p style={{ fontSize: 15, color: 'var(--ink4)', lineHeight: 1.75, maxWidth: 640, marginBottom: 24 }}>
            Every signal in Loro&apos;s newsroom is generated from primary regulatory and market data sources. 
            This document shows what is connected, how it runs, and what is coming next.
          </p>

          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
            {[
              { label: 'Active sources', value: liveSources.length },
              { label: 'Source events', value: data.totalEvents.toLocaleString() },
              { label: 'News articles', value: data.totalCoverage.toLocaleString() },
              { label: 'Story candidates', value: data.totalCandidates },
              { label: 'High-signal (≥8.0)', value: data.highScoreCandidates },
            ].map(stat => (
              <div key={stat.label} style={{ background: 'var(--bg)', padding: '16px 20px' }}>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink)', lineHeight: 1 }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink5)', marginTop: 4, letterSpacing: '0.02em' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Live sources */}
        <section style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2D7A2D', animation: 'pulse 2s infinite' }} />
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>
              Live — {liveSources.length} sources active
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--border)' }}>
            {liveSources.map(source => {
              const last = data.lastRun[source.dataKey ?? source.id]
              const count = data.eventsBySource[source.dataKey ?? source.id] ?? 0
              return (
                <div key={source.id} style={{ background: 'var(--bg)', padding: '20px 24px', borderLeft: `3px solid ${source.editorial_value === 'critical' ? '#1A3A6B' : source.editorial_value === 'high' ? '#2D7A2D' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{source.name}</span>
                        <span style={{ fontSize: 10, padding: '2px 8px', background: '#F0FAF0', color: '#2D7A2D', border: '1px solid #C8E6C8', borderRadius: 2, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Live</span>
                        <span style={{ fontSize: 10, padding: '2px 8px', background: 'var(--paper2)', color: 'var(--ink5)', border: '1px solid var(--border)', borderRadius: 2 }}>
                          {JURISDICTION_LABELS[source.jurisdiction] ?? source.jurisdiction}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--ink5)', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 2 }}>{source.type}</span>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.65, maxWidth: 680 }}>{source.description}</p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--ink)', lineHeight: 1 }}>{count}</div>
                      <div style={{ fontSize: 10, color: 'var(--ink5)', marginTop: 2 }}>events</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--ink5)' }}>
                    <span>⏱ {source.frequency}</span>
                    {last && <span>Last run: {timeAgo(last.at)} · {last.found} found</span>}
                    {source.url && <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--loro-lapis)', textDecoration: 'none' }}>Source →</a>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* News monitoring publications */}
        <section style={{ marginBottom: 48 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink5)', marginBottom: 14 }}>
            Monitored Publications — {Object.keys(data.pubCounts).length} active
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1, background: 'var(--border)' }}>
            {Object.entries(data.pubCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([pub, count]) => (
                <div key={pub} style={{ background: 'var(--bg)', padding: '12px 16px' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>{pub}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink5)' }}>{count} articles indexed</div>
                </div>
              ))
            }
          </div>
        </section>

        {/* Building */}
        {buildingSources.length > 0 && (
          <section style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ width: 8, height: 8, borderRadius: 1, background: '#A16207' }} />
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>
                Building — {buildingSources.length} sources in development
              </h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--border)' }}>
              {buildingSources.map(source => (
                <div key={source.id} style={{ background: 'var(--bg)', padding: '20px 24px', opacity: 0.9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{source.name}</span>
                    <span style={{ fontSize: 10, padding: '2px 8px', background: '#FEF9C3', color: '#A16207', border: '1px solid #FDE68A', borderRadius: 2, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Building</span>
                    <span style={{ fontSize: 10, color: 'var(--ink5)', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 2 }}>{source.type}</span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.65, maxWidth: 680, marginBottom: 8 }}>{source.description}</p>
                  {source.frequency && <span style={{ fontSize: 11, color: 'var(--ink5)' }}>⏱ {source.frequency}</span>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Roadmap */}
        <section style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 8, height: 8, borderRadius: 1, background: 'var(--ink5)' }} />
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>
              Roadmap — {roadmapSources.length} sources planned
            </h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--border)' }}>
            {roadmapSources.map(source => (
              <div key={source.id} style={{ background: 'var(--bg)', padding: '20px 24px', opacity: 0.75 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{source.name}</span>
                  {source.editorial_value === 'critical' && (
                    <span style={{ fontSize: 10, padding: '2px 8px', background: 'var(--paper2)', color: 'var(--ink4)', border: '1px solid var(--border)', borderRadius: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Roadmap</span>
                  )}
                  <span style={{ fontSize: 10, color: 'var(--ink5)', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 2 }}>
                    {JURISDICTION_LABELS[source.jurisdiction] ?? source.jurisdiction}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--ink5)', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 2 }}>{source.type}</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.65, maxWidth: 680, marginBottom: 6 }}>{source.description}</p>
                {source.frequency && <span style={{ fontSize: 11, color: 'var(--ink5)' }}>⏱ {source.frequency}</span>}
              </div>
            ))}
          </div>
        </section>

        {/* Methodology note */}
        <div style={{ padding: '24px 28px', background: 'var(--paper2)', borderLeft: '3px solid var(--loro-lapis)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--loro-lapis)', marginBottom: 8 }}>
            How Loro&apos;s intelligence engine works
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink4)', lineHeight: 1.75, maxWidth: 720, margin: 0 }}>
            Each source event is stored, embedded as a 1,536-dimension semantic vector using OpenAI text-embedding-3-small, and passed through Loro&apos;s pattern detection engine. 
            Patterns are scored on a 0–10 anomaly scale weighted by event count, source diversity, cross-jurisdictional signals (UK + EU + US = maximum score), entity type (EMI/bank/listed) and temporal compression. 
            Candidates generated by the pattern engine are then checked across three novelty layers: Loro&apos;s internal article corpus, the live news monitoring corpus, and a point-in-time web search. 
            The result appears in Chris&apos;s newsroom queue within two hours of the triggering regulatory event.
          </p>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink5)' }}>
            Updated every 5 minutes · Data sourced from primary regulatory APIs and public filings · No data is sold or shared
          </div>
        </div>

      </div>

      <SiteFooter />
    </>
  )
}
