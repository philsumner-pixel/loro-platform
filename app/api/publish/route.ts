import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { citationsFromEvidence } from '@/lib/source-citations'

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
    author = 'Loro Staff Writers',
    publication_tier = 'section',
    subscriber_only = false,
    lead_image_url = null,
    lead_image_alt = null,
    lead_image_caption = null,
    lead_image_credit = null,
    seo_title = null,
    seo_description = null,
    seo_keywords = null,
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

  // Derive machine-readable provenance from the originating candidate: the
  // primary filings this story came from, with resolvable URLs. Emitted as
  // schema.org citation / isBasedOn — the citability claim made verifiable.
  let sourceCitations: ReturnType<typeof citationsFromEvidence> = []
  let entitySlugs: string[] = []
  if (candidate_id) {
    const { data: cand } = await sb
      .from('loro_story_candidates')
      .select('evidence_packet, entity_id')
      .eq('id', candidate_id)
      .single()
    if (cand?.evidence_packet) {
      sourceCitations = citationsFromEvidence(cand.evidence_packet)
    }
    if (cand?.entity_id) {
      const { data: ent } = await sb
        .from('loro_entities').select('name').eq('id', cand.entity_id).single()
      if (ent?.name) entitySlugs = [ent.name]
    }
  }

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
      lead_image_url,
      lead_image_alt,
      lead_image_caption,
      lead_image_credit,
      publication_tier,
      subscriber_only,
      candidate_id: candidate_id ?? null,
      published_at: new Date().toISOString(),
      seo_title: seo_title ?? headline,
      seo_description: seo_description ?? standfirst ?? headline,
      seo_keywords,
      source_citations: sourceCitations,
      entity_slugs: entitySlugs,
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
