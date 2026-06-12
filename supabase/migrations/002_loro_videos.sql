-- Loro Video Engine v1 — applied to Supabase jnxhxqwbysrylnoqigdd 2026-06-12
-- A video is a child of a signal digest (the suggestion inbox).
CREATE TABLE IF NOT EXISTS loro_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_id UUID REFERENCES loro_signal_digests(id) ON DELETE SET NULL,
  entity_id UUID REFERENCES loro_entities(id) ON DELETE SET NULL,
  entity_name TEXT,
  script JSONB NOT NULL DEFAULT '{}'::jsonb,
  voice_persona TEXT NOT NULL DEFAULT 'steve',
  audio_url TEXT,
  video_url TEXT,
  thumbnail_url TEXT,
  creatomate_job_id TEXT,
  duration_seconds NUMERIC,
  status TEXT NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested','script_ready','rendering','ready','failed','published')),
  error TEXT,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  script_edited_at TIMESTAMPTZ,
  rendered_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_loro_videos_digest ON loro_videos(digest_id);
CREATE INDEX IF NOT EXISTS idx_loro_videos_status ON loro_videos(status);
CREATE INDEX IF NOT EXISTS idx_loro_videos_created ON loro_videos(created_at DESC);
ALTER TABLE loro_videos ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
