import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// GET: the Video tab payload — existing videos + recent signals available to draft from.
export async function GET() {
  const db = sb()

  const { data: videos } = await db
    .from('loro_videos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  const { data: digests } = await db
    .from('loro_signal_digests')
    .select('id, entity_name, trigger_type, score_delta, triggered_at, status, trigger_summary')
    .order('triggered_at', { ascending: false })
    .limit(30)

  const videoDigestIds = new Set((videos ?? []).map(v => v.digest_id).filter(Boolean))
  const sources = (digests ?? []).map(d => ({
    id: d.id,
    entity_name: d.entity_name,
    trigger_type: d.trigger_type,
    score_delta: d.score_delta,
    triggered_at: d.triggered_at,
    digest_status: d.status,
    trigger_summary: d.trigger_summary,
    has_video: videoDigestIds.has(d.id),
  }))

  return NextResponse.json({ videos: videos ?? [], sources })
}

// PATCH: save a journalist-edited script (and/or move status / change voice).
export async function PATCH(req: NextRequest) {
  const { id, script, status, voice_persona } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (script !== undefined) {
    updates.script = script
    updates.script_edited_at = new Date().toISOString()
  }
  if (status) updates.status = status
  if (voice_persona) updates.voice_persona = voice_persona

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const { data, error } = await sb()
    .from('loro_videos')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ video: data })
}
