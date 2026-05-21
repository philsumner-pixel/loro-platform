import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[£€$]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    candidate_id,
    headline,
    standfirst,
    body_html,
    category,
    author = 'Chris Cannon',
    publication_tier = 'section',
    subscriber_only = false,
  } = body

  if (!headline || !body_html) {
    return NextResponse.json({ error: 'headline and body_html required' }, { status: 400 })
  }

  const sb = getSupabase()

  // Generate unique slug
  let slug = slugify(headline)
  const { count } = await sb
    .from('loro_articles')
    .select('id', { count: 'exact', head: true })
    .eq('slug', slug)

  if ((count ?? 0) > 0) slug = `${slug}-${Date.now()}`

  // Write to loro_articles
  const { data: article, error } = await sb
    .from('loro_articles')
    .insert({
      slug,
      headline,
      standfirst: standfirst ?? null,
      body_html,
      category: category ?? 'Payments',
      author,
      publication_tier,
      subscriber_only,
      candidate_id: candidate_id ?? null,
      published_at: new Date().toISOString(),
      seo_title: headline,
      seo_description: standfirst ?? headline,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If publishing from a candidate, update candidate status
  if (candidate_id) {
    await sb
      .from('loro_story_candidates')
      .update({
        status: 'published',
        published_slug: slug,
        published_at: new Date().toISOString(),
      })
      .eq('id', candidate_id)
  }

  return NextResponse.json({ slug, url: `/news/${slug}`, article })
}
