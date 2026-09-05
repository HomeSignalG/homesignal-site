#!/usr/bin/env python3
"""GATE 0-3 for the Regulated-facility whole-ZIP build: prove the bulk EPA FRS source
is the SAME facility universe the shipped radius path serves, before any of it is written.

READ-ONLY. Every database statement goes through sql(read_only=True), which refuses on
any write word, so this cannot write even if a future edit tried to.

WHY A RUNNER. The build sandbox has no egress: the agent proxy answers CONNECT for
ordsext.epa.gov:443 with 403 (policy denial, recorded in its own status endpoint). Postgres
has egress via pg_net but cannot unzip a multi-GB archive. So this runs where the repo's
other acquisition work already runs — a manually dispatched GitHub runner, receipts on the
job log — exactly like phase2_b1_zcta.py acquires TIGER.

THE QUESTION THIS ANSWERS, AND THE ONE IT DOES NOT.
  It does NOT ask "are the two populations the same size". They cannot be: the radius path
  is incomplete by construction, which is the defect being fixed. Expecting a match would
  be measuring the bug.
  It asks: does the bulk file carry the SAME physical-facility IDENTITY (RegistryId) and the
  SAME coordinate semantics (Latitude83/Longitude83) that the existing Regulated facility
  Type is built on — so that swapping the acquisition changes only COMPLETENESS, never what
  a facility IS or where it is.

NOTHING IS GUESSED. The artifact URL is discovered from EPA's own download page rather than
typed from memory; a candidate that cannot be discovered is reported, never assumed.
"""
import csv
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import sql, say, lit  # noqa: E402  — one implementation, imported not re-derived
from frs_eligibility import looks_industrial, INCLUDE, EXCLUDE  # noqa: E402

UA = "HomeSignal-frs-gate0/1.0 (+https://homesignal.net)"
MODE = os.environ.get("MODE", "frs-gate0").strip()
WORK = os.environ.get("WORK_DIR", "/tmp/frs").rstrip("/")
# EPA's own landing page for the FRS state/national single-file CSV downloads. The ARTIFACT
# url is read out of this page, so a moved file is discovered rather than 404'd against a
# remembered path.
EPA_PAGE = "https://www.epa.gov/frs/epa-frs-facilities-state-single-file-csv-download"
# The file the previous probe (docs/proposals/epa-outage-fallback-and-copy.md, 2026-08-10)
# recorded as reachable. Used ONLY to recognise the right link among the page's many; never
# fetched unless the page itself offers it, unless ALLOW_FALLBACK_URL is explicitly set.
ARTIFACT_HINT = "national_single.zip"
ALLOW_FALLBACK = os.environ.get("ALLOW_FALLBACK_URL", "").strip() == "1"
FALLBACK_URL = "https://ordsext.epa.gov/FLA/www3/state_files/national_single.zip"

# How many real FRS names to emit for the Node differential (Gate 1 at national scale).
NAME_SAMPLE = int(os.environ.get("NAME_SAMPLE", "60000"))
# Two coordinates are "materially different" past this. ~11 m at the equator: far below any
# real parcel, far above float formatting noise. Conflicts are QUANTIFIED, never merged away.
COORD_EPS = 1e-4


def fetch(url, timeout=1800, dest=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if dest is None:
            return r.status, r.read(), dict(r.headers)
        h = hashlib.sha256()
        n = 0
        t0 = time.time()
        with open(dest, "wb") as f:
            while True:
                chunk = r.read(1 << 22)
                if not chunk:
                    break
                f.write(chunk); h.update(chunk); n += len(chunk)
                if n % (1 << 28) < (1 << 22):
                    say("  downloaded", f"{n/1e9:.2f} GB in {time.time()-t0:.0f}s")
        return r.status, (n, h.hexdigest()), dict(r.headers)


# ── GATE 0 ────────────────────────────────────────────────────────────────────────────
def discover():
    """The exact official artifact, found on EPA's page rather than remembered."""
    say("GATE 0", "artifact discovery")
    try:
        status, body, _ = fetch(EPA_PAGE, timeout=120)
    except Exception as e:  # noqa: BLE001
        if not ALLOW_FALLBACK:
            raise SystemExit(f"STOP: EPA download page unreachable ({e}) and "
                             "ALLOW_FALLBACK_URL is not set — refusing to guess a URL")
        say("epa page", f"UNREACHABLE ({e}) — using recorded fallback under explicit opt-in")
        return FALLBACK_URL, "fallback:docs/proposals/epa-outage-fallback-and-copy.md"
    html = body.decode("utf-8", "replace")
    hrefs = re.findall(r'href="([^"]+\.zip)"', html)
    say("epa page", f"HTTP {status}, {len(html)} bytes, {len(hrefs)} .zip links")
    hits = [h for h in hrefs if ARTIFACT_HINT in h.lower()]
    if not hits:
        sample = sorted({h.rsplit("/", 1)[-1] for h in hrefs})[:12]
        raise SystemExit(f"STOP: no link matching {ARTIFACT_HINT!r} on the EPA page. "
                         f"Links seen: {sample}")
    url = hits[0]
    if url.startswith("/"):
        url = "https://www.epa.gov" + url
    say("artifact url", url)
    say("discovery basis", "EPA FRS download page link, not a remembered path")
    return url, "epa_download_page"


def acquire(url):
    os.makedirs(WORK, exist_ok=True)
    dest = f"{WORK}/frs_national_single.zip"
    say("downloading", url)
    status, (nbytes, sha), hdrs = fetch(url, dest=dest)
    say("http status", status)
    say("bytes", f"{nbytes} ({nbytes/1e9:.2f} GB)")
    say("sha256", sha)
    say("last-modified", hdrs.get("Last-Modified", "(absent)"))
    with open(dest, "rb") as f:
        magic = f.read(4)
    if magic != b"PK\x03\x04":
        raise SystemExit(f"STOP: archive magic is {magic!r}, not a ZIP")
    say("zip magic", "PK\\x03\\x04 OK")
    zf = zipfile.ZipFile(dest)
    bad = zf.testzip()
    if bad is not None:
        raise SystemExit(f"STOP: archive CRC failure in member {bad}")
    say("archive integrity", f"CRC OK across {len(zf.namelist())} members")
    for n in zf.namelist():
        i = zf.getinfo(n)
        say(f"  member {n}", f"{i.file_size} bytes uncompressed")
    csvs = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    if len(csvs) != 1:
        raise SystemExit(f"STOP: expected exactly one CSV member, found {csvs}")
    return zf, csvs[0], sha, nbytes


# ── GATES 1-3, in ONE streaming pass over the archive ─────────────────────────────────
REQUIRED = ["REGISTRY_ID", "PRIMARY_NAME", "LATITUDE83", "LONGITUDE83"]
# The file's own geospatial-metadata columns. They are what answers Gate 3's real question —
# "is this a PHYSICAL-SITE coordinate or a mailing/administrative one?" — from the source's
# own semantics rather than from an assumption about EPA.
GEO_META = ["COLLECT_DESC", "ACCURACY_VALUE", "REF_POINT_DESC", "HDATUM_DESC",
            "GEOMETRIC_TYPE_CODE", "SOURCE_DESC", "DERIVED_TRIBES"]


def scan(zf, member):
    say("GATE 1-3", f"streaming {member}")
    stats = {
        "rows": 0, "eligible": 0,
        "rid_null": 0, "rid_blank": 0,
        "coord_absent": 0, "coord_nonnumeric": 0, "coord_out_of_range": 0,
        "coord_sentinel": 0, "proven": 0,
    }
    # identity → (name, lat, lng); only for ELIGIBLE rows, which is the population that
    # would ever enter authoritative membership.
    seen = {}
    dup_rows = 0
    coord_conflict, name_conflict = set(), set()
    refpoint, collect, geomtype = {}, {}, {}
    names_out = []
    header = None

    with zf.open(member) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline="")
        rd = csv.reader(text)
        header = next(rd)
        cols = {c.strip().upper(): i for i, c in enumerate(header)}
        say("columns", f"{len(header)}")
        missing = [c for c in REQUIRED if c not in cols]
        if missing:
            raise SystemExit(f"STOP: bulk file lacks required field(s) {missing}. "
                             f"Header: {header[:40]}")
        for c in REQUIRED:
            say(f"  required field {c}", f"present at index {cols[c]}")
        present_meta = [c for c in GEO_META if c in cols]
        say("geospatial metadata cols", ", ".join(present_meta) or "(none)")

        i_rid, i_nm = cols["REGISTRY_ID"], cols["PRIMARY_NAME"]
        i_la, i_lo = cols["LATITUDE83"], cols["LONGITUDE83"]
        i_rp = cols.get("REF_POINT_DESC"); i_cd = cols.get("COLLECT_DESC")
        i_gt = cols.get("GEOMETRIC_TYPE_CODE")

        for row in rd:
            stats["rows"] += 1
            if len(row) <= max(i_rid, i_nm, i_la, i_lo):
                continue
            name = (row[i_nm] or "").strip()
            if not looks_industrial(name):
                continue
            stats["eligible"] += 1
            if len(names_out) < NAME_SAMPLE:
                names_out.append(name)

            rid = (row[i_rid] or "").strip()
            if row[i_rid] is None:
                stats["rid_null"] += 1
            if not rid:
                stats["rid_blank"] += 1
                continue

            la_s, lo_s = (row[i_la] or "").strip(), (row[i_lo] or "").strip()
            if not la_s or not lo_s:
                stats["coord_absent"] += 1
                continue
            try:
                la, lo = float(la_s), float(lo_s)
            except ValueError:
                stats["coord_nonnumeric"] += 1
                continue
            if la == 0.0 and lo == 0.0:
                stats["coord_sentinel"] += 1
                continue
            if not (-90.0 <= la <= 90.0) or not (-180.0 <= lo <= 180.0):
                stats["coord_out_of_range"] += 1
                continue

            stats["proven"] += 1
            if i_rp is not None and len(row) > i_rp:
                refpoint[row[i_rp].strip()] = refpoint.get(row[i_rp].strip(), 0) + 1
            if i_cd is not None and len(row) > i_cd:
                collect[row[i_cd].strip()] = collect.get(row[i_cd].strip(), 0) + 1
            if i_gt is not None and len(row) > i_gt:
                geomtype[row[i_gt].strip()] = geomtype.get(row[i_gt].strip(), 0) + 1

            prev = seen.get(rid)
            if prev is None:
                seen[rid] = (name, la, lo)
            else:
                dup_rows += 1
                pn, pla, plo = prev
                if abs(pla - la) > COORD_EPS or abs(plo - lo) > COORD_EPS:
                    coord_conflict.add(rid)
                if pn.upper() != name.upper():
                    name_conflict.add(rid)

    return stats, seen, dup_rows, coord_conflict, name_conflict, refpoint, collect, geomtype, names_out


def report_identity_geography(stats, seen, dup_rows, coord_conflict, name_conflict,
                              refpoint, collect, geomtype):
    say("", "")
    say("GATE 1  source rows", stats["rows"])
    say("GATE 1  eligible rows (looksIndustrial)", stats["eligible"])
    say("GATE 2  RegistryId null", stats["rid_null"])
    say("GATE 2  RegistryId blank", stats["rid_blank"])
    say("GATE 2  duplicate RegistryId rows", dup_rows)
    say("GATE 2  distinct RegistryIds (eligible, PROVEN geo)", len(seen))
    say("GATE 2  RegistryIds w/ conflicting coordinate", len(coord_conflict))
    say("GATE 2  RegistryIds w/ conflicting name", len(name_conflict))
    say("GATE 3  coordinate absent", stats["coord_absent"])
    say("GATE 3  coordinate non-numeric", stats["coord_nonnumeric"])
    say("GATE 3  coordinate 0/0 sentinel", stats["coord_sentinel"])
    say("GATE 3  coordinate out of range", stats["coord_out_of_range"])
    say("GATE 3  PROVEN physical points", stats["proven"])
    for label, d in (("REF_POINT_DESC", refpoint), ("COLLECT_DESC", collect),
                     ("GEOMETRIC_TYPE_CODE", geomtype)):
        top = sorted(d.items(), key=lambda kv: -kv[1])[:12]
        say(f"GATE 3  {label} distinct", len(d))
        for k, v in top:
            say(f"    {k or '(blank)'}", v)


# ── GATE 0 step 8: overlap against the REST-derived corpus ────────────────────────────
def overlap(seen):
    """Compare the bulk against the facilities the RADIUS path actually put on pages.

    The comparison is IDENTITY-and-COORDINATE parity on the OVERLAP, never population
    equality. Bulk-only ids are the expected shape of the fix (the radius never looked
    there); REST-only ids are the finding that would matter, because they would mean the
    bulk does not contain something the product already shows.
    """
    say("", "")
    say("GATE 0  overlap vs REST-derived corpus", "reading production, read-only")
    rest = {}
    after = ""
    while True:
        rows = sql(
            "select source_key, min(name) name, min(lat) lat, min(lng) lng "
            "from public.app_projects where record_kind='facility' "
            f"and source_key > {lit(after)} group by source_key "
            "order by source_key limit 20000;", "rest corpus", read_only=True)
        if not rows:
            break
        for r in rows:
            rest[r["source_key"][len("epa_frs:"):]] = (r["name"], r["lat"], r["lng"])
        after = rows[-1]["source_key"]
        say("  rest ids read", len(rest))
        if len(rows) < 20000:
            break

    both = [r for r in rest if r in seen]
    name_eq = coord_eq = coord_mat = 0
    for rid in both:
        rn, rla, rlo = rest[rid]
        bn, bla, blo = seen[rid]
        if (rn or "").strip().upper() == (bn or "").strip().upper():
            name_eq += 1
        if rla is not None and rlo is not None:
            if abs(rla - bla) <= COORD_EPS and abs(rlo - blo) <= COORD_EPS:
                coord_eq += 1
            else:
                coord_mat += 1
    say("REST distinct RegistryIds", len(rest))
    say("BULK distinct eligible RegistryIds", len(seen))
    say("overlap tested", len(both))
    say("  RegistryId match", len(both))
    say("  FacilityName exact/equivalent", name_eq)
    say("  coordinate equivalent (<=1e-4 deg)", coord_eq)
    say("  material coordinate conflicts", coord_mat)
    say("MISSING from bulk (REST-only ids)", len(rest) - len(both))
    say("BULK-only ids (radius never reached)", len(seen) - len(both))
    if both:
        say("  name parity rate", f"{100.0*name_eq/len(both):.3f}%")
        say("  coord parity rate", f"{100.0*coord_eq/max(1,coord_eq+coord_mat):.3f}%")
    return rest, both


def main():
    say("mode", MODE)
    say("eligibility INCLUDE tokens", len(INCLUDE))
    say("eligibility EXCLUDE tokens", len(EXCLUDE))
    url, basis = discover()
    zf, member, sha, nbytes = acquire(url)
    (stats, seen, dup_rows, coord_conflict, name_conflict,
     refpoint, collect, geomtype, names_out) = scan(zf, member)
    report_identity_geography(stats, seen, dup_rows, coord_conflict, name_conflict,
                              refpoint, collect, geomtype)

    os.makedirs(WORK, exist_ok=True)
    with open(f"{WORK}/frs_names_sample.json", "w", encoding="utf-8") as f:
        json.dump(names_out, f, ensure_ascii=False)
    say("name sample written", f"{len(names_out)} names -> {WORK}/frs_names_sample.json")

    if MODE == "frs-gate0-overlap":
        overlap(seen)

    say("", "")
    say("SNAPSHOT sha256", sha)
    say("SNAPSHOT bytes", nbytes)
    say("SNAPSHOT url", url)
    say("SNAPSHOT discovery", basis)
    say("SNAPSHOT member", member)


if __name__ == "__main__":
    main()
