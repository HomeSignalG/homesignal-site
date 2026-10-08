#!/usr/bin/env python3
"""Prohibited mutations of docs/report-share.sql. Each MUST fail >= 1 NAMED check of test/report_share_pg/suite.sql
(a mutation that only crashes the suite is reported by run.sh and fails the run).

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail to apply (a mutation
that does not apply is indistinguishable from one that survives).

Where the SQL protects a rule twice (a function AND a table constraint, or a trigger AND a privilege), the mutation
removes BOTH: a mutation that leaves the second guard standing only proves the second guard works. One mutation is
deliberately NOT here: removing the explicit `grant execute ... to service_role` is an equivalent mutant while the
platform's default privileges grant it anyway (the fixture reproduces them), and a suite that "killed" it would be
asserting the fixture. A second is NOT here for a different reason: dropping `for update` from the revoke's row read
changes nothing a SINGLE session can observe (it only matters when two revokes race), so no check in this suite could
fail on it. It is pinned structurally instead (test/report-share-structure.test.mjs) and is stated as not exercised.
"""
import sys

# ---- table lines ------------------------------------------------------------------------------------------------
SHARE_ID = "  share_id     uuid        primary key,\n"
REPORT_ID_COL = "  report_id    uuid        not null,\n"
HASH_COL = "  token_sha256 text        not null,\n"
FK_REPORT = "  constraint report_share_report_fk             foreign key (report_id) references public.report_snapshot (report_id),\n"
HASH_SHAPE = "  constraint report_share_hash_shape            check (token_sha256 ~ '^[0-9a-f]{64}$'),\n"
HASH_UNIQUE = "  constraint report_share_hash_unique           unique (token_sha256),\n"
EXPIRY_CK = ",\n  constraint report_share_expiry_after_creation check (expires_at is null or expires_at > created_at)\n);"
EVENT_KIND_COL = "  kind     text        not null,\n"
EVENT_FK = "  constraint report_share_event_share_fk foreign key (share_id) references public.report_share (share_id),\n"
EVENT_KIND_CK = ",\n  constraint report_share_event_kind     check (kind in ('created', 'revoked'))\n);"

# ---- triggers ---------------------------------------------------------------------------------------------------
TRG_SHARE = ("create or replace trigger report_share_only_revoke\n  before update or delete on public.report_share\n"
             "  for each row execute function public.report_share_guard();\n")
TRG_SHARE_TRUNC = ("create or replace trigger report_share_no_truncate\n  before truncate on public.report_share\n"
                   "  for each statement execute function public.report_share_guard();\n")
TRG_EVENT = ("create or replace trigger report_share_event_no_change\n  before update or delete on public.report_share_event\n"
             "  for each row execute function public.report_share_event_immutable();\n")
TRG_EVENT_TRUNC = ("create or replace trigger report_share_event_no_truncate\n  before truncate on public.report_share_event\n"
                   "  for each statement execute function public.report_share_event_immutable();\n")

# ---- the guard --------------------------------------------------------------------------------------------------
GUARD_REVOKE_ONCE = "    if old.revoked_at is null and new.revoked_at is not null\n"
GUARD_SHARE_ID = "       and new.share_id = old.share_id and new.report_id = old.report_id\n"
GUARD_HASH = "       and new.token_sha256 = old.token_sha256 and new.created_at = old.created_at\n"
GUARD_EXPIRY = "       and new.expires_at is not distinct from old.expires_at then\n"
GUARD_RAISE = "  raise exception 'report_share may only be revoked, once (% refused)', tg_op;\n"

# ---- create -----------------------------------------------------------------------------------------------------
CREATE_SIG = "create or replace function public.report_share_create(p_report uuid, p_token_sha256 text, p_expires_at timestamptz default null)\n"
CREATE_HEAD = "language plpgsql security definer set search_path = public, pg_temp\nas $$\ndeclare\n  v_id uuid := gen_random_uuid();\nbegin\n"
CREATE_INSERT = ("  insert into public.report_share (share_id, report_id, token_sha256, expires_at)\n"
                 "  values (v_id, p_report, p_token_sha256, p_expires_at);\n")
CREATE_EVENT = "  insert into public.report_share_event (share_id, kind) values (v_id, 'created');\n"

# ---- revoke -----------------------------------------------------------------------------------------------------
REVOKE_HEAD = ("create or replace function public.report_share_revoke(p_share uuid)\nreturns boolean\n"
               "language plpgsql security definer set search_path = public, pg_temp\nas $$\n")
REVOKE_NOT_FOUND = "    raise exception 'report_share: no such share' using errcode = '23503';\n"
REVOKE_IDEMPOTENT = "  if s.revoked_at is not null then\n    return false;\n  end if;\n"
REVOKE_UPDATE = "  update public.report_share set revoked_at = now() where share_id = p_share;\n"
REVOKE_EVENT = "  insert into public.report_share_event (share_id, kind) values (p_share, 'revoked');\n"

# ---- resolve ----------------------------------------------------------------------------------------------------
RESOLVE_HEAD = ("create or replace function public.report_share_resolve(p_token_sha256 text)\nreturns table (status text, report_id uuid)\n"
                "language plpgsql stable security definer set search_path = public, pg_temp\nas $$\n")
RESOLVE_BODY = ("declare\n  s public.report_share%rowtype;\nbegin\n"
                "  select * into s from public.report_share where token_sha256 = p_token_sha256;\n"
                "  if not found then\n    return query select 'UNKNOWN'::text, null::uuid;\n"
                "  elsif s.revoked_at is not null then\n    return query select 'REVOKED'::text, null::uuid;\n"
                "  elsif s.expires_at is not null and s.expires_at <= now() then\n    return query select 'EXPIRED'::text, null::uuid;\n"
                "  else\n    return query select 'ACTIVE'::text, s.report_id;\n  end if;\nend $$;\n")
RESOLVE_REVOKED_BRANCH = "  elsif s.revoked_at is not null then\n    return query select 'REVOKED'::text, null::uuid;\n"
RESOLVE_EXPIRED_BRANCH = "  elsif s.expires_at is not null and s.expires_at <= now() then\n    return query select 'EXPIRED'::text, null::uuid;\n"
RESOLVE_UNKNOWN_BRANCH = "  if not found then\n    return query select 'UNKNOWN'::text, null::uuid;\n"

# ---- lock-down --------------------------------------------------------------------------------------------------
RLS_SHARE = "alter table public.report_share       enable row level security;\n"
RLS_EVENT = "alter table public.report_share_event enable row level security;\n"
REVOKE_SHARE = "revoke all on public.report_share       from public, anon, authenticated, service_role;\n"
REVOKE_EVENT_T = "revoke all on public.report_share_event from public, anon, authenticated, service_role;\n"
GRANT_SHARE = "grant select on public.report_share       to service_role;\n"
GRANT_EVENT = "grant select on public.report_share_event to service_role;\n"
LOCK_LOOP_BODY = ("    execute format('revoke all on function %s from public, anon, authenticated', f.sig);\n"
                  "    execute format('grant execute on function %s to service_role', f.sig);\n")
LOCK_END = "  end loop;\nend $lock$;\n"
SEQ_REVOKE = "    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s.sq);\n"


def resolve_variant(returns, branches, extra_decl='', head=RESOLVE_HEAD):
    """A complete replacement for report_share_resolve with the given RETURNS TABLE clause and branch return lists."""
    unknown, revoked, expired, active = branches
    return (head.replace("returns table (status text, report_id uuid)", "returns table (" + returns + ")") +
            "declare\n  s public.report_share%rowtype;\nbegin\n"
            "  select * into s from public.report_share where token_sha256 = p_token_sha256;\n"
            "  if not found then\n    return query select " + unknown + ";\n"
            "  elsif s.revoked_at is not null then\n    return query select " + revoked + ";\n"
            "  elsif s.expires_at is not null and s.expires_at <= now() then\n    return query select " + expired + ";\n"
            "  else\n    return query select " + active + ";\n  end if;\nend $$;\n")


MUTATIONS = {
    # ---- the token is never stored ---------------------------------------------------------------------------
    'plaintext_token_column': [(HASH_COL, HASH_COL + "  token        text,\n", 1)],
    'hash_not_unique': [(HASH_UNIQUE, "", 1)],
    'hash_shape_unchecked': [(HASH_SHAPE, "", 1)],
    'hash_shape_allows_uppercase': [("'^[0-9a-f]{64}$'", "'^[0-9a-fA-F]{64}$'", 1)],
    'hash_shape_allows_any_length': [("'^[0-9a-f]{64}$'", "'^[0-9a-f]+$'", 1)],
    'hash_nullable': [(HASH_COL, "  token_sha256 text,\n", 1)],
    # ---- what a share is ---------------------------------------------------------------------------------------
    'no_fk_to_snapshot': [(FK_REPORT, "", 1)],
    'fk_cascades_on_delete': [("references public.report_snapshot (report_id),\n", "references public.report_snapshot (report_id) on delete cascade,\n", 1)],
    'report_id_nullable': [(REPORT_ID_COL, "  report_id    uuid,\n", 1)],
    'share_id_has_a_default': [(SHARE_ID, "  share_id     uuid        primary key default gen_random_uuid(),\n", 1)],
    'no_expiry_check': [(EXPIRY_CK, "\n);", 1)],
    'expiry_may_equal_creation': [("expires_at > created_at)", "expires_at >= created_at)", 1)],
    # ---- the audit log ------------------------------------------------------------------------------------------
    'event_free_text': [(EVENT_KIND_COL, EVENT_KIND_COL + "  note     text,\n", 1)],
    'event_has_an_actor': [(EVENT_KIND_COL, EVENT_KIND_COL + "  actor    text,\n", 1)],
    'event_kind_open': [("check (kind in ('created', 'revoked'))", "check (kind in ('created', 'revoked', 'viewed'))", 1)],
    'event_kind_unchecked': [(EVENT_KIND_CK, "\n);", 1)],
    'event_without_a_share': [(EVENT_FK, "", 1)],
    # ---- the guard: one update, never a delete or a truncate ----------------------------------------------------------
    'revoke_can_be_undone': [(GUARD_REVOKE_ONCE, "    if true\n", 1)],
    'expiry_extendable': [(GUARD_HASH + GUARD_EXPIRY, "       and new.token_sha256 = old.token_sha256 and new.created_at = old.created_at then\n", 1)],
    'report_movable': [("and new.share_id = old.share_id and new.report_id = old.report_id\n", "and new.share_id = old.share_id\n", 1)],
    'hash_movable': [("       and new.token_sha256 = old.token_sha256 and new.created_at = old.created_at\n", "       and new.created_at = old.created_at\n", 1)],
    'creation_time_movable': [("and new.token_sha256 = old.token_sha256 and new.created_at = old.created_at\n", "and new.token_sha256 = old.token_sha256\n", 1)],
    'share_id_movable': [("       and new.share_id = old.share_id and new.report_id = old.report_id\n", "       and new.report_id = old.report_id\n", 1)],
    'delete_allowed': [(GUARD_RAISE, "  if tg_op = 'DELETE' then\n    return old;\n  end if;\n" + GUARD_RAISE, 1)],
    'share_row_trigger_dropped': [(TRG_SHARE, "", 1)],
    'share_truncate_trigger_dropped': [(TRG_SHARE_TRUNC, "", 1)],
    'event_truncate_trigger_dropped': [(TRG_EVENT_TRUNC, "", 1)],
    'truncate_allowed': [(TRG_SHARE_TRUNC, "", 1), (TRG_EVENT_TRUNC, "", 1)],
    'event_row_trigger_dropped': [(TRG_EVENT, "", 1)],
    # ---- resolve: the ONE decision --------------------------------------------------------------------------------------
    'resolve_ignores_expiry': [(RESOLVE_EXPIRED_BRANCH, "", 1)],
    'resolve_ignores_revocation': [(RESOLVE_REVOKED_BRANCH, "", 1)],
    'expired_beats_revoked': [(RESOLVE_REVOKED_BRANCH + RESOLVE_EXPIRED_BRANCH, RESOLVE_EXPIRED_BRANCH + RESOLVE_REVOKED_BRANCH, 1)],
    'expiry_boundary_exclusive': [("s.expires_at <= now() then\n    return query select 'EXPIRED'", "s.expires_at < now() then\n    return query select 'EXPIRED'", 1)],
    'resolve_unknown_raises': [(RESOLVE_UNKNOWN_BRANCH, "  if not found then\n    raise exception 'report_share: unknown link';\n", 1)],
    'resolve_case_insensitive': [("where token_sha256 = p_token_sha256;\n  if not found then", "where token_sha256 = lower(p_token_sha256);\n  if not found then", 1)],
    'resolve_returns_report_for_a_revoked_link': [("return query select 'REVOKED'::text, null::uuid;", "return query select 'REVOKED'::text, s.report_id;", 1)],
    'resolve_returns_report_for_an_expired_link': [("return query select 'EXPIRED'::text, null::uuid;", "return query select 'EXPIRED'::text, s.report_id;", 1)],
    'resolve_returns_report_for_an_unknown_link': [("return query select 'UNKNOWN'::text, null::uuid;", "return query select 'UNKNOWN'::text, '00000000-0000-4000-8000-000000000000'::uuid;", 1)],
    'resolve_returns_body': [(RESOLVE_HEAD + RESOLVE_BODY, resolve_variant(
        "status text, report_id uuid, body text",
        ("'UNKNOWN'::text, null::uuid, null::text", "'REVOKED'::text, null::uuid, null::text", "'EXPIRED'::text, null::uuid, null::text",
         "'ACTIVE'::text, s.report_id, (select r.body from public.report_snapshot r where r.report_id = s.report_id)")), 1)],
    'resolve_returns_context_id': [(RESOLVE_HEAD + RESOLVE_BODY, resolve_variant(
        "status text, report_id uuid, private_context_id uuid",
        ("'UNKNOWN'::text, null::uuid, null::uuid", "'REVOKED'::text, null::uuid, null::uuid", "'EXPIRED'::text, null::uuid, null::uuid",
         "'ACTIVE'::text, s.report_id, (select r.private_context_id from public.report_snapshot r where r.report_id = s.report_id)")), 1)],
    'resolve_returns_the_share_id': [(RESOLVE_HEAD + RESOLVE_BODY, resolve_variant(
        "status text, report_id uuid, share_id uuid",
        ("'UNKNOWN'::text, null::uuid, null::uuid", "'REVOKED'::text, null::uuid, null::uuid", "'EXPIRED'::text, null::uuid, null::uuid",
         "'ACTIVE'::text, s.report_id, s.share_id")), 1)],
    'resolve_is_volatile': [("language plpgsql stable security definer set search_path = public, pg_temp\nas $$\ndeclare\n  s public.report_share%rowtype;",
                             "language plpgsql security definer set search_path = public, pg_temp\nas $$\ndeclare\n  s public.report_share%rowtype;", 1)],
    'resolve_records_the_view': [("language plpgsql stable security definer set search_path = public, pg_temp\nas $$\ndeclare\n  s public.report_share%rowtype;",
                                  "language plpgsql security definer set search_path = public, pg_temp\nas $$\ndeclare\n  s public.report_share%rowtype;", 1),
                                 ("    return query select 'ACTIVE'::text, s.report_id;\n",
                                  "    insert into public.report_share_event (share_id, kind) values (s.share_id, 'created');\n    return query select 'ACTIVE'::text, s.report_id;\n", 1)],
    'resolve_search_path_unpinned': [(RESOLVE_HEAD, RESOLVE_HEAD.replace(" set search_path = public, pg_temp", ""), 1)],
    # ---- create ---------------------------------------------------------------------------------------------------------------
    'writer_not_security_definer': [(CREATE_SIG + "returns uuid\n" + CREATE_HEAD, CREATE_SIG + "returns uuid\n" + CREATE_HEAD.replace("security definer ", ""), 1)],
    'writer_search_path_unpinned': [(CREATE_SIG + "returns uuid\n" + CREATE_HEAD, CREATE_SIG + "returns uuid\n" + CREATE_HEAD.replace(" set search_path = public, pg_temp", ""), 1)],
    'caller_chooses_the_share_id': [(CREATE_SIG, "create or replace function public.report_share_create(p_report uuid, p_token_sha256 text, p_expires_at timestamptz default null, p_share uuid default null)\n", 1),
                                    ("  v_id uuid := gen_random_uuid();\nbegin\n  insert into public.report_share", "  v_id uuid := coalesce(p_share, gen_random_uuid());\nbegin\n  insert into public.report_share", 1)],
    'create_applies_a_default_expiry': [("values (v_id, p_report, p_token_sha256, p_expires_at);", "values (v_id, p_report, p_token_sha256, coalesce(p_expires_at, now() + interval '30 days'));", 1)],
    'create_writes_no_event': [(CREATE_EVENT, "", 1)],
    'create_swallows_a_duplicate_hash': [("  values (v_id, p_report, p_token_sha256, p_expires_at);\n", "  values (v_id, p_report, p_token_sha256, p_expires_at)\n  on conflict (token_sha256) do nothing;\n", 1)],
    'create_opens_private_need': [(CREATE_EVENT, CREATE_EVENT +
        "  perform public.report_private_context_need_open(x.c, 'follow', 'share:' || v_id::text)\n"
        "    from (select private_context_id as c from public.report_snapshot where report_id = p_report and private_context_id is not null) x;\n", 1)],
    'create_requires_active_context': [(CREATE_INSERT,
        "  if exists (select 1 from public.report_snapshot s join public.report_private_context c on c.context_id = s.private_context_id\n"
        "              where s.report_id = p_report and c.state <> 'active') then\n"
        "    raise exception 'report_share: the private context was purged' using errcode = '55000';\n  end if;\n" + CREATE_INSERT, 1)],
    # ---- revoke ----------------------------------------------------------------------------------------------------------------------
    'revoke_writes_no_event': [(REVOKE_EVENT, "", 1)],
    'revoke_writes_two_events': [(REVOKE_EVENT, REVOKE_EVENT + REVOKE_EVENT, 1)],
    'revoke_is_not_idempotent': [(REVOKE_IDEMPOTENT, "", 1)],
    'revoke_always_says_true': [("  if s.revoked_at is not null then\n    return false;\n", "  if s.revoked_at is not null then\n    return true;\n", 1)],
    'revoke_of_unknown_is_quiet': [(REVOKE_NOT_FOUND, "    return false;\n", 1)],
    'revoke_closes_the_report_need': [(REVOKE_EVENT, REVOKE_EVENT +
        "  perform public.report_private_context_need_close(x.c, 'report', s.report_id::text)\n"
        "    from (select private_context_id as c from public.report_snapshot where report_id = s.report_id and private_context_id is not null) x;\n", 1)],
    # ---- lock-down ---------------------------------------------------------------------------------------------------------------------
    'lockdown_loop_missing': [(LOCK_LOOP_BODY, "    null;\n", 1)],
    'anon_can_execute': [(LOCK_END, LOCK_END + "grant execute on function public.report_share_resolve(text) to anon;\n", 1)],
    'authenticated_can_create': [(LOCK_END, LOCK_END + "grant execute on function public.report_share_create(uuid, text, timestamptz) to authenticated;\n", 1)],
    'functions_unlocked': [("execute format('revoke all on function %s from public, anon, authenticated', f.sig);", "execute format('select 1 /* %s */', f.sig);", 1)],
    'sequence_default_grants': [(SEQ_REVOKE, "    null;\n", 1)],
    'sequence_granted_to_anon': [(SEQ_REVOKE, SEQ_REVOKE + "    execute format('grant usage, update on sequence %s to anon', s.sq);\n", 1)],
    'no_rls_on_shares': [(RLS_SHARE, "", 1)],
    'no_rls_on_events': [(RLS_EVENT, "", 1)],
    'share_table_default_grants': [(REVOKE_SHARE, "", 1)],
    'event_table_default_grants': [(REVOKE_EVENT_T, "", 1)],
    'anon_can_read_events': [(GRANT_EVENT, "grant select on public.report_share_event to service_role, anon;\n", 1)],
    'authenticated_can_read_shares': [(GRANT_SHARE, "grant select on public.report_share to service_role, authenticated;\n", 1)],
    'service_role_can_insert': [(GRANT_SHARE, "grant select, insert on public.report_share to service_role;\n", 1)],
    'service_role_can_update': [(GRANT_SHARE, "grant select, update on public.report_share to service_role;\n", 1)],
    'service_role_can_write_events': [(GRANT_EVENT, "grant select, insert on public.report_share_event to service_role;\n", 1)],
    # ---- this file must not reach into what it depends on --------------------------------------------------------------------------------
    'adds_an_owner_to_the_snapshot': [(LOCK_END, LOCK_END + "alter table public.report_snapshot add column owner_id uuid;\n", 1)],
    'grants_the_snapshot_to_service_role_for_writing': [(LOCK_END, LOCK_END + "grant insert on public.report_snapshot to service_role;\n", 1)],
}


def main():
    if len(sys.argv) == 2 and sys.argv[1] == '--list':
        print('\n'.join(MUTATIONS))
        return 0
    if len(sys.argv) != 3 or sys.argv[1] not in MUTATIONS:
        sys.stderr.write('usage: mutate.py --list | NAME FILE\n')
        return 2
    text = open(sys.argv[2]).read()
    for old, new, count in MUTATIONS[sys.argv[1]]:
        if text.count(old) != count:
            sys.stderr.write('anchor for %s matched %d time(s), expected %d\n' % (sys.argv[1], text.count(old), count))
            return 2
        if old == new:
            sys.stderr.write('mutation %s changes nothing\n' % sys.argv[1])
            return 2
        text = text.replace(old, new)
    sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
