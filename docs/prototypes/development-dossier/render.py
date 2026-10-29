#!/usr/bin/env python3
"""Development dossier PROTOTYPE renderer (not production, not deployed).

Renders one static HTML page per fixture in ./fixtures. Every fact and source link is written
into the HTML; JavaScript only runs the Follow demo and the copy-link button. The production
version would live in scripts/gen_zip_pages.py (render_development) and read the published
dossier snapshot instead of a fixture (docs/development-dossier-design-2026-10-29.md §6).

Rules this file keeps (and test_render checks):
  * no project name, key, ZIP or place appears in this file; all of it comes from fixtures;
  * Type and lifecycle come from lib/project-type.js via type.mjs, never decided here;
  * official records, reported items and JODY coverage are rendered in separate places.

Usage:
  python3 render.py            # writes out/<key>.html
  python3 render.py --check    # renders and checks the pages work with scripts removed
  python3 render.py --fragment # also writes artifact/ (page fragments for a private preview)
"""
import csv, html, json, math, os, re, subprocess, sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "fixtures")
OUT = os.path.join(HERE, "out")
ART = os.path.join(HERE, "artifact")
BASE = "https://jodytracks.com"
e = html.escape

GRADE = {"a": "Official record", "b": "Supported inference", "c": "Reported, not verified"}
DOC_STATE = {"read": "Read", "partly": "Partly read", "title": "Title read only", "listed": "Listed, not read"}


def d(s):
    if not s:
        return ""
    y, m, dd = map(int, s.split("-"))
    return date(y, m, dd).strftime("%b %-d, %Y")


def a(label, url, cls="", external=True):
    ext = ' target="_blank" rel="noopener"' if external else ""
    c = f' class="{cls}"' if cls else ""
    return f'<a{c} href="{e(url)}"{ext}>{e(label)}</a>'


def grade(g):
    return f'<span class="grade g-{e(g)}">{e(GRADE[g])}</span>'


def classify(row):
    r = subprocess.run(["node", os.path.join(HERE, "type.mjs"), json.dumps(row)],
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def load_parcels(name):
    rows = list(csv.DictReader(open(os.path.join(FIX, name))))
    return [r for r in rows if r["in_anchor"] == "yes"]


def fill(text, parcels):
    """Counts in fixture text are computed from the parcel file, never typed."""
    if not parcels:
        return text
    acres = sum(float(r["acres"]) for r in parcels)
    text = text.replace("{parcels}", str(len(parcels))).replace("{acres}", f"{round(acres, -2):,.0f}")
    text = text.replace("{adj}", str(sum(1 for r in parcels if r["zip_basis"] != "direct-geometry")))
    return re.sub(r"\{n:([^}]+)\}", lambda m: str(sum(1 for r in parcels if r["owner_of_record"] == m.group(1))), text)


# ---------- map ----------
def parcel_svg(parcels, points):
    lat0 = sum(float(r["centroid_lat"]) for r in parcels) / len(parcels)
    k = math.cos(math.radians(lat0))
    xs = [float(r["centroid_lng"]) * k for r in parcels]
    ys = [-float(r["centroid_lat"]) for r in parcels]
    mile = 1 / 69.0
    pad = 1.2 * mile
    minx, maxx, miny, maxy = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
    W = 640
    s = W / (maxx - minx)
    H = round((maxy - miny) * s)
    owners = sorted({r["owner_of_record"] for r in parcels})
    out = [f'<svg viewBox="0 0 {W} {H + 34}" role="img" aria-labelledby="mapcap" class="parcelmap">']
    for r in parcels:
        side = math.sqrt(float(r["acres"]) / 640.0) * mile * s
        cx = (float(r["centroid_lng"]) * k - minx) * s
        cy = (-float(r["centroid_lat"]) - miny) * s
        o = owners.index(r["owner_of_record"])
        dash = ' stroke-dasharray="3 2"' if r["zip_basis"] != "direct-geometry" else ""
        out.append(f'<rect x="{cx - side / 2:.1f}" y="{cy - side / 2:.1f}" width="{side:.1f}" height="{side:.1f}" '
                   f'class="own{o}"{dash}><title>{e(r["apn_serial"])} · {e(r["owner_of_record"])} · {e(r["acres"])} acres</title></rect>')
    for p in points:
        cx = (float(p["lng"]) * k - minx) * s
        cy = (-float(p["lat"]) - miny) * s
        out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="6" class="pod"><title>{e(p["label"])}</title></circle>')
    bar = mile * s
    out.append(f'<line x1="12" y1="{H + 20}" x2="{12 + bar:.1f}" y2="{H + 20}" class="scale"/>'
               f'<text x="12" y="{H + 14}" class="scalet">1 mile</text></svg>')
    legend = "".join(f'<li><span class="sw own{i}"></span>{e(o.title())}</li>' for i, o in enumerate(owners))
    legend += '<li><span class="sw dash"></span>ZIP assigned by nearest ZIP (see note)</li>' if any(
        r["zip_basis"] != "direct-geometry" for r in parcels) else ""
    legend += '<li><span class="sw podsw"></span>Water filing diversion point</li>' if points else ""
    return "".join(out), f'<ul class="legend">{legend}</ul>'


def map_section(m, parcels):
    if m["kind"] == "parcels":
        svg, legend = parcel_svg(parcels, m["points"])
        rows = "".join(
            f'<tr><td>{e(r["apn_serial"])}</td><td>{e(r["owner_of_record"].title())}</td>'
            f'<td class="num">{float(r["acres"]):,.0f}</td><td>{e(r["zip"])}</td>'
            f'<td>{"nearest ZIP" if r["zip_basis"] != "direct-geometry" else "inside ZIP"}</td>'
            f'<td>{a("County record", r["erecord_url"])}</td></tr>' for r in parcels)
        return (f'<figure class="mapfig">{svg}<figcaption id="mapcap">{e(fill(m["caption"], parcels))} '
                f'Each square is drawn at a parcel\'s centre, sized by its acreage. This is a schematic, not a survey.</figcaption></figure>'
                f'{legend}<p class="small">{e(fill(m.get("zip_note", ""), parcels))}</p>'
                f'<details class="roster"><summary>All {len(parcels)} parcels (county records)</summary>'
                f'<div class="tablewrap"><table><thead><tr><th>Parcel</th><th>Owner of record</th><th class="num">Acres</th>'
                f'<th>ZIP</th><th>ZIP basis</th><th>Source</th></tr></thead><tbody>{rows}</tbody></table></div></details>')
    p = m["points"][0]
    return (f'<div class="nofootprint"><p><strong>{e(p["label"])}</strong></p><p>{e(m["caption"])}</p>'
            f'<p class="small">Point: {p["lat"]:.5f}, {p["lng"]:.5f}</p></div>')


# ---------- sections ----------
def render(fx, mode):
    parcels = load_parcels(fx["map"]["csv"]) if fx["map"]["kind"] == "parcels" else []
    cls = classify(fx["defining_record"]["classifier_input"])
    t, lc = cls["type"]["label"], cls["lifecycle"]["label"]
    url = BASE + fx["path"]
    name = fx["display_name"]
    media = {m["id"]: m for m in [fx["coverage"]["main"]] if m}

    crumbs = " › ".join(a(c[0], c[1], external=False) if c[1] else e(c[0]) for c in fx["breadcrumb"])
    crumbs += f' › <span aria-current="page">{e(name)}</span>'
    map_links = " · ".join(a(f"View on map: {lbl}", u, external=False) for lbl, u in fx["map_links"])

    lt = fx["latest"]
    latest = (f'<article class="latest"><p class="eyebrow">Latest verified change</p>'
              f'<p class="when"><time datetime="{lt["date"]}">{d(lt["date"])}</time> · {e(lt["date_label"])} · {e(lt["agency"])}</p>'
              f'<h3>{e(lt["title"])}</h3><p>{e(lt["body"])}</p><p class="small">{e(lt["changes_status"])}</p>'
              f'<p>{a("Open " + lt["source"][0], lt["source"][1], "srclink")} · <a href="#timeline">See full timeline</a></p>'
              f'<p class="small muted">{e(lt["observed"])}</p></article>')

    nx = fx["next"]
    opp = ""
    if nx.get("opportunity"):
        o = nx["opportunity"]
        opp = (f'<p class="opp closed"><strong>{e(o["title"])}:</strong> closed {d(o["closed_on"])}. '
               f'{a("Read the decision it concerned", o["url"])}</p>')
    nxt = (f'<section id="next" aria-labelledby="h-next"><h2 id="h-next">What happens next</h2><p>{e(nx["text"])}</p>{opp}'
           f'<p class="small">{e(nx["scope"])} Last checked {d(nx["checked"])}.</p></section>')

    known = "".join(f'<li>{e(fill(k, parcels))} {a("Source", u, "srcmini")}</li>' for k, u in fx["known"])
    unknown = "".join(f'<li>{e(u)}</li>' for u in fx["unknown"])
    impacts = "".join(
        f'<li><p><strong>{e(i["aspect"])}.</strong> {e(i["text"])}</p><p class="small">{grade(i["grade"])} '
        f'{e(i["who"])} · {a("Source", i["url"])}</p></li>' for i in fx["impacts"])

    orgs = "".join(
        f'<tr><th scope="row">{e(o["name"])}</th><td>{e(fill(o["role"], parcels))}</td>'
        f'<td>{grade(o["grade"])}<br>{a(o["source"][0], o["source"][1], "small")}</td></tr>' for o in fx["organizations"])
    orgs += "".join(f'<tr class="unconf"><th scope="row">{e(n)}</th><td>Not confirmed in reviewed records</td><td>—</td></tr>'
                    for n in fx["not_confirmed"])

    docs = "".join(
        f'<li class="doc"><p class="doctitle">{a(x["title"], x["url"])}</p>'
        f'<p class="small">{e(x["agency"])} · {e(x["kind"])}' + (f' · {e(x["date_label"])} {d(x["date"])}' if x.get("date") else "") +
        f'</p><p class="small">{e(x["relation"])}</p><span class="docstate s-{e(x["state"])}">{e(DOC_STATE[x["state"]])}</span></li>'
        for x in fx["documents"])

    def tl_item(x):
        extra = ""
        if x.get("reported"):
            extra += f'<p class="small">{grade("c")} Outcome reported by {a(x["reported"][0], x["reported"][1])}</p>'
        if x.get("explained_by") and x["explained_by"] in media:
            m = media[x["explained_by"]]
            extra += f'<p class="jody small"><span class="jodytag">JODY explained this</span> {a(m["title"], m["url"])} (YouTube)</p>'
        if x.get("observed"):
            extra += f'<p class="small muted">{e(x["observed"])}</p>'
        return (f'<li><div class="tdate"><time datetime="{x["date"]}">{d(x["date"])}</time><span>{e(x["date_label"])}</span></div>'
                f'<div class="tbody"><p class="chips"><span class="chip">{e(x["aspect"])}</span>{grade(x["grade"])}</p>'
                f'<h3>{e(x["title"])}</h3><p class="small">{e(x["agency"])}</p><p>{e(x["body"])}</p>'
                f'<p>{a("Open the official record", x["url"], "srclink")}</p>{extra}</div></li>')
    items = [tl_item(x) for x in fx["timeline"]]
    tl = f'<ol class="timeline">{"".join(items[:5])}</ol>'
    if len(items) > 5:
        tl += f'<details><summary>Show earlier history ({len(items) - 5})</summary><ol class="timeline">{"".join(items[5:])}</ol></details>'

    cv = fx["coverage"]
    main = cv["main"]
    feat = (f'<a class="facade" href="{e(main["url"])}" target="_blank" rel="noopener" aria-label="Watch on YouTube: {e(main["title"])}">'
            f'<span class="play" aria-hidden="true"></span><span class="ftitle">{e(main["title"])}</span>'
            f'<span class="fmeta">JODY investigation · YouTube · opens youtube.com</span></a>'
            f'<p class="small">Explains: {e(main["explains"])}. Public on YouTube, checked {d(main["verified"])}.</p>') if main else \
        '<p>JODY has not published a video about this project.</p>'
    shorts = "" if cv["shorts"] else '<p class="empty">No Shorts published about this project yet.</p>'
    bsky = "" if cv["bluesky"] else '<p class="empty">No JODY Bluesky posts linked to this project yet.</p>'
    notes = "".join(f"<li>{e(n)}</li>" for n in cv["reviewer_notes"])
    checked = "".join(f"<li>{e(s)}: {d(c)}</li>" for s, c in fx["sources_checked"])
    zips = ", ".join(a(f"ZIP {z}", u, external=False) for z, u in fx["zip_pages"])

    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": c[0], **({"item": BASE + c[1]} if c[1] else {})}
            for i, c in enumerate(fx["breadcrumb"] + [[name, fx["path"]]])]},
        {"@type": "WebPage", "@id": url, "url": url, "name": name, "inLanguage": "en-US",
         "publisher": {"@type": "Organization", "name": "JODY Tracks"}}]}

    title = f'{name}, {fx["place"].split(", ", 1)[-1]}: timeline, records and map | JODY Tracks'
    desc = " ".join(fx["summary"])[:300]
    other = [f for f in sorted(os.listdir(FIX)) if f.endswith(".json") and f[:-5] != fx["project_key"]]
    switch = " · ".join(f'<a href="{e(f[:-5])}.html">{e(json.load(open(os.path.join(FIX, f)))["display_name"])}</a>' for f in other)

    head = (f'<title>{e(title if mode == "page" else "Dossier Prototype: " + name)}</title>'
            f'<meta name="claude:viewport-fit-sides" content="cover">'
            f'<meta name="description" content="{e(desc)}">'
            f'<link rel="canonical" href="{e(url)}">'
            f'<!-- prototype only: a built dossier is "index, follow" (founder index-all policy) -->'
            f'<meta name="robots" content="noindex">'
            f'<meta property="og:title" content="{e(name)}"><meta property="og:url" content="{e(url)}">'
            f'<script type="application/ld+json">{json.dumps(ld)}</script>'
            f'<style>{CSS}</style>')
    body = f'''
<div class="proto" role="note">Prototype, not a live page. Built from records reviewed Oct 29, 2026. Other example: {switch}</div>
<header class="site"><div class="wrap"><span class="brand">JODY <b>Tracks</b></span><nav aria-label="Primary"><a href="/">Explore</a><a href="/properties.html">My Places</a></nav></div></header>
<main id="main" class="wrap">
<nav class="crumbs" aria-label="Breadcrumb">{crumbs}</nav>
<section class="hero" aria-labelledby="h1">
  <h1 id="h1">{e(name)}</h1>
  <p class="where">{e(fx["place"])}</p>
  <p class="meta"><span class="pill type">{e(t)}</span><span class="pill life"><span class="k">Lifecycle</span> {e(lc)}</span>
  <span class="small">from the defining record: {a(fx["defining_record"]["label"], fx["defining_record"]["url"])}</span></p>
  <div class="actions">
    <div class="follow" id="follow">
      <button type="button" class="btn primary" id="followBtn" aria-describedby="followHelp">Follow Development</button>
      <p class="small" id="followHelp">Saves this project to Following in My Places. Email alerts are a separate choice and are not turned on.</p>
      <p class="status" id="followStatus" role="status" aria-live="polite"></p>
    </div>
    <p class="secondary"><button type="button" class="linkbtn" id="copyLink" data-url="{e(url)}">Copy link</button> · {map_links}</p>
  </div>
</section>
<nav class="toc" aria-label="On this page">
  <details class="jump"><summary>Jump to section</summary><TOC></details>
  <div class="tocbar"><TOC></div>
</nav>
<section id="overview" aria-labelledby="h-ov"><h2 id="h-ov">Overview</h2>
  <div class="answer">{"".join(f"<p>{e(fill(s, parcels))}</p>" for s in fx["summary"])}
  <p class="small">{a(fx["summary_sources"][0][0], fx["summary_sources"][0][1], "srclink")}</p></div>
  <div id="changed">{latest}</div>
  <div class="pair"><div><h3>What we know</h3><ul class="known">{known}</ul></div>
  <div><h3>Not verified yet</h3><ul class="unknown">{unknown}</ul></div></div>
  <h3>Why this matters</h3><ul class="impacts">{impacts}</ul>
</section>
{nxt}
<section id="map-land" aria-labelledby="h-map"><h2 id="h-map">Map &amp; land</h2>{map_section(fx["map"], parcels)}
  <p>{map_links} · ZIP pages: {zips}</p></section>
<section id="organizations" aria-labelledby="h-org"><h2 id="h-org">Organizations and their roles</h2>
  <div class="tablewrap"><table class="orgs"><thead><tr><th>Organization</th><th>Role, as the record states it</th><th>Evidence</th></tr></thead><tbody>{orgs}</tbody></table></div>
  <p class="small">A role is listed only when a record states it. Similar names, nearby land or news reports alone never create a role.</p></section>
<section id="documents" aria-labelledby="h-doc"><h2 id="h-doc">Official documents</h2><ul class="docs">{docs}</ul>
  <p class="small">Links open the agency's own copy. JODY does not host these documents.</p></section>
<section id="timeline" aria-labelledby="h-tl"><h2 id="h-tl">Timeline</h2>
  <p class="small">Official actions only, newest first, dated by the agency's own date. JODY's videos and posts are listed under JODY coverage.</p>{tl}</section>
<section id="coverage" aria-labelledby="h-cov"><h2 id="h-cov">JODY coverage</h2>
  <p class="small">JODY's own reporting. It explains the records above; it is not an agency finding.</p>
  <h3>Investigation</h3>{feat}
  <h3>Shorts</h3>{shorts}
  <h3>Bluesky</h3>{bsky}
  <aside class="reviewer"><p class="eyebrow">Prototype · reviewer view, never shown publicly</p><ul>{notes}</ul></aside>
  <aside class="example"><p class="eyebrow">Prototype · layout example, not real videos</p>
    <div class="shorts" role="list"><div class="short" role="listitem">Example Short</div><div class="short" role="listitem">Example Short</div><div class="short" role="listitem">Example Short</div></div>
    <p class="small">Published Shorts appear here as a row you can scroll or step through, with each title and date as text.</p></aside>
</section>
<section id="follow-dev" aria-labelledby="h-fol"><h2 id="h-fol">Follow this development</h2>
  <p>Following saves this project to Following in My Places, on any device you sign in on. It does not sign you up for email. Email alerts are a separate choice on the Alerts page.</p>
  <fieldset class="sim"><legend>Prototype: try the states</legend>
    <label><input type="radio" name="sim" value="out" id="sim-out" checked> Signed out</label>
    <label><input type="radio" name="sim" value="in" id="sim-in"> Signed in</label>
    <label><input type="radio" name="sim" value="fail" id="sim-fail"> Signed in, save fails</label></fieldset></section>
<footer class="method"><h2>Sources and corrections</h2>
  <p>Every fact on this page links to its source. Grades: <b>Official record</b> means an agency's own record states it; <b>Reported, not verified</b> means news reporting JODY has not confirmed in a record.</p>
  <ul>{checked}</ul><p class="small">Page address: {e(url)}. See something wrong? <a href="/contact.html">Report a correction</a>.</p></footer>
</main>
<script>{JS}</script>'''
    toc = '<ul>' + ''.join(f'<li><a href="#{i}">{e(l)}</a></li>' for i, l in [
        ("overview", "Overview"), ("changed", "What changed"), ("next", "What's next"), ("map-land", "Map & land"),
        ("organizations", "Organizations"), ("documents", "Documents"), ("timeline", "Timeline"),
        ("coverage", "JODY coverage"), ("follow-dev", "Follow")]) + '</ul>'
    body = body.replace("<TOC>", toc)
    if mode == "fragment":
        return head + body
    return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">{head}</head><body>{body}</body></html>'


CSS = r"""
/* Layout: one reading column (max 46rem) under a shared header; sticky section bar on wide screens,
   a "Jump to section" disclosure on narrow ones. Tokens are JODY's own (app.css), plus dark values. */
:root{--bg:#f4f6f4;--panel:#fff;--ink:#16211c;--ink2:#4a5a52;--ink3:#6b7a72;--line:#e4e8e4;
 --green:#157a49;--green2:#1f9d5c;--tint:#e9f5ee;--amber:#8a5410;--amber-t:#fbf1e2;--blue:#2f6a96;--blue-t:#eaf2f8;
 --violet:#5a4aa5;--violet-t:#efecfa;--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
 --on-green:#fff;--o0:#1f9d5c;--o1:#3f7fb0;--o2:#c47a1a;--o3:#6b5bb5}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1512;--panel:#17201b;--ink:#e6efe9;--ink2:#b3c2b9;--ink3:#8fa097;--line:#2a3630;
 --green:#5cc98d;--green2:#5cc98d;--tint:#173326;--amber:#e5b268;--amber-t:#33280f;--blue:#8cbbe0;--blue-t:#15283a;--violet:#b4a8ec;--violet-t:#26213f;--on-green:#0f1512;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f1512;--panel:#17201b;--ink:#e6efe9;--ink2:#b3c2b9;--ink3:#8fa097;--line:#2a3630;
 --green:#5cc98d;--green2:#5cc98d;--tint:#173326;--amber:#e5b268;--amber-t:#33280f;--blue:#8cbbe0;--blue-t:#15283a;--violet:#b4a8ec;--violet-t:#26213f;--on-green:#0f1512;color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:16px/1.55 var(--font);margin:0}
.wrap{max-width:46rem;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
a{color:var(--green)}a:focus-visible,button:focus-visible,summary:focus-visible,input:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
h1{font-size:clamp(1.7rem,4.5vw,2.4rem);line-height:1.15;margin:.2rem 0;text-wrap:balance}
h2{font-size:1.35rem;margin:2.4rem 0 .6rem;text-wrap:balance;scroll-margin-top:4rem}
h3{font-size:1.05rem;margin:1.2rem 0 .4rem}section{scroll-margin-top:4rem}
.small{font-size:.875rem;color:var(--ink2)}.muted{color:var(--ink3)}
.proto{background:var(--amber-t);color:var(--amber);font-size:.85rem;padding-block:.45rem;text-align:center;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.site{background:var(--panel);border-bottom:1px solid var(--line)}.site .wrap{display:flex;justify-content:space-between;align-items:center;padding-block:.7rem}
.brand{font-weight:700}.brand b{color:var(--green2)}.site nav{display:flex;gap:1rem;font-size:.9rem}.site nav a{color:var(--ink2);text-decoration:none}
.crumbs{font-size:.85rem;color:var(--ink2);margin:1rem 0 .4rem}.crumbs a{color:var(--ink2)}
.where{color:var(--ink2);margin:.2rem 0 .6rem}
.meta{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.4rem 0}
.pill{border-radius:999px;padding:.15rem .7rem;font-size:.85rem;font-weight:600;border:1px solid var(--line);background:var(--panel)}
.pill.type{background:var(--tint);color:var(--green);border-color:transparent}.pill .k{font-weight:400;color:var(--ink2);margin-right:.25rem}
.actions{margin:1rem 0 0}.btn{font:inherit;border-radius:10px;padding:.7rem 1.2rem;min-height:44px;border:1px solid var(--green)}
.btn.primary{background:var(--green);color:var(--on-green);font-weight:600}.btn.primary[aria-pressed="true"]{background:var(--tint);color:var(--green)}
.btn:disabled{opacity:.7;cursor:progress}.follow p{margin:.4rem 0}.status{font-weight:600;min-height:1.4em}.status.err{color:#c23b34}
.secondary{font-size:.9rem;margin:.6rem 0}.linkbtn{font:inherit;background:none;border:0;color:var(--green);text-decoration:underline;padding:0;cursor:pointer}
.toc{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--bg);border-bottom:1px solid var(--line);margin-top:1.4rem;padding-block:.4rem}
.toc ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.2rem 1rem;font-size:.88rem}.toc a{text-decoration:none}
.jump{display:none}.jump summary{cursor:pointer;font-weight:600;padding:.3rem 0}.jump ul{flex-direction:column;padding:.4rem 0}
@media (max-width:640px){.tocbar{display:none}.jump{display:block}}
.answer{font-size:1.06rem}.latest{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--green);border-radius:12px;padding:1rem 1.1rem;margin:1rem 0}
.latest h3{margin:.2rem 0 .4rem}.eyebrow{text-transform:uppercase;letter-spacing:.06em;font-size:.72rem;font-weight:700;color:var(--ink2);margin:0}
.when{font-size:.88rem;color:var(--ink2);margin:.2rem 0}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.pair>div{min-width:0}@media (max-width:640px){.pair{grid-template-columns:1fr}}
.known li::marker{content:"✓  ";color:var(--green)}.unknown li::marker{content:"?  ";color:var(--amber)}
.known,.unknown,.impacts,.docs,.timeline{padding-left:1.2rem}.impacts{list-style:none;padding:0}.impacts li{border-top:1px solid var(--line);padding:.4rem 0}
.impacts p{margin:.2rem 0}
.grade{display:inline-block;font-size:.72rem;font-weight:700;border-radius:4px;padding:.05rem .4rem;margin-right:.35rem;vertical-align:1px}
.g-a{background:var(--tint);color:var(--green)}.g-b{background:var(--blue-t);color:var(--blue)}.g-c{background:var(--amber-t);color:var(--amber)}
.opp.closed{background:var(--panel);border:1px dashed var(--line);border-radius:10px;padding:.6rem .8rem}
.mapfig{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:.6rem}
.parcelmap{width:100%;height:auto;display:block}.parcelmap rect{fill-opacity:.55;stroke-width:1}
.own0{fill:var(--o0);stroke:var(--o0)}.own1{fill:var(--o1);stroke:var(--o1)}.own2{fill:var(--o2);stroke:var(--o2)}.own3{fill:var(--o3);stroke:var(--o3)}
.pod{fill:var(--panel);stroke:var(--ink);stroke-width:3}.scale{stroke:var(--ink);stroke-width:2}.scalet{fill:var(--ink2);font-size:12px}
figcaption{font-size:.85rem;color:var(--ink2);margin-top:.4rem}
.legend{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.3rem 1rem;font-size:.85rem}
.sw{display:inline-block;width:12px;height:12px;margin-right:.35rem;vertical-align:-1px;border-radius:2px;opacity:.75}
.sw.own0{background:var(--o0)}.sw.own1{background:var(--o1)}.sw.own2{background:var(--o2)}.sw.own3{background:var(--o3)}
.sw.dash{border:2px dashed var(--ink2);opacity:1}.sw.podsw{border:3px solid var(--ink);border-radius:50%;opacity:1}
.tablewrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;vertical-align:top;padding:.45rem .5rem;border-bottom:1px solid var(--line)}
.num{text-align:right;font-variant-numeric:tabular-nums}.orgs th[scope=row]{font-weight:600}.unconf th,.unconf td{color:var(--ink3);font-style:italic}
.roster summary{cursor:pointer;margin:.6rem 0;font-weight:600}
.nofootprint{background:var(--panel);border:1px dashed var(--line);border-radius:12px;padding:.8rem 1rem}
.docs{list-style:none;padding:0;display:grid;gap:.6rem}.doc{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem;position:relative}
.doc p{margin:.15rem 0}.doctitle{font-weight:600;padding-right:7.5rem}
.docstate{position:absolute;top:.6rem;right:.7rem;font-size:.72rem;font-weight:700;padding:.05rem .45rem;border-radius:4px;background:var(--bg);color:var(--ink2)}
.s-read{background:var(--tint);color:var(--green)}.s-listed,.s-title{background:var(--amber-t);color:var(--amber)}
@media (max-width:480px){.doctitle{padding-right:0}.docstate{position:static;display:inline-block;margin-top:.3rem}}
.timeline{list-style:none;padding:0;margin:0;border-left:2px solid var(--line)}
.timeline>li{display:grid;grid-template-columns:7.5rem 1fr;gap:.8rem;padding:.8rem 0 .8rem .9rem;position:relative}
.timeline>li::before{content:"";position:absolute;left:-6px;top:1.15rem;width:10px;height:10px;border-radius:50%;background:var(--green)}
.tdate{font-size:.85rem;font-variant-numeric:tabular-nums}.tdate time{display:block;font-weight:700}.tdate span{color:var(--ink2)}
.tbody{min-width:0}.tbody h3{margin:.2rem 0}.tbody p{margin:.2rem 0}
@media (max-width:520px){.timeline>li{grid-template-columns:1fr;gap:.2rem}}
.chips{display:flex;flex-wrap:wrap;gap:.3rem}.chip{font-size:.72rem;border:1px solid var(--line);border-radius:999px;padding:0 .5rem;color:var(--ink2)}
.jody{background:var(--violet-t);border-radius:8px;padding:.35rem .5rem}.jodytag{font-weight:700;color:var(--violet);margin-right:.3rem}
.facade{display:grid;grid-template-columns:auto 1fr;gap:.2rem .9rem;align-items:center;background:#111a15;color:#fff;border-radius:12px;padding:1rem;text-decoration:none;aspect-ratio:auto}
.play{grid-row:span 2;width:56px;height:56px;border-radius:50%;background:#c4302b;position:relative}
.play::after{content:"";position:absolute;left:22px;top:17px;border-left:16px solid #fff;border-top:11px solid transparent;border-bottom:11px solid transparent}
.ftitle{font-weight:700}.fmeta{font-size:.82rem;color:#c9d4ce}
.empty{color:var(--ink2);font-style:italic}
.reviewer,.example{border:1px dashed var(--amber);background:var(--amber-t);border-radius:10px;padding:.6rem .8rem;margin-top:1rem;color:var(--ink)}
.reviewer .eyebrow,.example .eyebrow{color:var(--amber)}
.shorts{display:flex;gap:.6rem;overflow-x:auto;padding:.4rem 0}.short{flex:0 0 7rem;aspect-ratio:9/16;border:2px dashed var(--amber);border-radius:10px;display:grid;place-items:center;font-size:.75rem;color:var(--amber);text-align:center}
.sim{border:1px dashed var(--line);border-radius:10px;font-size:.9rem;display:flex;flex-wrap:wrap;gap:.4rem 1rem}
.method{border-top:1px solid var(--line);margin-top:2.5rem;padding-block:1rem 3rem}.method h2{font-size:1.05rem}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
"""

JS = r"""
(function(){
  var btn=document.getElementById('followBtn'),st=document.getElementById('followStatus'),saved=false;
  function mode(){var r=document.querySelector('input[name=sim]:checked');return r?r.value:'out';}
  function say(t,err){st.textContent=t;st.className='status'+(err?' err':'');}
  btn.addEventListener('click',function(){
    if(mode()==='out'){say('Sign in to save this project. You will come back to this page after signing in. (Prototype: no account is used.)');return;}
    btn.disabled=true;btn.textContent='Saving…';say('');
    setTimeout(function(){
      btn.disabled=false;
      if(mode()==='fail'){btn.textContent=saved?'✓ Following in My Places':'Follow Development';
        say("Couldn't save to My Places. Check your connection and try again.",true);return;}
      saved=!saved;btn.setAttribute('aria-pressed',String(saved));
      btn.textContent=saved?'✓ Following in My Places':'Follow Development';
      say(saved?'Saved to Following in My Places. Email alerts are still off.':'Removed from Following.');
    },900);
  });
  var c=document.getElementById('copyLink');
  c.addEventListener('click',function(){var u=c.getAttribute('data-url');
    try{navigator.clipboard.writeText(u).then(function(){c.textContent='Link copied';},function(){c.textContent=u;});}catch(e){c.textContent=u;}});
})();
"""


def check(htmls):
    """Facts must be present with every <script> removed: what a crawler gets first."""
    problems = []
    for key, (fx, page) in htmls.items():
        raw = re.sub(r"<script(?![^>]*ld\+json)[^>]*>.*?</script>", "", page, flags=re.S)
        need = [fx["display_name"], fx["latest"]["title"], fx["latest"]["source"][1].replace("&", "&amp;")]
        need += [x["url"].replace("&", "&amp;") for x in fx["timeline"]] + [x["url"].replace("&", "&amp;") for x in fx["documents"]]
        need += [o["name"] for o in fx["organizations"]]
        for n in need:
            if e(n) not in raw and e(n, quote=False) not in raw and n not in raw:
                problems.append(f"{key}: missing without scripts: {n[:70]}")
        if raw.count("<h1") != 1:
            problems.append(f"{key}: expected one h1")
        if raw.count('rel="canonical"') != 1:
            problems.append(f"{key}: expected one canonical")
        for sid in ("overview", "changed", "next", "map-land", "organizations", "documents", "timeline", "coverage", "follow-dev"):
            if f'id="{sid}"' not in raw:
                problems.append(f"{key}: missing section #{sid}")
    src = open(__file__).read()
    for f in os.listdir(FIX):
        if f.endswith(".json"):
            fx = json.load(open(os.path.join(FIX, f)))
            for lit in (fx["project_key"], fx["display_name"]):
                if lit in src:
                    problems.append(f"renderer names a project: {lit}")
    return problems


def main():
    os.makedirs(OUT, exist_ok=True)
    htmls = {}
    for f in sorted(os.listdir(FIX)):
        if not f.endswith(".json"):
            continue
        fx = json.load(open(os.path.join(FIX, f)))
        page = render(fx, "page")
        open(os.path.join(OUT, fx["project_key"] + ".html"), "w").write(page)
        htmls[fx["project_key"]] = (fx, page)
        if "--fragment" in sys.argv:
            os.makedirs(ART, exist_ok=True)
            open(os.path.join(ART, fx["project_key"] + ".html"), "w").write(render(fx, "fragment"))
    if "--check" in sys.argv:
        p = check(htmls)
        print("\n".join(p) if p else f"OK: {len(htmls)} pages; facts, links, one h1, one canonical, all sections present without scripts; no project literal in the renderer")
        sys.exit(1 if p else 0)
    print("wrote", ", ".join(k + ".html" for k in htmls))


if __name__ == "__main__":
    main()
