import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Keep entity linkage current as new records arrive.
//
// Companies join on a registration number. People have no identifier anywhere
// in the register, so the only join available is the normalised name — which is
// why the merge queue exists, and why this must run after every ingest rather
// than once.

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
  const errors: string[] = []

  // 1. Create person entities for donors we have not seen before.
  const { error: createErr } = await client.rpc('loro_create_person_entities')
  if (createErr) errors.push(`create: ${createErr.message}`)

  // 2. Link donation events to them, following canonical_id so events land on
  //    the surviving entity after a merge.
  const { data: linked, error: linkErr } = await client.rpc('loro_link_person_events')
  if (linkErr) errors.push(`link: ${linkErr.message}`)

  // 3. Propose fresh match candidates for human review.
  const [co, pe] = await Promise.all([
    client.rpc('loro_propose_entity_matches', { min_similarity: 0.72, max_pairs: 100 }),
    client.rpc('loro_propose_person_matches', { min_similarity: 0.62, max_pairs: 100 }),
  ])

  return NextResponse.json({
    ok: errors.length === 0,
    linked,
    new_company_candidates: co.data ?? 0,
    new_person_candidates: pe.data ?? 0,
    errors,
  })
}
