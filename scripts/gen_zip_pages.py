#!/usr/bin/env python3
"""Generate PRE-RENDERED ZIP development pages — BOX ELDER COUNTY, UTAH TEST SET ONLY.

WHY THIS EXISTS
---------------
`homesignalmap.html?zip=<zip>` puts every word of its content behind JavaScript: the
body is an inert `<template>`, the robots meta ships `noindex, nofollow` and is flipped
only after two awaited Supabase calls, and the canonical is hardcoded to the
parameterless `/homesignalmap.html`. A crawler that does not render JS sees an empty
document; one that does render still reads a served `noindex` first. This generator
emits ORDINARY HTML for the same data so the content exists before any script runs.

    INDEXABLE BUILD-TIME CONTENT  +  the existing INTERACTIVE MAP (lazily iframed)

⚠️ SCOPE IS DELIBERATELY 18 ZIPs. This is a controlled test over Box Elder County, Utah.
Do NOT widen `COUNTY` or add a second county without founder approval — see §I of the
implementation report and the STOP CONDITION in the brief that authorised this.

RELATIONSHIP TO CLAUDE.md §0 ("communities are DATA, not code")
--------------------------------------------------------------
§0 forbids *hand-authored* per-community HTML files, because they make adding a
community an engineering task. This generator does not reintroduce that cost: the page
set is DERIVED from `app_community_meta` / `app_projects`, exactly as `sitemap.xml` is
derived by `scripts/gen_sitemap.py` and committed by `.github/workflows/sitemap.yml`.
Adding a community is still one DB row; the scheduled job picks it up. The artifact is
generated, never edited by hand — the same contract as sitemap.xml.

DATA SOURCES (read-only, public anon key — no secrets)
------------------------------------------------------
  app_community_meta  zip, name, county, state, indexable, data_quality, lat, lng
  app_projects        record_kind='development'  → the rendered records
  app_projects        record_kind='facility'     → environmental count only
  alerts / meetings   Box Elder County civic block (real dates)

THE INDEX RULE IMPLEMENTED HERE IS STRICTER THAN THE DATABASE FLAG.
`app_refresh_zip` stamps `indexable = (_ndp > 0 OR _nfc >= 3)` — the second arm lets a
page with ZERO development records qualify on EPA facilities alone. This generator
requires `dev_projects >= 1`; EPA/environmental records never make an otherwise-empty
development page indexable. Environmental data is still rendered as a count and is not
altered anywhere. See `index_decision()`.

USAGE
-----
  python3 scripts/gen_zip_pages.py --from-snapshot data/box-elder-zip-pages.snapshot.json
  python3 scripts/gen_zip_pages.py            # live REST (CI); needs egress to Supabase
  python3 scripts/gen_zip_pages.py --check    # verify on-disk pages match; non-zero on drift
"""
import argparse
import html
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request

SUPA = "https://qwnnmljucajnexpxdgxr.supabase.co"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3"
        "bm5tbGp1Y2FqbmV4cHhkZ3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTAyOTgsImV4cCI6"
        "MjA5NTk4NjI5OH0.prpXB6lSIhWMAsdkkaxAfkvEodbojfUUyN4L4JbQE1U")
BASE = "https://homesignal.net"

# ── the controlled test set ────────────────────────────────────────────────────
# Read from communities.zip_codes of the `box-elder` county row (id d67c558f-…),
# NOT typed by hand. Pinned here so the generator's scope cannot drift silently.
COUNTY = {
    "slug": "box-elder", "state_slug": "ut",
    "name": "Box Elder County", "state": "UT", "state_name": "Utah",
    "community_id": "d67c558f-1f04-4811-a565-873ae2afd6f3",
}
TEST_ZIPS = ["84301", "84302", "84306", "84307", "84309", "84311", "84312", "84313",
             "84314", "84316", "84324", "84329", "84330", "84331", "84334", "84336",
             "84337", "84340"]

OUT_ROOT = os.path.join("developments", COUNTY["state_slug"], COUNTY["slug"])
HUB_URL = f"{BASE}/{OUT_ROOT}/"
MAX_RECORDS = 20        # records rendered into raw HTML per ZIP
MAX_NEIGHBOURS = 4      # nearest sibling ZIPs linked from each page

_ZIP_SUFFIX = re.compile(r"\s*\(\d{5}\)\s*$")


# ── helpers ───────────────────────────────────────────────────────────────────
def e(v):
    """HTML-escape. None becomes empty — an absent field is never printed."""
    return html.escape(str(v), quote=True) if v not in (None, "") else ""


def place_label(name, zip_code):
    """City/community label, or None when attribution is not reliable.

    `app_community_meta.name` is either a bare USPS place ("Garland") or a
    place+ZIP ("Brigham City (84302)"). Strip the suffix. A name that is empty,
    or that is just the ZIP, is NOT reliable → callers fall back to the
    ZIP-only title/H1 wording.
    """
    if not name:
        return None
    label = _ZIP_SUFFIX.sub("", str(name)).strip()
    if not label or label == zip_code:
        return None
    return label


def index_decision(z):
    """THE deterministic rule. Returns (indexable: bool, reason: str).

    Stricter than app_community_meta.indexable on purpose: EPA/environmental
    records alone never qualify a development page. Order matters — the first
    failing clause is the reported reason.
    """
    if z.get("data_quality") != "pass":
        return False, f"data_quality={z.get('data_quality')} (not 'pass')"
    n = int(z.get("dev_projects") or 0)
    if n < 1:
        fac = int(z.get("facilities") or 0)
        return False, (f"0 development records ({fac} environmental record(s) present; "
                       f"environmental records alone do not qualify a development page)")
    return True, f"{n} distinct development record(s) from public permit/project sources"


def haversine_mi(a_lat, a_lng, b_lat, b_lng):
    r = 3958.8
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def zip_url(zip_code):
    return f"{BASE}/{OUT_ROOT}/{zip_code}/"


def fmt_date(d):
    """ISO date → '12 Jun 2026'. Anything unparseable returns None (never guessed)."""
    if not d:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(d))
    if not m:
        return None
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    y, mo, day = m.groups()
    return f"{int(day)} {months[int(mo) - 1]} {y}"


# ── live fetch (CI) ───────────────────────────────────────────────────────────
def _get(path):
    req = urllib.request.Request(SUPA + path,
                                 headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_live():
    """Rebuild the same structure the snapshot holds, from live PostgREST."""
    inlist = ",".join(TEST_ZIPS)
    meta = {m["zip"]: m for m in _get(
        "/rest/v1/app_community_meta?select=zip,name,county,state,data_quality,"
        f"indexable,lat,lng&zip=in.({inlist})")}
    reports = {r["zip"]: r for r in _get(
        f"/rest/v1/development_reports?select=zip,refreshed_at&zip=in.({inlist})")}

    zips = []
    for zc in TEST_ZIPS:
        m = meta.get(zc)
        if not m:
            print(f"WARNING: {zc} has no app_community_meta row — skipped", file=sys.stderr)
            continue
        rows = _get("/rest/v1/app_projects?select=name,type,status,stage,submitted_at,"
                    "date_kind,address,provenance,registry_id,source_ref"
                    f"&zip=eq.{zc}&record_kind=eq.development&order=submitted_at.desc")
        fac = _get(f"/rest/v1/app_projects?select=zip&zip=eq.{zc}&record_kind=eq.facility")
        # Display de-dup: the same project is emitted once per geometry point inside the
        # ZIP radius, so (name, case_number) collapses to one visible record.
        seen, projects = set(), []
        for r in rows:
            prov = r.get("provenance") or {}
            key = (r.get("name"), prov.get("case_number") or "")
            if key in seen:
                continue
            seen.add(key)
            projects.append({
                "name": r.get("name"), "type": r.get("type"), "status": r.get("status"),
                "stage": r.get("stage"), "date": r.get("submitted_at"),
                "date_kind": r.get("date_kind"), "address": r.get("address"),
                "jurisdiction": prov.get("jurisdiction"), "case_number": prov.get("case_number"),
                "url_precision": prov.get("url_precision"), "source_id": r.get("registry_id"),
                "url": r.get("source_ref"),
            })
        zips.append({
            "zip": zc, "name": m.get("name"), "county": m.get("county"), "state": m.get("state"),
            "data_quality": m.get("data_quality"), "indexable_db": m.get("indexable"),
            "lat": m.get("lat"), "lng": m.get("lng"),
            "refreshed_at": (reports.get(zc) or {}).get("refreshed_at"),
            "dev_records_total": len(rows), "dev_projects": len(projects),
            "facilities": len(fac),
            "sources": sorted({r.get("registry_id") for r in rows if r.get("registry_id")}),
            "projects": projects[:MAX_RECORDS],
        })

    cid = COUNTY["community_id"]
    notices = _get("/rest/v1/alerts?select=title,created_at,category,agency_name,source_url"
                   f"&community_id=eq.{cid}&pipeline_type=eq.government_notice"
                   "&source_url=not.is.null&order=created_at.desc&limit=9")
    meetings = _get("/rest/v1/meetings?select=title,meeting_date,location,source_url,agency_name"
                    f"&community_id=eq.{cid}&source_url=not.is.null"
                    "&order=meeting_date.asc&limit=12")
    county = dict(COUNTY)
    county["notices"] = [{"title": n["title"], "date": (n.get("created_at") or "")[:10],
                          "category": n.get("category"), "agency": n.get("agency_name"),
                          "url": n.get("source_url")} for n in notices]
    county["meetings"] = [{"title": m["title"], "date": (m.get("meeting_date") or "")[:10],
                           "body": m.get("agency_name"), "location": m.get("location"),
                           "url": m.get("source_url")} for m in meetings]
    return {"zips": zips, "county": county}


# ── page rendering ────────────────────────────────────────────────────────────
CSS = """*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f3f4f6;color:#1c1c1a;line-height:1.6;font-size:16px;
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:#1f5130}
.wrap{max-width:940px;margin:0 auto;padding:0 20px 72px}
header.site{background:#fff;border-bottom:1px solid rgba(0,0,0,.12)}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;
 padding-top:14px;padding-bottom:14px;gap:16px;flex-wrap:wrap}
.brand{font-weight:700;font-size:17px;color:#1c1c1a;text-decoration:none}
.brand span{color:#1f5130}
nav.crumbs{font-size:13.5px;color:#5f5e5a;padding:16px 0 0}
nav.crumbs ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
nav.crumbs li::after{content:"›";margin-left:6px;color:#9a9a96}
nav.crumbs li:last-child::after{content:""}
h1{font-size:30px;line-height:1.2;letter-spacing:-.02em;margin:12px 0 10px}
h2{font-size:20px;margin:34px 0 10px;letter-spacing:-.01em}
h3{font-size:16px;margin:0 0 4px}
.lede{font-size:17px;color:#41403d;margin:0 0 18px;max-width:64ch}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 8px;padding:0;list-style:none}
.stats li{background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:9px;
 padding:9px 14px;min-width:112px}
.stats b{display:block;font-size:22px;line-height:1.15;font-variant-numeric:tabular-nums}
.stats span{font-size:12px;color:#5f5e5a}
.rec{background:#fff;border:1px solid rgba(0,0,0,.1);border-left:3px solid #9a9a96;
 border-radius:9px;padding:13px 15px;margin:0 0 10px}
.rec.proposed{border-left-color:#e2772f}.rec.approved{border-left-color:#3f7fb0}
.rec.operating,.rec.active{border-left-color:#1f5130}
.rec .tag{display:inline-block;font-size:11.5px;font-weight:600;letter-spacing:.04em;
 text-transform:uppercase;color:#5f5e5a}
.rec dl{margin:7px 0 0;display:grid;grid-template-columns:max-content 1fr;gap:2px 14px;font-size:13.5px}
.rec dt{color:#6f6e69}.rec dd{margin:0}
.rec .src{display:inline-block;margin-top:8px;font-size:13px;font-weight:600}
.muted{color:#5f5e5a;font-size:14px}
.note{background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:9px;padding:13px 15px;
 font-size:14px;color:#41403d;margin:14px 0}
ul.plain{list-style:none;margin:0;padding:0}
ul.plain li{background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:9px;
 padding:11px 14px;margin-bottom:8px;font-size:14.5px}
.ziplinks{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:8px;
 list-style:none;margin:0;padding:0}
.ziplinks li{background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:9px;padding:10px 13px}
.ziplinks a{font-weight:600;text-decoration:none}
.ziplinks .c{display:block;font-size:12.5px;color:#5f5e5a;margin-top:1px}
#map-embed{margin:12px 0 0;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:11px;
 overflow:hidden;min-height:120px}
#map-embed iframe{display:block;width:100%;height:520px;border:0}
#map-embed .ph{padding:22px 16px;text-align:center}
footer.site{border-top:1px solid rgba(0,0,0,.12);background:#fff;margin-top:44px}
footer.site .wrap{padding-top:22px;padding-bottom:26px;font-size:13px;color:#6f6e69}
footer.site a{margin-right:16px}
@media(max-width:640px){h1{font-size:24px}.rec dl{grid-template-columns:1fr;gap:0 0}
 .rec dt{margin-top:5px}#map-embed iframe{height:400px}}"""

CSP = ("default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; "
       "font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
       "frame-src 'self'; form-action 'self'")


def head(title, desc, canonical, robots, crumbs_ld=None):
    ld = ""
    if crumbs_ld:
        ld = ('<script type="application/ld+json">'
              + json.dumps(crumbs_ld, separators=(",", ":")) + "</script>\n")
    return (
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
        "<meta charset=\"UTF-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
        f"<meta http-equiv=\"Content-Security-Policy\" content=\"{CSP}\">\n"
        f"<title>{e(title)}</title>\n"
        f"<meta name=\"description\" content=\"{e(desc)}\">\n"
        f"<meta name=\"robots\" content=\"{robots}\">\n"
        f"<link rel=\"canonical\" href=\"{e(canonical)}\">\n"
        "<link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\">\n"
        "<meta property=\"og:type\" content=\"website\">\n"
        f"<meta property=\"og:url\" content=\"{e(canonical)}\">\n"
        f"<meta property=\"og:title\" content=\"{e(title)}\">\n"
        f"<meta property=\"og:description\" content=\"{e(desc)}\">\n"
        "<meta property=\"og:image\" content=\"https://homesignal.net/og-default.png\">\n"
        "<meta name=\"twitter:card\" content=\"summary_large_image\">\n"
        f"<style>\n{CSS}\n</style>\n" + ld +
        "</head>\n<body>\n"
        "<header class=\"site\"><div class=\"wrap\">"
        "<a class=\"brand\" href=\"/\">Home<span>Signal</span></a>"
        "<a href=\"/how-it-works.html\">How it works</a>"
        "</div></header>\n<div class=\"wrap\">\n")


def crumbs(items):
    """items: [(label, href|None)] — last item has no href."""
    li = []
    for label, href in items:
        inner = f'<a href="{e(href)}">{e(label)}</a>' if href else e(label)
        li.append(f"<li>{inner}</li>")
    return ('<nav class="crumbs" aria-label="Breadcrumb"><ol>' + "".join(li) + "</ol></nav>\n")


def crumbs_jsonld(items):
    """BreadcrumbList mirroring the VISIBLE breadcrumb exactly (Phase 8 rule)."""
    el = []
    for i, (label, href) in enumerate(items, start=1):
        item = {"@type": "ListItem", "position": i, "name": label}
        if href:
            item["item"] = href if href.startswith("http") else BASE + href
        el.append(item)
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": el}


def footer(extra_links=(), tail=""):
    """Closes the document. `tail` (the map loader) goes INSIDE <body>.

    A <script> emitted after </html> is malformed: browsers relocate it
    inconsistently and it did not execute at all under headless Chrome's
    --dump-dom, which is how this was caught. Anything executable belongs before
    </body>, after the content it enhances.
    """
    links = "".join(f'<a href="{e(h)}">{e(t)}</a>' for t, h in extra_links)
    return ("</div>\n<footer class=\"site\"><div class=\"wrap\">"
            + links +
            '<a href="/">HomeSignal home</a><a href="/about.html">About</a>'
            '<a href="/privacy.html">Privacy</a>'
            "<p>Every record on this page links to the official public record it came from. "
            "HomeSignal aggregates public records and does not editorialise them.</p>"
            "</div></footer>\n" + tail + "</body>\n</html>\n")


MAP_LOADER = """<script>
/* Progressive enhancement ONLY. The records above are already in this document; this
   script adds the existing interactive HomeSignal map (homesignalmap.html, unmodified)
   in an iframe once the region scrolls into view. With JS off the fallback link below
   stays visible and the page loses nothing but the map. */
(function(){
  var box=document.getElementById('map-embed'); if(!box) return;
  var src=box.getAttribute('data-src'); if(!src) return;
  function load(){
    if(box.getAttribute('data-loaded')) return;
    box.setAttribute('data-loaded','1');
    var f=document.createElement('iframe');
    f.src=src; f.loading='lazy'; f.title=box.getAttribute('data-title')||'Development map';
    box.innerHTML=''; box.appendChild(f);
  }
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){
      es.forEach(function(x){ if(x.isIntersecting){ load(); io.disconnect(); } });
    },{rootMargin:'240px'});
    io.observe(box);
  } else { load(); }
})();
</script>
"""


def render_record(p):
    """One development record. A field the row does not carry is simply not printed."""
    status = (p.get("status") or "").strip()
    cls = status.lower() if status.lower() in ("proposed", "approved", "operating", "active") else ""
    rows = []
    if p.get("type"):
        rows.append(("Type", e(p["type"])))
    if p.get("stage") and p.get("stage") != status:
        rows.append(("Stage", e(p["stage"])))
    if p.get("address"):
        rows.append(("Location", e(p["address"])))
    d = fmt_date(p.get("date"))
    if d:
        kind = {"filed": "Filed", "decided": "Decided", "awarded": "Awarded"}.get(
            (p.get("date_kind") or "").lower(), "Dated")
        rows.append((kind, e(d)))
    if p.get("jurisdiction"):
        rows.append(("Jurisdiction", e(p["jurisdiction"])))
    if p.get("case_number"):
        rows.append(("Case / reference", e(p["case_number"])))
    dl = ""
    if rows:
        dl = "<dl>" + "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in rows) + "</dl>"
    src = ""
    if p.get("url"):
        # url_precision 'dataset' means the link resolves to the publisher's dataset,
        # not a per-record page. Say so rather than implying a deep link.
        word = ("View the official record"
                if p.get("url_precision") == "record" else "View the official source dataset")
        src = (f'<a class="src" href="{e(p["url"])}" rel="nofollow noopener" '
               f'target="_blank">{word} →</a>')
    tag = f'<span class="tag">{e(status)}</span>' if status else ""
    return (f'<article class="rec {cls}">{tag}'
            f'<h3>{e(p.get("name") or "Untitled record")}</h3>{dl}{src}</article>')


def render_zip_page(z, county, neighbours):
    zc = z["zip"]
    label = place_label(z.get("name"), zc)
    n = int(z.get("dev_projects") or 0)
    fac = int(z.get("facilities") or 0)
    indexable, reason = index_decision(z)
    canonical = zip_url(zc)

    if label:
        title = f"New & Proposed Developments in {label}, UT {zc} | HomeSignal"
        h1 = f"Development Projects in {label}, Utah {zc}"
        where = f"{label}, Utah {zc}"
    else:
        title = f"New & Proposed Developments in ZIP Code {zc} | HomeSignal"
        h1 = f"Development Projects in ZIP Code {zc}"
        where = f"ZIP code {zc}"

    if n:
        desc = (f"Explore {n} proposed and current development records in and around {where}. "
                "Track projects, filings and local development activity with HomeSignal.")
    else:
        desc = (f"HomeSignal tracks development filings, public hearings and county notices for "
                f"{where}. No permit or project records are on file for this ZIP code yet.")

    cr = [("HomeSignal", "/"),
          (f"{county['name']}, {county['state_name']}", f"/{OUT_ROOT}/"),
          (where, None)]

    out = [head(title, desc, canonical, "index, follow" if indexable else "noindex, follow",
                crumbs_jsonld(cr))]
    out.append(crumbs(cr))
    out.append(f"<h1>{e(h1)}</h1>\n")

    if n:
        out.append(f'<p class="lede">HomeSignal is tracking <strong>{n}</strong> development '
                   f'record{"" if n == 1 else "s"} in and around {e(where)}, drawn from public '
                   f'permit and project registries. Every record below links to the official '
                   f'source it came from.</p>\n')
    else:
        out.append(f'<p class="lede">No permit or project records are on file for {e(where)} yet. '
                   f'HomeSignal shows a record only when a public source actually publishes one — '
                   f'nothing on this page is estimated or filled in. The county notices and '
                   f'meetings below are real and do apply to this area.</p>\n')

    stats = [(n, "Development records"),
             (county.get("meetings_upcoming") or len(county.get("meetings") or []),
              "Upcoming public meetings"),
             (county.get("gov_notices_total") or len(county.get("notices") or []),
              "County notices on file")]
    if fac:
        stats.append((fac, "Regulated facilities"))
    out.append('<ul class="stats">' + "".join(
        f"<li><b>{v}</b><span>{e(t)}</span></li>" for v, t in stats) + "</ul>\n")

    ref = fmt_date((z.get("refreshed_at") or "")[:10])
    if ref:
        out.append(f'<p class="muted">Records last checked {e(ref)}.</p>\n')

    if n:
        shown = z.get("projects") or []
        out.append("<h2>Development records</h2>\n")
        if len(shown) < n:
            out.append(f'<p class="muted">The {len(shown)} most recent of {n} records are '
                       f'listed here; the interactive map below shows all of them.</p>\n')
        out.append("".join(render_record(p) for p in shown))
        srcs = z.get("sources") or []
        if srcs:
            out.append(f'<p class="muted">Source registr{"y" if len(srcs) == 1 else "ies"}: '
                       + e(", ".join(srcs)) + ".</p>\n")

    # ── the existing interactive map, unmodified, lazily embedded ──────────────
    out.append("<h2>Interactive development map</h2>\n")
    out.append(f'<div id="map-embed" data-src="/homesignalmap.html?zip={e(zc)}" '
               f'data-title="Development map for {e(where)}">'
               f'<p class="ph"><a href="/homesignalmap.html?zip={e(zc)}">'
               f'Open the interactive development map for {e(where)} →</a></p></div>\n')

    if fac:
        out.append(f'<p class="muted">The map also plots {fac} EPA-registered facilit'
                   f'{"y" if fac == 1 else "ies"} near this ZIP code — a factual public-record '
                   f'count for environmental context, not development and not a verdict on any '
                   f'operator.</p>\n')

    # ── county civic block (clearly labelled as county-wide) ──────────────────
    meets = (county.get("meetings") or [])[:5]
    if meets:
        out.append(f"<h2>Upcoming public meetings in {e(county['name'])}</h2>\n")
        out.append(f'<p class="muted">County-wide — these bodies set planning and zoning '
                   f'decisions that cover {e(where)}.</p>\n<ul class="plain">')
        for m in meets:
            d = fmt_date(m.get("date"))
            bits = [x for x in [m.get("body"), d, m.get("location")] if x]
            out.append(f'<li><a href="{e(m["url"])}" rel="nofollow noopener" target="_blank">'
                       f'{e(m["title"])}</a>'
                       + (f'<br><span class="muted">{e(" · ".join(bits))}</span>' if bits else "")
                       + "</li>")
        out.append("</ul>\n")
        out.append(f'<p><a href="/{OUT_ROOT}/">All {e(county["name"])} meetings, notices and '
                   f'ZIP codes →</a></p>\n')

    # ── internal links: parent + nearest siblings ─────────────────────────────
    if neighbours:
        out.append(f"<h2>Nearby ZIP codes in {e(county['name'])}</h2>\n")
        out.append('<ul class="ziplinks">')
        for nb, dist in neighbours:
            nl = place_label(nb.get("name"), nb["zip"]) or f"ZIP {nb['zip']}"
            nn = int(nb.get("dev_projects") or 0)
            cnt = (f"{nn} development record{'' if nn == 1 else 's'}" if nn
                   else "No development records yet")
            out.append(f'<li><a href="/{OUT_ROOT}/{nb["zip"]}/">{e(nl)} {e(nb["zip"])}</a>'
                       f'<span class="c">{cnt} · {dist:.0f} mi</span></li>')
        out.append("</ul>\n")

    out.append(f'<div class="note"><strong>Why this page exists.</strong> HomeSignal collects '
               f'development filings, public hearings and government notices for {e(where)} from '
               f'first-party public sources and links every item back to its official record. '
               f'<a href="/community.html?zip={e(zc)}">See civic alerts and government notices '
               f'for {e(zc)} →</a></div>\n')

    out.append(footer([("Box Elder County", f"/{OUT_ROOT}/")], tail=MAP_LOADER))
    return "".join(out)


def render_hub(zips, county):
    ranked = sorted(zips, key=lambda z: (-int(z.get("dev_projects") or 0), z["zip"]))
    total = sum(int(z.get("dev_projects") or 0) for z in zips)
    n_idx = sum(1 for z in zips if index_decision(z)[0])
    canonical = HUB_URL
    title = f"Development Projects in {county['name']}, {county['state_name']} | HomeSignal"
    h1 = f"Development Projects in {county['name']}, {county['state_name']}"
    desc = (f"Track {total} development records across {len(zips)} ZIP codes in "
            f"{county['name']}, {county['state_name']} — plus county public meetings and "
            f"government notices, each linked to its official public record.")
    cr = [("HomeSignal", "/"), (f"{county['name']}, {county['state_name']}", None)]

    out = [head(title, desc, canonical, "index, follow", crumbs_jsonld(cr))]
    out.append(crumbs(cr))
    out.append(f"<h1>{e(h1)}</h1>\n")
    out.append(f'<p class="lede">HomeSignal tracks <strong>{total}</strong> development records '
               f'across the <strong>{len(zips)}</strong> ZIP codes of {e(county["name"])}, '
               f'{e(county["state_name"])}, alongside the county and city meetings and notices '
               f'that decide them. Every item links to the official public record.</p>\n')
    out.append('<ul class="stats">'
               f'<li><b>{total}</b><span>Development records</span></li>'
               f'<li><b>{len(zips)}</b><span>ZIP codes tracked</span></li>'
               f'<li><b>{county.get("meetings_upcoming") or len(county.get("meetings") or [])}</b>'
               f'<span>Upcoming public meetings</span></li>'
               f'<li><b>{county.get("gov_notices_total") or len(county.get("notices") or [])}</b>'
               f'<span>Government notices on file</span></li></ul>\n')

    out.append("<h2>ZIP codes in this county</h2>\n")
    out.append(f'<p class="muted">{n_idx} of {len(zips)} currently carry development records. '
               f'ZIP codes with none are still listed and still show county notices and '
               f'meetings — HomeSignal never invents activity to fill a page.</p>\n')
    out.append('<ul class="ziplinks">')
    for z in ranked:
        lbl = place_label(z.get("name"), z["zip"]) or f"ZIP {z['zip']}"
        nn = int(z.get("dev_projects") or 0)
        cnt = (f"{nn} development record{'' if nn == 1 else 's'}" if nn
               else "No development records yet")
        out.append(f'<li><a href="/{OUT_ROOT}/{z["zip"]}/">{e(lbl)} {e(z["zip"])}</a>'
                   f'<span class="c">{cnt}</span></li>')
    out.append("</ul>\n")

    meets = county.get("meetings") or []
    if meets:
        out.append(f"<h2>Upcoming public meetings</h2>\n<ul class=\"plain\">")
        for m in meets:
            d = fmt_date(m.get("date"))
            bits = [x for x in [m.get("body"), d, m.get("location")] if x]
            out.append(f'<li><a href="{e(m["url"])}" rel="nofollow noopener" target="_blank">'
                       f'{e(m["title"])}</a>'
                       + (f'<br><span class="muted">{e(" · ".join(bits))}</span>' if bits else "")
                       + "</li>")
        out.append("</ul>\n")

    notices = county.get("notices") or []
    if notices:
        out.append("<h2>Recent government notices</h2>\n<ul class=\"plain\">")
        for nt in notices:
            d = fmt_date(nt.get("date"))
            bits = [x for x in [nt.get("agency"), nt.get("category"), d] if x]
            out.append(f'<li><a href="{e(nt["url"])}" rel="nofollow noopener" target="_blank">'
                       f'{e(nt["title"])}</a>'
                       + (f'<br><span class="muted">{e(" · ".join(bits))}</span>' if bits else "")
                       + "</li>")
        out.append("</ul>\n")

    out.append(footer())
    return "".join(out)


# ── build ─────────────────────────────────────────────────────────────────────
def neighbours_for(z, zips):
    if z.get("lat") is None or z.get("lng") is None:
        return []
    out = []
    for o in zips:
        if o["zip"] == z["zip"] or o.get("lat") is None or o.get("lng") is None:
            continue
        out.append((o, haversine_mi(z["lat"], z["lng"], o["lat"], o["lng"])))
    out.sort(key=lambda t: (t[1], t[0]["zip"]))
    return out[:MAX_NEIGHBOURS]


def build(data):
    """Returns {relative_path: html}. Pure — no disk writes, so --check can diff it."""
    zips, county = data["zips"], data["county"]
    pages = {os.path.join(OUT_ROOT, "index.html"): render_hub(zips, county)}
    for z in zips:
        pages[os.path.join(OUT_ROOT, z["zip"], "index.html")] = render_zip_page(
            z, county, neighbours_for(z, zips))
    return pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-snapshot", default=None,
                    help="build from a committed JSON snapshot instead of live REST")
    ap.add_argument("--check", action="store_true",
                    help="compare against files on disk; exit 1 on any drift")
    a = ap.parse_args()

    if a.from_snapshot:
        data = json.load(open(a.from_snapshot, encoding="utf-8"))
        src = f"snapshot {a.from_snapshot}"
    else:
        data = fetch_live()
        src = "live PostgREST"

    if not data.get("zips"):
        print("ERROR: 0 ZIPs resolved — refusing to write (would blank the test set)")
        return 1
    missing = set(TEST_ZIPS) - {z["zip"] for z in data["zips"]}
    if missing:
        print(f"ERROR: missing ZIPs {sorted(missing)} — refusing to write a partial set")
        return 1

    pages = build(data)

    if a.check:
        drift = []
        for path, htm in sorted(pages.items()):
            if not os.path.exists(path):
                drift.append(f"MISSING {path}")
            elif open(path, encoding="utf-8").read() != htm:
                drift.append(f"DRIFT   {path}")
        for d in drift:
            print(d)
        print(f"checked {len(pages)} page(s) from {src}: "
              f"{'OK' if not drift else str(len(drift)) + ' problem(s)'}")
        return 1 if drift else 0

    for path, htm in sorted(pages.items()):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(htm)
    idx = [z["zip"] for z in data["zips"] if index_decision(z)[0]]
    print(f"wrote {len(pages)} page(s) from {src} into {OUT_ROOT}/")
    print(f"  index,follow : {len(idx)}  {' '.join(idx)}")
    print(f"  noindex      : {len(data['zips']) - len(idx)}  "
          + " ".join(z["zip"] for z in data["zips"] if not index_decision(z)[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
