// ElevenLabs voice synthesis for Loro single-reveal narration.
// Voice IDs come from env: ELEVENLABS_VOICE_STEVE etc (copied from the Top7Labs project).

const VOICE_IDS: Record<string, string | undefined> = {
  steve: process.env.ELEVENLABS_VOICE_STEVE,
  phil: process.env.ELEVENLABS_VOICE_PHIL,
  sophie: process.env.ELEVENLABS_VOICE_SOPHIE,
  emily: process.env.ELEVENLABS_VOICE_EMILY,
  narrator: process.env.ELEVENLABS_VOICE_NARRATOR,
}

export function resolveVoiceId(persona: string): string {
  return VOICE_IDS[persona] ?? VOICE_IDS['steve'] ?? ''
}

// Light SSML: a small pause between sentences so the read doesn't rush.
// No countdown-specific logic — this is a flowing news read.
function buildSSML(narration: string): string {
  const SHORT = '<break time="450ms"/>'
  const sentences = narration.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
  return `<speak>${sentences.join(' ' + SHORT + ' ')}</speak>`
}

// A fixed line used for voice previews in the newsroom.
export const VOICE_SAMPLE_LINE = 'This is Loro. Payments intelligence, in sixty seconds.'

export async function synthesiseVoice(narration: string, voiceId: string): Promise<Buffer> {
  const ssml = buildSSML(narration)
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: ssml,
      model_id: 'eleven_multilingual_v2',
      enable_ssml_parsing: true,
      voice_settings: { stability: 0.62, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true },
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`ElevenLabs error: ${res.status} — ${errText}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

export interface Cue { text: string; start: number; end: number }

interface Alignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

// Group character-level timings into short caption cues, using OUR exact text.
function cuesFromAlignment(a: Alignment, maxWords = 6, maxChars = 34): Cue[] {
  const chars = a.characters || []
  const starts = a.character_start_times_seconds || []
  const ends = a.character_end_times_seconds || []

  const words: { text: string; start: number; end: number }[] = []
  let cur = '', curStart = -1, curEnd = 0
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (/\s/.test(c)) {
      if (cur) { words.push({ text: cur, start: curStart, end: curEnd }); cur = ''; curStart = -1 }
    } else {
      if (curStart < 0) curStart = starts[i] ?? curEnd
      cur += c
      curEnd = ends[i] ?? curEnd
    }
  }
  if (cur) words.push({ text: cur, start: curStart, end: curEnd })

  const cues: Cue[] = []
  let line: typeof words = []
  let lineChars = 0
  const flush = () => {
    if (!line.length) return
    cues.push({ text: line.map(w => w.text).join(' '), start: line[0].start, end: line[line.length - 1].end })
    line = []; lineChars = 0
  }
  for (const w of words) {
    if (line.length >= maxWords || lineChars + w.text.length > maxChars) flush()
    line.push(w); lineChars += w.text.length + 1
  }
  flush()
  return cues
}

// Synthesise with character timestamps. Captions are built from the EXACT input
// text — no speech-to-text round-trip, so brand words like "Loro" stay correct.
export async function synthesiseVoiceTimed(
  text: string, voiceId: string,
): Promise<{ audio: Buffer; cues: Cue[]; durationSec: number }> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.62, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true },
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`ElevenLabs error: ${res.status} — ${errText}`)
  }
  const data = await res.json()
  const audio = Buffer.from(data.audio_base64, 'base64')
  const align: Alignment | undefined = data.alignment ?? data.normalized_alignment
  const cues = align ? cuesFromAlignment(align) : []
  const durationSec = align?.character_end_times_seconds?.length
    ? Math.max(...align.character_end_times_seconds) : 0
  return { audio, cues, durationSec }
}
