-- source-fetch-cache-setup.sql
-- Raw upstream responses for engine-side source adapters in get-address-report
-- (first consumers: TDLR TABS search + project detail pages; usable by any polite
-- adapter that must cache raw fetches). See docs/development-tracker-source-of-truth.md.
--
-- SECURITY (approved under the schema stop-condition, 2026-07-10):
--   RLS is ENABLED with NO policies at all. No browser client reads this table —
--   pages read development_reports; only the service-role edge function reads/writes,
--   and service role bypasses RLS. Do NOT add an anon select/insert/update policy
--   without a new sign-off (this is deliberately stricter than development_reports,
--   which has a public-read policy because the page needs it).
--
-- Parked / applied via mcp__Supabase__apply_migration (source_fetch_cache_setup).

create table if not exists public.source_fetch_cache (
  source      text not null,                 -- adapter key, e.g. 'tdlr_tabs'
  key         text not null,                 -- request identity, e.g. 'search:travis' or 'project:TABS2024022676'
  url         text not null,                 -- the exact URL fetched (provenance)
  status      integer not null,              -- upstream HTTP status
  body        text,                          -- raw response body (parse later, re-parse free)
  fetched_at  timestamptz not null default now(),
  primary key (source, key)
);
comment on table public.source_fetch_cache is
  'Raw upstream HTTP responses cached by engine-side source adapters (e.g. TDLR TABS). Service-role only: RLS enabled, no policies. See docs/development-tracker-source-of-truth.md.';
alter table public.source_fetch_cache enable row level security;

-- Verify:
--   select relname, relrowsecurity from pg_class where relname='source_fetch_cache';
--   select count(*) from pg_policies where tablename='source_fetch_cache';  -- expect 0
