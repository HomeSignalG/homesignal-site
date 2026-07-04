-- ============================================================
-- HomeSignal — Acquisition Dashboard v2 (full 10-section) setup
-- Backs acquisition.html (the dark 10-tab dashboard ported from the
-- internal artifact). APPLIED to project qwnnmljucajnexpxdgxr on
-- 2026-07-04 (migrations acquisition_dashboard_setup +
-- acquisition_dashboard_snapshot). Kept here as the annotated reference.
--
-- SECURITY MODEL — why this is safe on a PUBLIC static host:
-- acquisition.html ships with ZERO data. Every number/table + the slider
-- series live in ONE gated jsonb "snapshot" row and are returned only to a
-- logged-in, allowlisted caller via hs_acquisition_dashboard(). A visitor
-- who is not on the allowlist (or not logged in) gets nothing — not even in
-- view-source. This is the opposite of baking the snapshot into the file.
-- ============================================================

-- Reuses the allowlist from acquisition-dashboard-setup.sql:
--   public.dashboard_admins(email text primary key, note text, added_at timestamptz)

-- 1) SNAPSHOT STORAGE ------------------------------------------------
-- One row per dashboard (slug='acquisition'); payload is the whole
-- rendered snapshot: { meta, S (daily series), tabs: { exec, feed, ... } }.
create table if not exists public.dashboard_snapshots (
  slug       text primary key,
  payload    jsonb not null,
  updated_at timestamptz not null default now()
);

-- RLS on, no anon/authenticated policies: the browser can never read this
-- table directly. Only the definer function below (and the service role)
-- can read it. The ingest pipeline updates the row with the service key.
alter table public.dashboard_snapshots enable row level security;
revoke all on table public.dashboard_snapshots from anon, authenticated;

-- 2) GATED READER ----------------------------------------------------
-- Returns the snapshot payload only to an allowlisted, logged-in caller.
create or replace function public.hs_acquisition_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  caller_email text := auth.jwt() ->> 'email';
  result       jsonb;
begin
  if caller_email is null
     or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select payload into result from public.dashboard_snapshots where slug = 'acquisition';
  return result;  -- null if not seeded yet -> page shows "no snapshot yet"
end;
$$;

revoke all on function public.hs_acquisition_dashboard() from public, anon;
grant execute on function public.hs_acquisition_dashboard() to authenticated;

-- 3) SEEDING / REFRESH ----------------------------------------------
-- The payload is produced by the ingest repo's dashboard build
-- (dashboard/build_dashboard.py -> a { meta, S, tabs } jsonb). Upsert it
-- with the SERVICE ROLE (bypasses RLS); never from the browser:
--   insert into public.dashboard_snapshots (slug, payload)
--   values ('acquisition', $$<json>$$::jsonb)
--   on conflict (slug) do update set payload = excluded.payload, updated_at = now();
--
-- payload shape:
--   { "meta": {"snapshot","rendered","project","generated_at"},
--     "S": [[date, dailyAlerts, dailyMeetings, dailyDeliveries], ...],
--     "tabs": { "exec":"<html>", "feed":"<html>", ... 10 keys ... } }
-- The tab HTML must be script-free (it is injected via innerHTML).

-- 4) VERIFY ----------------------------------------------------------
--   -- as an allowlisted user's JWT:  select public.hs_acquisition_dashboard() is not null;
--   -- anon: 'permission denied for function'; non-allowlisted: 'not authorized' (42501).
