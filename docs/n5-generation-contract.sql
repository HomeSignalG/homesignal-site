-- ============================================================================
-- N5 GEOGRAPHY — CANONICAL INPUT CONTRACT + GENERATION MODEL. DDL OF RECORD.
--
-- Phase 3 steps 1, 3, 6, 7, 8 of the founder-approved order. ADDITIVE AND INERT:
-- nothing in production reads any object created here. No consumer changes, no
-- snapshot, no build, no cutover change, and build_associations() is untouched.
--
-- WHY THIS EXISTS. The authoritative geography plane was built once, from an
-- immutable snapshot (geo.n5_snapshot 'phase1-2026-09-01', cutoff 2026-09-01
-- 13:39:55Z), and has no lifecycle. Its own success flags — n5_shard.state='done',
-- maps_zip_geography_status.status='boundary_complete', cutover enabled — describe
-- CONSTRUCTION, never CURRENCY, so a 20-day freeze produced no signal anywhere.
--
-- ⛔ THE RULE THIS FILE ENCODES (founder, 2026-09-21): a job completing is not
-- proof, a shard completing is not proof, a snapshot existing is not proof.
-- THE PROOF IS EXPECTED-SET RECONCILIATION, and it must be evaluated BEFORE a
-- generation may serve, not monitored after.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) THE CANONICAL ELIGIBILITY CONTRACT  (founder ruling D-1, option b)
--
-- ONE definition of "should this live project be considered by N5 geography?".
-- Every other participant — snapshot creation, the generation builder, national
-- verification, monitoring — calls THIS. A second copy of the predicate is the
-- drift this incident was made of: the rule was expressed four different ways and
-- one of those copies (an INNER JOIN to geo.n5_accepted_source in n5_shard.py)
-- silently became an eligibility gate the moment the source catalogue grew,
-- removing baltimore-city-housing-permits (3,018 rows / 273 keys, all coordinated)
-- from geography with nothing reporting it.
--
-- ⛔ geo.n5_accepted_source IS NOT CONSULTED HERE, DELIBERATELY. It may continue
-- to describe treatment/classification during geometry resolution. It may never
-- decide eligibility. A registry with no known treatment still owes an accounted
-- outcome: resolved, or unresolved with a reason. Never absent.
--
-- ⛔ COORDINATES ARE NOT AN ELIGIBILITY REQUIREMENT. Geometry is resolved
-- downstream (geo.n5_geom; 78 RECOVERY registries / 164,185 projects at the phase1
-- vintage). Requiring lat/lng here would wrongly drop 59,620 live development rows
-- measured 2026-09-21, 49,463 of them in the 7xxxx range alone.
--
-- PROVEN AGAINST THE ONE KNOWN-GOOD BUILD: applied to the phase1 capture, this
-- predicate reproduces the accepted manifest on all four independent counters —
-- 2,976,275 rows / 925,463 projects / 2,753,802 pairs / 10,467 ZIPs.
-- ---------------------------------------------------------------------------
create or replace function public.n5_expected_input(p_cutoff timestamptz)
returns table (
  source_key  text,
  zip         text,
  source_seq  smallint,
  registry_id text,
  lat         double precision,
  lng         double precision
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select p.source_key, p.zip, p.source_seq, p.registry_id, p.lat, p.lng
    from public.app_projects p
   where p.record_kind = 'development'
     and p.source_key is not null
     and p.zip is not null
     and p.zip ~ '^[0-9]{5}$'
     and split_part(p.source_key, ':', 1) <> 'epa_frs'
     and p.created_at is not null
     and p.created_at <= p_cutoff;
$$;

comment on function public.n5_expected_input(timestamptz) is
  'CANONICAL N5 geography eligibility. The ONE definition of which live development '
  'records enter geography evaluation at a cutoff. Reads public.app_projects ONLY — '
  'never membership, markers, associations, MAPS drafts or page output, because an '
  'output population cannot define its own correctness. Does NOT consult '
  'geo.n5_accepted_source (founder ruling D-1: classification, not eligibility) and '
  'does NOT require coordinates (geometry is resolved downstream).';

-- `created_at` is NULLABLE, and the contract keys on it. A NULL would be dropped by
-- `created_at <= cutoff` — silently, which is this incident's exact failure shape.
-- So it is excluded EXPLICITLY above and asserted to be empty here: a NULL vintage
-- must fail loudly rather than vanish. Measured 2026-09-21: 0 such rows.
create or replace function public.n5_expected_input_integrity()
returns table (check_name text, ok boolean, detail text)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select 'no_null_created_at'::text,
         count(*) = 0,
         count(*)::text || ' development rows have a NULL created_at and are therefore '
           || 'invisible to every cutoff-bounded generation'
    from public.app_projects
   where record_kind = 'development' and created_at is null;
$$;

-- ---------------------------------------------------------------------------
-- 2) GENERATION IDENTITY AND STATE
--
-- BUILDING -> VALIDATING -> READY -> ACTIVE -> SUPERSEDED, plus FAILED.
--
-- ACTIVE_LEGACY is a sixth state and it is deliberately NOT part of that ladder:
-- it names the generation that is serving production TODAY, which predates this
-- contract and was never gate-proven. Calling it ACTIVE would assert a proof that
-- never happened — the precise substitution this whole workstream exists to stop.
-- It can be superseded; it can never be produced by n5_generation_activate().
-- ---------------------------------------------------------------------------
create table if not exists geo.n5_generation (
  generation_id   text primary key,
  snapshot_id     text        not null,
  cutoff          timestamptz not null,
  state           text        not null
    check (state in ('BUILDING','VALIDATING','READY','ACTIVE','SUPERSEDED','FAILED','ACTIVE_LEGACY')),
  opened_at       timestamptz not null default now(),
  activated_at    timestamptz,
  superseded_at   timestamptz,
  zips_expected   integer,
  zips_done       integer,
  note            text
);
alter table geo.n5_generation enable row level security;

comment on table geo.n5_generation is
  'One row per authoritative geography generation. `cutoff` is the SOURCE WATERMARK: '
  'the ingest state through which this generation claims coverage. Freshness is '
  'now() - cutoff, NEVER now() - computed_at — the phase1 generation wrote rows on '
  '2026-09-05 carrying data as of 2026-09-01, so the write clock understated staleness '
  'by 4.3 days.';

-- AT MOST ONE SERVING GENERATION, enforced by the database rather than by discipline.
create unique index if not exists n5_generation_one_serving
  on geo.n5_generation ((state in ('ACTIVE','ACTIVE_LEGACY')))
  where state in ('ACTIVE','ACTIVE_LEGACY');

-- ---------------------------------------------------------------------------
-- 3) GENERATION-SCOPED UNRESOLVED ACCOUNTING  (founder: no silent third outcome)
--
-- Every expected record that does not reach membership MUST land here with an
-- explicit reason. "Absent" is not an outcome. geo.n5_point_reject already records
-- geometry rejections but is NOT generation-scoped, so it cannot answer "did THIS
-- generation account for THIS record".
-- ---------------------------------------------------------------------------
create table if not exists geo.n5_generation_unresolved (
  generation_id text not null references geo.n5_generation(generation_id) on delete cascade,
  source_key    text not null,
  zip           text,
  reason_code   text not null,
  detail        jsonb,
  recorded_at   timestamptz not null default now(),
  primary key (generation_id, source_key)
);
alter table geo.n5_generation_unresolved enable row level security;
create index if not exists n5_generation_unresolved_gen_ix
  on geo.n5_generation_unresolved (generation_id, reason_code);

comment on table geo.n5_generation_unresolved is
  'The explicit unresolved population for a generation. A record here is ACCOUNTED FOR. '
  'A record in neither membership nor here is UNACCOUNTED, and blocks activation.';

-- ---------------------------------------------------------------------------
-- 4) GENERATION-SCOPED MEMBERSHIP / MARKER / STATUS  (additive columns only)
--
-- Nullable, no default, no backfill of existing rows beyond the legacy stamp below,
-- and no reader touches them yet. Existing behaviour is byte-for-byte unchanged.
-- ---------------------------------------------------------------------------
alter table geo.zip_authoritative_membership add column if not exists generation_id text;
alter table geo.zip_authoritative_marker     add column if not exists generation_id text;
alter table geo.maps_zip_geography_status    add column if not exists generation_id text;

-- ---------------------------------------------------------------------------
-- 5) RECONCILIATION — CHUNKED, because it must never be a monolithic national query
--
-- The national expected set is ~939,592 source_keys; three separate monolithic
-- formulations exceeded a 60s ceiling during the Phase 2 audit. Reconciliation is
-- therefore computed per chunk and PERSISTED, and the activation gate requires
-- every chunk to be present and clean. That also makes a partial verification
-- structurally distinguishable from a passing one.
-- ---------------------------------------------------------------------------
create table if not exists geo.n5_generation_reconcile (
  generation_id      text not null references geo.n5_generation(generation_id) on delete cascade,
  chunk_key          text not null,
  expected_keys      bigint not null,
  accounted_resolved bigint not null,
  accounted_unresolved bigint not null,
  unaccounted        bigint not null,
  computed_at        timestamptz not null default now(),
  primary key (generation_id, chunk_key)
);
alter table geo.n5_generation_reconcile enable row level security;

-- Compute ONE chunk. chunk_key is a ZIP prefix; '0'..'9' gives ten chunks (measured
-- safe), a 3-char prefix gives 544. The function is pure: it writes its own row and
-- returns it, so a caller cannot report a chunk it did not compute.
create or replace function geo.n5_reconcile_chunk(p_generation_id text, p_chunk_key text)
returns geo.n5_generation_reconcile
language plpgsql
set search_path to 'geo', 'public', 'pg_temp'
as $$
declare
  g   geo.n5_generation;
  out geo.n5_generation_reconcile;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id;
  if not found then
    raise exception 'n5_reconcile_chunk: unknown generation %', p_generation_id
      using errcode = '22023';
  end if;
  if p_chunk_key !~ '^[0-9]{1,5}$' then
    raise exception 'n5_reconcile_chunk: chunk_key must be a ZIP prefix, got %', p_chunk_key
      using errcode = '22023';
  end if;

  with expected as (
    select distinct e.source_key
      from public.n5_expected_input(g.cutoff) e
     where left(e.zip, length(p_chunk_key)) = p_chunk_key
  ),
  resolved as (
    select distinct m.source_key
      from geo.zip_authoritative_membership m
     where m.generation_id = p_generation_id
       and m.record_kind = 'development'
       and left(m.zcta5::text, length(p_chunk_key)) = p_chunk_key
  ),
  unres as (
    select distinct u.source_key
      from geo.n5_generation_unresolved u
     where u.generation_id = p_generation_id
       and left(coalesce(u.zip,''), length(p_chunk_key)) = p_chunk_key
  )
  insert into geo.n5_generation_reconcile as r
    (generation_id, chunk_key, expected_keys, accounted_resolved, accounted_unresolved, unaccounted, computed_at)
  select p_generation_id, p_chunk_key,
         (select count(*) from expected),
         (select count(*) from expected x where exists (select 1 from resolved v where v.source_key = x.source_key)),
         (select count(*) from expected x where exists (select 1 from unres   v where v.source_key = x.source_key)),
         (select count(*) from expected x
           where not exists (select 1 from resolved v where v.source_key = x.source_key)
             and not exists (select 1 from unres   v where v.source_key = x.source_key)),
         now()
  on conflict (generation_id, chunk_key) do update
    set expected_keys        = excluded.expected_keys,
        accounted_resolved   = excluded.accounted_resolved,
        accounted_unresolved = excluded.accounted_unresolved,
        unaccounted          = excluded.unaccounted,
        computed_at          = excluded.computed_at
  returning * into out;

  return out;
end
$$;

-- ---------------------------------------------------------------------------
-- 6) THE ACTIVATION GATE — the whole point of this file
--
-- READY -> ACTIVE happens ONLY through here, and only when the expected set is
-- fully accounted for. Every refusal raises. Fail closed, always: an inability to
-- COMPUTE the reconciliation is a refusal, exactly like a failed one, because a
-- verification that did not run and a verification that passed must never be
-- indistinguishable.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_generation_activate(p_generation_id text, p_expected_chunks text[])
returns geo.n5_generation
language plpgsql
set search_path to 'geo', 'public', 'pg_temp'
as $$
declare
  g            geo.n5_generation;
  n_chunks     int;
  n_missing    int;
  n_unaccount  bigint;
  n_expected   bigint;
  integ        record;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'activate: unknown generation %', p_generation_id using errcode = '22023';
  end if;

  -- (a) STATE. Only a READY candidate may be promoted. ACTIVE_LEGACY can never be
  --     produced here, so the pre-contract generation cannot be re-blessed as proven.
  if g.state <> 'READY' then
    raise exception 'activate: generation % is %, not READY', p_generation_id, g.state
      using errcode = '22023';
  end if;

  -- (b) THE CHUNK SET MUST BE DECLARED AND COMPLETE. A caller naming zero chunks,
  --     or naming chunks it never computed, is refused — otherwise "verified" could
  --     mean "verified nothing", which is how a green check attests to nothing.
  if p_expected_chunks is null or array_length(p_expected_chunks, 1) is null then
    raise exception 'activate: no expected chunk set declared' using errcode = '22023';
  end if;
  n_chunks := array_length(p_expected_chunks, 1);
  select count(*) into n_missing
    from unnest(p_expected_chunks) c(k)
   where not exists (select 1 from geo.n5_generation_reconcile r
                      where r.generation_id = p_generation_id and r.chunk_key = c.k);
  if n_missing > 0 then
    raise exception 'activate: % of % declared chunks have no reconciliation row',
      n_missing, n_chunks using errcode = '22023';
  end if;

  -- (c) THE INVARIANT. Every expected record resolved or explicitly unresolved.
  select coalesce(sum(r.unaccounted), 0), coalesce(sum(r.expected_keys), 0)
    into n_unaccount, n_expected
    from geo.n5_generation_reconcile r
   where r.generation_id = p_generation_id
     and r.chunk_key = any (p_expected_chunks);
  if n_unaccount > 0 then
    raise exception 'activate: INV-1 violated — % of % expected source_keys have no accounted outcome',
      n_unaccount, n_expected using errcode = '22023';
  end if;

  -- (d) A VACUOUS PASS IS A FAILURE. Zero expected records across every chunk means
  --     the reconciliation measured nothing, which must not read as clean.
  if n_expected = 0 then
    raise exception 'activate: reconciliation covered 0 expected records — refusing a vacuous pass'
      using errcode = '22023';
  end if;

  -- (e) SOURCE INTEGRITY. A NULL-vintage development row is invisible to every
  --     cutoff-bounded generation, so it must block rather than disappear.
  for integ in select * from public.n5_expected_input_integrity() loop
    if not integ.ok then
      raise exception 'activate: source integrity check % failed — %', integ.check_name, integ.detail
        using errcode = '22023';
    end if;
  end loop;

  -- (f) ATOMIC SWAP. One transaction: the outgoing generation is superseded and this
  --     one becomes ACTIVE together, so no instant exists in which production has two
  --     serving generations or none. The partial unique index is the backstop.
  update geo.n5_generation
     set state = 'SUPERSEDED', superseded_at = now()
   where state in ('ACTIVE','ACTIVE_LEGACY') and generation_id <> p_generation_id;

  update geo.n5_generation
     set state = 'ACTIVE', activated_at = now()
   where generation_id = p_generation_id
  returning * into g;

  return g;
end
$$;

comment on function geo.n5_generation_activate(text, text[]) is
  'The ONLY path to ACTIVE. Refuses unless the declared chunk set is fully reconciled '
  'and every expected source_key has an accounted outcome. Fails closed: a '
  'reconciliation that could not be computed is a refusal, never a pass.';

-- ---------------------------------------------------------------------------
-- 7) REGISTER THE GENERATION PRODUCTION IS SERVING TODAY
--
-- Recorded as ACTIVE_LEGACY, with its real watermark, so the new instrument can
-- describe the CURRENT defect instead of requiring a build before it can say
-- anything. It is not claimed to have passed any gate, because it did not.
-- ---------------------------------------------------------------------------
insert into geo.n5_generation
  (generation_id, snapshot_id, cutoff, state, opened_at, activated_at, zips_expected, zips_done, note)
values
  ('legacy-phase1-2026-09-01', 'phase1-2026-09-01',
   '2026-09-01 13:39:55.360946+00', 'ACTIVE_LEGACY',
   '2026-09-02 18:13:52.943154+00', '2026-09-05 21:58:14.914886+00',
   10467, 10467,
   'Pre-contract generation. Built by 544 unitA shards 2026-09-02..09-05 and cut over '
   'nationally 2026-09-05 21:58:14Z. NEVER gate-proven: no expected-set reconciliation '
   'existed when it was promoted. Registered here so its watermark and lag are queryable, '
   'not to assert that it passed anything.')
on conflict (generation_id) do nothing;

-- Stamp the rows it produced, so generation-scoped reconciliation can address them.
-- ⚠️ APPLIED SEPARATELY AND IN CHUNKS, NOT IN THIS MIGRATION. It touches ~1.9M rows
-- (901,465 membership + 1,004,080 marker), and a single transaction that large is the
-- wrong shape next to a live read path: it holds one long transaction against the two
-- tables app_zip_projects_markers reads on every Map 1 request. Readers are not blocked
-- by ROW EXCLUSIVE, but a timeout mid-way would roll the whole migration back and leave
-- the contract unlanded for a reason that has nothing to do with the contract.
-- Chunked by zcta5 prefix; see the receipts at the foot of this file.
--   update geo.zip_authoritative_membership set generation_id='legacy-phase1-2026-09-01'
--    where generation_id is null and left(zcta5::text,1) = <d>;   -- x10
--   update geo.zip_authoritative_marker ...                        -- x10
--   update geo.maps_zip_geography_status ...                       -- one pass, 12,719 rows

-- ---------------------------------------------------------------------------
-- 8) FRESHNESS, QUERYABLE FROM PRODUCTION
-- ---------------------------------------------------------------------------
create or replace function geo.n5_freshness()
returns table (generation_id text, snapshot_id text, state text,
               cutoff timestamptz, lag_seconds double precision, lag_days double precision)
language sql
stable
set search_path to 'geo', 'pg_temp'
as $$
  select g.generation_id, g.snapshot_id, g.state, g.cutoff,
         extract(epoch from (now() - g.cutoff)),
         round((extract(epoch from (now() - g.cutoff)) / 86400.0)::numeric, 2)::double precision
    from geo.n5_generation g
   where g.state in ('ACTIVE','ACTIVE_LEGACY');
$$;

-- ============================================================================
-- CORRECTION APPLIED IN THE SAME SESSION — migration
-- `n5_reconcile_reads_captured_expected_set`
--
-- n5_reconcile_chunk originally called public.n5_expected_input(g.cutoff): the LIVE
-- table at a historical cutoff. That cannot reproduce a historical population.
-- dev_refresh_tick / app_refresh_zip DELETE AND REINSERT app_projects rows, so
-- created_at is rewritten — a row that existed on 2026-09-01 can now carry a
-- September 15 created_at and fall outside `created_at <= cutoff`.
--
-- MEASURED, bucket 0 at the phase1 cutoff:
--     preservation.app_project_identity   170,929 rows
--     n5_expected_input(live table)       166,526 rows
--     phantom shortfall                     4,403 (2.6%)
-- Reconciliation would have reported those as UNACCOUNTED and blocked activation on
-- a defect that does not exist.
--
-- ⚠️ THE PHASE 2 PROOF WAS TRUE AND I OVER-GENERALISED IT. "The predicate reproduces
-- the manifest exactly" was measured against preservation — the IMMUTABLE capture. It
-- validates the predicate's SHAPE. It says nothing about using that predicate as a
-- retroactive time-travel query over a churning table, which is a different claim.
--
-- THE RULE: n5_expected_input(cutoff) is evaluated ONCE, at capture time, and frozen.
-- Every later reader — reconciliation, verification, monitoring — reads
-- n5_expected_captured(snapshot_id). An expected set that can change after the fact
-- is not a contract.
--
-- Verified: the canonical predicate over the capture reproduces all four manifest
-- counters exactly — 2,976,275 rows / 925,463 projects / 2,753,802 pairs / 10,467
-- ZIPs — and its three extra clauses are a proven no-op there, i.e. the capture
-- already applied them.
--
-- ============================================================================
-- LIVE RECEIPTS, 2026-09-21
--
-- LEGACY STAMP (chunked, outside any migration transaction). Counts identical to the
-- pre-change Phase 0 fingerprints, so nothing was lost:
--   zip_authoritative_membership  901,465 stamped, 0 null   (fingerprint count 901,465)
--   zip_authoritative_marker    1,004,080 stamped, 0 null   (fingerprint count 1,004,080)
--   maps_zip_geography_status      12,719 stamped, 0 null   (fingerprint count 12,719)
--
-- FRESHNESS, through the shipped reader:
--   geo.n5_freshness() -> legacy-phase1-2026-09-01 / ACTIVE_LEGACY /
--                         cutoff 2026-09-01 13:39:55Z / lag_days 20.12
--   The write clock said 15.8 days. The watermark says 20.12. The watermark is the
--   honest number and is now the one production can query.
--
-- 🔑 FIRST RECONCILIATION OF THE GENERATION PRODUCTION IS ACTUALLY SERVING —
--    geo.n5_reconcile_chunk('legacy-phase1-2026-09-01','0'):
--      expected_keys        26,978
--      accounted_resolved   15,204   (56.4%)
--      accounted_unresolved      0   (the legacy build has NO unresolved accounting)
--      unaccounted          11,774   (43.6%)
--    43.6% of one chunk's expected records have NO accounted outcome — neither in
--    membership nor in any reject population. That is the banned silent third
--    outcome, measured for the first time. It is a COMPLETENESS reading, not a
--    freshness one, and it does not authorise touching build_associations().
--    ⚠️ It also spans the open D-2 question: expected is bucketed by USPS ZIP and
--    resolved by Census ZCTA, so part of this number is the ZIP/ZCTA boundary and
--    part is genuine absence. The split is NOT established here.
--
-- GATE PROOF — all seven refusal paths refused, live:
--   A wrong_state         'generation legacy-phase1-2026-09-01 is ACTIVE_LEGACY, not READY'
--   B no_chunks           'no expected chunk set declared'
--   C chunk_unreconciled  '1 of 1 declared chunks have no reconciliation row'
--   D inv1_violated       'INV-1 violated - 5 of 100 expected source_keys have no accounted outcome'
--   E vacuous_pass        'reconciliation covered 0 expected records - refusing a vacuous pass'
--   F unknown_gen         'unknown generation no-such-generation'
--   G bad_chunk_key       'chunk_key must be a ZIP prefix, got ABC'
--   Test generation deleted afterwards: 1 generation row remains, 0 test rows.
--
-- ⛔ THE SUCCESS PATH IS DELIBERATELY UNPROVEN. Activating a synthetic generation
--    would mark the serving legacy generation SUPERSEDED — a false statement about
--    production, for a test. The fail-closed property is what this gate exists for
--    and it is proven; the success path is proven by the first real generation.
-- ============================================================================
