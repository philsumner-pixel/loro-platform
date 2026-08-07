import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import TickerStrip from '@/components/TickerStrip'
import Masthead from '@/components/Masthead'
import NewsletterSection from '@/components/NewsletterSection'
import SiteFooter from '@/components/SiteFooter'
import LaneNav from '@/components/LaneNav'

// Read at request time so newly published articles appear without a redeploy.
export const revalidate = 120

// Reader-facing view of a content lane. Same taxonomy the newsroom filters by,
// so editorial and reader navigation cannot drift apart.

interface PageProps {
  params: { slug: string }
}

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

async function getLane(slug: string) {
  const { data } = await sb()
    .from('loro_content_lanes')
    .select('slug, label, description')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()
  return data
}

async function getArticles(slug: string) {
  const { data } = await sb()
    .from('loro_articles')
    .select('slug, headline, standfirst, published_at, author')
    .eq('lane_slug', slug)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(30)
  return data ?? []
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const lane = await getLane(params.slug)
  if (!lane) return { title: 'Not found' }
  return {
    title: `${lane.label} — Loro`,
    description: lane.description,
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

export default async function LanePage({ params }: PageProps) {
  const lane = await getLane(params.slug)
  if (!lane) notFound()

  const articles = await getArticles(params.slug)

  return (
    <>
      <TickerStrip />
      <Masthead />
      <LaneNav active={params.slug} />

      <main className="loro-lane-page">
        <header className="loro-lane-head">
          <h1>{lane.label}</h1>
          <p>{lane.description}</p>
        </header>

        {articles.length === 0 ? (
          <div className="loro-lane-empty">
            <p>No published stories in this lane yet.</p>
            <p className="sub">
              The engine monitors this area continuously. Stories appear here once a
              journalist has reviewed and published them.
            </p>
          </div>
        ) : (
          <div className="loro-lane-list">
            {articles.map(a => (
              <a key={a.slug} href={`/news/${a.slug}`} className="loro-lane-item">
                <h2>{a.headline}</h2>
                {a.standfirst && <p className="stand">{a.standfirst}</p>}
                <div className="meta">
                  {a.author ?? 'Loro Staff Writers'}
                  {a.published_at ? ` \u00b7 ${formatDate(a.published_at)}` : ''}
                </div>
              </a>
            ))}
          </div>
        )}
      </main>

      <NewsletterSection />
      <SiteFooter />
    </>
  )
}
