-- ===========================================================================
-- FIX 17 — SAVED-PLACE IDENTITY.  SQL of record.
--
-- THE DEFECT.  public.app_properties is the ONLY per-user table in this schema
-- with no natural-key uniqueness.  Every sibling already has one:
--     app_follows        UNIQUE (user_id, target_type, target_id)
--     app_topic_prefs    PRIMARY KEY (user_id, category)
--     user_subscriptions UNIQUE (user_id, community_id, pipeline_type, topic)
--     public.users       UNIQUE (email, community_id)
-- so HS.saveHome's bare INSERT could file the same place any number of times.
-- Measured 2026-09-13: 9 rows, 8 distinct (user, address, zip), one excess row —
-- User B's 96 ISLAND DR / 78657 saved TWICE, 0.991 s apart, byte-identical in
-- every column except id and created_at.  A rapid double-submit.
--
-- ---------------------------------------------------------------- THE KEY
--   UNIQUE (user_id,
--           hs_premium_fold_address(address),
--           coalesce(zip, ''),
--           hs_premium_fold_address(coalesce(input_address, address)))
--
-- WHY input_address IS IN THE KEY — the unit/apartment decision, measured.
-- The Census one-line locator DROPS the secondary unit designator and does NOT
-- return it separately.  Ten live probes through pg_net, 2026-09-13, two
-- independent buildings, four designator syntaxes, every one HTTP 200:
--
--   '350 5TH AVE APT 101, NEW YORK, NY 10118'  -> '350 5TH AVE, NEW YORK, NY, 10118'
--   '350 5TH AVE APT 102, NEW YORK, NY 10118'  -> '350 5TH AVE, NEW YORK, NY, 10118'
--   '350 5TH AVE UNIT 101, NEW YORK, NY 10118' -> '350 5TH AVE, NEW YORK, NY, 10118'
--   '350 5TH AVE #101, NEW YORK, NY 10118'     -> '350 5TH AVE, NEW YORK, NY, 10118'
--   '350 5TH AVE, NEW YORK, NY 10118'          -> '350 5TH AVE, NEW YORK, NY, 10118'
--   '1000 W 5TH ST APT 200 / APT 305 / bare, AUSTIN, TX 78703'
--                                              -> '1000 W 5TH ST, AUSTIN, TX, 78703'
--   control '96 ISLAND DR, HORSESHOE BAY, TX 78657' -> matches production byte for byte
--
-- addressComponents carries NO unit-like key on any of the ten
-- (zip, city, state, preType, toAddress, streetName, suffixType, fromAddress,
--  preDirection, preQualifier, suffixDirection, suffixQualifier) — so the unit is
-- not hiding in a field we failed to read.  It is gone before we ever see it, and
-- our own `.split(',')[0]` is NOT the discarder.
--
-- ⚠️  A KEY OVER THE CENSUS LINE ALONE WOULD THEREFORE ASSERT THAT APT 101 AND
-- APT 102 ARE ONE PHYSICAL PROPERTY.  That is a claim the evidence does not
-- support, so it is not made.  The resident's own typed string is the only
-- unit-bearing value in the flow; it was being thrown away.  It is now stored
-- verbatim in input_address and folded into the key.
--
-- 🔑 THE FAILURE MODES OF THE TWO CANDIDATE KEYS ARE NOT SYMMETRIC, AND THAT IS
-- WHY THIS ONE WAS CHOSEN.  A presence-test regex over the USPS secondary
-- designators (APT|UNIT|STE|#|BLDG|FL|RM|LOT|…) would key more tightly, but a
-- FALSE NEGATIVE there merges two real homes — silent, unrecoverable, and the
-- exact harm being avoided.  Folding the raw input has no regex and only one
-- failure mode: a resident who retypes the same house differently keeps an extra
-- row.  It fails SAFE.  A tighter key that can fail unsafe is not narrower.
--
-- ⛔ NOT a second normalizer.  hs_premium_fold_address (Fix 15) is reused
-- verbatim — one computation site, the rule that file established.  Body md5
-- pinned below; a silent edit to it changes this key and must fail loudly.
-- ⛔ NOT app_properties.id.  Fix 15 already measured it as a per-save row id.
-- ⛔ NOT (user_id, lat, lng).  Units share coordinates exactly, so it collides
-- harder, and it breaks whenever the geocoder revises a point.
-- ⛔ NOT the canonicalAddr() key behind property_reports.  That normalizer is
-- engine-side TypeScript with a full abbreviation table; porting it into SQL is
-- the "SECOND normalizer to keep in step" Fix 15 declined.
-- ⛔ NOT global (cross-user) uniqueness.  Three users legitimately hold
-- 96 ISLAND DR today; a global key would break them AND build an existence
-- oracle out of the conflict.  The key is user-scoped, under RLS.
--
-- coalesce(zip,'') is load-bearing: Postgres treats NULLs as DISTINCT in a unique
-- index, so a key over the raw nullable column would never dedupe a null-zip row.
--
-- KNOWN LIMIT, STATED NOT BURIED.  Because the typed string is part of the
-- identity, 'x' and 'x, city ST' from one resident are two identities.  That is
-- strictly better than today (where even the byte-identical retype duplicates)
-- and is the honest cost of not asserting two units are one home.  Closing it
-- means capturing a unit COMPONENT — a product/data-model change, logged, not
-- smuggled in here.
--
-- WHAT THIS FILE DOES NOT TOUCH: user_subscriptions, app_topic_prefs, alert
-- topics, email behaviour.  Alert-subscription identity is (user, community,
-- pipeline_type, topic) and carries no reference to a saved place — measured:
-- zero columns named *propert* anywhere in the database, zero FKs to
-- app_properties, and none of subscribe_area_defaults / enable_area_email_alerts
-- / signup_complete accepts a place.  Deduping a place cannot remove a topic.
--
-- Repo convention (CLAUDE.md §1 #3): parked SQL, applied as a migration.
-- PART 1 is additive and safe to apply BEFORE the client deploy.
-- PART 2 must be applied AFTER it, because the producer has to be dead first.
-- ===========================================================================


-- ===========================================================================
-- PART 1 — the unit-bearing column.  ADDITIVE.  Apply before the client deploy.
-- ===========================================================================
alter table public.app_properties
  add column if not exists input_address text;

comment on column public.app_properties.input_address is
  'FIX 17. The address string the resident actually typed, stored verbatim. It is '
  'IDENTITY AND PROVENANCE ONLY and is never rendered: the displayed address stays '
  'the Census-confirmed match, which is the honesty contract in shell.js::openHome. '
  'It exists because the Census one-line locator drops secondary unit designators, '
  'so this is the only unit-bearing value in the flow. NULL on rows written before '
  'Fix 17 and on any writer that has none; the key coalesces to address.';


-- ===========================================================================
-- PART 2 — dedupe, then the invariant.  ATOMIC, FAIL-CLOSED.
-- Apply only once the producer fix is deployed, or the next double-click refills
-- the cohort and the deletion looks like it worked.
-- ===========================================================================
do $$
declare
  v_fold_md5   text;
  v_cohort_md5 text;
  v_arch_md5   text;
  v_del_md5    text;
  v_excess     int;
  v_before     int;
  v_after      int;
  v_groups     int;
begin
  ------------------------------------------------------------------ preflight
  -- (p1) The normalizer this key is built on must be the Fix 15 one, unedited.
  select md5(pg_get_functiondef(p.oid)) into v_fold_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'hs_premium_fold_address';
  if v_fold_md5 is distinct from '2a4b63222018325185b6540aa5853d77' then
    raise exception 'FIX17 p1: hs_premium_fold_address body changed (md5 %) — the key would '
      'silently change meaning. Re-measure before applying.', coalesce(v_fold_md5, 'MISSING');
  end if;

  -- (p2) Part 1 must already be applied.
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='app_properties'
                    and column_name='input_address') then
    raise exception 'FIX17 p2: app_properties.input_address is missing — apply PART 1 first.';
  end if;

  select count(*) into v_before from public.app_properties;

  ------------------------------------------------- the cohort, computed IN-DB
  -- NEVER transcribed (CLAUDE.md rule 7). Partitioned BY USER, so the three
  -- legitimate cross-user repeats of the same address can never be selected.
  -- THE KEY IS MATERIALISED ONCE, AS A COLUMN, AND EVERY LATER STEP READS THAT COLUMN.
  -- The first version of this block re-spelled the four-part expression at each use site
  -- and the temp table did not carry input_address, so the second spelling raised 42703
  -- and the whole migration failed closed (correctly — nothing was written). Restating a
  -- compound key by hand at N sites is N chances for the sites to disagree; one column is
  -- one definition.
  create temporary table fix17_cohort on commit drop as
  select id, user_id, address, zip, input_address, created_at,
         public.hs_premium_fold_address(address)
           || '|' || coalesce(zip, '')
           || '|' || public.hs_premium_fold_address(coalesce(input_address, address)) as place_key,
         row_number() over (
           partition by user_id,
                        public.hs_premium_fold_address(address),
                        coalesce(zip, ''),
                        public.hs_premium_fold_address(coalesce(input_address, address))
           order by created_at asc, id asc          -- OLDEST SURVIVES
         ) as rn
    from public.app_properties;

  select count(*) into v_excess from fix17_cohort where rn > 1;
  select count(*) into v_groups from (
    select 1 from fix17_cohort group by user_id, place_key having count(*) > 1) g;

  -- (p3) Fail closed on the measured shape. 9 rows, 1 group, 1 excess row.
  if v_before <> 9 or v_groups <> 1 or v_excess <> 1 then
    raise exception 'FIX17 p3: shape moved — rows % (expected 9), duplicate groups % '
      '(expected 1), excess rows % (expected 1). Re-measure; do not widen this gate.',
      v_before, v_groups, v_excess;
  end if;

  -- (p4) Fingerprint the cohort. collate "C" is not optional (CLAUDE.md rule 9).
  select md5(string_agg(id::text, ',' order by id::text collate "C"))
    into v_cohort_md5 from fix17_cohort where rn > 1;

  -- (p5) NO dependent may be lost. app_follows.target_id is a TEXT soft reference
  -- with no FK, so it is checked explicitly rather than trusted to cascade.
  if exists (select 1 from public.app_follows f
              join fix17_cohort c on c.id::text = f.target_id
             where c.rn > 1) then
    raise exception 'FIX17 p5: a row being removed carries an app_follows reference — '
      'consolidation would orphan a property watch. Stop and merge by hand.';
  end if;

  ------------------------------------------------------------------- archive
  create table if not exists public.fix17_duplicate_rows_archive (
    id            uuid primary key,
    row_json      jsonb not null,
    archived_at   timestamptz not null default now(),
    archived_note text
  );
  alter table public.fix17_duplicate_rows_archive enable row level security;
  revoke all on public.fix17_duplicate_rows_archive from anon, authenticated;

  insert into public.fix17_duplicate_rows_archive (id, row_json, archived_note)
  select p.id, to_jsonb(p),
         'FIX 17 same-user duplicate; survivor is the oldest row of the same identity'
    from public.app_properties p join fix17_cohort c on c.id = p.id
   where c.rn > 1
  on conflict (id) do nothing;

  select md5(string_agg(id::text, ',' order by id::text collate "C"))
    into v_arch_md5 from public.fix17_duplicate_rows_archive;
  if v_arch_md5 is distinct from v_cohort_md5 then
    raise exception 'FIX17: archive fingerprint % <> cohort %', v_arch_md5, v_cohort_md5;
  end if;

  -------------------------------------------------------------------- delete
  with gone as (
    delete from public.app_properties p
     using fix17_cohort c
     where c.id = p.id and c.rn > 1
     returning p.id
  )
  select md5(string_agg(id::text, ',' order by id::text collate "C")) into v_del_md5 from gone;
  if v_del_md5 is distinct from v_cohort_md5 then
    raise exception 'FIX17: deleted-set fingerprint % <> cohort %', v_del_md5, v_cohort_md5;
  end if;

  ----------------------------------------------------------------- invariant
  create unique index if not exists app_properties_user_place_key
    on public.app_properties (
      user_id,
      public.hs_premium_fold_address(address),
      coalesce(zip, ''),
      public.hs_premium_fold_address(coalesce(input_address, address))
    );

  ------------------------------------------------------------ post-conditions
  select count(*) into v_after from public.app_properties;

  -- (e1) exactly the excess row left, nothing else
  if v_after <> v_before - v_excess then
    raise exception 'FIX17 e1: row count % , expected %', v_after, v_before - v_excess;
  end if;
  -- (e2) no same-user duplicate identity survives
  if exists (select 1 from public.app_properties
              group by user_id, public.hs_premium_fold_address(address), coalesce(zip,''),
                       public.hs_premium_fold_address(coalesce(input_address, address))
             having count(*) > 1) then
    raise exception 'FIX17 e2: a same-user duplicate identity survived';
  end if;
  -- (e3) THE CROSS-USER REPEATS ARE THE THING MOST AT RISK FROM A BAD CLEANUP.
  --      Three addresses are legitimately held by more than one account.
  if (select count(*) from (
        select address, zip from public.app_properties
         group by address, zip having count(distinct user_id) > 1) g) <> 3 then
    raise exception 'FIX17 e3: expected 3 cross-user repeated addresses to survive';
  end if;
  -- (e4) every user keeps every distinct place they had
  if (select count(*) from (
        select distinct user_id, address, zip from public.app_properties) g) <> 8 then
    raise exception 'FIX17 e4: expected 8 distinct (user, address, zip) identities';
  end if;
  -- (e5) the index really exists and is UNIQUE
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                  where c.relname = 'app_properties_user_place_key' and i.indisunique) then
    raise exception 'FIX17 e5: unique index absent';
  end if;
  -- (e6) no alert surface was touched
  if (select count(*) from public.user_subscriptions) <> 100 then
    raise exception 'FIX17 e6: user_subscriptions row count moved — this migration must not touch it';
  end if;
  -- (e7) RLS still on, still owner-scoped
  if not (select relrowsecurity from pg_class where oid = 'public.app_properties'::regclass) then
    raise exception 'FIX17 e7: RLS is off on app_properties';
  end if;

  raise notice 'FIX 17 applied. rows % -> %, removed % (cohort md5 %), identities 8, cross-user repeats 3.',
    v_before, v_after, v_excess, v_cohort_md5;
end $$;
