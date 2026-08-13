import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// The social queue: read drafts, approve or reject, edit, schedule.
// Nothing reaches a platform without passing through here.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get('status') ?? 'draft'
  try {
    const client = sb()
    const [postsRes, candRes, countRes] = await Promise.all([
      client.from('loro_social_posts')
        .select('*').eq('status', status)
        .order('created_at', { ascending: false }).limit(60),
      client.rpc('loro_social_candidates', { max_rows: 20 }),
      client.from('loro_social_posts').select('status').limit(2000),
    ])

    const counts: Record<string, number> = {}
    for (const r of countRes.data ?? []) counts[r.status as string] = (counts[r.status as string] ?? 0) + 1

    return NextResponse.json({
      posts: postsRes.data ?? [],
      candidates: candRes.data ?? [],
      counts,
    })
  } catch {
    return NextResponse.json({ posts: [], candidates: [], counts: {}, error: true })
  }
}

export async function POST(req: Request) {
  try {
    const { id, action, body, scheduled_for, approved_by } = await req.json()
    if (!id || !action) {
      return NextResponse.json({ error: 'id and action required' }, { status: 400 })
    }
    const client = sb()

    if (action === 'reject') {
      await client.from('loro_social_posts')
        .update({ status: 'rejected', approved_by: approved_by ?? null, approved_at: new Date().toISOString() })
        .eq('id', id)
      return NextResponse.json({ ok: true, status: 'rejected' })
    }

    if (action === 'save') {
      // An edit is recorded, so it is visible later whether a human rewrote the
      // machine's words — useful when judging whether generation is good enough.
      await client.from('loro_social_posts')
        .update({ body, edited: true }).eq('id', id)
      return NextResponse.json({ ok: true, status: 'saved' })
    }

    if (action === 'approve' || action === 'schedule') {
      if (!approved_by) {
        return NextResponse.json(
          { error: 'approved_by required — posts are recorded against the person who approved them' },
          { status: 400 })
      }
      const patch: Record<string, unknown> = {
        status: scheduled_for ? 'scheduled' : 'approved',
        approved_by,
        approved_at: new Date().toISOString(),
      }
      if (body) { patch.body = body; patch.edited = true }
      if (scheduled_for) patch.scheduled_for = scheduled_for
      await client.from('loro_social_posts').update(patch).eq('id', id)
      return NextResponse.json({ ok: true, status: patch.status })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
