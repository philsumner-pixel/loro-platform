-- Triage disposition for videos, separate from the render-lifecycle status.
ALTER TABLE loro_videos
  ADD COLUMN IF NOT EXISTS disposition TEXT NOT NULL DEFAULT 'inbox'
  CHECK (disposition IN ('inbox','shortlisted','archived'));
NOTIFY pgrst, 'reload schema';
