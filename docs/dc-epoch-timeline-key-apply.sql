-- =====================================================================================
-- EPOCH TIMELINES GET A STABLE RECORD KEY (2026-10-01) — stop minting ~545 canonical entities a day, and let the
-- resolver's own retirement mechanism clear the 3,253 already minted.
--
-- THE DEFECT. epoch_ai/timelines carries many milestones per data centre, so a NAME repeats inside a run and the
-- step 3A rule (a name is a key only when unique in its run) leaves every row a SINGLETON key. Each daily pull
-- therefore mints a fresh entity per row and the previous day's entities are never matched again. Measured
-- 2026-09-30 (production): 7 runs, 3,798 observations -> 3,798 entities, of which 3,253 have NO current evidence,
-- are unclassified, and have no coordinates (0 with a geometry). They are in the geography resolver's input every
-- hour (`where e.superseded_by is null`).
--
-- THE KEY. (Data center, Date) is unique within every run (7 of 7, 545/545 in the latest) and persists: of 546
-- distinct pairs across the 7 runs, 534 appear in all seven. A new registry, dc_record_key_discriminator, names the
-- one payload field that pairs with the name for a distribution (epoch_ai/timelines -> 'Date'); the key rule reads
-- the registry, so NO source is named in the rule. Key = '<source>|<distribution>|name+date:<name>|<date>', rank 1,
-- only when the pair is unique in its own run and both parts are present. A pair that repeats stays two singletons
-- (fails safe: a record is not matched, nothing is merged); a row missing the field falls through to the
-- pre-existing step 3A name rule, unchanged. A renamed or re-dated milestone mints a new key — the same stated
-- cost as the step 3A name rule.
--
-- WHAT IT DOES TO THE STORED ENTITIES — NOTHING IS DELETED. The next dc_resolve_canonical run groups every
-- timeline observation (old and current) by the new key, anchors each group on its oldest entity, relinks the
-- group's observations to it and SUPERSEDES the rest with supersede_reason 'SAME_RECORD_GROUP: <key>' — the
-- mechanism already used for the 182 retired Epoch entities. Observations, identity decisions and geography rows
-- are kept; the geography resolver and Map 1 read only entities with superseded_by null.
-- No cross-source decision is touched: no CONFIRMED_MATCH decision involves a timeline observation (0 of 15,290).
--
-- GUARDED. Refuses unless the live view is exactly the definition this replaces (md5 of pg_get_viewdef
-- 12d40cc3f3e04a625d1d5e15faeb3343, measured on production 2026-10-01) or already carries the rule (then a no-op).
-- The registry and view statements below are byte-identical to the ones in docs/dc-step3a-canonical-identity.sql
-- (a test pins that), so re-applying that file keeps the rule. (docs/dc-epoch-geography-apply.sql is a frozen
-- applied artifact and is never re-applied.)
-- Decides nothing about any marker. Idempotent. Service-role only.
-- =====================================================================================

do $guard$
declare
  _def text := pg_get_viewdef('public.dc_observation_record_key'::regclass, true);
begin
  if position('dc_record_key_discriminator' in _def) > 0 then
    raise notice 'timeline record key already present — nothing to change';
  elsif md5(_def) <> '12d40cc3f3e04a625d1d5e15faeb3343' then
    raise exception 'dc_observation_record_key is not the definition this change replaces (md5 %) — refusing', md5(_def);
  end if;
end
$guard$;

create table if not exists public.dc_record_key_discriminator (
  source_key       text not null,
  distribution_key text not null,
  payload_field    text not null check (btrim(payload_field) <> ''),
  key_label        text not null check (key_label ~ '^[a-z]+$'),
  primary key (source_key, distribution_key)
);
alter table public.dc_record_key_discriminator enable row level security;
revoke all on public.dc_record_key_discriminator from anon, authenticated;
insert into public.dc_record_key_discriminator (source_key, distribution_key, payload_field, key_label)
values ('epoch_ai', 'timelines', 'Date', 'date')
on conflict (source_key, distribution_key) do nothing;
comment on table public.dc_record_key_discriminator is
'STEP 3A. For a source with no record id whose names repeat inside a run: the one payload field that, together with the
name, is a stable record key (rank 1, only when the pair is unique in its own run). Evidence identity only.';

create or replace view public.dc_observation_record_key with (security_invoker = true) as
select o.home_signal_observation_id,
       case when o.publisher_record_id is not null
              then o.source_key || '|' || o.distribution_key || '|' || o.publisher_record_id
            when s.supplies_publisher_record_id is false
             and nullif(btrim(o.source_native_name), '') is not null
             and nullif(btrim(o.raw_payload ->> d.payload_field), '') is not null
             and count(*) over (partition by o.source_key, o.acquisition_run_id, o.distribution_key,
                                             btrim(o.source_native_name), btrim(o.raw_payload ->> d.payload_field)) = 1
              then o.source_key || '|' || o.distribution_key || '|name+' || d.key_label || ':'
                   || btrim(o.source_native_name) || '|' || btrim(o.raw_payload ->> d.payload_field)
            when s.supplies_publisher_record_id is false
             and nullif(btrim(o.source_native_name), '') is not null
             and count(*) over (partition by o.source_key, o.acquisition_run_id, o.distribution_key,
                                             btrim(o.source_native_name)) = 1
              then o.source_key || '|' || o.distribution_key || '|name:' || btrim(o.source_native_name)
            else 'singleton|' || o.home_signal_observation_id::text end as record_key,
       case when o.publisher_record_id is not null then 0
            when s.supplies_publisher_record_id is false
             and nullif(btrim(o.source_native_name), '') is not null
             and nullif(btrim(o.raw_payload ->> d.payload_field), '') is not null
             and count(*) over (partition by o.source_key, o.acquisition_run_id, o.distribution_key,
                                             btrim(o.source_native_name), btrim(o.raw_payload ->> d.payload_field)) = 1 then 1
            when s.supplies_publisher_record_id is false
             and nullif(btrim(o.source_native_name), '') is not null
             and count(*) over (partition by o.source_key, o.acquisition_run_id, o.distribution_key,
                                             btrim(o.source_native_name)) = 1 then 1
            else 2 end as record_key_rank   -- 0 publisher id, 1 unique name, 2 singleton
  from public.dc_source_observation o
  join public.dc_source s on s.source_key = o.source_key
  left join public.dc_record_key_discriminator d
    on d.source_key = o.source_key and d.distribution_key = o.distribution_key;

do $post$
declare
  _def text := pg_get_viewdef('public.dc_observation_record_key'::regclass, true);
begin
  if (length(_def) - length(replace(_def, 'dc_record_key_discriminator', ''))) / length('dc_record_key_discriminator') <> 1 then
    raise exception 'timeline record key did not take — the view must read the registry exactly once';
  end if;
  if (select count(*) from public.dc_record_key_discriminator
       where (source_key, distribution_key, payload_field, key_label) = ('epoch_ai', 'timelines', 'Date', 'date')) <> 1 then
    raise exception 'the epoch_ai/timelines discriminator row is missing — refusing';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.dc_observation_record_key'::regclass
                  and 'security_invoker=true' = any (reloptions)) then
    raise exception 'dc_observation_record_key lost security_invoker — refusing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.dc_record_key_discriminator'::regclass) then
    raise exception 'dc_record_key_discriminator has no row level security — refusing';
  end if;
  if has_table_privilege('anon', 'public.dc_observation_record_key', 'select')
     or has_table_privilege('authenticated', 'public.dc_observation_record_key', 'select')
     or has_table_privilege('anon', 'public.dc_record_key_discriminator', 'select')
     or has_table_privilege('authenticated', 'public.dc_record_key_discriminator', 'select') then
    raise exception 'the record key view or its registry is readable by anon/authenticated — refusing';
  end if;
end
$post$;
