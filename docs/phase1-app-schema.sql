-- ============================================================================
-- HomeSignal Phase 1 app — schema & RLS (ADDITIVE, idempotent).
-- Parked migration (repo convention: applied manually in the Supabase SQL editor,
-- or by `supabase db` for local dev). Reconciles the build-prompt data model with
-- the LIVE project keyed by community_id/zip_codes[] (see DECISIONS.md, Decision C):
--   * ADDITIVE columns on the existing `communities` (never re-key to zip)
--   * NEW tables for projects/changes/properties/follows/watchlist/requests/waitlist
--   * REUSE existing `meetings`, `contact_messages`, `user_subscriptions`
-- RLS is load-bearing (the browser ships the anon key). Every table below has it.
-- NOT YET APPLIED to production — part of the promotion/sign-off step.
-- ============================================================================

create extension if not exists postgis;
create extension if not exists vector;      -- pgvector: schema-only in Phase 1

-- --- communities: additive score columns (live table already has id/zip_codes/...) ---
alter table public.communities add column if not exists community_score  int;
alter table public.communities add column if not exists growth_pressure  text;
alter table public.communities add column if not exists value_trend      numeric;
alter table public.communities add column if not exists component_scores jsonb;
alter table public.communities add column if not exists covered          boolean default true;

-- --- profiles (mirrors auth.users) ---
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text, avatar_initials text,
  created_at timestamptz default now()
);

-- --- properties (a user's followed homes) ---
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null, city text, state text, zip text,
  label text check (label in ('home','rental','family')) default 'home',
  lat double precision, lng double precision,
  score int, score_trend text, value_outlook numeric,
  insurance_outlook text,
  created_at timestamptz default now()
);
create index if not exists properties_user_idx on public.properties(user_id);

-- --- projects (development) — keyed to a community + a zip convenience column ---
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities(id) on delete cascade,
  zip text,
  name text not null, type text, status text, stage text,
  developer text, size text, investment text, jobs text,
  submitted_at date, lat double precision, lng double precision,
  impact_score int, impact_dimensions jsonb, source_ref text,
  created_at timestamptz default now()
);
create index if not exists projects_zip_idx on public.projects(zip);

-- --- changes (impact stories / alerts) — distinct from the live `alerts` table ---
create table if not exists public.changes (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities(id) on delete cascade,
  zip text,
  category text, title text not null, plain_language text,
  impacts jsonb, lat double precision, lng double precision,
  occurred_at date, source_ref text, confidence text,
  window_closes_at date, related_project_id uuid,
  created_at timestamptz default now()
);
create index if not exists changes_zip_idx on public.changes(zip);

-- --- meetings: REUSE existing table; add only the columns the app needs ---
alter table public.meetings add column if not exists zip text;
alter table public.meetings add column if not exists agenda jsonb;
alter table public.meetings add column if not exists related_project_id uuid;
alter table public.meetings add column if not exists source_ref text;

-- --- environmental_risk (per zip/parcel) ---
create table if not exists public.environmental_risk (
  id uuid primary key default gen_random_uuid(),
  zip text, parcel text,
  flood jsonb, wildfire jsonb, heat jsonb,
  source_ref text, updated_at timestamptz default now()
);
create index if not exists env_zip_idx on public.environmental_risk(zip);

-- --- topic_prefs (per-user; consent defaults FALSE) ---
create table if not exists public.topic_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  topics jsonb not null default '[]',
  share_consent boolean not null default false,
  updated_at timestamptz default now(),
  primary key (user_id, category)
);

-- --- follows / watchlist ---
create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null, target_id text not null,
  created_at timestamptz default now(),
  unique (user_id, target_type, target_id)
);
create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null, target_type text, target_id text,
  created_at timestamptz default now()
);

-- --- email-capture tables (anon INSERT ok; SELECT denied to anon+authenticated) ---
create table if not exists public.community_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null, zip text, created_at timestamptz default now()
);
create table if not exists public.premium_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null, created_at timestamptz default now()
);
-- contact_messages already exists (docs/contact-messages-setup.sql) — reused as-is.

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.profiles         enable row level security;
alter table public.properties       enable row level security;
alter table public.topic_prefs      enable row level security;
alter table public.follows          enable row level security;
alter table public.watchlist_items  enable row level security;
alter table public.community_requests enable row level security;
alter table public.premium_waitlist   enable row level security;
alter table public.projects         enable row level security;
alter table public.changes          enable row level security;
alter table public.environmental_risk enable row level security;

-- owner-only (read+write your own rows)
do $$ begin
  -- profiles
  create policy profiles_self on public.profiles
    for all using (auth.uid() = id) with check (auth.uid() = id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy properties_self on public.properties
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy topic_prefs_self on public.topic_prefs
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy follows_self on public.follows
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy watchlist_self on public.watchlist_items
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- email-capture: anon+authenticated may INSERT ONLY; SELECT denied to both
-- (no SELECT policy => no read for anon/authenticated; service role bypasses RLS).
do $$ begin
  create policy community_requests_insert on public.community_requests
    for insert to anon, authenticated with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy premium_waitlist_insert on public.premium_waitlist
    for insert to anon, authenticated with check (true);
exception when duplicate_object then null; end $$;

-- public read-only content
do $$ begin
  create policy projects_read on public.projects for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy changes_read on public.changes for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy env_read on public.environmental_risk for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;

-- NOTE: `communities` and `meetings` already carry public-read RLS on the live project;
-- do not redefine here. Verify with: select relrowsecurity from pg_class where relname in
-- ('communities','meetings');  (Both must be true before ship.)

-- ============================================================================
-- Distance RPC (PostGIS) — distance is COMPUTED, never stored. The browser calls
-- this with the active property's point; the seed path uses a JS haversine instead.
-- ============================================================================
create or replace function public.items_with_distance(_zip text, _lat double precision, _lng double precision)
returns table(id uuid, name text, distance_mi double precision)
language sql stable as $$
  select p.id, p.name,
    st_distance(st_makepoint(_lng,_lat)::geography, st_makepoint(p.lng,p.lat)::geography)/1609.344 as distance_mi
  from public.projects p
  where p.zip = _zip and p.lat is not null;
$$;
