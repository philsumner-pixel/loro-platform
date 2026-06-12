// ElevenLabs voice synthesis for Loro single-reveal narration.
// Voice IDs come from env: ELEVENLABS_VOICE_STEVE etc (copied from the Top7Labs project).

const VOICE_IDS: Record<string, string | undefined> = {
  steve: process.env.ELEVENLABS_VOICE_STEVE,
  phil: process.env.ELEVENLABS_VOICE_PHIL,
  sophie: process.env.ELEVENLABS_VOICE_SOPHIE,
  emily: process.env.ELEVENLABS_VOICE_EMILY,
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
