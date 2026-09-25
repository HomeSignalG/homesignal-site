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
  work       claim and run shards under a lease; bounded; resumable; duplicate-safe.
             Once EVERY shard is done, the same bounded tick publishes the generation's
             prefixes (scripts/n5_publish.py -> geo.n5_gen_publish_prefix) and then records
             its unresolved outcomes (geo.n5_gen_record_unresolved). All of it is written
             under the BUILDING generation, which Map 1 never reads.
  publish    only the publish stage of `work`
  unresolved only the unresolved-accounting stage of `work`
  reconcile  compute reconciliation chunks for a generation
  ready      BUILDING -> READY through geo.n5_generation_mark_ready, which re-derives
             completeness and reconciliation itself and raises on any gap
  activate   hand the DECLARED chunk set to the activation gate. Its COMMIT is the one
             serving switch: Map 1 reads only the ACTIVE / ACTIVE_LEGACY generation.
  rollback   GENERATION = the superseded generation to restore; REASON required
  fail       mark a candidate FAILED; REASON required
  discard    delete a FAILED / superseded generation's rows (never the serving generation
             or its predecessor, which is the rollback target)

docs/n5-generation-publish.sql holds every rule these modes call; see it before changing one.

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
# CHUNKS defaults to EMPTY, meaning "the generation's own shard prefixes". Reconciliation
# granularity must match BUILD granularity: a 1-digit chunk spans ~170,000 capture rows and
# ~850 MB of random heap I/O (measured: 50.9 s for bucket '0'), while a 3-digit chunk is
# ~12,700 rows and returns in well under a second. Deriving them also means the set declared
# at activation is exactly the set that was built — one list, not two that can drift.
CHUNKS = [c for c in os.environ.get("CHUNKS", "").split(",") if c.strip()]
REASON = os.environ.get("REASON", "").strip()
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
              "prefixes_published", "unresolved_recorded_at", "serving", "predecessor",
              "expected_keys", "accounted_resolved", "accounted_unresolved", "unaccounted",
              "unresolved_recorded", "activation_eligible_hint"):
        say(k, s.get(k))
    return s


def require_generation():
    if GENERATION:
        return GENERATION
    raise SystemExit("STOP: GENERATION is required for this mode.")


def chunks_for(gen):
    """The chunk set for a generation: explicit CHUNKS, else its own shard prefixes."""
    if CHUNKS:
        return CHUNKS
    rows = sql(f"select z3 from geo.n5_shard where generation_id={lit(gen)} order by z3;",
               "chunks", read_only=True)
    if not rows:
        raise SystemExit(f"STOP: generation {gen} has no shards, so it has no chunk set. "
                         f"Refusing to reconcile or activate against an empty declaration.")
    return [r["z3"] for r in rows]


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

    # ONE REQUEST, ONE TRANSACTION. Every statement below travels in a single simple-query
    # message, which PostgreSQL runs as ONE implicit transaction: the capture, the snapshot
    # row, the generation row and the shard manifest commit together or not at all. Sent as
    # four requests (the original shape) a failure after the capture committed ~1.4 GB of
    # orphan rows under a name the precheck above then refuses forever, and a failure after
    # the generation row left a BUILDING generation with no shards.
    # statement_timeout: the server default is 120 s (platform-defaults.conf) and the
    # capture alone ran 114 s before its first row on 2026-09-25. From PG 13 the SET applies
    # to EACH statement of the message separately. The client waits longer than all four
    # can take in total, so the server - never the client - is what gives up, and a timeout
    # rolls the whole transaction back.
    #
    # identity_hash and content_hash are NOT NULL in production. Both expressions are the
    # canonical ones from docs/preservation-baseline-phase1.sql, byte for byte, so every
    # snapshot fingerprints the same way; test/n5-generation-publish.test.mjs pins the
    # parity. (The first production `open`, 2026-09-25, omitted them and was refused.)
    OPEN_STATEMENT_TIMEOUT = "840s"
    sql(f"""set statement_timeout = '{OPEN_STATEMENT_TIMEOUT}';
            insert into preservation.app_project_identity
              (snapshot_id, app_project_id, zip, source_key, source_seq, registry_id,
               record_kind, source_ref, submitted_at, lat, lng, identity_hash, content_hash)
            select {lit(snapshot_id)}, p.id, p.zip, p.source_key, p.source_seq, p.registry_id,
                   'development', p.source_ref, p.submitted_at, p.lat, p.lng,
         decode(md5(coalesce(p.zip,'')||'|'||coalesce(p.source_key,'')||'|'||
                    coalesce(p.source_seq::text,'')||'|'||coalesce(p.record_kind,'')||'|'||
                    coalesce(p.registry_id,'')),'hex'),
         decode(md5(coalesce(p.source_ref,'')||'|'||coalesce(p.submitted_at::text,'')||'|'||
                    coalesce(p.lat::text,'')||'|'||coalesce(p.lng::text,'')||'|'||
                    coalesce(p.name,'')||'|'||coalesce(p.status,'')||'|'||
                    coalesce(p.type,'')),'hex')
              from public.app_projects p
              join public.n5_expected_input({lit(cutoff)}) e
                on e.source_key = p.source_key and e.zip = p.zip and e.source_seq = p.source_seq
             where p.record_kind = 'development';

            -- A vacuous capture aborts the WHOLE transaction: nothing below is written.
            do $empty$ begin
              if not exists (select 1 from preservation.app_project_identity
                              where snapshot_id = {lit(snapshot_id)}) then
                raise exception 'capture wrote 0 rows - refusing to open a vacuous generation';
              end if;
            end $empty$;

            -- sources / projects / pairs / checksum are NOT NULL. Their meaning is fixed by the
            -- two existing rows: over phase1-2026-09-01 these exact expressions reproduce
            -- sources 234 (the 5 registry-less rows count as one source), projects 925,463,
            -- pairs 2,753,802, n_rows 2,976,275 (measured 2026-09-25). checksum is the SAME
            -- order-independent sum as the shard manifest, so it equals the manifest's total.
            insert into geo.n5_snapshot
              (snapshot_id, taken_at, cutoff, scope, sources, projects, pairs, n_rows, checksum, notes)
            select {lit(snapshot_id)}, now(), {lit(cutoff)},
                   'public.n5_expected_input(cutoff) - the canonical contract',
                   count(distinct coalesce(e.registry_id, '<null>')),
                   count(distinct e.source_key), count(distinct e.source_key||'|'||e.zip),
                   count(*),
                   sum(('x'||substr(md5(e.source_key||'|'||e.zip||'|'
                        ||coalesce(e.source_seq::text,'')),1,8))::bit(32)::bigint),
                   'opened by n5_orchestrate.py'
              from public.n5_expected_captured({lit(snapshot_id)}) e;

            insert into geo.n5_generation
              (generation_id, snapshot_id, cutoff, state, note)
            values ({lit(gen)}, {lit(snapshot_id)}, {lit(cutoff)}, 'BUILDING',
                    'opened by n5_orchestrate.py');

            -- Shard manifest derives from the CAPTURE, never from the canonical ZIP registry: a
            -- ZIP present in the capture but absent from the registry would otherwise be skipped
            -- in silence and the build would look complete. checksum is NOT NULL and
            -- load-bearing: run_shard compares the frozen slice against it and halts as
            -- FREEZE_DRIFT on a mismatch. It is the SAME order-independent expression the freeze
            -- check uses - addition commutes, so no sort is involved and the two sides cannot
            -- disagree over row order or collation.
            insert into geo.n5_shard
              (snapshot_id, generation_id, z3, projects, pairs, zips, checksum, state)
            select {lit(snapshot_id)}, {lit(gen)}, left(e.zip,3),
                   count(distinct e.source_key), count(distinct e.source_key||'|'||e.zip),
                   count(distinct e.zip),
                   sum(('x'||substr(md5(e.source_key||'|'||e.zip||'|'
                        ||coalesce(e.source_seq::text,'')),1,8))::bit(32)::bigint),
                   'pending'
              from public.n5_expected_captured({lit(snapshot_id)}) e
             group by left(e.zip,3);""", "open (one transaction)", timeout=3000)

    # Read back what committed, as one statement: the manifest must sum to the snapshot row.
    got = sql(f"""select s.n_rows, s.sources, s.projects, s.pairs, s.checksum,
                         (select count(*) from geo.n5_shard m
                           where m.generation_id={lit(gen)}) shards,
                         (select sum(m.checksum) from geo.n5_shard m
                           where m.generation_id={lit(gen)}) manifest_checksum
                    from geo.n5_snapshot s where s.snapshot_id={lit(snapshot_id)};""",
              "open read-back", read_only=True)
    if not got:
        raise SystemExit(f"STOP: open returned but snapshot {snapshot_id} is absent - the "
                         f"transaction did not commit. Nothing was left behind.")
    g = got[0]
    say("captured rows", g["n_rows"])
    say("sources / projects / pairs", f"{g['sources']} / {g['projects']} / {g['pairs']}")
    say("shards", g["shards"])
    if str(g["checksum"]) != str(g["manifest_checksum"]):
        raise SystemExit(f"STOP: snapshot checksum {g['checksum']} != manifest total "
                         f"{g['manifest_checksum']}. The generation is open but inconsistent; "
                         f"fail and discard it before building.")
    say("generation opened", gen)
    return 0


def mode_work():
    gen = GENERATION or discover_building()
    if not gen:
        say("work", "no BUILDING generation - nothing to do (clean no-op)")
        return 0
    # The worker must freeze from the snapshot THIS generation is bound to. n5_shard.py
    # defaults SNAPSHOT to phase1 and refuses a mismatch ("Conflicting identity"), so passing
    # only GENERATION stopped every shard of every new generation. Read, never derived from
    # the naming convention `open` happens to use: SNAPSHOT_ID can override that.
    snap = sql(f"select snapshot_id from geo.n5_generation where generation_id={lit(gen)};",
               "generation snapshot", read_only=True)
    if not snap:
        raise SystemExit(f"STOP: generation {gen} does not exist.")
    snapshot_id = snap[0]["snapshot_id"]
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
        env = dict(os.environ, GENERATION=gen, SNAPSHOT=snapshot_id, Z3=z3, MAX_SHARDS="1")
        r = subprocess.run([sys.executable, os.path.join(HERE, "n5_shard.py")], env=env)
        if r.returncode != 0:
            # The worker marks its own shard halted; the orchestrator does not paper over it.
            raise SystemExit(f"STOP: shard {z3} exited {r.returncode}. Generation stays "
                             f"BUILDING; nothing advances on a failed shard.")
        done += 1
    say("shards completed this invocation", done)
    budget = MAX_SECONDS - (time.time() - t0)
    if budget > 0:
        publish_pending(gen, budget)
    return 0


def shards_unfinished(gen):
    return int(sql(f"select count(*) n from geo.n5_shard where generation_id={lit(gen)} "
                   f"and state <> 'done';", "unfinished", read_only=True)[0]["n"])


def unpublished_prefixes(gen):
    """Every prefix of the generation's PUBLICATION SCOPE not yet published - read from the
    one definition, geo.n5_generation_publish_scope (shard prefixes UNION every canonical
    prefix). Enumerating geo.n5_shard alone skipped the 40 canonical-only prefixes, so
    geo.n5_gen_record_unresolved raised 'unpublished' on every tick (audit 2026-09-25)."""
    return [r["z3"] for r in sql(
        f"select s.z3 from geo.n5_generation_publish_scope({lit(gen)}) s "
        f"where not exists (select 1 from geo.n5_generation_publish p "
        f"where p.generation_id={lit(gen)} and p.z3=s.z3) order by s.z3;",
        "unpublished", read_only=True)]


def publish_pending(gen, budget_seconds):
    """The publish + unresolved stages, bounded. Publishing waits for EVERY shard: a project
    stated in one prefix can resolve into another, so a boundary probed before all geometry
    exists would miss it in silence."""
    from n5_publish import publish_prefix  # noqa: E402 - one implementation
    left = shards_unfinished(gen)
    if left:
        say("publish", f"waiting - {left} shard(s) not done")
        return 0
    t0 = time.time()
    run_id = f"pub-{WORKER}"
    todo = unpublished_prefixes(gen)
    say("prefixes to publish", len(todo))
    for z3 in todo:
        if time.time() - t0 >= budget_seconds:
            say("publish", "budget spent - resuming next tick")
            return 0
        publish_prefix(gen, z3, run_id)
    if not unpublished_prefixes(gen):
        stale = sql(f"select (g.unresolved_recorded_at is null or g.unresolved_recorded_at < "
                    f"(select max(p.completed_at) from geo.n5_generation_publish p "
                    f"where p.generation_id=g.generation_id)) s from geo.n5_generation g "
                    f"where g.generation_id={lit(gen)};", "unresolved stale", read_only=True)[0]["s"]
        if stale:
            r = sql(f"select geo.n5_gen_record_unresolved({lit(gen)}) r;", "unresolved")[0]["r"]
            say("unresolved outcomes recorded", r)
    return 0


def mode_publish():
    gen = GENERATION or discover_building()
    if not gen:
        say("publish", "no BUILDING generation - nothing to do (clean no-op)")
        return 0
    return publish_pending(gen, MAX_SECONDS)


def mode_unresolved():
    gen = require_generation()
    r = sql(f"select geo.n5_gen_record_unresolved({lit(gen)}) r;", "unresolved")[0]["r"]
    say("unresolved outcomes recorded", r)
    return 0


def mode_reconcile():
    gen = GENERATION or discover_building()
    if not gen:
        say("reconcile", "no BUILDING generation - nothing to do (clean no-op)")
        return 0
    for c in chunks_for(gen):
        row = sql(f"select * from geo.n5_reconcile_chunk({lit(gen)}, {lit(c)});", f"chunk {c}")[0]
        say(f"chunk {c}", f"expected={row['expected_keys']} resolved={row['accounted_resolved']} "
                          f"unresolved={row['accounted_unresolved']} unaccounted={row['unaccounted']}")
    return 0


def mode_ready():
    """BUILDING -> READY, decided by geo.n5_generation_mark_ready: every shard done, every
    prefix published, unresolved outcomes recorded after the last publish, membership and
    markers paired, every canonical ZIP carrying a status, the declared chunks covering the
    whole expected set, and reconciliation recomputed to zero unaccounted. It raises on any
    gap; this script adds no second copy of those rules."""
    gen = require_generation()
    arr = "array[" + ",".join(lit(c) for c in chunks_for(gen)) + "]::text[]"
    sql(f"select geo.n5_generation_mark_ready({lit(gen)}, {arr});", "ready")
    say("generation", f"{gen} -> READY (serving still requires `activate`)")
    return 0


def mode_activate():
    gen = require_generation()
    arr = "array[" + ",".join(lit(c) for c in chunks_for(gen)) + "]::text[]"
    sql(f"select geo.n5_generation_activate({lit(gen)}, {arr});", "activate")
    say("generation", f"{gen} -> ACTIVE")
    return 0


def require_reason():
    if not REASON:
        raise SystemExit("STOP: REASON is required for this mode.")
    return REASON


def mode_rollback():
    gen = require_generation()
    sql(f"select geo.n5_generation_rollback({lit(gen)}, {lit(require_reason())});", "rollback")
    say("generation", f"{gen} restored as the serving generation")
    return 0


def mode_fail():
    gen = require_generation()
    sql(f"select geo.n5_generation_fail({lit(gen)}, {lit(require_reason())});", "fail")
    say("generation", f"{gen} -> FAILED")
    return 0


def mode_discard():
    gen = require_generation()
    r = sql(f"select geo.n5_generation_discard({lit(gen)}) r;", "discard")[0]["r"]
    say("discarded", r)
    return 0


MODES = {"status": lambda: 0, "open": mode_open, "work": mode_work, "publish": mode_publish,
         "unresolved": mode_unresolved, "reconcile": mode_reconcile, "ready": mode_ready,
         "activate": mode_activate, "rollback": mode_rollback, "fail": mode_fail,
         "discard": mode_discard}


def main():
    say("mode", MODE)
    say("worker", WORKER)
    if MODE not in MODES:
        raise SystemExit(f"STOP: unknown MODE {MODE!r}. Known: {sorted(MODES)}")
    rc = MODES[MODE]()
    gen = GENERATION or (discover_building() if MODE in ("work", "publish", "reconcile", "status") else None)
    if gen:
        status(gen)
    return rc


if __name__ == "__main__":
    sys.exit(main() or 0)
