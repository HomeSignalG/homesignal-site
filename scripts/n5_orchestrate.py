#!/usr/bin/env python3
"""n5_orchestrate.py - the control plane for an unattended national N5 generation.

WHY THIS EXISTS. The 544-shard build completed on 2026-09-05 and stopped, because the unit
of work was "build every ZIP3 prefix once" and every prefix reached state='done'. Nothing
was wrong; there was simply no lifecycle. This script is that lifecycle.

ACTIVATION IS DECIDED BY THE DATABASE, NEVER BY THIS SCRIPT. Worker completion is not
reconciliation success, and reconciliation success is not activation. The decision belongs
to geo.n5_generation_mark_ready() and geo.n5_generation_activate(), which re-derive every
condition against the DECLARED chunk set and raise rather than returning false.
With AUTO_LIFECYCLE=1 (the unattended tick, founder instruction 2026-09-29) the `work` tick
also opens the next generation when none is building and, once a build is complete, CALLS
those gates in order: READY, then the pre-activation proof, then ACTIVATE. A gate that raises
(or a proof that does not pass) stops the tick red; nothing is retried around it.

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
  prove      the PRE-ACTIVATION PROOF for a READY generation (Fix 5, 2026-10-08): render a
             sample of ZIPs in a real browser under the candidate AND the serving generation
             (scripts/n5_preactivation_browser.mjs) and record the result with the declared
             no-boundary list through geo.n5_generation_record_proof, which also runs the data
             checks. A failed proof is recorded and stops the tick red.
  prove_dry  read-only rehearsal of the browser half on real data (GENERATION against BASELINE,
             default its predecessor); records nothing
  activate   hand the DECLARED chunk set to the activation gate. Its COMMIT is the one
             serving switch: Map 1 reads only the ACTIVE / ACTIVE_LEGACY generation. The gate
             refuses unless the newest proof passed against the generation still serving.
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
from n3_pilot import sql, lit, sql_proven  # noqa: E402  - one implementation, imported not re-derived

GENERATION = os.environ.get("GENERATION", "").strip()
MODE = os.environ.get("MODE", "status").strip()
MAX_SHARDS = int(os.environ.get("MAX_SHARDS", "1"))
MAX_SECONDS = int(os.environ.get("MAX_SECONDS", "3000"))
LEASE_SECONDS = int(os.environ.get("LEASE_SECONDS", "3600"))
# Unattended ticks put a halted shard back in the queue until it has been tried this many
# times. A shard rerun is safe by design: it deletes its own partial slice before freezing
# again, and every gate runs again. 2026-10-01: shard 010 of n5-national-2026-10-01 timed out
# freezing ZIP 01001 minutes after the 2.9M-row open (cold statistics), while the next 145
# shards ran clean; a halt is final to n5_claim_shard, so without this the build could never
# finish. A shard that halts this many times stays halted and n5_map1_build alarms.
MAX_SHARD_ATTEMPTS = 3
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
# AUTO LIFECYCLE (founder instruction, 2026-09-29: "swap automatically once checks pass").
# Only the unattended `work` tick with no GENERATION given acts on it. It adds no rule of its
# own: it OPENS when nothing is building, and it calls the SAME ready/activate gates a human
# would, which re-derive every condition and raise on any gap.
AUTO_LIFECYCLE = os.environ.get("AUTO_LIFECYCLE", "").strip() == "1"
AUTO_PREFIX = "n5-national-"
# One build per day at most. A generation takes ~20-28 h end to end, so a newer one opening
# while the last is still young would only compete with it for the same disk.
AUTO_OPEN_MIN_HOURS = float(os.environ.get("AUTO_OPEN_MIN_HOURS", "20"))
# MEASURED 2026-09-29: one generation adds ~2.9 GiB (identity snapshot ~1.1, association
# ~0.66, membership ~0.38, markers ~0.31, boundary ~0.22, proven points ~0.21). Opening
# requires that much above the 2,048 MB floor, so a build is never started that the floor
# would halt half way.
BUILD_RESERVE_MB = float(os.environ.get("BUILD_RESERVE_MB", "3500"))
# READY, the pre-activation proof and ACTIVATE are heavy calls (up to HEAVY_CLIENT_TIMEOUT each; the
# proof also renders ~16 ZIPs twice in a browser, a few minutes). They start only
# while the tick still has room for both inside the 150-minute job; otherwise the next tick
# does them first thing.
FINISH_START_LIMIT_S = int(os.environ.get("FINISH_START_LIMIT_S", "3000"))
# THE PRE-ACTIVATION PROOF (Fix 5). The canonical ZIPs with no Census boundary, as Fix 4
# classified them: read from the committed file every time, never transcribed (claims rule 7).
DECLARED_NO_BOUNDARY_CSV = os.environ.get("DECLARED_NO_BOUNDARY_CSV", "").strip() or \
    os.path.join(HERE, "..", "docs", "maps-coverage", "fix4", "no-boundary-zip-classification.csv")
# How many ZIPs the browser renders under both generations. Every ZIP whose membership changes
# between the two comes first (up to PROOF_CHANGED_ZIPS), then one unmeasured ZIP, then a
# deterministic spread of ordinary ones. The database refuses a proof under 10 ZIPs.
PROOF_ZIPS = int(os.environ.get("PROOF_ZIPS", "16"))
PROOF_CHANGED_ZIPS = int(os.environ.get("PROOF_CHANGED_ZIPS", "8"))
PROOF_MAX_MEMBERS = int(os.environ.get("PROOF_MAX_MEMBERS", "1500"))
# The browser step, as an argv. Tests replace it; production runs the shipped script, and only
# then is the browser installed (ensure_browser) - an hourly tick that does not prove pays nothing.
PROOF_BROWSER_DEFAULT = not os.environ.get("PROOF_BROWSER_CMD", "").strip()
PROOF_BROWSER_CMD = os.environ.get("PROOF_BROWSER_CMD", "").split() or \
    ["node", os.path.join(HERE, "n5_preactivation_browser.mjs")]
# Pinned exactly as the unit-tests workflow pins them, so the proof runs the browser the
# browser suites were proven with.
PROOF_BROWSER_PACKAGES = ["playwright@1.56.0", "leaflet@1.9.4"]
T_START = time.time()


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


# The server's statement_timeout is 120 s. Every lifecycle function below is ONE statement
# that does national work (prepare ~3M snapshot rows, the unresolved accounting, the set-based
# reconcile inside READY and ACTIVATE), so each is sent with an explicit per-statement budget
# and a client wait longer than it: the SERVER gives up and rolls back, never the client.
# MEASURED 2026-09-25: the set-based reconcile alone ran past 110 s on the phase1 snapshot
# (544 chunks, ~3M rows) and READY / ACTIVATE each run it inside ONE call, beside the
# completeness checks and (ACTIVATE) the integrity scan of app_projects. 30 min is inside the
# workflow's 55-minute job, and a timeout is safe: the function rolls back and can be re-run.
HEAVY_STATEMENT_TIMEOUT = "1800s"
HEAVY_CLIENT_TIMEOUT = 2400
# MEASURED 2026-09-26: the Management API sits behind a gateway that cuts every request at
# 120 s (HTTP 524) while the database KEEPS EXECUTING and commits - n5_gen_prepare_publish
# returned 524 at 21:59:14 and its publish_prepared_at + 720,460 proven points were there
# afterwards. So a 524 on a heavy call means "outcome unknown", never "failed" and never
# "re-send": heavy() waits for its own backend to leave pg_stat_activity, then the caller's
# POST-CONDITION (read from the database) decides. The write is never issued twice.


def heavy(query, tag, verify=None):
    """Run one national lifecycle statement through n3_pilot.sql_proven: `verify` proves the
    outcome from database state when the gateway loses the response; without it a lost
    response stays fatal (fail closed), exactly as before."""
    return sql_proven(f"set statement_timeout = '{HEAVY_STATEMENT_TIMEOUT}';\n" + query, tag,
                      verify, timeout=HEAVY_CLIENT_TIMEOUT, max_wait=HEAVY_CLIENT_TIMEOUT,
                      say=lambda m: say(tag, m))


def _verify_prepared(gen):
    return (f"select publish_prepared_at is not null ok, publish_prepared_at "
            f"from geo.n5_generation where generation_id={lit(gen)};")


def _verify_unresolved(gen):
    return (f"select g.unresolved_recorded_at is not null and g.unresolved_recorded_at >= "
            f"coalesce((select max(p.completed_at) from geo.n5_generation_publish p "
            f"where p.generation_id=g.generation_id), '-infinity') ok, g.unresolved_recorded_at "
            f"from geo.n5_generation g where g.generation_id={lit(gen)};")


def _verify_state(gen, want):
    return (f"select state = {lit(want)} ok, state from geo.n5_generation "
            f"where generation_id={lit(gen)};")


def mode_open():
    return open_generation(require_generation())


def open_generation(gen):
    """Capture an immutable snapshot and open a generation bound to it.

    THE SNAPSHOT IS ONE TRANSACTION, deliberately. Its whole value is that the expected set
    cannot move afterwards; a chunked capture would be a set assembled from several different
    instants of a table that is rewritten every two minutes, which is not a watermark.
    """
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
    # The transaction outlives the API gateway's 120 s (measured 2026-09-27: HTTP 524 at 125 s,
    # committed, generation BUILDING with its full manifest). A lost response is proven from
    # state, never re-sent: the generation row carrying THIS run's cutoff exists only if this
    # transaction committed, because every statement above and below commits together.
    open_verify = (f"select count(*) = 1 ok from geo.n5_generation g "
                   f"where g.generation_id={lit(gen)} and g.snapshot_id={lit(snapshot_id)} "
                   f"and g.cutoff = {lit(cutoff)}::timestamptz "
                   f"and exists (select 1 from geo.n5_shard s where s.generation_id=g.generation_id);")
    sql_proven(f"""set statement_timeout = '{OPEN_STATEMENT_TIMEOUT}';
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
             group by left(e.zip,3);""", "open (one transaction)", open_verify,
               timeout=3000, max_wait=3000, say=lambda m: say("open", m))

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
    auto = AUTO_LIFECYCLE and not GENERATION
    if auto:
        pending = generations_in("READY")
        if len(pending) > 1:
            raise SystemExit(f"STOP: {len(pending)} generations are READY ({','.join(pending)}). "
                             f"Refusing to guess which one to activate.")
        if pending:
            # A READY generation left by an earlier tick (its proof or activate was deferred,
            # lost or refused). The proof is taken again: it must be against the generation
            # serving NOW.
            prove(pending[0])
            activate(pending[0])
            retire_superseded()
            return 0
        # Catch-up, and before any open: an old build's space is reusable by the next one.
        retire_superseded()
    gen = GENERATION or discover_building()
    if not gen and auto:
        gen = auto_open()
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
    if auto:
        requeue_halted(gen)
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
    if auto:
        auto_finish(gen)
    return 0


def requeue_halted(gen):
    """Put halted shards tried fewer than MAX_SHARD_ATTEMPTS times back in the queue."""
    rows = sql(f"""update geo.n5_shard set state='pending', claimed_by=null, claim_expires_at=null
                    where generation_id={lit(gen)} and state='halted'
                      and attempts < {MAX_SHARD_ATTEMPTS}
                   returning z3, attempts;""", "requeue halted")
    for r in rows or []:
        say("requeued halted shard", f"{r['z3']} (tried {r['attempts']} of {MAX_SHARD_ATTEMPTS})")
    return len(rows or [])


def generations_in(state):
    return [r["generation_id"] for r in sql(
        f"select generation_id from geo.n5_generation where state={lit(state)} order by opened_at;",
        f"generations {state}", read_only=True)]


def free_disk_mb():
    """Free disk by the SAME formula and floor the shards halt on (n5_shard.disk_free_mb):
    one definition, so the open decision and the shard floor can never disagree."""
    from n5_shard import disk_free_mb, DISK_FLOOR_MB  # noqa: E402 - one implementation
    return disk_free_mb()[0], DISK_FLOOR_MB


def auto_open():
    """Open today's national generation, or say exactly why not. Every refusal is a clean
    no-op, never a guess: a newer build than 20 h, a FAILED newest build (a failure needs a
    human to discard it first), today's name already taken, or too little disk."""
    newest = sql("select generation_id, state, extract(epoch from now() - opened_at)/3600.0 h "
                 "from geo.n5_generation order by opened_at desc limit 1;", "newest",
                 read_only=True)
    if newest:
        n = newest[0]
        if n["state"] == "FAILED":
            say("auto open", f"skipped - newest generation {n['generation_id']} is FAILED; "
                             f"discard it before another build opens")
            return None
        if float(n["h"]) < AUTO_OPEN_MIN_HOURS:
            say("auto open", f"skipped - newest generation {n['generation_id']} opened "
                             f"{float(n['h']):.1f} h ago (< {AUTO_OPEN_MIN_HOURS:g} h)")
            return None
    gen = AUTO_PREFIX + time.strftime("%Y-%m-%d", time.gmtime())
    if sql(f"select 1 from geo.n5_generation where generation_id={lit(gen)};", "exists",
           read_only=True):
        say("auto open", f"skipped - {gen} already exists")
        return None
    free, floor = free_disk_mb()
    say("free MB (floor + reserve)", f"{free:,.0f} ({floor:,.0f} + {BUILD_RESERVE_MB:,.0f})")
    if free < floor + BUILD_RESERVE_MB:
        say("auto open", "skipped - not enough disk for a whole build above the floor")
        return None
    say("auto open", gen)
    open_generation(gen)
    return gen


def build_complete(gen):
    """Every shard done, every prefix published, unresolved recorded after the last publish.
    Only decides WHETHER to call the gates; the gates re-derive all of it themselves."""
    if shards_unfinished(gen) or unpublished_prefixes(gen):
        return False
    return bool(sql(_verify_unresolved(gen), "unresolved fresh", read_only=True)[0]["ok"])


def auto_finish(gen):
    if not build_complete(gen):
        say("auto finish", "build not complete yet")
        return 0
    if time.time() - T_START > FINISH_START_LIMIT_S:
        say("auto finish", "build complete - READY/activate deferred to the next tick (time)")
        return 0
    ready(gen)
    prove(gen)
    activate(gen)
    retire_superseded()
    return 0


# RETENTION (founder, 2026-09-29: "keep 2"). Keep the serving generation and its predecessor,
# which is the rollback target and the baseline "newly visible" is measured against; the
# database's own discard refuses both anyway. Every OTHER superseded generation is retired:
# its build rows (geo.n5_generation_discard, the one existing rule) and then its capture in
# preservation.app_project_identity, which discard does not touch (~1.1 GiB each).
# NEVER a protected snapshot: phase1-2026-09-01 is protected by founder ruling (2026-09-01)
# and the table's guard_frozen trigger refuses the delete regardless; a generation built on
# it is excluded here entirely, geo rows included. Never a FAILED generation either - a
# failure is left for a human to read before it is discarded.
# A DELETE does not shrink the database; autovacuum makes the space reusable, and the next
# build's inserts into the same tables reuse it, so measured size stops growing by a build a
# day. The auto-open disk check stays on the measured figure, which errs on the safe side.
# THE CANDIDATE LIST READS ONLY THE TINY CATALOG TABLE (2026-10-06). It used to carry the two
# "does this generation still have rows" probes as correlated EXISTS subqueries, and with a
# correlated parameter the planner prices an average-sized generation, so it chose a sequential
# scan of geo.zip_authoritative_membership (1.8 GB) and preservation.app_project_identity
# (5.7 GB) per candidate. A generation already retired has no rows, so its probe read the WHOLE
# table and found nothing: four retired candidates blew the 120 s statement timeout, every tick
# died here ("SQL retire candidates failed HTTP 400 ... 57014") before it could open the daily
# build, and no Map 1 generation opened for 4 days. The probes now run one per candidate with
# the id as a LITERAL (see _has_rows_sql / _has_snapshot_sql), which the planner prices from the
# column's own statistics: an index-only scan, cost ~1.7 either way.
RETIRE_CANDIDATES_SQL = """
select g.generation_id, g.snapshot_id
  from geo.n5_generation g
 where g.state = 'SUPERSEDED'
   and exists (select 1 from geo.n5_generation s where s.state = 'ACTIVE')
   and g.generation_id is distinct from
       (select s.predecessor_generation_id from geo.n5_generation s
         where s.state in ('ACTIVE', 'ACTIVE_LEGACY'))
   and not exists (select 1 from preservation.protected_snapshot p
                    where p.snapshot_id = g.snapshot_id)
   and not exists (select 1 from geo.n5_generation o
                    where o.snapshot_id = g.snapshot_id and o.generation_id <> g.generation_id)
 order by g.opened_at;"""


def _has_rows_sql(gen):
    """Does this generation still hold build rows? A LITERAL id on purpose: it is priced from
    the column statistics and served by zip_authoritative_membership_gen_source (see the note
    on RETIRE_CANDIDATES_SQL for what the correlated form cost)."""
    return (f"select exists (select 1 from geo.zip_authoritative_membership "
            f"where generation_id={lit(gen)}) ok;")


def _has_snapshot_sql(snap):
    """Does this snapshot still hold its capture? Literal id, served by the primary key."""
    return (f"select exists (select 1 from preservation.app_project_identity "
            f"where snapshot_id={lit(snap)}) ok;")


def _verify_discarded(gen):
    return (f"select not exists (select 1 from geo.zip_authoritative_membership "
            f"where generation_id={lit(gen)}) and not exists (select 1 from geo.n5_association "
            f"where generation_id={lit(gen)}) ok;")


def _verify_snapshot_gone(snap):
    return (f"select not exists (select 1 from preservation.app_project_identity "
            f"where snapshot_id={lit(snap)}) ok;")


def retire_superseded():
    """Retire every superseded generation outside the kept two. Idempotent: a generation
    whose rows and snapshot are already gone is skipped, so a lost response or a killed run
    is finished by the next tick."""
    done = 0
    for r in sql(RETIRE_CANDIDATES_SQL, "retire candidates", read_only=True):
        gen, snap = r["generation_id"], r["snapshot_id"]
        has_rows = bool(sql(_has_rows_sql(gen), "retire probe rows", read_only=True)[0]["ok"])
        has_snapshot = bool(sql(_has_snapshot_sql(snap), "retire probe snapshot",
                                read_only=True)[0]["ok"])
        if not (has_rows or has_snapshot):
            continue  # already retired on an earlier tick
        if has_rows:
            heavy(f"select geo.n5_generation_discard({lit(gen)}) r;", "discard",
                  verify=_verify_discarded(gen))
            say("retired build rows", gen)
        if has_snapshot:
            heavy(f"delete from preservation.app_project_identity where snapshot_id={lit(snap)};",
                  "retire snapshot", verify=_verify_snapshot_gone(snap))
            say("retired snapshot", snap)
        done += 1
    if not done:
        say("retention", "nothing to retire (keeping the serving build and its predecessor)")
    return done


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
    prepared = sql(f"select publish_prepared_at from geo.n5_generation where generation_id={lit(gen)};",
                   "prepared?", read_only=True)[0]["publish_prepared_at"]
    if not prepared:
        # Once, after every shard is done and before any prefix: the generation's own proven
        # points and verdicts, and its recovered candidate key set (part D, D6).
        r = heavy(f"select geo.n5_gen_prepare_publish({lit(gen)}) r;", "prepare",
                  verify=_verify_prepared(gen))
        say("publication prepared", r[-1]["r"] if r else "verified from state")
    t0 = time.time()
    run_id = f"pub-{WORKER}"
    todo = unpublished_prefixes(gen)
    say("prefixes to publish", len(todo))
    for i, z3 in enumerate(todo):
        if time.time() - t0 >= budget_seconds:
            say("publish", "budget spent - resuming next tick")
            return 0
        if i % ANALYZE_EVERY_PREFIXES == 0:
            analyze_publish_tables()
        publish_prefix(gen, z3, run_id)
    if not unpublished_prefixes(gen):
        stale = sql(f"select (g.unresolved_recorded_at is null or g.unresolved_recorded_at < "
                    f"(select max(p.completed_at) from geo.n5_generation_publish p "
                    f"where p.generation_id=g.generation_id)) s from geo.n5_generation g "
                    f"where g.generation_id={lit(gen)};", "unresolved stale", read_only=True)[0]["s"]
        if stale:
            r = heavy(f"select geo.n5_gen_record_unresolved({lit(gen)}) r;", "unresolved",
                      verify=_verify_unresolved(gen))
            say("unresolved outcomes recorded", r[-1]["r"] if r else "verified from state")
    return 0


# FRESH STATISTICS BEFORE PUBLISHING (measured 2026-10-01). geo.n5_gen_publish_prefix joins the
# boundary rows it has just written for the generation being built. Autoanalyze waits for ~10%
# of a table to change, and these tables hold several generations (~2.5M rows), so for most of a
# build their statistics say the new generation has NO rows. The planner then drives step (2)
# from every boundary row of the generation instead of from the prefix's ~24 ZIP boundaries:
# prefix 284 (120,049 rows) went from under a minute in the 09-29 build to past its 5,400 s
# budget on every retry, and the build stalled 7 h (caught by the n5_map1_build alarm). One
# ANALYZE of the three tables restored the plan (EXPLAIN: n5_gen_zcta outer, 24 rows).
# Re-analyzed every ANALYZE_EVERY_PREFIXES prefixes, because the rows keep arriving.
ANALYZE_EVERY_PREFIXES = int(os.environ.get("ANALYZE_EVERY_PREFIXES", "25"))
PUBLISH_ANALYZE_TABLES = ("geo.n5_boundary_membership", "geo.zip_authoritative_membership",
                          "geo.zip_authoritative_marker")


def analyze_publish_tables():
    sql("".join(f"analyze {t};" for t in PUBLISH_ANALYZE_TABLES), "analyze")
    say("statistics refreshed", ", ".join(PUBLISH_ANALYZE_TABLES))


def mode_publish():
    gen = GENERATION or discover_building()
    if not gen:
        say("publish", "no BUILDING generation - nothing to do (clean no-op)")
        return 0
    return publish_pending(gen, MAX_SECONDS)


def mode_unresolved():
    gen = require_generation()
    r = heavy(f"select geo.n5_gen_record_unresolved({lit(gen)}) r;", "unresolved",
              verify=_verify_unresolved(gen))
    say("unresolved outcomes recorded", r[-1]["r"] if r else "verified from state")
    return 0


def mode_reconcile():
    gen = GENERATION or discover_building()
    if not gen:
        say("reconcile", "no BUILDING generation - nothing to do (clean no-op)")
        return 0
    # ONE set-based pass over every declared chunk (part D, D10) - the per-chunk loop
    # re-scanned membership twice per chunk and could not finish inside the job.
    arr = "array[" + ",".join(lit(c) for c in chunks_for(gen)) + "]::text[]"
    row = heavy(f"select * from geo.n5_reconcile_chunks({lit(gen)}, {arr});", "reconcile")[-1]
    say("reconcile", f"chunks={row['chunks']} expected={row['expected_keys']} "
                     f"resolved={row['accounted_resolved']} unresolved={row['accounted_unresolved']} "
                     f"unaccounted={row['unaccounted']}")
    return 0


def mode_ready():
    """BUILDING -> READY, decided by geo.n5_generation_mark_ready: every shard done, every
    prefix published, unresolved outcomes recorded after the last publish, membership and
    markers paired, every canonical ZIP carrying a status, the declared chunks covering the
    whole expected set, and reconciliation recomputed to zero unaccounted. It raises on any
    gap; this script adds no second copy of those rules."""
    return ready(require_generation())


def ready(gen):
    arr = "array[" + ",".join(lit(c) for c in chunks_for(gen)) + "]::text[]"
    heavy(f"select geo.n5_generation_mark_ready({lit(gen)}, {arr});", "ready",
          verify=_verify_state(gen, "READY"))
    say("generation", f"{gen} -> READY (serving still requires `activate`)")
    return 0


def announce_serving_change(gen):
    """Tell the workflow that WHICH generation Map 1 serves just changed. Rule D scores the
    serving membership, so its published plane is stale from this moment; the workflow uses
    this to ask the plane's own refresh (homesignal-ingest) to run now instead of tomorrow.
    Nothing is decided here: no ZIP is named and no page is judged."""
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"n5_serving_changed={gen}\n")


def declared_no_boundary():
    import csv
    with open(DECLARED_NO_BOUNDARY_CSV, newline="", encoding="utf-8") as f:
        zips = sorted({r["zip"].strip() for r in csv.DictReader(f) if r.get("zip", "").strip()})
    if not zips:
        raise SystemExit(f"STOP: no declared no-boundary ZIPs read from {DECLARED_NO_BOUNDARY_CSV}")
    return zips


def proof_sample(gen, base):
    """The ZIPs the browser renders under both generations: changed ones first, then one
    unmeasured, then a deterministic spread. Read-only."""
    rows = sql(f"""
with ch as (
  select zcta5 zip from (
    (select zcta5, source_key from geo.zip_authoritative_membership where generation_id = {lit(gen)}
     except select zcta5, source_key from geo.zip_authoritative_membership where generation_id = {lit(base)})
    union all
    (select zcta5, source_key from geo.zip_authoritative_membership where generation_id = {lit(base)}
     except select zcta5, source_key from geo.zip_authoritative_membership where generation_id = {lit(gen)})) d
  group by zcta5),
c as (select s.zip::text zip, 1 k, md5(s.zip || {lit(gen)}) o
        from geo.maps_zip_geography_status s join ch on ch.zip = s.zip
       where s.generation_id = {lit(gen)} and s.membership_rows <= {PROOF_MAX_MEMBERS}
       order by o limit {PROOF_CHANGED_ZIPS}),
u as (select s.zip::text zip, 2 k, md5(s.zip || {lit(gen)}) o from geo.maps_zip_geography_status s
       where s.generation_id = {lit(gen)} and s.status <> 'boundary_complete' order by o limit 1),
r as (select s.zip::text zip, 3 k, md5(s.zip || {lit(gen)}) o from geo.maps_zip_geography_status s
       where s.generation_id = {lit(gen)} and s.status = 'boundary_complete'
         and s.membership_rows between 1 and {PROOF_MAX_MEMBERS}
       order by o limit {PROOF_ZIPS})
select zip from (select distinct on (zip) zip, k, o from (select * from c union all select * from u
                 union all select * from r) x order by zip, k) y
 order by k, o limit {PROOF_ZIPS};""", "proof sample", read_only=True, timeout=300)
    return [r["zip"] for r in rows]


def proof_input(gen, base, zips):
    """Each sample ZIP's answer under both generations, read through the ONE function Map 1
    reads (geo.n5_zip_projects_markers_at), plus the reader-parity control: the SERVING
    generation's answer through that function must equal the public reader's own answer.
    The control names the serving generation, never `base`: in `prove` they are the same,
    but `prove_dry` may take any baseline, and comparing a non-serving baseline with the
    public reader fails on exactly the ZIPs that changed (run 37804664654, 2026-10-08)."""
    out = {"candidate_generation_id": gen, "baseline_generation_id": base, "zips": []}
    reader_mismatch = []
    # Where the page centres the map: the ZIP's cached report point when there is one (every
    # canonical ZIP in production), else nothing. It decides only the view, never a marker.
    has_reports = sql("select to_regclass('public.development_reports') is not null ok;",
                      "proof reports", read_only=True)[0]["ok"]
    home = (lambda z: f"(select home_lat from public.development_reports where zip = {lit(z)}) home_lat, "
                      f"(select home_lng from public.development_reports where zip = {lit(z)}) home_lng") \
        if has_reports else (lambda z: "null::float8 home_lat, null::float8 home_lng")
    for z in zips:
        r = sql(f"""select geo.n5_zip_projects_markers_at({lit(gen)}, {lit(z)}, 'development') c,
       geo.n5_zip_projects_markers_at({lit(base)}, {lit(z)}, 'development') b,
       geo.n5_zip_projects_markers_at(geo.n5_serving_generation_id(), {lit(z)}, 'development')
         = public.app_zip_projects_markers({lit(z)}, 'development', true) same,
       {home(z)};""", f"proof answers {z}", read_only=True, timeout=300)[0]
        if not r["same"]:
            reader_mismatch.append(z)
        out["zips"].append({"zip": z, "home_lat": r["home_lat"], "home_lng": r["home_lng"],
                            "candidate": r["c"], "baseline": r["b"]})
    return out, reader_mismatch


def ensure_browser():
    """Install playwright + the pinned leaflet build beside the checkout and download Chromium,
    unless they already resolve. Only the shipped browser step needs it."""
    if not PROOF_BROWSER_DEFAULT:
        return
    root = os.path.abspath(os.path.join(HERE, ".."))
    probe = subprocess.run(["node", "-e", "import('playwright').then(()=>process.exit(0),()=>process.exit(1))"],
                           cwd=root)
    if probe.returncode == 0:
        return
    for cmd in (["npm", "install", "--no-save", "--no-audit", "--no-fund"] + PROOF_BROWSER_PACKAGES,
                ["npx", "playwright", "install", "--with-deps", "chromium"]):
        r = subprocess.run(cmd, cwd=root)
        if r.returncode != 0:
            raise SystemExit(f"STOP: prove: could not install the browser ({' '.join(cmd)} exited {r.returncode}).")


def prove(gen):
    """READY -> a recorded pre-activation proof. The browser renders the sample under both
    generations; geo.n5_generation_record_proof runs the data checks and records the result.
    Raises (tick red) unless the recorded proof passed."""
    import tempfile
    state = sql(f"select state from geo.n5_generation where generation_id={lit(gen)};",
                "proof state", read_only=True)
    if not state or state[0]["state"] != "READY":
        raise SystemExit(f"STOP: prove: generation {gen} is not READY.")
    reader = sql("select position('n5_zip_projects_markers_at(geo.n5_serving_generation_id()' in prosrc) > 0 ok "
                 "from pg_proc where oid = 'public.app_zip_projects_markers(text,text,boolean)'::regprocedure;",
                 "proof reader", read_only=True)
    if not reader or not reader[0]["ok"]:
        raise SystemExit("STOP: prove: Map 1's reader does not read through geo.n5_zip_projects_markers_at "
                         "(docs/map1-zip-read-generation.sql is not applied), so the browser cannot render "
                         "the candidate through the code residents run.")
    base_rows = sql("select geo.n5_serving_generation_id() g;", "proof baseline", read_only=True)
    base = base_rows[0]["g"] if base_rows else None
    if not base:
        raise SystemExit("STOP: prove: no generation is serving, so there is nothing to prove against.")
    declared = declared_no_boundary()
    zips = proof_sample(gen, base)
    say("proof sample", f"{len(zips)} ZIP(s) against {base}: {','.join(zips)}")
    data, reader_mismatch = proof_input(gen, base, zips)
    ensure_browser()
    with tempfile.TemporaryDirectory() as d:
        inp, outp = os.path.join(d, "in.json"), os.path.join(d, "out.json")
        with open(inp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        r = subprocess.run(PROOF_BROWSER_CMD + ["--input", inp, "--out", outp])
        if not os.path.exists(outp):
            raise SystemExit(f"STOP: prove: the browser step exited {r.returncode} and wrote no result.")
        with open(outp, encoding="utf-8") as f:
            browser = json.load(f)
    if reader_mismatch:
        browser["reader_mismatch_zips"] = reader_mismatch
        browser["mismatches"] = int(browser.get("mismatches") or 0) + len(reader_mismatch)
        browser["passed"] = False
    import uuid
    run_id = f"{WORKER}-proof-{uuid.uuid4().hex[:12]}"
    arr = "array[" + ",".join(lit(z) for z in declared) + "]::text[]"
    heavy(f"select proof_id from geo.n5_generation_record_proof({lit(gen)}, {lit(run_id)}, {arr}, "
          f"{lit(json.dumps(browser))}::jsonb);", "proof",
          verify=(f"select exists (select 1 from geo.n5_generation_proof where generation_id={lit(gen)} "
                  f"and run_id={lit(run_id)}) ok;"))
    row = sql(f"select proof_id, passed, problems, baseline_generation_id from geo.n5_generation_proof "
              f"where generation_id={lit(gen)} and run_id={lit(run_id)} order by proof_id desc limit 1;",
              "proof read", read_only=True)[0]
    say("proof", f"#{row['proof_id']} against {row['baseline_generation_id']}: "
                 f"{'PASSED' if row['passed'] else 'FAILED'} {json.dumps(row['problems'])} "
                 f"(browser: {browser.get('zips_checked')} ZIP(s), {browser.get('mismatches')} mismatch(es), "
                 f"{browser.get('differing_zips')} changed)")
    if not row["passed"]:
        raise SystemExit(f"STOP: the pre-activation proof for {gen} did not pass: {json.dumps(row['problems'])}. "
                         f"{gen} stays READY; Map 1 keeps serving {base}.")
    return 0


def mode_prove():
    return prove(require_generation())


def mode_prove_dry():
    """READ-ONLY rehearsal of the browser half on real data: render the sample under
    GENERATION and BASELINE (default: GENERATION's recorded predecessor) exactly as `prove`
    does, print the result, record NOTHING. Any state with rows will do, e.g. the serving
    generation against its predecessor. It decides nothing and cannot activate anything."""
    gen = require_generation()
    base = os.environ.get("BASELINE", "").strip()
    if not base:
        rows = sql(f"select predecessor_generation_id p from geo.n5_generation where generation_id={lit(gen)};",
                   "dry baseline", read_only=True)
        base = rows[0]["p"] if rows else None
    if not base:
        raise SystemExit("STOP: prove_dry: no BASELINE given and the generation has no predecessor.")
    zips = proof_sample(gen, base)
    say("dry proof sample", f"{len(zips)} ZIP(s), {gen} against {base}: {','.join(zips)}")
    data, reader_mismatch = proof_input(gen, base, zips)
    ensure_browser()
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        inp, outp = os.path.join(d, "in.json"), os.path.join(d, "out.json")
        with open(inp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        r = subprocess.run(PROOF_BROWSER_CMD + ["--input", inp, "--out", outp])
        browser = json.load(open(outp, encoding="utf-8")) if os.path.exists(outp) else {}
    say("dry proof", f"browser exit {r.returncode}: passed={browser.get('passed')} "
                     f"zips_checked={browser.get('zips_checked')} mismatches={browser.get('mismatches')} "
                     f"changed={browser.get('differing_zips')}; reader parity mismatches: {reader_mismatch or 'none'}")
    if r.returncode != 0 or not browser.get("passed") or reader_mismatch:
        raise SystemExit("STOP: the dry proof did not pass (nothing was recorded).")
    return 0


def mode_activate():
    return activate(require_generation())


def activate(gen):
    arr = "array[" + ",".join(lit(c) for c in chunks_for(gen)) + "]::text[]"
    heavy(f"select geo.n5_generation_activate({lit(gen)}, {arr});", "activate",
          verify=_verify_state(gen, "ACTIVE"))
    say("generation", f"{gen} -> ACTIVE")
    announce_serving_change(gen)
    return 0


def require_reason():
    if not REASON:
        raise SystemExit("STOP: REASON is required for this mode.")
    return REASON


def mode_rollback():
    gen = require_generation()
    sql(f"select geo.n5_generation_rollback({lit(gen)}, {lit(require_reason())});", "rollback")
    say("generation", f"{gen} restored as the serving generation")
    announce_serving_change(gen)
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
         "prove": mode_prove, "prove_dry": mode_prove_dry, "activate": mode_activate, "rollback": mode_rollback, "fail": mode_fail,
         "discard": mode_discard}


def main():
    say("mode", MODE)
    say("worker", WORKER)
    if MODE not in MODES:
        raise SystemExit(f"STOP: unknown MODE {MODE!r}. Known: {sorted(MODES)}")
    rc = MODES[MODE]()
    if MODE == "status":
        free, floor = free_disk_mb()
        say("free MB (floor)", f"{free:,.0f} ({floor:,.0f})")
    gen = GENERATION or (discover_building() if MODE in ("work", "publish", "reconcile", "status") else None)
    if gen:
        status(gen)
    return rc


if __name__ == "__main__":
    sys.exit(main() or 0)
