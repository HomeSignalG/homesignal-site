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
test/zip-pages-no-point.test.mjs, which fails on any such symbol appearing here.

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

# A build that HANGS is worse than a build that fails: the job burns its whole
# timeout-minutes budget and reports nothing. Two consecutive runs stalled inside this
# fetch after several full-corpus pulls in quick succession (throttling), so every request
# now has a short timeout, bounded retries with exponential backoff, and the whole fetch
# phase has a hard deadline that exits non-zero with the row count reached.
REQ_TIMEOUT = 45          # seconds per request
FETCH_BUDGET = 900        # seconds for the entire fetch phase
DEADLINE = [float("inf")]  # set in main(); a list so fetch_all can read it without a global


# ---------------------------------------------------------------- fetch (network half)
def _anon_key():
    cfg = open(os.path.join(os.path.dirname(__file__), "..", "config.js"), encoding="utf-8").read()
    m = re.search(r"SUPABASE_ANON_KEY:\s*'([^']+)'", cfg)
    if not m:
        sys.exit("ERROR: could not read SUPABASE_ANON_KEY from config.js")
    return m.group(1)


def fetch_all(path, key, select, extra="", keyset="id"):
    """KEYSET pagination, not OFFSET. PostgREST silently caps an unbounded select at 1000
    rows, and the rows it drops are the newest - so every read must page. It must page on a
    KEY, though: `offset=132000` against app_changes makes Postgres walk 132,000 rows to
    throw them away, which turned this build into an 11-minute job. Same lesson the live
    verifiers already learned. The keyset column is always in `select` so the cursor exists.
    """
    cols = select if keyset in select.split(",") else f"{keyset},{select}"
    out, last = [], None
    while True:
        cur = f"&{keyset}=gt.{urllib.parse.quote(str(last))}" if last is not None else ""
        url = (f"{SUPA}/rest/v1/{path}?select={cols}{extra}{cur}"
               f"&order={keyset}.asc&limit={STEP}")
        req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
        page = None
        for attempt in range(5):
            if time.time() > DEADLINE[0]:
                sys.exit(f"ERROR: fetch deadline exceeded on {path} after {len(out)} rows - "
                         "failing loudly rather than hanging the job")
            try:
                with urllib.request.urlopen(req, timeout=REQ_TIMEOUT) as r:
                    page = json.loads(r.read().decode("utf-8"))
                break
            except Exception as e:                     # transient: throttle, reset, timeout
                if attempt == 4:
                    sys.exit(f"ERROR: {path} failed after 5 attempts at offset {len(out)}: {e}")
                back = 2 ** attempt
                print(f"  retry {attempt+1}/4 on {path} after {type(e).__name__}: {e} "
                      f"(sleeping {back}s)", flush=True)
                time.sleep(back)
        if not page:
            return out
        out.extend(page)
        last = page[-1][keyset]
        if len(page) < STEP:
            return out


def fetch_data(key, now_iso):
    d = {}
    d["zips"] = [r["zip"] for r in fetch_all("canonical_zip_registry", key, "zip", keyset="zip")]
    d["meta"] = fetch_all("app_community_meta", key,
                          "zip,name,county,state,data_quality,indexable", keyset="zip")
    d["changes"] = fetch_all("app_changes", key,
                             "id,zip,community_id,category,title,source_ref,occurred_at")
    d["agency"] = fetch_all("alerts", key, "id,source_url,agency_name",
                            "&category=eq.local_news")
    # keyset MUST be unique: `gt.` on a non-unique column skips the rest of a tied group
    # the moment a page fills. alert_id is one row per retraction; community_id is not.
    d["retractions"] = fetch_all("local_news_geo_retractions", key,
                                 "alert_id,community_id,source_url", "&active=is.true",
                                 keyset="alert_id")
    d["communities"] = fetch_all("communities", key, "id,name,parent_id,level,zip_codes")
    d["meetings"] = fetch_all("meetings", key,
                              "id,community_id,title,meeting_date,category,source_url",
                              f"&meeting_date=gte.{urllib.parse.quote(now_iso)}")
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


def assemble(d, now_iso):
    """zip -> {name, state, county, dev_indexable, ln[], gn[], um[], counts, rule_f}."""
    zips = list(d["zips"])
    meta = {m["zip"]: m for m in d["meta"]}
    agency = {}
    for a in d["agency"]:                                  # one row per url; min() like the SQL
        u, ag = a.get("source_url"), a.get("agency_name") or ""
        if u is not None and (u not in agency or ag < agency[u]):
            agency[u] = ag
    retracted = {(r.get("community_id"), r.get("source_url")) for r in d["retractions"]}

    # UPCOMING MEETINGS — a faithful port of the SHIPPED client read (lib/data.js::meetings),
    # not a second definition of applicability. Same four steps, same order, same caps:
    #   resolveCommunity(zip)  -> the most-specific community CONTAINING the ZIP (zip >
    #                             neighborhood > city > county), by set membership on
    #                             zip_codes. Never by proximity, never by a centroid.
    #   the ancestor CHAIN     -> up to 6 parent_id hops, so a meeting on any ancestor level
    #                             cascades DOWN onto the ZIP page (the county's commission,
    #                             the city's council).
    #   sibling-exclusion      -> a county root carries EVERY city's council as
    #                             "City government (X)". Only this ZIP's own place(s) may
    #                             show, parsed from the community name exactly as the page
    #                             does it. Without this a Provo page headlines Alpine's
    #                             council — and Rule F would count it.
    #   caps                   -> 24 by date, then 12 after scoping. Same as the page.
    # The earlier draft walked DOWN from every meeting-holding community to its ZIP
    # descendants and applied NO sibling-exclusion, so it both over-attached city councils
    # and inflated the Rule F count for every multi-city county. Divergence from the shipped
    # read is the defect; this removes it.
    LEVEL_RANK = {"zip": 0, "neighborhood": 0, "city": 1, "county": 2}
    by_id = {c["id"]: c for c in d["communities"]}
    resolved = {}
    for c in d["communities"]:
        r = LEVEL_RANK.get(c.get("level"), 3)
        for z in (c.get("zip_codes") or []):
            cur = resolved.get(z)
            # deterministic tie-break on id: PostgREST returns no guaranteed order, and a
            # build that reorders its own output is not reproducible.
            if cur is None or (r, str(c["id"])) < (cur[0], str(cur[1]["id"])):
                resolved[z] = (r, c)
    mtgs_by_cid = {}
    for m in d["meetings"]:
        mtgs_by_cid.setdefault(m.get("community_id"), []).append(m)

    def places_of(community):
        base = re.sub(r"\s*\(\d{5}\)\s*$", "", community.get("name") or "")
        return [x.strip().lower() for x in base.split("/") if x.strip()]

    CITY_RE = re.compile(r"^City government \((.+)\)$")

    def meetings_for(z):
        hit = resolved.get(z)
        if not hit:
            return []
        c = hit[1]
        ids, up, hops = [c["id"]], c, 0
        while up and up.get("parent_id") and hops < 6:
            ids.append(up["parent_id"])
            up = by_id.get(up["parent_id"])
            hops += 1
        rows = []
        for cid in ids:
            # FORWARD-DATED ONLY, asserted here rather than trusted from the fetch. The
            # network read already filters `meeting_date >= now`, but a fixture, a cached
            # payload or a future refactor of fetch_data would not - and a past meeting
            # rendered under "Upcoming public meetings" is a false statement about a public
            # body, not a display nit. Caught by the fixture, which carries a 2020 row.
            rows.extend(m for m in mtgs_by_cid.get(cid, [])
                        if (m.get("meeting_date") or "") >= now_iso)
        rows.sort(key=lambda m: (m.get("meeting_date") or "", str(m.get("id"))))
        pl = places_of(c)
        keep = []
        for m in rows[:24]:                      # the page's own .limit(24)
            city = CITY_RE.match(m.get("category") or "")
            if city and city.group(1).strip().lower() not in pl:
                continue                          # another town's council — not this ZIP's
            keep.append(m)
        return keep[:UM_CAP]                      # the page's own .slice(0, 12)

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
    for z in pages:
        pages[z]["um"] = meetings_for(z)

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
        when = esc(it.get("date") or "")
        inner = f'<a href="{esc(u)}" rel="nofollow noopener">{t}</a>' if u else t
        li.append(f'<li>{inner}{f" <time>{when}</time>" if when else ""}</li>')
    return (f'<section class="zsec"><h2>{esc(heading)}</h2><ul>' + "".join(li) + "</ul></section>")


def render(p, built):
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
    # Usable links in the INITIAL HTML (Step 12). Internal, crawlable, no JavaScript: the
    # ZIP's own development/map page and the site root. Deliberately NOT the legacy
    # community.html?zip= URL — that page canonicalises here, so linking to it from here
    # would re-create the duplicate-identity ambiguity this unit removes.
    links = (f'<nav class="zsec"><a href="/homesignalmap.html?zip={esc(z)}">'
             f'Development &amp; permits map for {esc(z)}</a> · '
             f'<a href="/">HomeSignal home</a> · '
             f'<a href="/how-it-works.html">How HomeSignal works</a></nav>')
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
        + f'<p class="quiet">Compiled from official public records on '
          f'<time datetime="{esc(built)}">{esc(built)}</time>. Every item links to its '
          f'source record; nothing on this page is generated or inferred.</p>'
        + links
        + '</main>')

    return (
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
        '<meta charset="UTF-8">\n'
        # The document lives at /community/<zip>/, two levels deep, while the shared app
        # resolves several URLs RELATIVELY - shell.js fetches 'partials/shell.html' and
        # HS.navHref emits bare 'homesignalmap.html?zip='. Without a base those resolve
        # under /community/<zip>/ and 404, which crashed hydration with
        # "Cannot read properties of null (reading 'addEventListener')" when the shell
        # partial came back as a 404 page. One <base> fixes every relative URL at once and
        # is scoped to the generated documents. The only href="#" in partials/shell.html
        # carries onclick=...return false, so it never navigates and is unaffected.
        '<base href="/">\n'
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
        '<script src="/lib/templates.js?v=5f556744"></script>\n<script src="/lib/impact.js"></script>\n'
        # gov-notice-copy.js MUST load before community-page.js: the shared runtime calls
        # HS.govNoticeCopy.build() for a ZIP with no notices, and this document is the other
        # host of that same runtime. It was added to community.html alone, so every generated
        # page threw "Cannot read properties of undefined (reading 'build')" the moment a
        # sampled ZIP had zero notices - which is what turned the Pages build gate red
        # (run 33929420398, ZIPs 01001 and 01002). Parity with community.html is asserted by
        # test/zip-page-shared-runtime.test.mjs so the next shared dependency cannot ship to
        # one host only.
        '<script src="/shell.js?v=d6e6818c"></script>\n'
        '<script src="/lib/gov-notice-copy.js"></script>\n'
        '<script src="/lib/community-page.js"></script>\n'
        "</body>\n</html>\n")


# ---------------------------------------------------------------- sitemap (in-artifact)
SITEMAP_LEGACY_RE = re.compile(
    r"[ \t]*<url>\s*<loc>[^<]*community\.html\?zip=\d{5}</loc>.*?</url>\s*", re.S)


def _url_el(loc):
    return (f"  <url>\n    <loc>{html.escape(loc)}</loc>\n"
            f"    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>")


def reconcile_sitemap(out_dir, indexable):
    """Rewrite the ARTIFACT's sitemap so the advertised community set is exactly the set of
    documents this build made index-eligible.

    WHY IN THE ARTIFACT AND NOT IN THE REPO. `sitemap.xml` is generated by
    scripts/gen_sitemap.py and COMMITTED, and until the Pages deployment source is switched
    to GitHub Actions that committed file is what production serves. Advertising
    /community/<zip>/ from the repo would advertise 7,000 URLs that do not exist yet — a
    sitemap full of 404s. Rewriting the copy INSIDE the artifact means the sitemap becomes
    correct at exactly the moment the documents it points at start existing, and stays
    untouched if they never do. Same reason the deploy job is gated on main.

    The development half (`homesignalmap.html?zip=`) is deliberately left ALONE: it is
    advertised from app_community_meta.indexable, the development/facility gate, which this
    unit does not change (page-purpose separation).
    """
    path = os.path.join(out_dir, "sitemap.xml")
    zips = sorted(indexable)
    block = "\n".join(_url_el(f"{BASE}/community/{z}/") for z in zips)
    if not os.path.exists(path):
        print("WARNING: no sitemap.xml staged in the artifact — writing community URLs only")
        body = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + block + "\n</urlset>\n")
        open(path, "w", encoding="utf-8").write(body)
        return {"removed": 0, "added": len(zips)}
    txt = open(path, encoding="utf-8").read()
    removed = len(SITEMAP_LEGACY_RE.findall(txt))
    txt = SITEMAP_LEGACY_RE.sub("", txt)
    if "</urlset>" not in txt:
        sys.exit("ERROR: staged sitemap.xml has no </urlset> — refusing to write a broken sitemap")
    txt = txt.replace("</urlset>", block + "\n</urlset>")
    open(path, "w", encoding="utf-8").write(txt)
    n = len(re.findall(r"<loc>[^<]*/community/(\d{5})/</loc>", txt))
    if n != len(zips):
        sys.exit(f"ERROR: sitemap carries {n} community URLs for {len(zips)} indexable ZIPs")
    if re.search(r"community\.html\?zip=", txt):
        sys.exit("ERROR: the legacy community.html?zip= URL survived in the artifact sitemap")
    return {"removed": removed, "added": len(zips)}


# ---------------------------------------------------------------- build + gates
def build(pages, out_dir, canonical, built):
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
        h = render(pages[z], built).encode("utf-8")
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
    DEADLINE[0] = t0 + FETCH_BUDGET
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

    pages = assemble(d, now_iso)
    if len(pages) != len(zips):
        sys.exit(f"ERROR: assembled {len(pages)} pages for {len(zips)} canonical ZIPs")
    npass = sum(1 for p in pages.values() if p["rule_f"])
    stats = build(pages, a.out, zips, now_iso[:10])
    indexable = sorted(z for z, p in pages.items() if p["rule_f"])
    sm = reconcile_sitemap(a.out, indexable)

    print(f"documents      : {stats['documents']}")
    print(f"rule F pass    : {npass}")
    print(f"rule F fail    : {len(pages) - npass}")
    print(f"artifact bytes : {stats['bytes']} ({stats['bytes']/1048576:.1f} MB)")
    print(f"avg html bytes : {stats['avg']}")
    print(f"max html bytes : {stats['max']} (zip {stats['max_zip']})")
    print(f"sitemap        : -{sm['removed']} legacy community.html?zip= URLs, "
          f"+{sm['added']} /community/<zip>/ URLs")
    print(f"build seconds  : {time.time()-t0:.1f}")
    if stats["documents"] != len(zips):
        sys.exit("ERROR: document count != canonical ZIP count")
    if stats["bytes"] > 900 * 1024 * 1024:
        sys.exit("ERROR: artifact exceeds the safe GitHub Pages budget")
    json.dump({"documents": stats["documents"], "rule_f_pass": npass,
               "rule_f_fail": len(pages) - npass,
               "indexable_zips": indexable, "sitemap_community_urls": sm["added"]},
              open(os.path.join(a.out, "zip-pages-manifest.json"), "w"))
    print("OK")


if __name__ == "__main__":
    main()
