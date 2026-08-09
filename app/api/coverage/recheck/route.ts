import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Re-measure coverage on published articles.
//
// This is what makes the coverage claim honest rather than decorative. A story
// published as "only source" may be picked up tomorrow — and when it is, that
// is a BETTER claim, not a worse one: "Loro reported this first, four outlets
// have since followed" is provenance, and it is verifiable.
//
// Recency-weighted: recent articles are rechecked often because that is when
// coverage moves; older ones settle and are checked occasionally.

export const runtime = 'nodejs'
export const maxDuration = 60

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = sb()
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 20), 50)

  const { data: articles } = await client
    .from('loro_articles')
    .select('slug, published_at, coverage_checked_at')
    .not('published_at', 'is', null)
    .not('embedding', 'is', null)
    .limit(200)

  const now = Date.now()
  const due = (a: { published_at: string; coverage_checked_at: string | null }) => {
    const ageDays = (now - new Date(a.published_at).getTime()) / 86400_000
    const sinceCheck = a.coverage_checked_at
      ? (now - new Date(a.coverage_checked_at).getTime()) / 3600_000
      : Infinity
    // Fresh stories move; settled ones don't.
    if (ageDays <= 3) return sinceCheck >= 6
    if (ageDays <= 14) return sinceCheck >= 24
    if (ageDays <= 60) return sinceCheck >= 24 * 7
    return sinceCheck >= 24 * 30
  }

  const queue = (articles ?? []).filter(due).slice(0, limit)
  const results: Array<Record<string, unknown>> = []

  for (const a of queue) {
    const { data, error } = await client.rpc('loro_measure_article_coverage', {
      slug_in: a.slug, similarity_threshold: 0.82,
    })
    if (!error) results.push(data as Record<string, unknown>)
  }

  return NextResponse.json({
    ok: true, considered: (articles ?? []).length,
    rechecked: results.length, results: results.slice(0, 10),
  })
}
