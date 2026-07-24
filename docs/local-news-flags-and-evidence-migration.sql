-- ============================================================================
-- Migration: local_news_geo_evidence_and_flags  (applied 2026-07-24)
-- Phase B of the Local News routing project — SQL of record (reproducible).
--
-- SHADOW ONLY: nothing reads these objects for delivery. Subscriber pages and
-- emails are unchanged; app_refresh_zip and digest.py are untouched by this
-- migration (byte-guard: app_refresh_zip md5 5d840e01cc8f35c2c7071cb893081310,
-- the Phase A body, before and after).
--
-- WHAT IT ADDS (founder-approved, additive only):
--   * alerts.geo_evidence jsonb  — the routing record (method, status, zip_set,
--     out_of_chain, confidence, human-readable reason, signals, candidates,
--     resolved_at). alerts.resolver_version text — idempotent re-resolution
--     stamp. All other routing concepts reuse existing alerts fields
--     (geo_scope / zip / geo_lat / geo_lng / community_id / subtopics).
--   * public.app_flags — the ONE feature-flag carrier (FD-B4): three rows
--     (resolver_shadow, page_target_zip, email_target_zip), ALL enabled=false.
--     RLS enabled with no policies + explicit revoke: anon/authenticated can
--     neither read nor write; the engine, materializer, and digest read via
--     service role. Every consumer treats an absent row as OFF (fail-safe) —
--     verified in homesignal-ingest tests/test_ingest_resolver_integration.py.
--   * public.v_local_news_hold — the founder HOLD review surface (FD-B2):
--     title, publisher (agency or source host), source URL, publication date,
--     source community + county, extracted geo signals, hold reason,
--     candidate place/ZIP, topic classification, resolver_version,
--     resolution timestamp. Not anon-readable.
--   * public.local_news_routing_shadow — legacy (county-wide replication,
--     Phase A deterministic ordering) vs proposed (evidence routing) per ZIP;
--     14-day window, cap 48 both sides; universe = today's Local News ZIPs
--     UNION every ZIP the evidence routes to (incl. out-of-chain + countywide
--     expansion). The Phase C decision instrument; dropped at cleanup.
--
-- REVERT: update public.app_flags set enabled=false (already false);
-- drop view public.local_news_routing_shadow; drop view public.v_local_news_hold;
-- the two alerts columns are nullable + unread — leave in place (non-destructive)
-- or drop column if a full unwind is ever wanted.
-- ============================================================================

alter table public.alerts add column if not exists geo_evidence jsonb;
alter table public.alerts add column if not exists resolver_version text;

create table if not exists public.app_flags (
  name        text primary key,
  enabled     boolean not null default false,
  purpose     text,
  owner       text not null default 'founder',
  updated_at  timestamptz not null default now(),
  updated_by  text
);
alter table public.app_flags enable row level security;
revoke all on public.app_flags from anon, authenticated;

insert into public.app_flags (name, enabled, purpose, owner, updated_by) values
 ('resolver_shadow', false,
  'Phase B: stamp local_news geo evidence at ingest (SHADOW ONLY — nothing reads it for delivery). Flip requires founder approval.',
  'founder', 'phase-b-migration'),
 ('page_target_zip', false,
  'Phase C/D: serve evidence-routed Local News on ZIP pages. DO NOT enable without separate founder approval.',
  'founder', 'phase-b-migration'),
 ('email_target_zip', false,
  'Phase E: route Local News email by subscriber ZIP. DO NOT enable without separate founder approval (pages first).',
  'founder', 'phase-b-migration')
on conflict (name) do nothing;

create or replace view public.v_local_news_hold as
select a.id,
       a.title,
       coalesce(nullif(a.agency_name,''),
                regexp_replace(split_part(split_part(a.source_url,'//',2),'/',1),'^www\.','')) as publisher,
       a.source_url,
       a.published_at,
       c.name  as source_community,
       c.county as source_county,
       a.geo_evidence->'signals'    as geo_signals,
       a.geo_evidence->>'reason'    as hold_reason,
       a.geo_evidence->'candidates' as candidates,
       a.subtopics                  as topic_classification,
       a.resolver_version,
       a.geo_evidence->>'resolved_at' as resolved_at
from public.alerts a
join public.communities c on c.id = a.community_id
where a.category = 'local_news'
  and a.geo_evidence->>'status' = 'hold';
revoke all on public.v_local_news_hold from anon, authenticated;

create or replace view public.local_news_routing_shadow as
with news as (
  select a.id, a.community_id, a.created_at, a.geo_scope,
         coalesce(a.geo_evidence->>'status','none')  as st,
         coalesce(a.geo_evidence->>'method','none')  as mth,
         coalesce((a.geo_evidence->>'out_of_chain')::boolean,false) as ooc,
         coalesce(a.geo_evidence->'zip_set','[]'::jsonb) as zip_set
  from public.alerts a
  where a.category='local_news' and a.pipeline_type='news'
    and coalesce(a.source_url,'')<>''
    and a.created_at >= now() - interval '14 days'
),
cw_roots as (select distinct community_id from news where geo_scope='countywide' and st='routed'),
root_zips as (
  select r.community_id as root_id, z.zip
  from cw_roots r
  join public.communities c
    on c.id = r.community_id or c.parent_id = r.community_id
    or c.parent_id in (select id from public.communities where parent_id = r.community_id)
  cross join lateral unnest(c.zip_codes) as z(zip)
  group by 1,2
),
universe as (
  select distinct zip from public.app_changes where category='Local News'
  union
  select distinct jsonb_array_elements_text(zip_set) from news where st='routed'
  union
  select zip from root_zips
),
zr as (
  select u.zip,
    (with recursive up as (
       select id, parent_id, 0 as d from public.communities
        where id = (select id from public.communities where zip_codes @> array[u.zip]
                    order by (level='zip') desc, (level='city') desc, id limit 1)
       union all
       select c.id, c.parent_id, up.d+1 from public.communities c
         join up on c.id = up.parent_id where up.d < 6)
     select id from up order by d desc limit 1) as root_id
  from universe u
),
legacy as (
  select z.zip, n.id,
         row_number() over (partition by z.zip order by n.created_at desc, n.id) rn
  from zr z join news n on n.community_id = z.root_id
),
prop_cand as (
  select t.zip, n.id, n.created_at
  from news n cross join lateral jsonb_array_elements_text(n.zip_set) as t(zip)
  where n.st='routed'
  union
  select rz.zip, n.id, n.created_at
  from news n join root_zips rz on rz.root_id = n.community_id
  where n.st='routed' and n.geo_scope='countywide'
),
proposed as (
  select zip, id, row_number() over (partition by zip order by created_at desc, id) rn
  from (select distinct zip, id, created_at from prop_cand) d
)
select z.zip,
       z.root_id,
       (select c.name from public.communities c where c.id=z.root_id)   as root_name,
       (select c.county from public.communities c where c.id=z.root_id) as county,
       (select count(*) from legacy l where l.zip=z.zip and l.rn<=48)   as legacy_n,
       (select count(*) from proposed p where p.zip=z.zip and p.rn<=48) as proposed_n,
       (select count(*) from legacy l join proposed p on p.id=l.id and p.zip=l.zip
         where l.zip=z.zip and l.rn<=48 and p.rn<=48)                   as common_n
from zr z;
revoke all on public.local_news_routing_shadow from anon, authenticated;

-- ============================================================================
-- Migration: alerts_geo_scope_vocabulary_v1  (applied 2026-07-24, same day)
-- Found at backfill go-live: the live alerts_geo_scope_chk CHECK carried only
-- the notice-geocoder vocabulary (NULL | address | countywide), so every V1
-- resolver stamp (zip | place | unresolved) was rejected with HTTP 400.
-- Extended to the founder-approved V1 vocabulary; 'regional' is RESERVED for
-- the future-only precedence step (nothing writes it in V1). Existing values
-- unaffected; additive; no data change.
-- STANDING ANSWER (so no session re-derives): alerts.geo_scope is CHECK-
-- constrained — extending the routing vocabulary requires extending
-- alerts_geo_scope_chk in the same change.
-- ============================================================================
alter table public.alerts drop constraint alerts_geo_scope_chk;
alter table public.alerts add constraint alerts_geo_scope_chk
  check (geo_scope is null or geo_scope = any (array[
    'address','countywide','zip','place','unresolved','regional']));
