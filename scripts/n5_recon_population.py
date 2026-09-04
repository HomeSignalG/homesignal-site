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


def drift_preflight():
    """Refuse to start if any ENABLED ZIP would make the producer raise.

    Post-cutover drift is real and it is not hypothetical: ordinary ingestion removed 45
    memberships' worth of source_keys from live app_projects across 14 already-verified
    ZIPs, and the first thing that noticed was the producer raising in the middle of chunk
    9 - an HTTP 400 that names one ZIP and says nothing about the other 13. A live page was
    erroring the whole time.

    Set-based, no producer call, so it costs one statement and names every affected ZIP at
    once. The healthy answer is 0 and it carries its control: a membership count that must
    be non-zero, because a join that matched nothing returns 0 failures too."""
    r = sql("""
set statement_timeout='300s';
with enabled as (select zip from public.app_zip_geography_cutover where enabled),
 j as (select e.zip, m.source_key from enabled e
         join geo.zip_authoritative_membership m on m.zcta5 = e.zip)
select (select count(*) from j) memberships_checked,
       (select count(*) from (
          select zip from j group by zip
           having count(*) filter (where not exists (
             select 1 from public.app_projects p
              where p.source_key = j.source_key and p.record_kind='development')) > 0) z) failing_zips,
       (select coalesce(string_agg(zip, ',' order by zip collate "C"), '') from (
          select zip from j group by zip
           having count(*) filter (where not exists (
             select 1 from public.app_projects p
              where p.source_key = j.source_key and p.record_kind='development')) > 0) z2) failing_list;
""", "drift preflight", read_only=True)[0]
    checked = int(r["memberships_checked"])
    failing = int(r["failing_zips"])
    say("enabled memberships checked (control)", f"{checked:,}")
    say("enabled ZIPs whose producer would raise", failing)
    if checked == 0:
        raise SystemExit("STOP: the drift preflight matched no memberships, so its zero "
                         "attests to nothing")
    if failing:
        raise SystemExit(
            f"STOP: {failing} enabled ZIP(s) carry memberships whose source_key is absent "
            f"from live app_projects, so the authoritative producer RAISES for them and "
            f"those live pages are erroring now: {r['failing_list']}\n"
            "Roll them back (set enabled=false, production_geography_verified_at=null) "
            "before reconciling; the invariant is never weakened to admit a ZIP.")


def disable_drifted(lo, hi):
    """Roll back every ENABLED ZIP in this window whose producer would raise.

    Set-based over the window, so one statement finds all of them rather than the single
    ZIP the loop happened to reach. Disabling is the documented reversible rollback: the
    page returns to the legacy branch, which is a correct page. The invariant is never
    weakened to admit a ZIP - that is the whole reason the producer raises."""
    r = sql(f"""
set statement_timeout='110s';
with win as (select zip from (select zip, row_number() over (order by zip) rn
                                from public.app_zip_geography_cutover where enabled) q
              where rn > {lo} and rn <= {hi}),
 bad as (select w.zip,
           count(*) total,
           count(*) filter (where not exists (select 1 from public.app_projects p
             where p.source_key = m.source_key and p.record_kind='development')) missing
          from win w join geo.zip_authoritative_membership m on m.zcta5 = w.zip
         group by 1
        having count(*) filter (where not exists (select 1 from public.app_projects p
             where p.source_key = m.source_key and p.record_kind='development')) > 0)
update public.app_zip_geography_cutover c
   set enabled = false, production_geography_verified_at = null,
       note = 'ROLLED BACK ' || to_char(now(),'YYYY-MM-DD HH24:MI') ||
              ' - post-cutover drift from the LIVE app_projects refresh: ' || b.missing ||
              ' of ' || b.total || ' memberships no longer resolve. Page returns to legacy.'
  from bad b where b.zip = c.zip
returning c.zip;""", f"disable drifted {lo}-{hi}")
    return len(r) if isinstance(r, list) else 0


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
            # DRIFT ARRIVED MID-RUN. The preflight was clean at the start - 0 failing
            # against a control of 139,211 memberships - and a ZIP broke 40 minutes later
            # while public.app_projects was being rewritten by dev_refresh_tick and
            # app_refresh_sweep. A one-shot preflight cannot hold against a live table, so
            # the loop handles it the only correct way: disable the ZIPs whose producer now
            # raises, which returns those pages to legacy, then retry the chunk ONCE.
            # A second failure in the same chunk is fatal - that would mean something other
            # than drift.
            n_off = disable_drifted(k * CHUNK, (k + 1) * CHUNK)
            say(f"  chunk {k + 1} drift", f"{n_off} ZIP(s) rolled back to legacy, retrying")
            if n_off == 0:
                raise SystemExit(
                    f"STOP: chunk {k + 1} raised the authoritative invariant but no ZIP in "
                    "its range carries an unresolvable membership. The cause is not drift.")
            sql(chunk_sql, f"flat chunk {k + 1} retry")
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
    drift_preflight()
    n = load()
    ok = check(n)
    say("AFTER free disk MB", f"{disk():,.0f}")
    if not ok:
        raise SystemExit("STOP: whole-population reconciliation did not close")


if __name__ == "__main__":
    main()
