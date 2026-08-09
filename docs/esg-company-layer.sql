-- esg-company-layer.sql — the ESG / Sustainability COMPANY layer (Del Valle pilot).
-- Applied via mcp__Supabase__apply_migration; parked here as the DDL of record (CLAUDE.md §1 row 3).
--
-- WHAT THIS IS: a cached, company-level sustainability layer that attaches to a mapped
-- facility/development ONLY through a reviewed, confident company match. It is NEVER a
-- measurement of the individual facility — see the display contract in lib/templates.js
-- (HS.esg) and docs/esg-company-layer.md.
--
-- THREE TABLES + ONE COLUMN:
--   company_esg_matches  company_key -> external source id, with a confidence tier
--   company_esg_data     the cached, display-ready metrics per (company_key, source)
--   company_esg_raw      the preserved raw API payload, so new metrics can be derived
--                        later WITHOUT re-querying every company
--   app_projects.company_esg  the materialized display blob (mirrors facility_env)
--
-- RLS POSTURE: modeled on development_reports (public select, no anon writes) — NOT on
-- page_cache, which ships with RLS disabled (live DB advisory).

-- ── 1. matches ────────────────────────────────────────────────────────────────────────
create table if not exists public.company_esg_matches (
  company_id            text        not null,   -- our stable internal key (company_key)
  canonical_company_name text       not null,
  source                text        not null,   -- 'wikirate' | 'wba'
  external_company_id   text,                   -- WikiRate card id; null while unmatched
  external_company_name text,                   -- the name AS THE SOURCE SPELLS IT
  match_confidence      text        not null,   -- exact | high | parent | ambiguous
  matched_via           text,                   -- the query string that produced the hit
  match_notes           text,                   -- why ambiguous / what was rejected
  parent_company_id     text,                   -- set when confidence='parent'
  parent_company_name   text,
  last_checked          timestamptz not null default now(),
  primary key (company_id, source),
  -- Fail closed: an unrecognised tier can never be written, so the render layer's
  -- allowlist can never be bypassed by a typo.
  constraint company_esg_matches_confidence_ck
    check (match_confidence in ('exact','high','parent','ambiguous')),
  -- A displayable tier MUST carry the id it claims to have matched. This is the
  -- structural version of "no ESG result is better than the wrong company's".
  constraint company_esg_matches_displayable_has_id_ck
    check (match_confidence = 'ambiguous' or external_company_id is not null),
  -- 'parent' is only meaningful with the parent actually named.
  constraint company_esg_matches_parent_named_ck
    check (match_confidence <> 'parent' or parent_company_name is not null)
);
comment on table public.company_esg_matches is
  'Company -> ESG-source identity resolution with a confidence tier. match_confidence=ambiguous is a HOLD: it is stored (so the hold is auditable and not re-resolved every run) but never displayed.';

-- ── 2. data ───────────────────────────────────────────────────────────────────────────
create table if not exists public.company_esg_data (
  company_id          text        not null,
  source              text        not null,     -- 'wikirate' | 'wba'
  overall_score       numeric,                  -- NULL unless the SOURCE states one
  overall_score_scale text,                     -- e.g. '0-10'; NULL when the source states no scale
  environmental_value jsonb,                    -- [{label, value, scale, year, metric_url}]
  social_value        jsonb,
  governance_value    jsonb,
  unclassified_value  jsonb,                    -- self-describing metrics we did NOT force into E/S/G
  reporting_year      int,
  raw_source_url      text        not null,     -- the human-readable source page
  attribution         text        not null,     -- the licence line that MUST render with the data
  retrieved_at        timestamptz not null default now(),
  primary key (company_id, source)
);
comment on table public.company_esg_data is
  'Cached, display-ready company ESG metrics. overall_score is NULL unless the source itself publishes one — HomeSignal never computes or synthesises a composite score. Metrics we cannot classify from the source''s OWN wording go to unclassified_value rather than being forced into a pillar.';
comment on column public.company_esg_data.overall_score_scale is
  'The scale the score is on, from the source. A number with no stated scale is worse than no number, so the render layer suppresses a score whose scale is unknown.';

-- ── 3. raw preservation ───────────────────────────────────────────────────────────────
create table if not exists public.company_esg_raw (
  id           bigserial primary key,
  company_id   text        not null,
  source       text        not null,
  endpoint     text        not null,            -- the exact URL fetched
  http_status  int,
  payload      jsonb,                           -- the response, verbatim
  retrieved_at timestamptz not null default now()
);
create index if not exists company_esg_raw_company_idx
  on public.company_esg_raw (company_id, source, retrieved_at desc);
comment on table public.company_esg_raw is
  'Verbatim upstream payloads, so a new metric can be derived later without re-querying every company. Service-role only.';

-- ── 4. the materialized display blob on the map row ───────────────────────────────────
alter table public.app_projects add column if not exists company_esg jsonb;
comment on column public.app_projects.company_esg is
  'Materialized company-level ESG for this mapped record (mirrors facility_env). Written ONLY for displayable match tiers and ONLY for pilot ZIPs. Absent = the map shows "ESG data unavailable" — never a zero score.';

-- ── 5. RLS — public read, no anon write (the development_reports posture) ─────────────
alter table public.company_esg_matches enable row level security;
alter table public.company_esg_data    enable row level security;
alter table public.company_esg_raw     enable row level security;

do $$
begin
  -- Matches + data are resident-facing (attribution and confidence must be inspectable).
  if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename='company_esg_matches' and policyname='company_esg_matches_public_select') then
    create policy company_esg_matches_public_select on public.company_esg_matches for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename='company_esg_data' and policyname='company_esg_data_public_select') then
    create policy company_esg_data_public_select on public.company_esg_data for select using (true);
  end if;
  -- company_esg_raw gets NO policy on purpose: RLS on + zero policies = service-role only.
end $$;
