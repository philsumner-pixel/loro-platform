// Loro Video Engine — shared types
// A "video" is a child of a signal digest. The single-reveal archetype:
// hook -> the data -> context -> what to watch -> CTA, bookended by fixed
// Loro entry/exit cards (defined in the render route, not here).

export interface LoroDataPoint {
  label: string        // e.g. "Loro Score", "Regulatory events (7d)"
  value: string        // e.g. "44.4", "3"
  delta?: string       // e.g. "-17.5", "+12" (optional)
}

export interface LoroVideoScript {
  hook: string                 // 1 punchy opening line
  headline: string             // the reveal subject (usually the entity name)
  data_points: LoroDataPoint[] // 2-4 on-screen stat cards
  context: string              // one sentence: what happened
  what_to_watch: string        // one sentence: what to watch next
  cta: string                  // closing call to action
  narration: string            // full flat voiceover text (drives ElevenLabs)
  broll_keywords: string[]     // 3-5 Pexels search terms for background footage
}

export type LoroVideoStatus =
  | 'suggested'      // script auto-drafted from a digest, awaiting journalist
  | 'script_ready'   // journalist edited/approved the script, ready to render
  | 'rendering'      // Creatomate job in flight
  | 'ready'          // mp4 available
  | 'failed'
  | 'published'

export interface LoroVideo {
  id: string
  digest_id: string | null
  entity_id: string | null
  entity_name: string | null
  script: LoroVideoScript
  voice_persona: string
  disposition: 'inbox' | 'shortlisted' | 'archived'
  audio_url: string | null
  video_url: string | null
  thumbnail_url: string | null
  creatomate_job_id: string | null
  duration_seconds: number | null
  status: LoroVideoStatus
  error: string | null
  created_by: string
  created_at: string
  script_edited_at: string | null
  rendered_at: string | null
  published_at: string | null
}

// Default voice for Loro payments intelligence: authoritative, neutral.
export const LORO_DEFAULT_VOICE = 'steve'

// Selectable voices (must match ELEVENLABS_VOICE_* env vars configured in Vercel).
export const LORO_VOICES: { id: string; label: string; hint: string }[] = [
  { id: 'steve', label: 'Steve', hint: 'Authoritative male' },
  { id: 'phil', label: 'Phil', hint: 'Warm male' },
  { id: 'sophie', label: 'Sophie', hint: 'Clear female' },
  { id: 'emily', label: 'Emily', hint: 'Bright female' },
  { id: 'narrator', label: 'Narrator', hint: 'New voice' },
]

// Consistent closing strapline shown on every exit card.
export const LORO_STRAPLINE = 'Visit Loro — subscribe for more'
