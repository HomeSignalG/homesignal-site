-- app_projects.type_raw — the publisher's OWN project-type value, verbatim, pre-mapping.
-- Applied to production 2026-08-19 as migration `app_projects_type_raw`.
--
-- WHY. `app_projects.type` stores the MAPPED six-value `use_type` from lib/map.js::TYPE_EXACT.
-- That mapping is lossy by design, and the loss is exactly the evidence needed to audit it:
-- a record rendering as the generic "Other project" circle can be either (a) correct — the
-- publisher genuinely states no project type — or (b) a missing `type_map` entry in
-- jurisdiction-registry.json. Measured 2026-08-18 those two are INDISTINGUISHABLE once the
-- value is mapped, which is why the FALLBACK:other investigation had to re-fetch every
-- publisher live to answer a question the cache should have been able to answer.
--
-- This is the same discipline `status_raw` already follows (engine → `app_projects.stage`),
-- and it is deliberately NOT interpreted, normalised, or defaulted anywhere.
--
-- NON-RETROACTIVE. A row carries `type_raw` only once its ZIP has been re-cached through the
-- engine deployed 2026-08-19. Any audit MUST report the not-yet-refreshed denominator
-- alongside its counts — see `docs/type-raw-audit.sql`.
--
-- DELIBERATELY UNINDEXED, matching the `stage` precedent: app_projects is ~4.2 GB / ~3.08M
-- rows, the audit is an occasional report rather than a page query, and an index here would
-- cost more than the column.

-- ── 1. the column ────────────────────────────────────────────────────────────────────────
alter table public.app_projects add column if not exists type_raw text;

comment on column public.app_projects.type_raw is
  'The publisher''s OWN project-type value, verbatim (trimmed, case preserved), BEFORE the '
  'jurisdiction-registry type_map is applied. Carried from development_reports.sites[].type_raw '
  'by app_refresh_zip. NULL when the registry entry maps no type column or the source row left '
  'it empty. Exists so the mapping can be AUDITED — `type` holds the mapped six-value use_type, '
  'which destroys the evidence that separates a correct-by-design generic bucket from a missing '
  'type_map entry. NEVER interpret it, normalise it, or fall back to the mapped value: a "raw" '
  'field that has been cleaned up cannot prove what the publisher said. Non-retroactive — a row '
  'carries it only once its ZIP is re-cached through the engine deployed 2026-08-19.';

-- ── 2. app_refresh_zip carries it through ────────────────────────────────────────────────
-- The function body is ~200 lines and is NOT retyped here. It is read from the live catalog,
-- three anchored insertions are applied, and each anchor is asserted to occur EXACTLY ONCE
-- before it is replaced — hand-reflowing a function definition is the same unreviewed-edit
-- class as hand-transcribing a uuid array.
do $mig$
declare
  src text; patched text; n int;
  a1 text := $a$registry_id, date_kind,$a$;                    -- development insert column list
  a2 text := $a$then 'decided' end,$a$;                        -- …its matching select position
  a3 text := $a$date_kind=excluded.date_kind,$a$;              -- …its ON CONFLICT update list
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'app_refresh_zip';
  if src is null then raise exception 'app_refresh_zip not found — nothing to patch'; end if;
  if position('type_raw' in src) > 0 then
    raise notice 'app_refresh_zip already carries type_raw — nothing to do'; return;
  end if;
  patched := src;

  n := (length(patched) - length(replace(patched, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'anchor 1 matched % times, expected exactly 1', n; end if;
  patched := replace(patched, a1, $r$registry_id, date_kind, type_raw,$r$);

  n := (length(patched) - length(replace(patched, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'anchor 2 matched % times, expected exactly 1', n; end if;
  patched := replace(patched, a2, $r$then 'decided' end,
      nullif(el->>'type_raw',''),$r$);

  n := (length(patched) - length(replace(patched, a3, ''))) / length(a3);
  if n <> 1 then raise exception 'anchor 3 matched % times, expected exactly 1', n; end if;
  patched := replace(patched, a3, $r$date_kind=excluded.date_kind, type_raw=excluded.type_raw,$r$);

  -- Fingerprint the edit two ways. (a) exactly three new mentions; (b) ROUND-TRIP: undoing
  -- the three insertions must reproduce the original definition byte-for-byte, which proves
  -- nothing else in the body moved. A byte-count assert would only prove the total size — a
  -- deletion and an insertion of equal length would score green.
  -- 4, not 3: anchor 3's replacement mentions it twice (`type_raw=excluded.type_raw`).
  n := (length(patched) - length(replace(patched, 'type_raw', ''))) / length('type_raw');
  if n <> 4 then raise exception 'expected 4 type_raw mentions after patch, found %', n; end if;
  if replace(
       replace(
         replace(patched, $u$then 'decided' end,
      nullif(el->>'type_raw',''),$u$, $u$then 'decided' end,$u$),
       ' type_raw=excluded.type_raw,', ''),
     ' type_raw,', '') <> src then
    raise exception 'round-trip failed — the patch changed more than the three anchors';
  end if;

  execute patched;
end $mig$;
