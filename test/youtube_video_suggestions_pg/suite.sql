-- Acceptance suite for docs/youtube-video-suggestions.sql (Tab 16 "Suggest a video"). Every check raises on failure.
\set ON_ERROR_STOP on
\o /dev/null
create temp table _res (n text, ok boolean);
create function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin
  insert into _res values (n, coalesce(c,false)); if not coalesce(c,false) then raise exception 'FAIL: %', n; end if; end $$;
create function pg_temp.as_user(e text) returns void language sql as $$ select set_config('test.jwt', case when e is null then '' else json_build_object('email', e)::text end, false) $$;
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;

-- 1. access
select pg_temp.as_user(null);
select pg_temp.chk('1a anonymous cannot suggest', pg_temp.err($q$select public.hs_youtube_video_suggest('{"title":"A long enough title"}')$q$) like '42501%');
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('1b a non-admin cannot list', pg_temp.err($q$select public.hs_youtube_video_suggestions_list()$q$) like '42501%');
select pg_temp.chk('1c RLS is on and no visitor role can read the table',
  (select relrowsecurity from pg_class where oid = 'public.youtube_video_suggestions'::regclass)
  and not exists (select 1 from information_schema.role_table_grants
                  where table_name = 'youtube_video_suggestions' and grantee in ('anon', 'authenticated', 'PUBLIC')));

-- 2. adding
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('2a a valid suggestion is stored as waiting, with links and the founder as author',
  (select r->>'status' = 'waiting' and r->>'submitted_by' = 'founder@example.com' and jsonb_array_length(r->'links') = 2
   from (select public.hs_youtube_video_suggest('{"title":"  Port of Tacoma Blair dredging  ","place":"98421","links":["https://apps.ecology.wa.gov/x","https://apps.ecology.wa.gov/x","https://pierce.gov/y"],"note":"Big change"}') r) q));
select pg_temp.chk('2b the title is trimmed', exists (select 1 from public.youtube_video_suggestions where title = 'Port of Tacoma Blair dredging'));
select pg_temp.chk('2c the same open title is refused (23505)',
  pg_temp.err($q$select public.hs_youtube_video_suggest('{"title":"port of tacoma blair dredging"}')$q$) like '23505%');
select pg_temp.chk('2d a short title is refused', pg_temp.err($q$select public.hs_youtube_video_suggest('{"title":"abc"}')$q$) like '22023%');
select pg_temp.chk('2e a non-web link is refused', pg_temp.err($q$select public.hs_youtube_video_suggest('{"title":"Another project here","links":["javascript:alert(1)"]}')$q$) like '22023%');
select pg_temp.chk('2f links that are not a list are refused', pg_temp.err($q$select public.hs_youtube_video_suggest('{"title":"Another project here","links":"https://x.gov/a"}')$q$) like '22023%');
select pg_temp.chk('2g more than 20 links are refused',
  pg_temp.err(format('select public.hs_youtube_video_suggest(%L)', jsonb_build_object('title', 'Another project here',
    'links', (select jsonb_agg('https://x.gov/' || g) from generate_series(1, 21) g)))) like '22023%');
select pg_temp.chk('2h a long note is refused', pg_temp.err(format('select public.hs_youtube_video_suggest(%L)',
  jsonb_build_object('title', 'Another project here', 'note', repeat('x', 2001)))) like '22023%');

-- 3. listing and withdrawing
select public.hs_youtube_video_suggest('{"title":"Second project to film"}');
select pg_temp.chk('3a the list returns both, open first', jsonb_array_length(public.hs_youtube_video_suggestions_list()) = 2);
select pg_temp.chk('3b withdraw closes an open suggestion',
  (public.hs_youtube_video_suggestion_withdraw((select id from public.youtube_video_suggestions where title = 'Second project to film'))->>'status') = 'withdrawn');
select pg_temp.chk('3c a closed suggestion cannot be withdrawn again',
  pg_temp.err(format('select public.hs_youtube_video_suggestion_withdraw(%L::uuid)', (select id from public.youtube_video_suggestions where title = 'Second project to film'))) like '22023%');
select pg_temp.chk('3d after withdrawing, the same title can be suggested again',
  (public.hs_youtube_video_suggest('{"title":"Second project to film"}')->>'status') = 'waiting');
update public.youtube_video_suggestions set status = 'withdrawn', updated_at = now() - interval '31 days' where title = 'Second project to film' and status = 'withdrawn';
select pg_temp.chk('3e a withdrawal older than 30 days drops off the list',
  not exists (select 1 from jsonb_array_elements(public.hs_youtube_video_suggestions_list()) x where x->>'status' = 'withdrawn'));

-- 4. what a session writes
select pg_temp.chk('4a "made" needs the project slug',
  pg_temp.err($q$update public.youtube_video_suggestions set status = 'made' where title = 'Port of Tacoma Blair dredging'$q$) like '23514%');
update public.youtube_video_suggestions set status = 'made', project_slug = 'port-tacoma-blair' where title = 'Port of Tacoma Blair dredging';
select pg_temp.chk('4b a made suggestion cannot be withdrawn',
  pg_temp.err(format('select public.hs_youtube_video_suggestion_withdraw(%L::uuid)', (select id from public.youtube_video_suggestions where title = 'Port of Tacoma Blair dredging'))) like '22023%');
select pg_temp.chk('4c the made suggestion still lists, with its slug',
  exists (select 1 from jsonb_array_elements(public.hs_youtube_video_suggestions_list()) x where x->>'project_slug' = 'port-tacoma-blair'));

\o
select count(*) || ' checks passed' from _res where ok;
