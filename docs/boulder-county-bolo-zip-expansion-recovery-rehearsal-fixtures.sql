-- Rehearsal fixtures: MINIMAL LOCAL RECONSTRUCTION, NOT A PRODUCTION CLONE. See the rehearsal README in the doc.
-- Creates stand-in tables only. Function bodies, the registry rows and the two county roots are loaded separately
-- (extraction steps in the doc) so that no production data is committed here.
create schema geo; create schema preservation;
create domain public.geometry as text;
create function public.st_geometrytype(g text) returns text language sql as $$ select 'ST_Polygon' $$;
create function public.st_isempty(g text) returns boolean language sql as $$ select false $$;
create function public.zip_dc_membership_outside(z text, x jsonb, g public.geometry) returns boolean language sql as $$ select false $$;
create table geo.zcta_boundary (zcta5 text primary key, geom public.geometry);
create table geo.zcta_place_overlap (zcta5 char(5), place_geoid text, primary key (zcta5, place_geoid));
-- Census reference data that production already holds for the four ZCTAs BEFORE the expansion (measured: 4 and 11 rows).
insert into geo.zcta_boundary values ('80026',null),('80027',null),('80310',null),('80021',null);
insert into geo.zcta_place_overlap values ('80026','0846465'),('80027','0846465'),('80310','0807850'),('80021','0807850');

create table public.canonical_zip_registry (zip text primary key, gold_master_version text not null, workbook_sha256 text not null, loaded_at timestamptz not null default now());
create table public.alert_topic_catalog (stream text not null, topic text not null, active boolean not null default true, created_at timestamptz not null default now(), primary key (stream, topic),
  constraint alert_topic_catalog_stream_ck check (stream = any (array['notices','meetings','news','global','emerging','maps'])));
create table public.communities (id uuid primary key default gen_random_uuid(), name text not null, county text, state text, zip_codes text[], created_at timestamptz default now(),
  level text not null default 'county', parent_id uuid references public.communities(id), government_topics text[] not null default '{}'::text[], slug text, census_place_geoid text,
  constraint communities_state_two_letter check (state is not null and state ~ '^[A-Z]{2}$'));
create index communities_parent_id_idx on public.communities (parent_id);
create unique index communities_slug_lower_key on public.communities (lower(slug)) where slug is not null;
create index idx_communities_zip_codes_gin on public.communities using gin (zip_codes);
create table public.app_community_meta (zip text primary key, community_id uuid, name text, county text, state text, community_score integer, growth_pressure text, value_trend numeric,
  component_scores jsonb, civic_activity text, blurb text, covered boolean not null default true, data_quality text, updated_at timestamptz default now(), indexable boolean not null default false, lat double precision, lng double precision);
create table public.development_reports (zip text primary key, home_lat double precision not null, home_lng double precision not null, counts jsonb not null default '{}'::jsonb,
  sites jsonb not null default '[]'::jsonb, paywall boolean not null default false, source_vintage text, refreshed_at timestamptz not null default now(), created_at timestamptz not null default now(),
  last_refresh_attempt_at timestamptz, facilities_unavailable boolean not null default false, facilities_refreshed_at timestamptz, last_collected_response_id bigint, echo jsonb, cwa jsonb,
  constraint development_reports_zip_check check (zip ~ '^\d{5}$'));
-- Stand-in dependents (empty). Names/types mirror production for the recovery's reference scan.
create table public.alerts (id bigserial primary key, community_id uuid references public.communities(id), zip text);
create table public.user_subscriptions (id bigserial primary key, community_id uuid references public.communities(id));
create table public.self_reports (id bigserial primary key, community_id uuid references public.communities(id) on delete cascade);
create table public.feeds (feed_id text primary key, community_id text);
create table public.events (id bigserial primary key, zip_code text, community_id uuid);
create table public.app_zip_geography_cutover (zip character(5) primary key);
create table public.zip_request_builds (id bigserial primary key, zip text);
create table public.maps_zip_order (zip text primary key);
create table public.meetings (id bigserial primary key, community_id uuid references public.communities(id), zip text);
create table public.app_projects (id bigserial primary key, zip text, community_id uuid);
-- Stand-ins for the serving / generation / preservation objects the recovery checks (columns and index shapes mirror production).
create table geo.n5_generation (generation_id text primary key, state text not null, opened_at timestamptz not null);
insert into geo.n5_generation values ('gen-old','SUPERSEDED','2026-11-01 00:40:00+00'),('gen-active','ACTIVE','2026-11-18 00:40:00+00');
create table geo.maps_zip_geography_status (generation_id text, zip char(5), primary key (generation_id, zip));
create table geo.maps_zip_export (zip char(5) primary key);
create table geo.n5_generation_unresolved (generation_id text, source_key text, zip text, primary key (generation_id, source_key));
create table geo.zip_authoritative_membership (generation_id text, zcta5 char(5), source_key text, primary key (generation_id, zcta5, source_key));
create table geo.zip_authoritative_marker (generation_id text, zcta5 char(5), source_key text, marker_seq int default 0, primary key (generation_id, zcta5, source_key, marker_seq));
create table geo.n5_boundary_membership (generation_id text, zcta5 char(5), source_key text, primary key (generation_id, zcta5, source_key));
create table preservation.community_meta (snapshot_id text, zip text, primary key (snapshot_id, zip));
create table preservation.development_report (snapshot_id text, zip text, primary key (snapshot_id, zip));

-- State fingerprint used by the harness (compared before/after every case).
create function public.rh_state() returns table (k text, v text) language sql as $$
  select 'registry', count(*)||' '||md5(string_agg(zip,',' order by zip collate "C")) from public.canonical_zip_registry
  union all select 'communities', count(*)||' '||md5(string_agg(concat_ws('|',id,name,county,state,array_to_string(zip_codes,','),level,parent_id,array_to_string(government_topics,','),slug,census_place_geoid),E'\n' order by id)) from public.communities
  union all select 'roots_arrays', string_agg(slug||'='||array_to_string(zip_codes,','),' ; ' order by slug) from public.communities where level='county'
  union all select 'selftest_md5', md5(prosrc) from pg_proc where proname='canonical_zip_guard_selftest'
  union all select 'catalog', count(*)||' '||coalesce(md5(string_agg(stream||'/'||topic||'/'||active,',' order by stream,topic)),'-') from public.alert_topic_catalog
  union all select 'dependents', (select count(*) from public.alerts)||'/'||(select count(*) from public.feeds)||'/'||(select count(*) from public.events)||'/'||(select count(*) from public.app_zip_geography_cutover)||'/'||(select count(*) from public.zip_request_builds)||'/'||(select count(*) from public.self_reports)||'/'||(select count(*) from geo.maps_zip_geography_status)||'/'||(select count(*) from geo.zip_authoritative_membership)||'/'||(select count(*) from preservation.community_meta)||'/'||(select count(*) from geo.n5_generation)
$$;
