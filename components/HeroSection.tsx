import { createClient } from '@supabase/supabase-js'

// The lead story, from real published articles.
//
// This was previously hardcoded demo content — an invented PDMR investigation
// bylined "Chris Cannon" — which is why the biggest headline on the site was
// not clickable: there was no article behind it. Now the most recent published
// piece leads, with the next three beside it, all real links.

interface Row {
  slug: string
  headline: string
  standfirst: string | null
  author: string | null
  published_at: string
  lane_slug: string | null
  category: string | null
  subscriber_only: boolean | null
  source_citations: unknown
}

const COLS = 'slug, headline, standfirst, author, published_at, lane_slug, category, subscriber_only, source_citations'

const LANE_LABEL: Record<string, string> = {
  'ownership-control': 'Ownership & Control',
  'regulation-enforcement': 'Regulation & Enforcement',
  'money-markets': 'Money & Markets',
  'policy-politics': 'Policy & Politics',
  'energy-sustainability': 'Energy & Sustainability',
  'technology-infrastructure': 'Technology & Infrastructure',
}

function relative(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${Math.max(mins, 1)}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

async function getLead(): Promise<Row[]> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data } = await sb
      .from('loro_articles').select(COLS)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(4)
    return (data ?? []) as Row[]
  } catch {
    return []
  }
}

export default async function HeroSection() {
  const rows = await getLead()
  if (!rows.length) return null

  const [lead, ...rest] = rows
  const label = (r: Row) =>
    r.lane_slug ? LANE_LABEL[r.lane_slug] ?? r.lane_slug : r.category ?? 'Intelligence'
  const sources = Array.isArray(lead.source_citations) ? lead.source_citations.length : 0

  return (
    <section className="loro-hero-section">
      <div className="loro-wrap">
        <div className="loro-hero-grid">
          <div className="loro-hero-main">
            <span className="loro-hero-cat">{label(lead)}</span>
            {/* The whole headline is the link — previously a bare <h1> with no
                anchor, so the most prominent element on the site did nothing. */}
            <a href={`/news/${lead.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <h1 className="loro-hero-headline">{lead.headline}</h1>
            </a>
            {lead.standfirst && <p className="loro-hero-standfirst">{lead.standfirst}</p>}
            <div className="loro-hero-meta">
              <span className="loro-hero-byline">
                {lead.author ?? 'Loro Staff Writers'} · {relative(lead.published_at)}
              </span>
              <span className="loro-hero-sep">·</span>
              <a href={`/news/${lead.slug}`} className="loro-hero-read" style={{ textDecoration: 'none' }}>
                Read the analysis →
              </a>
              {sources > 0 && (
                <>
                  <span className="loro-hero-sep">·</span>
                  <span className="loro-hero-tag">
                    {sources} primary source{sources > 1 ? 's' : ''}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="loro-secondary-stack">
            {rest.map(r => (
              <a key={r.slug} href={`/news/${r.slug}`} className="loro-sec-item"
                 style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                <span className="loro-sec-cat">{label(r)}</span>
                <div className="loro-sec-title">{r.headline}</div>
                <div className="loro-sec-meta">{relative(r.published_at)}</div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
