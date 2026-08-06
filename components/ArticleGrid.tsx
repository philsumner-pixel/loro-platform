import { createClient } from '@supabase/supabase-js'

// Real published articles.
//
// This component previously rendered a hardcoded demo array — invented
// headlines, fabricated bylines ("Chris Cannon"), fake timestamps ("6h ago"),
// and NO href on most cards, which is why most of the homepage was
// unclickable. It had never been connected to loro_articles, so nothing a
// journalist published ever reached the front page.

export const revalidate = 60

interface Row {
  slug: string
  headline: string
  standfirst: string | null
  author: string | null
  published_at: string
  lane_slug: string | null
  category: string | null
  subscriber_only: boolean | null
  key_facts: unknown
  source_citations: unknown
}

const COLS = 'slug, headline, standfirst, author, published_at, lane_slug, category, subscriber_only, key_facts, source_citations'

const LANE_LABEL: Record<string, string> = {
  'ownership-control': 'Ownership & Control',
  'regulation-enforcement': 'Regulation & Enforcement',
  'money-markets': 'Money & Markets',
  'policy-politics': 'Policy & Politics',
  'energy-sustainability': 'Energy & Sustainability',
  'technology-infrastructure': 'Technology & Infrastructure',
}

/** "6h ago" style, from the real publication time rather than a literal. */
function relative(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : 0)

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

async function getArticles(variant: string, limit: number): Promise<Row[]> {
  try {
    const client = sb()

    if (variant === 'markets') {
      const { data } = await client
        .from('loro_articles').select(COLS)
        .not('published_at', 'is', null)
        .eq('lane_slug', 'money-markets')
        .order('published_at', { ascending: false })
        .limit(limit)
      // Fall back to most recent rather than rendering an empty rail.
      if (data && data.length) return data as Row[]
    }

    const { data } = await client
      .from('loro_articles').select(COLS)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(limit)
    return (data ?? []) as Row[]
  } catch {
    return []
  }
}

export default async function ArticleGrid({
  variant = 'intelligence',
  limit = 6,
}: {
  variant?: 'intelligence' | 'markets'
  limit?: number
}) {
  const articles = await getArticles(variant, limit)

  if (!articles.length) {
    return (
      <div className="loro-art-grid">
        <article className="loro-art-item">
          <h3 className="loro-art-title">No stories published yet</h3>
          <p className="loro-art-excerpt">
            The engine monitors its sources continuously. Stories appear here once a
            journalist has reviewed and published them.
          </p>
        </article>
      </div>
    )
  }

  return (
    <div className="loro-art-grid">
      {articles.map(a => {
        const facts = countOf(a.key_facts)
        const sources = countOf(a.source_citations)
        const label = a.lane_slug
          ? LANE_LABEL[a.lane_slug] ?? a.lane_slug
          : a.category ?? 'Intelligence'

        return (
          // A real anchor rather than an onClick handler: every card is now a
          // proper link, so it is keyboard accessible, opens in a new tab, and
          // is followable by crawlers — none of which the old handler allowed.
          <a key={a.slug} href={`/news/${a.slug}`} className="loro-art-item loro-art-link">
            <span className="loro-art-cat">{label}</span>
            <h3 className="loro-art-title">{a.headline}</h3>
            {a.standfirst && <p className="loro-art-excerpt">{a.standfirst}</p>}
            <div className="loro-art-meta">
              <span>{a.author ?? 'Loro Staff Writers'}</span>
              <span className="loro-art-dot">·</span>
              <span>{relative(a.published_at)}</span>
              {sources > 0 && (
                <>
                  <span className="loro-art-dot">·</span>
                  <span className="loro-art-badge">
                    {sources} primary source{sources > 1 ? 's' : ''}
                  </span>
                </>
              )}
              {facts > 0 && (
                <>
                  <span className="loro-art-dot">·</span>
                  <span className="loro-art-badge">With data</span>
                </>
              )}
            </div>
          </a>
        )
      })}
    </div>
  )
}
