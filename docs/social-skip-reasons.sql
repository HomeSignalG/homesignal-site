-- Tab 12: WHY a post was skipped, kept so post selection can learn (founder, 2026-11-16).
-- Additive. Apply once; safe to re-run.
--
--   public.social_post_skip_reasons   append-only: who, when, reason chips, free note, and a
--                                     snapshot of what the post was (ZIP, theme, quality-of-life
--                                     score and areas, project type, text) at the moment of the skip.
--   public.hs_social_post_skip()      the ONE skip path the dashboard uses: skips the post and
--                                     records the reason in one transaction. Admin only.
--   public.hs_social_skip_reasons()   admin-only reader for the learning step.
--
-- Nothing here changes which posts are selected. It only keeps the founder's reasons.

create table if not exists public.social_post_skip_reasons (
  id           bigint generated always as identity primary key,
  post_id      uuid        not null,            -- no FK: the history must outlive the post row
  skipped_by   text        not null,
  skipped_at   timestamptz not null default now(),
  prior_status text        not null,
  reasons      text[]      not null default '{}',
  note         text,
  snapshot     jsonb       not null,
  constraint social_post_skip_reasons_note_len check (note is null or char_length(note) <= 2000),
  constraint social_post_skip_reasons_codes check (
    reasons <@ array['not_neighborhood_change','too_minor','wrong_project_type','duplicate',
                     'bad_name_or_address','poor_map','already_covered','wrong_place','other']
  )
);
create index if not exists social_post_skip_reasons_post_idx on public.social_post_skip_reasons (post_id);
create index if not exists social_post_skip_reasons_at_idx   on public.social_post_skip_reasons (skipped_at desc);

alter table public.social_post_skip_reasons enable row level security;   -- no policies: functions only
revoke all on public.social_post_skip_reasons from anon, authenticated, public;

create or replace function public.social_post_skip_reasons_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'social_post_skip_reasons is append-only' using errcode = '42501';
end $$;

drop trigger if exists social_post_skip_reasons_no_change on public.social_post_skip_reasons;
create trigger social_post_skip_reasons_no_change
  before update or delete on public.social_post_skip_reasons
  for each row execute function public.social_post_skip_reasons_append_only();

create or replace function public.hs_social_post_skip(p_id uuid, p_reasons text[] default '{}', p_note text default null)
returns bigint
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  _by   text := public._hs_is_admin();                 -- raises 42501 for anyone else
  _row  public.social_posts%rowtype;
  _note text := nullif(btrim(coalesce(p_note, '')), '');
  _id   bigint;
begin
  select * into _row from public.social_posts where id = p_id for update;
  if not found then raise exception 'post % not found', p_id using errcode = 'P0002'; end if;
  if _row.status not in ('draft', 'approved') then
    raise exception 'status is % - only a draft or an approved post can be skipped', _row.status using errcode = '55000';
  end if;

  update public.social_posts set status = 'skipped' where id = p_id;

  insert into public.social_post_skip_reasons (post_id, skipped_by, prior_status, reasons, note, snapshot)
  values (p_id, _by, _row.status, coalesce(p_reasons, '{}'), _note,
    jsonb_build_object(
      'zip',            _row.zip,
      'content_family', _row.content_family,
      'theme',          _row.evidence ->> 'theme',
      'project_id',     _row.evidence ->> 'project_id',
      'type_key',       _row.evidence -> 'visual' ->> 'type_key',
      'qol_score',      _row.evidence -> 'qol_score' -> 'score',
      'qol_impacts',    _row.evidence -> 'qol_score' -> 'impacts',
      'revision',       _row.revision,
      'scheduled_slot', _row.scheduled_slot,
      'post_text',      _row.post_text))
  returning id into _id;
  return _id;
end $$;

create or replace function public.hs_social_skip_reasons(p_days integer default 90)
returns table (id bigint, post_id uuid, skipped_at timestamptz, prior_status text,
               reasons text[], note text, snapshot jsonb)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public._hs_is_admin();
  return query
    select r.id, r.post_id, r.skipped_at, r.prior_status, r.reasons, r.note, r.snapshot
    from public.social_post_skip_reasons r
    where r.skipped_at >= now() - make_interval(days => greatest(coalesce(p_days, 90), 1))
    order by r.skipped_at desc;
end $$;

-- Supabase grants EXECUTE on new public functions to anon directly; revoke by name.
revoke all on function public.hs_social_post_skip(uuid, text[], text) from public, anon;
revoke all on function public.hs_social_skip_reasons(integer)         from public, anon;
grant execute on function public.hs_social_post_skip(uuid, text[], text) to authenticated, service_role;
grant execute on function public.hs_social_skip_reasons(integer)         to authenticated, service_role;
