"""Public claim checks: /fact-checks/<slug>/ and the archive /fact-checks/ (Tab 19, 2026-10-30).

Built from the approved claim checks only: public.claim_check_public_export() (docs/claim-check.sql), fetched by pages.yml
into data/fact_checks.json. That function returns nothing that has not been researched, passed the evidence checks and
been approved by the founder, so this file never sees a candidate or a provisional verdict and decides nothing about one.

Every fact on a page is in the HTML the server sends, beside the source it comes from. The page ships no script. The
speaker's video plays in the publisher's own player (youtube-nocookie) only when the export says embedding is allowed;
otherwise the page links to the original. A correction or retraction stays on the page with its date.
Pure functions: gen_zip_pages.py passes in its own head helper and page-semantics state.
"""
import html, json, os, re, sys

SCHEMA = "claim-checks/1"
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EMBED_RE = re.compile(r"^https://www\.youtube-nocookie\.com/embed/[A-Za-z0-9_-]{6,20}$")
THUMB_RE = re.compile(r"^https://i\.ytimg\.com/[^\s\"<>]+$")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
VERDICT = {"false": "False", "misleading": "Misleading", "accurate": "Accurate",
           "needs_context": "Needs Context", "unverified": "Unverified"}
# schema.org ClaimReview rating, 1 (false) .. 5 (true); unverified carries no number
RATING = {"false": 1, "misleading": 2, "needs_context": 3, "accurate": 5}
INDEX_PATH = "/fact-checks/"
# The page CSP: the site's no-script policy plus the one player and one image host a claim check may show.
CSP_FROM = "img-src 'self' data:; font-src 'self';"
CSP_TO = "img-src 'self' data: https://i.ytimg.com; frame-src https://www.youtube-nocookie.com; font-src 'self';"


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
    return u if re.match(r"^https?://[^\s\"<>]+$", u) else ""


def path_of(c):
    return f"{INDEX_PATH}{c['slug']}/"


def load(path, required):
    """The export. A missing file is 'none published' only where the caller allows it; a present but malformed file
    always stops the build: an unreadable list of claim checks is not an empty one."""
    if not path or not os.path.isfile(path):
        if required:
            sys.exit(f"ERROR: claim checks file missing: {path}")
        return []
    try:
        d = json.load(open(path, encoding="utf-8"))
    except ValueError as e:
        sys.exit(f"ERROR: claim checks file unreadable: {e}")
    if not isinstance(d, dict) or d.get("schema") != SCHEMA or not isinstance(d.get("claims"), list):
        sys.exit("ERROR: claim checks file has the wrong shape")
    out, seen = [], set()
    for c in d["claims"]:
        if not isinstance(c, dict) or not SLUG_RE.match(str(c.get("slug") or "")):
            sys.exit(f"ERROR: claim check without a valid slug: {c!r:.120}")
        if c["slug"] in seen:
            sys.exit(f"ERROR: duplicate claim check slug {c['slug']}")
        if c.get("verdict") not in VERDICT or not c.get("quote") or not c.get("speaker_name") or not c.get("headline"):
            sys.exit(f"ERROR: claim check {c['slug']} is missing its verdict, quote, speaker or headline")
        if c.get("public_state") not in ("published", "corrected", "retracted"):
            sys.exit(f"ERROR: claim check {c['slug']} is not public ({c.get('public_state')!r})")
        seen.add(c["slug"])
        out.append(c)
    return out


def _video(c):
    for s in c.get("sources") or []:
        e = str(s.get("embed_url") or "")
        if EMBED_RE.match(e):
            start = c.get("timestamp_s")
            src = e + (f"?start={int(start)}" if isinstance(start, int) and start >= 0 else "")
            return (f'<div class="fc-video"><iframe width="640" height="360" src="{esc(src)}" title="{esc(s.get("title") or "Video")}"'
                    ' loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen'
                    ' referrerpolicy="strict-origin-when-cross-origin"></iframe></div>')
    return ""


def _sources(c):
    rows = []
    for s in c.get("sources") or []:
        u = safe_url(s.get("url"))
        if not u:
            continue
        who = " · ".join(x for x in (s.get("publisher"), s.get("program"), day(s.get("published_at"))) if x)
        rows.append(f'<li><a href="{esc(u)}" rel="noopener nofollow">{esc(s.get("title") or u)}</a>'
                    + (f' <span class="quiet">{esc(who)}</span>' if who else "") + "</li>")
    return "<ul>" + "".join(rows) + "</ul>" if rows else '<p class="quiet">No original source link is available.</p>'


def _evidence(items):
    items = [e for e in (items or []) if isinstance(e, dict) and safe_url(e.get("url"))]
    if not items:
        return '<p class="quiet">None found.</p>'
    return "<ul>" + "".join(
        f'<li>{esc(e.get("finding"))} <a href="{esc(safe_url(e["url"]))}" rel="noopener nofollow">{esc(e.get("title") or "Source")}</a>'
        + (f'<blockquote class="quiet">“{esc(e["quote"])}”</blockquote>' if e.get("quote") else "") + "</li>"
        for e in items) + "</ul>"


def render(c, built, head, base=""):
    p = path_of(c)
    canon = f"{base}{p}"
    v = VERDICT[c["verdict"]]
    retracted = c.get("public_state") == "retracted"
    title = f"{c['headline']} | JODY Tracks fact-check"
    desc = f"{v}: {c['speaker_name']} said “{c['quote']}”"[:300]
    corrections = [x for x in (c.get("corrections") or []) if isinstance(x, dict)]
    ld = [{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
              {"@type": "ListItem", "position": 1, "name": "JODY Tracks", "item": f"{base}/"},
              {"@type": "ListItem", "position": 2, "name": "Data center fact-checks", "item": f"{base}{INDEX_PATH}"},
              {"@type": "ListItem", "position": 3, "name": c["headline"], "item": canon}]}]
    if not retracted:
        rating = {"@type": "Rating", "alternateName": v, "bestRating": 5, "worstRating": 1}
        if c["verdict"] in RATING:
            rating["ratingValue"] = RATING[c["verdict"]]
        ld.append({"@context": "https://schema.org", "@type": "ClaimReview", "url": canon,
                   "datePublished": str(c.get("reviewed_at") or "")[:10], "claimReviewed": c.get("assertion") or c["quote"],
                   "author": {"@type": "Organization", "name": "JODY Tracks", "url": f"{base}/"},
                   "itemReviewed": {"@type": "Claim", "author": {"@type": "Person", "name": c["speaker_name"]},
                                    "appearance": [{"@type": "CreativeWork", "url": safe_url(s.get("url"))}
                                                   for s in (c.get("sources") or []) if safe_url(s.get("url"))][:3]},
                   "reviewRating": rating})
    doc = head(title, desc, canon, og_type="article", ld=ld[0] if len(ld) == 1 else {"@context": "https://schema.org", "@graph": ld})
    doc = doc.replace(CSP_FROM, CSP_TO, 1)
    ev = c.get("evidence") or {}
    who = c["speaker_name"] + (f", {c['speaker_org']}" if c.get("speaker_org") else "")
    qsrc = safe_url(c.get("quote_source_url"))
    ts = c.get("timestamp_s")
    body = (
        '<body class="fc">\n<main class="hs-container">\n'
        f'<nav class="zcrumb" aria-label="Breadcrumb"><a href="/">JODY Tracks</a> › <a href="{INDEX_PATH}">Data center fact-checks</a></nav>\n'
        + (f'<p class="fc-retracted"><b>Retracted.</b> {esc((corrections[-1] if corrections else {}).get("note"))}</p>\n' if retracted else "")
        + f"<h1>{esc(c['headline'])}</h1>\n"
        f'<p class="fc-verdict fc-v-{esc(c["verdict"])}">Verdict: <b>{esc(v)}</b></p>\n'
        f'<blockquote class="fc-quote">“{esc(c["quote"])}”<footer>— {esc(who)}'
        + (f' · at {int(ts) // 60}:{int(ts) % 60:02d}' if isinstance(ts, int) and ts >= 0 else "")
        + (f' · <a href="{esc(qsrc)}" rel="noopener nofollow">words as published</a>' if qsrc else "") + "</footer></blockquote>\n"
        + _video(c)
        + (f"<p><b>The claim tested:</b> {esc(c['assertion'])}</p>\n" if c.get("assertion") else "")
        + (f'<p class="quiet">Context: {esc(c["context"])}</p>\n' if c.get("context") else "")
        + f"<h2>What the evidence shows</h2>\n<p>{esc(c.get('verdict_explanation'))}</p>\n"
        "<h3>Evidence contradicting the claim</h3>\n" + _evidence(ev.get("contradicting"))
        + "<h3>Evidence supporting the claim</h3>\n" + _evidence(ev.get("supporting"))
        + (f'<p class="quiet">What the records do not settle: {esc(c["evidence_gaps"])}</p>\n' if c.get("evidence_gaps") else "")
        + "<h2>Original source</h2>\n" + _sources(c)
        + f'<p class="quiet">Reviewed {esc(day(c.get("reviewed_at")))} · last updated {esc(day(c.get("updated_at")))}.'
        " JODY Tracks reviews what a public statement claims against public records. A verdict is about the claim, not the person.</p>\n"
        + ("<h2>Corrections</h2>\n<ul>" + "".join(
            f'<li>{esc(day(x.get("at")))}: {"Retraction" if x.get("kind") == "retract" else "Correction"}: {esc(x.get("note"))}</li>'
            for x in corrections) + "</ul>\n" if corrections else "")
        + '<p><a class="btn" href="/development-activity.html">Track development near a home</a>'
        ' · <a href="/homesignalmap.html">See the Development Map</a></p>\n'
        f'<p class="quiet">Built {esc(built)}.</p>\n</main>\n</body>\n</html>\n')
    return doc + body


def render_index(claims, built, head, base=""):
    canon = f"{base}{INDEX_PATH}"
    doc = head("Data center fact-checks | JODY Tracks",
               "What people say about data centers, checked against public records: permits, water rights, utility filings and more.",
               canon, ld={"@context": "https://schema.org", "@type": "CollectionPage", "name": "Data center fact-checks", "url": canon})
    rows = "".join(
        f'<li><a href="{esc(path_of(c))}">{esc(c["headline"])}</a> <span class="quiet">· {esc(VERDICT[c["verdict"]])}'
        f' · {esc(c["speaker_name"])} · {esc(day(c.get("reviewed_at")))}'
        + (" · retracted" if c.get("public_state") == "retracted" else " · corrected" if c.get("public_state") == "corrected" else "")
        + "</span></li>" for c in claims)
    return doc + ('<body class="fc">\n<main class="hs-container">\n<h1>Data center fact-checks</h1>\n'
                  "<p>What people say about data centers, against what the public record shows. Every verdict links to its sources.</p>\n"
                  + (f"<ul>{rows}</ul>\n" if rows else '<p class="quiet">No fact-checks are published yet.</p>\n')
                  + f'<p class="quiet">Built {esc(built)}.</p>\n</main>\n</body>\n</html>\n')


def build(claims, out_dir, built, head, state=None, base=""):
    """Writes every claim-check page and the archive. Returns the claim-check paths (the archive is a separate path,
    returned second). Rendered with the build-day token so the fingerprint never moves on the date alone."""
    import page_semantics as ps
    paths = []
    for c in sorted(claims, key=lambda x: x["slug"]):
        p = path_of(c)
        doc = render(c, ps.BUILD_DAY_TOKEN, head, base)
        if state is not None:
            hint = str(c.get("updated_at") or "")[:10]
            state.add(p, doc, hint if DAY_RE.match(hint) else None)
        out = os.path.join(out_dir, *p.strip("/").split("/"))
        os.makedirs(out, exist_ok=True)
        open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(doc.replace(ps.BUILD_DAY_TOKEN, built))
        paths.append(p)
    ordered = sorted(claims, key=lambda x: str(x.get("reviewed_at") or ""), reverse=True)
    idx = render_index(ordered, ps.BUILD_DAY_TOKEN, head, base)
    if state is not None:
        state.add(INDEX_PATH, idx, None)
    os.makedirs(os.path.join(out_dir, "fact-checks"), exist_ok=True)
    open(os.path.join(out_dir, "fact-checks", "index.html"), "w", encoding="utf-8").write(idx.replace(ps.BUILD_DAY_TOKEN, built))
    return paths, INDEX_PATH
