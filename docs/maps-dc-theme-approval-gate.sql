-- APPLIED 2026-09-19 as migration `maps_dc_theme_approval_gate`, ledger version
-- 20260919151300. Live effects verified AFTER the apply, not assumed: the guard is present
-- in pg_get_functiondef, SECURITY DEFINER and search_path=public survived the replace, the
-- before-insert trigger exists, and eight probes ran in a rolled-back transaction (theme row
-- with no capture REFUSED 23514 · off-theme draft still approves · non-owner still refused
-- first · no-theme-key refused · theme:null and theme:"datacenter" accepted · ALERTS
-- untouched with a missing key and with NULL evidence). State after: 38 draft / 0 approved.
--
-- ⚠️ THE MIGRATION LEDGER'S `statements` CAPTURE IS PARTIAL FOR THIS MIGRATION — it stored
-- ONE statement where four were applied (the splice DO block, the trigger function, the
-- trigger, and the invariants DO block). Do NOT treat supabase_migrations.schema_migrations
-- as the reproducible source here; THIS FILE is. The recorded statements md5
-- (5d6b5107ef9797257161c76f97271bf3, 5,066 chars) therefore covers only the first block,
-- which is why it does not equal this file's executable body (6,585 chars) — the remaining
-- difference is inline commentary. Re-apply from this file, then re-record.

-- maps-dc-theme-approval-gate.sql — SQL OF RECORD for the server-side half of the
-- MAPS · Data Center Theme capture contract. Parked here per CLAUDE.md §1 (#3:
-- docs/*.sql is the DDL of record) and APPLIED as migration
-- `maps_dc_theme_approval_gate`.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────
-- The contract "a Data Center Theme post publishes the real Map 1 screenshot" lived
-- ENTIRELY IN BROWSER JAVASCRIPT (acquisition.html::bskyApprovalBlockReason). The RPC
-- that actually flips status carried no image check at all, and bluesky-publish.yml runs
-- every 30 minutes with REQUIRE_IMAGE="0". So the guarantee could be bypassed by a
-- console call, a stale tab, or any approval path that is not that one page.
--
-- Measured 2026-09-19 before this applied: 38 MAPS posts, 1 of them Data Center Theme,
-- that one carrying NO image_bucket_path — i.e. the exact row the browser gate refuses
-- and the database would have accepted. 0 rows are approved or published, so this
-- changes no existing state; it closes the hole before it is ever used.
--
-- ── WHY THE STAMPED THEME AND NOT A CLASSIFIER ──────────────────────────────────────
-- The theme rule is Map 1's own (lib/map.js::statedDataCenter, ported verbatim to
-- homesignal-ingest bluesky/lib/maps-datacenter.mjs). Re-implementing it in SQL would be
-- a THIRD copy of a decision this codebase insists must have exactly one definition. So
-- the gate reads `evidence->>'theme'`, the IMMUTABLE candidate-time stamp the generator
-- writes, and nothing else.
--
-- ⚠️ THE LEGACY GAP IS REAL, MEASURED, CLOSED, AND DELIBERATELY NOT BACKFILLED.
-- 27 of the 38 MAPS rows predate the theme stamp and carry no `theme` key. Failing
-- closed on them would block 27 legitimate drafts, so the gate cannot simply refuse an
-- unstamped row. Instead:
--   * measured: 0 of those 27 match any data-centre vocabulary on project_name / type /
--     type_raw, with a NON-ZERO positive control (the same regex returns 1 over the
--     stamped rows), so the zero is a real absence and not a dead query;
--   * the set is CLOSED by the trigger below, which requires the stamp on every NEW
--     MAPS row, so it can never grow;
--   * and nothing is written into `evidence.theme` for them. That field records what the
--     classifier decided AT CANDIDATE TIME; stamping it now from a later run would be a
--     fabricated provenance claim in the one field that exists to prevent exactly that
--     (CLAUDE.md: "never write a provenance claim you did not perform").
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────
-- It is not REQUIRE_IMAGE. That switch is global and is "0" on purpose, because
-- screenshot coverage across the whole queue is unverified; flipping it would strand
-- every imageless draft. This gate is narrow: one theme, one field, one refusal.
--
-- Idempotent. Fail-closed. Safe to re-run.

do $mig$
declare
  def       text;
  anchor    text := '  if not found then raise exception ''social_posts % not found'', p_id; end if;';
  guard     text;
  md5_before text;
  md5_after  text;
  n          int;
begin
  select pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid))
    into def, md5_before
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'hs_approve_social_post';

  if def is null then
    raise exception 'hs_approve_social_post not found — refusing to guess at its body';
  end if;

  -- Already applied? Nothing to do.
  if position('Data Center Theme' in def) > 0 then
    raise notice 'maps_dc_theme_approval_gate: already present, no change';
    return;
  end if;

  -- FAIL CLOSED ON THE ANCHOR. A splice that silently matched twice, or zero times,
  -- would either duplicate the guard or quietly not install it (CLAUDE.md rule 7 — the
  -- bare-14-day-clause trap, where one anchor appeared twice and edited the wrong half).
  n := (select count(*) from regexp_matches(def, regexp_replace(anchor, '([().*+?\[\]{}|^$\\])', '\\\1', 'g'), 'g'));
  if n <> 1 then
    raise exception 'anchor matched % times, expected exactly 1 — refusing to splice', n;
  end if;

  guard := anchor || E'\n'
    || E'\n'
    || E'  -- MAPS · DATA CENTER THEME: the capture is MANDATORY, enforced here and not only\n'
    || E'  -- in the dashboard. Reads the immutable candidate-time theme stamp; never\n'
    || E'  -- re-derives the classification (one definition, in lib/map.js).\n'
    || E'  if rec.content_family = ''MAPS''\n'
    || E'     and coalesce(rec.evidence ->> ''theme'', '''') = ''datacenter''\n'
    || E'     and rec.image_bucket_path is null then\n'
    || E'    raise exception ''social_posts %: a MAPS Data Center Theme post publishes the real Map 1 screenshot, and none has been captured for it''\n'
    || E'      , p_id using errcode = ''23514'';\n'
    || E'  end if;';

  def := replace(def, anchor, guard);
  execute def;

  -- PROVE THE SPLICE TOOK, by re-reading rather than trusting `execute`.
  select md5(pg_get_functiondef(p.oid)) into md5_after
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'hs_approve_social_post';

  if md5_after = md5_before then
    raise exception 'function body unchanged after execute — splice did not take';
  end if;
  raise notice 'hs_approve_social_post md5 % -> %', md5_before, md5_after;
end
$mig$;

-- ── THE CLOSED SET, ENFORCED ────────────────────────────────────────────────────────
-- Every NEW MAPS row must carry a theme decision, so the unstamped legacy population can
-- never grow and the gate above can never be bypassed by a row it cannot evaluate.
-- `null` is a perfectly good decision and is what the generator writes for a non-theme
-- project; what is refused is the ABSENCE of the key.
--
-- INSERT ONLY, deliberately. An UPDATE trigger would fire on the dashboard's post_text
-- edit and on the screenshot workers' image_bucket_path PATCH, blocking legitimate
-- writes to the 27 legacy rows for no benefit.
create or replace function public.maps_theme_stamp_required()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $fn$
begin
  if new.content_family = 'MAPS' and not (coalesce(new.evidence, '{}'::jsonb) ? 'theme') then
    raise exception 'a MAPS social_posts row must carry evidence.theme (null is a valid decision; a missing key is not)'
      using errcode = '23514';
  end if;
  return new;
end
$fn$;

drop trigger if exists maps_theme_stamp_required on public.social_posts;
create trigger maps_theme_stamp_required
  before insert on public.social_posts
  for each row execute function public.maps_theme_stamp_required();

-- ── INVARIANTS — the apply is not done until these pass ─────────────────────────────
do $chk$
declare
  has_guard   boolean;
  has_trigger boolean;
  secdef      boolean;
  cfg         text[];
  legacy      int;
  legacy_dc   int;
  control_dc  int;
begin
  select position('Data Center Theme' in pg_get_functiondef(p.oid)) > 0,
         p.prosecdef, p.proconfig
    into has_guard, secdef, cfg
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'hs_approve_social_post';

  if not has_guard then raise exception '(a) the approval guard is not present'; end if;
  -- The splice replays pg_get_functiondef, which carries these; assert rather than hope,
  -- because losing SECURITY DEFINER or the pinned search_path would be a privilege change
  -- arrived at by omission (the reloptions lesson in homesignal-site CLAUDE.md §7.1).
  if not secdef then raise exception '(b) SECURITY DEFINER was lost by the replace'; end if;
  if cfg is null or not ('search_path=public' = any (cfg)) then
    raise exception '(c) the pinned search_path was lost by the replace';
  end if;

  select exists (select 1 from pg_trigger t
                 where t.tgrelid = 'public.social_posts'::regclass
                   and t.tgname = 'maps_theme_stamp_required'
                   and not t.tgisinternal)
    into has_trigger;
  if not has_trigger then raise exception '(d) the theme-stamp trigger is not installed'; end if;

  -- (e) The legacy population is what it was measured to be, and none of it is a data
  --     centre. The control must be NON-ZERO or the zero proves nothing.
  select count(*) filter (where not (evidence ? 'theme')),
         count(*) filter (where not (evidence ? 'theme') and (
              coalesce(evidence->>'project_name','') ~* 'data[ -]*cent(er|re|e)|data[ -]*hall|hyperscale|server[ -]*farm'
           or coalesce(evidence->>'type','')         ~* 'data[ -]*cent(er|re|e)|data[ -]*hall|hyperscale|server[ -]*farm'
           or coalesce(evidence->>'type_raw','')     ~* 'data[ -]*cent(er|re|e)|data[ -]*hall|hyperscale|server[ -]*farm')),
         count(*) filter (where (evidence ? 'theme')
           and coalesce(evidence->>'project_name','') ~* 'data[ -]*cent(er|re|e)')
    into legacy, legacy_dc, control_dc
  from public.social_posts where content_family = 'MAPS';

  if legacy_dc <> 0 then
    raise exception '(e) % unstamped legacy MAPS row(s) look like a data centre — the gate cannot see them', legacy_dc;
  end if;
  if control_dc = 0 then
    raise exception '(e-control) the data-centre regex matched nothing anywhere, so the zero above proves nothing';
  end if;
  raise notice 'invariants pass: legacy unstamped %, of which data-centre % (control %)', legacy, legacy_dc, control_dc;
end
$chk$;
