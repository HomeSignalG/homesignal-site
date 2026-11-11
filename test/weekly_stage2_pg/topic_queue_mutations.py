"""Prohibited weakenings of the topic queue (docs/weekly-2-topic-queue.sql and docs/weekly-7-topic-queue-gate.sql).
run_topic_queue.sh applies each one to a copy of those files and requires at least one check in topic_queue.sql to fail.

  python3 topic_queue_mutations.py count
  python3 topic_queue_mutations.py apply <index> <file>...   rewrites, in place, the first file the mutation applies to
                                                              (prints the mutation's name)
"""
import sys

MUTATIONS = [
    ("draft-is-a-promise", "generated always as (commitment_post_url is not null) stored", "generated always as (commitment_wording is not null) stored"),
    ("commitment-changeable", "  if old.commitment_post_url is not null and (new.commitment_post_url is distinct from old.commitment_post_url",
     "  if false and (new.commitment_post_url is distinct from old.commitment_post_url"),
    ("non-admin-can-save", "declare e text := public._hs_is_admin(); l public.weekly_topic_leads; k text;", "declare e text := 'x'; l public.weekly_topic_leads; k text;"),
    ("anon-can-read", "    execute format('revoke all on public.%I from public, anon, authenticated', t);", "    execute format('grant select on public.%I to anon', t);"),
    ("capture-needs-an-edition", "    insert into public.weekly_topic_leads (title, created_by) values (btrim(f ->> 'title'), e) returning * into l;",
     "    if not (f ? 'intended_edition_id') then raise exception 'an edition is required' using errcode = '22023'; end if;\n"
     "    insert into public.weekly_topic_leads (title, created_by) values (btrim(f ->> 'title'), e) returning * into l;"),
    ("one-edition-per-week-forced", "    while exists (select 1 from public.weekly_editions where edition_key = k) loop n := n + 1; k := base || '-' || n; end loop;",
     "    if exists (select 1 from public.weekly_editions where edition_key = k) then raise exception 'one edition per week' using errcode = '23505'; end if;"),
    ("handoff-not-idempotent", "  if had is not null then\n    return jsonb_build_object('lead_id', p_lead, 'edition_id', p_edition, 'request_id', had, 'existing', true",
     "  if false then\n    return jsonb_build_object('lead_id', p_lead, 'edition_id', p_edition, 'request_id', had, 'existing', true"),
    ("second-request-per-pair", "create unique index if not exists weekly_topic_lead_events_handoff_uq on public.weekly_topic_lead_events (lead_id, edition_id) where kind = 'handoff';", ""),
    ("handoff-wrong-category", "  if l.topic is not null and l.topic <> ed.topic then", "  if false then"),
    ("handoff-steals-assignment", "  if other.edition_id is not null then", "  if false then"),
    ("handoff-length-unchecked", "  if char_length(txt) > 20000 then", "  if false then"),
    ("handoff-without-edition", "  if ed.id is null then raise exception 'choose a report edition first' using errcode = '22023'; end if;", ""),
    ("handoff-drops-the-questions", "    case when cardinality(l.questions) > 0 then E'\\nQuestions the research must answer:\\n' ||", "    case when false then E'\\nQuestions the research must answer:\\n' ||"),
    ("included-reads-as-published",
     "      when cur.disposition = 'included' and (select video_url is not null from public.weekly_editions where id = cur.edition_id) then 'published'",
     "      when cur.disposition = 'included' then 'published'"),
    ("pasted-reads-as-reviewed", "    when r.status = 'done' then jsonb_build_object('status', 'ready_for_editorial_review'",
     "    when a.id is not null then jsonb_build_object('status', 'ready_for_editorial_review'"),
    ("promised-deferred-without-reason", "  if l.promised_publicly and p_disposition in ('deferred', 'dropped') and char_length(coalesce(r, '')) < 10 then", "  if false then"),
    ("disposition-without-assignment",
     "  if a.edition_id is null then raise exception 'this lead is not assigned to edition %', ed.edition_key using errcode = '22023'; end if;", ""),
    ("deferred-stays-assigned", "    where a.disposition is null or a.disposition = 'included' order by a.assigned_id desc limit 1;", "    where true order by a.assigned_id desc limit 1;"),
    ("deferral-resolves-commitment", "l.promised_publicly and st in ('published', 'dropped')", "l.promised_publicly and st in ('published', 'dropped', 'deferred')"),
    ("gate-off", "  if n > 0 then\n    select edition_key into k from public.weekly_editions where id = ed;", "  if false then\n    select edition_key into k from public.weekly_editions where id = ed;"),
    ("gate-blocks-on-other-editions", "  where a.kind = 'assigned' and a.edition_id = p_edition\n    and not exists", "  where a.kind = 'assigned'\n    and not exists"),
    ("gate-ignores-lineage", "x.pid is not null and up.depth < 60)", "x.pid is not null and false)"),
    ("gate-skips-title-publication", "  if not (st = 'script' or (st = 'title' and new.approval_kind = 'publication')) then return new; end if;",
     "  if not (st = 'script') then return new; end if;"),
    ("link-other-category", "  if v.topic <> ed.topic then raise exception 'that version is a", "  if false then raise exception 'that version is a"),
    ("version-in-two-editions", "  if has is not null then\n    raise exception 'that version already belongs to edition %'", "  if false then\n    raise exception 'that version already belongs to edition %'"),
    ("close-with-undecided-leads",
     "  select count(*), string_agg(u.title, '; ') into n, names from public.weekly_edition_unresolved(p_edition) u;\n  if n > 0 then",
     "  select count(*), string_agg(u.title, '; ') into n, names from public.weekly_edition_unresolved(p_edition) u;\n  if false then"),
    ("close-unpublished-without-reason", "  if ed.video_url is null and char_length(coalesce(r, '')) < 10 then", "  if false then"),
    ("closed-decisions-change", "  if ed.closed_at is not null then raise exception 'edition % is closed; its decisions stand', ed.edition_key using errcode = '55000'; end if;", ""),
    ("closed-takes-assignments", "  if ed.closed_at is not null then raise exception 'edition % is closed', ed.edition_key using errcode = '55000'; end if;\n  if l.topic is not null",
     "  if l.topic is not null"),
    ("publish-without-date", "  if u is null or p_published_on is null then", "  if u is null then"),
    ("publish-a-source-as-our-video",
     "  if exists (select 1 from public.weekly_topic_leads l where u = any (l.source_urls) or u = l.social_post_url or u = l.commitment_post_url) then", "  if false then"),
    ("publish-with-undecided-leads",
     "  select count(*), string_agg(x.title, '; ') into n, names from public.weekly_edition_unresolved(p_edition) x;\n  if n > 0 then",
     "  select count(*), string_agg(x.title, '; ') into n, names from public.weekly_edition_unresolved(p_edition) x;\n  if false then"),
    ("publish-future-date", "  if p_published_on > current_date + 1 then", "  if false then"),
    ("republish-allowed", "  if old.video_url is null and new.video_url is not null and (to_jsonb(new) - pub_cols)", "  if new.video_url is not null and (to_jsonb(new) - pub_cols)"),
    ("reopen-allowed", "  if old.closed_at is null and new.closed_at is not null and (to_jsonb(new) - close_cols)", "  if (to_jsonb(new) - close_cols)"),
    ("events-not-append-only",
     "  create trigger weekly_topic_lead_events_append_only before update or delete on public.weekly_topic_lead_events\n"
     "    for each row execute function public.weekly_append_only();", ""),
]


def main():
    if sys.argv[1] == "count":
        print(len(MUTATIONS))
        return
    name, old, new = MUTATIONS[int(sys.argv[2])]
    for path in sys.argv[3:]:
        s = open(path, encoding="utf-8").read()
        t = s.replace(old, new, 1)
        if t != s:
            open(path, "w", encoding="utf-8").write(t)
            break
    else:
        raise AssertionError("mutation did not apply: " + name)
    print(name)


if __name__ == "__main__":
    main()
