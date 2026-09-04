#!/usr/bin/env python3
"""Generate one crawlable HTML document per canonical ZIP geography.

ARCHITECTURE (founder decision, 2026-09-04). One shared implementation
(`lib/community-page.js` + the template in this file) plus a data-driven build produces
ZIP-specific DOCUMENTS that exist ONLY in the GitHub Pages deployment artifact. Nothing
generated here is ever committed. Adding or removing a canonical ZIP requires no
hand-created HTML and no per-ZIP engineering - that is CLAUDE.md 0's actual invariant.

A ZIP IS AN AREA, NOT A POINT (certified 6d9ce37). Nothing in this file reads an address,
a HOME, a lat/lng, a centroid, a radius, a distance or a nearest-point relationship.
Applicability comes from ZIP membership (`app_changes.zip`) and the jurisdiction chain
(`communities.parent_id`), exactly as the shipped pipelines already decide it. Enforced by
tests/zip-pages-no-point.test.mjs, which fails on any such symbol appearing here.

WHY EVERY CANONICAL ZIP GETS A DOCUMENT, not just the Rule F passers: a canonical ZIP URL
must never 404 or fall through to a generic shell, an honest-empty page is a correct
terminal state that must still say so truthfully, and a ZIP crossing the Rule F boundary in
either direction must change only its ROBOTS directive - never its existence. Whether a
document exists and whether it may be indexed are separate decisions.

Rule F (unchanged): >= 3 legitimate non-weather Alerts items across Local News journalism,
Government Notices and forward-dated Upcoming Meetings. Weather displays but never counts.
"""
import argparse, hashlib, html, json, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

SUPA = "https://qwnnmljucajnexpxdgxr.supabase.co"
BASE = "https://homesignal.net"
STEP = 1000

LN_CAP, GN_CAP, UM_CAP = 6, 10, 12          # what the document renders
RULE_F_MIN = 3                               # >= 3 legitimate non-weather items
WEATHER_AGENCY = "api.weather.gov"
GN_CATEGORIES = ("Government & civic", "Planning & zoning")
ZIP_RE = re.compile(r"^[0-9]{5}$")


# ---------------------------------------------------------------- fetch (network half)
def _anon_key():
    cfg = open(os.path.join(os.path.dirname(__file__), "..", "config.js"), encoding="utf-8").read()
    m = re.search(r"SUPABASE_ANON_KEY:\s*'([^']+)'", cfg)
    if not m:
        sys.exit("ERROR: could not read SUPABASE_ANON_KEY from config.js")
    return m.group(1)


def fetch_all(path, key, select, extra=""):
    """Keyset-free offset pagination. PostgREST silently caps an unbounded select at 1000
    rows, and the rows it drops are the newest - so every read here is paginated."""
    out, off = [], 0
    while True:
        url = f"{SUPA}/rest/v1/{path}?select={select}{extra}&limit={STEP}&offset={off}"
        req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=120) as r:
            page = json.loads(r.read().decode("utf-8"))
        out.extend(page)
        if len(page) < STEP:
            return out
        off += STEP


def fetch_data(key, now_iso):
    d = {}
    d["zips"] = [r["zip"] for r in fetch_all("canonical_zip_registry", key, "zip", "&order=zip.asc")]
    d["meta"] = fetch_all("app_community_meta", key,
                          "zip,name,county,state,data_quality,indexable", "&order=zip.asc")
    d["changes"] = fetch_all("app_changes", key,
                             "zip,community_id,category,title,source_ref,occurred_at",
                             "&order=zip.asc,occurred_at.desc")
    d["agency"] = fetch_all("alerts", key, "source_url,agency_name",
                            "&category=eq.local_news&order=source_url.asc")
    d["retractions"] = fetch_all("local_news_geo_retractions", key, "community_id,source_url",
                                 "&active=is.true")
    d["communities"] = fetch_all("communities", key, "id,parent_id,level,zip_codes",
                                 "&order=id.asc")
    d["meetings"] = fetch_all("meetings", key, "community_id,title,meeting_date,category,source_url",
                              f"&meeting_date=gte.{urllib.parse.quote(now_iso)}&order=meeting_date.asc")
    return d


# ---------------------------------------------------------------- assemble (pure half)
def esc(s):
    """Every value below is source-controlled text (publisher headlines, government notice
    titles, jurisdiction names). All of it is untrusted for HTML purposes."""
    return html.escape("" if s is None else str(s), quote=True)


def safe_url(u):
    """Only http(s) may become an href. A javascript:/data: value is dropped, not escaped -
    escaping a hostile scheme still leaves a working hostile link."""
    if not u or not isinstance(u, str):
        return None
    try:
        p = urllib.parse.urlparse(u.strip())
    except ValueError:
        return None
    return u.strip() if p.scheme in ("http", "https") and p.netloc else None


def assemble(d):
    """zip -> {name, state, county, dev_indexable, ln[], gn[], um[], counts, rule_f}."""
    zips = list(d["zips"])
    meta = {m["zip"]: m for m in d["meta"]}
    agency = {}
    for a in d["agency"]:                                  # one row per url; min() like the SQL
        u, ag = a.get("source_url"), a.get("agency_name") or ""
        if u is not None and (u not in agency or ag < agency[u]):
            agency[u] = ag
    retracted = {(r.get("community_id"), r.get("source_url")) for r in d["retractions"]}

    # meetings: walk the jurisdiction chain DOWN from every community holding a forward
    # meeting to its ZIP descendants. Same containment discipline the shipped page uses.
    kids = {}
    for c in d["communities"]:
        kids.setdefault(c.get("parent_id"), []).append(c)
    by_root = {}
    for m in d["meetings"]:
        by_root.setdefault(m["community_id"], []).append(m)
    um_by_zip = {}
    for root, mtgs in by_root.items():
        stack, seen = [root], set()
        while stack:
            cid = stack.pop()
            if cid in seen:
                continue
            seen.add(cid)
            for ch in kids.get(cid, []):
                stack.append(ch["id"])
                if ch.get("level") == "zip":
                    for z in (ch.get("zip_codes") or []):
                        um_by_zip.setdefault(z, {}).update({id(m): m for m in mtgs})
        for c in d["communities"]:
            if c["id"] == root and c.get("level") == "zip":
                for z in (c.get("zip_codes") or []):
                    um_by_zip.setdefault(z, {}).update({id(m): m for m in mtgs})

    pages = {}
    for z in zips:
        mt = meta.get(z, {})
        pages[z] = {"zip": z, "name": mt.get("name") or z, "state": mt.get("state") or "",
                    "county": mt.get("county") or "", "dev_indexable": bool(mt.get("indexable")),
                    "ln": [], "gn": [], "um": []}
    for c in d["changes"]:
        p = pages.get(c.get("zip"))
        if p is None:                                      # off-registry (e.g. removed 80249)
            continue
        cat, title = c.get("category"), c.get("title") or ""
        if cat == "Local News":
            if (c.get("community_id"), c.get("source_ref")) in retracted:
                continue                                   # effective corpus, not raw
            p["ln"].append({"title": title, "url": c.get("source_ref"),
                            "date": (c.get("occurred_at") or "")[:10],
                            "weather": agency.get(c.get("source_ref"), "") == WEATHER_AGENCY})
        elif cat in GN_CATEGORIES and not title.startswith("Public meeting"):
            p["gn"].append({"title": title, "url": c.get("source_ref"),
                            "date": (c.get("occurred_at") or "")[:10], "cat": cat})
    for z, mm in um_by_zip.items():
        if z in pages:
            pages[z]["um"] = sorted(mm.values(), key=lambda m: (m.get("meeting_date") or "", m.get("title") or ""))

    for p in pages.values():
        p["ln"].sort(key=lambda x: (x["date"], x["title"]), reverse=True)
        p["gn"].sort(key=lambda x: (x["date"], x["title"]), reverse=True)
        journalism = [x for x in p["ln"] if not x["weather"]]
        p["n_ln_journalism"], p["n_gn"] = len(journalism), len(p["gn"])
        p["n_um"] = min(len(p["um"]), UM_CAP)
        p["rule_f_count"] = p["n_ln_journalism"] + p["n_gn"] + p["n_um"]
        p["rule_f"] = p["rule_f_count"] >= RULE_F_MIN
    return pages


# ---------------------------------------------------------------- render
def _items(items, heading, empty, kind):
    if not items:
        return f'<section class="zsec"><h2>{esc(heading)}</h2><p class="quiet">{esc(empty)}</p></section>'
    li = []
    for it in items:
        t, u = esc(it["title"]), safe_url(it.get("url"))
        when = esc(it.get("date") or it.get("meeting_date", "")[:10] if kind == "um" else it.get("date"))
        inner = f'<a href="{esc(u)}" rel="nofollow noopener">{t}</a>' if u else t
        li.append(f'<li>{inner}{f" <time>{when}</time>" if when else ""}</li>')
    return (f'<section class="zsec"><h2>{esc(heading)}</h2><ul>' + "".join(li) + "</ul></section>")


def render(p):
    z, name, st = p["zip"], p["name"], p["state"]
    label = f"{name}, {st}" if st else name
    title = f"{label} — local government notices, meetings & news | HomeSignal"
    if p["rule_f"]:
        desc = (f"Government notices, upcoming public meetings and local news for ZIP {z} "
                f"({label}): {p['n_gn']} notices, {p['n_um']} upcoming meetings, "
                f"{p['n_ln_journalism']} local news items on record.")
    else:
        desc = (f"HomeSignal tracks government notices, public meetings and local news for "
                f"ZIP {z} ({label}). No qualifying records on file yet — checks repeat "
                f"automatically.")
    robots = "index, follow" if p["rule_f"] else "noindex, follow"
    canon = f"{BASE}/community/{z}/"
    ln_show = [x for x in p["ln"] if not x["weather"]][:LN_CAP]
    wx = [x for x in p["ln"] if x["weather"]][:3]
    um_show = p["um"][:UM_CAP]
    um_items = [{"title": m.get("title"), "url": m.get("source_url"),
                 "date": (m.get("meeting_date") or "")[:10]} for m in um_show]

    county_bit = f" in {esc(p['county'])} County" if p["county"] else ""
    body = (
        f'<main id="hs-ssr"><header><p class="eyebrow">Communities</p>'
        f'<h1>{esc(z)} · {esc(label)}</h1>'
        f'<p>Government notices, public meetings and local news that apply to the whole of '
        f'ZIP {esc(z)}{county_bit}.</p></header>'
        + _items(p["gn"][:GN_CAP], "Government notices",
                 "No government notices on file for this ZIP yet.", "gn")
        + _items(um_items, "Upcoming public meetings",
                 "No upcoming public meetings on file for this ZIP yet.", "um")
        + _items(ln_show, "Local news",
                 "No qualifying local news on file for this ZIP yet.", "ln")
        + (_items(wx, "Weather alerts", "", "wx") if wx else "")
        + '</main>')

    return (
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
        '<meta charset="UTF-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        f'<meta name="robots" content="{robots}" id="robots-meta">\n'
        f"<title>{esc(title)}</title>\n"
        f'<meta name="description" content="{esc(desc)}">\n'
        f'<link rel="canonical" href="{esc(canon)}">\n'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; base-uri \'self\'; '
        "object-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' "
        'https://qwnnmljucajnexpxdgxr.supabase.co wss://qwnnmljucajnexpxdgxr.supabase.co; '
        'form-action \'self\'">\n'
        '<link rel="stylesheet" href="/app.css">\n</head>\n'
        f'<body data-nav="comm" data-zip="{esc(z)}">\n{body}\n'
        '<template id="hs-content"><div class="page" id="commPage"></div></template>\n'
        '<script src="/config.js"></script>\n<script src="/seed/delvalle.js"></script>\n'
        '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n'
        '<script src="/lib/data.js"></script>\n<script src="/lib/topic-prefs.js"></script>\n'
        '<script src="/lib/templates.js"></script>\n<script src="/lib/impact.js"></script>\n'
        '<script src="/shell.js"></script>\n<script src="/lib/community-page.js"></script>\n'
        "</body>\n</html>\n")


# ---------------------------------------------------------------- build + gates
def build(pages, out_dir, canonical):
    canon = set(canonical)
    written, total, mx, mxz = 0, 0, 0, None
    for z in sorted(pages):
        if not ZIP_RE.match(z):
            sys.exit(f"ERROR: non-numeric ZIP refused: {z!r}")
        if z not in canon:
            sys.exit(f"ERROR: ZIP not in canonical registry refused: {z!r}")
        d = os.path.join(out_dir, "community", z)
        if os.path.abspath(d) != os.path.normpath(os.path.abspath(d)) or ".." in z:
            sys.exit(f"ERROR: path traversal refused: {z!r}")
        os.makedirs(d, exist_ok=True)
        h = render(pages[z]).encode("utf-8")
        open(os.path.join(d, "index.html"), "wb").write(h)
        written += 1
        total += len(h)
        if len(h) > mx:
            mx, mxz = len(h), z
    return {"documents": written, "bytes": total, "avg": total // max(written, 1),
            "max": mx, "max_zip": mxz}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="_site")
    ap.add_argument("--fixture", help="read data from a JSON fixture instead of the network")
    ap.add_argument("--now", help="ISO instant for the forward-meeting window (determinism)")
    a = ap.parse_args()
    t0 = time.time()
    now_iso = a.now or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    if a.fixture:
        d = json.load(open(a.fixture, encoding="utf-8"))
    else:
        d = fetch_data(_anon_key(), now_iso)

    zips = d["zips"]
    if len(zips) != len(set(zips)):
        sys.exit(f"ERROR: duplicate ZIPs in canonical registry: {len(zips)} rows, {len(set(zips))} distinct")
    if "80249" in set(zips):
        sys.exit("ERROR: ZIP 80249 present in the canonical registry - removed drift page")
    print(f"canonical registry: {len(zips)} rows, {len(set(zips))} distinct, 0 duplicates")

    pages = assemble(d)
    if len(pages) != len(zips):
        sys.exit(f"ERROR: assembled {len(pages)} pages for {len(zips)} canonical ZIPs")
    npass = sum(1 for p in pages.values() if p["rule_f"])
    stats = build(pages, a.out, zips)

    print(f"documents      : {stats['documents']}")
    print(f"rule F pass    : {npass}")
    print(f"rule F fail    : {len(pages) - npass}")
    print(f"artifact bytes : {stats['bytes']} ({stats['bytes']/1048576:.1f} MB)")
    print(f"avg html bytes : {stats['avg']}")
    print(f"max html bytes : {stats['max']} (zip {stats['max_zip']})")
    print(f"build seconds  : {time.time()-t0:.1f}")
    if stats["documents"] != len(zips):
        sys.exit("ERROR: document count != canonical ZIP count")
    if stats["bytes"] > 900 * 1024 * 1024:
        sys.exit("ERROR: artifact exceeds the safe GitHub Pages budget")
    json.dump({"documents": stats["documents"], "rule_f_pass": npass,
               "rule_f_fail": len(pages) - npass,
               "indexable_zips": sorted(z for z, p in pages.items() if p["rule_f"])},
              open(os.path.join(a.out, "zip-pages-manifest.json"), "w"))
    print("OK")


if __name__ == "__main__":
    main()
