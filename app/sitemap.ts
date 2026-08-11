import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://loro-platform.vercel.app'

export const revalidate = 3600

const LANES = [
  'ownership-control', 'regulation-enforcement', 'money-markets',
  'policy-politics', 'energy-sustainability', 'technology-infrastructure',
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base: MetadataRoute.Sitemap = [
    { url: SITE, changeFrequency: 'hourly', priority: 1 },
    { url: `${SITE}/intelligence`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE}/sources`, changeFrequency: 'daily', priority: 0.6 },
    { url: `${SITE}/news`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE}/data`, changeFrequency: 'weekly', priority: 0.7 },
    // The visualisations are static files in public/, so Next Metadata does not
    // apply to them — they must be listed here explicitly or crawlers will
    // never find them.
    { url: `${SITE}/political-money.html`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE}/donor-analysis.html`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE}/member-dossier.html`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE}/signal-core.html`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE}/corridor-currents.html`, changeFrequency: 'monthly', priority: 0.5 },
    ...LANES.map(slug => ({
      url: `${SITE}/lane/${slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
  ]

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data } = await sb
      .from('loro_articles')
      .select('slug, published_at, updated_at')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(1000)

    for (const a of data ?? []) {
      base.push({
        url: `${SITE}/news/${a.slug}`,
        lastModified: new Date(a.updated_at ?? a.published_at),
        changeFrequency: 'weekly',
        priority: 0.9,
      })
    }
  } catch {
    // Sitemap must never break the build — fall back to static routes.
  }

  return base
}
