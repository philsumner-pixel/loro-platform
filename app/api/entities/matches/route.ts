import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Entity resolution review queue.
//
// Fuzzy matches are never applied automatically — a wrong merge asserts in
// published journalism that two real organisations or people are one. This
// serves candidates for a human to decide, and applies the decision.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? 'pending'

  try {
    const client = sb()
    const { data } = await client
      .from('loro_entity_matches')
      .select('id, entity_a, entity_b, similarity, match_reason, evidence, status, decided_by, decided_at')
      .eq('status', status)
      .order('similarity', { ascending: false })
      .limit(100)

    const { data: counts } = await client
      .from('loro_entity_matches')
      .select('status')
      .limit(5000)

    const tally: Record<string, number> = {}
    for (const c of counts ?? []) tally[c.status as string] = (tally[c.status as string] ?? 0) + 1

    return NextResponse.json({ matches: data ?? [], counts: tally })
  } catch {
    return NextResponse.json({ matches: [], counts: {}, error: true })
  }
}

export async function POST(req: Request) {
  try {
    const { match_id, decision, keep_entity, note, decided_by } = await req.json()
    if (!match_id || !['confirmed', 'rejected'].includes(decision)) {
      return NextResponse.json({ error: 'match_id and decision (confirmed|rejected) required' }, { status: 400 })
    }

    const { data, error } = await sb().rpc('loro_decide_entity_match', {
      match_id,
      decision,
      decided_by_name: decided_by ?? 'newsroom',
      keep_entity: keep_entity ?? null,
      note_text: note ?? null,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}

// Generate fresh candidates.
export async function PUT() {
  try {
    const client = sb()
    const [co, pe] = await Promise.all([
      client.rpc('loro_propose_entity_matches', { min_similarity: 0.72, max_pairs: 150 }),
      client.rpc('loro_propose_person_matches', { min_similarity: 0.62, max_pairs: 150 }),
    ])
    return NextResponse.json({
      ok: true,
      company_candidates: co.data ?? 0,
      person_candidates: pe.data ?? 0,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
