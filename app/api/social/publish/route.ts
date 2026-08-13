import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Publish approved posts to LinkedIn and X.
//
// Only posts a human has approved, and only when their scheduled time has
// passed. A failure marks the row and moves on rather than retrying blindly —
// a post that silently publishes twice is worse than one that does not go out.
//
// Credentials are optional: without them the route reports which are missing
// and leaves posts approved, so the whole pipeline is usable (generate,
// review, approve, copy out) before any app is authorised.

export const runtime = 'nodejs'
export const maxDuration = 60

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface Post {
  id: string; platform: string; body: string
  link_url: string | null; hashtags: string[] | null
}

function compose(p: Post): string {
  const tags = (p.hashtags ?? []).map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ')
  return [p.body, p.link_url, tags].filter(Boolean).join('\n\n')
}

async function postToLinkedIn(p: Post): Promise<{ id?: string; error?: string }> {
  const token = process.env.LINKEDIN_ACCESS_TOKEN
  const author = process.env.LINKEDIN_AUTHOR_URN  // e.g. urn:li:organization:123
  if (!token || !author) return { error: 'LINKEDIN_ACCESS_TOKEN or LINKEDIN_AUTHOR_URN not set' }

  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: compose(p) },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return { error: `LinkedIn ${res.status}: ${(await res.text()).slice(0, 200)}` }
  const data = await res.json()
  return { id: data.id }
}

async function postToX(p: Post): Promise<{ id?: string; error?: string }> {
  const token = process.env.X_BEARER_TOKEN
  if (!token) return { error: 'X_BEARER_TOKEN not set' }

  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: compose(p).slice(0, 280) }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return { error: `X ${res.status}: ${(await res.text()).slice(0, 200)}` }
  const data = await res.json()
  return { id: data?.data?.id }
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dry') === '1'
  if (!dryRun && cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = sb()
  const { data: due } = await client
    .from('loro_social_posts')
    .select('id, platform, body, link_url, hashtags, scheduled_for, status')
    .in('status', ['approved', 'scheduled'])
    .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`)
    .limit(10)

  const posts = (due ?? []) as Array<Post & { status: string }>
  if (!posts.length) return NextResponse.json({ ok: true, published: 0, message: 'Nothing due' })

  if (dryRun) {
    return NextResponse.json({
      dry_run: true, would_publish: posts.length,
      linkedin_configured: Boolean(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_AUTHOR_URN),
      x_configured: Boolean(process.env.X_BEARER_TOKEN),
      posts: posts.map(p => ({ id: p.id, platform: p.platform, preview: compose(p).slice(0, 160) })),
    })
  }

  const results: Array<Record<string, unknown>> = []
  for (const p of posts) {
    const out = p.platform === 'linkedin' ? await postToLinkedIn(p) : await postToX(p)
    if (out.id) {
      await client.from('loro_social_posts')
        .update({ status: 'published', published_at: new Date().toISOString(), external_id: out.id, error: null })
        .eq('id', p.id)
      results.push({ id: p.id, platform: p.platform, published: true })
    } else {
      // Left approved so it can be retried once credentials are fixed, rather
      // than silently dropped.
      await client.from('loro_social_posts').update({ error: out.error }).eq('id', p.id)
      results.push({ id: p.id, platform: p.platform, published: false, error: out.error })
    }
  }

  return NextResponse.json({
    ok: true,
    published: results.filter(r => r.published).length,
    failed: results.filter(r => !r.published).length,
    results,
  })
}
