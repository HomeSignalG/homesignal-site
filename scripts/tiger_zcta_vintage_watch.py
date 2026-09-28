#!/usr/bin/env python3
"""Census TIGER/ZCTA vintage watch — compare the live directory to the ONE pin.

PARKED as the vintage watch (health-plan Step 5, 2026-09-28). This file does
not download the national archive, does not load polygons, does not apply DDL,
and does not
activate an N5 generation. It does not write the database. It does not change
`scripts/tiger_zcta_authority.py`. A newer Census year is a report, never a load.

The identity it compares against is `tiger_zcta_authority` (Step 4). This watch
does not assign TIGER_SHA256 / TIGER_URL / TIGER_VINTAGE. If the authority module
is missing, it stops: the watch compares, it does not carry a second pin.

Live I/O (GitHub runner only; the sandbox has no Census egress):
  1. GET the TIGER year index (HTML directory listing). Every TIGER20xx year,
     no extract cap.
  2. GET the pinned year's ZCTA520 directory listing.
  3. Range-GET the first 64 bytes of the pinned zip (liveness). Never the body.

`--offline` reads those three facts from files/flags and performs the same
verdict. Tests drive that path. No urllib in `--offline`.

Founder lock 2026-09-27: Do not unlist ~1,005 map pages just because they have plants
and no new construction. 'Nothing is being built' is a valid answer. Those pages stay
listed. This was the old Unit 1 idea; it is rejected.

This module does not touch `indexable`, `_nfc`, or Unit 1.

Schedule is founder-gated (autonomy envelope: a new scheduled job is gated). The
workflow is dispatch-only until that gate lifts.

stdlib only.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TIGER_INDEX_URL = "https://www2.census.gov/geo/tiger/"
YEAR_HREF_RE = re.compile(r"TIGER(20\d{2})/")
PINNED_YEAR_RE = re.compile(r"/TIGER(20\d{2})/")
RANGE_BYTES = 64
LIVE_UA = "HomeSignal-tiger-vintage-watch/1.0 (+https://homesignal.net)"

# Verdicts the watch may print. PINNED_CURRENT is the only success.
PINNED_CURRENT = "PINNED_CURRENT"
NO_YEARS = "NO_YEARS"
PINNED_YEAR_ABSENT_FROM_INDEX = "PINNED_YEAR_ABSENT_FROM_INDEX"
PINNED_ARCHIVE_MISSING = "PINNED_ARCHIVE_MISSING"
PINNED_ARCHIVE_UNREACHABLE = "PINNED_ARCHIVE_UNREACHABLE"
NEWER_VINTAGE_PRESENT = "NEWER_VINTAGE_PRESENT"


def pinned_year(tiger_url: str) -> int:
    """Year is derived from the authority URL. Never a second year literal."""
    m = PINNED_YEAR_RE.search(tiger_url or "")
    if not m:
        raise SystemExit("STOP: authority TIGER_URL has no /TIGER20xx/ year: %r" % (tiger_url,))
    return int(m.group(1))


def archive_name(tiger_url: str) -> str:
    name = (tiger_url or "").rstrip("/").rsplit("/", 1)[-1]
    if not name.endswith(".zip"):
        raise SystemExit("STOP: authority TIGER_URL is not a zip: %r" % (tiger_url,))
    return name


def years_from_listing(html: str) -> list[int]:
    """Every TIGER20xx year in the listing. No extract_max, no cap."""
    return sorted({int(y) for y in YEAR_HREF_RE.findall(html or "")})


def archive_listed(html: str, name: str) -> bool:
    if not name:
        return False
    return name in (html or "")


def verdict(*, pin_year: int, years: list[int], listed: bool, head_ok: bool) -> tuple[str, int]:
    """Compare a listing to the pinned year. Newer vintage → fail (report, do not load)."""
    if not years:
        return NO_YEARS, 1
    if pin_year not in years:
        return PINNED_YEAR_ABSENT_FROM_INDEX, 1
    if not listed:
        return PINNED_ARCHIVE_MISSING, 1
    if not head_ok:
        return PINNED_ARCHIVE_UNREACHABLE, 1
    newer = [y for y in years if y > pin_year]
    if newer:
        return "%s:%s" % (NEWER_VINTAGE_PRESENT, ",".join(str(y) for y in newer)), 1
    return PINNED_CURRENT, 0


def load_authority():
    try:
        from tiger_zcta_authority import TIGER_URL, TIGER_SHA256, TIGER_VINTAGE  # noqa: E402
    except ImportError:
        raise SystemExit(
            "STOP: TIGER checksum authority is missing. "
            "The watch compares; it does not carry a second pin."
        )
    if not (TIGER_URL and TIGER_SHA256 and TIGER_VINTAGE):
        raise SystemExit("STOP: TIGER checksum authority is incomplete")
    return TIGER_URL, TIGER_SHA256, TIGER_VINTAGE


def _get(url: str, *, range_bytes: int | None = None) -> tuple[int, str]:
    import urllib.request

    headers = {"User-Agent": LIVE_UA}
    if range_bytes is not None:
        headers["Range"] = "bytes=0-%d" % (range_bytes - 1)
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status = getattr(r, "status", 200) or 200
            body = r.read()
            if range_bytes is not None:
                return status, body[:range_bytes].decode("latin-1", "replace")
            return status, body.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return int(e.code), ""
    except urllib.error.URLError as e:
        raise SystemExit("STOP: Census fetch failed for %s: %s" % (url, e.reason))


def live_probe(tiger_url: str) -> tuple[list[int], bool, bool]:
    year = pinned_year(tiger_url)
    name = archive_name(tiger_url)
    zcta_dir = "https://www2.census.gov/geo/tiger/TIGER%d/ZCTA520/" % year
    idx_status, idx_html = _get(TIGER_INDEX_URL)
    if idx_status != 200 or not idx_html:
        raise SystemExit("STOP: TIGER index HTTP %s" % idx_status)
    years = years_from_listing(idx_html)
    dir_status, dir_html = _get(zcta_dir)
    if dir_status != 200:
        raise SystemExit("STOP: ZCTA520 directory HTTP %s for %s" % (dir_status, zcta_dir))
    listed = archive_listed(dir_html, name)
    zip_status, zip_head = _get(tiger_url, range_bytes=RANGE_BYTES)
    # 206 Partial Content is the success shape for Range; 200 with a short body is also live.
    head_ok = zip_status in (200, 206) and zip_head[:2] == "PK"
    return years, listed, head_ok


def report(code: str, rc: int, *, pin_year: int, years: list[int], listed: bool, head_ok: bool,
           tiger_url: str, vintage: str) -> int:
    print("verdict", code)
    print("exit", rc)
    print("authority_url", tiger_url)
    print("authority_vintage", vintage)
    print("pinned_year", pin_year)
    print("years_listed", ",".join(str(y) for y in years) if years else "")
    print("year_count", len(years))
    print("archive_listed", "yes" if listed else "no")
    print("range_probe_ok", "yes" if head_ok else "no")
    print("load", "no")
    print("activate", "no")
    if code.startswith(NEWER_VINTAGE_PRESENT):
        print("note", "newer Census year is present; do not load; vintage change is a separate gated step")
    return rc


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Watch Census TIGER vintages against the checksum authority")
    p.add_argument("--offline", action="store_true",
                   help="no network: read --index-html / --zcta-dir-html / --head-ok")
    p.add_argument("--index-html", default="", help="offline: TIGER year-index listing")
    p.add_argument("--zcta-dir-html", default="", help="offline: pinned ZCTA520 directory listing")
    p.add_argument("--head-ok", action="store_true", help="offline: treat the range probe as live")
    args = p.parse_args(argv)

    tiger_url, _sha, vintage = load_authority()
    pin_year = pinned_year(tiger_url)
    name = archive_name(tiger_url)

    if args.offline:
        if not args.index_html or not args.zcta_dir_html:
            raise SystemExit("STOP: --offline requires --index-html and --zcta-dir-html")
        with open(args.index_html, encoding="utf-8", errors="replace") as f:
            years = years_from_listing(f.read())
        with open(args.zcta_dir_html, encoding="utf-8", errors="replace") as f:
            listed = archive_listed(f.read(), name)
        head_ok = bool(args.head_ok)
    else:
        years, listed, head_ok = live_probe(tiger_url)

    code, rc = verdict(pin_year=pin_year, years=years, listed=listed, head_ok=head_ok)
    return report(code, rc, pin_year=pin_year, years=years, listed=listed, head_ok=head_ok,
                  tiger_url=tiger_url, vintage=vintage)


if __name__ == "__main__":
    sys.exit(main())
