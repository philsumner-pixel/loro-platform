import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/ingest/utils'

// Runs after pattern detection — classifies each unchecked candidate
// Layer 1: semantic vs loro_articles (internal corpus)
// Layer 2: semantic vs loro_news_coverage (live news, last 30 days)  
// Layer 3: NewsAPI point-in-time web search (catches last few hours)

export const runtime = 'nodejs'
export const maxDuration = 60

const SIMILARITY_THRESHOLD_COVERED = 0.82  // above this = covered
const SIMILARITY_THRESHOLD_LIGHT = 0.70    // between these = lightly covered

async function embedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null  // fallback to keyword matching if no key

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}

async function checkNewsApi(headline: string): Promise<Array<{
  source: string
  title: string
  url: string
  publishedAt: string
}>> {
  const newsApiKey = process.env.NEWS_API_KEY
  if (!newsApiKey) return []

  // Extract key entity/concept words from headline for targeted search
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'their', 'this', 'that', 'have', 'has', 'had', 'are', 'were', 'been', 'being', 'will', 'would', 'could', 'should', 'may', 'might'])
  const keywords = headline
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9£€$]/g, ''))
    .filter(w => w.length > 3 && !stopWords.has(w.toLowerCase()))
    .slice(0, 5)
    .join(' ')

  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(keywords)}&sortBy=publishedAt&pageSize=5&language=en&from=${new Date(Date.now() - 30 * 24 * 3600000).toISOString().split('T')[0]}`
    const res = await fetch(url, {
      headers: { 'X-Api-Key': newsApiKey },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.articles ?? []).map((a: { source: { name: string }; title: string; url: string; publishedAt: string }) => ({
      source: a.source?.name ?? 'Unknown',
      title: a.title,
      url: a.url,
      publishedAt: a.publishedAt,
    }))
  } catch {
    return []
  }
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = getSupabase()

  // Get unchecked candidates
  const { data: candidates } = await sb
    .from('loro_story_candidates')
    .select('id, headline, standfirst, category, evidence_packet')
    .eq('novelty_status', 'unchecked')
    .neq('status', 'discarded')
    // 20 exceeds the 60s limit: each candidate runs three checks including a
    // web search, so a full batch strands the tail in 'checking'. 8 completes
    // reliably and the cron runs every 2 hours.
    .limit(Math.min(Number(new URL(req.url).searchParams.get('batch') ?? 8), 15))

  if (!candidates?.length) {
    return NextResponse.json({ message: 'No unchecked candidates' })
  }

  let checked = 0
  const results: Array<{ id: string; status: string; layers: string[] }> = []

  for (const candidate of candidates) {
    // Build structured embedding input — domain-aware, not raw text
    // This is what makes Loro's semantic layer different from generic NLP
    const { data: embeddingInput } = await sb.rpc('build_candidate_embedding_input', {
      candidate_id: candidate.id,
    })
    const checkText = embeddingInput ?? `${candidate.headline}. ${candidate.standfirst ?? ''}`
    const checks: Array<{ layer: string; result: string; evidence: Record<string, unknown> }> = []
    // Coverage means EXTERNAL coverage. Whether Loro has published something
    // similar is tracked separately — it is a duplication question, not a
    // novelty one.
    let overallStatus = 'novel'
    let selfCovered = false

    // Mark as checking
    await sb.from('loro_story_candidates')
      .update({ novelty_status: 'checking' })
      .eq('id', candidate.id)

    // ── Layer 1: Internal corpus check ─────────────────────────────────
    const embedding = await embedText(checkText)

    if (embedding) {
      // Store embedding with provenance — model name and exact input text
      await sb.from('loro_story_candidates')
        .update({
          embedding,
          embedding_model: 'text-embedding-3-small',
          embedding_input: checkText,
        })
        .eq('id', candidate.id)

      // Check against our own PUBLISHED articles.
      //
      // NB1: never compare against the unreviewed candidate queue — that made
      // each repeat candidate match yesterday's queued copy.
      //
      // NB2: this layer answers "have WE already covered this", which is a
      // DIFFERENT question from "is this novel to the world". It must not
      // decide the overall verdict. Detector headlines are templated
      // ("X: filing activity 6x above its own baseline"), so a candidate about
      // one company matched our published article about a DIFFERENT company at
      // 0.82 — the phrasing matched, not the story. That single layer was
      // overriding live_news and web_search, which both correctly said novel
      // in 55 of 55 and 51 of 55 checks.
      const { data: similarArticles } = await sb.rpc('loro_similar_candidates', {
        query_embedding: embedding,
        similarity_threshold: SIMILARITY_THRESHOLD_LIGHT,
        max_results: 5,
      })

      // Only a near-identical match counts as us having already covered it,
      // and it is recorded as 'self_covered' rather than folded into the
      // external coverage verdict.
      const SELF_DUPLICATE = 0.93

      if (similarArticles?.length) {
        const maxSim = Math.max(...similarArticles.map((a: { similarity: number }) => a.similarity))
        selfCovered = maxSim >= SELF_DUPLICATE
        checks.push({
          layer: 'internal_corpus',
          result: selfCovered ? 'self_covered' : 'novel',
          evidence: {
            similar_articles: similarArticles,
            max_similarity: maxSim,
            note: selfCovered
              ? 'Near-identical to something Loro has already published'
              : 'Similar phrasing to our own output, but a different story — not treated as coverage',
          },
        })
      } else {
        checks.push({ layer: 'internal_corpus', result: 'novel', evidence: { similar_articles: [] } })
      }

      // ── Layer 2: Live news coverage check ─────────────────────────────
      const { data: similarNews } = await sb.rpc('loro_similar_news', {
        query_embedding: embedding,
        similarity_threshold: SIMILARITY_THRESHOLD_LIGHT,
        days_back: 30,
        max_results: 10,
      })

      if (similarNews?.length) {
        const maxSim = Math.max(...similarNews.map((n: { similarity: number }) => n.similarity))
        const newsResult = maxSim >= SIMILARITY_THRESHOLD_COVERED ? 'widely_covered'
          : maxSim >= SIMILARITY_THRESHOLD_LIGHT ? 'lightly_covered' : 'novel'
        checks.push({
          layer: 'live_news',
          result: newsResult,
          evidence: {
            similar_coverage: similarNews.slice(0, 5),
            max_similarity: maxSim,
            publications: [...new Set(similarNews.map((n: { publication: string }) => n.publication))],
          },
        })
        if (newsResult === 'widely_covered') overallStatus = 'widely_covered'
        else if (newsResult === 'lightly_covered' && overallStatus === 'novel') overallStatus = 'lightly_covered'

        // Also write to story_coverage for journalist context
        for (const item of similarNews.slice(0, 3)) {
          await sb.from('loro_story_coverage').upsert({
            candidate_id: candidate.id,
            publication: item.publication,
            url: item.url,
            headline: item.headline,
            published_at: item.published_at,
            similarity_score: item.similarity,
          }, { onConflict: 'candidate_id,url' }).select()
        }
      } else {
        checks.push({ layer: 'live_news', result: 'novel', evidence: { similar_coverage: [] } })
      }

    } else {
      // No embedding — fall back to keyword matching
      const { data: keywordMatches } = await sb.rpc('check_novelty_keywords', {
        candidate_headline: candidate.headline,
        days_back: 30,
      })
      const hasMatches = (keywordMatches?.length ?? 0) > 0
      checks.push({
        layer: 'live_news_keywords',
        result: hasMatches ? 'lightly_covered' : 'novel',
        evidence: { matches: keywordMatches ?? [], method: 'keyword_fallback' },
      })
      if (hasMatches && overallStatus === 'novel') overallStatus = 'lightly_covered'
    }

    // ── Layer 3: NewsAPI point-in-time check ────────────────────────────
    const newsApiResults = await checkNewsApi(candidate.headline)
    if (newsApiResults.length > 0) {
      checks.push({
        layer: 'web_search',
        result: newsApiResults.length >= 5 ? 'widely_covered' : 'lightly_covered',
        evidence: { results: newsApiResults, result_count: newsApiResults.length },
      })
      if (newsApiResults.length >= 5) overallStatus = 'widely_covered'
      else if (overallStatus === 'novel') overallStatus = 'lightly_covered'
    } else {
      checks.push({ layer: 'web_search', result: 'novel', evidence: { results: [] } })
    }

    // Generate coverage summary for journalist
    const allCoverage = checks.flatMap(c =>
      (c.evidence.similar_coverage as Array<{ publication: string; headline: string }> ?? [])
        .map((n) => n.publication)
    ).filter(Boolean)
    const uniquePubs = [...new Set(allCoverage)]

    const coverageSummary = uniquePubs.length > 0
      ? `Coverage found in: ${uniquePubs.join(', ')}. `
        + (overallStatus === 'widely_covered'
          ? 'Widely covered — focus editorial on Loro-specific angle.'
          : 'Lightly covered — opportunity for Loro to own the depth play.')
      : 'No coverage found across monitored publications or NewsAPI. Novel signal.'

    const noveltyNote = overallStatus === 'novel'
      ? 'No comparable coverage found across three novelty checking layers (internal corpus, live news monitoring, web search). Confidence: high.'
      : overallStatus === 'lightly_covered'
        ? `Lightly covered (${uniquePubs.join(', ')}). Loro can own the depth or angle play.`
        : `Widely covered (${uniquePubs.join(', ')}). Publish to archive tier — look for specific Loro angle.`

    // Generate AI angle hypothesis using Anthropic API
    let aiAngle: string | null = null
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (anthropicKey && checks.length > 0) {
      try {
        const coverageContext = checks
          .flatMap(c => (c.evidence.similar_coverage as Array<{publication: string; headline: string; url: string}> ?? []))
          .slice(0, 4)
          .map(n => `• ${n.publication}: "${n.headline}"`)
          .join('\n')

        const newsApiContext = (checks.find(c => c.layer === 'web_search')?.evidence?.results as Array<{source: string; title: string}> ?? [])
          .slice(0, 3)
          .map(n => `• ${n.source}: "${n.title}"`)
          .join('\n')

        const allCoverageText = [coverageContext, newsApiContext].filter(Boolean).join('\n')

        const pkt = (candidate as { evidence_packet?: {
        source_events?: Array<{ date?: string; register?: string; title?: string }>
        company_number?: string } }).evidence_packet

      const prompt = `You are an editorial intelligence engine for Loro, an independent payments intelligence publication.

DETECTED SIGNAL:
Headline: ${candidate.headline}
Category: ${candidate.category}
Pattern: ${overallStatus === 'novel' ? 'Novel — no existing coverage found' : 'Existing coverage found'}

${allCoverageText ? `EXISTING COVERAGE:\n${allCoverageText}` : 'NO COVERAGE FOUND — this signal appears to be novel.'}

EVIDENCE ATTACHED: ${(pkt?.source_events?.length ?? 0)} source document(s).
${(pkt?.source_events ?? []).slice(0,4).map((d: { date?: string; register?: string; title?: string }) =>
  `- ${d.date ?? ''} ${d.register ?? ''}: ${d.title ?? ''}`).join('\n') || '- none'}

Suggest in 2-3 sentences what a journalist should CHECK next.

RULES
- Work only from the evidence above. If it names no documents, say what would
  need to be obtained to stand the story up — do not construct a thesis.
- Never speculate about strategy, motive or market context that the documents
  do not support. A confident narrative built on a bare filing count reads as
  authoritative and is the most dangerous thing this engine can produce.
- Be concrete: name the document, the register, the question.`

        // No angle at all on thin evidence. A speculative narrative attached to
        // a candidate a journalist cannot stand up is worse than silence.
                const docCount = pkt?.source_events?.length ?? 0
        const registerBacked = Boolean(pkt?.company_number)
        if (docCount === 0 && !registerBacked) {
          aiAngle = null
        } else {

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{ role: 'user', content: prompt }],
          }),
          signal: AbortSignal.timeout(15000),
        })

        if (res.ok) {
          const data = await res.json()
          aiAngle = data.content?.[0]?.text ?? null
        }
        }
      } catch {
        // Angle generation is best-effort — don't fail the whole check
      }
    }

    // Update candidate with novelty results + AI angle
    await sb.from('loro_story_candidates')
      .update({
        novelty_status: overallStatus,
        novelty_note: selfCovered
          ? `${noveltyNote} (Loro has already published something near-identical — check before drafting.)`
          : noveltyNote,
        novelty_checked_at: new Date().toISOString(),
        coverage_summary: coverageSummary.length > 0 ? coverageSummary : null,
        ...(aiAngle ? { loro_angle_hypothesis: aiAngle, ai_angle_generated: true } : {}),
      })
      .eq('id', candidate.id)

    // Log each check layer
    for (const check of checks) {
      await sb.from('loro_novelty_checks').insert({
        candidate_id: candidate.id,
        check_layer: check.layer.replace('_keywords', '').replace('_keywords', '') as 'internal_corpus' | 'live_news' | 'web_search',
        result: check.result as 'novel' | 'lightly_covered' | 'widely_covered' | 'inconclusive',
        evidence: check.evidence,
        matches_found: (check.evidence.similar_articles as unknown[] ?? check.evidence.similar_coverage as unknown[] ?? check.evidence.results as unknown[] ?? []).length,
      })
    }

    results.push({ id: candidate.id, status: overallStatus, layers: checks.map(c => c.layer) })
    checked++

    // Brief pause between candidates
    await new Promise(r => setTimeout(r, 200))
  }

  return NextResponse.json({ candidates_checked: checked, results })
}
