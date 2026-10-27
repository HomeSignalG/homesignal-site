#!/usr/bin/env python3
"""Submit one day's slice of ZIP-page URLs to Bing through the Bing Webmaster Submission API.

Replaces the daily hand-paste into Bing URL Submission. Reads the LIVE sitemaps, so a page set to
noindex (never in a sitemap) is never sent. The queue order is fixed:
  1. /map/<zip>/ pages for the ZIPs already sent as community pages, in the order of
     docs/seo/bing-submitted.txt (minus docs/seo/bing-submitted-maps.txt),
  2. /community/<zip>/ pages not yet sent,
  3. the remaining /map/<zip>/ pages.
Day N (days since --start-date, UTC) sends queue[N*count : (N+1)*count]. No state is written, so
the job needs no push; a day the schedule did not fire is skipped (re-run with --day N).

Without BING_WEBMASTER_API_KEY it only prints the slice (dry run) and exits 0.

  python3 scripts/bing_daily_submit.py                      # today's slice
  python3 scripts/bing_daily_submit.py --day 3 --dry-run
  python3 scripts/bing_daily_submit.py --community-sitemap c.xml --map-sitemap m.xml   # offline
"""
import argparse, datetime, json, os, re, sys, urllib.error, urllib.request

HOST = "https://www.jodytracks.com"
COMMUNITY_SITEMAPS = ("/sitemaps/zip-alerts.xml", "/sitemap.xml")
MAP_SITEMAPS = ("/sitemaps/map.xml", "/sitemap.xml")
API = "https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch"
START_DATE = "2026-10-27"
COMMUNITY_LOC = re.compile(r"<loc>\s*https?://[^<\s/]+/community/(\d{5})/\s*</loc>")
MAP_LOC = re.compile(r"<loc>\s*https?://[^<\s/]+/map/(\d{5})/\s*</loc>")


def zips_in(pattern, xml):
    out = []
    for z in pattern.findall(xml):
        if z not in out:
            out.append(z)
    return out


def ordered_zips(text):
    out = []
    for line in text.splitlines():
        z = line.strip()
        if re.fullmatch(r"\d{5}", z) and z not in out:
            out.append(z)
    return out


def build_queue(community_zips, map_zips, sent_community, sent_maps):
    """Fixed-order list of (kind, zip). See the module docstring for the order."""
    map_set, comm_set = set(map_zips), set(community_zips)
    sent_c, sent_m = set(sent_community), set(sent_maps)
    queue, seen = [], set()

    def add(kind, z):
        if (kind, z) not in seen:
            seen.add((kind, z))
            queue.append((kind, z))

    for z in sent_community:
        if z in map_set and z not in sent_m:
            add("map", z)
    for z in community_zips:
        if z not in sent_c:
            add("community", z)
    for z in map_zips:
        if z not in sent_m:
            add("map", z)
    return queue


def url_of(kind, z):
    return f"{HOST}/{'map' if kind == 'map' else 'community'}/{z}/"


def slice_for(queue, day, count):
    return queue[day * count:(day + 1) * count]


def day_index(today, start):
    return (today - datetime.date.fromisoformat(start)).days


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "bing-daily-submit/1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def read_sitemap(paths, pattern, label):
    for path in paths:
        try:
            zips = zips_in(pattern, fetch(HOST + path))
        except Exception as e:  # noqa: BLE001 - try the next sitemap, fail loudly below
            print(f"note: {path}: {e}", file=sys.stderr)
            continue
        if zips:
            return zips
    sys.exit(f"ERROR: no {label} URLs found in the sitemap; nothing was measured")


def submit(urls, key):
    """POST the batch. The key travels in the query string and is never printed."""
    body = json.dumps({"siteUrl": HOST, "urlList": urls}).encode("utf-8")
    req = urllib.request.Request(API + "?apikey=" + key, data=body, method="POST",
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")[:500]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:500]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=100)
    ap.add_argument("--day", type=int)
    ap.add_argument("--start-date", default=START_DATE)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--community-sitemap")
    ap.add_argument("--map-sitemap")
    ap.add_argument("--sent", default="docs/seo/bing-submitted.txt")
    ap.add_argument("--sent-maps", default="docs/seo/bing-submitted-maps.txt")
    a = ap.parse_args(argv)
    if a.count < 1 or a.count > 100:
        sys.exit("ERROR: --count must be 1 to 100 (Bing's daily quota)")
    if a.community_sitemap:
        cz = zips_in(COMMUNITY_LOC, open(a.community_sitemap, encoding="utf-8").read())
    else:
        cz = read_sitemap(COMMUNITY_SITEMAPS, COMMUNITY_LOC, "/community/<zip>/")
    if a.map_sitemap:
        mz = zips_in(MAP_LOC, open(a.map_sitemap, encoding="utf-8").read())
    else:
        mz = read_sitemap(MAP_SITEMAPS, MAP_LOC, "/map/<zip>/")
    if not cz or not mz:
        sys.exit("ERROR: a sitemap has no ZIP pages; nothing was measured")
    sent = ordered_zips(open(a.sent, encoding="utf-8").read())
    sent_maps = ordered_zips(open(a.sent_maps, encoding="utf-8").read())
    queue = build_queue(cz, mz, sent, sent_maps)
    day = a.day if a.day is not None else day_index(datetime.datetime.now(datetime.timezone.utc).date(), a.start_date)
    if day < 0:
        sys.exit(f"ERROR: day {day} is before the start date {a.start_date}")
    todays = slice_for(queue, day, a.count)
    urls = [url_of(k, z) for k, z in todays]
    kinds = {k: sum(1 for kk, _ in todays if kk == k) for k in ("map", "community")}
    head = (f"day {day} · queue {len(queue)} · this slice {len(urls)} "
            f"({kinds['map']} map, {kinds['community']} community) · "
            f"days left after this one {max(0, -(-len(queue) // a.count) - day - 1)}")
    print(head)
    print("----- BEGIN BATCH -----")
    print("\n".join(urls))
    print("----- END BATCH -----")
    key = os.environ.get("BING_WEBMASTER_API_KEY", "").strip()
    result = "dry run (no submission)"
    code = 0
    if not urls:
        result = "queue finished: nothing to send"
    elif a.dry_run or not key:
        result = "dry run (no submission)" if a.dry_run else "NOT SUBMITTED: BING_WEBMASTER_API_KEY is not set"
    else:
        status, text = submit(urls, key)
        result = f"submitted: HTTP {status} {text}"
        if status != 200:
            code = 1
    print(result)
    summ = os.environ.get("GITHUB_STEP_SUMMARY")
    if summ:
        with open(summ, "a", encoding="utf-8") as f:
            f.write(f"### Bing daily submit\n{head}\n\n**{result}**\n\n```\n" + "\n".join(urls) + "\n```\n")
    sys.exit(code)


if __name__ == "__main__":
    main()
