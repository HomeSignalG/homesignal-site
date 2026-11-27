-- STAND-IN for public.app_refresh_zip, carrying the two REAL insert statements verbatim from the live body
-- (md5 e42d6011..., read 2026-11-27): the Government & civic notice insert and the Local News insert. Everything else of the
-- function is omitted. The migration is spliced onto THIS function, so what the splice does to those two statements is
-- what the test measures. Support objects are minimal stand-ins.
create table public.communities (id uuid primary key, name text, parent_id uuid);
create table public.alerts (
  id bigserial primary key, community_id uuid, title text, source_url text, pipeline_type text, category text,
  tile_tags text[], published_at timestamptz, created_at timestamptz default now(), subtopics text[], description text,
  agency_name text, expires_at timestamptz, supersedes text[], geo_evidence jsonb, comment_deadline date);
create table public.app_changes (id bigserial primary key, community_id uuid, zip text, category text, title text,
  plain_language text, occurred_at date, source_ref text, confidence text, window_closes_at date, lens text);
create table public.local_news_geo_retractions (community_id uuid, source_url text, active boolean);
create table public.app_flags (name text, enabled boolean);
create table public.app_refresh_zip_def_archive (tag text, md5 text, def text, archived_at timestamptz default now());
create function public.app_notice_superseded(uuid, text) returns boolean language sql as $$ select false $$;
create function public.alert_geo_displayable(public.alerts) returns boolean language sql as $$ select true $$;

create function public.app_refresh_zip(_zip text) returns text language plpgsql as $function$
declare _gov uuid[]; _root uuid; _cid uuid; _county text := 'Test';
begin
  select array_agg(id), min(id::text)::uuid into _gov, _cid from public.communities;
  _root := _cid;
  delete from public.app_changes where zip = _zip;

  insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, window_closes_at, lens)
  select coalesce(_root,_cid), _zip, 'Government & civic',
    a.title,
    'Government notice'||coalesce(' — '||nullif(case when a.category = 'local_news' then '' else a.category end,''),'')||' from '||case when a.community_id = coalesce(_root,_cid) then coalesce(_county||' County','the county')
                        else coalesce((select gc.name from public.communities gc where gc.id = a.community_id), 'the city') end
      ||' — see the official record.',
    coalesce(
      case when a.published_at >= date '2000-01-01'
            and a.published_at <  now() + interval '2 years'
           then a.published_at::date end,
      a.created_at::date), a.source_url, 'High', a.comment_deadline, 'safety'
  from public.alerts a
  where a.community_id = any(_gov)
    and (a.pipeline_type = 'government_notice'
         or ('government_notices' = any(a.tile_tags) and a.pipeline_type = 'news' and public.alert_geo_displayable(a)))
    and coalesce(a.source_url,'')<>''
    and not public.app_notice_superseded(a.community_id, a.source_url)
    and a.created_at >= now() - interval '14 days'
    -- GN past floor (founder ruling 2026-09-05): a DATED notice is eligible only
    -- within today-365 .. today+730. Undated notices are KEPT, exactly as the
    -- ingest guard keeps them. Local News below is deliberately unaffected.
    and (a.published_at is null
         or a.published_at::date between current_date - 365 and current_date + 730)
    and not exists (select 1 from public.app_changes ac where ac.zip=_zip and ac.source_ref = a.source_url)
  order by a.created_at desc, a.id limit 48;

  insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, lens)
  select coalesce(_root,_cid), _zip, 'Local News',
    a.title,
    coalesce(nullif(a.description,''), 'Local news'||coalesce(' — '||nullif(a.agency_name,''),'')||'.'),
    coalesce(a.published_at::date, a.created_at::date), a.source_url, 'Medium', 'value'
  from public.alerts a
  where a.community_id = coalesce(_root,_cid)
    and a.pipeline_type = 'news'
    and a.category = 'local_news'
    and public.alert_geo_displayable(a)
    and not exists (select 1 from public.local_news_geo_retractions r
                    where r.community_id = a.community_id
                      and r.source_url  = a.source_url
                      and r.active)
    and (
      -- a tagged legal ad is its own topic (founder 2026-11-27): it satisfies the 12-topic gate; every other gate below still applies
      'local_news' = any(a.tile_tags)
      or (cardinality(a.subtopics) >= 1
          and exists (select 1 from unnest(a.subtopics) s where btrim(coalesce(s, '')) <> ''))
    )
    and (a.expires_at is null or a.expires_at > now())
    and not exists (select 1 from public.alerts newer
                    where newer.community_id = a.community_id
                      and newer.supersedes @> array[a.source_url])
    and coalesce(a.source_url,'')<>''
    and a.created_at >= now() - interval '14 days'
    and not exists (select 1 from public.app_changes ac where ac.zip=_zip and ac.source_ref = a.source_url
                    and not (ac.category = 'Government & civic' and 'government_notices' = any(a.tile_tags)))
    and (
      not (select coalesce(bool_or(f.enabled), false) from public.app_flags f where f.name = 'page_target_zip')
      or ( (a.geo_evidence->>'status') = 'routed'
           and ( (a.geo_evidence->>'method') = 'countywide'
                 or (a.geo_evidence->'zip_set') ? _zip ) )
    )
  order by a.created_at desc, a.id limit 48;
  return _zip;
end $function$;
