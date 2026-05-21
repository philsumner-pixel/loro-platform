import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function POST(req: NextRequest) {
  const { candidate_id, vote, journalist = 'Chris Cannon', note } = await req.json()

  if (!candidate_id || !['up', 'down'].includes(vote)) {
    return NextResponse.json({ error: 'candidate_id and vote (up|down) required' }, { status: 400 })
  }

  const sb = getSupabase()

  // Log the vote
  await sb.from('loro_angle_votes').insert({ candidate_id, vote, journalist, note: note ?? null })

  // Update aggregate counts
  const field = vote === 'up' ? 'angle_votes_up' : 'angle_votes_down'
  const { data: current } = await sb
    .from('loro_story_candidates')
    .select('angle_votes_up, angle_votes_down')
    .eq('id', candidate_id)
    .single()

  if (current) {
    await sb.from('loro_story_candidates').update({
      [field]: (current[field as keyof typeof current] as number) + 1,
    }).eq('id', candidate_id)
  }

  return NextResponse.json({ ok: true, vote })
}
