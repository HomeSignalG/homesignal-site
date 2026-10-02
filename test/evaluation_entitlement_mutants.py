#!/usr/bin/env python3
"""Prohibited mutations of the evaluation entitlement (Development Activity plan, Order L1).

Each mutation MUST be caught. There are three families:

  MUTATIONS       edits of docs/evaluation-entitlement.sql. Each MUST fail the executable check that owns it
                  (test/evaluation_entitlement_pg/run.sh applies the mutated file to a DISPOSABLE Postgres and runs the suite;
                  those only two real sessions can see run the concurrent scenarios; those only a poisoned state can see run the
                  poisoned-apply check). Those the structural pins can also see are ALSO run against
                  test/evaluation-entitlement-structure.test.mjs by the offline mode below; the ones only the database can see are
                  listed in PG_ONLY, and the offline mode reports them as skipped, never as passed.
  STRUCT_ONLY     edits of the SQL that the database cannot tell from the shipped file (a name qualified or not, a number written
                  twice, a statement that changes no row) or that would not even apply to it. They are NOT run against the
                  database (they are not in --list); the structural test MUST kill each.
  FILE_MUTATIONS  edits of the files AROUND the SQL (the admin gate, the snapshot module, a handler, the status file, the workflow,
                  the harness ...). Each MUST fail the structural test.

    python3 test/evaluation_entitlement_mutants.py                  # offline: every mutation against the structural test
    python3 test/evaluation_entitlement_mutants.py name [name ...]  # only the named ones
    python3 test/evaluation_entitlement_mutants.py --list           # the SQL mutation names run.sh runs, one per line
    python3 test/evaluation_entitlement_mutants.py --kind NAME      # 'suite', 'race' or 'poison' (which executable check must catch it)
    python3 test/evaluation_entitlement_mutants.py --sql NAME FILE  # the mutated SQL on stdout; exit 2 if an anchor is absent
    python3 test/evaluation_entitlement_mutants.py --check          # every anchor still matches the SQL exactly as many times as stated

An anchor must match EXACTLY the stated number of times and a mutation must change the text, so a mutation can never silently fail
to apply (a mutation that does not apply is indistinguishable from one that survives). The offline mode edits files in place and
ALWAYS restores the originals, even on error or ^C. Where the SQL protects a rule twice (a function check AND the file's own
post-condition, or a constraint AND a trigger), the mutation removes BOTH: a mutation that leaves the second guard standing only
proves the second guard works. Exit 1 if any mutation survives, 2 on a harness fault.
(Manual, like brokerage_account_mutants.py: CI runs the executable harness, run.sh, and the structural test.)

Mutations deliberately NOT listed, because they cannot be told from the shipped file (equivalent mutants), with the reason:
  - redeem without the INVITE row lock: every redeemer of an invite locks the evaluation row first, so the invite lock never
    decides anything the evaluation lock has not; removing it changes no outcome (removing BOTH locks is listed).
  - ordinal taken as count + 1 instead of max + 1: the same number while the ledger is contiguous, which the constraint and the
    check function guarantee.
  - the post-condition's row level security check: the statement just above it enables row level security, so no input reaches it.
  - the post-condition's "at least 13 functions": the file defines them itself, so no state reaches it.
  - the post-condition's trigger-function limb (a trigger function granted to service_role): the lock loop above it revokes service_role
    from every function first, so no input reaches that limb; the same grant made by a MUTATED loop is killed by the suite (L10).
"""
import re
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SQL = 'docs/evaluation-entitlement.sql'
STRUCT = 'test/evaluation-entitlement-structure.test.mjs'


def strip_post(text):
    """Remove the file's fail-closed post-condition block (a mutation of the lock-down must not trip it first)."""
    out, n = re.subn(r"-- ---- 15\. POST-CONDITION.*?end \$post\$;\n", '', text, flags=re.S)
    if n != 1:
        raise ValueError('post-condition block not found exactly once')
    return out


def drop_seq_loop(text):
    out, n = re.subn(r"do \$seq\$.*?end \$seq\$;\n", '', text, flags=re.S)
    if n != 1:
        raise ValueError('sequence loop not found exactly once')
    return out


def lockdown(*ops):
    """A mutation of the lock-down: first strip the post-condition, then apply the edits."""
    return [strip_post, *ops]


# ---- anchors (verbatim from the SQL of record) ---------------------------------------------------------------------------
LIMIT_FN = "language sql immutable as $$ select 20 $$;"

EVAL_ONE = "  constraint evaluation_one_per_brokerage unique (brokerage_id),\n"
EVAL_STATUS = "  constraint evaluation_status            check (status in ('active', 'complete', 'revoked')),\n"
EVAL_SEAT = "  constraint evaluation_seat_limit        check (seat_limit is null or seat_limit >= 0),\n"
EVAL_REVOKED = "  constraint evaluation_revoked           check ((status = 'revoked') = (revoked_at is not null)),\n"
EVAL_EXPIRY = "  constraint evaluation_expiry            check (expires_at is null or expires_at > created_at)\n);"
EVAL_FK = "brokerage_id  uuid        not null references public.brokerage_account (id),"
EVAL_TAIL = "  revoked_at    timestamptz,\n  constraint evaluation_one_per_brokerage"

INV_HASH_UNIQ = "  constraint evaluation_invite_token_hash_unique unique (token_hash),\n"
INV_HASH_SHAPE = "  constraint evaluation_invite_token_hash_shape  check (token_hash ~ '^[0-9a-f]{64}$'),\n"
INV_ROLE = "  constraint evaluation_invite_role              check (role in ('owner', 'agent')),\n"
INV_STATE = (
    "  constraint evaluation_invite_state             check (\n"
    "       (status = 'open'     and redeemed_at is null and redeemed_by is null and revoked_at is null)\n"
    "    or (status = 'redeemed' and redeemed_at is not null and revoked_at is null)\n"
    "    or (status = 'revoked'  and revoked_at is not null and redeemed_at is null and redeemed_by is null)),\n")
INV_LIFETIME = "  constraint evaluation_invite_lifetime          check (expires_at > created_at and expires_at <= created_at + interval '90 days')\n);"
INV_FK_USER = "references auth.users (id) on delete set null,"
INV_FK_EVAL = "  evaluation_id uuid        not null references public.evaluation (evaluation_id),\n  role          text        not null,"
INV_TAIL = "  revoked_at    timestamptz,\n  constraint evaluation_invite_token_hash_unique"

CRED_ORD = "  constraint evaluation_credit_ordinal       check (ordinal between 1 and public.evaluation_report_limit()),\n"
CRED_PKEY = "  constraint evaluation_credit_pkey          primary key (evaluation_id, ordinal),\n"
CRED_KEY = "  constraint evaluation_credit_key_unique    unique (evaluation_id, idempotency_key),\n"
CRED_REPORT_UNIQ = "  constraint evaluation_credit_report_unique unique (report_id)\n);"
CRED_REPORT_COL = "  report_id       uuid        not null references public.report_snapshot (report_id),\n"
CRED_EVAL_COL = "  evaluation_id   uuid        not null references public.evaluation (evaluation_id),\n"
CRED_TAIL = "  issued_at       timestamptz not null default now(),\n  constraint evaluation_credit_pkey"

EV_KIND = "  constraint evaluation_event_kind   check (kind in ('created', 'invite_minted', 'invite_redeemed', 'invite_revoked', 'completed', 'revoked')),\n"
EV_ROLE = "  constraint evaluation_event_role   check (role is null or role in ('owner', 'agent')),\n"
EV_INVITE = "  constraint evaluation_event_invite  check ((kind in ('invite_minted', 'invite_redeemed', 'invite_revoked')) = (invite_id is not null))\n);"
EV_TAIL = "  at            timestamptz not null default now(),\n  constraint evaluation_event_kind"

G_DELETE = "  if tg_op = 'DELETE' then\n    raise exception 'evaluation: an evaluation is never deleted (revoke it)' using errcode = '55000';\n  end if;\n"
G_IDENT = ("  if new.evaluation_id <> old.evaluation_id or new.brokerage_id <> old.brokerage_id or new.created_at <> old.created_at then\n"
           "    raise exception 'evaluation: identity columns cannot change' using errcode = '55000';\n  end if;\n")
G_REVOKED_TERM = "    if old.status = 'revoked' then\n      raise exception 'evaluation: a revoked evaluation is terminal' using errcode = '55000';\n    end if;\n"
G_COMPLETE_TERM = ("    if old.status = 'complete' and new.status <> 'revoked' then\n"
                   "      raise exception 'evaluation: a complete evaluation can only be revoked' using errcode = '55000';\n    end if;\n")
G_COMPLETE_FULL = ("    if new.status = 'complete'\n"
                   "       and (select count(*) from public.evaluation_credit c where c.evaluation_id = old.evaluation_id) < public.evaluation_report_limit() then\n"
                   "      raise exception 'evaluation: complete means every credit is used' using errcode = '55000';\n    end if;\n")
G_STAMP = "\n      new.revoked_at := now();"

IG_DELETE = "  if tg_op = 'DELETE' then\n    raise exception 'evaluation_invite: an invite is never deleted (revoke it)' using errcode = '55000';\n  end if;\n"
IG_IDENT = ("  if new.invite_id <> old.invite_id or new.evaluation_id <> old.evaluation_id or new.role <> old.role\n"
            "     or new.token_hash <> old.token_hash or new.created_at <> old.created_at or new.expires_at <> old.expires_at then\n"
            "    raise exception 'evaluation_invite: identity, role, token hash and lifetime cannot change' using errcode = '55000';\n  end if;\n")
IG_FK_ALLOW_HEAD = "    if old.status = 'redeemed' and new.status = 'redeemed' and old.redeemed_by is not null and new.redeemed_by is null\n"
IG_FK_ALLOW_TAIL = "       and new.redeemed_at is not distinct from old.redeemed_at and new.revoked_at is not distinct from old.revoked_at then\n"
IG_TERMINAL = "    raise exception 'evaluation_invite: a redeemed or revoked invite is terminal' using errcode = '55000';\n"
IG_EXPIRED = ("    if old.expires_at <= now() then\n"
              "      raise exception 'evaluation_invite: an expired invite cannot be redeemed' using errcode = '55000';\n    end if;\n")
IG_STAMP_REDEEM = "\n    new.redeemed_at := now();"
IG_STAMP_REVOKE = "  elsif new.status = 'revoked' then\n    new.revoked_at := now();\n"

CRED_AFTER_EVENT = "    if found then\n      insert into public.evaluation_event (evaluation_id, kind) values (new.evaluation_id, 'completed');\n    end if;\n"
CRED_AFTER_FLIP = "    update public.evaluation e set status = 'complete' where e.evaluation_id = new.evaluation_id and e.status = 'active';"
CRED_AFTER_IF = "  if new.ordinal = public.evaluation_report_limit() then"

T_EVAL = ("create or replace trigger evaluation_guard_trg\n  before update or delete on public.evaluation\n"
          "  for each row execute function public.evaluation_guard();")
T_INV = ("create or replace trigger evaluation_invite_guard_trg\n  before update or delete on public.evaluation_invite\n"
         "  for each row execute function public.evaluation_invite_guard();")
T_CRED_AO = ("create or replace trigger evaluation_credit_append_only\n  before update or delete on public.evaluation_credit\n"
             "  for each row execute function public.evaluation_append_only();")
T_CRED_TR = ("create or replace trigger evaluation_credit_no_truncate\n  before truncate on public.evaluation_credit\n"
             "  for each statement execute function public.evaluation_append_only();")
T_EV_AO = ("create or replace trigger evaluation_event_append_only\n  before update or delete on public.evaluation_event\n"
           "  for each row execute function public.evaluation_append_only();")
T_EV_TR = ("create or replace trigger evaluation_event_no_truncate\n  before truncate on public.evaluation_event\n"
           "  for each statement execute function public.evaluation_append_only();")
T_COMPLETE = ("create or replace trigger evaluation_credit_complete_trg\n  after insert on public.evaluation_credit\n"
              "  for each row execute function public.evaluation_credit_after_insert();")

# mint
M_ROLE = "  if p_role is null or p_role not in ('owner', 'agent') then\n    raise exception 'evaluation_invite_mint: the role must be owner or agent' using errcode = '22023';\n  end if;\n"
M_TTL = "  if p_ttl is null or p_ttl <= interval '0' or p_ttl > interval '90 days' then"
M_ENT = ("  if not found or ev.status = 'revoked' or (ev.expires_at is not null and ev.expires_at <= now())\n"
         "     or not exists (select 1 from public.brokerage_account a where a.id = ev.brokerage_id and a.status = 'active') then")
M_ACTOR = "    if not found or v_actor.brokerage_id <> ev.brokerage_id or v_actor.role <> 'owner' or p_role <> 'agent' then"
TOKEN_LINE = "  v_token := 'hse1_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');"
MINT_HASH = "values (ev.evaluation_id, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_exp)"
MINT_RETURN = "  return query select v_id, v_token, v_exp;"
MINT_EVENT = "  insert into public.evaluation_event (evaluation_id, kind, role, invite_id) values (ev.evaluation_id, 'invite_minted', p_role, v_id);\n"
MINT_LOCK = "  select e.* into ev from public.evaluation e where e.evaluation_id = p_evaluation_id for update;\n  if not found or ev.status = 'revoked'"

MINT_ISO = ("  if current_setting('transaction_isolation') <> 'read committed' then\n"
            "    raise exception 'evaluation_invite_mint: needs READ COMMITTED (the membership of the actor is re-read after a row lock that refreshes what the check sees only there; this transaction is at %)',\n"
            "      current_setting('transaction_isolation') using errcode = '55000';\n  end if;\n")
IREV_ISO = ("  if current_setting('transaction_isolation') <> 'read committed' then\n"
            "    raise exception 'evaluation_invite_revoke: needs READ COMMITTED (the membership of the actor is re-read after a row lock that refreshes what the check sees only there; this transaction is at %)',\n"
            "      current_setting('transaction_isolation') using errcode = '55000';\n  end if;\n")

# create
CR_MINT = "  select m.* into v_invite from public.evaluation_invite_mint(v_eval, 'owner', null, p_invite_ttl) m;"
CR_EVENT = "  insert into public.evaluation_event (evaluation_id, kind) values (v_eval, 'created');\n"

# redeem
R_HEAD = "language plpgsql security definer set search_path = public, pg_temp\nas $$\n#variable_conflict use_column\ndeclare\n  v_hash   text;"
R_ISO = ("  if current_setting('transaction_isolation') <> 'read committed' then\n"
         "    raise exception 'evaluation_invite_redeem: needs READ COMMITTED (the seat count and one-time use are serialised on a row lock that refreshes what the check sees only there; this transaction is at %)',\n"
         "      current_setting('transaction_isolation') using errcode = '55000';\n  end if;\n")
R_REGEX = "p_token !~ '^hse1_[0-9a-f]{64}$'"
R_HASH = "  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');"
R_EV_LOCK = "  select e.* into ev  from public.evaluation e        where e.evaluation_id = v_eval  for update;"
R_INV_LOCK = "  select i.* into inv from public.evaluation_invite i where i.token_hash = v_hash     for update;"
R_USER = "  if not exists (select 1 from auth.users u where u.id = p_user_id) then\n    raise exception using errcode = 'EV001', message = 'INVITE_UNUSABLE';\n  end if;\n"
R_USABLE = ("  v_usable := ev.status <> 'revoked' and (ev.expires_at is null or ev.expires_at > now())\n"
            "              and exists (select 1 from public.brokerage_account a where a.id = ev.brokerage_id and a.status = 'active');")
R_REPLAY_USER = "    if inv.redeemed_by is not distinct from p_user_id then"
R_REPLAY_FOUND = ("      if found then\n        return query select ev.evaluation_id, ev.brokerage_id, mem.role, true;\n"
                  "        return;\n      end if;\n")
R_NOT_OPEN = "  if inv.status <> 'open' or inv.expires_at <= now() then"
R_ALREADY = "  if exists (select 1 from public.brokerage_member m where m.user_id = p_user_id and m.status = 'active') then\n    raise exception using errcode = 'EV004', message = 'ALREADY_A_MEMBER';\n  end if;\n"
R_SEAT_IF = "  if inv.role = 'agent' and ev.seat_limit is not null then"
R_SEAT_COUNT = "     where m.brokerage_id = ev.brokerage_id and m.role = 'agent' and m.status = 'active';"
R_SEAT_CMP = "    if v_seats >= ev.seat_limit then"
R_MEMBER = "  insert into public.brokerage_member (brokerage_id, user_id, role) values (ev.brokerage_id, p_user_id, inv.role);"
R_UPDATE = "  update public.evaluation_invite i set status = 'redeemed', redeemed_by = p_user_id where i.invite_id = inv.invite_id;"
R_EVENT = "  insert into public.evaluation_event (evaluation_id, kind, role, invite_id) values (ev.evaluation_id, 'invite_redeemed', inv.role, inv.invite_id);\n"

# revoke
IR_ACTOR = "    if not found or v_actor.brokerage_id <> ev.brokerage_id or v_actor.role <> 'owner' then"
IR_NOT_OPEN = "  if inv.status <> 'open' then\n    return false;\n  end if;\n"
IR_EVENT = "  insert into public.evaluation_event (evaluation_id, kind, role, invite_id) values (ev.evaluation_id, 'invite_revoked', inv.role, inv.invite_id);\n"
ER_ALREADY = "  if ev.status = 'revoked' then\n    return false;\n  end if;\n"
ER_UPDATE = "  update public.evaluation e set status = 'revoked' where e.evaluation_id = ev.evaluation_id;"
ER_EVENT = "  insert into public.evaluation_event (evaluation_id, kind) values (ev.evaluation_id, 'revoked');\n"

# issue
I_HEAD = "language plpgsql security definer set search_path = public, pg_temp\nas $$\n#variable_conflict use_column\ndeclare\n  m       record;"
I_ISO = ("  if current_setting('transaction_isolation') <> 'read committed' then\n"
         "    raise exception 'evaluation_report_issue: needs READ COMMITTED (the retry and completion answers are serialised on a row lock that refreshes what the check sees only there; this transaction is at %)',\n"
         "      current_setting('transaction_isolation') using errcode = '55000';\n  end if;\n")
I_KEY = "  if p_idempotency_key is null then\n    raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED';\n  end if;\n"
I_LOCK = "  select e.* into ev from public.evaluation e where e.brokerage_id = m.brokerage_id for update;"
I_RECHECK = ("  select r.* into m from public.brokerage_membership_of(p_user_id) r where r.brokerage_id = ev.brokerage_id;\n"
             "  if not found or ev.status = 'revoked' or (ev.expires_at is not null and ev.expires_at <= now()) then")
I_REPLAY = ("  select c.ordinal, c.report_id into v_prior from public.evaluation_credit c\n"
            "   where c.evaluation_id = ev.evaluation_id and c.idempotency_key = p_idempotency_key;\n  if found then")
I_FULL = "  if ev.status <> 'active' or v_used >= public.evaluation_report_limit() then"
I_SNAP = "  select s.* into v_snap from public.report_snapshot_issue(p_body, p_content_hash, p_report_version, p_engine_inputs, p_private) s;"
I_STATE = "  select e.status into v_state from public.evaluation e where e.evaluation_id = ev.evaluation_id;"
I_REMAIN = "                      public.evaluation_report_limit() - (v_used + 1), v_state;"
I_REPLAY_RETURN = "             public.evaluation_report_limit() - v_used, ev.status\n        from public.report_snapshot s where s.report_id = v_prior.report_id;"

US_REMAIN = "u.n, public.evaluation_report_limit() - u.n,"

C_COMPLETE = ("  union all select 'complete_without_a_full_ledger', 'invariant', count(*) from public.evaluation e\n    where e.status = 'complete'\n"
              "      and (select count(*) from public.evaluation_credit c where c.evaluation_id = e.evaluation_id) <> public.evaluation_report_limit()\n")
C_ACTIVE = ("  union all select 'active_with_a_full_ledger', 'invariant', count(*) from public.evaluation e\n    where e.status = 'active'\n"
            "      and (select count(*) from public.evaluation_credit c where c.evaluation_id = e.evaluation_id) >= public.evaluation_report_limit()\n")
C_GAPS = ("  union all select 'ledger_with_gaps', 'invariant', count(*) from\n"
          "    (select c.evaluation_id from public.evaluation_credit c group by c.evaluation_id having max(c.ordinal) <> count(*)) g\n")
C_BEYOND = ("  union all select 'ledger_beyond_the_limit', 'invariant', count(*) from public.evaluation_credit c\n"
            "    where c.ordinal > public.evaluation_report_limit()\n")
C_CONTROL = "  select 'evaluations_total'::text, 'control'::text, count(*) from public.evaluation\n  union all select 'credits_total', 'control', count(*) from public.evaluation_credit\n"

# lock-down
LOCK_HEAD = "-- ---- 14. LOCK-DOWN: system-only"
RLS = {
    'evaluation': "alter table public.evaluation        enable row level security;",
    'invite': "alter table public.evaluation_invite enable row level security;",
    'credit': "alter table public.evaluation_credit enable row level security;",
    'event': "alter table public.evaluation_event  enable row level security;",
}
REVOKE = {
    'evaluation': "revoke all on public.evaluation        from public, anon, authenticated, service_role;",
    'invite': "revoke all on public.evaluation_invite from public, anon, authenticated, service_role;",
    'credit': "revoke all on public.evaluation_credit from public, anon, authenticated, service_role;",
    'event': "revoke all on public.evaluation_event  from public, anon, authenticated, service_role;",
}
TABLE_NAME = {'evaluation': 'evaluation', 'invite': 'evaluation_invite', 'credit': 'evaluation_credit', 'event': 'evaluation_event'}
SEQ_REVOKE = "    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s.sig);\n"
SEQ_FMT = "  for s in select format('%I.%I', n.nspname, c.relname) as sig"
SEQ_LIST = "t.relname in ('evaluation', 'evaluation_invite', 'evaluation_credit', 'evaluation_event') loop\n    execute format('revoke all on sequence"
LOOP_REVOKE = "    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);\n"
LOOP_GRANT = "    if not f.is_trigger then\n      execute format('grant execute on function %s to service_role', f.sig);\n    end if;\n"
LOOP_FMT = "  for f in select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as sig,"
LOOP_PREFIX = "where n.nspname = 'public' and p.proname like 'evaluation\\_%' loop"

POST_POLICY = ("    if exists (select 1 from pg_policy where polrelid = t::regclass) then\n"
               "      raise exception 'evaluation_entitlement: % has a policy; it must have none', t;\n    end if;\n")
POST_TABLE_ACL = ("    if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = t::regclass and a.grantee <> c.relowner) then\n"
                  "      raise exception 'evaluation_entitlement: % is accessible to a role other than its owner', t;\n    end if;\n")
POST_SEQ_ACL = ("    if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a where c.oid = s.oid and a.grantee <> c.relowner) then\n"
                "      raise exception 'evaluation_entitlement: the sequence % is accessible to a role other than its owner', s.relname;\n    end if;\n")
POST_SEQ_COUNT = ("  if v_seqs <> 1 then\n"
                  "    raise exception 'evaluation_entitlement: expected exactly one sequence behind the four tables (the event identity), found %', v_seqs;\n  end if;\n")
POST_FN_ACL = ("    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a\n"
               "                where p.oid = f.oid and a.grantee <> p.proowner\n"
               "                  and (f.is_trigger or v_sr is null or a.grantee <> v_sr or a.privilege_type <> 'EXECUTE')) then\n"
               "      raise exception 'evaluation_entitlement: the function % is executable by a role it should not be', f.proname;\n    end if;\n")

PRE_ROLLBACK = "\n-- ROLLBACK (this file only)."


def add_column(table_tail, column):
    return [(table_tail, "  " + column + ",\n" + table_tail, 1)]


def drop_trigger(anchor):
    return [(anchor, "select 1;", 1)]


MUTATIONS = {
    # ---- the cap is a CONSTRAINT: the number, the ordinal, the keys ------------------------------------------------------------
    'limit_is_21': [(LIMIT_FN, LIMIT_FN.replace('20', '21'), 1)],
    'limit_is_19': [(LIMIT_FN, LIMIT_FN.replace('20', '19'), 1)],
    'ordinal_check_allows_zero': [(CRED_ORD, CRED_ORD.replace('between 1 and', 'between 0 and'), 1)],
    'ordinal_check_unbounded': [(CRED_ORD, "  constraint evaluation_credit_ordinal       check (ordinal >= 1),\n", 1)],
    'ordinal_check_dropped': [(CRED_ORD, "", 1)],
    'ordinal_not_unique_per_evaluation': [(CRED_PKEY, "  constraint evaluation_credit_pkey          unique (evaluation_id, report_id),\n", 1)],
    'ordinal_unique_across_evaluations': [(CRED_PKEY, "  constraint evaluation_credit_pkey          primary key (ordinal),\n", 1)],
    'key_unique_dropped': [(CRED_KEY, "", 1)],
    'key_unique_global': [(CRED_KEY, "  constraint evaluation_credit_key_unique    unique (idempotency_key),\n", 1)],
    'report_unique_dropped': [(CRED_KEY + CRED_REPORT_UNIQ, CRED_KEY.rstrip(",\n") + "\n);", 1)],
    'credit_report_fk_dropped': [(CRED_REPORT_COL, "  report_id       uuid        not null,\n", 1)],
    'credit_report_nullable': [(CRED_REPORT_COL, "  report_id       uuid        references public.report_snapshot (report_id),\n", 1)],
    'credit_evaluation_fk_dropped': [(CRED_EVAL_COL, "  evaluation_id   uuid        not null,\n", 1)],
    'complete_trigger_removed': drop_trigger(T_COMPLETE),
    'complete_flips_one_early': [(CRED_AFTER_IF, CRED_AFTER_IF.replace("evaluation_report_limit()", "evaluation_report_limit() - 1"), 1)],
    'complete_writes_no_event': [(CRED_AFTER_EVENT, "", 1)],
    'complete_flip_wrong_status': [(CRED_AFTER_FLIP, CRED_AFTER_FLIP.replace("'complete'", "'revoked'", 1), 1)],
    'append_only_credit_trigger_removed': drop_trigger(T_CRED_AO),
    'credit_truncate_allowed': drop_trigger(T_CRED_TR),
    'append_only_event_trigger_removed': drop_trigger(T_EV_AO),
    'event_truncate_allowed': drop_trigger(T_EV_TR),
    # ---- the evaluation: a state machine, never deleted -----------------------------------------------------------------------
    'evaluation_guard_trigger_removed': drop_trigger(T_EVAL),
    'evaluation_deletable': [(G_DELETE, "", 1)],
    'evaluation_identity_changeable': [(G_IDENT, "", 1)],
    'evaluation_revoked_not_terminal': [(G_REVOKED_TERM, "", 1)],
    'evaluation_complete_not_terminal': [(G_COMPLETE_TERM, "", 1)],
    'evaluation_complete_without_a_full_ledger': [(G_COMPLETE_FULL, "", 1)],
    'evaluation_revoked_time_from_caller': [(G_STAMP, "\n      null;", 1)],
    'evaluation_one_per_brokerage_dropped': [(EVAL_ONE, "", 1)],
    'evaluation_status_vocab_widened': [(EVAL_STATUS, EVAL_STATUS.replace("'revoked')", "'revoked', 'paid')"), 1)],
    'evaluation_seat_check_dropped': [(EVAL_SEAT, "", 1)],
    'evaluation_revoked_coupling_dropped': [(EVAL_REVOKED, "", 1)],
    'evaluation_expiry_check_dropped': [(EVAL_REVOKED + EVAL_EXPIRY, EVAL_REVOKED.rstrip(",\n") + "\n);", 1)],
    'evaluation_brokerage_fk_dropped': [(EVAL_FK, "brokerage_id  uuid        not null,", 1)],
    # ---- the invite: one-time, hashed, terminal ------------------------------------------------------------------------------
    'invite_guard_trigger_removed': drop_trigger(T_INV),
    'invite_deletable': [(IG_DELETE, "", 1)],
    'invite_identity_changeable': [(IG_IDENT, "", 1)],
    'invite_terminal_not_enforced': [(IG_TERMINAL, "    return new;\n", 1)],
    'invite_fk_clear_refused': [(IG_FK_ALLOW_HEAD, "    if false\n", 1)],
    'invite_fk_clear_allows_other_changes': [(IG_FK_ALLOW_TAIL, "       then\n", 1)],
    'invite_expired_redeemable': [(IG_EXPIRED, "", 1)],
    'invite_redeemed_time_from_caller': [(IG_STAMP_REDEEM, "\n    null;", 1)],
    'invite_revoked_time_from_caller': [(IG_STAMP_REVOKE, "  elsif new.status = 'revoked' then\n    null;\n", 1)],
    'invite_state_check_dropped': [(INV_STATE, "", 1)],
    'invite_lifetime_check_dropped': [(INV_STATE + INV_LIFETIME, INV_STATE.rstrip(",\n") + "\n);", 1)],
    'invite_lifetime_unbounded': [(INV_LIFETIME, "  constraint evaluation_invite_lifetime          check (expires_at > created_at)\n);", 1)],
    'invite_role_check_dropped': [(INV_ROLE, "", 1)],
    'invite_hash_unique_dropped': [(INV_HASH_UNIQ, "", 1)],
    'invite_hash_shape_dropped': [(INV_HASH_SHAPE, "", 1)],
    'invite_user_fk_cascades': [(INV_FK_USER, "references auth.users (id) on delete cascade,", 1)],
    'invite_user_fk_blocks_deletion': [(INV_FK_USER, "references auth.users (id),", 1)],
    'invite_evaluation_fk_dropped': [(INV_FK_EVAL, INV_FK_EVAL.replace(" references public.evaluation (evaluation_id)", ""), 1)],
    # ---- the event log's vocabulary and its coupling -------------------------------------------------------------------------------
    'event_kind_vocab_widened': [(EV_KIND, EV_KIND.replace("'revoked')", "'revoked', 'viewed')"), 1)],
    'event_kind_check_dropped': [(EV_KIND, "", 1)],
    'event_role_check_dropped': [(EV_ROLE + EV_INVITE, EV_INVITE, 1)],
    'event_invite_coupling_dropped': [(EV_ROLE + EV_INVITE, EV_ROLE.rstrip(",\n") + "\n);", 1)],
    # ---- what the tables must never hold ---------------------------------------------------------------------------------------
    'evaluation_has_used_counter': add_column(EVAL_TAIL, "credits_used integer not null default 0"),
    'evaluation_has_address_column': add_column(EVAL_TAIL, "address text"),
    'evaluation_has_client_column': add_column(EVAL_TAIL, "client_name text"),
    'evaluation_has_owner_email_column': add_column(EVAL_TAIL, "owner_email text"),
    'evaluation_has_price_column': add_column(EVAL_TAIL, "price_cents integer"),
    'invite_has_email_column': add_column(INV_TAIL, "email text"),
    'invite_has_label_column': add_column(INV_TAIL, "label text"),
    'invite_stores_the_token': add_column(INV_TAIL, "token text"),
    'credit_has_address_hash_column': add_column(CRED_TAIL, "address_hash text"),
    'credit_has_property_key_column': add_column(CRED_TAIL, "property_key text"),
    'credit_has_user_column': add_column(CRED_TAIL, "issued_by uuid"),
    'credit_has_used_counter': add_column(CRED_TAIL, "used integer"),
    'credit_has_coordinates_column': add_column(CRED_TAIL, "lat double precision"),
    'event_has_free_text_column': add_column(EV_TAIL, "note text"),
    'event_has_detail_column': add_column(EV_TAIL, "detail jsonb"),
    'event_has_ip_column': add_column(EV_TAIL, "ip inet"),
    'event_has_actor_column': add_column(EV_TAIL, "actor uuid"),
    'event_has_address_column': add_column(EV_TAIL, "address text"),
    # ---- the token: hashed, long, random, shown once ---------------------------------------------------------------------------------
    'token_hash_is_md5': [(R_HASH, "  v_hash := md5(p_token) || md5(p_token);", 1),
                          (MINT_HASH, "values (ev.evaluation_id, p_role, md5(v_token) || md5(v_token), v_exp)", 1)],
    'token_stored_raw': [(INV_HASH_SHAPE, "", 1), (R_HASH, "  v_hash := p_token;", 1),
                         (MINT_HASH, "values (ev.evaluation_id, p_role, v_token, v_exp)", 1)],
    'token_one_uuid_long': [(TOKEN_LINE, "  v_token := 'hse1_' || replace(gen_random_uuid()::text, '-', '');", 1),
                            (R_REGEX, "p_token !~ '^hse1_[0-9a-f]{32}$'", 1)],
    'token_not_random': [(TOKEN_LINE, "  v_token := 'hse1_' || repeat('a', 64);", 1)],
    'mint_returns_the_hash': [(MINT_RETURN, "  return query select v_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_exp;", 1)],
    'mint_writes_no_event': [(MINT_EVENT, "", 1)],
    'mint_isolation_check_removed': [(MINT_ISO, "", 1)],
    'mint_isolation_check_refuses_everything': [(MINT_ISO, MINT_ISO.replace("<> 'read committed'", "is not null"), 1)],
    'revoke_isolation_check_removed': [(IREV_ISO, "", 1)],
    'revoke_isolation_check_refuses_everything': [(IREV_ISO, IREV_ISO.replace("<> 'read committed'", "is not null"), 1)],
    # ---- redeem: one-time, bound to a user, every K0 invariant ---------------------------------------------------------------------
    'redeem_isolation_check_removed': [(R_ISO, "", 1)],
    'redeem_isolation_check_refuses_everything': [(R_ISO, R_ISO.replace("<> 'read committed'", "is not null"), 1)],
    'redeem_replay_not_idempotent': [(R_REPLAY_USER, "    if false then", 1)],
    'redeem_replay_for_any_user': [(R_REPLAY_USER, "    if true then", 1)],
    'redeem_replay_without_a_membership': [(R_REPLAY_FOUND, "      if true then\n        return query select ev.evaluation_id, ev.brokerage_id, coalesce(mem.role, inv.role), true;\n        return;\n      end if;\n", 1)],
    'redeem_does_not_bind_the_user': [(R_UPDATE, "  update public.evaluation_invite i set status = 'redeemed' where i.invite_id = inv.invite_id;", 1)],
    'redeem_ignores_expiry': [(R_NOT_OPEN, "  if inv.status <> 'open' then", 1)],
    'redeem_ignores_invite_status': [(R_NOT_OPEN, "  if inv.expires_at <= now() then", 1)],
    'redeem_ignores_a_revoked_evaluation': [(R_USABLE, R_USABLE.replace("ev.status <> 'revoked' and ", "", 1), 1)],
    'redeem_ignores_evaluation_expiry': [(R_USABLE, "  v_usable := ev.status <> 'revoked'\n              and exists (select 1 from public.brokerage_account a where a.id = ev.brokerage_id and a.status = 'active');", 1)],
    'redeem_ignores_brokerage_status': [(R_USABLE, "  v_usable := ev.status <> 'revoked' and (ev.expires_at is null or ev.expires_at > now());", 1)],
    'redeem_skips_the_one_membership_check': [(R_ALREADY, "", 1)],
    'redeem_skips_the_seat_limit': [(R_SEAT_IF, "  if false then", 1)],
    'redeem_seat_off_by_one': [(R_SEAT_CMP, "    if v_seats > ev.seat_limit then", 1)],
    'redeem_seat_count_includes_owners': [(R_SEAT_COUNT, "     where m.brokerage_id = ev.brokerage_id and m.status = 'active';", 1)],
    'redeem_seat_count_includes_removed_agents': [(R_SEAT_COUNT, "     where m.brokerage_id = ev.brokerage_id and m.role = 'agent';", 1)],
    'redeem_seat_limit_binds_owners': [(R_SEAT_IF, "  if ev.seat_limit is not null then", 1)],
    'redeem_unknown_user_not_refused': [(R_USER, "", 1)],
    'redeem_role_always_agent': [(R_MEMBER, R_MEMBER.replace("inv.role)", "'agent')"), 1)],
    'redeem_writes_no_event': [(R_EVENT, "", 1)],
    'redeem_without_the_evaluation_lock': [(R_EV_LOCK, R_EV_LOCK.replace("  for update;", ";"), 1)],
    'redeem_without_any_lock': [(R_EV_LOCK, R_EV_LOCK.replace("  for update;", ";"), 1), (R_INV_LOCK, R_INV_LOCK.replace("     for update;", ";"), 1)],
    'redeem_distinct_message_for_an_expired_token': [(R_NOT_OPEN + "\n    raise exception using errcode = 'EV001', message = 'INVITE_UNUSABLE';",
                                                      R_NOT_OPEN + "\n    raise exception using errcode = 'EV001', message = 'INVITE_EXPIRED';", 1)],
    'redeem_message_reveals_a_redeemed_token': [(R_REPLAY_FOUND + "    end if;\n    raise exception using errcode = 'EV001', message = 'INVITE_UNUSABLE';",
                                                 R_REPLAY_FOUND + "    end if;\n    raise exception using errcode = 'EV001', message = 'INVITE_ALREADY_REDEEMED';", 1)],
    'redeem_security_invoker': [(R_HEAD, R_HEAD.replace(" security definer", ""), 1)],
    'redeem_search_path_unpinned': [(R_HEAD, R_HEAD.replace(" set search_path = public, pg_temp", ""), 1)],
    # ---- mint and revoke: who may ---------------------------------------------------------------------------------------------------
    'mint_actor_unchecked': [(M_ACTOR, "    if false then", 1)],
    'mint_foreign_actor_allowed': [(M_ACTOR, M_ACTOR.replace("v_actor.brokerage_id <> ev.brokerage_id or ", ""), 1)],
    'mint_agent_may_mint': [(M_ACTOR, M_ACTOR.replace("v_actor.role <> 'owner' or ", ""), 1)],
    'mint_owner_may_mint_owner': [(M_ACTOR, M_ACTOR.replace(" or p_role <> 'agent'", ""), 1)],
    'mint_ignores_a_revoked_evaluation': [(M_ENT, M_ENT.replace("ev.status = 'revoked' or ", ""), 1)],
    'mint_ignores_evaluation_expiry': [(M_ENT, M_ENT.replace(" or (ev.expires_at is not null and ev.expires_at <= now())", ""), 1)],
    'mint_ignores_brokerage_status': [(M_ENT, "  if not found or ev.status = 'revoked' or (ev.expires_at is not null and ev.expires_at <= now()) then", 1)],
    'mint_lifetime_unbounded': [(M_TTL, M_TTL.replace(" or p_ttl > interval '90 days'", ""), 1)],
    'mint_lifetime_may_be_zero': [(M_TTL, M_TTL.replace(" or p_ttl <= interval '0'", ""), 1)],
    'mint_role_unchecked': [(M_ROLE, "", 1)],
    'mint_without_the_evaluation_lock': [(MINT_LOCK, MINT_LOCK.replace(" for update;", ";"), 1)],
    'create_mints_an_agent_invite': [(CR_MINT, CR_MINT.replace("'owner'", "'agent'"), 1)],
    'create_writes_no_event': [(CR_EVENT, "", 1)],
    'invite_revoke_always_true': [(IR_NOT_OPEN, IR_NOT_OPEN.replace("return false", "return true"), 1)],
    'invite_revoke_actor_unchecked': [(IR_ACTOR, "    if false then", 1)],
    'invite_revoke_foreign_owner_allowed': [(IR_ACTOR, IR_ACTOR.replace("v_actor.brokerage_id <> ev.brokerage_id or ", ""), 1)],
    'invite_revoke_agent_allowed': [(IR_ACTOR, IR_ACTOR.replace(" or v_actor.role <> 'owner'", ""), 1)],
    'invite_revoke_writes_no_event': [(IR_EVENT, "", 1)],
    'evaluation_revoke_does_nothing': [(ER_UPDATE, "  null;", 1)],
    'evaluation_revoke_not_idempotent': [(ER_ALREADY, "", 1)],
    'evaluation_revoke_writes_no_event': [(ER_EVENT, "", 1)],
    # ---- the credit: the one writer -------------------------------------------------------------------------------------------------
    'issue_isolation_check_removed': [(I_ISO, "", 1)],
    'issue_isolation_check_refuses_everything': [(I_ISO, I_ISO.replace("<> 'read committed'", "is not null"), 1)],
    'issue_without_the_evaluation_lock': [(I_LOCK, I_LOCK.replace(" for update;", ";"), 1)],
    'issue_not_rechecked_after_the_lock': [(I_RECHECK, "  if ev.status = 'revoked' or (ev.expires_at is not null and ev.expires_at <= now()) then", 1)],
    'issue_replay_lookup_removed': [(I_REPLAY, "  select 1 into v_prior from public.evaluation_credit c where false;\n  if found then", 1)],
    'issue_replay_ignores_the_key': [(I_REPLAY, I_REPLAY.replace(" and c.idempotency_key = p_idempotency_key", ""), 1)],
    'issue_replay_key_is_global': [(I_REPLAY, I_REPLAY.replace("c.evaluation_id = ev.evaluation_id and ", ""), 1)],
    'issue_replay_remaining_wrong': [(I_REPLAY_RETURN, I_REPLAY_RETURN.replace("public.evaluation_report_limit() - v_used", "public.evaluation_report_limit() - v_used - 1"), 1)],
    'issue_ignores_a_revoked_evaluation': [(I_RECHECK, I_RECHECK.replace("ev.status = 'revoked' or ", ""), 1)],
    'issue_ignores_evaluation_expiry': [(I_RECHECK, I_RECHECK.replace(" or (ev.expires_at is not null and ev.expires_at <= now())", ""), 1)],
    'issue_ignores_the_ledger_count': [(I_FULL, "  if ev.status <> 'active' then", 1)],
    'issue_ignores_the_status': [(I_FULL, "  if v_used >= public.evaluation_report_limit() then", 1)],
    'issue_null_key_allowed': [(I_KEY, "", 1)],
    'issue_swallows_a_snapshot_refusal': [(I_SNAP, "  begin\n    " + I_SNAP.strip() + "\n  exception when others then\n"
                                           "    select null::uuid as report_id, null::timestamptz as generated_at, null::uuid as private_context_id into v_snap;\n  end;", 1),
                                          (CRED_REPORT_COL, "  report_id       uuid,\n", 1)],
    'issue_remaining_wrong': [(I_REMAIN, I_REMAIN.replace("(v_used + 1)", "v_used"), 1)],
    'issue_returns_a_stale_status': [(I_STATE, "  v_state := ev.status;", 1)],
    'issue_security_invoker': [(I_HEAD, I_HEAD.replace(" security definer", ""), 1)],
    'issue_search_path_unpinned': [(I_HEAD, I_HEAD.replace(" set search_path = public, pg_temp", ""), 1)],
    'usage_remaining_wrong': [(US_REMAIN, "u.n, public.evaluation_report_limit(),", 1)],
    # ---- the audit: every invariant, beside a control ----------------------------------------------------------------------------------
    'check_drops_complete_without_a_full_ledger': [(C_COMPLETE, "", 1)],
    'check_drops_active_with_a_full_ledger': [(C_ACTIVE, "", 1)],
    'check_drops_ledger_with_gaps': [(C_GAPS, "", 1)],
    'check_drops_ledger_beyond_the_limit': [(C_BEYOND, "", 1)],
    'check_drops_the_controls': [(C_CONTROL, "  select 'evaluations_total'::text, 'control'::text, 1::bigint\n", 1)],
    # ---- the lock-down ------------------------------------------------------------------------------------------------------------------
    'no_rls_on_evaluation': lockdown((RLS['evaluation'], "select 1;", 1)),
    'no_rls_on_invite': lockdown((RLS['invite'], "select 1;", 1)),
    'no_rls_on_credit': lockdown((RLS['credit'], "select 1;", 1)),
    'no_rls_on_event': lockdown((RLS['event'], "select 1;", 1)),
    'evaluation_default_grants': lockdown((REVOKE['evaluation'], "select 1;", 1)),
    'invite_default_grants': lockdown((REVOKE['invite'], "select 1;", 1)),
    'credit_default_grants': lockdown((REVOKE['credit'], "select 1;", 1)),
    'event_default_grants': lockdown((REVOKE['event'], "select 1;", 1)),
    'authenticated_can_read_invite': lockdown((REVOKE['invite'], REVOKE['invite'] + "\ngrant select on public.evaluation_invite to authenticated;", 1)),
    'anon_can_read_credit': lockdown((REVOKE['credit'], REVOKE['credit'] + "\ngrant select on public.evaluation_credit to anon;", 1)),
    'service_role_can_read_event': lockdown((REVOKE['event'], REVOKE['event'] + "\ngrant select on public.evaluation_event to service_role;", 1)),
    'service_role_can_write_the_ledger': lockdown((REVOKE['credit'], REVOKE['credit'] + "\ngrant insert on public.evaluation_credit to service_role;", 1)),
    'service_role_can_update_evaluation': lockdown((REVOKE['evaluation'], REVOKE['evaluation'] + "\ngrant update on public.evaluation to service_role;", 1)),
    'public_can_read_evaluation': lockdown((REVOKE['evaluation'], REVOKE['evaluation'] + "\ngrant select on public.evaluation to public;", 1)),
    'policy_for_authenticated_on_credit': lockdown((RLS['credit'], RLS['credit'] + "\ncreate policy evaluation_credit_read on public.evaluation_credit for select to authenticated using (true);", 1)),
    'sequence_loop_removed': lockdown(drop_seq_loop),
    'sequence_revoke_skips_service_role': lockdown((SEQ_REVOKE, SEQ_REVOKE.replace("authenticated, service_role", "authenticated"), 1)),
    'sequence_revoke_skips_anon': lockdown((SEQ_REVOKE, SEQ_REVOKE.replace("public, anon, authenticated, service_role", "public, authenticated, service_role"), 1)),
    'sequence_loop_misses_the_sequence': lockdown((SEQ_LIST, SEQ_LIST.replace(", 'evaluation_event')", ")"), 1)),
    'functions_unlocked': lockdown((LOOP_REVOKE, "    execute 'select 1';\n", 1)),
    'function_revoke_skips_public': lockdown((LOOP_REVOKE, LOOP_REVOKE.replace("from public, anon, authenticated, service_role", "from anon, authenticated, service_role"), 1)),
    'function_revoke_skips_anon': lockdown((LOOP_REVOKE, LOOP_REVOKE.replace("public, anon, authenticated, service_role", "public, authenticated, service_role"), 1)),
    'functions_granted_to_authenticated': lockdown((LOOP_GRANT, LOOP_GRANT.replace("to service_role'", "to service_role, authenticated'"), 1)),
    'functions_granted_to_anon': lockdown((LOOP_GRANT, LOOP_GRANT.replace("to service_role'", "to service_role, anon'"), 1)),
    'trigger_function_granted_to_service_role': lockdown((LOOP_GRANT, "    execute format('grant execute on function %s to service_role', f.sig);\n", 1)),
    'lock_loop_removed': lockdown((LOOP_REVOKE, "", 1), (LOOP_GRANT, "", 1)),
    'lock_loop_prefix_too_narrow': lockdown((LOOP_PREFIX, LOOP_PREFIX.replace("evaluation\\_%", "evaluation\\_invite%"), 1)),
    # ---- the post-condition: it stops a poisoned apply (the poisoned-apply check owns these) -------------------------------------------
    'post_condition_removed': [strip_post],
    'post_condition_ignores_a_policy': [(POST_POLICY, "", 1)],
    'post_condition_reads_only_typed_roles_on_tables': [(POST_TABLE_ACL, "", 1)],
    'post_condition_ignores_the_sequence_acl': [(POST_SEQ_ACL, "", 1)],
    'post_condition_ignores_a_second_sequence': [(POST_SEQ_COUNT, "", 1)],
    'post_condition_ignores_function_grants': [(POST_FN_ACL, "", 1)],
    # ---- additive, empty, and complete ---------------------------------------------------------------------------------------------------
    'file_seeds_a_row': [(LOCK_HEAD, "insert into public.brokerage_account (name) values ('Seed Realty');\n\n" + LOCK_HEAD, 1)],
    'file_seeds_an_evaluation': [(LOCK_HEAD, "with b as (insert into public.brokerage_account (name) values ('Seed Realty') returning id)\n  insert into public.evaluation (brokerage_id) select id from b;\n\n" + LOCK_HEAD, 1)],
    'second_table_added': [(LOCK_HEAD, "create table if not exists public.evaluation_seat (seat_id uuid primary key default gen_random_uuid());\n\n" + LOCK_HEAD, 1)],
    'extra_function_added': [(LOCK_HEAD, "create or replace function public.evaluation_credits_used() returns integer language sql as $$ select 1 $$;\n\n" + LOCK_HEAD, 1)],
}

# Edits the DATABASE cannot tell from the shipped file, or that cannot apply to it: only the structural test can see them.
STRUCT_ONLY = {
    'token_predictable_from_the_clock': [(TOKEN_LINE, "  v_token := 'hse1_' || md5(clock_timestamp()::text) || md5(clock_timestamp()::text);", 1)],
    'lock_loop_unqualified': [(LOOP_FMT, "  for f in select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as sig,", 1)],
    'sequence_loop_unqualified': [(SEQ_FMT, "  for s in select format('%I', c.relname) as sig", 1)],
    'limit_number_written_twice': [(CRED_ORD, CRED_ORD.replace("public.evaluation_report_limit()", "20"), 1)],
    'file_names_subscriptions': [(PRE_ROLLBACK, "\nselect 1 from public.subscriptions;" + PRE_ROLLBACK, 1)],
    'file_updates_a_membership': [(PRE_ROLLBACK, "\nupdate public.brokerage_member set role = role;" + PRE_ROLLBACK, 1)],
    'file_deletes_a_membership': [(PRE_ROLLBACK, "\ndelete from public.brokerage_member where false;" + PRE_ROLLBACK, 1)],
    'file_names_the_private_table': [(PRE_ROLLBACK, "\nselect 1 from public.report_private_context;" + PRE_ROLLBACK, 1)],
    'file_names_a_resident_table': [(PRE_ROLLBACK, "\nselect 1 from public.app_follows;" + PRE_ROLLBACK, 1)],
    'file_arms_a_schedule': [(PRE_ROLLBACK, "\nselect cron.schedule('x', '* * * * *', 'select 1');" + PRE_ROLLBACK, 1)],
    'file_makes_a_network_call': [(PRE_ROLLBACK, "\nselect net.http_post('https://example.test');" + PRE_ROLLBACK, 1)],
    'file_grants_to_anon': [(PRE_ROLLBACK, "\ngrant select on public.evaluation to anon;" + PRE_ROLLBACK, 1)],
    'file_grants_a_function_to_authenticated': [(PRE_ROLLBACK, "\ngrant execute on function public.evaluation_usage(uuid) to authenticated;" + PRE_ROLLBACK, 1)],
    'file_drops_a_table': [(PRE_ROLLBACK, "\ndrop table public.evaluation_event;" + PRE_ROLLBACK, 1)],
    'file_deletes_a_ledger_row': [(PRE_ROLLBACK, "\ndelete from public.evaluation_credit where false;" + PRE_ROLLBACK, 1)],
    'file_issue_calls_the_snapshot_twice': [(I_SNAP, I_SNAP + "\n  " + I_SNAP.strip(), 1)],
    'file_matches_an_email': [(PRE_ROLLBACK, "\nselect 1 from auth.users where email like '%@%';" + PRE_ROLLBACK, 1)],
    'file_hardcodes_a_limit_in_the_issue': [(I_FULL, "  if ev.status <> 'active' or v_used >= 20 then", 1)],
    'file_issue_uses_md5': [(I_SNAP, I_SNAP + "\n  perform md5(p_body);", 1)],
}

# Mutations the structural pins cannot see (their effect is only in what the database does); the offline mode skips and names them.
# Every name here is run by run.sh, which kills it in the database (the last full run: 188 killed, 0 survived, 0 harness faults); each was
# measured against the structural test, which does not see it: a wrong branch, a missing event, a dropped CHECK a vocabulary pin does not list.
PG_ONLY = {
    'complete_flips_one_early', 'evaluation_seat_check_dropped', 'evaluation_revoked_coupling_dropped',
    'evaluation_expiry_check_dropped', 'invite_fk_clear_allows_other_changes', 'invite_revoked_time_from_caller',
    'invite_lifetime_check_dropped', 'invite_lifetime_unbounded', 'invite_hash_unique_dropped', 'event_invite_coupling_dropped',
    'mint_returns_the_hash', 'mint_writes_no_event', 'redeem_replay_not_idempotent', 'redeem_replay_for_any_user',
    'redeem_replay_without_a_membership', 'redeem_does_not_bind_the_user', 'redeem_ignores_expiry',
    'redeem_ignores_invite_status', 'redeem_ignores_a_revoked_evaluation', 'redeem_ignores_evaluation_expiry',
    'redeem_ignores_brokerage_status', 'redeem_skips_the_seat_limit', 'redeem_seat_off_by_one',
    'redeem_seat_limit_binds_owners', 'redeem_writes_no_event', 'mint_ignores_a_revoked_evaluation',
    'mint_ignores_evaluation_expiry', 'mint_ignores_brokerage_status', 'mint_lifetime_unbounded', 'mint_lifetime_may_be_zero',
    'mint_role_unchecked', 'mint_without_the_evaluation_lock', 'invite_revoke_always_true', 'invite_revoke_writes_no_event',
    'evaluation_revoke_does_nothing', 'evaluation_revoke_not_idempotent', 'evaluation_revoke_writes_no_event',
    'issue_replay_key_is_global', 'issue_replay_remaining_wrong', 'issue_ignores_the_ledger_count', 'issue_ignores_the_status',
    'issue_null_key_allowed', 'issue_remaining_wrong', 'issue_returns_a_stale_status', 'usage_remaining_wrong',
    'check_drops_complete_without_a_full_ledger', 'check_drops_active_with_a_full_ledger', 'check_drops_ledger_with_gaps',
    'check_drops_ledger_beyond_the_limit', 'check_drops_the_controls',
}

# The mutations whose executable check is the poisoned-apply check, not the suite (the post-condition is invisible to a suite that
# runs against a state the apply already left good).
POISON = {
    'post_condition_removed', 'post_condition_ignores_a_policy', 'post_condition_reads_only_typed_roles_on_tables',
    'post_condition_ignores_the_sequence_acl', 'post_condition_ignores_a_second_sequence', 'post_condition_ignores_function_grants',
}
# ... and the ones only two or more sessions at once can see.
RACE = {
    'redeem_without_the_evaluation_lock', 'redeem_without_any_lock', 'issue_without_the_evaluation_lock',
    'issue_not_rechecked_after_the_lock', 'mint_without_the_evaluation_lock',
}


def _rep(text, old, new, count, name):
    if text.count(old) != count:
        raise ValueError('anchor for %s matched %d time(s), expected %d' % (name, text.count(old), count))
    if old == new:
        raise ValueError('mutation %s changes nothing' % name)
    return text.replace(old, new)


def ops_of(name):
    return MUTATIONS[name] if name in MUTATIONS else STRUCT_ONLY[name]


def mutate_sql(name, text):
    out = text
    for op in ops_of(name):
        out = op(out) if callable(op) else _rep(out, op[0], op[1], op[2], name)
    if out == text:
        raise ValueError('mutation %s changes nothing' % name)
    return out


# ---- the files around the SQL ------------------------------------------------------------------------------------------------
GATE = 'supabase/functions/_shared/admin-gate.ts'
REST = 'supabase/functions/_shared/service-rest.ts'
SNAPMOD = 'supabase/functions/_shared/report-snapshot.ts'
HAN = 'supabase/functions/follow-development-report/handler.ts'
HAN2 = 'supabase/functions/get-development-activity-report/handler.ts'
LIBF = 'lib/impact.js'
STATUS = 'docs/development-activity-status-2026-09-30.md'
CONTRACT = 'docs/report-snapshot-contract-2026-09-30.md'
WF = '.github/workflows/brokerage-account-suite.yml'
DOC = 'docs/development-activity-evaluation-2026-10-02.md'
K0DOC = 'docs/development-activity-agent-workspace-2026-10-01.md'
RUN = 'test/evaluation_entitlement_pg/run.sh'
SUITE = 'test/evaluation_entitlement_pg/suite.sql'
FIXTURE = 'test/evaluation_entitlement_pg/fixture.sql'
FPRINT = 'test/evaluation_entitlement_pg/fingerprint.sql'
THIS = 'test/evaluation_entitlement_mutants.py'

# (file, old, new[, count]): old '' means "append new at the end of the file". The anchor must match exactly `count` times
# (default 1; None = every occurrence, at least one).
FILE_MUTATIONS = {
    'admin_gate_names_the_evaluation': (GATE, '', "\nconst _e = 'evaluation_report_issue';\n"),
    'admin_gate_mentions_a_brokerage': (GATE, '', "\nconst _tenant = 'brokerage';\n"),
    'handler_names_the_issue_function': (HAN, '', "\nconst _t = 'evaluation_report_issue';\n"),
    'second_handler_names_the_ledger': (HAN2, '', "\nconst _t = 'evaluation_credit';\n"),
    'second_handler_stores_reports': (HAN2, "stores_reports: false", "stores_reports: true"),
    'second_handler_imports_the_snapshot_module': (HAN2, '', "\nimport { issueSnapshot } from '../_shared/report-snapshot.ts';\n"),
    'lib_file_names_the_invite_table': (LIBF, '', "\nconst _t = 'evaluation_invite';\n"),
    'snapshot_module_names_the_evaluation': (SNAPMOD, '', "\nconst _e = 'evaluation_credit';\n"),
    'service_rest_stops_reading_the_allow_list': (REST, "dashboard_admins?select=email&limit=1&email=eq.", "dashboard_admins_v2?select=email&limit=1&email=eq."),
    'gate_stops_asking_is_admin': (GATE, "deps.isAdmin(user.email)", "true"),
    'sql_names_the_subscriptions_table': (SQL, "\n-- ROLLBACK (this file only).", "\nselect 1 from public.subscriptions;\n-- ROLLBACK (this file only)."),
    'sql_points_at_another_account_table': (SQL, "references public.brokerage_account (id),", "references public.communities (id),"),
    'sql_arms_a_schedule': (SQL, "\n-- ROLLBACK (this file only).", "\nselect cron.schedule('x', '* * * * *', 'select 1');\n-- ROLLBACK (this file only)."),
    'sql_rollback_removed': (SQL, "-- ROLLBACK (this file only).", "-- NOTE (this file only)."),
    'sql_rollback_loses_a_table': (SQL, "--   drop table if exists public.evaluation_event, public.evaluation_credit, public.evaluation_invite, public.evaluation;\n", ""),
    'sql_says_applied': (SQL, "SQL OF RECORD. PARKED: NOT APPLIED to production.", "SQL OF RECORD."),
    'sql_names_an_invite_email_in_code': (SQL, "-- ---- 14. LOCK-DOWN", "alter table public.evaluation_invite add column invite_email text;\n-- ---- 14. LOCK-DOWN"),
    'status_strikes_order_l': (STATUS, "- L. Evaluation build and security tests — open", "- ~~L. Evaluation build and security tests~~ — done"),
    'status_strikes_master_step_11': (STATUS, "11. Autonomous 20-report brokerage evaluation — **open.**", "11. ~~Autonomous 20-report brokerage evaluation~~ — **done.**"),
    'status_drops_the_l_entry': (STATUS, "database layer built, not applied, not wired", "database layer built"),
    'doc_drops_the_decision_owner': (DOC, "Decision owner", "Owner"),
    'doc_drops_the_unverified_marker': (DOC, "UNVERIFIED", "checked", None),
    'doc_drops_the_open_decisions': (DOC, "Open founder decisions", "Notes"),
    'k0_doc_loses_the_writer_note': (K0DOC, "Order L1 is now the first writer", "Nothing writes"),
    'contract_loses_the_ownership_pointer': (CONTRACT, "ownership lives in the credit ledger", "ownership lives elsewhere"),
    'workflow_holds_a_secret': (WF, "permissions:\n  contents: read", "permissions:\n  contents: read\nenv:\n  SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}"),
    'workflow_not_triggered_by_the_sql': (WF, "      - 'docs/evaluation-entitlement.sql'\n", "", None),
    'workflow_gains_a_schedule': (WF, "  workflow_dispatch: {}", "  workflow_dispatch: {}\n  schedule:\n    - cron: '0 5 * * *'"),
    'workflow_drops_the_evaluation_job': (WF, "bash test/evaluation_entitlement_pg/run.sh", "echo skipped"),
    'harness_loses_the_race': (RUN, "pg_sleep", "pg_nosleep", None),
    'harness_loses_the_disposable_guard': (RUN, "*disposable*", "*anything*"),
    'harness_loses_the_repeatable_read_race': (RUN, 'race_constraint "repeatable read" || return 1', 'true', 1),
    'harness_loses_the_storm': (RUN, "race_storm race_redeem_token", "race_redeem_token"),
    'suite_loses_the_crash_proofing': (SUITE, "create function pg_temp._do(", "create function pg_temp._doo("),
    'fixture_loses_default_privileges': (FIXTURE, "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;", "select 1;"),
    'fixture_loses_function_default_privileges': (FIXTURE, "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;", "select 1;"),
}


def _file_mut_apply(name):
    """Apply a file mutation in place; returns (path, original bytes)."""
    spec = FILE_MUTATIONS[name]
    rel, old, new = spec[0], spec[1], spec[2]
    count = spec[3] if len(spec) > 3 else 1
    path = ROOT / rel
    original = path.read_bytes()
    text = original.decode()
    if old == '':
        out = text + new
    else:
        found = text.count(old)
        if (count is None and found < 1) or (count is not None and found != count):
            raise ValueError('anchor for %s matched %d time(s) in %s, expected %s' % (name, found, rel, 'at least 1' if count is None else count))
        if old == new:
            raise ValueError('mutation %s changes nothing' % name)
        out = text.replace(old, new)
    if out == text:
        raise ValueError('mutation %s changes nothing' % name)
    path.write_bytes(out.encode())
    return path, original


def run_struct():
    r = subprocess.run(['node', str(ROOT / STRUCT)], cwd=ROOT, capture_output=True, text=True)
    fails = [l for l in r.stdout.splitlines() if l.startswith('FAIL')]
    return r.returncode, fails


def check_anchors():
    """Apply every SQL mutation to the SQL of record in memory: each anchor must match exactly its stated count."""
    text = (ROOT / SQL).read_text()
    bad = 0
    for name in list(MUTATIONS) + list(STRUCT_ONLY):
        try:
            mutate_sql(name, text)
        except ValueError as e:
            print('HARNESS  %s - %s' % (name, e))
            bad += 1
    for name, spec in FILE_MUTATIONS.items():
        rel, old = spec[0], spec[1]
        count = spec[3] if len(spec) > 3 else 1
        p = ROOT / rel
        if not p.exists():
            print('HARNESS  %s - %s does not exist' % (name, rel))
            bad += 1
            continue
        if old == '':
            continue
        found = p.read_text().count(old)
        if (count is None and found < 1) or (count is not None and found != count):
            print('HARNESS  %s - anchor matched %d time(s) in %s, expected %s' % (name, found, rel, 'at least 1' if count is None else count))
            bad += 1
    print('%d SQL mutations, %d structural-only, %d file mutations; %d anchor fault(s)' % (len(MUTATIONS), len(STRUCT_ONLY), len(FILE_MUTATIONS), bad))
    return 2 if bad else 0


def main():
    argv = sys.argv[1:]
    if argv == ['--list']:
        print('\n'.join(MUTATIONS))
        return 0
    if argv == ['--check']:
        return check_anchors()
    if len(argv) == 2 and argv[0] == '--kind':
        if argv[1] not in MUTATIONS:
            sys.stderr.write('unknown mutation %s\n' % argv[1])
            return 2
        print('poison' if argv[1] in POISON else 'race' if argv[1] in RACE else 'suite')
        return 0
    if len(argv) == 3 and argv[0] == '--sql':
        if argv[1] not in MUTATIONS:
            sys.stderr.write('unknown mutation %s\n' % argv[1])
            return 2
        try:
            sys.stdout.write(mutate_sql(argv[1], Path(argv[2]).read_text()))
        except ValueError as e:
            sys.stderr.write(str(e) + '\n')
            return 2
        return 0

    names = argv or list(MUTATIONS) + list(STRUCT_ONLY) + list(FILE_MUTATIONS)
    unknown = [n for n in names if n not in MUTATIONS and n not in STRUCT_ONLY and n not in FILE_MUTATIONS]
    if unknown:
        sys.stderr.write('unknown mutation(s): %s\n' % ', '.join(unknown))
        return 2
    code, fails = run_struct()
    if code != 0:
        sys.stderr.write('HARNESS: the unmutated tree does not pass the structural test (%d failing pin(s)); a mutation harness over a red baseline proves nothing\n' % len(fails))
        for f in fails[:5]:
            sys.stderr.write('  ' + f[:200] + '\n')
        return 2

    originals = {}

    def restore(*_):
        for path, data in originals.items():
            path.write_bytes(data)

    signal.signal(signal.SIGINT, lambda *a: (restore(), sys.exit(130)))
    signal.signal(signal.SIGTERM, lambda *a: (restore(), sys.exit(143)))
    survivors, skipped, harness = [], [], []
    try:
        for name in names:
            if name in MUTATIONS and name in PG_ONLY:
                print('SKIPPED  %s - only the database can see this one (run.sh kills it)' % name)
                skipped.append(name)
                continue
            try:
                if name in MUTATIONS or name in STRUCT_ONLY:
                    path = ROOT / SQL
                    original = path.read_bytes()
                    originals[path] = original
                    path.write_text(mutate_sql(name, original.decode()))
                else:
                    path, original = _file_mut_apply(name)
                    originals[path] = original
            except ValueError as e:
                print('HARNESS  %s - %s' % (name, e))
                harness.append(name)
                restore()
                originals.clear()
                continue
            code, fails = run_struct()
            restore()
            originals.clear()
            if code != 0:
                print('KILLED   %s - %d pin(s) failed: %s' % (name, len(fails), (fails[0] if fails else 'the test errored')[:150]))
            else:
                print('SURVIVED %s - the structural pins cannot see this regression' % name)
                survivors.append(name)
    finally:
        restore()
    killed = len(names) - len(survivors) - len(skipped) - len(harness)
    print('\n%d killed, %d survived, %d skipped (database only), %d harness fault(s), of %d' % (killed, len(survivors), len(skipped), len(harness), len(names)))
    if harness:
        return 2
    return 1 if survivors else 0


if __name__ == '__main__':
    sys.exit(main())
