import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { citationsFromEvidence } from '@/lib/source-citations'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Strip leading and trailing hyphens.
 *
 * Deliberately not a regex. `/^-+|-+$/` is polynomial on its input: for a run of
 * N hyphens the engine retries `-+` from every start position before failing the
 * `$` anchor, so a headline of many dashes — and headlines come from the request
 * body — costs O(N²). CodeQL flags it as js/polynomial-redos, high severity, and
 * is right to. Two index walks are linear and clearer besides.
 */
function trimHyphens(s: string): string {
  let start = 0
  let end = s.length
  while (start < end && s.charCodeAt(start) === 45) start++
  while (end > start && s.charCodeAt(end - 1) === 45) end--
  return s.slice(start, end)
}

function slugify(text: string): string {
  const full = trimHyphens(
    text
      .toLowerCase()
      .replace(/[£€$]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
  )

  // Under the cap, nothing was cut — return it whole.
  if (full.length <= 80) return full

  // Truncating at a fixed length cuts mid-word and can leave a trailing hyphen,
  // e.g. '...prompting-scrutiny-of-life-scien' or '...-fragmentation-pattern-at-'.
  //
  // The previous guard read `m.length > 12 ? '' : m`, which dropped the trailing
  // fragment only when it was LONGER than twelve characters — the inverse of the
  // stated intent. Every live slug hit the cap mid-word as a result.
  //
  // Always cut back to the last whole word. If there is no earlier hyphen the
  // slug is a single long word, and a hard cut is the only option left.
  const cut = full.slice(0, 80)
  const lastHyphen = cut.lastIndexOf('-')
  return trimHyphens(lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut)
}

/**
 * Word count and reading time from rendered body HTML.
 * Strips script/style wholesale, then tags, then decodes the entities that
 * actually appear in copy, so '&amp;nbsp;' does not get counted as a word.
 */
function readingStats(html: string): { wordCount: number; readingTimeMins: number } {
  // Scanned with indexOf rather than matched with a regex, for the same reason
  // trimHyphens exists: body_html arrives from the request body, and patterns
  // like /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/ backtrack quadratically on
  // pathological input. Index scanning is linear and cannot be made to hang.
  const src = html ?? ''
  const lower = src.toLowerCase()

  let out = ''
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) { out += src.slice(i); break }
    out += src.slice(i, lt) + ' '

    // Drop script and style bodies wholesale rather than counting their contents.
    let skipTo = -1
    for (const tag of ['script', 'style'] as const) {
      if (lower.startsWith(`<${tag}`, lt)) {
        const close = lower.indexOf(`</${tag}>`, lt)
        skipTo = close === -1 ? src.length : close + tag.length + 3
        break
      }
    }
    if (skipTo !== -1) { i = skipTo; continue }

    const gt = src.indexOf('>', lt)
    if (gt === -1) break          // unterminated tag: nothing countable remains
    i = gt + 1
  }

  // Entities are bounded and unambiguous, so these stay as regexes.
  const text = out.replace(/&nbsp;/gi, ' ').replace(/&[a-z]{1,10};|&#\d{1,7};/gi, '')

  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length
  // 225 wpm is the usual figure for considered non-fiction reading.
  return { wordCount, readingTimeMins: Math.max(1, Math.round(wordCount / 225)) }
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
    answer_summary = null,
    key_facts = [],
    faq = [],
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
  let laneSlug: string | null = null
  if (candidate_id) {
    // The column is `entity_ids` (text[]). This previously read `entity_id`,
    // which does not exist, so PostgREST rejected the whole select with 42703
    // and returned null data. The error was never checked, so every article
    // ever published landed with no citations, no entity slugs, and — where
    // the candidate had one — no lane. Check the error now and log it loudly:
    // a silent failure here is invisible and expensive.
    const { data: cand, error: candErr } = await sb
      .from('loro_story_candidates')
      .select('evidence_packet, entity_ids, lane_slug')
      .eq('id', candidate_id)
      .single()

    if (candErr) {
      console.error(
        '[publish] candidate lookup failed — publishing without provenance',
        { candidate_id, code: candErr.code, message: candErr.message }
      )
    }

    if (cand?.evidence_packet) {
      sourceCitations = citationsFromEvidence(cand.evidence_packet)
    }
    // Inherit the content lane from the candidate. Without this every article
    // published through the newsroom landed with lane_slug null and never
    // appeared on its lane page or in lane-filtered listings.
    if (cand?.lane_slug) laneSlug = cand.lane_slug as string

    const primaryEntityId = cand?.entity_ids?.[0]
    if (primaryEntityId) {
      // `entity_slugs` holds slugs, not display names. Selecting `name` here
      // would have written 'Flowidea Limited' into a column that downstream
      // lookups match as 'flowidea-limited'. Fall back to name only if an
      // entity somehow has no slug, and slugify it on the way through.
      const { data: ent, error: entErr } = await sb
        .from('loro_entities').select('slug, name').eq('id', primaryEntityId).single()
      if (entErr) {
        console.error('[publish] entity lookup failed', {
          entity_id: primaryEntityId, code: entErr.code, message: entErr.message,
        })
      }
      const entitySlug = ent?.slug || (ent?.name ? slugify(ent.name) : null)
      if (entitySlug) entitySlugs = [entitySlug]
    }
  }

  // word_count and reading_time_mins are read by loro_article_performance() and
  // the social ranking, but were never written — so every published article
  // reported blanks in AI Visibility. Derive both from the body at publish time.
  const { wordCount, readingTimeMins } = readingStats(body_html)

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
      answer_summary,
      key_facts,
      faq,
      entity_slugs: entitySlugs,
      lane_slug: laneSlug,
      word_count: wordCount,
      reading_time_mins: readingTimeMins,
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

    // Editorial audit trail. Best-effort: a failure here must never block a
    // publish that has already succeeded, but it should be visible in logs.
    const { error: auditErr } = await sb.from('loro_editorial_events').insert({
      candidate_id,
      actor: author,
      action: 'published',
      to_status: 'published',
      note: `${slug} · ${wordCount} words · ${sourceCitations.length} citations`,
    })
    if (auditErr) console.error('[publish] audit write failed', auditErr.message)
  }

  return NextResponse.json({ slug, url: `/news/${slug}`, article })
}
