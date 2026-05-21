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

  return NextResponse.json({ candidates: enriched })
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

  const { data, error } = await sb
    .from('loro_story_candidates')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ candidate: data })
}
