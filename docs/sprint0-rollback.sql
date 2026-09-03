-- Sprint 0 rollback — captured 2026-09-03 before any change.
-- Restores the 1-argument overload of loro_expire_stale_candidates exactly as it was.
-- Applying this recreates the PGRST203 ambiguity, so only run it to undo the drop.

CREATE OR REPLACE FUNCTION public.loro_expire_stale_candidates(days_old integer DEFAULT 7)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  n integer;
begin
  update loro_story_candidates
  set status = 'expired',
      discarded_at = NOW(),
      discard_reason = coalesce(discard_reason, format('Auto-expired: unreviewed for %s days', days_old))
  where status = 'new'
    and detected_at < NOW() - (days_old || ' days')::interval;
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- Undo the first expiry run (restores candidates to their prior status).
-- UPDATE loro_story_candidates
--   SET status = 'new', discarded_at = NULL, discard_reason = NULL
--   WHERE status = 'expired' AND discard_reason LIKE 'Auto-expired:%'
--     AND discarded_at > '2026-09-03'::date;
