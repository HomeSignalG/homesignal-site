#!/usr/bin/env python3
"""A2 - acquire authoritative geometry for ONE registry in full, off the frozen snapshot.

This is NOT a shard run. `recover_shard` is ZIP3-scoped and reads geo.n5_frozen, so it
acquires whatever slice a shard happens to contain; this acquires a registry's ENTIRE
project set, which is what a features-per-project measurement needs. It advances no
shard, writes no association, and touches no shard state.

WHY THE MEASUREMENT MATTERS: the national RECOVERY storage estimate rests on
4.416 features/project, measured over the only three registries in geo.n5_geom - and all
three are POLYLINE DOT layers, which are 5,510 of 164,185 RECOVERY projects (3.4%). The
A0 probe measured the real distribution: Point 105,227, Polygon 15,656, Polyline 5,510.
So the extrapolation rests on the rarest family. One Point-family registry acquired in
FULL replaces it with a second real data point.

Full, not sampled, on purpose: a partially acquired registry is indistinguishable
afterwards from a complete one, and this repository has paid for that confusion before.

stdlib only.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import lit, STATS  # noqa: E402
from n5_shard import (  # noqa: E402  - imported, never re-derived
    sql, say, one, load_registry, fetch_features, disk_free_mb,
    EXCLUDED_SOURCES, UNRECOVERABLE_BASES, SNAPSHOT,
)

REGISTRY_ID = os.environ.get("REGISTRY_ID", "").strip()


def main():
    t0 = time.time()
    say("N5 A2 - FULL REGISTRY GEOMETRY ACQUISITION", "")
    say("registry", REGISTRY_ID)
    say("snapshot", SNAPSHOT)
    if not REGISTRY_ID:
        raise SystemExit("STOP: REGISTRY_ID is required")
    if REGISTRY_ID in EXCLUDED_SOURCES:
        raise SystemExit(f"STOP: {REGISTRY_ID} is a carried-forward EXCLUSION - "
                         f"{EXCLUDED_SOURCES[REGISTRY_ID]}")

    verdict = sql(f"select treatment, projects, pairs from geo.n5_accepted_source "
                  f"where registry_id={lit(REGISTRY_ID)};", "verdict")
    if not verdict:
        raise SystemExit(f"STOP: {REGISTRY_ID} has no row in geo.n5_accepted_source")
    if verdict[0]["treatment"] != "RECOVERY":
        raise SystemExit(f"STOP: treatment is {verdict[0]['treatment']}, not RECOVERY")
    say("accepted treatment / projects / pairs",
        f"{verdict[0]['treatment']} / {verdict[0]['projects']} / {verdict[0]['pairs']}")

    before = sql(f"""select pg_total_relation_size('geo.n5_geom') b,
                            (select count(*) from geo.n5_geom) rows,
                            (select count(*) from geo.n5_geom where registry_id={lit(REGISTRY_ID)}) mine;""",
                 "before")[0]
    free0, db0, wal0 = disk_free_mb()
    say("BEFORE n5_geom bytes / rows / this registry",
        f"{before['b']} / {before['rows']} / {before['mine']}")
    say("BEFORE free disk MB", round(free0, 1))

    # The candidate set is the registry's WHOLE project set in the frozen snapshot -
    # never a shard slice, and never narrowed by any ZIP association.
    keys = [r["source_key"] for r in sql(f"""
        select distinct i.source_key
          from preservation.app_project_identity i
          left join public.app_projects p on p.id = i.app_project_id
         where i.snapshot_id={lit(SNAPSHOT)} and i.record_kind='development'
           and coalesce(i.registry_id,'(null)')={lit(REGISTRY_ID)}
           and (p.source_key_basis is null or p.source_key_basis not in
                ({','.join(lit(b) for b in UNRECOVERABLE_BASES)}))
         order by 1;""", "keys")]
    say("recoverable projects in the snapshot", len(keys))

    cached = set()
    for i in range(0, len(keys), 500):
        chunk = keys[i:i + 500]
        cached |= {r["source_key"] for r in sql(
            "select source_key from geo.n5_geom where source_key in ("
            + ",".join(lit(k) for k in chunk) + ");", "cache probe")}
    todo = [k for k in keys if k not in cached]
    say("already cached / to fetch", f"{len(cached)} / {len(todo)}")
    if not todo:
        say("RESULT", "nothing to fetch; registry already complete")
        return 0

    reg = load_registry()
    plat, entry = reg.get(REGISTRY_ID, (None, None))
    if entry is None or not entry.get("service_url"):
        raise SystemExit(f"STOP: {REGISTRY_ID} has no service_url in the registry")
    say("platform / service_url", f"{plat} / {entry['service_url']}")

    st = fetch_features(REGISTRY_ID, entry, todo, None)
    say("fetch status", st.get("status"))
    for k in ("fetched", "features", "geometry_type", "batch_errors", "unasked_echoes"):
        say("  " + k, st.get(k))
    if st.get("status") != "OK":
        raise SystemExit(f"STOP: {st.get('status')} - {st.get('reason')}")

    after = sql(f"""select pg_total_relation_size('geo.n5_geom') b,
                           (select count(*) from geo.n5_geom) rows,
                           (select count(*) from geo.n5_geom where registry_id={lit(REGISTRY_ID)}) mine,
                           (select count(distinct source_key) from geo.n5_geom
                             where registry_id={lit(REGISTRY_ID)}) proj,
                           (select count(*) from geo.n5_geom
                             where registry_id={lit(REGISTRY_ID)} and outcome<>1) bad;""",
                "after")[0]
    free1, db1, wal1 = disk_free_mb()
    say("", "")
    say("AFTER n5_geom bytes / rows / this registry",
        f"{after['b']} / {after['rows']} / {after['mine']}")
    say("AFTER free disk MB", round(free1, 1))
    feats, projs = int(after["mine"]), int(after["proj"])
    say("features / projects for this registry", f"{feats} / {projs}")
    if projs:
        say("FEATURES PER PROJECT (the measurement)", round(feats / projs, 3))
    say("rows with outcome<>1 (no usable geometry)", after["bad"])
    say("bytes added to geo.n5_geom", int(after["b"]) - int(before["b"]))
    if feats - int(before["mine"]):
        say("bytes per added feature, all-in",
            round((int(after["b"]) - int(before["b"])) / (feats - int(before["mine"])), 1))
    say("publisher requests / bytes", f"{STATS['requests']} / {STATS['bytes_in']:,}")
    say("seconds", round(time.time() - t0, 1))
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
