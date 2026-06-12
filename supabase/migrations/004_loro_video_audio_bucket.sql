-- Public audio bucket for Loro video voiceovers (applied to Supabase 2026-06-12)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('loro-video-audio', 'loro-video-audio', true, 52428800, ARRAY['audio/mpeg','audio/mp3'])
ON CONFLICT (id) DO NOTHING;
-- Policies: public read, service-role write (see migration runner for the DO block).
