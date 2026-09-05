"""Whole-population reconciliation of the ENABLED ZIP set, on a runner.

WHY THIS EXISTS AS A SCRIPT. The inline form outgrew its budget once already and the
UPDATE that followed it rolled back, leaving 662 ZIPs unverified; the note written then
said "do not go back to the inline form - it will time out again as the population grows,
and a timed-out verification is indistinguishable from one that never ran." At 9,764
enabled ZIPs the inline form times out at ~700 ZIPs per request, so the loop belongs
somewhere with no 60-second client cap.

WHAT IT PROVES. Production output and the authoritative relation are read SEPARATELY and
compared bidirectionally - the producer is never asked to justify itself against the table
it was built from in the same query. Every check is stated so the healthy answer is 0, and
each count is paired with a control, because a zero from a filter that matched nothing
looks exactly like a zero from a clean system.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import sql, say, lit  # noqa: E402

FLAT = "geo.n5_recon_flat"
CHUNK = int(os.environ.get("RECON_CHUNK", "250"))
FLOOR = float(os.environ.get("DISK_FLOOR_MB", "2048"))


def disk():
    r = sql("""select 11607 - round(pg_database_size(current_database())/1048576.0)
                     - (select round(sum(size)/1048576.0) from pg_ls_waldir()) free_mb;""",
            "disk", read_only=True)[0]
    return float(r["free_mb"])


def producer_preflight():
    """Prove the producer TOLERATES descriptive drift rather than rolling ZIPs back for it.

    This replaces an earlier preflight that disabled every ZIP whose membership named a
    source_key absent from live app_projects. That was the right action while the producer
    INNER-joined the two and raised; it is the wrong action now. Since
    app_authoritative_projects_for_zip attaches the descriptive row with a LEFT JOIN
    LATERAL, a missing row is attributes_missing=true and the ZIP is healthy - rolling it
    back would remove correct geography from production for an ordinary ingestion event.

    So the check inverts: count the drift, and require that the producer still returns a
    complete answer for the ZIPs carrying it. The healthy answer is "drift exists and
    nothing broke", which is why the drifted-ZIP count is REPORTED rather than gated."""
    r = sql("""
set statement_timeout='300s';
with enabled as (select zip from public.app_zip_geography_cutover where enabled),
 j as (select e.zip, m.source_key from enabled e
         join geo.zip_authoritative_membership m on m.zcta5 = e.zip)
select (select count(*) from j) memberships_checked,
       (select count(*) from j where not exists (
          select 1 from public.app_projects p
           where p.source_key = j.source_key and p.record_kind='development')) drifted_memberships,
       (select count(*) from (
          select zip from j group by zip having count(*) filter (where not exists (
            select 1 from public.app_projects p
             where p.source_key = j.source_key and p.record_kind='development')) > 0) z) drifted_zips;
""", "drift census", read_only=True)[0]
    checked = int(r["memberships_checked"])
    say("enabled memberships checked (control)", f"{checked:,}")
    say("memberships with no live descriptive row", f"{int(r['drifted_memberships']):,}")
    say("ZIPs carrying descriptive drift", f"{int(r['drifted_zips']):,}")
    if checked == 0:
        raise SystemExit("STOP: the drift census matched no memberships, so its numbers "
                         "attest to nothing")
    # Exercise the producer on the drifted ZIPs specifically. If tolerance is working these
    # are exactly the ZIPs that used to raise, so a clean pass here is the whole point.
    probe = sql("""
set statement_timeout='300s';
with enabled as (select zip from public.app_zip_geography_cutover where enabled),
 j as (select e.zip, m.source_key from enabled e
         join geo.zip_authoritative_membership m on m.zcta5 = e.zip),
 drifted as (select zip from j group by zip having count(*) filter (where not exists (
               select 1 from public.app_projects p
                where p.source_key = j.source_key and p.record_kind='development')) > 0
             limit 25),
 called as (select d.zip, public.app_projects_for_zip(d.zip,'development') v from drifted d)
select count(*) probed,
       coalesce(sum(jsonb_array_length(v)),0) records,
       (select count(*) from called c, jsonb_array_elements(c.v) e
         where (e->>'attributes_missing')::boolean) attrs_missing
from called;
""", "drift tolerance probe", read_only=True)[0]
    say("drifted ZIPs probed through the producer",
        f"{int(probe['probed'])} -> {int(probe['records']):,} records, "
        f"{int(probe['attrs_missing']):,} attributes_missing")


def load():
    """Materialise the producer's answer for every enabled ZIP, in bounded chunks.

    The truncate is its own statement: pairing it with the first insert made the whole
    load one transaction, so a timeout discarded the entire batch rather than the chunk.
    """
    n = int(sql("select count(*) n from public.app_zip_geography_cutover where enabled;",
                "enabled", read_only=True)[0]["n"])
    say("enabled ZIPs to reconcile", f"{n:,}")
    sql(f"truncate {FLAT};", "truncate flat")
    parts = (n + CHUNK - 1) // CHUNK
    say("chunks", f"{parts} x {CHUNK}")
    done = 0
    for k in range(parts):
        t = time.time()
        chunk_sql = f"""set statement_timeout='110s';
with e as (select zip, row_number() over (order by zip) rn
             from public.app_zip_geography_cutover where enabled),
 called as (select e.zip, public.app_projects_for_zip(e.zip,'development') j
              from e where e.rn > {k * CHUNK} and e.rn <= {(k + 1) * CHUNK})
insert into {FLAT} (zip, source_key, n_markers, ord, lat, lng)
select c.zip, r->>'source_key',
       jsonb_array_length(coalesce(r->'_markers','[]'::jsonb)),
       (m.ord)::int, (m.v->>'lat')::numeric, (m.v->>'lng')::numeric
from called c,
     lateral jsonb_array_elements(c.j) r,
     lateral jsonb_array_elements(coalesce(r->'_markers','[]'::jsonb))
             with ordinality m(v, ord);"""
        try:
            sql(chunk_sql, f"flat chunk {k + 1}")
        except SystemExit as e:
            if "AUTHORITATIVE INVARIANT" not in str(e):
                raise
            # Reaching here now means GENUINE authoritative corruption, not descriptive
            # drift - the producer tolerates a missing descriptive row and no longer raises
            # for it. There is nothing safe to retry.
            raise SystemExit(
                "STOP: the authoritative invariant raised AFTER the producer was made "
                "drift-tolerant. That is geography corruption, not ingestion churn: "
                + str(e))
        done += CHUNK
        if (k + 1) % 10 == 0 or k + 1 == parts:
            free = disk()
            say(f"  chunk {k + 1}/{parts}", f"{min(done, n):,} ZIPs · {time.time() - t:.1f}s"
                                            f" · free {free:,.0f} MB")
            if free <= FLOOR:
                raise SystemExit(f"STOP: free disk {free:.0f} MB at or below floor {FLOOR:.0f}")
    r = sql(f"select count(*) rows, count(distinct zip) zips from {FLAT};",
            "flat loaded", read_only=True)[0]
    say("flat rows / ZIPs", f"{int(r['rows']):,} / {int(r['zips']):,}")
    return n


def check(n_enabled):
    """Every number here is an equality or a zero, and every zero carries its control."""
    r = sql(f"""
set statement_timeout='300s';
with enabled as (select zip from public.app_zip_geography_cutover where enabled),
 prod as (select distinct f.zip, f.source_key from {FLAT} f),
 rel  as (select m.zcta5::text zip, m.source_key
            from geo.zip_authoritative_membership m join enabled e on e.zip = m.zcta5),
 pmark as (select zip, source_key, ord, lat, lng from {FLAT}),
 rmark as (select k.zcta5::text zip, k.source_key, k.marker_seq ord, k.lat, k.lng
             from geo.zip_authoritative_marker k join enabled e on e.zip = k.zcta5)
select
 (select count(*) from enabled) enabled_zips,
 (select count(*) from prod) production_projects,
 (select count(*) from rel)  membership_rows,
 (select count(*) from pmark) production_markers,
 (select count(*) from rmark) marker_rows,
 (select count(*) from {FLAT} where source_key is null) no_source_key,
 (select count(*) from prod p where not exists
    (select 1 from pmark k where k.zip=p.zip and k.source_key=p.source_key)) project_without_marker,
 (select count(*) from (select zip, source_key from prod group by 1,2 having count(*)>1) d)
   duplicate_source_key,
 (select count(*) from rel r where not exists
    (select 1 from prod p where p.zip=r.zip and p.source_key=r.source_key)) missing_in_production,
 (select count(*) from prod p where not exists
    (select 1 from rel r where r.zip=p.zip and r.source_key=p.source_key)) missing_in_relation,
 (select count(*) from pmark k where not exists
    (select 1 from rmark m where m.zip=k.zip and m.source_key=k.source_key and m.ord=k.ord))
   markers_not_in_relation,
 (select count(*) from pmark k join rmark m
    on m.zip=k.zip and m.source_key=k.source_key and m.ord=k.ord
   where k.lat::text is distinct from m.lat::text
      or k.lng::text is distinct from m.lng::text) coordinate_differences;
""", "reconcile", read_only=True)[0]

    for key, label in (
            ("enabled_zips", "enabled ZIPs"),
            ("production_projects", "production projects"),
            ("membership_rows", "membership rows"),
            ("production_markers", "production markers"),
            ("marker_rows", "marker rows")):
        say(label, f"{int(r[key]):,}")
    ok = True
    if int(r["production_projects"]) != int(r["membership_rows"]):
        say("PROJECTS DO NOT RECONCILE", "production != membership"); ok = False
    if int(r["production_markers"]) != int(r["marker_rows"]):
        say("MARKERS DO NOT RECONCILE", "production != relation"); ok = False
    for key in ("no_source_key", "project_without_marker", "duplicate_source_key",
                "missing_in_production", "missing_in_relation",
                "markers_not_in_relation", "coordinate_differences"):
        v = int(r[key])
        say("  " + key, v if v == 0 else f"{v}  <-- NOT ZERO")
        if v:
            ok = False
    # The controls. A comparison over an empty set returns 0 for every check above, which
    # is why the population sizes have to be non-zero before any of those zeros counts.
    if int(r["enabled_zips"]) != n_enabled:
        say("CONTROL FAILED", f"enabled moved {n_enabled} -> {r['enabled_zips']} mid-run"); ok = False
    if int(r["production_markers"]) == 0 or int(r["production_projects"]) == 0:
        say("CONTROL FAILED", "production returned nothing; the zeros above attest to nothing")
        ok = False
    say("WHOLE-POPULATION RECONCILIATION", "CLEAN" if ok else "FAILED")
    return ok


def main():
    say("N5 whole-population reconciliation", "enabled set")
    say("BEFORE free disk MB", f"{disk():,.0f}")
    producer_preflight()
    n = load()
    ok = check(n)
    say("AFTER free disk MB", f"{disk():,.0f}")
    if not ok:
        raise SystemExit("STOP: whole-population reconciliation did not close")


if __name__ == "__main__":
    main()
