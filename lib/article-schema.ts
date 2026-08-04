import type { SourceCitation } from './source-citations'

// JSON-LD built for answer engines as much as for search.
//
// Beyond the basics, three things matter for citability and almost nobody
// emits them properly:
//   citation / isBasedOn — the primary documents the story came from, with
//     resolvable URLs. This is the machine-readable proof of primary sourcing.
//   about — the entities the piece concerns, so an engine can match it to a
//     question about that company.
//   image + keywords — used when deciding what a piece is and whether to
//     surface it.

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://loro-platform.vercel.app'

export interface ArticleForSchema {
  slug: string
  headline: string
  standfirst: string | null
  seo_title?: string | null
  seo_description?: string | null
  seo_keywords?: string[] | null
  author: string
  published_at: string
  updated_at?: string | null
  category?: string | null
  lane_slug?: string | null
  schema_type?: string | null
  subscriber_only?: boolean
  word_count?: number | null
  lead_image_url?: string | null
  lead_image_alt?: string | null
  lead_image_caption?: string | null
  source_citations?: SourceCitation[] | null
  entity_slugs?: string[] | null
  answer_summary?: string | null
  key_facts?: Array<{ label: string; value: string; source_url?: string }> | null
  faq?: Array<{ question: string; answer: string }> | null
}

const LANE_NAME: Record<string, string> = {
  'ownership-control': 'Ownership & Control',
  'regulation-enforcement': 'Regulation & Enforcement',
  'money-markets': 'Money & Markets',
  'policy-politics': 'Policy & Politics',
  'energy-sustainability': 'Energy & Sustainability',
  'technology-infrastructure': 'Technology & Infrastructure',
}

/** FAQPage schema, emitted alongside the article when questions are set. */
export function buildFaqSchema(
  faq: Array<{ question: string; answer: string }> | null | undefined
): Record<string, unknown> | null {
  const items = (faq ?? []).filter(f => f.question && f.answer)
  if (!items.length) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  }
}

export function buildArticleSchema(a: ArticleForSchema): Record<string, unknown> {
  const url = `${SITE}/news/${a.slug}`
  const citations = (a.source_citations ?? []).filter(c => c?.url)

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': a.schema_type ?? 'NewsArticle',
    headline: a.headline,
    alternativeHeadline: a.seo_title && a.seo_title !== a.headline ? a.seo_title : undefined,
    description: a.standfirst ?? a.seo_description ?? undefined,
    datePublished: a.published_at,
    dateModified: a.updated_at ?? a.published_at,
    author: { '@type': 'Person', name: a.author },
    publisher: {
      '@type': 'Organization',
      name: 'Loro',
      url: SITE,
      logo: { '@type': 'ImageObject', url: `${SITE}/icon.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    isAccessibleForFree: !a.subscriber_only,
    inLanguage: 'en-GB',
  }

  // Section: prefer the lane, fall back to the legacy category.
  const section = a.lane_slug ? LANE_NAME[a.lane_slug] ?? a.lane_slug : a.category
  if (section) schema.articleSection = section

  if (a.word_count) schema.wordCount = a.word_count
  if (a.seo_keywords?.length) schema.keywords = a.seo_keywords.join(', ')

  if (a.lead_image_url) {
    schema.image = {
      '@type': 'ImageObject',
      url: a.lead_image_url,
      caption: a.lead_image_caption ?? a.lead_image_alt ?? undefined,
    }
  }

  // The entities the story is about — lets an engine match it to a question
  // about that company.
  if (a.entity_slugs?.length) {
    schema.about = a.entity_slugs.map(name => ({
      '@type': 'Organization',
      name,
    }))
  }

  // Primary-source provenance. citation = documents referenced;
  // isBasedOn = the source material the piece was derived from.
  if (citations.length) {
    const refs = citations.map(c => ({
      '@type': 'CreativeWork',
      name: c.title,
      url: c.url,
      ...(c.publisher ? { publisher: { '@type': 'Organization', name: c.publisher } } : {}),
      ...(c.date ? { datePublished: c.date } : {}),
      ...(c.identifier ? { identifier: c.identifier } : {}),
    }))
    schema.citation = refs
    schema.isBasedOn = refs.map(r => r.url)
  }

  // The direct answer, marked up so an engine can lift it as THE answer.
  if (a.answer_summary) {
    schema.abstract = a.answer_summary
    schema.backstory = undefined
  }

  // Discrete checkable facts as structured properties.
  if (a.key_facts?.length) {
    schema.additionalProperty = a.key_facts.map(f => ({
      '@type': 'PropertyValue',
      name: f.label,
      value: f.value,
      ...(f.source_url ? { url: f.source_url } : {}),
    }))
  }

  // Strip undefined so the emitted JSON stays clean.
  return Object.fromEntries(
    Object.entries(schema).filter(([, v]) => v !== undefined)
  )
}
