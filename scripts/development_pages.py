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
DOC_KINDS = ("source_record", "water_filing", "government_record", "document", "dc_entity")


def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def day(s):
    s = str(s or "")[:10]
    if not DAY_RE.match(s):
        return ""
    y, m, d = s.split("-")
    return f"{MONTHS[int(m) - 1]} {int(d)}, {y}"


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
        return {"name": d.get("display_name"), "type": "Data center"}
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
    return f' <a href="{esc(u)}" rel="nofollow noopener">{esc(label or "Source")}</a>'


def _links(d, *kinds):
    return [l for l in (d.get("links") or []) if l.get("kind") in kinds]


def _stmts(d, kind):
    return [s for s in (d.get("statements") or []) if s.get("kind") == kind]


def _stmt_list(items, cls):
    if not items:
        return ""
    lis = []
    for s in items:
        when = f'<span class="quiet">{esc(s.get("date_label") or "")} {esc(day(s.get("date")))}</span> ' \
            if s.get("date") else ""
        title = f'<strong>{esc(s["title"])}</strong>. ' if s.get("title") else ""
        lis.append(f'<li>{when}{title}{esc(s["body"])}{_src(s.get("evidence_url"), s.get("evidence_label"))}'
                   + (f' <span class="quiet">Checked {esc(day(s.get("checked_on")))}.</span>' if s.get("checked_on") else "")
                   + "</li>")
    return f'<ul class="{cls}">{"".join(lis)}</ul>'


def _section(h_id, title, inner, empty=None):
    if not inner:
        if empty is None:
            return ""
        inner = f'<p class="quiet">{esc(empty)}</p>'
    return f'<section class="zsec" id="{h_id}"><h2>{esc(title)}</h2>{inner}</section>'


def _doc_title(l):
    f = l.get("facts") or {}
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
        f'<li><time datetime="{esc(r[0])}">{esc(day(r[0]))}</time> · {esc(r[1] or "")}'
        + (f' <span class="quiet">({esc(r[2])})</span>' if r[2] else "")
        + f'<br>{esc(r[3])}{_src(r[4], r[5])}</li>' for r in rows)
    return (f'<ol class="dtl">{lis}</ol><p class="quiet">Dates are each source\'s own. '
            f'HomeSignal videos and posts are listed separately below; they are not government events.</p>')


def render(d, pages, built, head, crumb_place=None):
    """One dossier page. `pages` is the ZIP pages dict (for names and links); `head` is
    gen_zip_pages._head; `built` is the build-day token."""
    key, name = d["project_key"], d["display_name"]
    zips = [z for z in zips_of(d) if z in pages]
    where = ""
    if zips:
        p0 = pages[zips[0]]
        where = f'{p0.get("county") or p0["name"]}, {p0.get("state") or d["state"]}'
    kind, life = d.get("_type") or "", d.get("_lifecycle") or ""
    canon = f'{d.get("_base", "")}{d["path"]}'
    summary = _stmts(d, "summary")
    desc = (summary[0]["body"] if summary else f"Public records, official documents and timeline for {name}.")[:300]
    title = f"{name}" + (f" — {kind}" if kind else "") + (f" in {where}" if where else "") + " | HomeSignal"
    crumbs = [("HomeSignal", "/")]
    if zips:
        crumbs.append((pages[zips[0]]["name"], f"/community/{zips[0]}/"))
    crumbs.append((name, d["path"]))
    ld = {"@context": "https://schema.org", "@type": "BreadcrumbList",
          "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n,
                               "item": f'{d.get("_base", "")}{u}'} for i, (n, u) in enumerate(crumbs)]}
    crumb_nav = ('<nav class="zcrumb" aria-label="Breadcrumb">'
                 + " › ".join(f'<a href="{esc(u)}">{esc(n)}</a>' for n, u in crumbs[:-1]) + "</nav>")
    note = ('<p class="quiet">Descriptive label by HomeSignal. No public record names this project.</p>'
            if d.get("name_basis") == "descriptive" else "")
    df = d.get("defining") or {}
    defin = ""
    if kind or life:
        defin = (f'<p>{esc(kind or "Type not stated")} · {esc(life or "Lifecycle unknown")}'
                 f' <span class="quiet">from the defining record:'
                 f'{_src(df.get("evidence_url"), df.get("evidence_label") or _doc_title(df))}</span></p>')
    jump = ('<nav class="zsec" aria-label="On this page">'
            + " · ".join(f'<a href="{d["path"]}#{i}">{t}</a>' for i, t in (
                ("overview", "Overview"), ("changed", "What changed"), ("next", "What's next"),
                ("map", "Map &amp; land"), ("organizations", "Organizations"), ("documents", "Official documents"),
                ("timeline", "Timeline"), ("coverage", "HomeSignal coverage"))) + "</nav>")
    follow = (f'<p><a class="btn" href="/follow-development.html?d={esc(d["state"].lower())}/{esc(key)}" rel="nofollow">'
              f'Follow this development</a> <span class="quiet">Saved to your HomeSignal account.</span></p>')

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
                            f' <span class="quiet">{esc(x.get("parcels"))} associated parcel'
                            f'{"" if x.get("parcels") == 1 else "s"}</span></li>')
    other = [z for z in zips if not any(f"/map/{z}/" in s for s in land)]
    land += [f'<li><a href="/map/{esc(z)}/">ZIP {esc(z)} ({esc(pages[z]["name"])}) on the map</a></li>' for z in other]
    map_inner = (f'<ul>{"".join(land)}</ul><p class="quiet">Associated land is land the linked records tie to '
                 f'this project. It is not a confirmed project footprint unless an approved site plan says so.</p>'
                 if land else "")

    orgs = "".join(
        f'<li><strong>{esc(l["ref"].split(":", 1)[1])}</strong> — {esc(ROLE_LABEL.get(l["role"], l["role"]))}'
        + (f'. {esc(l["text"])}' if l.get("text") else "")
        + f'{_src(l.get("evidence_url"), l.get("evidence_label"))}</li>'
        for l in _links(d, "organization"))
    docs = "".join(
        f'<li>{esc(_doc_title(l))} <span class="quiet">{esc(ROLE_LABEL.get(l["role"], l["role"]))}'
        + (f', {esc(day(l.get("date")))}' if l.get("date") else "") + "</span>"
        + _src(l.get("evidence_url"), l.get("evidence_label") or "Official record")
        + (_src((l.get("facts") or {}).get("record_url"), "Agency record")
           if safe_url((l.get("facts") or {}).get("record_url")) != safe_url(l.get("evidence_url")) else "")
        + "</li>" for l in _links(d, *DOC_KINDS))

    vids = _links(d, "youtube_video")
    main = [l for l in vids if (l.get("facts") or {}).get("kind") == "main"]
    shorts = [l for l in vids if (l.get("facts") or {}).get("kind") == "short"]
    posts = _links(d, "bluesky_post")

    def vli(l):
        f = l["facts"]
        return (f'<li><a href="{esc(safe_url(f.get("url")))}" rel="noopener">{esc(f.get("title"))}</a>'
                + (f' <span class="quiet">{esc(l["text"])}</span>' if l.get("text") else "") + "</li>")

    cov = ""
    if main:
        cov += f'<h3>Videos</h3><ul>{"".join(vli(l) for l in main)}</ul>'
    if shorts:
        cov += f'<h3>Shorts</h3><ul>{"".join(vli(l) for l in shorts)}</ul>'
    if posts:
        cov += "<h3>Bluesky posts</h3><ul>" + "".join(
            f'<li>{esc(day((l["facts"] or {}).get("published_at")))}: {esc((l["facts"] or {}).get("text"))}'
            + _src(l.get("evidence_url"), "Post on Bluesky") + "</li>" for l in posts) + "</ul>"
    if cov:
        cov = ('<p class="quiet">HomeSignal\'s own explainers. They are editorial, not government records, and are '
               'listed only after they are public.</p>' + cov)

    body = (
        f'<main id="hs-ssr">{crumb_nav}<header><p class="eyebrow"><a href="/">HomeSignal</a> · Development</p>'
        f'<h1>{esc(name)}</h1>{note}{defin}'
        + (f'<p class="addr">{esc(where)}</p>' if where else "") + f'</header>{follow}{jump}'
        + _section("overview", "Overview", ov, "HomeSignal has not written a summary of this development yet.")
        + _section("changed", "What changed", _stmt_list(_stmts(d, "latest"), "dlatest"),
                   "No change has been recorded yet.")
        + _section("next", "What's next", _stmt_list(_stmts(d, "next"), "dnext"),
                   "No upcoming hearing or deadline has been confirmed in the sources HomeSignal tracks.")
        + _section("map", "Map & land", map_inner, "No location on record yet.")
        + _section("organizations", "Organizations", f"<ul>{orgs}</ul>" if orgs else "",
                   "No organization has been linked to this development yet.")
        + _section("documents", "Official documents", f"<ul>{docs}</ul>" if docs else "",
                   "No official document has been linked yet.")
        + _section("timeline", "Timeline", _timeline(d), "No dated event on record yet.")
        + _section("coverage", "HomeSignal coverage", cov, "No HomeSignal video or post about this development yet.")
        + f'<p class="quiet">Every fact on this page links to its source. A link is shown only after a HomeSignal '
          f'reviewer checked it against the source. Page compiled <time datetime="{esc(built)}">{esc(built)}</time>.</p>'
        + '<nav class="zsec"><a href="/">HomeSignal home</a> · <a href="/how-it-works.html">How HomeSignal works</a></nav>'
        + "</main>")
    return (head(title, desc, canon, og_type="article", ld=ld)
            + f'<body data-nav="project">\n{body}\n</body>\n</html>\n')


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


def build(dossiers, pages, out_dir, built, head, state=None, base=""):
    """Writes every dossier page. Rendered with the build-day token (page_semantics) so the
    fingerprint never moves on the date alone; the token is replaced when the file is written.
    The seed lastmod is the dossier's own last change (a link or statement row)."""
    import page_semantics as ps
    paths = []
    for key in sorted(dossiers):
        d = dict(dossiers[key], _base=base)
        if not PATH_RE.match(d["path"]):
            sys.exit(f"ERROR: dossier path refused: {d['path']!r}")
        doc = render(d, pages, ps.BUILD_DAY_TOKEN, head)
        if state is not None:
            hint = str(d.get("updated_at") or "")[:10]
            state.add(d["path"], doc, hint if DAY_RE.match(hint) else None)
        out = os.path.join(out_dir, *d["path"].strip("/").split("/"))
        os.makedirs(out, exist_ok=True)
        open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(doc.replace(ps.BUILD_DAY_TOKEN, built))
        paths.append(d["path"])
    return paths
