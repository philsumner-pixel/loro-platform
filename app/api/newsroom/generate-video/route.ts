import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveVoiceId, synthesiseVoice } from '@/lib/video/elevenlabs'
import { normaliseText } from '@/lib/video/text-normalize'
import { sourcePhotos } from '@/lib/video/pexels'
import { submitRender } from '@/lib/video/creatomate'
import { buildLoroRenderSource } from '@/lib/video/render-source'
import { LORO_DEFAULT_VOICE, type LoroVideoScript } from '@/lib/loro-video'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function POST(req: NextRequest) {
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = sb()
  const { data: video } = await db.from('loro_videos').select('*').eq('id', id).single()
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 })

  const script = video.script as LoroVideoScript
  if (!script?.narration) return NextResponse.json({ error: 'Script has no narration' }, { status: 400 })

  try {
    await db.from('loro_videos').update({ status: 'rendering', error: null }).eq('id', id)

    // 1. Voice
    const voiceId = resolveVoiceId(video.voice_persona || LORO_DEFAULT_VOICE)
    if (!voiceId) return NextResponse.json({ error: 'No ElevenLabs voice id configured' }, { status: 500 })
    const audioBuffer = await synthesiseVoice(normaliseText(script.narration), voiceId)

    // 2. Store audio
    const filename = `${id}-${Date.now()}.mp3`
    const { error: upErr } = await db.storage.from('loro-video-audio')
      .upload(filename, audioBuffer, { contentType: 'audio/mpeg', upsert: true })
    if (upErr) throw upErr
    const { data: urlData } = db.storage.from('loro-video-audio').getPublicUrl(filename)
    const audioUrl = urlData.publicUrl

    // 3. B-roll — one photo per content scene, in scene order
    const kws = (Array.isArray(script.broll_keywords) ? script.broll_keywords : []).filter(Boolean)
    const kw = (i: number) => kws.length ? kws[i % kws.length] : `${video.entity_name} payments fintech`
    const dataCount = Array.isArray(script.data_points) ? script.data_points.length : 0
    const queries: string[] = [kw(0)]
    for (let i = 0; i < dataCount; i++) queries.push(kw(i + 1))
    queries.push(kw(dataCount + 1), kw(dataCount + 2))
    const brollUrls = await sourcePhotos(queries)

    // 4. Assemble + submit
    const source = buildLoroRenderSource(script, audioUrl, brollUrls, video.entity_name || 'Loro')
    const job = await submitRender(source)

    await db.from('loro_videos').update({
      audio_url: audioUrl,
      creatomate_job_id: job.id,
      status: 'rendering',
      video_url: job.url ?? null,
    }).eq('id', id)

    return NextResponse.json({ job_id: job.id, status: job.status, audio_url: audioUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('generate-video error:', message)
    await db.from('loro_videos').update({ status: 'failed', error: message }).eq('id', id)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
