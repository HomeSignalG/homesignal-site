-- docs/decision-provenance-migration.sql
--
-- PARKED. NOT APPLIED. Applying it is a separately gated production change.
--
-- ── WHAT IS ALREADY WORKING WITHOUT THIS ─────────────────────────────────────────────
-- Read this first, because the important half needs NO migration at all and a future
-- session must not conclude the decision-history work is blocked on this file.
--
-- public.app_refresh_zip ALREADY carries a decision receiver, and has since long before
-- the 2026-09-20 contract:
--
--     case when lower(coalesce(el->>'decided','')) = 'true' then 'Decided'
--          else case lower(coalesce(nullif(el->>'bucket',''), nullif(el->>'type',''), ''))
--            when 'built' then 'Active' when 'approved' then 'Approved'
--            when 'proposed' then 'Proposed' when 'operating' then 'Operating'
--            else 'On file' end
--     end
--
-- It had simply never fired. Measured 2026-09-20: `app_projects` holds 3,000,229
-- `record_kind='development'` rows and exactly 0 carry status 'Decided', because no
-- connector had ever stamped `decided` — every denial died in the registry's `exclude`
-- bucket first. With the connectors now emitting decisions, that branch starts firing on
-- its own, `bluesky/lib/maps-eligibility.mjs` refuses those rows, and the whole
-- social-claims protection lands with zero DDL.
--
-- ── WHAT THIS FILE WOULD ADD, AND WHY IT IS SEPARATE ─────────────────────────────────
-- `status = 'Decided'` says a decision happened. It does not say WHICH decision, WHEN, or
-- WHERE THE RECORD IS. Those three live in the engine payload's `decision` object and
-- today they reach the resident only on Map 1, which reads `development_reports` directly.
-- Surfaces backed by `app_projects` — the community page card, the dashboard rails, the
-- N5 radius view — can therefore say "Proposed · decided" and no more. That is honest and
-- deliberately so: `lib/templates.js::browsingStatusLabel` refuses to name an outcome it
-- cannot source, because reading "denied" out of "decided" is exactly the fabrication the
-- contract exists to remove.
--
-- This migration closes that gap by carrying the sourced decision through into the
-- provenance jsonb the materializer already builds. NO new column: `provenance` exists,
-- is already read by the social gate (`row.provenance`), and already carries seven keys.
--
-- ⛔ THE HAZARD THIS FILE MUST NOT REPEAT — a parked migration that is mostly comments is
-- not a migration (the Phase 1B lesson: replaying it added a column and silently skipped
-- the writer). So the statement below is EXECUTABLE and SPLICED from the LIVE function
-- body at apply time; it does not reproduce app_refresh_zip as a comment, and it does not
-- retype ~19,000 characters of a function that other sessions also edit. It fails closed
-- if its anchor is not found exactly once, and it re-reads the function afterwards to
-- prove the splice took.

begin;

do $mig$
declare
  _def   text;
  _anchor text := $anchor$        'source_vintage', _vintage$anchor$;
  _n     int;
  _before text;
  _after  text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip';
  if _def is null then
    raise exception 'app_refresh_zip not found — refusing to guess at its body';
  end if;
  _before := md5(_def);

  -- FAIL CLOSED ON THE ANCHOR. A splice that silently matches twice edits something it
  -- was not shown; a splice that matches zero times reports success over nothing.
  _n := (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor);
  if _n <> 1 then
    raise exception 'anchor found % time(s), expected exactly 1 — the function body moved; '
                    're-derive the anchor rather than loosening it', _n;
  end if;

  -- Idempotent: a second apply is a no-op rather than a second copy of the key.
  if position('''decision'',       el->''decision''' in _def) > 0 then
    raise notice 'decision already carried in provenance — nothing to do';
    return;
  end if;

  _def := replace(_def, _anchor, _anchor || ',
        -- THE SOURCED DECISION (2026-09-20 contract, sources/decision.ts). Carried whole
        -- so a consumer reads the outcome, its date and its record URL from ONE object it
        -- can check, rather than re-deriving any of them from `status`. jsonb_strip_nulls
        -- around this object already drops the key on a live proposal, so an undecided
        -- record''s provenance is byte-identical to what it was before this change.
        ''decision'',       el->''decision''');

  execute _def;

  -- PROVE THE SPLICE TOOK (rule 8: fingerprint, never eyeball).
  select pg_get_functiondef(p.oid) into _after
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip';
  if position('''decision'',       el->''decision''' in _after) = 0 then
    raise exception 'splice did not take — function body unchanged after execute';
  end if;
  raise notice 'app_refresh_zip md5 % -> %', _before, md5(_after);
end
$mig$;

commit;

-- ── AFTER APPLYING ───────────────────────────────────────────────────────────────────
--  1. `lib/templates.js::browsingStatusLabel` may then read
--     provenance.decision.outcome_label and say "Proposed · denied" on the community card.
--     It is written NOT to today, and the comment there names this file.
--  2. Existing rows do NOT gain a decision. `app_refresh_zip` rebuilds a ZIP's rows from
--     its cached report, so the value appears as each ZIP is refreshed — which is the
--     separately gated production backfill, not this migration.
--  3. `bluesky/lib/maps-eligibility.mjs::hasRecordedDecision` already reads
--     `provenance.decision`; it needs no change and gains a third independent route to
--     the same refusal.
