-- Let the read-only audit role run Map 1's data-centre reader (2026-11-14). Additive; no data change.
-- Why: scripts/audits/map-list-parity.sql runs through db-read.yml as supabase_read_only_user, which could not
-- execute public.map1_dc_zip_members (42501, run 43322803351). The function is STABLE and SECURITY DEFINER, and
-- anon and authenticated already hold EXECUTE (proacl read 2026-11-14), so this exposes nothing new.
grant execute on function public.map1_dc_zip_members(text) to supabase_read_only_user;
