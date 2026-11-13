-- docs/weekly-bluesky-sources.sql against a DISPOSABLE Postgres (run.sh). Prints one "Bnn|true" line per check.
-- Every value below is test data. Post texts follow the founder's real posts (2026-11-11/12) in shape only.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set test.jwt = '{"email":"founder@test.invalid"}';

create or replace function pg_temp.raises(q text, st text default null) returns boolean language plpgsql as $$
begin
  execute q; return false;
exception when others then return st is null or sqlstate = st;
end $$;
create or replace function pg_temp.post(rkey text, txt text, extra jsonb default '{}'::jsonb,
  did text default 'did:plc:wn7c3svjrzpspuzmlecuqqeo', at text default '2026-11-12T21:18:17Z') returns jsonb language sql as $$
  select jsonb_build_object('uri', 'at://' || did || '/app.bsky.feed.post/' || rkey, 'url', 'https://bsky.app/profile/jodytracks.com/post/' || rkey,
    'author_did', did, 'author_handle', 'jodytracks.com', 'posted_at', at,
    'content', jsonb_build_object('text', txt, 'thread', '[]'::jsonb, 'quoted', jsonb_build_object('status', 'none'),
      'links', '[]'::jsonb, 'media', '[]'::jsonb) || extra)
$$;
create temp table ids (k text primary key, v uuid);
create temp table r (k text primary key, j jsonb);   -- a write's answer, read by a LATER statement
insert into ids select 'dc', id from public.weekly_topic_leads where title = 'data centers';
insert into ids select 'air', id from public.weekly_topic_leads where title = 'Air Quality';

-- ── the prefix rule ─────────────────────────────────────────────────────────────────────────────────────────────
select 'B01|' || (
  public.weekly_bsky_prefix_rest('QUALITY-of-LIFE WEEKLY REPORT: Data Centers — x') = ' Data Centers — x'
  and public.weekly_bsky_prefix_rest(E'  \n Quality-of-Life Weekly Report: Water') = ' Water'
  and public.weekly_bsky_prefix_rest('quality‑of‑life weekly report:Data Centers') = 'Data Centers'   -- U+2011
  and public.weekly_bsky_prefix_rest('QUALITY–of–LIFE  WEEKLY   REPORT : x') = ' x')::text;              -- en dash, spaces
select 'B02|' || (
  public.weekly_bsky_prefix_rest('News: QUALITY-of-LIFE WEEKLY REPORT: Data Centers') is null      -- later in the post
  and public.weekly_bsky_prefix_rest('QUALITY-of-LIFE WEEKLY REPORT Data Centers') is null          -- no colon
  and public.weekly_bsky_prefix_rest('Quality of Life Weekly Report: x') is null                    -- no hyphens
  and public.weekly_bsky_prefix_rest('WEEKLY QUALITY-of-LIFE REPORT: x') is null                    -- words out of order
  and public.weekly_bsky_prefix_rest('QUALITY-of-LIFE WEEKLY REPORTS: x') is null)::text;

-- ── the lease ───────────────────────────────────────────────────────────────────────────────────────────────────
select 'B03|' || ((public.weekly_bsky_sync_claim('r1', 'did:plc:wn7c3svjrzpspuzmlecuqqeo', 'jodytracks.com') ->> 'ok')::boolean)::text;
select 'B04|' || (not (public.weekly_bsky_sync_claim('r2', 'did:plc:wn7c3svjrzpspuzmlecuqqeo', 'jodytracks.com') ->> 'ok')::boolean)::text;
select 'B05|' || pg_temp.raises($q$ select public.weekly_bsky_source_upsert('r2', pg_temp.post('aaa1', 'QUALITY-of-LIFE WEEKLY REPORT: Data Centers — x')) $q$, '55000')::text;

-- ── import with no edition; routing ─────────────────────────────────────────────────────────────────────────────
-- (each write goes into r; the check that reads it is a LATER statement, so it sees what the write did)
create temp table spacex as select E'QUALITY-of-LIFE WEEKLY REPORT: Data Centers — SpaceX plans a $24 billion gas-powered AI facility in Texas.'::text as t;
insert into r values ('b06', public.weekly_bsky_source_upsert('r1', pg_temp.post('3n25fosji4k2s', (select t from spacex), '{}', at => '2026-11-12T21:22:43Z')));
select 'B06|' || ((select count(*) from public.weekly_editions) = 0 and (select (j ->> 'created')::boolean from r where k = 'b06'))::text;
select 'B07|' || ((select lead_id from public.weekly_bsky_sources where post_uri like '%3n25fosji4k2s') = (select v from ids where k = 'dc')
  and (select topic_text || '|' || story_text from public.weekly_bsky_sources where post_uri like '%3n25fosji4k2s')
      = 'Data Centers|SpaceX plans a $24 billion gas-powered AI facility in Texas.')::text;
-- the alias "Data Center" (seeded by the file) routes to the same topic; a story on the next line is the story
insert into r values ('b08', public.weekly_bsky_source_upsert('r1', pg_temp.post('3n25fguo3us2w',
        E'quality-of-life weekly report: data center\nOakland extends its data center moratorium for 10 months.')));
select 'B08|' || ((select j ->> 'route_status' from r where k = 'b08') = 'matched'
  and (select lead_id from public.weekly_bsky_sources where post_uri like '%3n25fguo3us2w') = (select v from ids where k = 'dc')
  and (select story_text from public.weekly_bsky_sources where post_uri like '%3n25fguo3us2w') = 'Oakland extends its data center moratorium for 10 months.')::text;
-- no topic named "Water": kept for review, not guessed, not created
insert into r values ('b09', public.weekly_bsky_source_upsert('r1', pg_temp.post('3n227ngau522p', 'Quality-of-Life Weekly Report: Water — a story')));
select 'B09|' || ((select j ->> 'route_status' from r where k = 'b09') = 'unmatched'
  and (select lead_id is null and topic_text = 'Water' from public.weekly_bsky_sources where post_uri like '%3n227ngau522p')
  and (select count(*) from public.weekly_topic_leads) = 4)::text;
-- word boundary: "Data Centersville" is not "Data Centers"
insert into r values ('b10', public.weekly_bsky_source_upsert('r1', pg_temp.post('bbb1', 'QUALITY-of-LIFE WEEKLY REPORT: Data Centersville — y')));
select 'B10|' || ((select j ->> 'route_status' from r where k = 'b10') = 'unmatched')::text;
-- two topics with the same name: ambiguous, kept for review
insert into r values ('b11', public.weekly_bsky_source_upsert('r1', pg_temp.post('bbb2', 'QUALITY-of-LIFE WEEKLY REPORT: Noise — y')));
select 'B11|' || ((select j ->> 'route_status' from r where k = 'b11') = 'ambiguous')::text;
-- case and runs of whitespace are ignored; a colon after the topic is a separator
insert into r values ('b12', public.weekly_bsky_source_upsert('r1', pg_temp.post('bbb3', E'QUALITY-of-LIFE WEEKLY REPORT:   air   QUALITY: smoke')));
select 'B12|' || ((select j ->> 'route_status' from r where k = 'b12') = 'matched'
  and (select lead_id from public.weekly_bsky_sources where post_uri like '%bbb3') = (select v from ids where k = 'air')
  and (select story_text from public.weekly_bsky_sources where post_uri like '%bbb3') = 'smoke')::text;
-- refused: another account, a post that does not start with the prefix
select 'B13|' || (pg_temp.raises($q$ select public.weekly_bsky_source_upsert('r1', pg_temp.post('ccc1', 'QUALITY-of-LIFE WEEKLY REPORT: Data Centers', did => 'did:plc:someoneelse')) $q$, '22023')
  and pg_temp.raises($q$ select public.weekly_bsky_source_upsert('r1', pg_temp.post('ccc2', 'Read this. QUALITY-of-LIFE WEEKLY REPORT: Data Centers')) $q$, '22023')
  and not exists (select 1 from public.weekly_bsky_sources where post_uri like '%ccc_'))::text;

-- ── no duplicates; refresh; nothing saved is lost ───────────────────────────────────────────────────────────────
insert into r values ('b14', public.weekly_bsky_source_upsert('r1', pg_temp.post('3n25fosji4k2s', (select t from spacex), '{}', at => '2026-11-12T21:22:43Z')));
select 'B14|' || (not (select (j ->> 'changed')::boolean or (j ->> 'created')::boolean from r where k = 'b14')
  and (select count(*) from public.weekly_bsky_sources where post_uri like '%3n25fosji4k2s') = 1
  and (select current_revision from public.weekly_bsky_sources where post_uri like '%3n25fosji4k2s') = 1)::text;
insert into r values ('b15', public.weekly_bsky_source_upsert('r1', pg_temp.post('3n25fosji4k2s', (select t from spacex),
    '{"thread":[{"uri":"at://x/app.bsky.feed.post/t2","posted_at":"2026-11-12T21:30:00Z","text":"Second reply"}],
      "quoted":{"status":"available","uri":"at://did:plc:other/app.bsky.feed.post/q1","author_handle":"reporter.example","text":"Their words"},
      "links":["https://example.org/a"]}', at => '2026-11-12T21:22:43Z')));
select 'B15|' || ((select (j ->> 'changed')::boolean from r where k = 'b15')
  and (select current_revision from public.weekly_bsky_sources where post_uri like '%3n25fosji4k2s') = 2)::text;
-- a later fetch that lost the reply and could not read the quote changes nothing: no new revision, nothing removed
insert into r values ('b16', public.weekly_bsky_source_upsert('r1', pg_temp.post('3n25fosji4k2s', (select t from spacex),
    '{"quoted":{"status":"unavailable","uri":"at://did:plc:other/app.bsky.feed.post/q1"}}', at => '2026-11-12T21:22:43Z')));
select 'B16|' || (not (select (j ->> 'changed')::boolean from r where k = 'b16')
  and (select current_revision from public.weekly_bsky_sources where post_uri like '%3n25fosji4k2s') = 2)::text;
-- a new continuation reply (posted earlier than the saved one) is added in time order; the quote stays
insert into r values ('b17', public.weekly_bsky_source_upsert('r1', pg_temp.post('3n25fosji4k2s', (select t from spacex),
    '{"thread":[{"uri":"at://x/app.bsky.feed.post/t1","posted_at":"2026-11-12T21:25:00Z","text":"First reply"}]}', at => '2026-11-12T21:22:43Z')));
select 'B17|' || ((select (j ->> 'changed')::boolean from r where k = 'b17')
  and (select string_agg(t ->> 'text', ' / ' order by o) from public.weekly_bsky_source_revisions rv
       cross join lateral jsonb_array_elements(rv.content -> 'thread') with ordinality x (t, o)
       where rv.source_id = (select id from public.weekly_bsky_sources where post_uri like '%3n25fosji4k2s') and rv.revision = 3) = 'First reply / Second reply'
  and (select content -> 'quoted' ->> 'text' from public.weekly_bsky_source_revisions rv
       where rv.source_id = (select id from public.weekly_bsky_sources where post_uri like '%3n25fosji4k2s') and rv.revision = 3) = 'Their words')::text;
select 'B18|' || (pg_temp.raises('delete from public.weekly_bsky_sources', '55000')
  and pg_temp.raises('update public.weekly_bsky_source_revisions set content_sha = $$x$$', '55000')
  and pg_temp.raises('update public.weekly_bsky_sources set posted_at = now()', '55000'))::text;

-- ── checkpoint ──────────────────────────────────────────────────────────────────────────────────────────────────
select public.weekly_bsky_sync_finish('r1', true, '2026-11-12T21:22:43Z', true, null, '{"saved":6}');
select 'B19|' || ((select lease_owner is null and high_water_at = '2026-11-12T21:22:43Z' and backfill_done_at is not null and last_success_at is not null
                    from public.weekly_bsky_sync)
  and pg_temp.raises($q$ select public.weekly_bsky_sync_finish('r1', true, null, false, null, null) $q$, '55000'))::text;
-- a failed run records the failure and never moves the checkpoint back
select public.weekly_bsky_sync_claim('r3', 'did:plc:wn7c3svjrzpspuzmlecuqqeo', 'jodytracks.com');
select public.weekly_bsky_sync_finish('r3', false, '2026-11-01T00:00:00Z', false, 'bsky 503', null);
select 'B20|' || (select high_water_at = '2026-11-12T21:22:43Z' and last_error = 'bsky 503' and last_failure_at is not null from public.weekly_bsky_sync)::text;
select 'B21|' || pg_temp.raises($q$ select public.weekly_bsky_sync_claim('r4', 'did:plc:someoneelse', 'x') $q$, '22023')::text;

-- ── review: file by hand; an alias added later routes on the next refresh ────────────────────────────────────────
insert into r values ('b22', public.hs_weekly_bsky_source_file((select id from public.weekly_bsky_sources where post_uri like '%bbb2'), (select v from ids where k = 'air')));
select 'B22|' || ((select j ->> 'route_status' from r where k = 'b22') = 'matched'
  and (select routed_by from public.weekly_bsky_sources where post_uri like '%bbb2') = 'founder@test.invalid')::text;
select 'B23|' || pg_temp.raises($q$ select public.hs_weekly_topic_alias_add((select v from ids where k = 'air'), 'data centers') $q$, '23505')::text;
select public.hs_weekly_topic_alias_add((select v from ids where k = 'air'), 'Water');
select public.weekly_bsky_sync_claim('r5', 'did:plc:wn7c3svjrzpspuzmlecuqqeo', 'jodytracks.com');
insert into r values ('b24', public.weekly_bsky_source_upsert('r5', pg_temp.post('3n227ngau522p', 'Quality-of-Life Weekly Report: Water — a story')));
select 'B24|' || ((select j ->> 'route_status' from r where k = 'b24') = 'matched'
  and (select lead_id from public.weekly_bsky_sources where post_uri like '%3n227ngau522p') = (select v from ids where k = 'air'))::text;

-- ── editions: available when assigned; a published edition keeps what it had ────────────────────────────────────
create temp table ed as select (public.hs_weekly_edition_create('Data Centers', '2026-11-09') ->> 'id')::uuid as id;
select public.hs_weekly_lead_assign((select v from ids where k = 'dc'), (select id from ed));
select 'B25|' || (select jsonb_array_length(public.hs_weekly_bsky_sources((select id from ed)) -> 'edition' -> 'sources') = 2)::text;
select public.hs_weekly_lead_disposition((select v from ids where k = 'dc'), (select id from ed), 'included');
select public.hs_weekly_edition_publish((select id from ed), 'https://www.youtube.com/watch?v=ourvideo', current_date);
select pg_sleep(0.01);
select public.weekly_bsky_source_upsert('r5', pg_temp.post('3n25fosji4k2s', 'QUALITY-of-LIFE WEEKLY REPORT: Data Centers — SpaceX plans a $24 billion gas-powered AI facility in Texas.',
    '{"thread":[{"uri":"at://x/app.bsky.feed.post/t3","posted_at":"2026-11-13T10:00:00Z","text":"Third reply"}]}', at => '2026-11-12T21:22:43Z'));
select public.weekly_bsky_source_upsert('r5', pg_temp.post('3n2newpost', 'QUALITY-of-LIFE WEEKLY REPORT: Data Centers — a later story', at => '2026-11-13T09:00:00Z'));
select 'B26|' || (with v as (select public.hs_weekly_bsky_sources((select id from ed)) as j)
  select (j -> 'edition' ->> 'published')::boolean and jsonb_array_length(j -> 'edition' -> 'sources') = 2
    and (select (s ->> 'revision')::int from v, jsonb_array_elements(j -> 'edition' -> 'sources') s where s ->> 'post_uri' like '%3n25fosji4k2s') = 3
    and (select (s ->> 'revisions')::int from v, jsonb_array_elements(j -> 'edition' -> 'sources') s where s ->> 'post_uri' like '%3n25fosji4k2s') = 4
  from v)::text;
-- the general view shows the newest revision and the new story
select 'B27|' || (with v as (select public.hs_weekly_bsky_sources() as j)
  select jsonb_array_length(j -> 'by_lead' -> (select v::text from ids where k = 'dc')) = 3
    and (select (s ->> 'revision')::int from v, jsonb_array_elements(j -> 'by_lead' -> (select v::text from ids where k = 'dc')) s
         where s ->> 'post_uri' like '%3n25fosji4k2s') = 4 from v)::text;
-- the publication lock is untouched: nothing new can be assigned to the published edition
select 'B28|' || pg_temp.raises($q$ select public.hs_weekly_lead_assign((select v from ids where k = 'air'), (select id from ed)) $q$)::text;
select 'B29|' || ((select count(*) from public.weekly_editions) = 1
  and (select count(*) from pg_proc where proname in ('_wk_lead_assign','hs_weekly_lead_send_to_research','hs_weekly_lead_disposition')
       and prosrc like '%is published;%') = 3)::text;

-- ── access ──────────────────────────────────────────────────────────────────────────────────────────────────────
reset test.jwt;
set role anon;
select 'B30|' || (pg_temp.raises('select * from public.weekly_bsky_sources', '42501')
  and pg_temp.raises('select public.hs_weekly_bsky_sources()', '42501')
  and pg_temp.raises($q$ select public.weekly_bsky_sync_claim('x', 'did:plc:wn7c3svjrzpspuzmlecuqqeo', 'x') $q$, '42501'))::text;
reset role;
set role authenticated;
set test.jwt = '{"email":"someone@test.invalid"}';
select 'B31|' || (pg_temp.raises('select public.hs_weekly_bsky_sources()', '42501')
  and pg_temp.raises($q$ select public.weekly_bsky_source_upsert('r5', '{}') $q$, '42501')
  and pg_temp.raises('select * from public.weekly_bsky_source_revisions', '42501'))::text;
reset role;
set role service_role;
select 'B32|' || pg_temp.raises('select public.hs_weekly_bsky_sources()', '42501')::text;
reset role;
