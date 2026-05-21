import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Batch embedding pipeline — runs against unembedded records
// Uses structured domain-aware inputs (not raw text) for quality
// OpenAI text-embedding-3-small: 1536 dimensions, up to 2048 inputs per call
//
// Cron: every 30 minutes (runs after ingest + pattern detection)
// Manual: GET /api/embed?table=news   — embed news_coverage
//         GET /api/embed?table=candidates — embed story_candidates
//         GET /api/embed (no param) — both tables

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'text-embedding-3-small'
const BATCH_SIZE = 50  // conservative — each input can be long

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function embedBatch(texts: string[]): Promise<number[][] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI embeddings error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.data.map((d: { embedding: number[] }) => d.embedding)
}

async function embedNewsCoverage(sb: ReturnType<typeof getSupabase>) {
  // Fetch unembedded news coverage with structured input text
  const { data: rows } = await sb
    .from('loro_news_coverage')
    .select('id')
    .is('embedding', null)
    .not('headline', 'is', null)
    .limit(BATCH_SIZE)

  if (!rows?.length) return { processed: 0, embedded: 0 }

  // Build structured embedding inputs using SQL function
  const inputs: Array<{ id: string; text: string }> = []
  for (const row of rows) {
    const { data: text } = await sb.rpc('build_news_embedding_input', {
      coverage_id: row.id,
    })
    if (text) inputs.push({ id: row.id, text })
  }

  if (!inputs.length) return { processed: rows.length, embedded: 0 }

  // Batch embed
  const embeddings = await embedBatch(inputs.map(i => i.text))
  if (!embeddings) return { processed: rows.length, embedded: 0 }

  // Store with provenance
  let embedded = 0
  for (let i = 0; i < inputs.length; i++) {
    const { error } = await sb
      .from('loro_news_coverage')
      .update({
        embedding: JSON.stringify(embeddings[i]),
        embedding_model: MODEL,
        embedding_input: inputs[i].text,
      })
      .eq('id', inputs[i].id)

    if (!error) embedded++
  }

  return { processed: rows.length, embedded }
}

async function embedCandidates(sb: ReturnType<typeof getSupabase>) {
  const { data: rows } = await sb
    .from('loro_story_candidates')
    .select('id')
    .is('embedding', null)
    .neq('status', 'discarded')
    .limit(BATCH_SIZE)

  if (!rows?.length) return { processed: 0, embedded: 0 }

  const inputs: Array<{ id: string; text: string }> = []
  for (const row of rows) {
    const { data: text } = await sb.rpc('build_candidate_embedding_input', {
      candidate_id: row.id,
    })
    if (text) inputs.push({ id: row.id, text })
  }

  if (!inputs.length) return { processed: rows.length, embedded: 0 }

  const embeddings = await embedBatch(inputs.map(i => i.text))
  if (!embeddings) return { processed: rows.length, embedded: 0 }

  let embedded = 0
  for (let i = 0; i < inputs.length; i++) {
    const { error } = await sb
      .from('loro_story_candidates')
      .update({
        embedding: JSON.stringify(embeddings[i]),
        embedding_model: MODEL,
        embedding_input: inputs[i].text,
      })
      .eq('id', inputs[i].id)

    if (!error) embedded++
  }

  return { processed: rows.length, embedded }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      error: 'OPENAI_API_KEY not set — add to Vercel environment variables',
      hint: 'Without this key the system falls back to keyword matching for novelty checking'
    }, { status: 503 })
  }

  const table = req.nextUrl.searchParams.get('table')
  const sb = getSupabase()
  const results: Record<string, unknown> = {}

  try {
    if (!table || table === 'news') {
      results.news_coverage = await embedNewsCoverage(sb)
    }
    if (!table || table === 'candidates') {
      results.story_candidates = await embedCandidates(sb)
    }

    // Summary stats
    const { count: newsTotal } = await sb
      .from('loro_news_coverage')
      .select('*', { count: 'exact', head: true })
    const { count: newsEmbedded } = await sb
      .from('loro_news_coverage')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null)
    const { count: candTotal } = await sb
      .from('loro_story_candidates')
      .select('*', { count: 'exact', head: true })
    const { count: candEmbedded } = await sb
      .from('loro_story_candidates')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null)

    return NextResponse.json({
      results,
      model: MODEL,
      corpus_coverage: {
        news_coverage: `${newsEmbedded}/${newsTotal} embedded`,
        story_candidates: `${candEmbedded}/${candTotal} embedded`,
      },
    })

  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Unknown error',
      results,
    }, { status: 500 })
  }
}
