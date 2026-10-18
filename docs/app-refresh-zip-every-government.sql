-- app_refresh_zip: Government Notices and the meeting mirror from EVERY government covering the
-- ZIP — step 4 of the multi-city ZIP page build (option 3, 2026-10-18).
--
-- Before: both inserts read `community_id = coalesce(_root,_cid)` — the chain root alone — so a
-- city whose land overlaps the ZIP but that is not on its chain (Tacoma on a University Place
-- ZIP; Bluffdale on 84065) never reached the page's Government & civic section.
-- After: they read `community_id = any(_gov)`, where _gov is the root plus every community
-- public.zip_government_bodies(_zip) names (docs/zip-government-bodies.sql) — the ONE decision.
-- Each item's sentence names the government that issued it ("from Tacoma"); a root item reads
-- exactly as before. Rows are still filed under the root (the subscription anchor), and the
-- date window, supersession, 14-day ingest window and limits are unchanged.
--
-- A SPLICE of the live body (never a replay of a dated copy, which would revert later splices).
-- Five anchors, each must occur exactly once or nothing changes. The pre-change body is archived
-- in public.app_refresh_zip_def_archive (tag 'pre-every-government') — that is the rollback.
-- Idempotent: an already-spliced body (it declares _gov) is left alone.
do $do$
declare
  f text := pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure);
  g text;
  n int;
  pairs text[][] := array[
    array[$a$declare _cid uuid; _root uuid;$a$,
          $b$declare _cid uuid; _root uuid; _gov uuid[];$b$],
    array[$a$  select id into _root from up order by d desc limit 1;
$a$,
          $b$  select id into _root from up order by d desc limit 1;
  -- every government covering this ZIP (zip_government_bodies), plus the root
  select coalesce(array_agg(b.community_id) filter (where b.community_id is not null), '{}')
    into _gov from public.zip_government_bodies(_zip) b;
  _gov := array_append(_gov, coalesce(_root,_cid));
$b$],
    array[$a$    coalesce(_county||' County','County')||' '||coalesce(nullif(m.meeting_type,''),'meeting')$a$,
          $b$    case when m.community_id = coalesce(_root,_cid) then coalesce(_county||' County','County')
         else coalesce((select gc.name from public.communities gc where gc.id = m.community_id), 'City') end
      ||' '||coalesce(nullif(m.meeting_type,''),'meeting')$b$],
    array[$a$  where m.community_id = coalesce(_root,_cid) and m.meeting_date >= now() and coalesce(m.source_url,'')<>''$a$,
          $b$  where m.community_id = any(_gov) and m.meeting_date >= now() and coalesce(m.source_url,'')<>''$b$],
    array[$a$' from '||coalesce(_county||' County','the county')||' — see the official record.'$a$,
          $b$' from '||case when a.community_id = coalesce(_root,_cid) then coalesce(_county||' County','the county')
                        else coalesce((select gc.name from public.communities gc where gc.id = a.community_id), 'the city') end
      ||' — see the official record.'$b$],
    array[$a$  where a.community_id = coalesce(_root,_cid)
    and a.pipeline_type = 'government_notice'$a$,
          $b$  where a.community_id = any(_gov)
    and a.pipeline_type = 'government_notice'$b$],
    array[$a$select count(*) into _nm from public.meetings m where m.community_id = coalesce(_root,_cid) and m.meeting_date >= now();$a$,
          $b$select count(*) into _nm from public.meetings m where m.community_id = any(_gov) and m.meeting_date >= now();$b$]
  ];
  i int;
begin
  if position('_gov uuid[]' in f) > 0 then
    raise notice 'app_refresh_zip already reads every government; nothing to do';
    return;
  end if;
  insert into public.app_refresh_zip_def_archive (tag, md5, def, archived_at)
  values ('pre-every-government', md5(f), f, now());
  g := f;
  for i in 1 .. array_length(pairs, 1) loop
    n := (length(g) - length(replace(g, pairs[i][1], ''))) / length(pairs[i][1]);
    if n <> 1 then
      raise exception 'app_refresh_zip splice: anchor % appears % times (expected 1)', i, n;
    end if;
    g := replace(g, pairs[i][1], pairs[i][2]);
    if position(pairs[i][2] in g) = 0 then
      raise exception 'app_refresh_zip splice: replacement % did not land', i;
    end if;
  end loop;
  -- (Local News keeps its root-only read on purpose; only the two government reads move.)
  if position('coalesce(_root,_cid) and m.meeting_date' in g) > 0
     or position($x$where a.community_id = coalesce(_root,_cid)
    and a.pipeline_type = 'government_notice'$x$ in g) > 0 then
    raise exception 'app_refresh_zip splice: a root-only government read survived';
  end if;
  execute g;
  if pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure) not like '%_gov uuid[]%' then
    raise exception 'app_refresh_zip splice: the new body is not live';
  end if;
  raise notice 'app_refresh_zip: % -> %', md5(f), md5(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure));
end
$do$;
