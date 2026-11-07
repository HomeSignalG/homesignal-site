-- docs/youtube-video-rebuild-applies-note.sql on a disposable Postgres. The case: video 3014's main video was
-- rejected with "remove the act that has the quality of life checklist" and sent to Full rebuild, which read no note.
\set ON_ERROR_STOP 1
create function pg_temp.ok(c boolean, what text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL %', what; end if; raise notice 'ok %', what; end $$;
create function pg_temp.last_inputs() returns jsonb language sql as $$ select body -> 'inputs' from net.calls order by id desc limit 1 $$;
select set_config('test.jwt', '{"email":"founder@example.com"}', false);

insert into public.youtube_video_reviews (slug, title, files, file_decisions, status, meta)
values ('rn', 'Rebuild note', '{"final":{"path":"rn/final.mp4","bytes":10},"short1":{"path":"rn/short1.mp4","bytes":5}}',
        '{}', 'pending', '{}');

-- 1. a rejected file's saved note goes with the rebuild, as the worker's instruction
do $$ declare r jsonb; i jsonb; rv public.youtube_video_revisions%rowtype; begin
  perform public.hs_youtube_video_file_decide('rn', 'final', 'rejected', 'remove the act that has the quality of life checklist');
  r := public.hs_youtube_video_rebuild('rn', 'final');
  select * into rv from public.youtube_video_revisions where id = (r ->> 'revision_id')::uuid;
  i := pg_temp.last_inputs();
  perform pg_temp.ok((r ->> 'applies_note')::boolean, 'the rebuild says it carries the note');
  perform pg_temp.ok(i ->> 'instruction' = 'remove the act that has the quality of life checklist', 'the worker is sent the note');
  perform pg_temp.ok(i ->> 'mode' = 'rebuild' and (i ->> 'plan')::jsonb ->> 'apply_note' = 'true', 'the worker is told to apply it');
  perform pg_temp.ok(rv.plan ->> 'apply_note' = 'true', 'the stored plan says so');
  -- the worker found nothing it could change: the same note is refused on the same version
  update public.youtube_video_revisions set status = 'unsupported' where id = rv.id;
  begin perform public.hs_youtube_video_rebuild('rn', 'final'); perform pg_temp.ok(false, 'a note already refused by a rebuild is refused again');
  exception when sqlstate '55000' then perform pg_temp.ok(true, 'a note already refused by a rebuild is refused again'); end;
  -- reworded: tried again
  perform public.hs_youtube_video_file_decide('rn', 'final', 'rejected', 'delete the Quality-of-Life Checklist scene');
  r := public.hs_youtube_video_rebuild('rn', 'final');
  perform pg_temp.ok(pg_temp.last_inputs() ->> 'instruction' = 'delete the Quality-of-Life Checklist scene', 'a reworded note is tried');
  update public.youtube_video_revisions set status = 'cancelled' where slug = 'rn';
  -- undone: a plain rebuild, as before
  perform public.hs_youtube_video_file_decide('rn', 'final', 'pending', null);
  r := public.hs_youtube_video_rebuild('rn', 'final');
  perform pg_temp.ok(not (r ->> 'applies_note')::boolean and (pg_temp.last_inputs() ->> 'plan') = ''
                     and pg_temp.last_inputs() ->> 'instruction' like 'Full rebuild%', 'with no saved note a rebuild is unchanged');
  update public.youtube_video_revisions set status = 'cancelled' where slug = 'rn';
end $$;

-- 2. an approved file carries no note, even one it held before
do $$ declare r jsonb; begin
  perform public.hs_youtube_video_file_decide('rn', 'short1', 'approved', 'looks good');
  r := public.hs_youtube_video_rebuild('rn', 'short1');
  perform pg_temp.ok(not (r ->> 'applies_note')::boolean, 'an approval note is not a change request');
  update public.youtube_video_revisions set status = 'cancelled' where slug = 'rn';
end $$;

\echo all rebuild-note checks passed
