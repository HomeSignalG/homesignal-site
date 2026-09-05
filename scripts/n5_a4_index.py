"""UNIT A4 step 1-4 - create the measured-required source_key index, then re-benchmark.

A3 measured the authoritative project lookup at p50 2.53 s / p95 13.00 s / max 21.97 s warm,
and traced the cause to structure rather than tuning: the ONLY index carrying source_key is
app_projects_zip_source_key_uidx (zip, source_key, source_seq), where source_key is the SECOND
column, so every distinct key costs a full 431 MB index scan. The set-based alternative is
17.8x slower still because the 2,870 MB heap cannot fit 1,024 MB of shared_buffers.

Two modes:

  index  create public.app_projects (source_key, record_kind) CONCURRENTLY, after asserting
         that no equivalent leading index exists and that free disk stays above the 2 GB hard
         floor on a conservative estimate. Verifies indisvalid afterwards and drops the index
         if the build left it INVALID, because an invalid index is a hard failure gate.

  bench  re-run the EXACT A3 benchmark population and methodology (all 346, server-side
         timing, geo.n5_a3_bench) under new pass numbers so the before/after comparison is
         like-for-like rather than a re-measurement of something else.

Touches no table data, removes no index, and does not change public.app_projects_for_zip.
stdlib only.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import lit  # noqa: E402
from n5_shard import sql, say  # noqa: E402

MODE = os.environ.get("A4_MODE", "index").strip()
RUN_ID = os.environ.get("RUN_ID", "").strip() or f"a4-{int(time.time())}"
FLOOR_MB = float(os.environ.get("DISK_FLOOR_MB", "2048"))
TOTAL_MB = float(os.environ.get("DISK_TOTAL_MB", "11607"))
EST_INDEX_MB = float(os.environ.get("EST_INDEX_MB", "455"))
PASSES = [int(x) for x in os.environ.get("BENCH_PASSES", "3,4").split(",")]

IDX = "app_projects_source_key_kind_idx"
DDL = (f"create index concurrently if not exists {IDX} "
       "on public.app_projects using btree (source_key, record_kind);")


def free_mb():
    r = sql("select (pg_database_size(current_database())/1048576.0) db, "
            "(select coalesce(sum(size),0)/1048576.0 from pg_ls_waldir()) wal;", "disk")[0]
    return TOTAL_MB - (float(r["db"]) + float(r["wal"]))


def build_index():
    pre = sql("""select indexname, indexdef from pg_indexes
                  where schemaname='public' and tablename='app_projects'
                  order by indexname;""", "pre indexes")
    say("existing indexes", len(pre))
    for r in pre:
        say("  " + r["indexname"], r["indexdef"].split(" USING ")[-1])

    # A leading source_key index would make this redundant. Checked, not assumed.
    leading = [r for r in pre if "btree (source_key" in r["indexdef"]]
    if leading:
        raise SystemExit(f"STOP: an equivalent leading index already exists: {leading}")
    say("equivalent leading source_key index exists", "no")

    f0 = free_mb()
    say("BEFORE free disk MB", round(f0, 1))
    say("conservative estimate MB / hard floor MB", f"{EST_INDEX_MB} / {FLOOR_MB}")
    if f0 - EST_INDEX_MB < FLOOR_MB:
        raise SystemExit(f"STOP: {f0:.1f} - {EST_INDEX_MB} would fall below the {FLOOR_MB} floor")
    say("projected free after build MB", round(f0 - EST_INDEX_MB, 1))

    say("DDL", DDL)
    t0 = time.time()
    sql(DDL, "create index concurrently")
    secs = time.time() - t0
    say("build seconds", round(secs, 1))

    chk = sql(f"""select i.indisvalid, i.indisready,
                   pg_relation_size(c.oid) bytes,
                   pg_size_pretty(pg_relation_size(c.oid)) sz,
                   pg_get_indexdef(c.oid) def
              from pg_class c join pg_index i on i.indexrelid = c.oid
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname='public' and c.relname={lit(IDX)};""", "verify")
    if not chk:
        raise SystemExit("STOP: index was not created")
    r = chk[0]
    say("indisvalid / indisready", f"{r['indisvalid']} / {r['indisready']}")
    say("index size", r["sz"])
    say("index definition", r["def"])

    # An INVALID index is a hard failure gate: it is not usable by the planner and would
    # silently keep the slow path while occupying disk. Drop it rather than leave it.
    if not r["indisvalid"]:
        say("INVALID index", "dropping")
        sql(f"drop index concurrently if exists public.{IDX};", "drop invalid")
        raise SystemExit("STOP: index built INVALID and was dropped")

    f1 = free_mb()
    say("AFTER free disk MB", round(f1, 1))
    say("actual cost MB", round(f0 - f1, 1))
    if f1 < FLOOR_MB:
        raise SystemExit(f"STOP: free {f1:.1f} MB below the {FLOOR_MB} hard floor")

    # Does the planner actually choose it? EXPLAIN alone is not the performance claim
    # (that is the bench mode) but a planner that ignores the index is a build that failed
    # at its purpose.
    plan = sql("""explain (format text)
                  select count(*) from public.app_projects
                   where source_key = (select source_key from geo.zip_authoritative_membership limit 1)
                     and record_kind = 'development';""", "planner check")
    txt = " ".join(str(v) for row in plan for v in row.values())
    say("planner uses the new index", "YES" if IDX in txt else f"NO -> {txt[:200]}")


def bench():
    zips = [r["zip"].strip() for r in sql(
        "select zip::text zip from geo.maps_zip_geography_status "
        "where note like '%cutover flag cleared 2026-09-03%' order by zip;", "346 zips")]
    if len(zips) != 346:
        raise SystemExit(f"STOP: expected 346 candidates, found {len(zips)}")
    say("ZIPs to benchmark", len(zips))
    for p in PASSES:
        say("PASS", f"{p} ({'cold-ish' if p == PASSES[0] else 'warm/repeat'})")
        t0 = time.time()
        for i in range(0, len(zips), 4):
            chunk = zips[i:i + 4]
            sql(";".join(f"select geo.n5_a3_bench_one({lit(z)},{p},{lit(RUN_ID)})" for z in chunk) + ";",
                f"bench p{p} {chunk[0]}")
            if (i // 4) % 20 == 0:
                say("  progress", f"{min(i+4, len(zips))}/{len(zips)}  {time.time()-t0:.0f}s")
        say(f"PASS {p} wall seconds", round(time.time() - t0, 1))
    for row in sql("""select pass_no, count(*) n, round((sum(ms_project)/1000.0)::numeric,1) total_s,
                 round(percentile_disc(0.5) within group (order by ms_project)::numeric,1) p50,
                 round(percentile_disc(0.95) within group (order by ms_project)::numeric,1) p95,
                 round(percentile_disc(0.99) within group (order by ms_project)::numeric,1) p99,
                 round(max(ms_project)::numeric,1) mx, sum(rows_project) rows_p, sum(rows_marker) rows_m,
                 count(*) filter (where ms_project > 30000) timeouts
               from geo.n5_a3_bench group by pass_no order by pass_no;""", "summary"):
        say(f"pass {row['pass_no']}",
            f"n={row['n']} total_s={row['total_s']} p50={row['p50']} p95={row['p95']} "
            f"p99={row['p99']} max={row['mx']} rows={row['rows_p']}/{row['rows_m']} "
            f"timeouts={row['timeouts']}")


def main():
    say("UNIT A4", MODE)
    say("run id", RUN_ID)
    if MODE == "index":
        build_index()
    elif MODE == "bench":
        bench()
    else:
        raise SystemExit(f"STOP: unknown A4_MODE {MODE!r}")


if __name__ == "__main__":
    main()
