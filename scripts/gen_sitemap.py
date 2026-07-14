#!/usr/bin/env python3
"""Generate sitemap.xml — NATIONWIDE SUBSTANCE GATE (founder-approved 2026-07-14,
PLAN.md §11 threshold c).

The whole site uses the new layout; a ZIP page is advertised to search only once the
materializer stamped app_community_meta.indexable = data_quality 'pass' AND (>=1
parcel-precise development record OR >=3 facility records). That flag is computed ONCE
in SQL (app_refresh_zip) and read by community.html, homesignalmap.html, this generator,
and both CI verifiers — no per-reader duplication of the threshold. Empty /
coverage-coming / thin pages stay real, reachable pages but are noindexed and never
appear here (a sitemap entry would contradict their robots value).

THIN-CONTENT RAMP (PLAN.md §11.3): the daily run adds at most MAX_NEW_URLS_PER_RUN
not-yet-listed community ZIPs (sorted, so the ramp is deterministic), reading the
previous sitemap.xml from disk. A future 500-page state batch therefore rolls into the
sitemap over days instead of a cliff; pages themselves flip robots=index the day they
qualify — the sitemap is only the crawl-rate control. URLs whose flag drops OFF are
removed immediately (no ramp on removals).

Uses only the public anon key (same one shipped in community.html); no secrets.
"""
import json
import os
import re
import sys
import html
import urllib.parse
import urllib.request

SUPA = "https://qwnnmljucajnexpxdgxr.supabase.co"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3"
        "bm5tbGp1Y2FqbmV4cHhkZ3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTAyOTgsImV4cCI6"
        "MjA5NTk4NjI5OH0.prpXB6lSIhWMAsdkkaxAfkvEodbojfUUyN4L4JbQE1U")
BASE = "https://homesignal.net"
STATIC = [("/", "weekly", "1.0"), ("/how-it-works.html", "monthly", "0.7"),
          ("/about.html", "monthly", "0.6"), ("/contact.html", "monthly", "0.5"),
          ("/privacy.html", "yearly", "0.3")]
STEP = 1000
# Ramp throttle: max community ZIPs ADDED per run vs the previous sitemap (§11.3).
MAX_NEW_URLS_PER_RUN = 250


def fetch_index_zips():
    """The advertised set: every ZIP whose materializer-stamped substance flag is true,
    nationwide, straight from app_community_meta (the same flag the pages read)."""
    zips, off = set(), 0
    while True:
        url = (f"{SUPA}/rest/v1/app_community_meta?select=zip&indexable=is.true"
               f"&order=zip.asc&limit={STEP}&offset={off}")
        req = urllib.request.Request(url, headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"})
        with urllib.request.urlopen(req, timeout=90) as r:
            page = json.loads(r.read().decode("utf-8"))
        for x in page:
            if x.get("zip"):
                zips.add(x["zip"])
        if len(page) < STEP:
            break
        off += STEP
    return zips


def fetch_dev_zips():
    """Every cached development ZIP page (homesignalmap.html?zip=<zip>). Zero-touch: as the
    development-tracker batch caches more ZIPs into development_reports, they appear here with
    no edit. Public anon read (RLS: public select on development_reports)."""
    zips, off = [], 0
    while True:
        url = (f"{SUPA}/rest/v1/development_reports?select=zip&order=zip.asc"
               f"&limit={STEP}&offset={off}")
        req = urllib.request.Request(url, headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"})
        with urllib.request.urlopen(req, timeout=90) as r:
            page = json.loads(r.read().decode("utf-8"))
        zips += [x["zip"] for x in page if x.get("zip")]
        if len(page) < STEP:
            break
        off += STEP
    return zips


def previously_listed_zips():
    """Community ZIPs already in the on-disk sitemap.xml (the ramp baseline). Missing or
    unreadable file => empty set (first run lists up to MAX_NEW_URLS_PER_RUN)."""
    if not os.path.exists("sitemap.xml"):
        return set()
    try:
        with open("sitemap.xml", encoding="utf-8") as f:
            txt = f.read()
    except OSError:
        return set()
    return set(re.findall(r"community\.html\?zip=(\d{5})", txt))


def url_el(loc, freq, pri):
    return (f"  <url>\n    <loc>{html.escape(loc)}</loc>\n"
            f"    <changefreq>{freq}</changefreq>\n    <priority>{pri}</priority>\n  </url>")


def main():
    index_zips = fetch_index_zips()
    if not index_zips:
        print("ERROR: fetched 0 indexable ZIPs — refusing to overwrite sitemap.xml")
        sys.exit(1)
    # Ramp: keep everything already listed that still qualifies; add at most
    # MAX_NEW_URLS_PER_RUN newcomers per run. De-qualified URLs drop immediately.
    listed = previously_listed_zips() & index_zips
    newcomers = sorted(index_zips - listed)
    deferred = max(0, len(newcomers) - MAX_NEW_URLS_PER_RUN)
    comm_zips = sorted(listed | set(newcomers[:MAX_NEW_URLS_PER_RUN]))
    # development-tracker ZIP pages for the same advertised set (one flag, both page types).
    dev_zips = [z for z in fetch_dev_zips() if z in set(comm_zips)]
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<!-- GENERATED by scripts/gen_sitemap.py — NATIONWIDE SUBSTANCE GATE:',
             '     only ZIP pages whose materializer-stamped app_community_meta.indexable is',
             '     true (pass AND dev-backed OR >=3 facilities) are advertised; empties and',
             '     thin pages are real, reachable pages but noindexed. do NOT hand-edit.',
             f'     {len(comm_zips)} community ZIP pages + {len(dev_zips)} development ZIP pages'
             f' + {len(STATIC)} static pages ({deferred} newcomer(s) deferred by the ramp).',
             '     Regenerated on a schedule. -->',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, freq, pri in STATIC:
        lines.append(url_el(BASE + loc, freq, pri))
    for z in comm_zips:
        lines.append(url_el(f"{BASE}/community.html?zip={urllib.parse.quote(z)}", "daily", "0.8"))
    for z in dev_zips:
        lines.append(url_el(f"{BASE}/homesignalmap.html?zip={urllib.parse.quote(z)}", "daily", "0.8"))
    lines.append("</urlset>")
    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    total = len(comm_zips) + len(dev_zips) + len(STATIC)
    print(f"wrote sitemap.xml (substance gate): {len(comm_zips)} community + {len(dev_zips)} development + "
          f"{len(STATIC)} static = {total} total; {deferred} newcomer(s) deferred to later runs")
    if total > 45000:
        print("WARNING: approaching the 50,000-URL sitemap limit — split into a sitemap index soon.")


if __name__ == "__main__":
    main()
