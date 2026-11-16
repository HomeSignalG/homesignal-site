-- Tab 20 · Weekly Report, 7 of 7: TOPIC-QUEUE APPROVAL GATE. DDL of record. PREPARED, NOT APPLIED TO PRODUCTION.
-- The explicit link between a script or title version and a report edition, and the gate it enables: a script approval,
-- or a title's publication approval, is refused while a lead assigned to that version's edition has no disposition.
-- Needs: 1 (base), 2 (topic queue), 3 (workbench: weekly_scripts, weekly_script_approvals).
-- Application order (docs/weekly-release-order.md): 1 base · 2 topic queue  [the queue-only release ends here]
--   · 3 workbench · 4 source copies · 5 titles · 6 document cues · 7 topic-queue approval gate.
-- Each file is one transaction and is idempotent; re-applying an earlier file after a later one changes nothing.

begin;

-- the version link's foreign key (the column is created by 2, where weekly_scripts may not exist)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weekly_topic_lead_events_version_fk') then
    alter table public.weekly_topic_lead_events add constraint weekly_topic_lead_events_version_fk
      foreign key (version_id) references public.weekly_scripts (id);
  end if;
end $$;

-- The edition a version belongs to: the one explicitly linked to it, or to the nearest version it descends from
-- (its parent, or the version it was written from). Never read from a title or a date.
create or replace function public.weekly_version_edition(p_version uuid) returns uuid
language sql stable security definer set search_path = public as $$
  with recursive up (id, depth) as (
    select p_version, 0
    union
    select x.pid, up.depth + 1 from up join public.weekly_scripts s on s.id = up.id
      cross join lateral (values (s.parent_id), (s.depends_on)) x (pid) where x.pid is not null and up.depth < 60)
  select e.edition_id from up join public.weekly_topic_lead_events e on e.kind = 'version_linked' and e.version_id = up.id
  order by up.depth, e.id limit 1
$$;

-- The versions linked to one edition, for the queue's read model (2 calls this when it is installed).
create or replace function public.weekly_edition_linked_versions(p_edition uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('version_id', v.version_id, 'stage', w.stage, 'linked_at', v.created_at) order by v.id), '[]'::jsonb)
  from public.weekly_topic_lead_events v join public.weekly_scripts w on w.id = v.version_id
  where v.kind = 'version_linked' and v.edition_id = p_edition
$$;

-- ── the approval gate ────────────────────────────────────────────────────────────────────────────────────────────
-- A script approval, or a title's publication approval, is refused while a lead assigned to that version's edition has
-- no disposition. A version with no linked edition is not gated.
create or replace function public.weekly_edition_approval_gate() returns trigger language plpgsql security definer set search_path = public as $$
declare st text; ed uuid; n integer; names text; k text;
begin
  select stage into st from public.weekly_scripts where id = new.script_id;
  if not (st = 'script' or (st = 'title' and new.approval_kind = 'publication')) then return new; end if;
  ed := public.weekly_version_edition(new.script_id);
  if ed is null then return new; end if;
  select count(*), string_agg(u.title, '; ') into n, names from public.weekly_edition_unresolved(ed) u;
  if n > 0 then
    select edition_key into k from public.weekly_editions where id = ed;
    raise exception '% lead(s) assigned to edition % have no disposition yet (included, deferred or dropped): %', n, k, left(names, 600)
      using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists weekly_edition_approval_gate on public.weekly_script_approvals;
create trigger weekly_edition_approval_gate before insert on public.weekly_script_approvals
  for each row execute function public.weekly_edition_approval_gate();

-- Link a script or title version to an edition, explicitly. Versions made from it later belong to the same edition.
create or replace function public.hs_weekly_edition_link_version(p_edition uuid, p_version uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); ed public.weekly_editions; v public.weekly_scripts; has uuid;
begin
  select * into ed from public.weekly_editions where id = p_edition;
  if ed.id is null then raise exception 'unknown edition' using errcode = '22023'; end if;
  select * into v from public.weekly_scripts where id = p_version;
  if v.id is null then raise exception 'unknown version' using errcode = '22023'; end if;
  if v.topic <> ed.topic then raise exception 'that version is a "%" draft; edition % is a "%" report', v.topic, ed.edition_key, ed.topic using errcode = '22023'; end if;
  has := public.weekly_version_edition(p_version);
  if has = p_edition then return jsonb_build_object('edition_id', p_edition, 'version_id', p_version, 'existing', true); end if;
  if has is not null then
    raise exception 'that version already belongs to edition %', (select edition_key from public.weekly_editions where id = has) using errcode = '22023';
  end if;
  if ed.closed_at is not null then raise exception 'edition % is closed', ed.edition_key using errcode = '55000'; end if;
  insert into public.weekly_topic_lead_events (kind, edition_id, version_id, actor) values ('version_linked', p_edition, p_version, e);
  return jsonb_build_object('edition_id', p_edition, 'version_id', p_version, 'existing', false);
end $$;

-- ── grants ──
do $$
declare f text;
begin
  foreach f in array array['weekly_version_edition(uuid)', 'weekly_edition_linked_versions(uuid)', 'weekly_edition_approval_gate()',
    'hs_weekly_edition_link_version(uuid,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  execute 'grant execute on function public.hs_weekly_edition_link_version(uuid,uuid) to authenticated';
end $$;

commit;
