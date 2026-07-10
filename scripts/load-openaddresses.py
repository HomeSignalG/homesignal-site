#!/usr/bin/env python3
"""load-openaddresses.py — the zero-fee national geocode backbone loader.

Ingests OpenAddresses (a free aggregation of *government* address-point data — no commercial
geocoder, ever) into public.national_address_points, keyed by canonicalAddr() so the engine's
datasetRung can look an address up at zero per-lookup cost. ONE uniform national pipeline: no
per-state custom code — every state flows through the same region-collection download + ZIP
filter + canonical-key + upsert.

HONEST LABELLING (the whole reason this project exists): OpenAddresses' collected schema has NO
reliable per-POINT rooftop flag — quality is per-SOURCE, mixed — so every loaded point DEFAULTS
to match_type='parcel_centroid'. A point is stamped 'rooftop' ONLY when the source row carries an
explicit, reliable rooftop signal (see classify_match_type() — today none of OA's collected
columns provide one, so in practice everything loads as parcel_centroid, which is the correct,
non-overstated tier). match_type then flows through the engine's existing quality tiers and the
improvement-guarded upsert, so a genuinely better rung can only ever upgrade a point.

SCOPE (counties with records, not the whole nation): we do NOT load ~150M national addresses. The
loader filters every OA row to a TARGET ZIP SET — by default the ZIPs that actually have records
to geocode (public.property_reports). Broaden by passing ZIPS/STATES; new ZIPs are picked up on
the next run with no code change.

QUARANTINE, DON'T STOP: a per-row parse/assemble failure is logged and skipped; the batch
continues. A total download/auth failure is a HARD stop (reported, non-zero exit) — never a silent
partial success.

Config via env:
  SUPABASE_URL                (else read from homesignalmap.html ENDPOINT)
  SUPABASE_SERVICE_ROLE_KEY   (repo secret — RLS on national_address_points is service-role only)
  ZIPS      comma list of target ZIPs   (else: distinct zips from property_reports)
  STATES    comma list of 2-letter states to download (else: derived from the target ZIPs)
  OA_BASE   region-collection base URL   (default https://data.openaddresses.io/openaddr-collected-)
  DRY_RUN   "1" → parse + report, do NOT write (sanity check)

First live run: TX / ZIP 78617 (the Caldwell canary's ZIP), scope from property_reports.
"""

import csv
import io
import json
import os
import re
import sys
import urllib.request
import urllib.error
import zipfile
from pathlib import Path

# ── config ────────────────────────────────────────────────────────────────────────────────────
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
OA_BASE = os.environ.get("OA_BASE", "https://data.openaddresses.io/openaddr-collected-").strip()
DRY_RUN = os.environ.get("DRY_RUN", "").strip() == "1"
VINTAGE = "openaddresses-collected"
CHUNK = 1000

# Census regions, exactly as OpenAddresses groups its collected downloads.
STATE_REGION = {}
for _region, _states in {
    "us_northeast": "PA NJ NY CT RI MA VT NH ME",
    "us_midwest":   "ND SD NE KS MN IA MO WI IL IN MI OH",
    "us_south":     "TX OK AR LA MS AL TN KY GA FL SC NC VA WV MD DE DC",
    "us_west":      "WA OR CA NV ID MT WY UT CO AZ NM AK HI",
}.items():
    for _s in _states.split():
        STATE_REGION[_s] = _region


def supabase_url() -> str:
    u = os.environ.get("SUPABASE_URL", "").strip()
    if u:
        return u.rstrip("/")
    # Fall back to the endpoint shipped in the page (same source verify-geocodes.mjs reads).
    html = (Path(__file__).resolve().parent.parent / "homesignalmap.html").read_text("utf-8")
    m = re.search(r'var ENDPOINT\s*=\s*["\']([^"\']+)["\']', html)
    if not m:
        raise SystemExit("FATAL: SUPABASE_URL not set and ENDPOINT not found in homesignalmap.html")
    return re.sub(r"/functions/v1/.*$", "", m.group(1)).rstrip("/")


SUPABASE_URL = supabase_url()


# ── canonicalAddr — MUST match get-address-report/index.ts::canonicalAddr byte-for-byte ─────────
# The engine looks this table up with .eq("canonical_addr", canonicalAddr(filed_address)); if the
# loader's key differs by one character it silently never matches. Keep the two in lockstep.
_ABBR = [
    (r"\bLANE\b", "LN"), (r"\bSTREET\b", "ST"), (r"\bDRIVE\b", "DR"),
    (r"\bROAD\b", "RD"), (r"\bAVENUE\b", "AVE"), (r"\bBOULEVARD\b", "BLVD"),
    (r"\bPARKWAY\b", "PKWY"), (r"\bHIGHWAY\b", "HWY"), (r"\bCOURT\b", "CT"),
    (r"\bCIRCLE\b", "CIR"), (r"\bPLACE\b", "PL"), (r"\bSUITE\b", "STE"),
    (r"\bTEXAS\b", "TX"), (r"\bUTAH\b", "UT"),
]


def canonical_addr(a: str) -> str:
    s = str(a).upper().replace(".", "")
    for pat, rep in _ABBR:
        s = re.sub(pat, rep, s)
    s = re.sub(r"\s*,\s*", ", ", s)
    s = re.sub(r",\s*(\d{5}(-\d{4})?)\s*$", r" \1", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def classify_match_type(row: dict) -> str:
    """OpenAddresses' collected schema exposes no reliable per-point rooftop flag, so we DEFAULT
    to parcel_centroid and only upgrade on an explicit, trustworthy signal. This is the single
    honest-labelling seam: if a future OA field reliably marks rooftop, whitelist it here — never
    infer rooftop from geometry precision or a source's reputation."""
    acc = str(row.get("accuracy") or row.get("ACCURACY") or "").strip().lower()
    if acc == "rooftop":  # not present in today's collected CSV; the explicit-signal hook
        return "rooftop"
    return "parcel_centroid"


# ── target scope ────────────────────────────────────────────────────────────────────────────
def rest_get(path: str) -> list:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def target_zips() -> set:
    env = os.environ.get("ZIPS", "").strip()
    if env:
        return {z.strip() for z in env.split(",") if z.strip()}
    rows = rest_get("property_reports?select=zip")
    return {str(r["zip"]).strip() for r in rows if r.get("zip")}


def target_states(zips: set) -> list:
    env = os.environ.get("STATES", "").strip()
    if env:
        return [s.strip().upper() for s in env.split(",") if s.strip()]
    # Derive from the property_reports rows' declared state (authoritative, not guessed from ZIP).
    rows = rest_get("property_reports?select=state")
    return sorted({str(r["state"]).strip().upper() for r in rows if r.get("state")})


# ── OA download + parse ─────────────────────────────────────────────────────────────────────
def download(url: str, dest: Path) -> None:
    print(f"  ↓ {url}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "homesignal-oa-loader"})
    with urllib.request.urlopen(req, timeout=1800) as r, open(dest, "wb") as f:
        while True:
            buf = r.read(1 << 20)
            if not buf:
                break
            f.write(buf)
    print(f"  ✓ {dest.stat().st_size / 1e6:.1f} MB", flush=True)


def assemble(row: dict) -> str | None:
    """Build the address in the SAME shape a filed record uses ("NUM STREET, CITY, REGION ZIP"),
    WITHOUT unit — filed street addresses carry no unit, so including it would guarantee a miss."""
    g = lambda *ks: next((str(row[k]).strip() for k in ks if row.get(k) not in (None, "")), "")
    num, street = g("number", "NUMBER"), g("street", "STREET")
    city, region = g("city", "CITY"), g("region", "REGION")
    postcode = g("postcode", "POSTCODE")
    if not (num and street and postcode):
        return None
    parts = f"{num} {street}"
    if city:
        parts += f", {city}"
    parts += f", {region} {postcode}" if region else f", {postcode}"
    return parts


def parse_region(region: str, states: set, zips: set, tmp: Path):
    """Stream every target-state CSV member of one region collection, keep rows whose postcode is
    in the target ZIP set, and yield (canonical, lat, lng, state, source, match_type). Dedupes by
    canonical (first wins) inside the caller."""
    zf = zipfile.ZipFile(tmp)
    state_dirs = tuple(f"/us/{s.lower()}/" for s in states) + tuple(f"us/{s.lower()}/" for s in states)
    members = [n for n in zf.namelist()
               if n.lower().endswith(".csv") and any(sd in ("/" + n) for sd in state_dirs)]
    print(f"  {region}: {len(members)} target-state source file(s)", flush=True)
    for name in members:
        st = re.search(r"us/([a-z][a-z])/", name)
        state = st.group(1).upper() if st else ""
        with zf.open(name) as fh:
            reader = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8", errors="replace"))
            for row in reader:
                pc = (row.get("postcode") or row.get("POSTCODE") or "").strip()[:5]
                if pc not in zips:
                    continue
                addr = assemble(row)
                if not addr:
                    continue
                try:
                    lat = float(row.get("lat") or row.get("LAT"))
                    lng = float(row.get("lon") or row.get("LON"))
                except (TypeError, ValueError):
                    continue
                yield (canonical_addr(addr), lat, lng, state, name.split("/")[-1], classify_match_type(row))


# ── upsert ───────────────────────────────────────────────────────────────────────────────────
def upsert(rows: list) -> int:
    if DRY_RUN or not rows:
        return 0
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/national_address_points?on_conflict=canonical_addr",
        data=body, method="POST",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        raise SystemExit(f"FATAL: upsert failed HTTP {e.code} — {detail}\n"
                         f"(If 401/403, the SUPABASE_SERVICE_ROLE_KEY secret is missing/wrong — "
                         f"stop and check the secret, do not retry blind.)")


# ── main ───────────────────────────────────────────────────────────────────────────────────────
def main() -> int:
    if not SERVICE_KEY:
        raise SystemExit("FATAL: SUPABASE_SERVICE_ROLE_KEY not set (repo secret). Cannot write "
                         "national_address_points (RLS service-role only). Stopping — not retrying blind.")
    zips = target_zips()
    states = set(target_states(zips))
    if not zips or not states:
        raise SystemExit(f"FATAL: empty target scope (zips={len(zips)}, states={len(states)}). "
                         "Nothing to load; refusing to run a no-op.")
    regions = sorted({STATE_REGION[s] for s in states if s in STATE_REGION})
    unknown = [s for s in states if s not in STATE_REGION]
    print(f"target: {len(zips)} ZIP(s) {sorted(zips)} · states {sorted(states)} · regions {regions}"
          + (f" · UNMAPPED states (skipped): {unknown}" if unknown else ""), flush=True)

    seen, batch = set(), []
    total_written = 0
    quarantined = 0
    workdir = Path(os.environ.get("RUNNER_TEMP", "/tmp"))

    for region in regions:
        tmp = workdir / f"oa-{region}.zip"
        try:
            download(f"{OA_BASE}{region}.zip", tmp)
        except (urllib.error.URLError, urllib.error.HTTPError) as e:
            raise SystemExit(f"FATAL: could not download {region} collection: {e}")
        try:
            for canon, lat, lng, state, source, mt in parse_region(region, states, zips, tmp):
                if not canon or canon in seen:
                    continue
                seen.add(canon)
                batch.append({
                    "canonical_addr": canon, "lat": lat, "lng": lng,
                    "match_type": mt, "state": state, "source": source, "source_vintage": VINTAGE,
                })
                if len(batch) >= CHUNK:
                    upsert(batch)
                    total_written += len(batch)
                    print(f"  … {total_written} rows written", flush=True)
                    batch = []
        except Exception as e:  # noqa: BLE001 — quarantine a bad member, keep the batch alive
            quarantined += 1
            print(f"  ! quarantined a parse error in {region}: {e}", flush=True)
        finally:
            tmp.unlink(missing_ok=True)

    if batch:
        upsert(batch)
        total_written += len(batch)

    # ── report ───────────────────────────────────────────────────────────────────────────────
    print("\n" + "=" * 64)
    print(f"OpenAddresses load {'(DRY RUN — nothing written)' if DRY_RUN else 'complete'}")
    print(f"  distinct canonical addresses: {len(seen)}")
    print(f"  rows written:                 {total_written}")
    print(f"  quarantined member errors:    {quarantined}")
    if seen and not DRY_RUN:
        try:
            sample = rest_get("national_address_points?select=*&limit=3&order=canonical_addr")
            print("  sample rows:")
            for s in sample:
                print("   " + json.dumps(s))
            cnt = rest_get("national_address_points?select=match_type")
            tiers = {}
            for r in cnt:
                tiers[r["match_type"]] = tiers.get(r["match_type"], 0) + 1
            print(f"  match_type distribution (in table): {tiers}")
        except Exception as e:  # noqa: BLE001
            print(f"  (could not read back sample: {e})")
    print("=" * 64)
    return 0


if __name__ == "__main__":
    sys.exit(main())
