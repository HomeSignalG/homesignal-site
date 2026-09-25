#!/usr/bin/env python3
"""n5_capacity.py - THE ONE disk-capacity decision for every builder that writes to the
production database volume in bulk (N5 geography, and the Phase 2 loaders beside it).

WHY THIS EXISTS. Seven builders each carried DISK_TOTAL_MB = 11607 (another 12288,
another inlined 11607 into SQL), and each compared free space to its own floor. 11,607 MB
was never a reading of the volume: Postgres cannot see the volume and the Supabase
Management API has no disk-size field. On 2026-09-24 the database alone was 11,292 MB
plus 1,024 MB of WAL, so every builder computed NEGATIVE free space. A wrong constant can
pass a build as easily as block one.

THE CONTRACT - one decision, fail closed at every step. UNKNOWN CAPACITY = STOP.

  1. WHAT THE NUMBER IS. data/db-capacity.json records the PROVISIONED size of the
     database volume, read by a person from Supabase -> Project Settings -> Compute and
     Disk. It is NOT the database size, free space, used space, a percentage, the Storage
     (object) quota, or an estimate. Every quantity carries an explicit unit
     (MiB | GiB | MB | GB) and is normalised to MiB, the unit the database measures in
     (bytes / 1,048,576). No unit is ever inferred from another.

  2. TRUST BOUNDARY. The record is honoured only inside a GitHub Actions run on
     refs/heads/main, and only when the file on disk is byte-identical to the one
     committed at HEAD. A workflow dispatched from any other ref would otherwise read that
     branch's copy of the file, so the safety decision would belong to whoever chose the
     ref. Same rule, and same reason, as homesignal-ingest's load-feeds-to-db.yml.

  3. FRESHNESS - 24 HOURS. See FRESHNESS_WINDOW below for the derivation.

  4. PLAUSIBILITY. The recorded volume must exceed what the database can measure
     (database + WAL + recorded non-database usage) - otherwise the record is stale - and
     must not exceed PLAUSIBILITY_MAX_RATIO x that measured use - otherwise it is almost
     certainly a unit mistake. See the constant for the derivation.

  5. THE FLOOR. 2,048 MB is a minimum. DISK_FLOOR_MB may raise it and can never lower it.

  6. THE DECISION. require_capacity() refuses unless free - (the operation's projected
     need) stays at or above the floor. Builders call it; none compares a number itself.

stdlib only.
"""
import datetime
import json
import math
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(HERE, ".."))
RECORD_REL = "data/db-capacity.json"
RECORD_PATH = os.path.join(REPO_ROOT, RECORD_REL)

# The founder's safety floor. Not configurable downward, by design.
SAFETY_FLOOR_MB = 2048.0

# Every accepted unit and its exact factor to MiB. MB and GB are DECIMAL (10^6, 10^9
# bytes); MiB and GiB are binary. The Supabase dashboard shows "GB": record it as "GB"
# (decimal) unless the dashboard states GiB. Decimal is the conservative reading of an
# ambiguous "GB": 18 GB = 17,166.1 MiB, whereas 18 GiB = 18,432 MiB, so treating an
# ambiguous figure as decimal can only UNDERSTATE the volume.
UNITS_TO_MIB = {
    "MiB": 1.0,
    "GiB": 1024.0,
    "MB": 1e6 / 1048576.0,
    "GB": 1e9 / 1048576.0,
}

# FRESHNESS. A capacity reading goes stale in the UNSAFE direction in two ways Postgres
# cannot see: non-database usage on the volume grows, and the volume can be changed from
# the dashboard. There is no signal inside the database that would reveal either, so
# the only defence is an age limit, and it must be short enough that a reading always
# describes the day it authorizes.
#   * Every gated builder runs as a bounded job: the N5 workflows cap a run at 55-120
#     minutes and a shard at one lease hour, so a 24-hour reading is at most a day older
#     than the write it authorizes.
#   * A national build runs for days. It therefore REQUIRES an operator to refresh the
#     reading at least daily, and a scheduled tick with a stale reading STOPS rather than
#     carrying a days-old number across a multi-day write. Pausing is the fail-closed
#     outcome the founder asked for when no automatic age can be proven safe.
# Tightening this is a code change; there is no switch that loosens it.
FRESHNESS_WINDOW = datetime.timedelta(hours=24)
# Clock skew tolerated for a reading stamped slightly ahead of the runner's clock.
FUTURE_SKEW = datetime.timedelta(minutes=10)

# PLAUSIBILITY. A unit mistake moves a value by at least ~954x (MiB typed as KB = x1000
# decimal / 1.048576) and usually by 10^6 (bytes typed as MiB). An honest reading lies
# ABOVE measured use (anything below is refused as stale) and, for a volume that
# autoscales as it fills, within a small multiple of it. 100x sits an order of magnitude
# below the smallest unit error and two orders above any plausible over-provisioning, so
# it separates the two without embedding a business ceiling. A genuine volume more than
# 100x current use would be refused, loudly and with this reason - fail closed.
PLAUSIBILITY_MAX_RATIO = 100.0

RETIRED_ENV = "DISK_TOTAL_MB"
REQUIRED_KEYS = ("provisioned_disk", "non_database_usage", "observed_at", "recorded_by", "source")
ALLOWED_KEYS = frozenset(REQUIRED_KEYS) | {"_doc", "notes"}
TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$")

MEASURE_SQL = ("select (pg_database_size(current_database())/1048576.0) db, "
               "(select coalesce(sum(size),0)/1048576.0 from pg_ls_waldir()) wal;")


class CapacityRefused(SystemExit):
    """Every capacity refusal. A SystemExit so an unattended builder stops non-zero with
    the reason as its last line, exactly like the builders' own STOPs."""

    def __init__(self, reason):
        super().__init__("STOP (capacity): " + reason)
        self.reason = reason


# --------------------------------------------------------------------------- floor

def floor_mb(env=None):
    env = os.environ if env is None else env
    raw = str(env.get("DISK_FLOOR_MB", "")).strip()
    if not raw:
        return SAFETY_FLOOR_MB
    try:
        v = float(raw)
    except ValueError:
        raise CapacityRefused(f"DISK_FLOOR_MB={raw!r} is not a number")
    if not math.isfinite(v) or v < SAFETY_FLOOR_MB:
        raise CapacityRefused(
            f"DISK_FLOOR_MB={raw} is below the {SAFETY_FLOOR_MB:.0f} MB safety floor or not "
            f"finite. The floor can be raised, never lowered.")
    return v


# --------------------------------------------------------------------------- trust

def _git(args):
    try:
        r = subprocess.run(["git", "-C", REPO_ROOT] + args, capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as e:
        raise CapacityRefused(f"cannot consult git ({' '.join(args)}): {e}")
    if r.returncode != 0:
        raise CapacityRefused(f"git {' '.join(args)} failed: "
                              f"{r.stderr.decode(errors='replace').strip()[:200]}")
    return r.stdout


def _git_committed(rel):
    return _git(["show", f"HEAD:{rel}"])


def check_trusted_source(path, env=None):
    """Refuse unless this is a main-branch Actions run reading the committed record."""
    env = os.environ if env is None else env
    if str(env.get("GITHUB_ACTIONS", "")).strip().lower() != "true":
        raise CapacityRefused(
            "capacity is trusted only inside a GitHub Actions run on refs/heads/main. "
            "Bulk builders are not a supported local operation.")
    ref = str(env.get("GITHUB_REF", "")).strip()
    if ref != "refs/heads/main":
        raise CapacityRefused(
            f"this run is on {ref or '(no ref)'}, not refs/heads/main. A branch's copy of "
            f"{RECORD_REL} is not a capacity reading; merge it first.")
    # GITHUB_REF names the ref that TRIGGERED the run, not what was checked out: a job on
    # main can still `actions/checkout` another ref. So the checked-out commit must be the
    # triggering main commit, or a branch's record would ride in under a main ref.
    want_sha = str(env.get("GITHUB_SHA", "")).strip()
    head = _git(["rev-parse", "HEAD"]).decode().strip()
    if not want_sha or head != want_sha:
        raise CapacityRefused(
            f"checked-out commit {head[:12] or '(none)'} is not the triggering main commit "
            f"{want_sha[:12] or '(GITHUB_SHA unset)'}; a different ref's record is not trusted")
    if os.path.realpath(path) != os.path.realpath(RECORD_PATH):
        raise CapacityRefused(f"capacity must come from {RECORD_REL}, not {path}")
    with open(path, "rb") as fh:
        on_disk = fh.read()
    if on_disk != _git_committed(RECORD_REL):
        raise CapacityRefused(
            f"{RECORD_REL} on disk differs from the copy committed at HEAD. A value written "
            f"during the run is not a reading.")


# --------------------------------------------------------------------------- record

def _reject_constant(name):
    raise ValueError(f"{name} is not a number")


def _quantity(rec, key, allow_zero):
    q = rec.get(key)
    if not isinstance(q, dict) or set(q) != {"value", "unit"}:
        raise CapacityRefused(
            f"{key} must be an object with exactly 'value' and 'unit', got {q!r}. "
            f"Read it from Supabase -> Project Settings -> Compute and Disk and commit it. "
            f"An unknown capacity is never treated as ample.")
    v, unit = q["value"], q["unit"]
    if v is None or unit is None:
        raise CapacityRefused(
            f"{key} is not recorded in {RECORD_REL}. Read it from Supabase -> Project "
            f"Settings -> Compute and Disk and commit it. An unknown capacity is never "
            f"treated as ample.")
    if unit not in UNITS_TO_MIB:
        raise CapacityRefused(f"{key}.unit={unit!r} is not one of {sorted(UNITS_TO_MIB)}")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise CapacityRefused(f"{key}.value={v!r} is not a number")
    if not math.isfinite(v):
        raise CapacityRefused(f"{key}.value={v!r} is not finite")
    if v < 0 or (v == 0 and not allow_zero):
        raise CapacityRefused(f"{key}.value={v} is out of range")
    return float(v) * UNITS_TO_MIB[unit]


def parse_record(text, now=None):
    """Validate a record's TEXT. Pure: no environment, no git, no database."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    try:
        rec = json.loads(text, parse_constant=_reject_constant)
    except ValueError as e:
        raise CapacityRefused(f"capacity record is unreadable: {e}")
    if not isinstance(rec, dict):
        raise CapacityRefused("capacity record is not a JSON object")
    unknown = sorted(set(rec) - ALLOWED_KEYS)
    if unknown:
        raise CapacityRefused(f"capacity record has unknown field(s) {unknown}; the schema "
                              f"is closed so a misnamed value cannot be silently ignored")
    missing = [k for k in REQUIRED_KEYS if k not in rec]
    if missing:
        raise CapacityRefused(f"capacity record is missing {missing}")

    provisioned = _quantity(rec, "provisioned_disk", allow_zero=False)
    non_db = _quantity(rec, "non_database_usage", allow_zero=True)
    if non_db >= provisioned:
        raise CapacityRefused(f"non_database_usage {non_db:,.0f} MiB is not smaller than "
                              f"provisioned_disk {provisioned:,.0f} MiB")

    ts = rec.get("observed_at")
    if not isinstance(ts, str) or not TS_RE.match(ts):
        raise CapacityRefused(
            f"observed_at={ts!r} is not an ISO-8601 timestamp with a timezone "
            f"(e.g. 2026-09-24T22:00:00Z). A reading with no time cannot be aged.")
    try:
        observed = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        raise CapacityRefused(f"observed_at={ts!r} is not a real date and time")
    if observed > now + FUTURE_SKEW:
        raise CapacityRefused(f"observed_at {ts} is in the future")
    age = now - observed
    if age > FRESHNESS_WINDOW:
        raise CapacityRefused(
            f"the capacity reading is {age.total_seconds() / 3600:.1f} h old; readings are "
            f"trusted for {FRESHNESS_WINDOW.total_seconds() / 3600:.0f} h. Re-read Compute "
            f"and Disk and commit a fresh observed_at.")
    for k in ("recorded_by", "source"):
        if not isinstance(rec.get(k), str) or not rec[k].strip():
            raise CapacityRefused(f"{k} is not recorded")

    return {"provisioned_mib": provisioned, "non_database_mib": non_db,
            "observed_at": ts, "age_hours": age.total_seconds() / 3600,
            "recorded_by": rec["recorded_by"], "source": rec["source"]}


def load(path=None, env=None, now=None):
    """The validated capacity record, from a trusted source only."""
    env = os.environ if env is None else env
    if str(env.get(RETIRED_ENV, "")).strip():
        raise CapacityRefused(
            f"{RETIRED_ENV} is set. That override is retired: capacity comes only from "
            f"{RECORD_REL}, so an old env block cannot supply a second answer.")
    path = path or RECORD_PATH
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except FileNotFoundError:
        raise CapacityRefused(f"capacity record {path} does not exist")
    except (OSError, UnicodeDecodeError) as e:
        raise CapacityRefused(f"capacity record {path} is unreadable: {e}")
    rec = parse_record(text, now)          # validity first: an unknown value is named as such
    check_trusted_source(path, env)
    return rec


# --------------------------------------------------------------------------- arithmetic

def free_mib(db, wal, cap):
    """Free space from ONE measurement and the validated record, or a refusal."""
    for name, v in (("database MiB", db), ("WAL MiB", wal)):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
            raise CapacityRefused(f"{name} measurement is unusable: {v!r}")
    used = db + wal + cap["non_database_mib"]
    if used >= cap["provisioned_mib"]:
        raise CapacityRefused(
            f"measured use {used:,.0f} MiB (database {db:,.0f} + WAL {wal:,.0f} + "
            f"non-database {cap['non_database_mib']:,.0f}) is not below the recorded volume "
            f"{cap['provisioned_mib']:,.0f} MiB (observed {cap['observed_at']}). The record "
            f"is stale or not the provisioned size; re-read Compute and Disk.")
    if cap["provisioned_mib"] > PLAUSIBILITY_MAX_RATIO * used:
        raise CapacityRefused(
            f"recorded volume {cap['provisioned_mib']:,.0f} MiB is more than "
            f"{PLAUSIBILITY_MAX_RATIO:.0f}x measured use {used:,.0f} MiB. That is the "
            f"signature of a unit mistake (bytes or KB typed as MiB), not a real volume.")
    return cap["provisioned_mib"] - used


def _measure(sql_fn):
    rows = sql_fn(MEASURE_SQL, "disk", read_only=True)
    if not rows:
        raise CapacityRefused("disk measurement returned no row")
    try:
        return float(rows[0]["db"]), float(rows[0]["wal"])
    except (KeyError, TypeError, ValueError) as e:
        raise CapacityRefused(f"disk measurement is malformed: {e}")


def _default_sql():
    sys.path.insert(0, HERE)
    from n3_pilot import sql  # noqa: E402 - one implementation, imported
    return sql


def assess(sql_fn=None, operation="", need_mib=0.0, env=None, path=None, now=None):
    """Everything the decision needs, validated. Raises on unknown/invalid capacity;
    reports (does not raise) whether the operation fits."""
    fl = floor_mb(env)
    cap = load(path, env, now)            # before any query: unknown capacity costs nothing
    if (isinstance(need_mib, bool) or not isinstance(need_mib, (int, float))
            or not math.isfinite(need_mib) or need_mib < 0):
        raise CapacityRefused(f"{operation}: projected need {need_mib!r} is unusable")
    db, wal = _measure(sql_fn or _default_sql())
    free = free_mib(db, wal, cap)
    after = free - need_mib
    return {"operation": operation, "free": free, "db": db, "wal": wal, "floor": fl,
            "need": float(need_mib), "after": after, "ok": after >= fl,
            "observed_at": cap["observed_at"], "age_hours": cap["age_hours"]}


def _say(r):
    print(f"{'capacity [' + r['operation'] + ']':38} free {r['free']:,.0f} MiB - need "
          f"{r['need']:,.0f} = {r['after']:,.0f} (floor {r['floor']:,.0f}; reading "
          f"{r['observed_at']}, {r['age_hours']:.1f} h old)", flush=True)


def require_capacity(sql_fn=None, operation="", need_mib=0.0, **kw):
    """THE gate. Refuses unless the operation fits above the floor. Returns the reading."""
    r = assess(sql_fn, operation, need_mib, **kw)
    _say(r)
    if not r["ok"]:
        raise CapacityRefused(
            f"{operation}: free {r['free']:,.0f} MiB - projected {r['need']:,.0f} MiB = "
            f"{r['after']:,.0f} MiB, below the {r['floor']:,.0f} MiB floor")
    return r


def capacity_ok(sql_fn=None, operation="", need_mib=0.0, **kw):
    """For a builder that records a soft HALT rather than raising (n5_shard's per-shard
    advance). Unknown or invalid capacity still RAISES - only 'insufficient' is a bool."""
    r = assess(sql_fn, operation, need_mib, **kw)
    _say(r)
    return r["ok"], r


# --------------------------------------------------------------------------- projections

def wal_reserve_mib(sql_fn):
    """Room for WAL to grow before it is recycled, or None if WAL growth is unbounded.

    max_wal_size is the checkpoint target; replication slots may additionally retain up to
    max_slot_wal_keep_size, and wal_keep_size is held regardless. -1 on the slot setting
    means slots may retain WAL without limit, which is not a number to project."""
    r = sql_fn("""select (select setting::numeric from pg_settings where name='max_wal_size') mw,
                         (select setting::numeric from pg_settings where name='max_slot_wal_keep_size') sk,
                         (select setting::numeric from pg_settings where name='wal_keep_size') wk,
                         (select coalesce(sum(size),0)/1048576.0 from pg_ls_waldir()) wal;""",
               "wal settings", read_only=True)[0]
    if float(r["sk"]) < 0:
        return None
    return max(0.0, float(r["mw"]) + float(r["sk"]) + float(r["wk"]) - float(r["wal"]))


# The relations ONE N5 generation writes, measured from the one generation that exists.
GENERATION_RELATIONS = (
    "geo.n5_association",
    "geo.n5_boundary_membership",
    "geo.zip_authoritative_membership",
    "geo.zip_authoritative_marker",
    "geo.maps_zip_geography_status",
)

PROJECTION_SQL = """
select
  (select coalesce(sum(pg_total_relation_size(to_regclass(r))), 0)
     from unnest(array[{rels}]) r) / 1048576.0 as build_mib,
  pg_total_relation_size('preservation.app_project_identity') / 1048576.0 as capture_rel_mib,
  (select reltuples from pg_class where oid = 'preservation.app_project_identity'::regclass)
    as capture_rel_rows,
  (select reltuples from pg_class where oid = 'public.app_projects'::regclass) as live_rows,
  (select setting::numeric from pg_settings where name = 'temp_file_limit') as temp_limit_kb;
""".replace("{rels}", ",".join("'" + r + "'" for r in GENERATION_RELATIONS))


def generation_projection(sql_fn):
    """Peak space for opening AND building one generation, component by component.

    Each component is MODELED (a number with a stated basis) or UNMODELED (no defensible
    number exists yet). An UNMODELED component makes open() refuse: an unknown term in a
    peak-space sum is not zero. Row counts are pg_class.reltuples, never a count(*) over
    ~3M rows on a database already running hot.
    """
    r = sql_fn(PROJECTION_SQL, "projection", read_only=True)[0]
    rows, live = float(r["capture_rel_rows"] or 0), float(r["live_rows"] or 0)
    if rows <= 0 or live <= 0:
        raise CapacityRefused(f"cannot size a capture: row estimates capture={rows:.0f} "
                              f"live={live:.0f} (a relation never analysed reports <= 0)")
    build = float(r["build_mib"])
    wal = wal_reserve_mib(sql_fn)
    temp_kb = float(r["temp_limit_kb"])
    c = [
        ("capture", float(r["capture_rel_mib"]) / rows * live, "MODELED",
         "measured per-row size of the capture table x ALL live app_projects rows "
         "(facilities included, so it over-states)"),
        ("generation_tables", build, "MODELED",
         "current size, heap + indexes, of every relation one generation writes"),
        ("rollback_retention", 0.0, "MODELED",
         "a new generation is written BESIDE the serving one, so generation_tables is "
         "already additional; the prior generation is never deleted to make room"),
        ("dead_row_rewrite", build, "MODELED",
         "the builders delete-and-reinsert per prefix, leaving at most one dead copy of a "
         "rewritten row until autovacuum: bounded by one more copy of the build relations"),
        ("wal", wal, "MODELED" if wal is not None else "UNMODELED",
         "max_wal_size + max_slot_wal_keep_size + wal_keep_size - current WAL"
         if wal is not None else "max_slot_wal_keep_size = -1: slot WAL retention is unbounded"),
        ("n5_geom_growth", None, "UNMODELED",
         "geometry is fetched for source_keys the capture adds, which are unknown until the "
         "capture exists, and per-key size spans points to large polygons; the cached "
         "average is not a bound"),
        ("temp_files", temp_kb / 1024.0 if temp_kb > 0 else None,
         "MODELED" if temp_kb > 0 else "UNMODELED",
         "temp_file_limit bounds one session's temporary files (builders run one session)"
         if temp_kb > 0 else "temp_file_limit = -1: temporary files (sorts, index builds) "
         "are unbounded on this instance"),
        ("postgres_working_headroom", 0.0, "MODELED",
         "the 2,048 MiB floor is this reserve and is applied on top of the projection"),
    ]
    comps = [{"component": n, "mib": v, "status": s, "basis": b} for n, v, s, b in c]
    return {"components": comps,
            "modeled_mib": sum(x["mib"] for x in comps if x["status"] == "MODELED"),
            "unmodeled": [x["component"] for x in comps if x["status"] == "UNMODELED"]}


def require_generation_fits(sql_fn=None, operation="open", **kw):
    """The gate for opening a national generation. Capacity is validated first, then the
    peak projection; any UNMODELED component refuses, because an unknown term is not 0."""
    sql_fn = sql_fn or _default_sql()
    assess(sql_fn, operation, 0.0, **kw)          # unknown/invalid capacity refuses first
    p = generation_projection(sql_fn)
    for x in p["components"]:
        v = "UNMODELED" if x["mib"] is None else f"{x['mib']:,.0f} MiB"
        print(f"{'projection ' + x['component']:38} {v}  [{x['status']}] {x['basis']}", flush=True)
    if p["unmodeled"]:
        raise CapacityRefused(
            f"{operation}: the peak-space projection cannot be completed - UNMODELED: "
            f"{', '.join(p['unmodeled'])}. A projection with an unknown term cannot show a "
            f"national generation fits, so none is opened.")
    return require_capacity(sql_fn, operation, p["modeled_mib"], **kw)


def main():
    """Status print. Exits non-zero when capacity is not usable."""
    require_capacity(None, "status", 0.0)
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
