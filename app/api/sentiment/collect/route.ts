import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Sentiment collector — runs every 4 hours
// Sources: Reddit (r/fintech, r/banking, r/UKPersonalFinance, r/personalfinance)
//          Hacker News via Algolia search API
// Classification: Claude Haiku — payments-specific sentiment taxonomy
// No API keys needed for Reddit JSON or Algolia HN

export const runtime = 'nodejs'
export const maxDuration = 55

const SUBREDDITS = ['fintech','banking','UKPersonalFinance','personalfinance','CryptoCurrency']

const SENTIMENT_CATEGORIES = [
  'product_praise','customer_complaint','regulatory_concern',
  'developer_adoption','partnership','funding','leadership',
  'market_performance','general',
] as const

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Classify a single post with Claude Haiku
async function classifyPost(params: {
  title: string
  body: string
  source: string
  entityName: string
  upvotes: number
}): Promise<{
  sentiment: 'positive' | 'negative' | 'neutral'
  intensity: 'strong' | 'moderate' | 'weak'
  category: string
  confidence: number
  note: string
} | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const prompt = `You are a payments industry analyst. Classify this social media post about ${params.entityName}.

SOURCE: ${params.source} (${params.upvotes} upvotes)
TITLE: ${params.title}
BODY: ${params.body.slice(0, 500)}

Respond with JSON only — no other text:
{
  "sentiment": "positive" | "negative" | "neutral",
  "intensity": "strong" | "moderate" | "weak",
  "category": "${SENTIMENT_CATEGORIES.join('" | "')}",
  "confidence": 0.0-1.0,
  "note": "one sentence"
}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return null
    const data = await res.json()
    const text = data.content?.[0]?.text ?? ''
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return null
  }
}

// Fetch Reddit posts for an entity
async function fetchReddit(entityName: string, entityId: string): Promise<Array<{
  source_id: string; subreddit: string; title: string; body: string
  url: string; author: string; upvotes: number; comment_count: number; posted_at: string
}>> {
  const results = []
  const searchTerms = entityName.split(' ').slice(0, 2).join(' ')  // first two words

  for (const sub of SUBREDDITS) {
    try {
      const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(searchTerms)}&sort=new&limit=10&t=week&restrict_sr=1`
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Loro-Intelligence/1.0 (payments journalism bot)',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      })

      if (!res.ok) continue
      const data = await res.json()
      const posts = data?.data?.children ?? []

      for (const { data: post } of posts) {
        if (!post.title) continue
        results.push({
          source_id: post.id,
          subreddit: sub,
          title: post.title,
          body: post.selftext?.slice(0, 1000) ?? '',
          url: `https://reddit.com${post.permalink}`,
          author: post.author ?? '',
          upvotes: post.score ?? 0,
          comment_count: post.num_comments ?? 0,
          posted_at: new Date((post.created_utc ?? 0) * 1000).toISOString(),
        })
      }

      // Brief pause between subreddit requests
      await new Promise(r => setTimeout(r, 300))
    } catch {
      // Skip failed subreddit
    }
  }

  return results
}

// Fetch HN posts for an entity via Algolia
async function fetchHN(entityName: string): Promise<Array<{
  source_id: string; title: string; body: string
  url: string; author: string; upvotes: number; comment_count: number; posted_at: string
}>> {
  try {
    const query = entityName.split(' ').slice(0, 2).join(' ')
    const since = Math.floor((Date.now() - 7 * 24 * 3600000) / 1000)
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10&numericFilters=created_at_i>${since}`

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return []
    const data = await res.json()

    return (data.hits ?? []).map((hit: {
      objectID: string; title: string; story_text?: string; url?: string
      author: string; points?: number; num_comments?: number; created_at: string
    }) => ({
      source_id: hit.objectID,
      title: hit.title ?? '',
      body: hit.story_text?.slice(0, 500) ?? '',
      url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
      author: hit.author ?? '',
      upvotes: hit.points ?? 0,
      comment_count: hit.num_comments ?? 0,
      posted_at: hit.created_at,
    }))
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = getSupabase()

  // Get all monitored entities
  const { data: entities } = await sb
    .from('loro_entities')
    .select('id, name, slug')
    .not('name', 'is', null)

  if (!entities?.length) {
    return NextResponse.json({ message: 'No entities to monitor' })
  }

  let totalNew = 0
  let totalClassified = 0
  const entityResults: Array<{ entity: string; reddit: number; hn: number; classified: number }> = []

  for (const entity of entities.slice(0, 15)) {  // cap per run
    let entityReddit = 0
    let entityHN = 0
    let entityClassified = 0

    // Fetch from both sources in parallel
    const [redditPosts, hnPosts] = await Promise.all([
      fetchReddit(entity.name, entity.id),
      fetchHN(entity.name),
    ])

    const allPosts = [
      ...redditPosts.map(p => ({ ...p, source: 'reddit' as const })),
      ...hnPosts.map(p => ({ ...p, source: 'hackernews' as const, subreddit: undefined })),
    ]

    for (const post of allPosts) {
      // Skip low-quality posts
      if (!post.title || post.title.length < 10) continue

      // Classify with Haiku
      const classification = await classifyPost({
        title: post.title,
        body: post.body,
        source: post.source === 'reddit' ? `r/${(post as { subreddit?: string }).subreddit}` : 'Hacker News',
        entityName: entity.name,
        upvotes: post.upvotes,
      })

      // Upsert to avoid duplicates
      const { error } = await sb
        .from('loro_sentiment_events')
        .upsert({
          entity_id: entity.id,
          source: post.source,
          source_id: post.source_id,
          subreddit: (post as { subreddit?: string }).subreddit ?? null,
          title: post.title,
          body: post.body.slice(0, 2000),
          url: post.url,
          author: post.author,
          upvotes: post.upvotes,
          comment_count: post.comment_count,
          posted_at: post.posted_at,
          sentiment: classification?.sentiment ?? null,
          intensity: classification?.intensity ?? null,
          category: classification?.category ?? null,
          confidence: classification?.confidence ?? null,
          classification_note: classification?.note ?? null,
        }, { onConflict: 'source,source_id', ignoreDuplicates: false })

      if (!error) {
        totalNew++
        if (post.source === 'reddit') entityReddit++
        else entityHN++
        if (classification) { totalClassified++; entityClassified++ }
      }
    }

    entityResults.push({
      entity: entity.name,
      reddit: entityReddit,
      hn: entityHN,
      classified: entityClassified,
    })

    await new Promise(r => setTimeout(r, 500))
  }

  return NextResponse.json({
    entities_processed: entities.slice(0, 15).length,
    total_posts: totalNew,
    total_classified: totalClassified,
    results: entityResults,
  })
}
