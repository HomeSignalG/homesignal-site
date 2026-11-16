-- Media review names every photo asked for that the rendered videos do not show (engine photos_not_used,
-- homesignal-ingest impact/render/build.py; House Speaker story, 2026-11-15). DDL of record: docs/impact-stories.sql.
-- A splice of the live public._hs_is_media(uuid): refuses unless the body still fingerprints to the reading of
-- 2026-11-15 and the anchor appears exactly once; does nothing if already applied.
do $$
declare d text; n int; a text := $a$'blocked', blocked, 'choices', choices,
    'fix_requests', fixes$a$;
  r text := $r$'blocked', blocked, 'choices', choices,
    -- every photo asked for that the rendered videos do not show, with why (engine photos_not_used; 2026-11-15)
    'photos_not_used', coalesce(j.result->'photos_not_used', '[]'::jsonb),
    'fix_requests', fixes$r$;
begin
  select pg_get_functiondef('public._hs_is_media(uuid)'::regprocedure) into d;
  if position('photos_not_used' in d) > 0 then raise notice 'already applied'; return; end if;
  if (select md5(prosrc) from pg_proc where oid = 'public._hs_is_media(uuid)'::regprocedure) <> '17ae7cc9e20b6fff3d465099d20c87d2'
    then raise exception '_hs_is_media changed since 2026-11-15; re-derive this splice'; end if;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'anchor appears % times', n; end if;
  execute replace(d, a, r);
  if position('photos_not_used' in (select prosrc from pg_proc where oid = 'public._hs_is_media(uuid)'::regprocedure)) = 0
    then raise exception 'splice did not take'; end if;
end $$;
