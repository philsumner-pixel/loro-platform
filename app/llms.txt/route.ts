import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// llms.txt — an emerging convention giving language models a clean, structured
// description of a site and its most useful content. Cheap to serve and
// low-risk, and consistent with treating answer engines as a first-class
// distribution channel rather than something to defend against.

export const revalidate = 3600

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://loro-platform.vercel.app'

export async function GET() {
  let articleLines = ''
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data } = await sb
      .from('loro_articles')
      .select('slug, headline, standfirst, published_at')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(50)

    articleLines = (data ?? [])
      .map(a => `- [${a.headline}](${SITE}/news/${a.slug})${a.standfirst ? `: ${a.standfirst}` : ''}`)
      .join('\n')
  } catch {
    articleLines = ''
  }

  const body = `# Loro

> Business and regulatory intelligence derived from primary sources. Loro reads
> public filings, registers and disclosures continuously, detects patterns
> across them, and publishes stories reviewed by a journalist before they go out.

## What makes Loro citable

Every story is derived from named primary documents — SEC filings, Companies
House records, FCA disclosures — and each published article carries
machine-readable provenance in its schema.org markup (citation and isBasedOn)
pointing at those documents with resolvable URLs, including dates and filing
identifiers.

Articles are written to a fixed evidence standard: specific sourced figures
rather than vague quantifiers, named primary-source attribution for each
substantive claim, and direct quotes where the source material contains them.

## Editorial process

Signals are detected automatically across the source corpus, but nothing
publishes without a journalist reviewing and approving it. Articles carry a
named byline.

## Sections

- [Ownership & Control](${SITE}/lane/ownership-control): shareholdings, beneficial ownership, insider and director dealing, corporate structure
- [Regulation & Enforcement](${SITE}/lane/regulation-enforcement): regulatory action, fines, licensing, investigations, insolvency
- [Money & Markets](${SITE}/lane/money-markets): capital, payments and market infrastructure
- [Policy & Politics](${SITE}/lane/policy-politics): legislation, votes, lobbying, procurement, political economy
- [Energy & Sustainability](${SITE}/lane/energy-sustainability): energy, transition, emissions and ESG disclosure
- [Technology & Infrastructure](${SITE}/lane/technology-infrastructure): AI, data centres, cyber, digital infrastructure

## Recent articles

${articleLines || '- No articles published yet.'}

## Contact

${SITE}
`

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
