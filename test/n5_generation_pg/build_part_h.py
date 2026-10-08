#!/usr/bin/env python3
"""Generate docs/n5-generation-publish-part-h.sql (and its rollback) from Part D, verbatim.

Part H is the production apply file for Fix 5, the PRE-ACTIVATION PROOF: Part D's D14 block
(geo.n5_generation_proof, geo.n5_generation_preactivation_problems,
geo.n5_generation_record_proof) and D12's geo.n5_generation_activate, which now refuses a
generation without a passed proof and recomputes the proof's data checks. Every body is sliced
from docs/n5-generation-publish-part-d.sql (the DDL of record the executable suite runs),
never retyped.

  python3 test/n5_generation_pg/build_part_h.py          write both files
  python3 test/n5_generation_pg/build_part_h.py --check  exit 1 if either file is not what this writes

The rollback puts the previous activate back: D12's activate with the D14 lines cut out, and
the cut is proven to fingerprint to BEFORE_MD5, the md5(prosrc) read from production on
2026-10-08. It keeps the proof table and its rows (history is never deleted) and the two proof
functions; with the old activate nothing calls them.
"""
import hashlib
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PART_D = os.path.join(ROOT, "docs", "n5-generation-publish-part-d.sql")
OUT = os.path.join(ROOT, "docs", "n5-generation-publish-part-h.sql")
ROLLBACK = os.path.join(ROOT, "docs", "n5-generation-publish-part-h.rollback.sql")

# md5(prosrc) of geo.n5_generation_activate, read from production 2026-10-08 (2,882 characters).
BEFORE_MD5 = "2ccb4d4d25439d786d66c3dfbc384d30"

D14_START = "-- ---------------------------------------------------------------------------\n-- D14. THE PRE-ACTIVATION PROOF"
D14_END = "-- ---------------------------------------------------------------------------\n-- D12. BUILDING -> READY and ACTIVATE"
ACT_HEAD = "create or replace function geo.n5_generation_activate(p_generation_id text, p_expected_chunks text[])"
ACT_TAIL = "revoke all on function geo.n5_generation_activate(text, text[]) from public;"
PROOF_DECL = "  pf           geo.n5_generation_proof;\n"
PROOF_BLOCK_START = "  -- D14: the newest pre-activation proof must have passed"
PROOF_BLOCK_END = "  select * into prev from geo.n5_generation"
FUNCS = ("n5_generation_preactivation_problems", "n5_generation_record_proof")


def body_of(fn_text, quote):
    s = fn_text.index(f"as {quote}") + len(f"as {quote}")
    return fn_text[s:fn_text.index(f"{quote};", s)]


def md5(text):
    return hashlib.md5(text.encode()).hexdigest()


def slices():
    text = open(PART_D).read()
    if text.count(D14_START) != 1 or text.count(ACT_HEAD) != 1:
        raise SystemExit("STOP: Part D does not carry exactly one D14 block and one activate")
    d14 = text[text.index(D14_START):text.index(D14_END)]
    i = text.index(ACT_HEAD)
    act = text[i:text.index(ACT_TAIL, i) + len(ACT_TAIL)]
    bodies = {}
    for name in FUNCS:
        head = f"create or replace function geo.{name}("
        if d14.count(head) != 1:
            raise SystemExit(f"STOP: D14 does not define geo.{name} exactly once")
        bodies[name] = md5(body_of(d14[d14.index(head):], "$$"))
    return d14, act, md5(body_of(act, "$function$")), bodies


def previous_activate(act):
    """D12's activate with the D14 lines removed, proven equal to production's pre-state."""
    if act.count(PROOF_DECL) != 1 or act.count(PROOF_BLOCK_START) != 1:
        raise SystemExit("STOP: the D14 lines are not where the generator expects them in activate")
    old = act.replace(PROOF_DECL, "")
    i = old.index(PROOF_BLOCK_START)
    j = old.index(PROOF_BLOCK_END, i)
    old = old[:i] + old[j:]
    got = md5(body_of(old, "$function$"))
    if got != BEFORE_MD5:
        raise SystemExit(f"STOP: the cut activate is {got}, not production's pre-Part-H body {BEFORE_MD5}")
    return old


def guard(label, want, msg):
    return f"""do $h$
declare m text;
begin
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_generation_activate';
  if m is distinct from '{want}' then
    raise exception '{label}: live n5_generation_activate is % - {msg}', m;
  end if;
end $h$;"""


def build():
    d14, act, after, bodies = slices()
    checks = "\n".join(
        f"  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n"
        f"   where n.nspname = 'geo' and p.proname = '{name}';\n"
        f"  if m is distinct from '{h}' then raise exception 'part H post-condition failed: {name} md5 %', m; end if;"
        for name, h in bodies.items())
    return f"""-- GENERATED from docs/n5-generation-publish-part-d.sql (its D14 block and D12's activate),
-- verbatim - never hand-edited. Part H (Fix 5, 2026-10-08).
-- Regenerate: python3 test/n5_generation_pg/build_part_h.py
--
-- THE PRE-ACTIVATION PROOF. Until now a generation that passed READY was switched onto Map 1
-- in the same tick. READY proves the build is complete; it does not prove the build agrees
-- with what residents see today. After this file, geo.n5_generation_activate refuses a
-- generation unless its NEWEST pre-activation proof (geo.n5_generation_proof) passed, was taken
-- against the generation that is STILL serving, and its data checks still hold now - they are
-- recomputed inside the switching transaction. The proof is recorded by
-- geo.n5_generation_record_proof while the generation is READY: prefix receipts, canonical ZIP
-- reconciliation, no undeclared missing boundary, membership against the serving generation,
-- and the browser parity result the orchestrator measured.
--
-- Additive except activate. Applying it with no proof recorded STOPS the daily automatic switch
-- until the orchestrator records one - that is the point. Map 1 is unchanged.
--
-- ONE transaction. Fail-closed on both sides:
--   before: the live activate must be exactly the previous DDL of record (md5(prosrc) {BEFORE_MD5});
--   after:  activate {after}, and each new function its DDL-of-record body.
begin;
set local lock_timeout = '10s';
{guard("part H", BEFORE_MD5, "not the previous DDL of record; refusing")}

{d14}
{act}

do $h$
declare m text;
begin
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_generation_activate';
  if m is distinct from '{after}' then raise exception 'part H post-condition failed: n5_generation_activate md5 %', m; end if;
{checks}
  if not (select c.relrowsecurity from pg_class c where c.oid = 'geo.n5_generation_proof'::regclass) then
    raise exception 'part H post-condition failed: geo.n5_generation_proof has no row-level security';
  end if;
end $h$;
commit;
"""


def build_rollback():
    d14, act, after, _ = slices()
    old = previous_activate(act)
    return f"""-- GENERATED by test/n5_generation_pg/build_part_h.py - never hand-edited.
-- ROLLBACK for Part H (docs/n5-generation-publish-part-h.sql).
--
-- Puts geo.n5_generation_activate back to the body production carried before Part H: D12's
-- activate with the D14 lines cut out. The generator proves that cut equals the pre-Part-H
-- production fingerprint before writing this. geo.n5_generation_proof and its rows are KEPT
-- (the evidence of every proof stays), as are the two proof functions; the old activate does
-- not call them.
--
-- When to use it: the proof is refusing activation of a generation that is right, and Map 1
-- must move before the check is fixed. After running it, also revert D12's activate in
-- docs/n5-generation-publish-part-d.sql, or the DDL of record no longer describes production.
--
-- ONE transaction. Fail-closed on both sides:
--   before: the live activate must be exactly Part H's ({after});
--   after:  it must be exactly the pre-Part-H body ({BEFORE_MD5}).
begin;
set local lock_timeout = '10s';
{guard("part H rollback", after, "not Part H; refusing")}

{old}

{guard("part H rollback post-condition failed", BEFORE_MD5, "not the pre-Part-H body")}
commit;
"""


if __name__ == "__main__":
    files = ((OUT, build()), (ROLLBACK, build_rollback()))
    if "--check" in sys.argv:
        bad = [p for p, text in files
               if (open(p).read() if os.path.exists(p) else "") != text]
        for p in bad:
            print(f"{os.path.relpath(p, ROOT)} is NOT what build_part_h.py writes - regenerate it", file=sys.stderr)
        if bad:
            sys.exit(1)
        print("part H and its rollback match Part D's D14 and D12")
    else:
        for p, text in files:
            open(p, "w").write(text)
            print("wrote", p)
