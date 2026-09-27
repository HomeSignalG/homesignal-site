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
loader filters every OA row to a TARGET ZIP SET — by default the demand set: distinct ZIPs from
public.geocodes ∪ dc_geocode_queue ∪ property_reports (RPC oa_demand_scope, with paginated REST
fallback). Broaden or narrow by passing ZIPS/STATES; new demand ZIPs are picked up on the next
run with no code change.

QUARANTINE, DON'T STOP: a per-member parse/assemble failure is logged and skipped; the batch
continues. A total download/auth failure or a corrupt region zip is a HARD stop (reported,
non-zero exit) — never a silent partial success.

Config via env:
  SUPABASE_URL                (else read from homesignalmap.html ENDPOINT)
  SUPABASE_SERVICE_ROLE_KEY   (repo secret — RLS on national_address_points is service-role only)
  ZIPS      comma list of target ZIPs   (else: demand-scope ZIPs)
  STATES    comma list of 2-letter states to download (else: derived from demand pairs)
  OA_BASE   region-collection base URL   (default https://data.openaddresses.io/openaddr-collected-)
  DRY_RUN   "1" → parse + report, do NOT write (sanity check)

First live run: TX / ZIP 78617 (the Caldwell canary's ZIP). Default scope is now demand, not
property_reports alone.
"""

import csv
import io
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
import zipfile
from datetime import datetime, timezone
from pathlib import Path

# ── config ────────────────────────────────────────────────────────────────────────────────────
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
OA_BASE = os.environ.get("OA_BASE", "https://data.openaddresses.io/openaddr-collected-").strip()
DRY_RUN = os.environ.get("DRY_RUN", "").strip() == "1"
CHUNK = 1000
PAGE = 1000
ZIP_TAIL_RE = re.compile(r"(\d{5})(?:-\d{4})?$")
STATE_ZIP_RE = re.compile(r",\s*([A-Za-z]{2})\s+\d{5}(?:-\d{4})?$")
CITYLESS_RE = re.compile(r"^(.+), [^,]+, ([A-Z]{2} \d{5}(?:-\d{4})?)$")
STREET_ZIP_TAIL_RE = re.compile(r", [A-Z]{2} \d{5}(?:-\d{4})?$")
HOUSE_RE = re.compile(r"^[0-9]+[A-Z]?(?:-[0-9]+[A-Z]?)?\s+")

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


def vintage_stamp() -> str:
    """OA run date — source_vintage's documented meaning — not a constant label."""
    return "openaddresses-collected " + time.strftime("%Y-%m-%d", time.gmtime())


def supabase_url() -> str:
    u = os.environ.get("SUPABASE_URL", "").strip()
    if u:
        return u.rstrip("/")
    html = (Path(__file__).resolve().parent.parent / "homesignalmap.html").read_text("utf-8")
    m = re.search(r'var ENDPOINT\s*=\s*["\']([^"\']+)["\']', html)
    if not m:
        raise SystemExit("FATAL: SUPABASE_URL not set and ENDPOINT not found in homesignalmap.html")
    return re.sub(r"/functions/v1/.*$", "", m.group(1)).rstrip("/")


_SUPABASE_URL = None


def get_supabase_url() -> str:
    global _SUPABASE_URL
    if _SUPABASE_URL is None:
        _SUPABASE_URL = supabase_url()
    return _SUPABASE_URL


# ── canonicalAddr — MUST match get-address-report/canonical-addr.ts byte-for-byte ───────────
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


def cityless_key(canon: str) -> str | None:
    """NUM STREET, CITY, ST ZIP → NUM STREET, ST ZIP. None when the key has no city slot."""
    m = CITYLESS_RE.match(canon)
    return f"{m.group(1)}, {m.group(2)}" if m else None


def street_zip_key(canon: str) -> str | None:
    """NUM STREET, CITY, ST ZIP → STREET, ST ZIP. None without a ST ZIP tail."""
    k = cityless_key(canon) or canon
    if not STREET_ZIP_TAIL_RE.search(k):
        return None
    return HOUSE_RE.sub("", k, count=1)


def housestreet_key(canon: str) -> str | None:
    """NUM STREET, CITY, ST ZIP → NUM STREET."""
    s = STREET_ZIP_TAIL_RE.sub("", canon).split(",", 1)[0].strip()
    return s or None


def extract_zip(text: str) -> str:
    if not text:
        return ""
    m = ZIP_TAIL_RE.search(str(text).strip())
    return m.group(1) if m else ""


def extract_state(text: str) -> str:
    if not text:
        return ""
    m = STATE_ZIP_RE.search(str(text).strip())
    return m.group(1).upper() if m else ""


def classify_match_type(row: dict) -> str:
    """OpenAddresses' collected schema exposes no reliable per-point rooftop flag, so we DEFAULT
    to parcel_centroid and only upgrade on an explicit, trustworthy signal. This is the single
    honest-labelling seam: if a future OA field reliably marks rooftop, whitelist it here — never
    infer rooftop from geometry precision or a source's reputation."""
    acc = str(row.get("accuracy") or row.get("ACCURACY") or "").strip().lower()
    if acc == "rooftop":  # not present in today's collected CSV; the explicit-signal hook
        return "rooftop"
    return "parcel_centroid"


# ── REST ─────────────────────────────────────────────────────────────────────────────────
def rest_get(path: str, extra_headers: dict | None = None) -> list:
    headers = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(f"{get_supabase_url()}/rest/v1/{path}", headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read().decode("utf-8")
        return json.loads(body) if body else []


def rest_get_all(path: str, page_size: int = PAGE) -> list:
    """Follow PostgREST pages. A bare GET is silently capped at 1,000 rows."""
    rows: list = []
    offset = 0
    while True:
        sep = "&" if "?" in path else "?"
        page = rest_get(
            f"{path}{sep}limit={page_size}&offset={offset}",
            extra_headers={
                "Prefer": "count=exact",
                "Range-Unit": "items",
                "Range": f"{offset}-{offset + page_size - 1}",
            },
        )
        if not page:
            break
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return rows


def rest_exact_count(path: str) -> int | None:
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Prefer": "count=exact",
        "Range-Unit": "items",
        "Range": "0-0",
    }
    req = urllib.request.Request(f"{get_supabase_url()}/rest/v1/{path}", headers=headers, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            cr = r.headers.get("Content-Range") or r.headers.get("content-range") or ""
    except urllib.error.HTTPError as e:
        cr = e.headers.get("Content-Range") or e.headers.get("content-range") or ""
        if e.code not in (200, 206, 416):
            raise
    if "/" in cr:
        tail = cr.rsplit("/", 1)[-1]
        if tail.isdigit():
            return int(tail)
    return None


def rest_rpc(name: str, payload: dict | None = None):
    body = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(
        f"{get_supabase_url()}/rest/v1/rpc/{name}",
        data=body, method="POST",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read().decode("utf-8")
        return json.loads(raw) if raw else []


def rest_post(path: str, rows: list) -> int:
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        f"{get_supabase_url()}/rest/v1/{path}",
        data=body, method="POST",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status


# ── target scope ────────────────────────────────────────────────────────────────────────────
def parse_csv_env(name: str) -> list[str]:
    return [p.strip() for p in os.environ.get(name, "").split(",") if p.strip()]


def demand_pairs() -> list[tuple[str, str]]:
    """ZIP/state pairs from oa_demand_scope, else paginated REST over the same three sources."""
    try:
        rows = rest_rpc("oa_demand_scope")
        pairs = []
        for r in rows or []:
            z = str(r.get("zip") or "").strip()[:5]
            s = str(r.get("state") or "").strip().upper()
            if z:
                pairs.append((z, s))
        if pairs:
            return pairs
    except Exception as e:  # noqa: BLE001 — REST fallback is the compatibility path
        print(f"  (oa_demand_scope RPC unavailable, paginating REST: {e})", flush=True)

    pairs: list[tuple[str, str]] = []
    for r in rest_get_all("property_reports?select=zip,state"):
        z = str(r.get("zip") or "").strip()[:5]
        s = str(r.get("state") or "").strip().upper()
        if z:
            pairs.append((z, s))
    for r in rest_get_all("geocodes?select=canonical_addr,input_address"):
        for field in ("canonical_addr", "input_address"):
            z = extract_zip(r.get(field) or "")
            s = extract_state(r.get(field) or "")
            if z:
                pairs.append((z, s))
    try:
        for r in rest_get_all("dc_geocode_queue?select=geocoder_query"):
            z = extract_zip(r.get("geocoder_query") or "")
            s = extract_state(r.get("geocoder_query") or "")
            if z:
                pairs.append((z, s))
    except Exception as e:  # noqa: BLE001 — queue may be absent in a fresh clone
        print(f"  (dc_geocode_queue unread: {e})", flush=True)
    return pairs


def merge_scope(pairs: list[tuple[str, str]], env_zips: list[str], env_states: list[str]) -> tuple[set[str], set[str]]:
    demand_zips = {z for z, _ in pairs if z}
    demand_states = {s for _, s in pairs if s and s in STATE_REGION}
    zips = set(env_zips) if env_zips else demand_zips
    if env_states:
        states = {s.upper() for s in env_states}
    elif env_zips:
        states = {s for z, s in pairs if z in zips and s and s in STATE_REGION}
    else:
        states = demand_states
    return zips, states


def target_scope() -> tuple[set[str], set[str]]:
    return merge_scope(demand_pairs(), parse_csv_env("ZIPS"), parse_csv_env("STATES"))


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


def parse_member(zf: zipfile.ZipFile, name: str, zips: set[str]):
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


def parse_region(region: str, states: set, zips: set, tmp: Path, stats: dict):
    """Stream every target-state CSV member of one region collection, keep rows whose postcode is
    in the target ZIP set, and yield (canonical, lat, lng, state, source, match_type).

    A corrupt collection zip is FATAL (the download cannot be trusted). A single bad member is
    quarantined; remaining members in the same region still load. Dedupes by canonical (first
    wins) inside the caller."""
    try:
        zf = zipfile.ZipFile(tmp)
    except zipfile.BadZipFile as e:
        raise SystemExit(f"FATAL: {region} collection is not a valid zip: {e}") from e
    state_dirs = tuple(f"/us/{s.lower()}/" for s in states) + tuple(f"us/{s.lower()}/" for s in states)
    members = [n for n in zf.namelist()
               if n.lower().endswith(".csv") and any(sd in ("/" + n) for sd in state_dirs)]
    print(f"  {region}: {len(members)} target-state source file(s)", flush=True)
    for name in members:
        try:
            yield from parse_member(zf, name, zips)
        except Exception as e:  # noqa: BLE001 — quarantine ONE member, keep the region
            stats["quarantined"] = stats.get("quarantined", 0) + 1
            print(f"  ! quarantined member {name} in {region}: {e}", flush=True)


# ── upsert ───────────────────────────────────────────────────────────────────────────────────
def upsert(rows: list) -> int:
    if DRY_RUN or not rows:
        return 0
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        f"{get_supabase_url()}/rest/v1/national_address_points?on_conflict=canonical_addr",
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


def enqueue(seen: set, batch: list, vintage: str, loaded_at: str,
            canon: str, lat: float, lng: float, state: str, source: str, mt: str) -> None:
    """First-wins per canonical key. Also stores the city-less form so a filed address
    that omitted city still hits the same point."""
    keys = [canon]
    alt = cityless_key(canon)
    if alt:
        keys.append(alt)
    for key in keys:
        if not key or key in seen:
            continue
        seen.add(key)
        batch.append({
            "canonical_addr": key, "lat": lat, "lng": lng,
            "match_type": mt, "state": state, "source": source,
            "source_vintage": vintage, "loaded_at": loaded_at,
        })


def write_receipt(payload: dict) -> None:
    print("\nOA_LOAD_RECEIPT " + json.dumps(payload, sort_keys=True), flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("## OpenAddresses load\n\n```json\n")
            fh.write(json.dumps(payload, indent=2, sort_keys=True))
            fh.write("\n```\n")
    if DRY_RUN:
        return
    row = {
        "started_at": payload["started_at"],
        "finished_at": payload["finished_at"],
        "zips": payload["zips"],
        "states": payload["states"],
        "regions": payload["regions"],
        "rows_written": payload["rows_written"],
        "distinct_canonical": payload["distinct_canonical"],
        "quarantined": payload["quarantined"],
        "dry_run": False,
        "vintage": payload["vintage"],
        "nap_count": payload.get("nap_count"),
        "notes": {"scope": payload.get("scope"), "tiers": payload.get("tiers")},
    }
    try:
        rest_post("oa_load_runs", [row])
    except Exception as e:  # noqa: BLE001 — receipt table is additive; a miss must not fail the load
        print(f"  (could not persist oa_load_runs: {e})", flush=True)


# ── main ───────────────────────────────────────────────────────────────────────────────────────
def main() -> int:
    if not SERVICE_KEY:
        raise SystemExit("FATAL: SUPABASE_SERVICE_ROLE_KEY not set (repo secret). Cannot write "
                         "national_address_points (RLS service-role only). Stopping — not retrying blind.")
    started = datetime.now(timezone.utc)
    vintage = vintage_stamp()
    loaded_at = started.strftime("%Y-%m-%dT%H:%M:%SZ")
    zips, states = target_scope()
    if not zips or not states:
        raise SystemExit(f"FATAL: empty target scope (zips={len(zips)}, states={len(states)}). "
                         "Nothing to load; refusing to run a no-op.")
    regions = sorted({STATE_REGION[s] for s in states if s in STATE_REGION})
    unknown = [s for s in states if s not in STATE_REGION]
    print(f"target: {len(zips)} ZIP(s) · states {sorted(states)} · regions {regions}"
          + (f" · UNMAPPED states (skipped): {unknown}" if unknown else ""), flush=True)
    if len(zips) <= 20:
        print(f"  zips {sorted(zips)}", flush=True)

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
        stats = {"quarantined": 0}
        try:
            for canon, lat, lng, state, source, mt in parse_region(region, states, zips, tmp, stats):
                enqueue(seen, batch, vintage, loaded_at, canon, lat, lng, state, source, mt)
                if len(batch) >= CHUNK:
                    upsert(batch)
                    total_written += len(batch)
                    print(f"  … {total_written} rows written", flush=True)
                    batch = []
        finally:
            quarantined += stats.get("quarantined", 0)
            tmp.unlink(missing_ok=True)

    if batch:
        upsert(batch)
        total_written += len(batch)

    tiers = None
    nap_count = None
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
            try:
                tiers_rows = rest_rpc("oa_nap_stats")
                tiers = {r["match_type"]: int(r["n"]) for r in tiers_rows}
                nap_count = sum(tiers.values())
            except Exception:
                nap_count = rest_exact_count("national_address_points?select=canonical_addr")
                tiers = {"_unpaged": nap_count}
            print(f"  match_type distribution (in table): {tiers}")
        except Exception as e:  # noqa: BLE001
            print(f"  (could not read back sample: {e})")
    print("=" * 64)

    write_receipt({
        "started_at": started.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "zips": sorted(zips),
        "states": sorted(states),
        "regions": regions,
        "rows_written": total_written,
        "distinct_canonical": len(seen),
        "quarantined": quarantined,
        "vintage": vintage,
        "nap_count": nap_count,
        "tiers": tiers,
        "scope": "demand" if not parse_csv_env("ZIPS") else "env-zips",
        "dry_run": DRY_RUN,
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
