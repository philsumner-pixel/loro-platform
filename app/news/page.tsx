import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import TickerStrip from '@/components/TickerStrip'
import Masthead from '@/components/Masthead'
import SiteFooter from '@/components/SiteFooter'
import LaneNav from '@/components/LaneNav'

// Everything published, newest first. There was no archive at all — "All
// stories" pointed at href="#", so the only way to reach an article was the six
// most recent on the homepage.

export const revalidate = 60

export const metadata: Metadata = {
  title: 'All stories — Loro',
  description: 'Every story published by Loro, newest first. Business and regulatory intelligence derived from primary sources.',
}

interface Row {
  slug: string
  headline: string
  standfirst: string | null
  author: string | null
  published_at: string
  lane_slug: string | null
  category: string | null
  source_citations: unknown
  key_facts: unknown
}

const LANE_LABEL: Record<string, string> = {
  'ownership-control': 'Ownership & Control',
  'regulation-enforcement': 'Regulation & Enforcement',
  'money-markets': 'Money & Markets',
  'policy-politics': 'Policy & Politics',
  'energy-sustainability': 'Energy & Sustainability',
  'technology-infrastructure': 'Technology & Infrastructure',
}

async function getAll(): Promise<Row[]> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data } = await sb
      .from('loro_articles')
      .select('slug, headline, standfirst, author, published_at, lane_slug, category, source_citations, key_facts')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(200)
    return (data ?? []) as Row[]
  } catch {
    return []
  }
}

const count = (v: unknown) => (Array.isArray(v) ? v.length : 0)

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(Date.now() - 86400_000)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, yest)) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function AllStoriesPage() {
  const rows = await getAll()

  // Grouped by day so a reader can see the publishing rhythm, not just a list.
  const days: Array<{ label: string; items: Row[] }> = []
  for (const r of rows) {
    const label = dayLabel(r.published_at)
    const last = days[days.length - 1]
    if (last && last.label === label) last.items.push(r)
    else days.push({ label, items: [r] })
  }

  return (
    <>
      <TickerStrip />
      <Masthead />
      <LaneNav />

      <main className="loro-archive">
        <header className="loro-archive-head">
          <h1>All stories</h1>
          <p>
            Everything Loro has published, newest first.
            {rows.length > 0 && ` ${rows.length} ${rows.length === 1 ? 'story' : 'stories'}.`}
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="loro-archive-empty">
            No stories published yet. The engine is monitoring its sources continuously —
            stories appear here once a journalist has reviewed and published them.
          </p>
        ) : (
          days.map(day => (
            <section key={day.label} className="loro-archive-day">
              <h2>{day.label}</h2>
              {day.items.map(a => {
                const label = a.lane_slug
                  ? LANE_LABEL[a.lane_slug] ?? a.lane_slug
                  : a.category ?? 'Intelligence'
                const sources = count(a.source_citations)
                return (
                  <a key={a.slug} href={`/news/${a.slug}`} className="loro-archive-item">
                    <span className="cat">{label}</span>
                    <h3>{a.headline}</h3>
                    {a.standfirst && <p>{a.standfirst}</p>}
                    <div className="meta">
                      <span>{a.author ?? 'Loro Staff Writers'}</span>
                      <span>·</span>
                      <span>
                        {new Date(a.published_at).toLocaleTimeString('en-GB',
                          { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {sources > 0 && (
                        <>
                          <span>·</span>
                          <span className="badge">
                            {sources} primary source{sources > 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                      {count(a.key_facts) > 0 && (
                        <>
                          <span>·</span>
                          <span className="badge">With data</span>
                        </>
                      )}
                    </div>
                  </a>
                )
              })}
            </section>
          ))
        )}
      </main>

      <SiteFooter />
    </>
  )
}
