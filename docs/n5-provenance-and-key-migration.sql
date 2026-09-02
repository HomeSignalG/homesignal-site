-- ============================================================================
-- N5 PROVENANCE, ASSOCIATION KEY, AND POINT-REJECT MIGRATION
-- ----------------------------------------------------------------------------
-- DDL of record (docs/*.sql convention). Three independent changes that must
-- land together, because each is a precondition for PROVEN POINT materialization.
--
-- WHY THE PROVENANCE COLUMN IS LOAD-BEARING, NOT BOOKKEEPING
-- Until now `geo.n5_geom` was populated ONLY by the RECOVERY path
-- (scripts/n5_shard.py::recover_shard selects treatment='RECOVERY'), so presence
-- in the table was ITSELF the treatment gate — and docs/n5-spatial-read-rpc.sql
-- says so in those words. The moment PROVEN stored points land in the same table
-- that sentence becomes FALSE, and any reader relying on it silently widens what
-- it returns. `provenance` is what keeps that reader correct, which is why it is
-- NOT NULL with a CHECKed domain and NO DEFAULT: a future writer must state which
-- kind of geometry it is writing, rather than inheriting one by omission.
--
-- Order is fixed and each step is verified before the next:
--   add nullable -> backfill every existing row -> assert 0 NULL -> CHECK -> NOT NULL
-- A default would defeat the whole point (it would silently label an unlabelled
-- future insert), so there is deliberately none.
-- ============================================================================

-- ---------------------------------------------------------------- 1. provenance
alter table geo.n5_geom add column if not exists provenance text;

update geo.n5_geom set provenance = 'recovered_authoritative' where provenance is null;

do $$
declare n bigint;
begin
  select count(*) into n from geo.n5_geom where provenance is null;
  if n <> 0 then
    raise exception 'STOP: % rows still NULL after backfill; refusing to add the constraint', n;
  end if;
end $$;

alter table geo.n5_geom drop constraint if exists n5_geom_provenance_ck;
alter table geo.n5_geom add constraint n5_geom_provenance_ck
  check (provenance in ('recovered_authoritative','proven_stored_point'));

alter table geo.n5_geom alter column provenance set not null;

comment on table geo.n5_geom is
  'CANONICAL DATA. Authoritative project geometry, keyed (source_key, feature_id): '
  'source_key is PROJECT identity, feature_id is GEOMETRY-INSTANCE identity, and a '
  'project may legitimately own many features - never collapse with DISTINCT ON. '
  'PRESENCE IN THIS TABLE IS NOT A TREATMENT GATE. It was one only while the table '
  'held RECOVERY rows alone; `provenance` is now the gate - recovered_authoritative '
  '(publisher geometry fetched by scripts/n5_shard.py::recover_shard) or '
  'proven_stored_point (the frozen snapshot coordinate materialised as a point, '
  'feature_id ''pt:1''). feature_id ''pt:2'' and beyond are RESERVED and UNDEFINED: '
  'no code path emits them, and one appearing means a writer invented a convention. '
  'Rows are never refreshed - the writer uses ON CONFLICT DO NOTHING, so the FIRST '
  'acquisition is the durable vintage recorded by recovered_at.';

-- ------------------------------------------------------- 2. point reject reasons
create table if not exists geo.n5_point_reject (
  source_key   text        not null,
  registry_id  text,
  reason       text        not null,
  detail       jsonb,
  rejected_at  timestamptz not null default now(),
  primary key (source_key, reason)
);

alter table geo.n5_point_reject enable row level security;

alter table geo.n5_point_reject drop constraint if exists n5_point_reject_reason_ck;
alter table geo.n5_point_reject add constraint n5_point_reject_reason_ck
  check (reason in ('NO_REGISTRY_VERDICT','NULL_COORD','NULL_ISLAND',
                    'OUTSIDE_JURISDICTION','INVALID_COORD','MULTI_COORD_UNRESOLVED'));

comment on table geo.n5_point_reject is
  'CANONICAL DATA. Why a PROVEN project did NOT become a materialised point. The '
  'reason domain is CLOSED and CHECKed, so a rejection cannot be recorded under an '
  'invented label and a silent drop cannot masquerade as an absence.';

-- --------------------------------------- 3. association key, stage-and-swap
-- Both preconditions are verified BEFORE the key changes, and either being
-- nonzero is a STOP - not a warning, and not something the swap resolves.
do $$
declare dup bigint; conf bigint;
begin
  select count(*) into dup  from (select source_key, zip from geo.n5_association
                                   group by 1,2 having count(*) > 1) t;
  select count(*) into conf from (select source_key, zip from geo.n5_association
                                   group by 1,2 having count(distinct evidence) > 1) t;
  raise notice 'precondition duplicate (source_key,zip) = %, conflicting evidence = %', dup, conf;
  if dup <> 0 or conf <> 0 then
    raise exception 'STOP: duplicate=% conflicting=%; refusing to change the key', dup, conf;
  end if;
end $$;

create table geo.n5_association_new (
  source_key text     not null,
  zip        char(5)  not null,
  evidence   smallint not null,
  primary key (source_key, zip)
);
alter table geo.n5_association_new enable row level security;

insert into geo.n5_association_new (source_key, zip, evidence)
select source_key, zip, evidence from geo.n5_association;

do $$
declare a bigint; b bigint;
begin
  select count(*) into a from geo.n5_association;
  select count(*) into b from geo.n5_association_new;
  if a <> b then raise exception 'STOP: staged % rows vs % source rows', b, a; end if;
end $$;

drop table geo.n5_association;
alter table geo.n5_association_new rename to n5_association;
alter index geo.n5_association_new_pkey rename to n5_association_pkey;

comment on table geo.n5_association is
  'CANONICAL DATA. One row per (project, ZIP) with the evidence class that judged it: '
  '1 geometry_verified, 2 legacy_unverifiable, 3 legacy_unsupported (REFUTED), '
  '4 unresolved. Keyed (source_key, zip) - a pair carries exactly one verdict. '
  'THIS TABLE MEASURES OVER-INCLUSION ONLY. It is built slice-first, so a project '
  'whose geometry lies inside a ZIP it was never associated with is absent rather '
  'than refuted; under-inclusion needs the separate boundary-first pass.';
