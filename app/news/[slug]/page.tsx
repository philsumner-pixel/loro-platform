import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import TickerStrip from '@/components/TickerStrip'
import Masthead from '@/components/Masthead'
import ArticleAd from '@/components/ArticleAd'
import NewsletterSection from '@/components/NewsletterSection'
import SiteFooter from '@/components/SiteFooter'

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
  return {
    title: article.seo_title ?? article.headline,
    description: article.seo_description ?? article.standfirst,
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

  // Split body_html at the first </p> to inject the inRead ad after paragraph 1
  const firstClose = article.body_html.indexOf('</p>')
  const beforeAd = firstClose > -1
    ? article.body_html.slice(0, firstClose + 4)
    : ''
  const afterAd = firstClose > -1
    ? article.body_html.slice(firstClose + 4)
    : article.body_html

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': article.schema_type ?? 'NewsArticle',
    headline: article.headline,
    description: article.standfirst ?? article.seo_description,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    author: { '@type': 'Person', name: article.author },
    publisher: {
      '@type': 'Organization',
      name: 'Loro',
      url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://loro-platform.vercel.app',
    },
    articleSection: article.category,
    isAccessibleForFree: !article.subscriber_only,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://loro-platform.vercel.app'}/news/${article.slug}`,
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
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

            {/* Article body — ad injected after paragraph 1 */}
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
