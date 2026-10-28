-- Tab 16 (YouTube Videos): the founder's own video suggestions (founder, 2026-10-28:
-- "both 16 and 17 need a suggest tab because they both render different style videos").
--
-- Tab 16 videos are the Public Records format (homesignal-ingest/video): one development record whose public
-- documents are read, quoted and narrated. Tab 17 is the Impact Stories format, fed by Hot Topics
-- (docs/impact-discovery.sql, hs_impact_discovery_suggest). The two pipelines pick their subjects differently,
-- so each tab keeps its own queue; nothing here touches impact_discovery_candidates.
--
-- A suggestion is a REQUEST, never evidence: links are where to start looking. A video is still made only from
-- the record's own fetched documents and passes video/validate.py like any other (homesignal-ingest
-- video/README.md stage 1 takes founder suggestions first).
--
-- Status: waiting (new) -> picked (a session took it) -> made (its project slug is filled) | declined (with a
-- reason, e.g. the record has no documents) | withdrawn (the founder took it back). Sessions update a row with
-- the service role; the page can only add and withdraw.
--
-- Additive and idempotent: run it twice and nothing changes.

create table if not exists public.youtube_video_suggestions (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 5 and 300),
  place         text check (place is null or char_length(place) <= 200),
  links         jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),
  note          text check (note is null or char_length(note) <= 2000),
  status        text not null default 'waiting'
                check (status in ('waiting', 'picked', 'made', 'declined', 'withdrawn')),
  status_note   text check (status_note is null or char_length(status_note) <= 2000),
  project_slug  text check (project_slug is null or project_slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  submitted_by  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint youtube_video_suggestions_made_has_slug check (status <> 'made' or project_slug is not null)
);

-- One open suggestion per title, so a double click never queues the same video twice.
create unique index if not exists youtube_video_suggestions_open_title
  on public.youtube_video_suggestions (lower(btrim(title)))
  where status in ('waiting', 'picked');

alter table public.youtube_video_suggestions enable row level security;
revoke all on public.youtube_video_suggestions from public, anon, authenticated;

-- Add a suggestion (admin only).
create or replace function public.hs_youtube_video_suggest(p_topic jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); t text := btrim(coalesce(p_topic->>'title', ''));
        pl text := nullif(btrim(coalesce(p_topic->>'place', '')), '');
        note text := nullif(btrim(coalesce(p_topic->>'note', '')), ''); links jsonb := '[]'::jsonb; u text;
        r public.youtube_video_suggestions%rowtype;
begin
  if char_length(t) < 5 or char_length(t) > 300 then
    raise exception 'Give the video a subject of 5 to 300 characters.' using errcode = '22023';
  end if;
  if pl is not null and char_length(pl) > 200 then raise exception 'The place is longer than 200 characters.' using errcode = '22023'; end if;
  if note is not null and char_length(note) > 2000 then raise exception 'The note is longer than 2,000 characters.' using errcode = '22023'; end if;
  if p_topic ? 'links' and jsonb_typeof(p_topic->'links') <> 'array' then raise exception 'Links must be a list.' using errcode = '22023'; end if;
  for u in select distinct btrim(x) from jsonb_array_elements_text(coalesce(p_topic->'links', '[]'::jsonb)) x where btrim(x) <> '' loop
    if u !~* '^https?://[^\s/?#]+\.[^\s/?#]+(/\S*)?$' or char_length(u) > 1000 then
      raise exception 'This is not a web link (it must start with http:// or https://): %', left(u, 120) using errcode = '22023';
    end if;
    links := links || to_jsonb(u);
  end loop;
  if jsonb_array_length(links) > 20 then raise exception 'At most 20 links per suggestion.' using errcode = '22023'; end if;
  if exists (select 1 from public.youtube_video_suggestions s
             where lower(btrim(s.title)) = lower(t) and s.status in ('waiting', 'picked')) then
    raise exception 'You already suggested this video and it is still open.' using errcode = '23505';
  end if;
  insert into public.youtube_video_suggestions (title, place, links, note, submitted_by)
  values (t, pl, links, note, e) returning * into r;
  return to_jsonb(r);
end $$;

-- Withdraw an open suggestion (admin only). A suggestion already made or declined stays as it is.
create or replace function public.hs_youtube_video_suggestion_withdraw(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); r public.youtube_video_suggestions%rowtype;
begin
  update public.youtube_video_suggestions
     set status = 'withdrawn', updated_at = now()
   where id = p_id and status in ('waiting', 'picked')
  returning * into r;
  if r.id is null then
    raise exception 'That suggestion is not open any more.' using errcode = '22023';
  end if;
  return to_jsonb(r);
end $$;

-- List (admin only): open ones first, then newest. Withdrawn ones older than 30 days are left out.
create or replace function public.hs_youtube_video_suggestions_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  return coalesce((
    select jsonb_agg(to_jsonb(s) order by (s.status in ('waiting', 'picked')) desc, s.created_at desc)
    from public.youtube_video_suggestions s
    where s.status <> 'withdrawn' or s.updated_at > now() - interval '30 days'
  ), '[]'::jsonb);
end $$;

revoke all on function public.hs_youtube_video_suggest(jsonb) from public, anon;
revoke all on function public.hs_youtube_video_suggestion_withdraw(uuid) from public, anon;
revoke all on function public.hs_youtube_video_suggestions_list() from public, anon;
grant execute on function public.hs_youtube_video_suggest(jsonb) to authenticated;
grant execute on function public.hs_youtube_video_suggestion_withdraw(uuid) to authenticated;
grant execute on function public.hs_youtube_video_suggestions_list() to authenticated;
