#!/usr/bin/env python3
"""n5_capacity.py - THE ONE disk-capacity decision for every N5 geography builder.

WHY THIS EXISTS. Seven builders each carried their own copy of

    DISK_TOTAL_MB = float(os.environ.get("DISK_TOTAL_MB", "11607"))

(one more carried 12,288, another inlined 11607 into SQL). 11,607 MB was never a
reading of the volume: Postgres cannot see the volume and the Supabase Management API
has no disk-size field. On 2026-09-24 the database alone was 11,292 MB plus 1,024 MB of
WAL, so every builder computed NEGATIVE free space, and the founder separately reported
the volume at 69% used. So the constant was not conservative: it was a wrong number.
A wrong number here can let a build proceed as easily as it can block one.

THE RULE NOW
  * Capacity comes from ONE committed record, data/db-capacity.json, which a human
    fills from Supabase -> Project Settings -> Compute and Disk and dates.
  * An unrecorded capacity is a REFUSAL, never a default. A missing file, a null
    field, a non-numeric value or an undated reading all stop the run.
  * The retired DISK_TOTAL_MB override is itself a refusal. Leaving it working would
    keep a second answer that an old dispatch or a stale env block could supply.
  * The record must agree with what the database can measure: if database + WAL +
    the recorded non-database usage already exceed the recorded volume, the record is
    stale and the run refuses rather than trusting either number.
  * The 2,048 MB floor is a MINIMUM. DISK_FLOOR_MB may raise it and can never lower it.

stdlib only.
"""
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RECORD_PATH = os.path.join(HERE, "..", "data", "db-capacity.json")

# The founder's safety floor. Not configurable downward, by design.
SAFETY_FLOOR_MB = 2048.0

RETIRED_ENV = "DISK_TOTAL_MB"

MEASURE_SQL = ("select (pg_database_size(current_database())/1048576.0) db, "
               "(select coalesce(sum(size),0)/1048576.0 from pg_ls_waldir()) wal;")


class CapacityRefused(SystemExit):
    """Raised for every capacity refusal. A SystemExit so an unattended builder stops
    non-zero with the reason as its last line, exactly like the builders' own STOPs."""

    def __init__(self, reason):
        super().__init__("STOP (capacity): " + reason)
        self.reason = reason


def floor_mb(env=None):
    env = os.environ if env is None else env
    raw = env.get("DISK_FLOOR_MB", "").strip()
    if not raw:
        return SAFETY_FLOOR_MB
    try:
        v = float(raw)
    except ValueError:
        raise CapacityRefused(f"DISK_FLOOR_MB={raw!r} is not a number")
    if v != v or v < SAFETY_FLOOR_MB:   # v != v catches NaN, which compares false to everything
        raise CapacityRefused(
            f"DISK_FLOOR_MB={raw} is below the {SAFETY_FLOOR_MB:.0f} MB safety floor. "
            f"The floor can be raised, never lowered.")
    return v


def _number(rec, key, minimum, strict):
    v = rec.get(key)
    if v is None:
        raise CapacityRefused(
            f"{key} is not recorded in data/db-capacity.json. Read it from Supabase -> "
            f"Project Settings -> Compute and Disk and commit it. An unknown capacity is "
            f"never treated as ample.")
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        raise CapacityRefused(f"{key}={v!r} is not a number")
    if (strict and v <= minimum) or (not strict and v < minimum):
        raise CapacityRefused(f"{key}={v} is out of range")
    return float(v)


def load(path=None, env=None):
    """The validated capacity record. Refuses on anything it cannot vouch for."""
    env = os.environ if env is None else env
    if env.get(RETIRED_ENV, "").strip():
        raise CapacityRefused(
            f"{RETIRED_ENV} is set. That override is retired: capacity comes only from "
            f"data/db-capacity.json, so an old env block cannot supply a second answer.")
    path = path or RECORD_PATH
    try:
        with open(path, encoding="utf-8") as fh:
            rec = json.load(fh)
    except FileNotFoundError:
        raise CapacityRefused(f"capacity record {path} does not exist")
    except (OSError, ValueError) as e:
        raise CapacityRefused(f"capacity record {path} is unreadable: {e}")
    if not isinstance(rec, dict):
        raise CapacityRefused("capacity record is not a JSON object")

    provisioned = _number(rec, "provisioned_disk_mb", 0, strict=True)
    non_db = _number(rec, "non_database_mb", 0, strict=False)
    if non_db >= provisioned:
        raise CapacityRefused(
            f"non_database_mb {non_db:.0f} is not smaller than provisioned_disk_mb "
            f"{provisioned:.0f}")

    # YYYY-MM-DD (a time may follow), and a real calendar date. The shape is checked
    # explicitly because Python 3.11's fromisoformat also accepts '20260924' and similar,
    # so it cannot be the only gate on what this record means by a date.
    recorded_at = rec.get("recorded_at")
    try:
        if not re.match(r"^\d{4}-\d{2}-\d{2}(?:$|[T ])", str(recorded_at)):
            raise ValueError
        datetime.date.fromisoformat(str(recorded_at)[:10])
    except (TypeError, ValueError):
        raise CapacityRefused(
            f"recorded_at={recorded_at!r} is not a date. A capacity reading with no date "
            f"cannot be told apart from a stale one.")
    for k in ("recorded_by", "source"):
        if not str(rec.get(k) or "").strip():
            raise CapacityRefused(f"{k} is not recorded")

    return {"provisioned_disk_mb": provisioned, "non_database_mb": non_db,
            "recorded_at": str(recorded_at), "recorded_by": str(rec["recorded_by"]),
            "source": str(rec["source"])}


def free_mb(db_mb, wal_mb, cap):
    """Free space on the volume from ONE measurement and the validated record.

    A record the measurement contradicts is refused rather than trusted: if what the
    database can see already fills the recorded volume, one of the two is wrong, and
    the safe reading is that nothing is known.
    """
    for name, v in (("database MB", db_mb), ("WAL MB", wal_mb)):
        if v is None or v != v or v < 0:
            raise CapacityRefused(f"{name} measurement is unusable: {v!r}")
    used = db_mb + wal_mb + cap["non_database_mb"]
    if used >= cap["provisioned_disk_mb"]:
        raise CapacityRefused(
            f"measured use {used:,.0f} MB (database {db_mb:,.0f} + WAL {wal_mb:,.0f} + "
            f"non-database {cap['non_database_mb']:,.0f}) is not below the recorded volume "
            f"{cap['provisioned_disk_mb']:,.0f} MB (recorded {cap['recorded_at']}). The "
            f"record is stale; re-read Compute and Disk.")
    return cap["provisioned_disk_mb"] - used


def measure(sql_fn=None, path=None, env=None):
    """(free_mb, db_mb, wal_mb). Loads the record BEFORE touching the database, so an
    unrecorded capacity refuses without spending a query."""
    cap = load(path, env)
    if sql_fn is None:
        sys.path.insert(0, HERE)
        from n3_pilot import sql as sql_fn  # noqa: E402 - one implementation, imported
    rows = sql_fn(MEASURE_SQL, "disk", read_only=True)
    if not rows:
        raise CapacityRefused("disk measurement returned no row")
    db, wal = float(rows[0]["db"]), float(rows[0]["wal"])
    return free_mb(db, wal, cap), db, wal


def require_headroom(free, need_mb, floor, what):
    """Refuse unless `need_mb` more can be written and free space stays above the floor."""
    if need_mb is None or need_mb != need_mb or need_mb < 0:
        raise CapacityRefused(f"{what}: projected need {need_mb!r} is unusable")
    after = free - need_mb
    if after < floor:
        raise CapacityRefused(
            f"{what}: free {free:,.0f} MB - projected {need_mb:,.0f} MB = {after:,.0f} MB, "
            f"below the {floor:,.0f} MB floor")
    return after


# The relations one N5 generation writes, measured from the one generation that exists
# rather than estimated. Each is a whole relation (heap + indexes + toast) because an
# index is disk too.
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
     from unnest(array[{rels}]) r) / 1048576.0 as build_mb,
  pg_total_relation_size('preservation.app_project_identity') / 1048576.0 as capture_rel_mb,
  (select reltuples from pg_class where oid = 'preservation.app_project_identity'::regclass)
    as capture_rel_rows,
  (select reltuples from pg_class where oid = 'public.app_projects'::regclass) as live_rows,
  (select setting::numeric from pg_settings where name = 'max_wal_size') as max_wal_mb,
  (select coalesce(sum(size),0)/1048576.0 from pg_ls_waldir()) as wal_mb;
""".replace("{rels}", ",".join("'" + r + "'" for r in GENERATION_RELATIONS))


def projected_generation_mb(sql_fn):
    """What opening and building ONE more generation will write, from measured sizes.

      capture   the per-row size of the existing capture table x ALL live app_projects
                rows (facilities included, so it over-states rather than under-states)
      build     the current size of every relation one generation writes
      wal       room for WAL to grow to max_wal_size before it is recycled

    Row counts are the planner's estimates (pg_class.reltuples), deliberately: an exact
    count(*) over ~3M rows is a full scan on a database already running hot, and the
    estimate is accurate to a few percent. An estimate of zero or below (never analysed)
    refuses rather than projecting a free capture.

    Returned as components so the refusal names which one does not fit.
    """
    r = sql_fn(PROJECTION_SQL, "projection", read_only=True)[0]
    rows = float(r["capture_rel_rows"] or 0)
    live = float(r["live_rows"] or 0)
    if rows <= 0 or live <= 0:
        raise CapacityRefused(
            f"cannot size a capture: row estimates capture={rows:.0f} live={live:.0f} "
            f"(a relation that was never analysed reports <= 0)")
    capture = float(r["capture_rel_mb"]) / rows * live
    wal = max(0.0, float(r["max_wal_mb"]) - float(r["wal_mb"]))
    parts = {"capture_mb": capture, "build_mb": float(r["build_mb"]), "wal_reserve_mb": wal}
    parts["total_mb"] = sum(parts.values())
    return parts


def main():
    """Status print. Exits non-zero when capacity is not usable, so a workflow step
    that runs it reports an unknown capacity as a failure rather than as green."""
    fl = floor_mb()
    free, db, wal = measure()
    print(f"{'database / WAL MB':38} {db:,.0f} / {wal:,.0f}")
    print(f"{'free MB / floor MB':38} {free:,.0f} / {fl:,.0f}")
    if free <= fl:
        raise CapacityRefused(f"free {free:,.0f} MB is at or below the {fl:,.0f} MB floor")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
