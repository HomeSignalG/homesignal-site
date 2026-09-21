-- ============================================================================
-- MAPS · DATA CENTER THEME — "GENERATE DRAFTS" BUTTON — DDL of record
--
-- CLAUDE.md section 1 makes docs/*.sql the schema of record. This file is the
-- EXECUTABLE, idempotent record of the applied migration `maps_dc_generation_button`.
-- Replaying it must reproduce the live state, so nothing load-bearing is a comment.
--
-- WHAT THIS IS. The server half of one dashboard button. docs/maps-dc-zip-order.sql
-- gave the founder a way to say WHICH ZIPs, in what order; this gives them a way to say
-- GO. Until it existed, the only way to run the generator was a GitHub Actions dispatch,
-- and the Acquisition Dashboard's ZIP panel said so in its own comment: "the existing
-- generator reads the list on its next run."
--
-- WHAT IT IS NOT. It is not a generator. It contains no eligibility rule, no theme
-- classifier, no selection order and no copy. It dispatches the EXISTING workflow
-- (homesignal-ingest .github/workflows/bluesky-generate-maps.yml), which runs the
-- EXISTING bluesky/generate-maps.mjs. A second implementation of the selection rules is
-- exactly what the cross-repo mandate forbids, so there isn't one.
--
-- ⚖️ AMENDED 2026-09-21 (FOUNDER REQUIREMENT) — THE BUTTON NOW ALSO REFRESHES.
-- "The Data Center Theme dashboard action must support both: creating eligible drafts that
-- do not exist, and refreshing eligible existing unpublished drafts through the current
-- composer and claim-validation rules."
--
-- 🔑 WHAT CHANGED HERE IS ONE DISPATCH INPUT, AND THAT IS THE WHOLE POINT. The refresh is
-- implemented where the composer already lives (homesignal-ingest
-- bluesky/lib/maps-refresh.mjs, shared by the generator AND the standalone
-- recompose-maps-drafts workflow so the two cannot disagree). This file gained
-- `'refresh', 'true'` in the inputs object and NOTHING ELSE — no new table, no new
-- function, no second dispatch, no copy rule. A privileged SQL path is the wrong place to
-- decide what a post says.
--
-- ⚠️ WHY THE INPUT IS SENT EXPLICITLY WHEN THE WORKFLOW ALREADY DEFAULTS IT TO TRUE. A
-- workflow default is editable in the other repo without this file changing, so a silent
-- flip there would silently change what this button does. Sending the value states the
-- intent at the call site, and the workflow's own default then only governs a dispatch
-- that omits it (an API caller, or a human using the Actions tab).
--
-- ⚠️ THE REFRESH'S OWN SAFETY IS THE SCRIPT'S CONTRACT, NOT A PROMISE MADE HERE, and it is
-- narrower than the create path's: `refreshDraft` returns SKIPPED_NON_DRAFT for any row
-- whose status is not `draft`, so an APPROVED, SCHEDULED or PUBLISHED payload is never
-- rewritten — the founder approved specific words and they are not ours to change
-- afterwards. The patch it produces has exactly three keys (post_text, hashtags, and the
-- evidence claim block, merged); it touches no status, no schedule, no screenshot binding.
-- Pinned by homesignal-ingest tests/test_maps_refresh_outcomes.mjs §5/§23 and
-- tests/test_maps_founder_zip_order.mjs §24-26b.
--
-- WHY AN RPC AND NOT AN EDGE FUNCTION. acquisition.html already reaches the server
-- through SECURITY DEFINER RPCs for every privileged action it takes
-- (hs_set_maps_dc_zip_order, hs_approve_social_post, hs_acquisition_dashboard). The page
-- holds the anon key and a founder session and never a service key or a GitHub token.
-- Adding an edge function would be a second privileged path to maintain for one button.
--
-- ⚠️ THE `zips` INPUT IS DISPATCHED BLANK, AND THAT IS LOAD-BEARING.
-- generate-maps.mjs has three modes and only ONE honours the founder's ORDER:
--   --zips <list>  TARGETED  -> ranks nationally via selectCandidates
--   (blank) + list CURATED   -> reads maps_dc_zip_order and walks selectFounderCurated
--   (blank) + no list NATIONAL -> ~233,000 rows, ~24 minutes
-- Passing the list explicitly would LOOK more precise and would silently discard the
-- ordering this whole feature exists to honour.
--
-- 🔒 AND THAT IS WHY AN EMPTY LIST MUST REFUSE RATHER THAN NO-OP. Blank `zips` with no
-- stored list is not "do nothing" -- it is the national scan. A button labelled
-- "generate drafts for these ZIPs" must never be able to start one by accident. Refused
-- in BOTH the RPC and the UI, because a UI-only guard is one refactor away from being
-- the only guard.
--
-- SAFETY IS THE WORKFLOW'S OWN CONTRACT, not a promise made here: generate-maps.mjs
-- writes status='draft' with scheduled_slot NULL, and never approves, schedules or
-- posts. Publication remains bluesky/publish-worker.mjs, which reads status='approved'.
-- ============================================================================

-- ── THE AUDIT LOG ───────────────────────────────────────────────────────────
-- WHY A LOG AND NOT A FIRE-AND-FORGET CALL. pg_net is ASYNCHRONOUS: net.http_post
-- returns a request id immediately and the HTTP status arrives later in
-- net._http_response. A button that reported "sent" the moment the RPC returned would be
-- reporting that we ENQUEUED a request, not that GitHub accepted it -- and a dead
-- credential answers 401 several seconds afterwards, silently. This row is what lets the
-- UI come back and say which of the two actually happened.
create table if not exists public.maps_dc_generation_request (
  id             bigint generated always as identity primary key,
  requested_at   timestamptz not null default now(),
  requested_by   text        not null,
  zip_count      integer     not null,
  run_limit      integer     not null,
  net_request_id bigint
);

-- RLS ON with NO anon/authenticated grant. Reads go through the SECURITY DEFINER status
-- function below, so there is no direct read to enable by accident. Deliberately NOT
-- modelled on public.page_cache, which CLAUDE.md flags as RLS-disabled and anon-writable.
alter table public.maps_dc_generation_request enable row level security;
revoke all on public.maps_dc_generation_request from anon, authenticated;

create index if not exists maps_dc_generation_request_requested_at_idx
  on public.maps_dc_generation_request (requested_at desc);

-- ── THE BUTTON ──────────────────────────────────────────────────────────────
create or replace function public.hs_request_maps_dc_generation()
returns table (net_request_id bigint, zip_count integer, run_limit integer)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp'
as $function$
declare
  _email  text := coalesce((auth.jwt() ->> 'email'), '');
  _zips   integer;
  _limit  integer;
  _pat    text;
  _req    bigint;
  _recent timestamptz;
begin
  -- The SAME gate as hs_set_maps_dc_zip_order, stated the same way rather than a second
  -- notion of "admin" that could drift from it.
  if _email <> 'sdsutca@proton.me' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select count(*) into _zips from public.maps_dc_zip_order;
  if _zips = 0 then
    raise exception 'the ordered ZIP list is empty; upload a CSV before generating'
      using errcode = '22023';
  end if;

  -- DOUBLE-CLICK GUARD. Each dispatch costs a runner and writes drafts, so two clicks a
  -- second apart must not become two runs. 2 minutes is short enough to retry a genuine
  -- failure and long enough that an impatient second click is absorbed.
  select max(requested_at) into _recent from public.maps_dc_generation_request;
  if _recent is not null and _recent > now() - interval '2 minutes' then
    raise exception 'a generation run was requested at %; wait 2 minutes before requesting another',
      to_char(_recent, 'HH24:MI:SS') using errcode = '55006';
  end if;

  -- One draft per ZIP is the curated contract, so the run limit IS the list length.
  -- DERIVED rather than stored, so the two cannot disagree after a CSV upload.
  --
  -- ⚠️ IT BOUNDS CREATES ONLY, AND THAT IS CORRECT RATHER THAN AN OVERSIGHT. `--limit`
  -- caps how many NEW drafts a run inserts; the refresh pass is bounded by a different
  -- thing — the founder's own ZIP list, since it only ever touches existing drafts on
  -- those ZIPs. Applying the create limit to the refresh would leave some of the
  -- founder's ZIPs carrying superseded copy with nothing saying which, which is the
  -- invisible-drift shape this requirement exists to end.
  _limit := _zips;

  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    raise exception 'no GitHub token is stored (vault secret github_actions_pat); the run cannot be dispatched'
      using errcode = '28000';
  end if;

  -- GitHub REQUIRES a User-Agent and rejects the request outright without one.
  select net.http_post(
    url     := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/bluesky-generate-maps.yml/dispatches',
    body    := jsonb_build_object(
                 'ref', 'main',
                 -- ⚖️ 2026-09-21: `refresh` is the founder's create-AND-refresh requirement.
                 -- Sent as the STRING 'true' because workflow_dispatch inputs are strings
                 -- over the API even when the workflow declares them `type: boolean`.
                 'inputs', jsonb_build_object('apply', 'true', 'limit', _limit::text,
                                              'zips', '', 'refresh', 'true')),
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || _pat,
                 'Accept', 'application/vnd.github+json',
                 'X-GitHub-Api-Version', '2022-11-28',
                 'User-Agent', 'homesignal-acquisition-dashboard',
                 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000
  ) into _req;

  insert into public.maps_dc_generation_request (requested_by, zip_count, run_limit, net_request_id)
  values (_email, _zips, _limit, _req);

  return query select _req, _zips, _limit;
end;
$function$;

-- ── DID GITHUB ACTUALLY ACCEPT IT? ──────────────────────────────────────────
-- Read separately because the answer does not exist yet when the button returns.
-- `pending` is a real third state and is reported as one: a response that has not
-- arrived yet and a response that never will look identical otherwise, which is the
-- failure this whole file is shaped by. A successful workflow_dispatch is 204 + EMPTY
-- body, so "no content" is success here and must not be read as an empty answer.
create or replace function public.hs_maps_dc_generation_status()
returns table (requested_at timestamptz, zip_count integer, http_status integer,
               state text, detail text)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp'
as $function$
declare
  _email text := coalesce((auth.jwt() ->> 'email'), '');
begin
  if _email <> 'sdsutca@proton.me' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select r.requested_at,
         r.zip_count,
         resp.status_code,
         case
           when resp.id is null and r.requested_at > now() - interval '2 minutes' then 'pending'
           when resp.id is null then 'no_response'
           when resp.status_code = 204 then 'accepted'
           when resp.status_code = 401 then 'bad_credential'
           else 'rejected'
         end,
         case
           when resp.id is null and r.requested_at > now() - interval '2 minutes'
             then 'waiting for GitHub to answer'
           when resp.id is null
             then 'no response was ever recorded for this request'
           when resp.status_code = 204
             then 'GitHub accepted the run; drafts appear once it finishes'
           when resp.status_code = 401
             then 'GitHub rejected the stored token (vault github_actions_pat) — it needs re-minting'
           else coalesce(left(resp.content, 300), resp.error_msg, 'no detail')
         end
    from public.maps_dc_generation_request r
    left join net._http_response resp on resp.id = r.net_request_id
   order by r.requested_at desc
   limit 1;
end;
$function$;

grant execute on function public.hs_request_maps_dc_generation() to authenticated;
grant execute on function public.hs_maps_dc_generation_status() to authenticated;

-- ── ⚠️ THE 2026-09-21 AMENDMENT IS **NOT APPLIED** ──────────────────────────
-- This file is the DDL of record and it now describes a function body that differs from
-- the live one by one jsonb key. `create or replace function` is idempotent and the whole
-- file is replayable, but NOTHING HERE HAS BEEN RUN: applying a production migration was
-- not authorized for this change, so the live RPC still dispatches without `refresh`.
--
-- WHAT THAT MEANS IN PRACTICE, stated so nobody reads the button as fixed: until this is
-- applied, the dashboard's Generate click dispatches with three inputs, the workflow's own
-- `refresh` default (true) governs, and the refresh therefore ALREADY HAPPENS. The apply
-- is what makes the intent explicit at the call site rather than dependent on a default in
-- another repo — see the note on that at the top. So the order of operations is safe in
-- either sequence, and neither half silently disables the other.
--
-- ⚠️ AND THE BUTTON REMAINS BLOCKED ON SOMETHING ELSE ENTIRELY: the vault secret
-- `github_actions_pat` is DEAD (HTTP 401 since 2026-09-15, per public.pipeline_health_check
-- and homesignal-ingest/CLAUDE.md). No dispatch of any shape succeeds until the founder
-- re-mints it. This amendment does not change that and does not work around it.

-- ── PROVEN AFTER APPLY, not asserted ────────────────────────────────────────
-- A non-admin caller (service role, auth.jwt() null -> email '') is REFUSED:
--   SQLSTATE 42501, 'not authorized'   [measured 2026-09-20]
-- The vault secret `github_actions_pat` EXISTS but is DEAD -- public.pipeline_health_check
-- reads github_credential ok=false, 'HTTP 401 Bad credentials', since 2026-09-15. So this
-- button reports `bad_credential` with that exact wording until the founder re-mints that
-- secret IN PLACE, at which point it starts working with NO code change. The existing
-- pipeline-health-monitor already alarms on that credential, so the button needs no
-- monitoring of its own.
