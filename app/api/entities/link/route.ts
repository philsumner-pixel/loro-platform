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

  // 3. Re-attach documents to candidates that were created before their entity
  //    was enriched. Of 64 candidates graded below publishable, 50 turned out
  //    not to be thin at all — the documents existed, they just were not
  //    attached yet. Without this they would sit as leads forever.
  const { data: upgraded, error: upErr } = await client.rpc('loro_upgrade_thin_candidates', {
    max_rows: 200,
  })
  if (upErr) errors.push(`upgrade: ${upErr.message}`)

  // 4. Retire leads that have had a week and still have nothing behind them,
  //    so the queue does not silently fill with things nobody can write.
  const { data: retired, error: retErr } = await client.rpc('loro_retire_stale_leads', {
    older_than_days: 7,
  })
  if (retErr) errors.push(`retire: ${retErr.message}`)

  // 5. Propose fresh match candidates for human review.
  const [co, pe] = await Promise.all([
    client.rpc('loro_propose_entity_matches', { min_similarity: 0.72, max_pairs: 100 }),
    client.rpc('loro_propose_person_matches', { min_similarity: 0.62, max_pairs: 100 }),
  ])

  return NextResponse.json({
    ok: errors.length === 0,
    linked,
    candidates_upgraded: upgraded ?? null,
    stale_leads_retired: retired ?? 0,
    new_company_candidates: co.data ?? 0,
    new_person_candidates: pe.data ?? 0,
    errors,
  })
}
