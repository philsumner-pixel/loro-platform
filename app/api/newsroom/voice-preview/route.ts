import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveVoiceId, synthesiseVoice, VOICE_SAMPLE_LINE } from '@/lib/video/elevenlabs'
import { LORO_VOICES } from '@/lib/loro-video'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function GET(req: NextRequest) {
  const persona = new URL(req.url).searchParams.get('persona') || ''
  if (!LORO_VOICES.some(v => v.id === persona)) {
    return NextResponse.json({ error: 'Unknown voice' }, { status: 400 })
  }

  const db = sb()
  const path = `voice-samples/${persona}.mp3`

  // Serve cached sample if it exists
  try {
    const { data: files } = await db.storage.from('loro-video-audio').list('voice-samples', { search: `${persona}.mp3` })
    if (files?.some(f => f.name === `${persona}.mp3`)) {
      const { data } = db.storage.from('loro-video-audio').getPublicUrl(path)
      return NextResponse.json({ url: data.publicUrl, cached: true })
    }
  } catch { /* fall through to generate */ }

  // Generate, cache, return
  try {
    const voiceId = resolveVoiceId(persona)
    if (!voiceId) return NextResponse.json({ error: 'Voice not configured' }, { status: 500 })
    const audio = await synthesiseVoice(VOICE_SAMPLE_LINE, voiceId)
    const { error } = await db.storage.from('loro-video-audio')
      .upload(path, audio, { contentType: 'audio/mpeg', upsert: true })
    if (error) throw error
    const { data } = db.storage.from('loro-video-audio').getPublicUrl(path)
    return NextResponse.json({ url: data.publicUrl, cached: false })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
