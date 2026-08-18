-- Maps uncap Phase 2 — app_projects_for_zip: one payload per ZIP.
-- Applied 2026-08-18 as migration `app_projects_for_zip_single_payload_read`.
-- Parked here as the DDL of record (CLAUDE.md §1 source-of-truth #3).
--
-- THE PROBLEM IT FIXES. PostgREST caps EVERY response at 1,000 rows, service-side:
-- measured live on app_projects?zip=eq.57104, `limit=5000` -> 1,000 rows and
-- `limit=25000` -> 1,000 rows. lib/data.js therefore read in 1,000-row windows, so a
-- dense ZIP cost one sequential round trip per window — 57104's 19,584 records = TWENTY.
-- The page rendered COMPLETELY and was never truncated, but took 6.5-15 s to do it
-- (measured: fails the 6,500 ms spot-check settle, passes at 15,000 ms).
--
-- ⛔ RAISING THE WINDOW IS NOT THE FIX. fetchAllPages stops on `data.length < PAGE_ROWS`,
-- so PAGE_ROWS=5000 would read the first server-capped 1,000-row response as a short page
-- and return 1,000 of 19,584 records with complete:true — silent truncation reported as a
-- complete read, the exact failure the complete-flag exists to prevent. Pinned by
-- test/maps-pagination.test.mjs case A6.
--
-- SECURITY POSTURE — SECURITY INVOKER ON PURPOSE, NOT DEFINER.
--   * app_projects has RLS ENABLED with ONE policy: app_projects_read, SELECT for
--     {anon, authenticated}, USING (true). The page already reads the table directly with
--     the anon key, so every row this returns was already reachable by the caller. No
--     elevated rights are needed, and definer rights would add privilege for zero benefit.
--   * The lesson applied: a filter on what is EMITTED is not a control on what is REACHED
--     (the sitemap <loc> scheme gate). A definer-rights function's guard would sit inside a
--     privileged path; an invoker-rights function has no privileged path to guard.
--   * STABLE, pure SELECT — read-only, no writes, no side effects.
--   * search_path PINNED to public, pg_temp so `app_projects` cannot resolve elsewhere.
--   * p_kind whitelisted in the WHERE; any other value returns [] rather than widening.
--   * No dynamic SQL and no table/column/filter parameters — a ZIP and a kind, nothing else.
--   * EXECUTE revoked from PUBLIC, granted to anon + authenticated only.
--
-- ORDER matches what lib/data.js ordered by before, so render order is unchanged:
--   development -> submitted_at desc nulls last, then id
--   facility    -> name asc, then id
create or replace function public.app_projects_for_zip(p_zip text, p_kind text)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(s.j order by s.k_date desc nulls last, s.k_name asc nulls last, s.k_id), '[]'::jsonb)
  from (
    select to_jsonb(p) as j,
           case when p_kind = 'facility' then null else p.submitted_at end as k_date,
           case when p_kind = 'facility' then p.name else null end       as k_name,
           p.id                                                          as k_id
    from public.app_projects p
    where p.zip = p_zip
      and p.record_kind = p_kind
      and p_kind in ('development', 'facility')
  ) s
$$;

revoke all on function public.app_projects_for_zip(text, text) from public;
grant execute on function public.app_projects_for_zip(text, text) to anon, authenticated;

-- Verification receipts taken at apply time (2026-08-18):
--   in-DB:    development 19,544 + facility 40 = 19,584 = the exact app_projects row
--             count for 57104; a bogus p_kind returns 0 (fails closed).
--   over HTTP as anon: POST /rest/v1/rpc/app_projects_for_zip {"p_zip":"57104",
--             "p_kind":"development"} -> HTTP 200, 26 MB, 19,544 records in ONE response.
--             The 1,000-row cap does not apply to a single-row result.
