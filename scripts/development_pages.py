"""Development dossier pages: /development/<state>/<project_key>/ (2026-10-29).

One page per reviewed development, built from the published snapshot
(email-assets/seo/development-dossiers.json, written by homesignal-ingest from
public.development_dossier_snapshot(); SQL of record docs/development-dossier.sql).

Every fact on the page is in the HTML the server sends, beside the source it comes from. The page
ships no script (CSP script-src 'none'), like the project and city pages. Nothing here decides
anything the database already decided:
  * which links exist, their grade, and whether a video or post is public: the snapshot;
  * Type and lifecycle: lib/project-type.js on the ONE defining record (annotate());
  * the project's name: the snapshot's one name (resolved_projects.display_name when linked).
Pure functions: gen_zip_pages.py passes in its own head/escape helpers and writes the files.
"""
import html, json, os, re, subprocess, sys

SCHEMA = "development-dossiers/1"
PATH_RE = re.compile(r"^/development/[a-z]{2}/[a-z0-9]+(?:-[a-z0-9]+)*/$")
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
ROLE_LABEL = {
    "landowner_of_record": "Landowner of record", "applicant": "Applicant",
    "buyer_under_contract": "Under contract to buy", "master_developer": "Master developer",
    "designer": "Designer", "consultant": "Consultant", "governing_body": "Governing body",
    "filing_receiver": "Receives the filing",
    "agenda_item": "On an agenda", "adopted_action": "Adopted action", "legal_decision": "Legal decision",
    "hearing": "Hearing", "filing": "Filing",
    "water_change_application": "Water-rights change application",
    "water_appropriation_application": "Water-rights application",
    "permit_for": "Permit", "environmental_review_for": "Environmental review",
    "land_use_case_for": "Land-use case", "defining_record": "Defining record",
    "facility_of": "Data-center listing", "primary_document": "Document",
}
ENTITY_ORDER = {r: i for i, r in enumerate((
    "governing_body", "filing_receiver", "applicant", "master_developer", "buyer_under_contract",
    "landowner_of_record", "designer", "consultant"))}
DOC_KINDS = ("source_record", "water_filing", "government_record", "document", "dc_entity")


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def _one(rx, text, what):
    m = re.findall(rx, text, re.S)
    if len(m) != 1:
        sys.exit(f"ERROR: expected exactly one {what}, found {len(m)}")
    return m[0]


def site_chrome():
    """The site's own header and footer, taken from partials/shell.html, and their rules from
    app.css and layout.css, so a dossier page shows the same links as every other page. Nothing
    is copied by hand. The header's Share / Sign in / account buttons need shell.js, which this
    page does not load, so they are left out; the Menu button opens the nav without a script."""
    shell = _read("partials/shell.html")
    header = _one(r'<header class="hs-header" id="hs-top">.*?</header>', shell, "site header")
    footer = _one(r'<footer class="hs-footer" id="hs-footer">.*?</footer>', shell, "site footer")
    actions = _one(r'\n[ \t]*<div class="hs-header__actions">.*?\n[ \t]*</div>(?=\n[ \t]*</div>\n</header>)',
                   header, "header actions block")
    menu = ('\n    <div class="hs-header__actions"><label class="hs-header__menu" for="hs-menutoggle" '
            'aria-label="Menu">☰</label></div>')
    header = header.replace(actions, menu, 1)
    header = header.replace('<nav class="hs-nav"', '<input type="checkbox" id="hs-menutoggle" class="hs-menutoggle" '
                            'aria-label="Show the menu">\n    <nav class="hs-nav"', 1)
    chrome = re.sub(r'href="(?!https?:|/|#)([^"]+)"', r'href="/\1"', header), \
        re.sub(r'href="(?!https?:|/|#)([^"]+)"', r'href="/\1"', footer)
    app = _read("app.css")
    rules = _one(r'(\.hs-header\{position:sticky.*?\.hs-footer__links a:hover\{[^}]*\})', app, "header/footer rules")
    root = _one(r':root\s*\{(.*?)\}', app, "app.css :root")
    layout = _read("layout.css")
    lroot = _one(r':root\s*\{(.*?)\}', layout, "layout.css :root")
    cont = _one(r'(\.hs-container\s*\{[^}]*\})', layout, "layout.css .hs-container")
    css = ('.hs-header,.hs-footer{' + root + lroot + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",'
           'Roboto,Helvetica,Arial,sans-serif;line-height:1.4}\n' + cont + '\n' + rules + '\n'
           '.hs-menutoggle{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}\n'
           '.hs-header__menu{cursor:pointer}\n'
           '.hs-menutoggle:focus-visible~.hs-header__actions .hs-header__menu{outline:2px solid var(--green);outline-offset:2px}\n'
           '@media (max-width:1023px){.hs-menutoggle:checked~.hs-nav{display:flex}}\n')
    return chrome[0], chrome[1], css


SITE_HEADER, SITE_FOOTER, CHROME_CSS = site_chrome()


def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def day(s):
    s = str(s or "")[:10]
    if not DAY_RE.match(s):
        return ""
    y, m, d = s.split("-")
    return f"{MONTHS[int(m) - 1]} {int(d)}, {y}"


ISO_DAY_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
HASHTAG_RE = re.compile(r"(?:^|\s)#[A-Za-z][\w]*")


def prose(s):
    """Text a reader sees: a source's ISO date written as a date ("2026-10-15" -> "Oct 15, 2026")
    and hashtags removed. Wording is otherwise the source's own; nothing is reworded."""
    s = ISO_DAY_RE.sub(lambda m: day(m.group(1)) or m.group(1), str(s or ""))
    return re.sub(r"\s{2,}", " ", HASHTAG_RE.sub("", s)).strip()


YT_ID_RE = re.compile(r"^https://(?:www\.)?(?:youtube\.com/(?:watch\?v=|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})(?:[?&#].*)?$")
# YouTube's own thumbnail host; the page's CSP allows images from it and nothing else new.
CSP_FROM = "img-src 'self' data:; font-src 'self';"
CSP_TO = "img-src 'self' data: https://i.ytimg.com; font-src 'self';"


def yt_id(url):
    m = YT_ID_RE.match(str(url or ""))
    return m.group(1) if m else ""


def safe_url(u):
    u = str(u or "")
    return u if re.match(r"^https://[^\s\"<>]+$", u) else ""


def load(path, required):
    """The published snapshot. A missing file is 'no dossiers' only where the caller allows it
    (the build treats an absent object, HTTP 404, as none yet); a file that is present but
    malformed always stops the build: an unreadable dossier list is not an empty one."""
    if not path or not os.path.isfile(path):
        if required:
            sys.exit(f"ERROR: development dossiers file missing: {path}")
        return {}
    try:
        doc = json.load(open(path, encoding="utf-8"))
    except ValueError as e:
        sys.exit(f"ERROR: development dossiers file is not JSON: {e}")
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA or not isinstance(doc.get("dossiers"), dict):
        sys.exit("ERROR: development dossiers file has the wrong shape (schema development-dossiers/1)")
    out = {}
    for key, d in doc["dossiers"].items():
        if not isinstance(d, dict) or d.get("project_key") != key or not PATH_RE.match(str(d.get("path") or "")):
            sys.exit(f"ERROR: development dossier {key!r} has no valid path")
        if d["path"] != f'/development/{str(d.get("state") or "").lower()}/{key}/':
            sys.exit(f"ERROR: development dossier {key!r}: path {d['path']!r} is not its state and key")
        if not str(d.get("display_name") or "").strip():
            sys.exit(f"ERROR: development dossier {key!r} has no name")
        for l in d.get("links") or []:
            if not safe_url(l.get("evidence_url")):
                sys.exit(f"ERROR: development dossier {key!r}: a link has no https source")
        out[key] = d
    return out


def classifier_input(d):
    """What the ONE Type/lifecycle authority is asked about: the defining record as the owning
    table states it. No defining record means no Type is claimed."""
    df = d.get("defining") or {}
    f = df.get("facts") or {}
    if df.get("kind") == "source_record":
        return {"name": f.get("name"), "type": f.get("type"), "status": f.get("status")}
    if df.get("kind") == "dc_entity" and f.get("classification") == "CONFIRMED_DC":
        # Lifecycle: the snapshot's facts.lifecycle, Map 1's own decision for this record
        # (public.dc_entity_map_status); absent means none was stated, and the page says unknown.
        return {"name": d.get("display_name"), "type": "Data center", "status": f.get("lifecycle")}
    return None


def annotate(dossiers, root):
    """Type and lifecycle for each dossier from lib/project-type.js (scripts/dossier-type.mjs),
    one node call for the whole set."""
    asks = {k: classifier_input(d) for k, d in dossiers.items()}
    asks = {k: v for k, v in asks.items() if v}
    if not asks:
        return
    r = subprocess.run(["node", os.path.join(root, "scripts", "dossier-type.mjs")],
                       input=json.dumps(asks), capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"ERROR: dossier Type/lifecycle annotation failed: {r.stderr.strip()[:400]}")
    got = json.loads(r.stdout)
    for k in asks:
        t = got.get(k) or {}
        dossiers[k]["_type"] = (t.get("type") or {}).get("label") or ""
        dossiers[k]["_lifecycle"] = (t.get("lifecycle") or {}).get("label") or ""


def zips_of(d):
    """ZIP pages a dossier touches: the land assembly's ZIPs and every linked source record's."""
    z = []
    for l in d.get("links") or []:
        f = l.get("facts") or {}
        if l.get("kind") == "land_assembly":
            z += [x.get("zip") for x in (f.get("zips") or []) if isinstance(x, dict)]
        elif l.get("kind") == "source_record":
            z += list(f.get("zips") or [])
    seen, out = set(), []
    for x in z:
        if isinstance(x, str) and re.fullmatch(r"\d{5}", x) and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _src(url, label):
    u = safe_url(url)
    if not u:
        return ""
    return f' <a href="{esc(u)}" rel="nofollow noopener">{esc(prose(label) or "Source")}</a>'


def _links(d, *kinds):
    return [l for l in (d.get("links") or []) if l.get("kind") in kinds]


def _stmts(d, kind):
    return [s for s in (d.get("statements") or []) if s.get("kind") == kind]


def _stmt_list(items, cls):
    if not items:
        return ""
    lis = []
    for s in items:
        when = f'<span class="small">{esc(s.get("date_label") or "")} {esc(day(s.get("date")))}</span> ' \
            if s.get("date") else ""
        title = f'<strong>{esc(prose(s["title"]))}</strong>. ' if s.get("title") else ""
        lis.append(f'<li>{when}{title}{esc(prose(s["body"]))}{_src(s.get("evidence_url"), s.get("evidence_label"))}'
                   + (f' <span class="small">Checked {esc(day(s.get("checked_on")))}.</span>' if s.get("checked_on") else "")
                   + "</li>")
    return f'<ul class="{cls}">{"".join(lis)}</ul>'


def _section(h_id, title, inner):
    """A section with something in it. An empty one is not drawn; what is missing is said once,
    at the end of the page (see render)."""
    if not inner:
        return ""
    return f'<section id="{h_id}" aria-labelledby="h-{h_id}"><h2 id="h-{h_id}">{esc(title)}</h2>{inner}</section>'


def _doc_title(l):
    """What a linked document is called on the page. The defining record is named by the source
    its link opens (its evidence label), so the card says what the reader will see."""
    f = l.get("facts") or {}
    if l.get("role") == "defining_record" and l.get("evidence_label"):
        return l["evidence_label"]
    if l.get("text"):
        return l["text"]
    if l["kind"] == "water_filing":
        return f'{f.get("filing_type") or "Water-rights filing"} {f.get("filing_no") or ""}'.strip()
    if l["kind"] == "source_record":
        return f.get("name") or l.get("ref")
    return l.get("evidence_label") or l.get("ref")


def _timeline(d):
    rows = []
    for l in d.get("links") or []:
        f = l.get("facts") or {}
        date, label = l.get("date"), l.get("date_label")
        if not date and l["kind"] == "water_filing" and f.get("filed_on"):
            date, label = f["filed_on"], f.get("date_label") or "Filed"
        if not date or l["kind"] in ("youtube_video", "bluesky_post", "organization"):
            continue
        rows.append((str(date), label, l.get("aspect"), _doc_title(l), l.get("evidence_url"),
                     l.get("evidence_label"), l.get("role")))
    for s in d.get("statements") or []:
        if s.get("date") and s.get("kind") in ("latest", "known"):
            rows.append((str(s["date"]), s.get("date_label"), s.get("aspect"), s.get("title") or s["body"],
                         s.get("evidence_url"), s.get("evidence_label"), None))
    rows.sort(key=lambda r: r[0], reverse=True)
    if not rows:
        return ""
    lis = "".join(
        f'<li><div class="tdate"><time datetime="{esc(r[0])}">{esc(day(r[0]))}</time>'
        f'<span>{esc(r[1] or "")}</span></div><div class="tbody">'
        + (f'<p class="chips"><span class="chip">{esc(r[2])}</span></p>' if r[2] else "")
        + f'<p>{esc(prose(r[3]))}</p>' + (f'<p>{_src(r[4], r[5]).strip()}</p>' if _src(r[4], r[5]) else "")
        + '</div></li>' for r in rows)
    return (f'<p class="small">Dates are each source\'s own, newest first. HomeSignal videos and posts are '
            f'listed separately below; they are not government events.</p><ol class="timeline">{lis}</ol>')


# The footer's date as words. Rendered as a token beside the build-day token and replaced in
# build(), so the page fingerprint still never moves on the date alone.
BUILT_HUMAN = "@@HS-BUILD-DAY-HUMAN@@"

# The page's own stylesheet. Dossier pages ship no script and do not use the app shell, so they
# carry their layout inline (the CSP allows inline styles) instead of app.css, whose classes are
# written for the shell. The look follows the reviewed prototype
# (docs/prototypes/development-dossier/render.py): one reading column under a header bar.
CSS = r"""
:root{--bg:#f4f6f4;--panel:#fff;--ink:#16211c;--ink2:#4a5a52;--ink3:#6b7a72;--line:#e4e8e4;
 --green:#157a49;--green2:#1f9d5c;--tint:#e9f5ee;--blue:#2f6a96;--violet:#5a4aa5;--violet-t:#efecfa;--on-green:#fff;
 --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1512;--panel:#17201b;--ink:#e6efe9;--ink2:#b3c2b9;
 --ink3:#8fa097;--line:#2a3630;--green:#5cc98d;--green2:#5cc98d;--tint:#173326;--blue:#8cbbe0;--violet:#b4a8ec;--violet-t:#26213f;
 --on-green:#0f1512;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f1512;--panel:#17201b;--ink:#e6efe9;--ink2:#b3c2b9;--ink3:#8fa097;--line:#2a3630;
 --green:#5cc98d;--green2:#5cc98d;--tint:#173326;--blue:#8cbbe0;--violet:#b4a8ec;--violet-t:#26213f;--on-green:#0f1512;color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:16px/1.55 var(--font);margin:0;-webkit-font-smoothing:antialiased}
.wrap{max-width:46rem;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
a{color:var(--green);overflow-wrap:anywhere}a:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:8px;background:var(--panel);padding:.4rem .7rem;z-index:10}
h1{font-size:clamp(1.7rem,4.5vw,2.4rem);line-height:1.15;margin:.2rem 0;text-wrap:balance}
h2{font-size:1.35rem;margin:2.4rem 0 .6rem;text-wrap:balance}
h3{font-size:1.05rem;margin:1.2rem 0 .4rem}section{scroll-margin-top:4rem}
.small{font-size:.875rem;color:var(--ink2)}.empty{color:var(--ink2);font-style:italic}
.site{background:var(--panel);border-bottom:1px solid var(--line)}
.site .wrap{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding-block:.7rem}
.brand{font-weight:700;color:var(--ink);text-decoration:none}.site nav{display:flex;gap:1rem;font-size:.9rem}
.site nav a{color:var(--ink2);text-decoration:none}
.crumbs{font-size:.85rem;color:var(--ink2);margin:1rem 0 .4rem}.crumbs a{color:var(--ink2)}
.where{color:var(--ink2);margin:.2rem 0 .6rem}
.meta{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.4rem 0}
.pill{border-radius:999px;padding:.15rem .7rem;font-size:.85rem;font-weight:600;border:1px solid var(--line);background:var(--panel)}
.pill.type{background:var(--tint);color:var(--green);border-color:transparent}
.actions{margin:1rem 0 0}.actions p{margin:.4rem 0}
.btn{display:inline-block;font:inherit;font-weight:600;border-radius:10px;padding:.7rem 1.2rem;min-height:44px;
 background:var(--green);color:var(--on-green);border:1px solid var(--green);text-decoration:none}
.protest{background:var(--tint);border:1px solid var(--green2);border-radius:12px;padding:.8rem 1rem;margin:1rem 0 0}
.protest p{margin:.35rem 0}.protest .t{font-weight:700}
.note{background:var(--panel);border:1px dashed var(--line);border-radius:10px;padding:.5rem .8rem;font-size:.875rem;color:var(--ink2)}
.toc{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);margin-top:1.4rem;padding-block:.4rem}
.toc ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.2rem 1rem;font-size:.88rem}.toc a{text-decoration:none}
.dsum{list-style:none;padding:0;font-size:1.06rem}.dsum li{margin:.4rem 0}
.dknown,.dunk,.dimp,.dlatest,.dnext,.plain{padding-left:1.2rem}.dknown li,.dunk li,.dimp li,.plain li{margin:.35rem 0}
.dlatest{list-style:none;padding:0}.dlatest li{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--green);
 border-radius:12px;padding:1rem 1.1rem;margin:.6rem 0}
.cards{list-style:none;padding:0;display:grid;gap:.6rem}
.cards li{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem}.cards p{margin:.15rem 0}
.cards .t{font-weight:600}
.timeline{list-style:none;padding:0;margin:0;border-left:2px solid var(--line)}
.timeline>li{display:grid;grid-template-columns:7.5rem 1fr;gap:.8rem;padding:.8rem 0 .8rem .9rem;position:relative}
.timeline>li::before{content:"";position:absolute;left:-6px;top:1.15rem;width:10px;height:10px;border-radius:50%;background:var(--green)}
.tdate{font-size:.85rem;font-variant-numeric:tabular-nums}.tdate time{display:block;font-weight:700}.tdate span{color:var(--ink2)}
.tbody{min-width:0}.tbody p{margin:.2rem 0}
@media (max-width:520px){.timeline>li{grid-template-columns:1fr;gap:.2rem}}
.chips{display:flex;flex-wrap:wrap;gap:.3rem}.chip{font-size:.72rem;border:1px solid var(--line);border-radius:999px;padding:0 .5rem;color:var(--ink2)}
.jody{background:var(--violet-t);border-radius:12px;padding:.2rem 1rem .8rem}.jody h3{color:var(--violet)}
.reel{overflow:hidden;margin:.4rem -1rem 0;padding:.2rem 1rem;mask-image:linear-gradient(90deg,transparent,#000 1rem,#000 calc(100% - 1rem),transparent)}
.reel-track{list-style:none;margin:0;padding:0;display:flex;width:max-content}
.reel-track>li{width:15rem;padding-right:.9rem;flex:none}
.reel-track a{display:block;text-decoration:none;color:var(--ink)}.reel-track a:hover .vtitle{text-decoration:underline}
.vthumb{display:block;position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:var(--line)}
.vthumb img,.vthumb .noimg{display:block;width:100%;height:100%;object-fit:cover}
.vtag{position:absolute;left:.4rem;bottom:.4rem;background:rgba(0,0,0,.72);color:#fff;font-size:.72rem;font-weight:600;border-radius:6px;padding:.05rem .4rem}
.vtitle{display:block;font-size:.9rem;font-weight:600;line-height:1.35;margin-top:.45rem}
.reel.moving .reel-track{animation:reel calc(var(--n) * 7s) linear infinite}
.reel.moving:hover .reel-track,.reel.moving:focus-within .reel-track{animation-play-state:paused}
@keyframes reel{to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.reel{overflow-x:auto;mask-image:none}.reel.moving .reel-track{animation:none}
 .reel-track>li[aria-hidden]{display:none}}
.method{border-top:1px solid var(--line);margin-top:2.5rem;padding-block:1rem 3rem}
.method nav{display:flex;flex-wrap:wrap;gap:.4rem 1rem;font-size:.9rem}
"""


def _protests(d):
    """Open protest windows of the linked water filings, from the state's own change record
    (facts.protest, development_water_protest). A window is open while its protest end date is on
    or after the build day (d["_today"], the real UTC date; the page is rebuilt at least daily, so
    the box leaves the page the day after the window closes). An unknown build day, an undated
    window or a form link that is not https shows nothing: the page never offers a form it cannot
    say is open."""
    today = str(d.get("_today") or "")
    if not DAY_RE.match(today):
        return ""
    out = []
    for l in _links(d, "water_filing"):
        pr = (l.get("facts") or {}).get("protest") or {}
        end, form = str(pr.get("protest_end") or ""), safe_url(pr.get("form_url"))
        if not DAY_RE.match(end) or end < today or not form:
            continue
        f = l.get("facts") or {}
        filing = f'{f.get("filing_type") or "Water-rights filing"} {f.get("filing_no") or ""}'.strip()
        already = (f' The state\'s record lists it as {esc(str(pr["protested"]).lower())}.'
                   if str(pr.get("protested") or "").strip() else "")
        checked = day(pr.get("checked_at"))
        out.append(
            f'<div class="protest"><p class="t">Protest period open until {esc(day(end))}</p>'
            f'<p>{esc(prose(filing))}. {esc(pr.get("who") or "")}{already}</p>'
            f'<p class="small">{esc(pr.get("how") or "")}</p>'
            f'<p><a class="btn" href="{esc(form)}" rel="nofollow noopener">{esc(pr.get("form_label") or "File a protest")}</a></p>'
            + (f'<p class="small">{_src(pr.get("help_url"), pr.get("help_label")).strip()}</p>' if safe_url(pr.get("help_url")) else "")
            + f'<p class="small">Dates from the{_src(pr.get("record_url"), "state change record").rstrip()}'
            + (f', checked {esc(checked)}' if checked else "") + '. HomeSignal is not part of the protest process.</p></div>')
    return "".join(out)


def render(d, pages, built, head, crumb_place=None):
    """One dossier page. `pages` is the ZIP pages dict (for names and links); `head` is
    gen_zip_pages._head; `built` is the build-day token."""
    key, name = d["project_key"], d["display_name"]
    zips = [z for z in zips_of(d) if z in pages]
    # Where it is: the county (its own name, gen_zip_pages county_label), not the first ZIP's
    # town. A development touching several counties names each.
    counties = []
    for z in zips:
        c = pages[z].get("county_label") or (f'{pages[z]["county"]} County' if pages[z].get("county") else "")
        if c and c not in counties:
            counties.append(c)
    where = (f'{" and ".join(counties)}, {pages[zips[0]].get("state") or d["state"]}' if counties else "")
    kind, life = d.get("_type") or "", d.get("_lifecycle") or ""
    canon = f'{d.get("_base", "")}{d["path"]}'
    summary = _stmts(d, "summary")
    desc = (summary[0]["body"] if summary else f"Public records, official documents and timeline for {name}.")[:300]
    title = f"{name}" + (f" — {kind}" if kind else "") + (f" in {where}" if where else "") + " | HomeSignal"
    # Breadcrumb: home, the county (no page of its own, so plain text and not in the structured
    # list), the development.
    crumbs = [("HomeSignal", "/"), (name, d["path"])]
    ld = {"@context": "https://schema.org", "@type": "BreadcrumbList",
          "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n,
                               "item": f'{d.get("_base", "")}{u}'} for i, (n, u) in enumerate(crumbs)]}
    crumb_nav = ('<nav class="crumbs" aria-label="Breadcrumb"><a href="/">HomeSignal</a> › '
                 + (f'<span>{esc(where)}</span> › ' if where else "")
                 + f'<span aria-current="page">{esc(name)}</span></nav>')
    note = ('<p class="note">Descriptive label by HomeSignal. No public record names this project.</p>'
            if d.get("name_basis") == "descriptive" else "")
    df = d.get("defining") or {}
    defin = ""
    if kind or life:
        defin = (f'<p class="meta"><span class="pill type">{esc(kind or "Type not stated")}</span>'
                 f'<span class="pill life">{esc(life or "Lifecycle unknown")}</span></p>'
                 f'<p class="small">From the defining record:'
                 f'{_src(df.get("evidence_url"), df.get("evidence_label") or _doc_title(df))}</p>')
    # The map links live in Map & land, with their parcel counts; the hero does not repeat them.
    follow = (f'<div class="actions"><p><a class="btn" href="/follow-development.html?d={esc(d["state"].lower())}/{esc(key)}" '
              f'rel="nofollow">Follow this development</a></p>'
              f'<p class="small">Saves this development to your HomeSignal account. It does not sign you up for email.</p></div>')

    # Overview, what we know and don't, impacts
    ov = _stmt_list(summary, "dsum") + (
        f'<h3>What the records show</h3>{_stmt_list(_stmts(d, "known"), "dknown")}' if _stmts(d, "known") else "") + (
        f'<h3>Not known yet</h3>{_stmt_list(_stmts(d, "unknown"), "dunk")}' if _stmts(d, "unknown") else "") + (
        f'<h3>Possible effects named in the records</h3>{_stmt_list(_stmts(d, "impact"), "dimp")}'
        if _stmts(d, "impact") else "")

    # Map & land: the ZIP and map pages, and the land as associated, never as a footprint
    land = []
    for l in _links(d, "land_assembly"):
        for x in (l.get("facts") or {}).get("zips") or []:
            z = x.get("zip")
            if z in pages:
                land.append(f'<li><a href="/map/{esc(z)}/">ZIP {esc(z)} ({esc(pages[z]["name"])}) on the map</a>'
                            f' <span class="small">{esc(x.get("parcels"))} associated parcel'
                            f'{"" if x.get("parcels") == 1 else "s"}</span></li>')
    other = [z for z in zips if not any(f"/map/{z}/" in s for s in land)]
    land += [f'<li><a href="/map/{esc(z)}/">ZIP {esc(z)} ({esc(pages[z]["name"])}) on the map</a></li>' for z in other]
    map_inner = (f'<ul class="plain">{"".join(land)}</ul><p class="small">Associated land is land the linked records '
                 f'tie to this project. It is not a confirmed project footprint unless an approved site plan says so.</p>'
                 if land else "")

    # Entities: one card per entity (organization link ref), every role it holds under its name,
    # each role with its own source. Who decides comes first, then who applies, then who owns.
    ents = {}
    for l in sorted(_links(d, "organization"), key=lambda l: ENTITY_ORDER.get(l["role"], len(ENTITY_ORDER))):
        ents.setdefault(l["ref"], []).append(l)

    def role_line(l):
        src = _src(l.get("evidence_url"), l.get("evidence_label")).strip()
        return (f'<p><strong>{esc(ROLE_LABEL.get(l["role"], l["role"]))}</strong>'
                + (f'. {esc(prose(l["text"]))}' if l.get("text") else "") + "</p>"
                + (f'<p class="small">{src}</p>' if src else ""))
    orgs = "".join(f'<li><p class="t">{esc(ref.split(":", 1)[1])}</p>{"".join(role_line(l) for l in ls)}</li>'
                   for ref, ls in ents.items())

    def doc_li(l):
        rec = safe_url((l.get("facts") or {}).get("record_url"))
        srcs = _src(l.get("evidence_url"), l.get("evidence_label") or "Official record") + (
            _src(rec, "Agency record") if rec != safe_url(l.get("evidence_url")) else "")
        return (f'<li><p class="t">{esc(prose(_doc_title(l)))}</p>'
                f'<p class="small">{esc(ROLE_LABEL.get(l["role"], l["role"]))}'
                + (f' · {esc(day(l.get("date")))}' if l.get("date") else "") + "</p>"
                + (f'<p class="small">{srcs.strip()}</p>' if srcs else "") + "</li>")
    docs = "".join(doc_li(l) for l in _links(d, *DOC_KINDS))

    vids = _links(d, "youtube_video")
    main = [l for l in vids if (l.get("facts") or {}).get("kind") == "main"]
    shorts = [l for l in vids if (l.get("facts") or {}).get("kind") == "short"]
    posts = _links(d, "bluesky_post")

    def card(l, copy=False):
        """A video as its YouTube thumbnail with the title under it. The copy (second pass of the
        reel, so it can loop) is hidden from screen readers and the keyboard."""
        f = l["facts"]
        url, vid = safe_url(f.get("url")), yt_id(f.get("url"))
        tab = ' tabindex="-1"' if copy else ""
        thumb = (f'<img src="https://i.ytimg.com/vi/{vid}/hqdefault.jpg" alt="" width="480" height="360" loading="lazy">'
                 if vid else '<span class="noimg"></span>')
        tag = '<span class="vtag">Short</span>' if f.get("kind") == "short" else ""
        return (f'<li{" aria-hidden=\"true\"" if copy else ""}><a href="{esc(url)}" rel="noopener"{tab}>'
                f'<span class="vthumb">{thumb}{tag}</span><span class="vtitle">{esc(prose(f.get("title")))}</span></a></li>')

    cov = ""
    vids_all = [l for l in main + shorts if safe_url((l.get("facts") or {}).get("url"))]
    if vids_all:
        moving = len(vids_all) > 1
        track = "".join(card(l) for l in vids_all) + ("".join(card(l, True) for l in vids_all) if moving else "")
        cov += (f'<h3>Videos</h3><div class="reel{" moving" if moving else ""}" role="region" aria-label="Videos">'
                f'<ul class="reel-track" style="--n:{len(vids_all)}">{track}</ul></div>')
    if posts:
        cov += '<h3>Bluesky posts</h3><ul class="plain">' + "".join(
            f'<li>{esc(day((l["facts"] or {}).get("published_at")))}: {esc(prose((l["facts"] or {}).get("text")))}'
            + _src(l.get("evidence_url"), "Post on Bluesky") + "</li>" for l in posts) + "</ul>"
    if cov:
        cov = ('<div class="jody"><p class="small">HomeSignal\'s own explainers. They are editorial, not government '
               'records, and are listed only after they are public.</p>' + cov + '</div>')

    parts = [
        ("overview", "Overview", ov, "a HomeSignal summary"),
        ("changed", "What changed", _stmt_list(_stmts(d, "latest"), "dlatest"), "a recorded change"),
        ("next", "What's next", _stmt_list(_stmts(d, "next"), "dnext"),
         "an upcoming hearing or deadline confirmed in the sources HomeSignal tracks"),
        ("map", "Map & land", map_inner, "a location"),
        ("entities", "Entities", f'<ul class="cards">{orgs}</ul>' if orgs else "", "a linked entity"),
        ("documents", "Official documents", f'<ul class="cards">{docs}</ul>' if docs else "", "a linked official document"),
        ("timeline", "Timeline", _timeline(d), "a dated event"),
        ("coverage", "HomeSignal coverage", cov, "a HomeSignal video or post"),
    ]
    shown = [p for p in parts if p[2]]
    missing = [p[3] for p in parts if not p[2]]
    toc = ('<nav class="toc" aria-label="On this page"><ul>'
           + "".join(f'<li><a href="{d["path"]}#{i}">{esc(t)}</a></li>' for i, t, _, _ in shown) + "</ul></nav>"
           if len(shown) > 1 else "")
    gaps = (f'<p class="empty" id="not-yet">Not on record yet: {esc("; ".join(missing))}.</p>' if missing else "")
    body = (
        '<a class="skip" href="#main">Skip to content</a>'
        + SITE_HEADER +
                f'<main id="main" class="wrap">{crumb_nav}<section class="hero" aria-labelledby="h1">'
        f'<h1 id="h1">{esc(name)}</h1>'
        + (f'<p class="where">{esc(where)}</p>' if where else "") + f'{note}{defin}{follow}{_protests(d)}</section>{toc}'
        + "".join(_section(i, t, inner) for i, t, inner, _ in shown)
        + gaps
        + '<footer class="method"><p class="small">Every fact on this page links to its source. A link is shown only '
          'after a HomeSignal reviewer checked it against the source. Page compiled '
          f'<time datetime="{esc(built)}">{BUILT_HUMAN}</time>.</p>'
          '</footer></main>' + SITE_FOOTER)
    # The shell's stylesheets are written for the app shell, which this script-free page does not
    # load; the page carries its own layout instead.
    h = head(title, desc, canon, og_type="article", ld=ld)
    h = re.sub(r'<link rel="stylesheet" href="/(?:layout|app)\.css[^"]*">\n?', "", h)
    h = h.replace("</head>", f"<style>{CHROME_CSS}{CSS.strip()}</style>\n</head>", 1)
    if vids_all:
        if CSP_FROM not in h:
            sys.exit("ERROR: development page head has no img-src to widen for video thumbnails")
        h = h.replace(CSP_FROM, CSP_TO, 1)
    return h + f'<body>\n{body}\n</body>\n</html>\n'


def link_pages(dossiers, pages, projects):
    """The ZIP pages and /project/ pages a dossier touches get a link to it."""
    for d in sorted(dossiers.values(), key=lambda x: x["project_key"]):
        for z in zips_of(d):
            if z in pages:
                pages[z].setdefault("dossiers", []).append((d["display_name"], d["path"]))
        for l in _links(d, "source_record"):
            pr = projects.get(l.get("ref"))
            if pr is not None:
                pr.setdefault("part_of", []).append((d["display_name"], d["path"]))


LAND_INDEX_SCHEMA = "development-land-index/1"
LAND_INDEX_PATH = ("development", "land-index.json")
LAND_REF_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def land_index(dossiers):
    """Which land assembly has a published development page: {land ref: {path, name}}.

    Map 1's land card (homesignalmap.html) reads this to link the land to its page. It is derived
    from the same published snapshot as the pages themselves, so it can only name a page this
    build writes, and only through a land link a reviewer approved (the snapshot carries no other
    links). A land assembly linked from two pages is left out rather than guessed between."""
    seen = {}
    for key in sorted(dossiers):
        d = dossiers[key]
        for l in _links(d, "land_assembly"):
            ref = str(l.get("ref") or "")
            if LAND_REF_RE.match(ref):
                seen.setdefault(ref, []).append({"path": d["path"], "name": d["display_name"]})
    land = {ref: v[0] for ref, v in sorted(seen.items()) if len(v) == 1}
    return {"schema": LAND_INDEX_SCHEMA, "land": land}


def write_land_index(dossiers, out_dir):
    """Written beside the dossier pages, and only when there are any: with no published dossier
    there is nothing to link, and Map 1 reads a missing file (HTTP 404) as no links."""
    if not dossiers:
        return 0
    doc = land_index(dossiers)
    out = os.path.join(out_dir, *LAND_INDEX_PATH)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(json.dumps(doc, sort_keys=True, separators=(",", ":")))
    return len(doc["land"])


def build(dossiers, pages, out_dir, built, head, state=None, base=""):
    """Writes every dossier page. Rendered with the build-day token (page_semantics) so the
    fingerprint never moves on the date alone; the token is replaced when the file is written.
    The seed lastmod is the dossier's own last change (a link or statement row)."""
    import page_semantics as ps
    paths = []
    for key in sorted(dossiers):
        d = dict(dossiers[key], _base=base, _today=built)
        if not PATH_RE.match(d["path"]):
            sys.exit(f"ERROR: dossier path refused: {d['path']!r}")
        doc = render(d, pages, ps.BUILD_DAY_TOKEN, head)
        if state is not None:
            hint = str(d.get("updated_at") or "")[:10]
            state.add(d["path"], doc, hint if DAY_RE.match(hint) else None)
        out = os.path.join(out_dir, *d["path"].strip("/").split("/"))
        os.makedirs(out, exist_ok=True)
        open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(
            doc.replace(BUILT_HUMAN, esc(day(built) or built)).replace(ps.BUILD_DAY_TOKEN, built))
        paths.append(d["path"])
    return paths
