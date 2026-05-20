import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Client created inside handlers — not at module level.
// Module-level instantiation runs at build time when env vars don't exist yet.
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

  const { data, error } = await getSupabase()
    .from('loro_story_candidates')
    .select('*')
    .in('status', statuses)
    .order('anomaly_score', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ candidates: data })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, status, discard_reason, assigned_to } = body

  if (!id || !status) {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 })
  }

  const updates: Record<string, unknown> = { status }
  if (discard_reason) updates.discard_reason = discard_reason
  if (status === 'discarded') updates.discarded_at = new Date().toISOString()
  if (assigned_to) updates.assigned_to = assigned_to

  const { data, error } = await getSupabase()
    .from('loro_story_candidates')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ candidate: data })
}
