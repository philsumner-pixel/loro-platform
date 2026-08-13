import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Generate social posts from a PUBLISHED ARTICLE or a data trend.
//
// The existing generate-social route works from a signal digest and has never
// been used. There are now 18 published articles and the political-finance
// analyses, which is what should actually be promoted.
//
// Posts are written to be worth reading on their own — Chris's driver is SEO
// traffic collapse, so a post that only says "new article, click here" earns
// nothing. Lead with the finding; the link is the follow-up, not the point.

export const runtime = 'nodejs'
export const maxDuration = 60

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://loro-platform.vercel.app'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const SYSTEM = `You write social posts for Loro, a business and regulatory
intelligence publication that derives stories from primary sources — filings,
registers, disclosures.

Return ONLY valid JSON:
{"linkedin": "...", "x": "...", "hashtags": ["...", "..."]}

VOICE: factual, specific, unexcitable. Loro's authority comes from having read
the documents, so the post should sound like someone who has.

RULES
- Lead with the FINDING and its number. Never open with a question, never with
  "New from Loro" or "We've just published".
- Use the specific figures given. If there are none, say what was found in the
  record instead — never invent a number.
- Say where it came from ("Companies House filings", "the Electoral Commission
  register"). Primary sourcing is the differentiator; name it.
- State only what the article states. No implication of wrongdoing, no
  speculation about motive.
- LINKEDIN: 90-150 words, short paragraphs, one line at the end pointing to the
  full piece.
- X: under 260 characters, one post, no thread. Room for the link.
- hashtags: 3-4, lowercase, specific rather than generic.
- No emoji.`

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

  const { slug, trend_key, trend_summary } = await req.json()
  if (!slug && !trend_key) {
    return NextResponse.json({ error: 'slug or trend_key required' }, { status: 400 })
  }

  const client = sb()
  let context = ''
  let linkUrl = ''
  let sourceKind: 'article' | 'data_trend' = 'article'

  if (slug) {
    const { data: a } = await client
      .from('loro_articles')
      .select('headline, standfirst, body_html, key_facts, source_citations, lane_slug, coverage_status')
      .eq('slug', slug).single()
    if (!a) return NextResponse.json({ error: 'Article not found' }, { status: 404 })

    const facts = Array.isArray(a.key_facts) ? a.key_facts : []
    const cites = Array.isArray(a.source_citations) ? a.source_citations : []
    const plain = String(a.body_html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 2500)

    context =
      `HEADLINE: ${a.headline}\nSTANDFIRST: ${a.standfirst ?? ''}\n` +
      (facts.length ? `KEY FACTS: ${facts.map((f: { label?: string; value?: string }) =>
        `${f.label}: ${f.value}`).join('; ')}\n` : '') +
      (cites.length ? `PRIMARY SOURCES: ${cites.length} document(s) — ` +
        `${cites.map((c: { publisher?: string }) => c.publisher).filter(Boolean).slice(0,3).join(', ')}\n` : '') +
      (a.coverage_status === 'exclusive'
        ? 'NOTE: no other outlet we monitor has covered this.\n' : '') +
      `ARTICLE: ${plain}`
    linkUrl = `${SITE}/news/${slug}`
  } else {
    sourceKind = 'data_trend'
    context = `DATA FINDING: ${trend_summary}`
    linkUrl = `${SITE}/data`
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_BRIEF_MODEL || 'claude-sonnet-5',
        max_tokens: 900,
        system: SYSTEM,
        messages: [{ role: 'user', content: context }],
      }),
      signal: AbortSignal.timeout(40000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: `Anthropic ${res.status}` }, { status: 500 })
    }

    const data = await res.json()
    type Block = { type?: string; text?: string }
    const text = ((data.content ?? []) as Block[])
      .filter(b => b?.type === 'text' && b.text).map(b => b.text as string).join('').trim()
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

    let out: { linkedin?: string; x?: string; hashtags?: string[] }
    try { out = JSON.parse(cleaned) } catch {
      return NextResponse.json({ error: 'Model did not return valid JSON' }, { status: 502 })
    }
    if (!out.linkedin || !out.x) {
      return NextResponse.json({ error: 'Incomplete generation' }, { status: 502 })
    }

    const rows = [
      { platform: 'linkedin', body: out.linkedin },
      { platform: 'x', body: out.x },
    ].map(r => ({
      source_kind: sourceKind,
      article_slug: slug ?? null,
      trend_key: trend_key ?? null,
      platform: r.platform,
      body: r.body,
      link_url: linkUrl,
      hashtags: out.hashtags ?? [],
      status: 'draft',
      model: process.env.ANTHROPIC_BRIEF_MODEL || 'claude-sonnet-5',
    }))

    // Replace any existing draft for this article rather than duplicating.
    const { data: saved, error } = await client
      .from('loro_social_posts')
      .upsert(rows, { onConflict: 'article_slug,platform' })
      .select('id, platform, body, link_url, hashtags, status')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, posts: saved })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Generation failed' }, { status: 500 })
  }
}
