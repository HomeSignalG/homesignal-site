#!/usr/bin/env python3
"""Does the PINNED TIGER/ZCTA archive contain a given canonical ZIP? Read-only.

WHY THIS EXISTS, AND WHAT IT REPLACES
-------------------------------------
The classification of a canonical HomeSignal ZIP as `not_measured / NO_ZCTA_IN_TIGER_2025`
is a claim about the pinned Census archive. On 2026-09-06 that claim was nearly made from
`geo.n5_zcta`, which returned 0 for the ZIPs under test AND 0 for its own positive control:
the table is EMPTY (its per-shard slices are correctly discarded at cleanup). A zero from an
empty table is indistinguishable from a real absence, so that instrument cannot establish
absence and must never be used to stamp a state.

This probe reads the SAME pinned archive the geography pipeline is built on -
`scripts/phase2_b1_zcta.py`'s TIGER_URL / TIGER_VINTAGE - and it PROVES ITSELF BEFORE IT
REPORTS:

  1. the archive's sha256 must equal the recorded EXPECT_SHA256 (fails closed);
  2. the DBF and SHP record counts must agree;
  3. the national feature count must equal EXPECTED_NATIONAL_FEATURES (33,791);
  4. every POSITIVE CONTROL ZIP must be PRESENT in the derived GEOID set.

Only if all four hold is a NEGATIVE result (a ZIP absent from the archive) trustworthy.
If any fails the script exits non-zero and reports nothing, because a failed positive
control invalidates the instrument.

THE ZIP LISTS ARE READ FROM THE DATABASE, NEVER TRANSCRIBED (CLAUDE.md rule 7). The
controls and the unresolved population are computed by SQL inside Supabase and returned to
the runner, so this file cannot carry a stale or mis-typed list.

Writes nothing, anywhere. Credential: SUPABASE_ACCESS_TOKEN, for READS only.

  MODE=probe python3 scripts/zcta_membership_probe.py
"""
import hashlib
import io
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from phase2_b1_zcta import (  # the pinned contract, imported not copied
    TIGER_URL, TIGER_VINTAGE, EXPECTED_NATIONAL_FEATURES, PROJECT_REF, UA,
    read_dbf, read_shp,
)

EXPECT_SHA256 = "e87129634eefe8719ef06ce4cfdf6588520be2e359360e590aaae90e4afb1911"

# One query, four populations, each with the control that makes its answer readable.
POPULATIONS_SQL = """
select json_build_object(
  'control_authoritative', (
     select coalesce(json_agg(zip order by zip), '[]'::json) from (
       select r.zip from public.canonical_zip_registry r
         join geo.maps_zip_geography_status s on s.zip = r.zip
        where s.status = 'boundary_complete'
          and exists (select 1 from geo.zip_authoritative_membership m where m.zcta5 = r.zip)
        order by r.zip limit 12) t),
  'control_not_measured', (
     select coalesce(json_agg(zip order by zip), '[]'::json) from (
       select r.zip from public.canonical_zip_registry r
         join geo.maps_zip_geography_status s on s.zip = r.zip
        where s.status = 'not_measured'
        order by r.zip limit 12) t),
  'stateless', (
     select coalesce(json_agg(r.zip order by r.zip), '[]'::json)
       from public.canonical_zip_registry r
      where not exists (select 1 from geo.maps_zip_geography_status s where s.zip = r.zip)),
  'counts', json_build_object(
     'canonical', (select count(*) from public.canonical_zip_registry),
     'boundary_complete', (select count(*) from geo.maps_zip_geography_status where status='boundary_complete'),
     'not_measured', (select count(*) from geo.maps_zip_geography_status where status='not_measured'))
) as j;
"""


def say(k, v):
    print(f"{k:<34} {v}", flush=True)


def read_sql(sql):
    token = os.environ["SUPABASE_ACCESS_TOKEN"]
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json",
                 "Accept": "application/json",
                 "User-Agent": UA},
        method="POST")
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode())


def acquire():
    say("source url", TIGER_URL)
    say("source vintage", TIGER_VINTAGE)
    req = urllib.request.Request(TIGER_URL, headers={"User-Agent": UA})
    h, buf = hashlib.sha256(), io.BytesIO()
    with urllib.request.urlopen(req, timeout=1800) as r:
        say("http status", r.status)
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
            buf.write(chunk)
    data = buf.getvalue()
    say("archive bytes", f"{len(data):,}")
    say("archive sha256", h.hexdigest())
    return data, h.hexdigest()


def geoids(data):
    import zipfile
    zf = zipfile.ZipFile(io.BytesIO(data))
    base = next(n[:-4] for n in zf.namelist() if n.lower().endswith(".dbf"))
    n_rec, field_names, rows = read_dbf(zf.read(base + ".dbf"))
    n_shp = sum(1 for _ in read_shp(zf.read(base + ".shp")))
    say("dbf field names", ", ".join(field_names))
    say("dbf record count", f"{n_rec:,}")
    say("shp record count", f"{n_shp:,}")
    if n_rec != n_shp:
        raise SystemExit(f"STOP: dbf {n_rec} != shp {n_shp}")
    ids = set()
    for row in rows:
        g = row.get("GEOID20") or row.get("ZCTA5CE20")
        if g:
            ids.add(g.strip())
    say("distinct GEOIDs", f"{len(ids):,}")
    return n_rec, ids


def main():
    data, sha = acquire()
    if sha != EXPECT_SHA256:
        raise SystemExit(f"STOP: archive sha256 {sha} != recorded {EXPECT_SHA256}. "
                         "The pinned vintage changed; classification would be against a "
                         "different contract.")
    say("sha256 gate", "PASS — the pinned archive reproduced exactly")

    n_rec, ids = geoids(data)
    if n_rec != EXPECTED_NATIONAL_FEATURES:
        raise SystemExit(f"STOP: national feature count {n_rec} != "
                         f"{EXPECTED_NATIONAL_FEATURES}")
    say("feature-count gate", f"PASS — {n_rec:,} features, as recorded")

    pop = read_sql(POPULATIONS_SQL)
    j = (pop[0] if isinstance(pop, list) else pop["result"][0])["j"]
    if isinstance(j, str):
        j = json.loads(j)
    counts = j["counts"]
    say("canonical registry", counts["canonical"])
    say("boundary_complete", counts["boundary_complete"])
    say("not_measured", counts["not_measured"])

    # ---- THE POSITIVE CONTROL. Everything below is unreadable without it. ----
    ctrl = j["control_authoritative"]
    missing = [z for z in ctrl if z not in ids]
    print()
    say("positive control ZIPs", f"{len(ctrl)} (boundary_complete WITH membership)")
    say("  present in archive", f"{len(ctrl) - len(missing)}")
    say("  ABSENT (must be 0)", len(missing))
    if missing:
        raise SystemExit("STOP: positive control failed — canonical ZIPs with proven "
                         f"authoritative geography are absent from the archive: {missing}. "
                         "A failed positive control invalidates the instrument; no ZIP may "
                         "be classified from its negative results.")
    say("positive-control gate", "PASS — negative results are now trustworthy")

    # ---- The established not_measured population, as a second, INVERSE control. ----
    nm = j["control_not_measured"]
    nm_present = [z for z in nm if z in ids]
    print()
    say("not_measured sample", len(nm))
    say("  present in archive", f"{len(nm_present)}  (expected 0 if the note is true)")
    if nm_present:
        say("  ⚠ PRESENT", ",".join(nm_present))

    # ---- The population under test. ----
    st = j["stateless"]
    st_present = sorted(z for z in st if z in ids)
    st_absent = sorted(z for z in st if z not in ids)
    print()
    say("stateless canonical ZIPs", len(st))
    say("  PRESENT in archive", len(st_present))
    say("  ABSENT from archive", len(st_absent))
    print("----- BEGIN stateless PRESENT (have ZCTA geometry) -----")
    print(",".join(st_present))
    print("----- END stateless PRESENT -----")
    print("----- BEGIN stateless ABSENT (no ZCTA in the pinned vintage) -----")
    print(",".join(st_absent))
    print("----- END stateless ABSENT -----")
    print()
    say("VERDICT", f"{len(st_absent)} absent / {len(st_present)} present of {len(st)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
