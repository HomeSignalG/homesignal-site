#!/usr/bin/env python3
"""n5_orchestrate.py - the control plane for an unattended national N5 generation.

WHY THIS EXISTS. The 544-shard build completed on 2026-09-05 and stopped, because the unit
of work was "build every ZIP3 prefix once" and every prefix reached state='done'. Nothing
was wrong; there was simply no lifecycle. This script is that lifecycle.

⛔ IT NEVER ACTIVATES ANYTHING BY ITSELF. Worker completion is not reconciliation success,
and reconciliation success is not activation. `activate` is a separate, explicit mode, and
even then the decision belongs to geo.n5_generation_activate(), which re-derives every
condition against the DECLARED chunk set and raises rather than returning false.

MODES
  status     one-read generation state (geo.n5_generation_status)
  open       capture an immutable snapshot + open a BUILDING generation + seed its shards
  work       claim and run shards under a lease; bounded; resumable; duplicate-safe
  reconcile  compute reconciliation chunks for a generation
  ready      BUILDING -> READY, only when every shard is done
  activate   hand the DECLARED chunk set to the activation gate

SAFETY PROPERTIES, and where each one actually lives:
  restartable       - `work` claims from the DB, so a killed process loses nothing but its
                      current shard, which the lease releases.
  idempotent        - `open` refuses if the generation exists; `reconcile` upserts per chunk.
  duplicate-safe    - geo.n5_claim_shard uses FOR UPDATE SKIP LOCKED, so two orchestrators
                      interleave rather than collide. Not "unlikely to collide" - cannot.
  bounded           - MAX_SHARDS and MAX_SECONDS cap every invocation.
  fail-closed       - any refusal raises SystemExit; no mode falls through to a default.
  observable        - every mode prints the same status block at exit.
"""
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import sql, lit  # noqa: E402  - one implementation, imported not re-derived

GENERATION = os.environ.get("GENERATION", "").strip()
MODE = os.environ.get("MODE", "status").strip()
MAX_SHARDS = int(os.environ.get("MAX_SHARDS", "1"))
MAX_SECONDS = int(os.environ.get("MAX_SECONDS", "3000"))
LEASE_SECONDS = int(os.environ.get("LEASE_SECONDS", "3600"))
WORKER = os.environ.get("WORKER", f"gh-{os.environ.get('GITHUB_RUN_ID', 'local')}-"
                                  f"{os.environ.get('GITHUB_JOB', os.getpid())}")
CHUNKS = [c for c in os.environ.get("CHUNKS", "0,1,2,3,4,5,6,7,8,9").split(",") if c.strip()]
HERE = os.path.dirname(os.path.abspath(__file__))


def say(k, v=""):
    print(f"{k:38} {v}", flush=True)


def status(gen):
    rows = sql(f"select geo.n5_generation_status({lit(gen)}) s;", "status", read_only=True)
    s = rows[0]["s"] if rows and rows[0]["s"] else None
    if not s:
        raise SystemExit(f"STOP: generation {gen} does not exist.")
    if isinstance(s, str):
        s = json.loads(s)
    say("", "")
    say("--- GENERATION STATUS ---")
    for k in ("generation_id", "snapshot_id", "state", "source_cutoff", "freshness_lag_days",
              "elapsed_seconds", "snapshot_rows", "shards_total", "shards_pending",
              "shards_running", "shards_done", "shards_failed", "reconcile_chunks",
              "expected_keys", "accounted_resolved", "accounted_unresolved", "unaccounted",
              "unresolved_recorded", "activation_eligible_hint"):
        say(k, s.get(k))
    return s


def require_generation():
    if GENERATION:
        return GENERATION
    raise SystemExit("STOP: GENERATION is required for this mode.")


def discover_building():
    """The single open generation, for an UNATTENDED run that was given no identity.

    Three outcomes and they are deliberately different: exactly one BUILDING generation is
    the normal case; none is a clean NO-OP (a scheduled tick with nothing to do must not
    look like a failure, or the alarm stops meaning anything); more than one is a HARD
    FAILURE, because picking one would be the "whichever build looks newest" inference this
    architecture exists to remove.
    """
    rows = sql("select generation_id from geo.n5_generation where state='BUILDING' "
               "order by opened_at;", "discover", read_only=True)
    if len(rows) > 1:
        raise SystemExit("STOP: %d generations are BUILDING (%s). Refusing to guess which "
                         "one this run belongs to." % (len(rows),
                                                       ",".join(r["generation_id"] for r in rows)))
    return rows[0]["generation_id"] if rows else None


def mode_open():
    """Capture an immutable snapshot and open a generation bound to it.

    THE SNAPSHOT IS ONE TRANSACTION, deliberately. Its whole value is that the expected set
    cannot move afterwards; a chunked capture would be a set assembled from several different
    instants of a table that is rewritten every two minutes, which is not a watermark.
    """
    gen = require_generation()
    if sql(f"select 1 from geo.n5_generation where generation_id={lit(gen)};", "exists",
           read_only=True):
        raise SystemExit(f"STOP: generation {gen} already exists. `open` is not a resume - "
                         f"use MODE=work. Refusing to re-open and orphan its shards.")
    snapshot_id = os.environ.get("SNAPSHOT_ID", f"n5-{gen}").strip()
    if sql(f"select 1 from preservation.app_project_identity where snapshot_id={lit(snapshot_id)} "
           f"limit 1;", "snap exists", read_only=True):
        raise SystemExit(f"STOP: snapshot {snapshot_id} already has rows. A capture is "
                         f"immutable; refusing to append to one.")

    # The cutoff is read ONCE and reused for the capture and the generation row, so the
    # watermark the generation advertises is exactly the instant it captured.
    cutoff = sql("select now() c;", "cutoff", read_only=True)[0]["c"]
    say("capture cutoff", cutoff)

    sql(f"""insert into preservation.app_project_identity
              (snapshot_id, app_project_id, zip, source_key, source_seq, registry_id,
               record_kind, source_ref, submitted_at, lat, lng)
            select {lit(snapshot_id)}, p.id, p.zip, p.source_key, p.source_seq, p.registry_id,
                   'development', p.source_ref, p.submitted_at, p.lat, p.lng
              from public.app_projects p
              join public.n5_expected_input({lit(cutoff)}) e
                on e.source_key = p.source_key and e.zip = p.zip and e.source_seq = p.source_seq
             where p.record_kind = 'development';""", "capture")

    n = sql(f"select count(*) n from preservation.app_project_identity "
            f"where snapshot_id={lit(snapshot_id)};", "capture rows", read_only=True)[0]["n"]
    if int(n) == 0:
        raise SystemExit("STOP: capture wrote 0 rows. Refusing to open a vacuous generation.")
    say("captured rows", n)

    sql(f"""insert into geo.n5_snapshot (snapshot_id, taken_at, cutoff, scope, n_rows, notes)
            values ({lit(snapshot_id)}, now(), {lit(cutoff)},
                    'public.n5_expected_input(cutoff) - the canonical contract',
                    {int(n)}, 'opened by n5_orchestrate.py')
            on conflict (snapshot_id) do nothing;""", "snapshot row")

    sql(f"""insert into geo.n5_generation
              (generation_id, snapshot_id, cutoff, state, note)
            values ({lit(gen)}, {lit(snapshot_id)}, {lit(cutoff)}, 'BUILDING',
                    'opened by n5_orchestrate.py');""", "generation row")

    # Shard manifest derives from the CAPTURE, never from the canonical ZIP registry: a ZIP
    # present in the capture but absent from the registry would otherwise be skipped in
    # silence and the build would look complete.
    sql(f"""insert into geo.n5_shard
              (snapshot_id, generation_id, z3, projects, pairs, zips, state)
            select {lit(snapshot_id)}, {lit(gen)}, left(e.zip,3),
                   count(distinct e.source_key), count(distinct e.source_key||'|'||e.zip),
                   count(distinct e.zip), 'pending'
              from public.n5_expected_captured({lit(snapshot_id)}) e
             group by left(e.zip,3);""", "shard manifest")
    say("generation opened", gen)
    return 0


def mode_work():
    gen = GENERATION or discover_building()
    if not gen:
        say("work", "no BUILDING generation - nothing to do (clean no-op)")
        return 0
    t0 = time.time()
    done = 0
    while done < MAX_SHARDS and (time.time() - t0) < MAX_SECONDS:
        rows = sql(f"select z3 from geo.n5_claim_shard({lit(gen)}, {lit(WORKER)}, "
                   f"{LEASE_SECONDS});", "claim")
        z3 = rows[0]["z3"] if rows and rows[0].get("z3") else None
        if not z3:
            say("claim", "no shard available - drained or all leased")
            break
        say("claimed shard", f"{z3} by {WORKER}")
        env = dict(os.environ, GENERATION=gen, Z3=z3, MAX_SHARDS="1")
        r = subprocess.run([sys.executable, os.path.join(HERE, "n5_shard.py")], env=env)
        if r.returncode != 0:
            # The worker marks its own shard halted; the orchestrator does not paper over it.
            raise SystemExit(f"STOP: shard {z3} exited {r.returncode}. Generation stays "
                             f"BUILDING; nothing advances on a failed shard.")
        done += 1
    say("shards completed this invocation", done)
    return 0


def mode_reconcile():
    gen = GENERATION or discover_building()
    if not gen:
        say("reconcile", "no BUILDING generation - nothing to do (clean no-op)")
        return 0
    for c in CHUNKS:
        row = sql(f"select * from geo.n5_reconcile_chunk({lit(gen)}, {lit(c)});", f"chunk {c}")[0]
        say(f"chunk {c}", f"expected={row['expected_keys']} resolved={row['accounted_resolved']} "
                          f"unresolved={row['accounted_unresolved']} unaccounted={row['unaccounted']}")
    return 0


def mode_ready():
    """BUILDING -> READY. A state change only; it asserts nothing about reconciliation."""
    gen = require_generation()
    bad = sql(f"select count(*) n from geo.n5_shard where generation_id={lit(gen)} "
              f"and state <> 'done';", "unfinished", read_only=True)[0]["n"]
    if int(bad) != 0:
        raise SystemExit(f"STOP: {bad} shard(s) are not done. READY means every shard "
                         f"finished, and it still proves nothing about reconciliation.")
    sql(f"update geo.n5_generation set state='READY' where generation_id={lit(gen)} "
        f"and state='BUILDING';", "ready")
    say("generation", f"{gen} -> READY (activation still requires reconciliation)")
    return 0


def mode_activate():
    gen = require_generation()
    arr = "array[" + ",".join(lit(c) for c in CHUNKS) + "]::text[]"
    sql(f"select geo.n5_generation_activate({lit(gen)}, {arr});", "activate")
    say("generation", f"{gen} -> ACTIVE")
    return 0


MODES = {"status": lambda: 0, "open": mode_open, "work": mode_work,
         "reconcile": mode_reconcile, "ready": mode_ready, "activate": mode_activate}


def main():
    say("mode", MODE)
    say("worker", WORKER)
    if MODE not in MODES:
        raise SystemExit(f"STOP: unknown MODE {MODE!r}. Known: {sorted(MODES)}")
    rc = MODES[MODE]()
    gen = GENERATION or (discover_building() if MODE in ("work", "reconcile", "status") else None)
    if gen:
        status(gen)
    return rc


if __name__ == "__main__":
    sys.exit(main() or 0)
