-- ENGAGE ON BLUESKY (Acquisition Dashboard Tab 17, beside Hot Topics), 2026-10-28.
-- Requires docs/impact-stories.sql and docs/impact-discovery.sql (applied first).
--
-- For each Hot Topic, the discovery scan (homesignal-ingest impact/discovery/scan.py -> impact/engage/run.py) scores the 3-5
-- strongest ORIGINAL Bluesky posts on their own counts (Engagement Opportunity Score, separate from the topic score),
-- recommends REPLY, QUOTE or SKIP, and writes a draft within 300 characters. The founder copies a draft, posts it BY HAND in
-- Bluesky, and marks it posted. The next scan finds the founder's post on the account's own feed and re-reads its likes,
-- replies and reposts; visits are counted from utm_content = the opportunity's key.
--
-- SEPARATE FROM THE IMPACT STORIES VIDEO PIPELINE: these tables reference a discovered topic (impact_discovery_candidates),
-- never a story, a job, a version or an approval, and nothing here calls the story functions. One topic can feed both.
--
-- GUARANTEES (each pinned by test/impact_engagement_pg/):
--   * additive: new tables and functions only; nothing in impact-discovery.sql or impact-stories.sql changes;
--   * every table is RLS-on with no grants; the browser reaches data only through admin-gated SECURITY DEFINER functions;
--     everything the scanner calls is service_role only;
--   * NOTHING PUBLISHES: no function here dispatches a workflow, calls pg_net, or writes to social_posts / video jobs;
--   * one row per Bluesky post (target_uri unique), across every topic: a post is never engaged with twice. A row marked
--     posted, skipped or found already engaged is never reset to "suggested" by a scan, and a second Mark Posted is refused;
--   * a draft is stored only when it is at most 300 characters (code points, never fewer than Bluesky's graphemes);
--   * metrics are observed counts, append-only; a post never re-read shows a dash, never 0.
begin;

create table if not exists public.impact_engagement_opportunities (
  id                  uuid primary key default gen_random_uuid(),
  opp_key             text not null unique check (opp_key ~ '^e-[0-9a-f]{10}$'),   -- also utm_content on the draft's link
  target_uri          text not null unique check (target_uri ~ '^at://'),
  target_url          text not null check (target_url ~ '^https://bsky\.app/profile/[^/]+/post/[A-Za-z0-9]+$'),
  candidate_id        uuid references public.impact_discovery_candidates(id),
  cluster_key         text,
  topic_title         text,
  author              text,
  author_did          text,
  display_name        text,
  post_text           text,
  post_created_at     timestamptz,
  replies             integer not null default 0,
  reposts             integer not null default 0,
  likes               integer not null default 0,
  quotes              integer not null default 0,
  reply_disabled      boolean not null default false,
  embedding_disabled  boolean not null default false,
  link_keys           text[] not null default '{}',
  score               integer not null check (score between 0 and 100),
  score_parts         jsonb not null default '{}'::jsonb,
  action              text not null check (action in ('REPLY', 'QUOTE', 'SKIP')),
  reasons             jsonb not null default '[]'::jsonb,
  draft               jsonb,                       -- {text, graphemes, facts_used[], basis, has_link, has_hashtag}
  status              text not null default 'suggested'
                      check (status in ('suggested', 'posted', 'skipped', 'already_engaged')),
  posted_action       text check (posted_action in ('REPLY', 'QUOTE')),
  posted_uri          text check (posted_uri is null or posted_uri ~ '^at://'),
  posted_url          text check (posted_url is null or posted_url ~ '^https://bsky\.app/profile/[^/]+/post/[A-Za-z0-9]+$'),
  posted_text         text check (posted_text is null or char_length(posted_text) <= 600),
  posted_at           timestamptz,
  decided_by          text,
  decided_at          timestamptz,
  decision_note       text,
  first_scan_id       uuid references public.impact_discovery_scans(id),
  last_scan_id        uuid references public.impact_discovery_scans(id),
  created_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint impact_engagement_draft_fits check (draft is null or char_length(draft->>'text') <= 300)
);
create index if not exists impact_engagement_rank on public.impact_engagement_opportunities (status, score desc);
create index if not exists impact_engagement_cand on public.impact_engagement_opportunities (candidate_id);
create unique index if not exists impact_engagement_posted_uri on public.impact_engagement_opportunities (posted_uri) where posted_uri is not null;
alter table public.impact_engagement_opportunities enable row level security;
revoke all on public.impact_engagement_opportunities from public, anon, authenticated;

-- likes / replies / reposts of the FOUNDER'S post (the reply or quote), observed by each scan; append-only
create table if not exists public.impact_engagement_metrics (
  id              bigserial primary key,
  opportunity_id  uuid not null references public.impact_engagement_opportunities(id),
  scan_id         uuid references public.impact_discovery_scans(id),
  replies         integer not null,
  reposts         integer not null,
  likes           integer not null,
  quotes          integer not null default 0,
  observed_at     timestamptz not null default now()
);
create index if not exists impact_engagement_metrics_o on public.impact_engagement_metrics (opportunity_id, observed_at desc);
alter table public.impact_engagement_metrics enable row level security;
revoke all on public.impact_engagement_metrics from public, anon, authenticated;

create table if not exists public.impact_engagement_runs (
  scan_id       uuid primary key references public.impact_discovery_scans(id),
  status        text not null check (status in ('ok', 'failed')),
  items         integer,
  matched       integer,
  observed      integer,
  error         text,
  at            timestamptz not null default now()
);
alter table public.impact_engagement_runs enable row level security;
revoke all on public.impact_engagement_runs from public, anon, authenticated;

create table if not exists public.impact_engagement_events (
  id              bigserial primary key,
  opportunity_id  uuid references public.impact_engagement_opportunities(id),
  kind            text not null,
  detail          jsonb not null default '{}'::jsonb,
  actor           text not null,
  at              timestamptz not null default now()
);
alter table public.impact_engagement_events enable row level security;
revoke all on public.impact_engagement_events from public, anon, authenticated;
drop trigger if exists impact_engagement_events_append_only on public.impact_engagement_events;
create trigger impact_engagement_events_append_only before update or delete on public.impact_engagement_events
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_engagement_metrics_append_only on public.impact_engagement_metrics;
create trigger impact_engagement_metrics_append_only before update or delete on public.impact_engagement_metrics
  for each row execute function public._hs_is_append_only();

create or replace function public._hs_ie_event(p_opp uuid, p_kind text, p_detail jsonb, p_actor text)
returns void language sql security definer set search_path = public as $$
  insert into public.impact_engagement_events (opportunity_id, kind, detail, actor) values (p_opp, p_kind, coalesce(p_detail, '{}'::jsonb), p_actor)
$$;

-- ── scanner (service_role) ───────────────────────────────────────────────────────────────────────────
-- What the scanner needs before drafting: verified topics (their facts and responsible parties may be stated), and the
-- posted rows whose own post it has not found yet.
create or replace function public.impact_engagement_context()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'verified', coalesce((select jsonb_agg(jsonb_build_object('candidate_id', c.id, 'cluster_key', c.cluster_key, 'post_uris', c.post_uris,
        'link_keys', c.link_keys, 'place', c.place,
        'evidence', jsonb_build_object('facts', coalesce(c.evidence->'facts', '[]'), 'responsible_parties', coalesce(c.evidence->'responsible_parties', '[]'),
                                       'sources', coalesce(c.evidence->'sources', '[]'))))
      from public.impact_discovery_candidates c
     where c.evidence_status = 'verified' and c.last_seen_at > now() - interval '30 days'), '[]'::jsonb),
    'posted', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'target_uri', o.target_uri, 'posted_uri', o.posted_uri, 'action', o.posted_action))
      from public.impact_engagement_opportunities o
     where o.status in ('posted', 'already_engaged') and coalesce(o.posted_at, o.decided_at, o.updated_at) > now() - interval '30 days'), '[]'::jsonb))
$$;

create or replace function public.impact_engagement_record(p_scan uuid, p_items jsonb, p_matches jsonb, p_observations jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; m jsonb; o public.impact_engagement_opportunities%rowtype; cid uuid; d jsonb; mine jsonb;
        ins int := 0; upd int := 0; mat int := 0; obs int := 0;
begin
  if not exists (select 1 from public.impact_discovery_scans where id = p_scan and status = 'running') then
    raise exception 'scan is not running' using errcode = '55000';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if coalesce(x->>'action', '') not in ('REPLY', 'QUOTE', 'SKIP') then raise exception 'bad action' using errcode = '22023'; end if;
    d := case when jsonb_typeof(x->'draft') = 'object' and x->'action' <> '"SKIP"' then x->'draft' end;
    if d is not null and char_length(coalesce(d->>'text', '')) > 300 then
      raise exception 'a draft is over 300 characters (%)', x->>'key' using errcode = '22023';
    end if;
    mine := case when jsonb_typeof(x->'already_engaged') = 'object' and (x->'already_engaged'->>'posted_uri') ~ '^at://'
                   and not exists (select 1 from public.impact_engagement_opportunities z
                                    where z.posted_uri = x->'already_engaged'->>'posted_uri' and z.target_uri <> x->>'target_uri')
                 then x->'already_engaged' end;
    select c.id into cid from public.impact_discovery_candidates c
     where c.cluster_key = x->>'cluster_key' or c.post_uris @> array[x->>'target_uri'] order by (c.cluster_key = x->>'cluster_key') desc limit 1;
    select * into o from public.impact_engagement_opportunities where target_uri = x->>'target_uri' for update;
    if not found then
      insert into public.impact_engagement_opportunities (opp_key, target_uri, target_url, candidate_id, cluster_key, topic_title, author, author_did,
        display_name, post_text, post_created_at, replies, reposts, likes, quotes, reply_disabled, embedding_disabled, link_keys, score,
        score_parts, action, reasons, draft, status, posted_action, posted_uri, posted_url, posted_at, first_scan_id, last_scan_id)
      values (x->>'key', x->>'target_uri', x->>'target_url', cid, x->>'cluster_key', left(x->>'topic_title', 300), x->>'author', x->>'author_did',
        x->>'display_name', left(x->>'text', 1000), (x->>'created_at')::timestamptz, coalesce((x->>'replies')::int, 0), coalesce((x->>'reposts')::int, 0),
        coalesce((x->>'likes')::int, 0), coalesce((x->>'quotes')::int, 0), coalesce((x->>'reply_disabled')::boolean, false),
        coalesce((x->>'embedding_disabled')::boolean, false),
        coalesce((select array_agg(v) from jsonb_array_elements_text(coalesce(x->'link_keys', '[]')) v), '{}'),
        (x->>'score')::int, coalesce(x->'score_parts', '{}'), x->>'action', coalesce(x->'reasons', '[]'), d,
        case when mine is not null then 'already_engaged' else 'suggested' end,
        mine->>'action', mine->>'posted_uri', mine->>'posted_url', (mine->>'posted_at')::timestamptz, p_scan, p_scan)
      returning * into o;
      ins := ins + 1;
    else
      -- counts always refresh; a decided row keeps its decision, its draft and what was posted
      update public.impact_engagement_opportunities set
        replies = coalesce((x->>'replies')::int, replies), reposts = coalesce((x->>'reposts')::int, reposts),
        likes = coalesce((x->>'likes')::int, likes), quotes = coalesce((x->>'quotes')::int, quotes),
        candidate_id = coalesce(candidate_id, cid), last_scan_id = p_scan, last_seen_at = now(), updated_at = now(),
        score = case when status = 'suggested' then (x->>'score')::int else score end,
        score_parts = case when status = 'suggested' then coalesce(x->'score_parts', score_parts) else score_parts end,
        action = case when status = 'suggested' then x->>'action' else action end,
        reasons = case when status = 'suggested' then coalesce(x->'reasons', reasons) else reasons end,
        draft = case when status = 'suggested' then d else draft end,
        reply_disabled = coalesce((x->>'reply_disabled')::boolean, reply_disabled),
        embedding_disabled = coalesce((x->>'embedding_disabled')::boolean, embedding_disabled),
        status = case when status = 'suggested' and mine is not null then 'already_engaged' else status end,
        posted_action = case when posted_uri is null and mine is not null then mine->>'action' else posted_action end,
        posted_url = case when posted_uri is null and mine is not null then coalesce(posted_url, mine->>'posted_url') else posted_url end,
        posted_at = case when posted_uri is null and mine is not null then coalesce(posted_at, (mine->>'posted_at')::timestamptz) else posted_at end,
        posted_uri = case when posted_uri is null and mine is not null then mine->>'posted_uri' else posted_uri end
      where id = o.id returning * into o;
      upd := upd + 1;
    end if;
  end loop;
  -- the founder marked a post without its link: the scanner found it on the account's own feed
  for m in select * from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb)) loop
    update public.impact_engagement_opportunities set posted_uri = m->>'posted_uri', posted_url = coalesce(posted_url, m->>'posted_url'),
           posted_action = coalesce(posted_action, m->>'action'), updated_at = now()
     where id = (m->>'id')::uuid and posted_uri is null and (m->>'posted_uri') ~ '^at://'
       and not exists (select 1 from public.impact_engagement_opportunities z where z.posted_uri = m->>'posted_uri');
    if found then mat := mat + 1; perform public._hs_ie_event((m->>'id')::uuid, 'posted_found', m, 'scanner'); end if;
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_observations, '[]'::jsonb)) loop
    insert into public.impact_engagement_metrics (opportunity_id, scan_id, replies, reposts, likes, quotes)
    select z.id, p_scan, coalesce((m->>'replies')::int, 0), coalesce((m->>'reposts')::int, 0), coalesce((m->>'likes')::int, 0),
           coalesce((m->>'quotes')::int, 0)
      from public.impact_engagement_opportunities z where z.posted_uri = m->>'posted_uri';
    if found then obs := obs + 1; end if;
  end loop;
  insert into public.impact_engagement_runs (scan_id, status, items, matched, observed) values (p_scan, 'ok', ins + upd, mat, obs)
  on conflict (scan_id) do update set status = 'ok', items = excluded.items, matched = excluded.matched, observed = excluded.observed, error = null, at = now();
  return jsonb_build_object('inserted', ins, 'updated', upd, 'matched', mat, 'observed', obs);
end $$;

create or replace function public.impact_engagement_run_failed(p_scan uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  insert into public.impact_engagement_runs (scan_id, status, error) values (p_scan, 'failed', left(coalesce(p_error, 'unknown'), 500))
  on conflict (scan_id) do update set status = 'failed', error = excluded.error, at = now()
$$;

-- ── founder (authenticated; every function checks the dashboard allowlist) ───────────────────────────
-- Visits and registrations from a posted draft's link: utm_campaign = 'engage', utm_content = the opportunity key.
create or replace function public._hs_ie_attribution()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select coalesce(jsonb_object_agg(k, jsonb_build_object('visits', v, 'registrations', a)), '{}'::jsonb) into r from (
    select t.utm_content k,
           count(distinct t.visitor_id) filter (where t.subject_type = 'visitor') v,
           count(distinct t.user_id) filter (where t.subject_type = 'account' and t.user_id is not null) a
      from public.acquisition_touch t
     where t.utm_campaign = 'engage' and not coalesce(t.is_internal, false) and t.utm_content ~ '^e-[0-9a-f]{10}$'
     group by 1) x;
  return r;
exception when undefined_table or undefined_column then
  return jsonb_build_object('_error', 'Attribution tables are not available, so visits are not measured.');
end $$;

create or replace function public.hs_impact_engagement_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare att jsonb;
begin
  perform public._hs_is_admin();
  att := public._hs_ie_attribution();
  return jsonb_build_object(
    'last_run', (select to_jsonb(r) from public.impact_engagement_runs r order by at desc limit 1),
    'attribution_error', att->>'_error',
    -- every suggestion still worth acting on, strongest first; the page shows the first five
    'suggested', coalesce((select jsonb_agg(public._hs_ie_row(o, att) order by (o.action <> 'SKIP') desc, o.score desc, o.last_seen_at desc)
       from (select * from public.impact_engagement_opportunities o
              where o.status = 'suggested' and o.last_seen_at > now() - interval '3 days'
                and (o.candidate_id is null or not exists (select 1 from public.impact_discovery_candidates c
                     where c.id = o.candidate_id and c.status in ('rejected', 'dismissed', 'excluded')))
              order by (o.action <> 'SKIP') desc, o.score desc, o.last_seen_at desc limit 60) o), '[]'::jsonb),
    'posted', coalesce((select jsonb_agg(public._hs_ie_row(o, att) order by coalesce(o.posted_at, o.decided_at) desc)
       from (select * from public.impact_engagement_opportunities o where o.status in ('posted', 'already_engaged')
              order by coalesce(o.posted_at, o.decided_at) desc limit 40) o), '[]'::jsonb),
    'skipped', coalesce((select jsonb_agg(public._hs_ie_row(o, att) order by o.decided_at desc)
       from (select * from public.impact_engagement_opportunities o where o.status = 'skipped' order by o.decided_at desc limit 20) o), '[]'::jsonb),
    'totals', (select jsonb_build_object('posted', count(*) filter (where status in ('posted', 'already_engaged')),
                 'skipped', count(*) filter (where status = 'skipped'), 'suggested', count(*) filter (where status = 'suggested'))
                 from public.impact_engagement_opportunities));
end $$;

create or replace function public._hs_ie_row(o public.impact_engagement_opportunities, att jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'key', o.opp_key, 'target_url', o.target_url, 'candidate_id', o.candidate_id,
    'topic_title', coalesce((select c.title from public.impact_discovery_candidates c where c.id = o.candidate_id), o.topic_title),
    'topic_place', (select c.place from public.impact_discovery_candidates c where c.id = o.candidate_id),
    'topic_evidence_status', (select c.evidence_status from public.impact_discovery_candidates c where c.id = o.candidate_id),
    'author', o.author, 'display_name', o.display_name, 'post_text', o.post_text, 'post_created_at', o.post_created_at,
    'replies', o.replies, 'reposts', o.reposts, 'likes', o.likes, 'quotes', o.quotes,
    'reply_disabled', o.reply_disabled, 'embedding_disabled', o.embedding_disabled,
    'score', o.score, 'score_parts', o.score_parts, 'action', o.action, 'reasons', o.reasons, 'draft', o.draft, 'status', o.status,
    'posted_action', o.posted_action, 'posted_url', o.posted_url, 'posted_text', o.posted_text, 'posted_at', o.posted_at,
    'tracked', o.posted_uri is not null, 'decided_at', o.decided_at, 'decision_note', o.decision_note, 'last_seen_at', o.last_seen_at,
    'result', (select jsonb_build_object('replies', m.replies, 'reposts', m.reposts, 'likes', m.likes, 'quotes', m.quotes, 'observed_at', m.observed_at)
                 from public.impact_engagement_metrics m where m.opportunity_id = o.id order by m.observed_at desc limit 1),
    'visits', case when att ? '_error' then null else coalesce((att->o.opp_key->>'visits')::int, 0) end,
    'registrations', case when att ? '_error' then null else coalesce((att->o.opp_key->>'registrations')::int, 0) end)
$$;

-- mark_posted (the founder posted it by hand; optional link to the post and the text as posted), skip, restore,
-- copied / opened / previewed (recorded only). Nothing here posts anything.
create or replace function public.hs_impact_engagement_decide(p_id uuid, p_action text, p_posted_url text default null,
                                                              p_text text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); o public.impact_engagement_opportunities%rowtype; u text := nullif(btrim(p_posted_url), '');
begin
  if p_action not in ('mark_posted', 'skip', 'restore', 'copied', 'opened', 'previewed') then raise exception 'bad action' using errcode = '22023'; end if;
  select * into o from public.impact_engagement_opportunities where id = p_id for update;
  if not found then raise exception 'no such post' using errcode = 'P0002'; end if;
  if p_action in ('copied', 'opened', 'previewed') then
    perform public._hs_ie_event(o.id, p_action, '{}'::jsonb, e);
    return jsonb_build_object('ok', true, 'status', o.status);
  end if;
  if p_action = 'mark_posted' then
    if o.status = 'posted' then
      raise exception 'Already marked posted on %. JODY does not engage with the same post twice.', to_char(o.posted_at at time zone 'America/Los_Angeles', 'Mon DD')
        using errcode = '55000';
    end if;
    if o.action = 'SKIP' and o.draft is null and p_text is null then
      raise exception 'This post was recommended SKIP and has no draft. Paste what you posted to mark it.' using errcode = '22023';
    end if;
    if u is not null and u !~ '^https://bsky\.app/profile/[^/]+/post/[A-Za-z0-9]+$' then
      raise exception 'That is not a Bluesky post link (https://bsky.app/profile/<handle>/post/<id>).' using errcode = '22023';
    end if;
    if p_text is not null and char_length(p_text) > 600 then raise exception 'text too long' using errcode = '22023'; end if;
    update public.impact_engagement_opportunities set status = 'posted',
           posted_action = coalesce(o.posted_action, case when o.action = 'SKIP' then 'REPLY' else o.action end),
           posted_url = coalesce(u, o.posted_url), posted_text = coalesce(nullif(p_text, ''), o.draft->>'text'),
           posted_at = coalesce(o.posted_at, now()), decided_by = e, decided_at = now(), decision_note = nullif(btrim(p_note), ''), updated_at = now()
     where id = o.id;
  elsif p_action = 'skip' then
    if o.status in ('posted', 'already_engaged') then raise exception 'This post was already answered.' using errcode = '55000'; end if;
    update public.impact_engagement_opportunities set status = 'skipped', decided_by = e, decided_at = now(),
           decision_note = nullif(btrim(p_note), ''), updated_at = now() where id = o.id;
  else
    if o.status <> 'skipped' then raise exception 'Only a skipped post can be restored.' using errcode = '55000'; end if;
    update public.impact_engagement_opportunities set status = 'suggested', decided_by = e, decided_at = now(), decision_note = null,
           updated_at = now() where id = o.id;
  end if;
  perform public._hs_ie_event(o.id, p_action, jsonb_build_object('posted_url', u, 'note', p_note, 'edited', p_text is not null and p_text is distinct from o.draft->>'text'), e);
  return jsonb_build_object('ok', true, 'status', (select status from public.impact_engagement_opportunities where id = o.id));
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public._hs_ie_event(uuid, text, jsonb, text)', 'public._hs_ie_attribution()',
    'public._hs_ie_row(public.impact_engagement_opportunities, jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array['public.hs_impact_engagement_overview()', 'public.hs_impact_engagement_decide(uuid, text, text, text, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  foreach f in array array['public.impact_engagement_context()', 'public.impact_engagement_record(uuid, jsonb, jsonb, jsonb)',
    'public.impact_engagement_run_failed(uuid, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

commit;
