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

const SOURCES: Source[] = [
  // ── Live sources ────────────────────────────────────────────────────
  {
    id: 'fca_pdmr', name: 'FCA / RNS — PDMR Notifications', jurisdiction: 'GB',
    type: 'Ownership Intelligence', status: 'live', frequency: 'Every 15 minutes',
    dataKey: 'fca_pdmr', editorial_value: 'critical',
    description: 'UK MAR Article 19 PDMR and director shareholding notifications filed via Primary Information Providers (RNS, EQS). Parsed to extract person, role, transaction type, shares, price. The primary source for UK ownership intelligence exclusives.',
    url: 'https://www.investegate.co.uk/category/directors-dealings',
  },
  {
    id: 'sec_form4', name: 'SEC EDGAR — Form 4 Insider Trades', jurisdiction: 'US',
    type: 'Ownership Intelligence', status: 'live', frequency: 'Every 30 minutes',
    dataKey: 'sec_form4', editorial_value: 'critical',
    description: 'US SEC mandatory insider trade disclosures for 10 core payments companies including PayPal, Visa, Mastercard, Block, Adyen. Cross-referenced with PDMR data for cross-Atlantic ownership intelligence signals.',
    url: 'https://www.sec.gov/cgi-bin/browse-edgar',
  },
  {
    id: 'sec_8k', name: 'SEC EDGAR — Form 8-K Material Events', jurisdiction: 'US',
    type: 'Corporate Intelligence', status: 'live', frequency: 'Every 30 minutes',
    dataKey: 'sec_8k', editorial_value: 'high',
    description: 'Material event disclosures from US-listed payments companies. Item 1.01 (material agreements), 5.02 (director changes), 8.01 (other events). Combined with Form 4 data to detect pre-announcement patterns.',
    url: 'https://efts.sec.gov/LATEST/search-index',
  },
  {
    id: 'companies_house', name: 'Companies House — UK Filing Registry', jurisdiction: 'GB',
    type: 'Corporate Intelligence', status: 'live', frequency: 'Every hour',
    dataKey: 'companies_house', editorial_value: 'high',
    description: 'Director appointments (AP01), terminations (TM01), share allotments (SH01), PSC changes (PSC04/RP01) and registered office changes for 20 UK payment institutions and fintechs. High-signal filings flagged for pattern detection.',
    url: 'https://developer.company-information.service.gov.uk',
  },
  {
    id: 'rss_monitoring', name: 'RSS News Monitoring', jurisdiction: 'INTL',
    type: 'News Intelligence', status: 'live', frequency: 'Every 15 minutes',
    dataKey: 'rss_monitoring', editorial_value: 'high',
    description: 'Live monitoring of 10 payments and fintech publications including Finextra, Reuters Technology, TechCrunch Fintech, PYMNTS, Sifted, AltFi, The Paypers, CityAM. Feeds the three-layer novelty checking engine.',
    url: 'https://www.finextra.com/rss',
  },
  {
    id: 'bis_statistics', name: 'BIS / ECB — Market Data', jurisdiction: 'INTL',
    type: 'Market Intelligence', status: 'live', frequency: 'Daily at 06:00 UTC',
    dataKey: 'bis_statistics', editorial_value: 'medium',
    description: 'Bank for International Settlements effective exchange rates (SDMX REST API) and ECB SEPA payment statistics and FX reference rates. Provides market data baseline for FX corridor and payment volume anomaly detection.',
    url: 'https://stats.bis.org',
  },

  // ── Building ────────────────────────────────────────────────────────
  {
    id: 'companies_house_stream', name: 'Companies House — Streaming API', jurisdiction: 'GB',
    type: 'Corporate Intelligence', status: 'building', frequency: 'Real-time push',
    editorial_value: 'critical',
    description: 'Upgrade from hourly polling to the Companies House streaming API. Events arrive within 3 minutes of filing rather than up to 60 minutes. Critical for time-sensitive pre-announcement pattern detection.',
  },
  {
    id: 'reddit_sentiment', name: 'Reddit Sentiment — Payments Subreddits', jurisdiction: 'INTL',
    type: 'Sentiment Intelligence', status: 'building', frequency: 'Every 4 hours',
    editorial_value: 'high',
    description: 'Sentiment tracking across r/fintech, r/banking, r/UKPersonalFinance and r/personalfinance for payments companies in the watchlist. Claude Haiku classifies posts and comments. Feeds the Loro Payment Intelligence Score.',
  },
  {
    id: 'hn_sentiment', name: 'Hacker News — Developer Sentiment', jurisdiction: 'INTL',
    type: 'Sentiment Intelligence', status: 'building', frequency: 'Every 4 hours',
    editorial_value: 'medium',
    description: 'Developer and technical community sentiment on payments infrastructure via Algolia HN search API. Developer adoption signal for payments APIs (Stripe, Adyen, GoCardless) ahead of mainstream coverage.',
  },

  // ── Roadmap ─────────────────────────────────────────────────────────
  {
    id: 'amf_france', name: 'AMF France — Insider Declarations', jurisdiction: 'FR',
    type: 'Ownership Intelligence', status: 'roadmap', frequency: 'Daily',
    editorial_value: 'high',
    description: 'Autorité des marchés financiers mandatory insider trading declarations. Completes EU ownership intelligence for French payments entities including Worldline, Ingenico and BNP payments subsidiaries.',
  },
  {
    id: 'bafin', name: 'BaFin — German Regulatory Filings', jurisdiction: 'DE',
    type: 'Regulatory Intelligence', status: 'roadmap', frequency: 'Daily',
    editorial_value: 'high',
    description: 'Bundesanstalt für Finanzdienstleistungsaufsicht market surveillance data. Combined with FCA and AMF data enables three-jurisdiction EU ownership intelligence — the cross-jurisdictional pattern that scores maximum anomaly.',
  },
  {
    id: 'afm', name: 'AFM Netherlands — PDMR Register', jurisdiction: 'NL',
    type: 'Ownership Intelligence', status: 'roadmap', frequency: 'Daily',
    editorial_value: 'medium',
    description: 'Autoriteit Financiële Markten PDMR transaction register. Relevant for Dutch-registered payment institutions (Adyen NV, Mollie, Buckaroo) and EU cross-jurisdictional pattern detection.',
  },
  {
    id: 'fca_register', name: 'FCA Financial Services Register', jurisdiction: 'GB',
    type: 'Regulatory Intelligence', status: 'roadmap', frequency: 'Daily',
    editorial_value: 'medium',
    description: 'FCA authorisation register for payment institutions and e-money institutions. Tracks licence grants, variations and withdrawals. When combined with CH director data, identifies licence-linked ownership changes.',
  },
  {
    id: 'trustpilot', name: 'Trustpilot — Consumer Sentiment', jurisdiction: 'INTL',
    type: 'Sentiment Intelligence', status: 'roadmap', frequency: 'Daily',
    editorial_value: 'medium',
    description: 'Consumer review sentiment for retail payment products — digital banks, payment apps, money transfer services. Anomaly detection on review volume and rating velocity ahead of news coverage.',
  },
  {
    id: 'loro_score', name: 'Loro Payment Intelligence Score', jurisdiction: 'INTL',
    type: 'Proprietary Data Product', status: 'roadmap', frequency: 'Daily composite',
    editorial_value: 'critical',
    description: 'Composite 0–100 score per tracked entity combining regulatory signal intensity, news momentum, social sentiment, ownership intelligence and market data. Proprietary to Loro. The core data product: free tier shows score; paid tier shows full breakdown, historical trend and alerts on score movements >10 points.',
  },
]

const JURISDICTION_LABELS: Record<string, string> = {
  GB: 'United Kingdom', US: 'United States', FR: 'France',
  DE: 'Germany', NL: 'Netherlands', EU: 'European Union', INTL: 'International',
}

const STATUS_LABEL: Record<string, string> = {
  live: 'Live', building: 'Building', roadmap: 'Roadmap',
}

export default async function IntelligencePage() {
  const data = await getSourceData()
  const liveSources = SOURCES.filter(s => s.status === 'live')
  const buildingSources = SOURCES.filter(s => s.status === 'building')
  const roadmapSources = SOURCES.filter(s => s.status === 'roadmap')

  return (
    <>
      <Masthead />

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
