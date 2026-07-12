-- ============================================================================
-- HomeSignal Phase 1 app — schema & RLS (APPLIED to production 2026-07-12).
-- DDL of record. ADDITIVE ONLY: all new tables are `app_`-prefixed because a
-- DIFFERENT `projects` table already exists in prod (solar/data-center schema).
-- Existing objects (communities, meetings, projects, community_requests) are
-- NOT altered or dropped. Community scores live in app_community_meta so the
-- live `communities` table is never touched. RLS is load-bearing (anon key).
-- ============================================================================

create table if not exists public.app_community_meta (
  zip text primary key, community_id uuid,
  name text, county text, state text,
  community_score int, growth_pressure text, value_trend numeric,
  component_scores jsonb, civic_activity text, blurb text,
  covered boolean not null default true,
  data_quality text,                    -- 'pass' | 'coverage_coming' (the quality gate)
  updated_at timestamptz default now()
);
create table if not exists public.app_projects (
  id uuid primary key default gen_random_uuid(),
  community_id uuid, zip text not null,
  name text not null, type text, status text, stage text,
  developer text, size text, investment text, jobs text,
  submitted_at date, lat double precision, lng double precision,
  impact_score int, impact_dimensions jsonb, lens text,
  source_ref text not null,             -- anti-fabrication: every row keeps its record URL
  created_at timestamptz default now()
);
create index if not exists app_projects_zip_idx on public.app_projects(zip);
create table if not exists public.app_changes (
  id uuid primary key default gen_random_uuid(),
  community_id uuid, zip text not null,
  category text, title text not null, plain_language text,
  impacts jsonb, lat double precision, lng double precision,
  occurred_at date, source_ref text not null,
  confidence text, window_closes_at date, related_project_id uuid,
  lens text, quiet boolean default false, created_at timestamptz default now()
);
create index if not exists app_changes_zip_idx on public.app_changes(zip);
create table if not exists public.app_environmental_risk (
  zip text primary key, flood jsonb, wildfire jsonb, heat jsonb,
  source_ref text, updated_at timestamptz default now()
);
create table if not exists public.app_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text, avatar_initials text, created_at timestamptz default now()
);
create table if not exists public.app_properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null, city text, state text, zip text, label text default 'home',
  lat double precision, lng double precision,
  score int, score_trend text, value_outlook numeric, insurance_outlook text,
  created_at timestamptz default now()
);
create index if not exists app_properties_user_idx on public.app_properties(user_id);
create table if not exists public.app_topic_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null, topics jsonb not null default '[]',
  share_consent boolean not null default false, updated_at timestamptz default now(),
  primary key (user_id, category)
);
create table if not exists public.app_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null, target_id text not null,
  created_at timestamptz default now(), unique (user_id, target_type, target_id)
);
create table if not exists public.app_watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null, target_type text, target_id text, created_at timestamptz default now()
);
create table if not exists public.app_premium_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null, created_at timestamptz default now()
);

-- RLS (enabled on every app_ table)
alter table public.app_community_meta     enable row level security;
alter table public.app_projects           enable row level security;
alter table public.app_changes            enable row level security;
alter table public.app_environmental_risk enable row level security;
alter table public.app_profiles           enable row level security;
alter table public.app_properties         enable row level security;
alter table public.app_topic_prefs        enable row level security;
alter table public.app_follows            enable row level security;
alter table public.app_watchlist_items    enable row level security;
alter table public.app_premium_waitlist   enable row level security;

-- public read on content
do $$ begin create policy app_meta_read     on public.app_community_meta     for select to anon, authenticated using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy app_projects_read on public.app_projects           for select to anon, authenticated using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy app_changes_read  on public.app_changes            for select to anon, authenticated using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy app_env_read      on public.app_environmental_risk for select to anon, authenticated using (true); exception when duplicate_object then null; end $$;
-- owner-only user tables
do $$ begin create policy app_profiles_self   on public.app_profiles        for all using (auth.uid()=id)      with check (auth.uid()=id);      exception when duplicate_object then null; end $$;
do $$ begin create policy app_properties_self on public.app_properties      for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy app_topic_prefs_self on public.app_topic_prefs    for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy app_follows_self    on public.app_follows         for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy app_watchlist_self  on public.app_watchlist_items for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;
-- email capture: INSERT only, SELECT denied (no select policy) so emails aren't anon-readable
do $$ begin create policy app_waitlist_insert on public.app_premium_waitlist for insert to anon, authenticated with check (true); exception when duplicate_object then null; end $$;
