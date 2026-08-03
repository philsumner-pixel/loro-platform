import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const statusParam = searchParams.get('status') || 'new,shortlisted,in_draft'
  const statuses = statusParam.split(',').map(s => s.trim())

  const sb = getSupabase()

  // Keep the inbox usable: anything left unreviewed in 'new' for more than
  // 7 days moves to 'expired' (recoverable from the Archive tab). Runs on
  // load so the inbox is always current without needing another cron.
  await sb.rpc('loro_expire_stale_candidates', { days_old: 7 })

  const { data: candidates, error } = await sb
    .from('loro_story_candidates')
    .select('*')
    .in('status', statuses)
    .order('anomaly_score', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch coverage links for each candidate
  const ids = (candidates ?? []).map(c => c.id)
  const { data: coverage } = ids.length
    ? await sb
        .from('loro_story_coverage')
        .select('candidate_id, publication, headline, url, published_at, angle_taken, similarity_score')
        .in('candidate_id', ids)
        .order('similarity_score', { ascending: false })
    : { data: [] }

  // Group coverage by candidate
  type CoverageItem = { candidate_id: string; publication: string; headline: string; url: string | null; published_at: string | null; angle_taken: string | null; similarity_score: number | null }
  const coverageMap: Record<string, CoverageItem[]> = {}
  for (const item of (coverage ?? []) as CoverageItem[]) {
    if (!coverageMap[item.candidate_id]) coverageMap[item.candidate_id] = []
    coverageMap[item.candidate_id]!.push(item)
  }

  const enriched = (candidates ?? []).map(c => ({
    ...c,
    coverage_links: coverageMap[c.id] ?? [],
  }))

  // Real counts across every status, so tab badges don't just reflect the
  // currently-loaded tab (Archive/Published previously always showed 0).
  const { data: allStatuses } = await sb
    .from('loro_story_candidates')
    .select('status')
  const statusCounts: Record<string, number> = {}
  for (const row of (allStatuses ?? []) as Array<{ status: string }>) {
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1
  }

  return NextResponse.json({ candidates: enriched, statusCounts })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, status, discard_reason, assigned_to } = body

  if (!id || !status) {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 })
  }

  const sb = getSupabase()
  const updates: Record<string, unknown> = { status }
  if (discard_reason) updates.discard_reason = discard_reason
  if (status === 'discarded') updates.discarded_at = new Date().toISOString()
  if (assigned_to) updates.assigned_to = assigned_to

  // Restoring OUT of the archive: clear the discard trail and reset the clock
  // so it doesn't immediately auto-expire again. Only do this when the row is
  // actually archived — otherwise an ordinary status write (or a no-op refresh)
  // would reset detected_at and make an old story look brand new.
  if (status === 'new' || status === 'shortlisted') {
    const { data: current } = await sb
      .from('loro_story_candidates')
      .select('status')
      .eq('id', id)
      .single()
    if (current && (current.status === 'discarded' || current.status === 'expired')) {
      updates.discarded_at = null
      updates.discard_reason = null
      updates.detected_at = new Date().toISOString()
    }
  }

  const { data, error } = await sb
    .from('loro_story_candidates')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ candidate: data })
}
