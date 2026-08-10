import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { splitForAd } from '@/lib/article-body'
import { buildArticleSchema, buildFaqSchema } from '@/lib/article-schema'
import CoverageMeter from '@/components/CoverageMeter'
import TickerStrip from '@/components/TickerStrip'
import Masthead from '@/components/Masthead'
import ArticleAd from '@/components/ArticleAd'
import NewsletterSection from '@/components/NewsletterSection'
import SiteFooter from '@/components/SiteFooter'

// Read at request time so newly published articles appear without a redeploy.
export const revalidate = 60

interface PageProps {
  params: { slug: string }
}

async function getArticle(slug: string) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data } = await sb
    .from('loro_articles')
    .select('*')
    .eq('slug', slug)
    .not('published_at', 'is', null)
    .single()
  return data
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const article = await getArticle(params.slug)
  if (!article) return { title: 'Not found' }
  const image = article.lead_image_url ?? undefined
  return {
    title: article.seo_title ?? article.headline,
    description: article.seo_description ?? article.standfirst,
    openGraph: {
      title: article.seo_title ?? article.headline,
      description: article.seo_description ?? article.standfirst ?? undefined,
      type: 'article',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: article.seo_title ?? article.headline,
      description: article.seo_description ?? article.standfirst ?? undefined,
      images: image ? [image] : undefined,
    },
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function readingTime(html: string): number {
  const words = html.replace(/<[^>]+>/g, '').split(/\s+/).length
  return Math.max(1, Math.round(words / 200))
}

export default async function ArticlePage({ params }: PageProps) {
  const article = await getArticle(params.slug)
  if (!article) notFound()

  const mins = readingTime(article.body_html)

  // Block-aware ad slot. String-slicing at the first '</p>' broke pull quotes
  // (splitting inside the blockquote) and separated images from the paragraph
  // they illustrate. See lib/article-body.ts.
  const { beforeAd, afterAd } = splitForAd(article.body_html)

  const articleSchema = buildArticleSchema(article)
  const faqSchema = buildFaqSchema(article.faq)
  const keyFacts = (article.key_facts ?? []) as Array<{ label: string; value: string; source_url?: string }>

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      {faqSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      )}
      <TickerStrip />
      <Masthead />

      <nav className="loro-subnav">
        <div className="loro-subnav-inner">
          <a href="/">All</a>
          <a href="#" className="loro-active">{article.category}</a>
        </div>
      </nav>

      <div className="loro-wrap">
        <div className="loro-article-zone">
          <div className="loro-article-content">

            <header className="loro-art-header">
              <a href="/" className="loro-art-back">← Back to {article.category}</a>

              <div className="loro-art-cats">
                <span className="loro-art-cat">{article.category}</span>
                {article.subscriber_only && (
                  <>
                    <span className="loro-art-cat-sep">·</span>
                    <span className="loro-art-cat">Subscriber</span>
                  </>
                )}
              </div>

              <h1 className="loro-art-headline">{article.headline}</h1>

              {article.standfirst && (
                <p className="loro-art-standfirst">{article.standfirst}</p>
              )}

              <div className="loro-art-meta">
                <span className="loro-art-author">{article.author}</span>
                <span className="loro-art-sep">·</span>
                <span className="loro-art-date">{formatDate(article.published_at)}</span>
                <span className="loro-art-sep">·</span>
                <span className="loro-art-read">{mins} min read</span>
                {article.subscriber_only && (
                  <>
                    <span className="loro-art-sep">·</span>
                    <span className="loro-art-sub">Subscriber</span>
                  </>
                )}
              </div>
            </header>

            {/* Lead image — structured, outside body_html, so it can never
                collide with the in-article ad slot. */}
            {article.lead_image_url && (
              <figure className="loro-art-lead">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={article.lead_image_url}
                  alt={article.lead_image_alt ?? article.headline}
                />
                {(article.lead_image_caption || article.lead_image_credit) && (
                  <figcaption>
                    {article.lead_image_caption}
                    {article.lead_image_credit && (
                      <span className="credit">{article.lead_image_credit}</span>
                    )}
                  </figcaption>
                )}
              </figure>
            )}

            {/* How covered this story is elsewhere, and how that has moved
                since publication. */}
            <CoverageMeter
              status={article.coverage_status}
              coverageNow={article.coverage_now}
              coverageAtPublish={article.coverage_at_publish}
              wasFirst={article.was_first}
              checkedAt={article.coverage_checked_at}
              publishedAt={article.published_at}
              outletsWatched={article.coverage_outlets_watched}
              lane={article.lane_slug}
            />

            {/* Answer block — visible (so it's crawlable and genuinely useful)
                and mirrored into schema.org so engines can lift it. */}
            {(article.answer_summary || keyFacts.length > 0) && (
              <section className="loro-answer-block" aria-label="Key facts">
                {article.answer_summary && (
                  <p className="loro-answer-summary">{article.answer_summary}</p>
                )}
                {keyFacts.length > 0 && (
                  <dl className="loro-key-facts">
                    {keyFacts.map((f, i) => (
                      <div key={i}>
                        <dt>{f.label}</dt>
                        <dd>
                          {f.source_url
                            ? <a href={f.source_url} rel="nofollow noopener" target="_blank">{f.value}</a>
                            : f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            )}

            {/* Article body — ad slot chosen block-aware */}
            <div className="loro-art-body">
              {beforeAd && (
                <div dangerouslySetInnerHTML={{ __html: beforeAd }} />
              )}

              {/* Teads inRead — flows after first paragraph */}
              <ArticleAd />

              <div dangerouslySetInnerHTML={{ __html: afterAd }} />
            </div>

            {/* Tags */}
            {article.seo_keywords?.length > 0 && (
              <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {article.seo_keywords.map((tag: string) => (
                  <span key={tag} style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--ink4)' }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}

          </div>
        </div>
      </div>

      <NewsletterSection />
      <SiteFooter />
    </>
  )
}
