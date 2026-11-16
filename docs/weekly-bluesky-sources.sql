-- Tab 20 · Weekly Report: BLUESKY SOURCES. DDL of record. PREPARED, NOT APPLIED TO PRODUCTION.
-- Needs the queue-only release (docs/weekly-1-base.sql, weekly-2-topic-queue.sql, weekly-2a-publication-lock.sql) and
-- public._hs_is_admin. Replaces NO function of files 1-7 (the publication lock is untouched). One transaction, idempotent.
--
-- What it does: the founder's own Bluesky posts that START WITH "QUALITY-of-LIFE WEEKLY REPORT:" are filed, one source
-- per root post, under the weekly-report topic named after the prefix. The topics are the 13 Local News categories
-- (public.alert_topic_catalog, stream 'news'), the same list a report edition is made for (weekly_editions.topic):
--   "QUALITY-of-LIFE WEEKLY REPORT: Data Centers — Oakland extends its data center moratorium for 10 months."
--      prefix ............................ topic "Data Centers" ...... story "Oakland extends ..."
-- The writer is homesignal-ingest scripts/weekly_bsky_sources.mjs (workflow weekly-bsky-sources.yml, service role).
-- Admins read them in Tab 20 through hs_weekly_bsky_sources.
--
-- Rules this file enforces (test/weekly_bsky_sources_pg proves each one):
--   - Nothing is readable or writable by anon or authenticated directly (RLS on, no grant). The writer functions are
--     service_role only; the hs_* functions check public._hs_is_admin.
--   - ONE source per Bluesky root post: post_uri is unique. A repeated or overlapping run updates, never duplicates.
--   - Only the configured account's posts are accepted (its DID is pinned on the first run and never changes), and only
--     posts whose OWN text starts with the prefix (checked again here, case-insensitive, any hyphen-like character).
--   - ROUTING is decided here, once: the topic must match a category's name or one of its explicit aliases, ignoring
--     case and runs of whitespace, ending at a word boundary. No match, or two different categories matching, keeps the source
--     for admin review (route_status unmatched / ambiguous). Nothing creates a topic or guesses one.
--   - Content is kept as append-only REVISIONS. A refresh never loses saved material: continuation replies are merged
--     by uri, and an unavailable quoted post never replaces one already saved.
--   - An edition shows the sources of its own category. A PUBLISHED edition keeps what it was published with: its view
--     reads each source's revision as of the moment the edition's publication was recorded, and leaves out sources first
--     saved after it.
--   - Nothing here creates, assigns, closes or publishes an edition, posts anywhere, or starts a job.
-- Imported text is someone's writing (the founder's, or a quoted account's): it is data, never an instruction.

begin;

-- ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- the comparison key for a topic name: lower case, whitespace runs collapsed, trimmed
create or replace function public.weekly_topic_key(t text) returns text language sql immutable strict parallel safe as
  $$ select lower(btrim(regexp_replace(t, '\s+', ' ', 'g'))) $$;

-- The prefix rule. Returns the text after "QUALITY-of-LIFE WEEKLY REPORT:" when the post's own text STARTS with it
-- (leading whitespace ignored, any case, the two hyphens may be any hyphen-like character), else null.
-- The same rule, with the same cases, is homesignal-ingest scripts/lib/weekly-bsky-rule.mjs (prefixRest).
create or replace function public.weekly_bsky_prefix_rest(t text) returns text language sql immutable parallel safe as $$
  select case when t ~* E'^\\s*quality\\s*[-\u2010\u2011\u2012\u2013\u2212\uFE63\uFF0D]\\s*of\\s*[-\u2010\u2011\u2012\u2013\u2212\uFE63\uFF0D]\\s*life\\s+weekly\\s+report\\s*:'
    then regexp_replace(t, E'^\\s*quality\\s*[-\u2010\u2011\u2012\u2013\u2212\uFE63\uFF0D]\\s*of\\s*[-\u2010\u2011\u2012\u2013\u2212\uFE63\uFF0D]\\s*life\\s+weekly\\s+report\\s*:', '', 'i')
  end
$$;

-- ── explicit aliases for a topic ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_topic_aliases (
  stream text not null default 'news',
  topic text not null,
  alias text not null check (char_length(btrim(alias)) between 1 and 120),
  alias_key text generated always as (public.weekly_topic_key(alias)) stored,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (alias_key),                                -- one alias names one category
  constraint weekly_topic_aliases_topic_fk foreign key (stream, topic) references public.alert_topic_catalog (stream, topic)
);

-- ── sources ──────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_bsky_sources (
  id uuid primary key default gen_random_uuid(),
  post_uri text not null unique check (post_uri ~ '^at://did:[a-z0-9]+:[A-Za-z0-9._:%-]+/app\.bsky\.feed\.post/[A-Za-z0-9]+$'),
  post_url text not null check (post_url ~ '^https://bsky\.app/profile/[^\s/]+/post/[A-Za-z0-9]+$'),
  author_did text not null,
  author_handle text,
  posted_at timestamptz not null,
  topic_text text check (char_length(topic_text) <= 300),
  story_text text check (char_length(story_text) <= 3000),
  stream text not null default 'news',
  topic text,                                             -- the category; null while it needs review
  route_status text not null check (route_status in ('matched', 'unmatched', 'ambiguous')),
  routed_by text not null default 'automatic',
  routed_at timestamptz not null default now(),
  current_revision integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_fetched_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  last_fetch_error text check (char_length(last_fetch_error) <= 1000),
  constraint weekly_bsky_sources_route_ck check ((route_status = 'matched') = (topic is not null)),
  constraint weekly_bsky_sources_topic_fk foreign key (stream, topic) references public.alert_topic_catalog (stream, topic)
);
create index if not exists weekly_bsky_sources_topic_ix on public.weekly_bsky_sources (stream, topic, posted_at);

create table if not exists public.weekly_bsky_source_revisions (
  source_id uuid not null references public.weekly_bsky_sources (id),
  revision integer not null check (revision >= 1),
  content jsonb not null check (jsonb_typeof(content) = 'object' and jsonb_typeof(content -> 'text') = 'string'
                                and pg_column_size(content) <= 400000),
  content_sha text not null,
  created_at timestamptz not null default now(),
  primary key (source_id, revision)
);

-- ── sync state: one row ──────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_bsky_sync (
  id integer primary key default 1 check (id = 1),
  account_did text,
  account_handle text,
  high_water_at timestamptz,
  backfill_done_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  last_run_started_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text check (char_length(last_error) <= 2000),
  last_stats jsonb
);
insert into public.weekly_bsky_sync (id) values (1) on conflict (id) do nothing;

-- the founder's ruling: "Data Centers" also answers to "Data Center". Added only when that category exists.
insert into public.weekly_topic_aliases (stream, topic, alias, created_by)
select c.stream, c.topic, 'Data Center', 'system:weekly-bluesky-sources'
from public.alert_topic_catalog c where c.stream = 'news' and c.topic = 'Data Centers'
on conflict do nothing;

-- ── guards ───────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.weekly_bsky_sources_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'weekly_bsky_sources is never deleted from' using errcode = '55000'; end if;
  if new.id <> old.id or new.post_uri <> old.post_uri or new.author_did <> old.author_did or new.posted_at <> old.posted_at
     or new.first_seen_at <> old.first_seen_at then
    raise exception 'a Bluesky source''s identity never changes' using errcode = '55000';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  drop trigger if exists weekly_bsky_sources_guard on public.weekly_bsky_sources;
  create trigger weekly_bsky_sources_guard before update or delete on public.weekly_bsky_sources
    for each row execute function public.weekly_bsky_sources_guard();
  drop trigger if exists weekly_bsky_source_revisions_append_only on public.weekly_bsky_source_revisions;
  create trigger weekly_bsky_source_revisions_append_only before update or delete on public.weekly_bsky_source_revisions
    for each row execute function public.weekly_append_only();
  drop trigger if exists weekly_topic_aliases_append_only on public.weekly_topic_aliases;
  create trigger weekly_topic_aliases_append_only before update or delete on public.weekly_topic_aliases
    for each row execute function public.weekly_append_only();
  foreach t in array array['weekly_topic_aliases', 'weekly_bsky_sources', 'weekly_bsky_source_revisions', 'weekly_bsky_sync'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ── routing: the one decision ────────────────────────────────────────────────────────────────────────────────────
-- p_rest is the text after the prefix. The longest category name or alias (stream 'news') that the text starts with,
-- ending at a word boundary, wins; two different categories at that length is ambiguous; none is unmatched.
create or replace function public.weekly_bsky_route(p_rest text)
returns table (topic text, route_status text, topic_text text, story_text text)
language plpgsql stable security definer set search_path = public as $$
declare s text := btrim(regexp_replace(coalesce(p_rest, ''), '\s+', ' ', 'g'));
        k text := lower(s); best int; n int; hit text;
begin
  with names as (
    select c.topic as id, public.weekly_topic_key(c.topic) as key from public.alert_topic_catalog c where c.stream = 'news'
    union select a.topic, a.alias_key from public.weekly_topic_aliases a where a.stream = 'news'
  ), hits as (
    select distinct id, char_length(key) as len from names
    where key <> '' and left(k, char_length(key)) = key
      and (char_length(k) = char_length(key) or substr(k, char_length(key) + 1, 1) !~ '[[:alnum:]]')
  )
  select max(len) into best from hits;
  if best is null then
    topic := null; route_status := 'unmatched';
    -- for the review list: what follows the prefix up to the first spaced separator (at most 80 characters)
    topic_text := left(btrim(regexp_replace(split_part(btrim(coalesce(p_rest, ''), E' \t\r\n'), E'\n', 1),
                  E'(\\s(—|–|-|\\|)|:)(\\s.*)?$', '')), 80);
    story_text := left(nullif(btrim(case when left(s, char_length(topic_text)) = topic_text
                    then substr(s, char_length(topic_text) + 1) else s end, E' \u2014\u2013-:|'), ''), 3000);
    return next; return;
  end if;
  with names as (
    select c.topic as id, public.weekly_topic_key(c.topic) as key from public.alert_topic_catalog c where c.stream = 'news'
    union select a.topic, a.alias_key from public.weekly_topic_aliases a where a.stream = 'news'
  )
  select count(distinct id), min(id) into n, hit from names
  where char_length(key) = best and left(k, best) = key;
  topic_text := left(s, best);
  story_text := left(nullif(btrim(substr(s, best + 1), E' \u2014\u2013-:|'), ''), 3000);
  if n = 1 then topic := hit; route_status := 'matched'; else topic := null; route_status := 'ambiguous'; end if;
  return next;
end $$;

-- ── merge: a refresh never loses saved material ──────────────────────────────────────────────────────────────────
create or replace function public.weekly_bsky_merge(p_old jsonb, p_new jsonb) returns jsonb
language sql immutable parallel safe as $$
  select case when p_old is null then p_new else
    p_new
    || jsonb_build_object('thread', (
         select coalesce(jsonb_agg(r order by r ->> 'posted_at', r ->> 'uri'), '[]'::jsonb) from (
           select distinct on (x ->> 'uri') x as r
           from (select x, 0 as pri from jsonb_array_elements(coalesce(p_new -> 'thread', '[]'::jsonb)) x
                 union all select x, 1 from jsonb_array_elements(coalesce(p_old -> 'thread', '[]'::jsonb)) x) u
           order by x ->> 'uri', pri) d))
    || jsonb_build_object('quoted', case
         when coalesce(p_new -> 'quoted' ->> 'status', 'none') = 'available' then p_new -> 'quoted'
         when coalesce(p_old -> 'quoted' ->> 'status', 'none') = 'available' then p_old -> 'quoted'
         else coalesce(p_new -> 'quoted', p_old -> 'quoted') end)
    || jsonb_build_object('links', (
         select coalesce(jsonb_agg(v order by o), '[]'::jsonb) from (
           select v, min(o) as o from (
             select v, o from jsonb_array_elements_text(coalesce(p_new -> 'links', '[]'::jsonb)) with ordinality t (v, o)
             union all select v, o + 100000 from jsonb_array_elements_text(coalesce(p_old -> 'links', '[]'::jsonb)) with ordinality t (v, o)) a
           group by v) b))
    || jsonb_build_object('media', (
         select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
           select distinct on (coalesce(m ->> 'url', m ->> 'ref', m::text)) m, o from (
             select m, o from jsonb_array_elements(coalesce(p_new -> 'media', '[]'::jsonb)) with ordinality t (m, o)
             union all select m, o + 100000 from jsonb_array_elements(coalesce(p_old -> 'media', '[]'::jsonb)) with ordinality t (m, o)) a
           order by coalesce(m ->> 'url', m ->> 'ref', m::text), o) b))
  end
$$;

-- ── the writer (service_role, homesignal-ingest) ─────────────────────────────────────────────────────────────────
-- Claim the one-run lease. A second run while the lease is held is told so and writes nothing.
create or replace function public.weekly_bsky_sync_claim(p_owner text, p_account_did text, p_account_handle text,
  p_ttl_seconds integer default 900, p_revisit_days integer default 14, p_revisit_max integer default 40) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.weekly_bsky_sync;
begin
  if coalesce(p_owner, '') = '' or p_account_did !~ '^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$' then
    raise exception 'owner and account DID are required' using errcode = '22023';
  end if;
  select * into s from public.weekly_bsky_sync where id = 1 for update;
  if s.account_did is not null and s.account_did <> p_account_did then
    raise exception 'this sync reads account %, not %', s.account_did, p_account_did using errcode = '22023';
  end if;
  if s.lease_owner is not null and s.lease_owner <> p_owner and s.lease_until > now() then
    return jsonb_build_object('ok', false, 'held_by', s.lease_owner, 'lease_until', s.lease_until);
  end if;
  update public.weekly_bsky_sync set account_did = p_account_did, account_handle = coalesce(p_account_handle, account_handle),
    lease_owner = p_owner, lease_until = now() + make_interval(secs => greatest(60, least(p_ttl_seconds, 3600))),
    last_run_started_at = now() where id = 1;
  return jsonb_build_object('ok', true, 'high_water_at', s.high_water_at, 'backfill_done', s.backfill_done_at is not null,
    'revisit', (select coalesce(jsonb_agg(x.post_uri order by x.posted_at desc), '[]'::jsonb) from (
        select post_uri, posted_at from public.weekly_bsky_sources
        where posted_at > now() - make_interval(days => greatest(1, least(p_revisit_days, 90)))
        order by posted_at desc limit greatest(0, least(p_revisit_max, 200))) x));
end $$;

create or replace function public._wk_bsky_lease(p_owner text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.weekly_bsky_sync where id = 1 and lease_owner = p_owner and lease_until > now()) then
    raise exception 'run % does not hold the sync lease', p_owner using errcode = '55000';
  end if;
end $$;

-- Save one root post. p_post: {uri, url, author_did, author_handle, posted_at, content:{text, thread[], quoted{}, links[], media[]}}
create or replace function public.weekly_bsky_source_upsert(p_owner text, p_post jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare acct text; uri text := p_post ->> 'uri'; src public.weekly_bsky_sources; rest text; r record;
        prev jsonb; merged jsonb; sha text; rev int; created boolean := false; changed boolean := false;
begin
  perform public._wk_bsky_lease(p_owner);
  select account_did into acct from public.weekly_bsky_sync where id = 1;
  if p_post ->> 'author_did' is distinct from acct or uri not like 'at://' || acct || '/app.bsky.feed.post/%' then
    raise exception 'only the configured account''s own posts are accepted' using errcode = '22023';
  end if;
  rest := public.weekly_bsky_prefix_rest(p_post -> 'content' ->> 'text');
  if rest is null then
    raise exception 'the post does not start with the weekly report prefix' using errcode = '22023';
  end if;
  select * into src from public.weekly_bsky_sources where post_uri = uri for update;
  if not found then
    select * into r from public.weekly_bsky_route(rest);
    insert into public.weekly_bsky_sources (post_uri, post_url, author_did, author_handle, posted_at, topic_text, story_text,
      topic, route_status)
    values (uri, p_post ->> 'url', acct, p_post ->> 'author_handle', (p_post ->> 'posted_at')::timestamptz, r.topic_text,
      r.story_text, r.topic, r.route_status)
    returning * into src;
    merged := p_post -> 'content'; rev := 1; created := true;
  else
    -- an automatic route is retried while it has no category (e.g. an alias was added later);
    -- a matched source, or one an admin filed, keeps its topic
    if src.route_status <> 'matched' and src.routed_by = 'automatic' then
      select * into r from public.weekly_bsky_route(rest);
      if r.route_status = 'matched' then
        update public.weekly_bsky_sources set topic = r.topic, route_status = 'matched', topic_text = r.topic_text,
          story_text = r.story_text, routed_at = now() where id = src.id;
      end if;
    end if;
    select content into prev from public.weekly_bsky_source_revisions where source_id = src.id and revision = src.current_revision;
    merged := public.weekly_bsky_merge(prev, p_post -> 'content');
    rev := src.current_revision + 1;
  end if;
  sha := public.weekly_sha256(merged::text);
  if created or sha is distinct from (select content_sha from public.weekly_bsky_source_revisions
                                      where source_id = src.id and revision = src.current_revision) then
    insert into public.weekly_bsky_source_revisions (source_id, revision, content, content_sha) values (src.id, rev, merged, sha);
    update public.weekly_bsky_sources set current_revision = rev, last_changed_at = now() where id = src.id;
    changed := not created;
  end if;
  update public.weekly_bsky_sources set last_fetched_at = now(), last_fetch_error = null,
    author_handle = coalesce(p_post ->> 'author_handle', author_handle) where id = src.id;
  return jsonb_build_object('id', src.id, 'created', created, 'changed', changed,
    'route_status', (select route_status from public.weekly_bsky_sources where id = src.id));
end $$;

-- A refresh of a saved source failed: note it, change nothing else.
create or replace function public.weekly_bsky_source_fetch_failed(p_owner text, p_post_uri text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._wk_bsky_lease(p_owner);
  update public.weekly_bsky_sources set last_fetch_error = left(coalesce(p_error, 'unknown error'), 1000) where post_uri = p_post_uri;
end $$;

-- End the run. The checkpoint only moves forward, and only on a run that says it processed everything up to it.
create or replace function public.weekly_bsky_sync_finish(p_owner text, p_ok boolean, p_high_water timestamptz,
  p_backfill_done boolean, p_error text, p_stats jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._wk_bsky_lease(p_owner);
  update public.weekly_bsky_sync set
    high_water_at = case when p_high_water is null then high_water_at else greatest(coalesce(high_water_at, p_high_water), p_high_water) end,
    backfill_done_at = case when p_ok and p_backfill_done and backfill_done_at is null then now() else backfill_done_at end,
    last_success_at = case when p_ok then now() else last_success_at end,
    last_failure_at = case when p_ok then last_failure_at else now() end,
    last_error = case when p_ok then last_error else left(coalesce(p_error, 'unknown error'), 2000) end,
    last_stats = p_stats, lease_owner = null, lease_until = null
  where id = 1;
end $$;

-- ── reading (admins, Tab 20) ─────────────────────────────────────────────────────────────────────────────────────
-- One source as JSON, at its newest revision, or at the newest revision saved at or before p_as_of.
create or replace function public.weekly_bsky_source_json(p_source uuid, p_as_of timestamptz default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'post_uri', s.post_uri, 'post_url', s.post_url, 'author_handle', s.author_handle,
    'author_did', s.author_did, 'posted_at', s.posted_at, 'topic_text', s.topic_text, 'story_text', s.story_text,
    'stream', s.stream, 'topic', s.topic, 'route_status', s.route_status, 'routed_by', s.routed_by, 'first_seen_at', s.first_seen_at,
    'last_fetched_at', s.last_fetched_at, 'last_fetch_error', s.last_fetch_error,
    'revision', r.revision, 'revisions', s.current_revision, 'revision_saved_at', r.created_at, 'content', r.content)
  from public.weekly_bsky_sources s
  join lateral (select * from public.weekly_bsky_source_revisions x where x.source_id = s.id
                and (p_as_of is null or x.created_at <= p_as_of) order by x.revision desc limit 1) r on true
  where s.id = p_source
$$;

-- p_edition null: every source by category (all 13 listed, with or without posts), the review list and the sync status.
-- p_edition set: also the sources of that edition's category. A published edition shows each source as it was when its
-- publication was recorded, and nothing first saved after that.
create or replace function public.hs_weekly_bsky_sources(p_edition uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin(); ed public.weekly_editions; as_of timestamptz; ed_part jsonb;
begin
  if p_edition is not null then
    select * into ed from public.weekly_editions where id = p_edition;
    if not found then raise exception 'no such edition' using errcode = '22023'; end if;
    as_of := ed.publication_recorded_at;
    select coalesce(jsonb_agg(public.weekly_bsky_source_json(s.id, as_of) order by s.posted_at, s.id), '[]'::jsonb) into ed_part
    from public.weekly_bsky_sources s
    where s.stream = ed.stream and s.topic = ed.topic
      and (as_of is null or exists (select 1 from public.weekly_bsky_source_revisions x where x.source_id = s.id and x.created_at <= as_of));
  end if;
  return jsonb_build_object(
    'note', 'Imported from the account''s own Bluesky posts that start with "QUALITY-of-LIFE WEEKLY REPORT:". A post is a lead, not evidence. Quoted posts are other people''s writing.',
    'sync', (select jsonb_build_object('account_handle', account_handle, 'account_did', account_did, 'high_water_at', high_water_at,
             'backfill_done_at', backfill_done_at, 'last_run_started_at', last_run_started_at, 'last_success_at', last_success_at,
             'last_failure_at', last_failure_at, 'last_error', last_error, 'last_stats', last_stats,
             'running', lease_until is not null and lease_until > now()) from public.weekly_bsky_sync where id = 1),
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('topic', c.topic,
          'aliases', (select coalesce(jsonb_agg(a.alias order by a.alias), '[]'::jsonb) from public.weekly_topic_aliases a
                      where a.stream = c.stream and a.topic = c.topic),
          'sources', (select coalesce(jsonb_agg(public.weekly_bsky_source_json(s.id) order by s.posted_at desc, s.id), '[]'::jsonb)
                      from public.weekly_bsky_sources s where s.stream = c.stream and s.topic = c.topic))
        order by c.topic), '[]'::jsonb) from public.alert_topic_catalog c where c.stream = 'news'),
    'review', (select coalesce(jsonb_agg(public.weekly_bsky_source_json(s.id) order by s.posted_at desc, s.id), '[]'::jsonb)
               from public.weekly_bsky_sources s where s.topic is null),
    'edition', case when p_edition is null then null else jsonb_build_object('id', p_edition, 'topic', ed.topic, 'published', as_of is not null,
                 'as_of', as_of, 'sources', ed_part) end);
end $$;

-- File a source under a category by hand (an unmatched or ambiguous one, or a correction). Changes no edition.
create or replace function public.hs_weekly_bsky_source_file(p_source uuid, p_topic text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  if not exists (select 1 from public.alert_topic_catalog where stream = 'news' and topic = p_topic) then
    raise exception 'no such topic: %', p_topic using errcode = '22023';
  end if;
  update public.weekly_bsky_sources set stream = 'news', topic = p_topic, route_status = 'matched', routed_by = e, routed_at = now() where id = p_source;
  if not found then raise exception 'no such source' using errcode = '22023'; end if;
  return public.weekly_bsky_source_json(p_source);
end $$;

-- Another name a category answers to after the prefix ("Data Center" for "Data Centers"). One alias names one category.
create or replace function public.hs_weekly_topic_alias_add(p_topic text, p_alias text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); k text := public.weekly_topic_key(coalesce(p_alias, ''));
begin
  if not exists (select 1 from public.alert_topic_catalog where stream = 'news' and topic = p_topic) then
    raise exception 'no such topic: %', p_topic using errcode = '22023';
  end if;
  if k = '' then raise exception 'an alias is required' using errcode = '22023'; end if;
  if exists (select 1 from public.weekly_topic_aliases where alias_key = k and topic <> p_topic)
     or exists (select 1 from public.alert_topic_catalog where stream = 'news' and public.weekly_topic_key(topic) = k and topic <> p_topic) then
    raise exception 'that name already belongs to another topic' using errcode = '23505';
  end if;
  insert into public.weekly_topic_aliases (stream, topic, alias, created_by) values ('news', p_topic, btrim(p_alias), e) on conflict do nothing;
  return jsonb_build_object('topic', p_topic, 'alias', btrim(p_alias));
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['weekly_topic_key(text)', 'weekly_bsky_prefix_rest(text)', 'weekly_bsky_sources_guard()',
    'weekly_bsky_route(text)', 'weekly_bsky_merge(jsonb,jsonb)', 'weekly_bsky_sync_claim(text,text,text,integer,integer,integer)',
    '_wk_bsky_lease(text)', 'weekly_bsky_source_upsert(text,jsonb)', 'weekly_bsky_source_fetch_failed(text,text,text)',
    'weekly_bsky_sync_finish(text,boolean,timestamptz,boolean,text,jsonb)', 'weekly_bsky_source_json(uuid,timestamptz)',
    'hs_weekly_bsky_sources(uuid)', 'hs_weekly_bsky_source_file(uuid,text)', 'hs_weekly_topic_alias_add(text,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['weekly_bsky_sync_claim(text,text,text,integer,integer,integer)', 'weekly_bsky_source_upsert(text,jsonb)',
    'weekly_bsky_source_fetch_failed(text,text,text)', 'weekly_bsky_sync_finish(text,boolean,timestamptz,boolean,text,jsonb)'] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['hs_weekly_bsky_sources(uuid)', 'hs_weekly_bsky_source_file(uuid,text)', 'hs_weekly_topic_alias_add(text,text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
