import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getRenderStatus } from '@/lib/video/creatomate'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = sb()
  const { data: video } = await db.from('loro_videos').select('*').eq('id', id).single()
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  if (!video.creatomate_job_id) return NextResponse.json({ status: video.status, ready: false })

  try {
    const job = await getRenderStatus(video.creatomate_job_id)
    const ready = job.status === 'succeeded'
    const failed = job.status === 'failed'

    if (ready && job.url && video.status !== 'ready') {
      await db.from('loro_videos').update({
        status: 'ready', video_url: job.url, rendered_at: new Date().toISOString(),
      }).eq('id', id)
    } else if (failed && video.status !== 'failed') {
      await db.from('loro_videos').update({ status: 'failed', error: 'Creatomate render failed' }).eq('id', id)
    }

    return NextResponse.json({ status: job.status, ready, video_url: job.url ?? video.video_url ?? null })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
