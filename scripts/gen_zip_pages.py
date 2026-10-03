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

Rule D: >= 3 publishable Development entities from the compact ingest plane
(`data/development_seo_plane.json`). The site does not re-decide materiality. A ZIP
absent from the plane is not eligible. INDEX = Rule F OR Rule D.
"""
import argparse, hashlib, html, json, os, re, subprocess, sys, tempfile, time, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone

SUPA = "https://qwnnmljucajnexpxdgxr.supabase.co"
BASE = "https://homesignal.net"
STEP = 1000

# What the document renders. LN_CAP matches lib/community-page.js::LOCAL_NEWS_CAP so the
# SSR list and the hydrated list agree in LENGTH. Measured 2026-09-07: at a cap of 6, 665
# ZIPs lost at least one DISTINCT authorized topic (872 topic-cells); at 20, 30 ZIPs / 37
# cells. Display-only: rule_f is computed from the FULL p["ln"] above this slice, so the
# cap can never move robots or indexability.
#
# ONE DIVERGENCE REMAINS, DELIBERATELY: ln_show strips weather (journalism-only, which is
# what Rule F counts), while HS.data.news() returns the whole Local News population
# including weather. Same cap, different populations - the SSR list is a subset.
LN_CAP, GN_CAP, UM_CAP = 20, 10, 12
RULE_F_MIN = 3                               # >= 3 legitimate non-weather items
RULE_D_MIN = 3                               # >= 3 publishable Development entities
# Production freshness: a missing or stale plane must fail the Pages build, never
# silently treat Rule D as empty (that would noindex the 776 Development pages
# while the job stayed green). Fixtures may opt out with --allow-missing-dev-plane.
RULE_D_PLANE_MAX_AGE_HOURS = 36
SIB_CAP = 10                                 # sibling ZIP links per page (see link_siblings)
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


# ---------------------------------------------- the upcoming-meetings boundary ----
# THE BUILD-TIME HALF OF ONE DECISION. The live page's half is
# lib/data.js::upcomingCutoffIso, which carries the full receipt; the short version is
# that `meetings.meeting_date` is semantically a DATE (96.3% of upcoming rows sit at
# exactly 06:00:00Z or 07:00:00Z - midnight MDT / MST-PDT), so comparing it against a
# full `now` TIMESTAMP dropped a meeting from "upcoming" at local midnight on the day it
# happens. The cutoff is the calendar DATE, never the instant.
#
# The date-only string is also what makes the line-213 assertion correct under plain
# string comparison: "<today>T06:00:00+00:00" >= "<today>" is True (equal prefix, longer
# string sorts after) while "<yesterday>T06:00:00+00:00" >= "<today>" is False.
#
# Pinned against the JS half by test/meetings-upcoming-window.test.mjs.
def meeting_cutoff(now_iso):
    return (now_iso or "")[:10]


COVERAGE_PATH = os.path.join(os.path.dirname(__file__), "..", "lib", "zip-coverage.json")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_zip_coverage as zcov   # the model's own validator (one definition of its invariants)


def coverage_mode(entry):
    """The page a ZIP gets. MUST equal shell.js HS.zipCoverageMode (pinned by
    test/zip-coverage.test.mjs, which runs both over every entry). A ZIP with no entry is
    standard. Anything this cannot place fails SAFE to verification_pending, never to a
    made-up boundary."""
    if entry is None:
        return "standard"
    if entry.get("page_mode") == "retired":
        return "retired"
    if entry.get("page_mode") == "standard" and entry.get("map_coverage") == "zcta":
        return "standard"
    if entry.get("page_mode") == "specialized_zip":
        return "specialized_zip"
    return "verification_pending"


def load_zip_coverage(path=COVERAGE_PATH):
    """The ZIP coverage model (lib/zip-coverage.json, founder 2026-10-03). A missing or
    malformed model is an error, never an empty one: an empty model would silently turn every
    one of these ZIPs back into a standard page that claims a map it does not have."""
    try:
        doc = json.load(open(path, encoding="utf-8"))
        zcov.validate_public(doc)
    except (OSError, ValueError, KeyError) as e:
        sys.exit(f"ERROR: cannot use the ZIP coverage model {path}: {e}")
    if not doc["zips"]:
        sys.exit(f"ERROR: {path} holds no ZIPs")
    return doc


def fetch_data(key, now_iso):
    d = {}
    d["zips"] = [r["zip"] for r in fetch_all("canonical_zip_registry", key, "zip", keyset="zip")]
    d["meta"] = fetch_all("app_community_meta", key,
                          "zip,name,county,state,data_quality,indexable", keyset="zip")
    d["changes"] = fetch_all("app_changes", key,
                             "id,zip,community_id,category,title,source_ref,occurred_at")
    # alerts_public, not alerts: anon SELECT on alerts was revoked 2026-09-26
    # (phase3_revoke_anon_alerts_after_site_swap). Same rows for local_news, measured.
    d["agency"] = fetch_all("alerts_public", key, "id,source_url,agency_name",
                            "&category=eq.local_news")
    # keyset MUST be unique: `gt.` on a non-unique column skips the rest of a tied group
    # the moment a page fills. alert_id is one row per retraction; community_id is not.
    d["retractions"] = fetch_all("local_news_geo_retractions", key,
                                 "alert_id,community_id,source_url", "&active=is.true",
                                 keyset="alert_id")
    d["communities"] = fetch_all("communities", key, "id,name,parent_id,level,zip_codes")
    d["meetings"] = fetch_all("meetings", key,
                              "id,community_id,title,meeting_date,category,source_url",
                              f"&meeting_date=gte.{urllib.parse.quote(meeting_cutoff(now_iso))}")
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


def annotate_dev_plane(path):
    """Run the ONE site Type/lifecycle authority over the raw ingest plane.

    lib/project-type.js owns canonical Development Type and lifecycle labels.
    This helper only invokes that file through scripts/annotate-dev-seo-ssr.mjs.
    It does not copy classifier rules into Python.
    """
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    adapter = os.path.join(root, "scripts", "annotate-dev-seo-ssr.mjs")
    authority = os.path.join(root, "lib", "project-type.js")
    if not os.path.isfile(adapter):
        sys.exit("ERROR: missing scripts/annotate-dev-seo-ssr.mjs")
    if not os.path.isfile(authority):
        sys.exit("ERROR: missing lib/project-type.js")
    # Written to a temp file, never beside the input: the input sits in the repo tree
    # (data/ in production, test/fixtures/ in tests) and a generated file there can be
    # committed by accident. load_dev_plane() deletes it after reading.
    fd, out = tempfile.mkstemp(prefix="dev_seo_plane_", suffix=".ssr.json")
    os.close(fd)
    try:
        r = subprocess.run(
            ["node", adapter, "--in", path, "--out", out],
            capture_output=True, text=True, timeout=120,
        )
    except FileNotFoundError:
        sys.exit("ERROR: node is required to annotate Rule D cards via lib/project-type.js")
    if r.returncode != 0:
        sys.exit(f"ERROR: annotate-dev-seo-ssr failed: {(r.stderr or r.stdout).strip()}")
    if not os.path.isfile(out) or os.path.getsize(out) == 0:
        sys.exit("ERROR: annotate-dev-seo-ssr wrote nothing")
    return out


def _plane_age_hours(generated_at, now=None):
    """Hours since generated_at. None if the stamp is missing or unparseable."""
    raw = str(generated_at or "").strip()
    if not raw:
        return None
    try:
        stamp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    return (now - stamp.astimezone(timezone.utc)).total_seconds() / 3600.0


def _merge_side_docs(path, side_docs, required):
    """City pages' and project pages' data are published as their own objects (ingest:
    seo/development-seo-cities.json, seo/development-seo-projects.json) because one object
    would sit near the bucket's size cap. Each belongs to exactly one plane: a document from
    another run is refused, never mixed in. `side_docs` is [(doc_path, field, what)].
    Returns (path to read, temp path to delete or None)."""
    present = []
    for doc_path, field, what in side_docs:
        if not doc_path or not os.path.isfile(doc_path):
            if required and doc_path:
                sys.exit(f"ERROR: {what} pages' data file missing — refusing to silently drop "
                         f"every {what} page")
            continue
        present.append((doc_path, field, what))
    if not present:
        return path, None
    with open(path, encoding="utf-8") as fh:
        plane = json.load(fh)
    for doc_path, field, what in present:
        with open(doc_path, encoding="utf-8") as fh:
            doc = json.load(fh)
        if (doc.get("generated_at") != plane.get("generated_at")
                or doc.get("identity") != plane.get("identity")):
            sys.exit(f"ERROR: {what} data generated_at {doc.get('generated_at')!r} does not match "
                     f"the plane's {plane.get('generated_at')!r} — refusing to mix two runs")
        if not isinstance(doc.get(field), dict):
            sys.exit(f"ERROR: {what} data has no {field} object")
        plane[field] = doc[field]
    fd, merged = tempfile.mkstemp(prefix="dev_seo_plane_merged_", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(plane, fh)
    return merged, merged


def load_dev_plane(path, *, required=True, now=None, cities_out=None, cities_path=None,
                   projects_out=None, projects_path=None):
    """Read the compact Development SEO plane.

    Production (required=True): a missing, unreadable, unstamped or stale plane
    is a hard error. It must never become {} — that would silently drop Rule D
    indexability while Pages stayed green. Fixtures may pass required=False to
    exercise the no-plane case explicitly.

    cities_out: a dict to fill with the plane's validated city section (SEO plan
    step 9). In production the section must be present: a plane without it would
    silently remove every city page while the build stayed green.
    """
    if not path or not os.path.isfile(path):
        if required:
            sys.exit("ERROR: Rule D plane missing — refusing to silently drop "
                     "Development indexability")
        return {}
    side = [(cities_path, "cities", "city")]
    if projects_out is not None:
        side.append((projects_path, "projects", "project"))
    src, merged = _merge_side_docs(path, side, required)
    try:
        annotated = annotate_dev_plane(src)
    finally:
        if merged:
            os.remove(merged)
    try:
        with open(annotated, encoding="utf-8") as fh:
            raw = json.load(fh)
    finally:
        os.remove(annotated)
    if required:
        age = _plane_age_hours(raw.get("generated_at"), now=now)
        if age is None:
            sys.exit("ERROR: Rule D plane has no parseable generated_at — "
                     "refusing to treat an undated snapshot as current")
        if age > RULE_D_PLANE_MAX_AGE_HOURS:
            sys.exit(f"ERROR: Rule D plane is stale ({age:.1f}h > "
                     f"{RULE_D_PLANE_MAX_AGE_HOURS}h) — refusing to silently "
                     "drop Development indexability")
    if raw.get("ssr_authority") != "lib/project-type.js":
        sys.exit("ERROR: annotated plane is not from lib/project-type.js")
    zips = raw.get("zips") or {}
    out = {}
    for z, rec in zips.items():
        if not ZIP_RE.match(str(z)) or not isinstance(rec, dict):
            continue
        if rec.get("held") or rec.get("geography_outcome") == "not_measured":
            out[z] = {"rule_d": False, "count": None, "entities": []}
            continue
        ents = []
        for e in (rec.get("representative_entities") or [])[:RULE_D_MIN]:
            if not isinstance(e, dict):
                continue
            name = str(e.get("name") or "").strip()
            url = safe_url(e.get("source_url"))
            if not name or not url:
                continue
            item = {"title": name, "url": url,
                    "type": str(e.get("type_label") or "").strip(),
                    "lifecycle": str(e.get("lifecycle_label") or "").strip(),
                    "date": "", "key": str(e.get("key") or "")}
            day = str(e.get("date") or "")[:10]
            if re.match(r"^\d{4}-\d{2}-\d{2}$", day):
                item["date"] = day
            ents.append(item)
        count = rec.get("meaningful_entity_count")
        ok = (rec.get("rule_d") is True
              and isinstance(count, int) and count >= RULE_D_MIN
              and len(ents) >= RULE_D_MIN)
        out[z] = {"rule_d": ok, "count": count if isinstance(count, int) else 0,
                  "entities": ents if ok else []}
    if cities_out is not None:
        raw_cities = raw.get("cities")
        if raw_cities is None and required:
            sys.exit("ERROR: Rule D plane has no cities section — refusing to silently "
                     "drop every city page")
        cities_out.update(parse_cities(raw_cities or {}, out))
    if projects_out is not None:
        raw_projects = raw.get("projects")
        if raw_projects is None and required:
            sys.exit("ERROR: Rule D plane has no projects section — refusing to silently "
                     "drop every project page")
        projects_out.update(parse_projects(raw_projects or {},
                                           plane_day=str(raw.get("generated_at") or "")[:10]))
    return out


CITY_KEY_RE = re.compile(r"^([a-z]{2})/([a-z0-9]+(?:-[a-z0-9]+)*)$")
CITY_MIN_RULE_D_ZIPS = 2                     # the producer's bar, re-asserted here
CITY_REP_CAP = 12


def parse_cities(raw_cities, zips_plane):
    """Validate the plane's city section against the ZIP half of the SAME plane.

    The site does not decide which cities exist — the producer does, from the same
    entities Rule D counts. What the site does refuse is an inconsistent plane: a city
    that names a ZIP as a Rule D pass which the ZIP half says is not, is a producer
    defect, and the build fails rather than publishing a page it cannot vouch for.
    """
    cities = {}
    for key, c in sorted(raw_cities.items()):
        m = CITY_KEY_RE.match(str(key))
        if not m or not isinstance(c, dict):
            sys.exit(f"ERROR: malformed city key or record in the plane: {key!r}")
        st, slug = m.group(1).upper(), m.group(2)
        if str(c.get("state") or "") != st or str(c.get("slug") or "") != slug:
            sys.exit(f"ERROR: city {key} state/slug disagree with its key")
        place = str(c.get("place") or "").strip()
        zips = [z for z in (c.get("zips") or []) if ZIP_RE.match(str(z))]
        rule_d_zips = [z for z in (c.get("rule_d_zips") or []) if ZIP_RE.match(str(z))]
        held = [z for z in (c.get("held_zips") or []) if ZIP_RE.match(str(z))]
        n = c.get("meaningful_entity_count")
        if not place or not zips or not isinstance(n, int) or n < 1:
            sys.exit(f"ERROR: city {key} lacks a place, ZIPs or a count")
        if len(rule_d_zips) < CITY_MIN_RULE_D_ZIPS:
            sys.exit(f"ERROR: city {key} has {len(rule_d_zips)} Rule D ZIPs "
                     f"(< {CITY_MIN_RULE_D_ZIPS}) — the producer's bar was not met")
        for z in rule_d_zips:
            if z not in zips or not (zips_plane.get(z) or {}).get("rule_d"):
                sys.exit(f"ERROR: city {key} counts {z} as Rule D but the ZIP plane does not")
        facts_total = c.get("facts_total")
        if facts_total != n:
            sys.exit(f"ERROR: city {key} mix covers {facts_total} projects, count says {n}")
        mixes = {}
        for mk in ("type_mix", "lifecycle_mix"):
            mix = [{"label": str(x.get("label") or "").strip(), "n": x.get("n")}
                   for x in (c.get(mk) or []) if isinstance(x, dict)]
            if not mix or any(not x["label"] or not isinstance(x["n"], int) for x in mix):
                sys.exit(f"ERROR: city {key} has a malformed {mk}")
            if sum(x["n"] for x in mix) != n:
                sys.exit(f"ERROR: city {key} {mk} sums to {sum(x['n'] for x in mix)}, not {n}")
            mixes[mk] = mix
        reps = []
        for e in (c.get("representative_entities") or [])[:CITY_REP_CAP]:
            if not isinstance(e, dict):
                continue
            name = str(e.get("name") or "").strip()
            url = safe_url(e.get("source_url"))
            if not name or not url:
                continue
            day = str(e.get("date") or "")[:10]
            reps.append({"title": name, "url": url,
                         "type": str(e.get("type_label") or "").strip(),
                         "lifecycle": str(e.get("lifecycle_label") or "").strip(),
                         "date": day if re.match(r"^\d{4}-\d{2}-\d{2}$", day) else "",
                         "zip": e.get("zip") if ZIP_RE.match(str(e.get("zip") or "")) else "",
                         "key": str(e.get("key") or "")})
        cities[key] = {"key": key, "state": st, "slug": slug, "place": place, "zips": zips,
                       "rule_d_zips": rule_d_zips, "held_zips": held, "count": n,
                       "type_mix": mixes["type_mix"], "lifecycle_mix": mixes["lifecycle_mix"],
                       "reps": reps}
    return cities


# ---------------------------------------------------------------- project pages (plan step 12)
# Identity is base_project_key = source_key|source_seq (docs/project-identity-audit-2026-09-28.md).
# source_key is what the connector wrote: arcgis:<registry_id>:<case>, or
# <socrata|ckan|carto|csv>:<host>:<dataset>:<case>. The producer reads the case out of it; the
# site only checks the key ends with that case.
# The producer (ingest) decides which projects get a page: FEATURED projects only (a card on a
# Rule D ZIP page or a city page) whose key is durable. The site re-checks the record is
# consistent with its own key and builds the URL; it never decides membership.
PROJECT_KEY_RE = re.compile(r"^(arcgis|socrata|ckan|carto|csv):(.+)\|([0-9]+)$", re.S)
REGISTRY_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PROJECT_PATH_RE = re.compile(r"^/project/[a-z0-9]+(?:-[a-z0-9]+)*/(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?[0-9a-f]{8}/$")
PROJECT_SLUG_MAX = 60
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# The human name of each source's publisher ("City of Austin"), from the connector registry
# the engine reads. A source missing from it is shown by its id, never guessed.
REGISTRY_FILE = os.path.join(os.path.dirname(__file__), "..", "supabase", "functions",
                             "get-address-report", "jurisdiction-registry.json")
_SOURCE_NAMES = {}


def source_name(registry_id):
    if not _SOURCE_NAMES:
        with open(REGISTRY_FILE, encoding="utf-8") as fh:
            reg = json.load(fh)
        for k, v in reg.items():
            if k.startswith("_") or not isinstance(v, list):
                continue
            for e in v:
                if isinstance(e, dict) and e.get("registry_id") and e.get("jurisdiction"):
                    _SOURCE_NAMES[str(e["registry_id"])] = str(e["jurisdiction"]).strip()
        _SOURCE_NAMES.setdefault("", "")
    return _SOURCE_NAMES.get(str(registry_id), "") or str(registry_id)


def project_slug(case):
    """The case number, lower-cased, non-alphanumerics collapsed to '-'. Never the name:
    names drift between copies of one project (audit section 1)."""
    s = unicodedata.normalize("NFKD", str(case or "")).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:PROJECT_SLUG_MAX].strip("-")


def project_path(registry_id, case, key):
    """/project/<registry_id>/<case-slug>-<h8>/. h8 = first 8 hex of sha256(key): two cases
    that slug identically (punctuation only) stay apart."""
    h8 = hashlib.sha256(str(key).encode("utf-8")).hexdigest()[:8]
    slug = project_slug(case)
    return f"/project/{registry_id}/{slug + '-' if slug else ''}{h8}/"


def parse_projects(raw_projects, plane_day=""):
    """Validate the projects section. A record that disagrees with its own key, or two keys
    that would share a URL, is a producer defect: the build fails rather than publishing a
    page nobody can vouch for.

    Kept pages (founder, 2026-09-28): a project keeps its page after it leaves the cards.
    `tracked` is false once it has left HomeSignal's data too; its facts are then the last
    ones seen, on `as_of`. `as_of` is the day the status was read; `changed_on` the day the
    page's facts last changed (the sitemap's lastmod). Both default to the plane's own day,
    so a projects document written before these fields existed builds unchanged."""
    projects, by_path = {}, {}
    for key, r in sorted(raw_projects.items()):
        m = PROJECT_KEY_RE.match(str(key))
        if not m or not isinstance(r, dict):
            sys.exit(f"ERROR: malformed project key or record in the plane: {key!r}")
        reg, case = str(r.get("registry_id") or ""), str(r.get("case") or "")
        if not REGISTRY_ID_RE.match(reg) or not case or not m.group(2).endswith(":" + case):
            sys.exit(f"ERROR: project {key!r} registry_id/case disagree with its key")
        name = str(r.get("name") or "").strip()
        url = safe_url(r.get("source_url"))
        zips = [z for z in (r.get("zips") or []) if ZIP_RE.match(str(z))]
        life = str(r.get("lifecycle_label") or "").strip()
        if not name or not url or not zips or not life:
            sys.exit(f"ERROR: project {key!r} lacks a name, an official record, a ZIP or a "
                     "lifecycle label")
        if len(zips) != len(r.get("zips") or []):
            sys.exit(f"ERROR: project {key!r} carries a malformed ZIP")
        day = str(r.get("date") or "")[:10]
        tracked = r.get("tracked", True)
        if not isinstance(tracked, bool):
            sys.exit(f"ERROR: project {key!r} has a non-boolean tracked flag")
        as_of = str(r.get("as_of") or plane_day)[:10]
        changed_on = str(r.get("changed_on") or as_of)[:10]
        for label, v in (("as_of", as_of), ("changed_on", changed_on)):
            if v and not DAY_RE.match(v):
                sys.exit(f"ERROR: project {key!r} has a malformed {label} {v!r}")
        path = project_path(reg, case, key)
        if not PROJECT_PATH_RE.match(path):
            sys.exit(f"ERROR: project {key!r} built an unsafe path {path!r}")
        if path in by_path:
            sys.exit(f"ERROR: projects {by_path[path]!r} and {key!r} share the URL {path}")
        by_path[path] = key
        projects[key] = {
            "key": key, "path": path, "registry_id": reg, "case": case, "title": name,
            "url": url, "zips": zips,
            "type": str(r.get("type_label") or "").strip(), "lifecycle": life,
            "date": day if re.match(r"^\d{4}-\d{2}-\d{2}$", day) else "",
            "date_kind": str(r.get("date_kind") or "").strip(),
            "held": r.get("held") is True,
            "address": str(r.get("address") or "").strip(),
            "tracked": tracked, "as_of": as_of, "changed_on": changed_on,
            "source": source_name(reg),
        }
    return projects


def link_projects(pages, cities, projects):
    """Point each ZIP and city card at its project page, list every project page on its ZIP
    pages' project lists, and prove every project page is linked from a page this build
    writes. Kept pages (a project that has left the cards) are linked from those lists
    only, so a page never loses its last inbound link when a newer project takes its card."""
    inbound = set()
    for p in pages.values():
        for it in p.get("dev_entities") or []:
            pr = projects.get(it.get("key"))
            if pr:
                it["project"] = pr["path"]
                inbound.add(pr["key"])
    for c in cities.values():
        for it in c["reps"]:
            pr = projects.get(it.get("key"))
            if pr:
                it["project"] = pr["path"]
                inbound.add(pr["key"])
    from_cards = len(inbound)
    for k, pr in projects.items():
        for z in pr["zips"]:
            if z in pages:
                pages[z].setdefault("project_list", []).append(k)
                inbound.add(k)
    orphans = [k for k, pr in projects.items() if not pr["held"] and k not in inbound]
    if orphans:
        sys.exit(f"ERROR: {len(orphans)} project page(s) would have no link from any ZIP or city "
                 f"page, e.g. {orphans[:3]} — the plane and its pages disagree")
    return from_cards


def assemble(d, now_iso):
    """zip -> {name, state, county, dev_indexable, ln[], gn[], um[], counts, rule_f, rule_d}."""
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
                        if (m.get("meeting_date") or "") >= meeting_cutoff(now_iso))
        rows.sort(key=lambda m: (m.get("meeting_date") or "", str(m.get("id"))))
        pl = places_of(c)
        keep = []
        for m in rows[:24]:                      # the page's own .limit(24)
            city = CITY_RE.match(m.get("category") or "")
            if city and city.group(1).strip().lower() not in pl:
                continue                          # another town's council — not this ZIP's
            keep.append(m)
        return keep[:UM_CAP]                      # the page's own .slice(0, 12)

    plane = d.get("_dev_plane") or {}
    pages = {}
    for z in zips:
        mt = meta.get(z, {})
        rec = plane.get(z) or {}
        pages[z] = {"zip": z, "name": mt.get("name") or z, "state": mt.get("state") or "",
                    "county": mt.get("county") or "", "dev_indexable": bool(mt.get("indexable")),
                    "ln": [], "gn": [], "um": [],
                    "rule_d": bool(rec.get("rule_d")),
                    "rule_d_count": rec.get("count") if rec.get("count") is not None else 0,
                    "dev_entities": list(rec.get("entities") or [])}
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
    link_siblings(pages)
    return pages


def link_siblings(pages):
    """Give every ZIP page a deterministic set of in-county sibling links.

    THE PROBLEM THIS SOLVES: every one of the ~12,722 generated documents was an
    ORPHAN. Measured before this change - 78617 and 01002 each carried ZERO links to
    another /community/ page, and the only anchors in the initial HTML were outbound
    rel="nofollow" source records. A corpus that large, reachable only by sitemap, is
    the classic way a site never gets fully crawled: a sitemap is a hint, an internal
    link is the actual crawl path, and orphan pages are routinely left unindexed.

    IT IS A RING, NOT A "TOP N", AND THAT IS THE WHOLE POINT. Listing the first N ZIPs
    of each county would make those N hubs and leave every other ZIP exactly as
    orphaned as before - the same defect, wearing a fix. Sorting the county's ZIPs and
    giving each one the NEXT SIB_CAP entries with wraparound makes the county a single
    strongly-connected cycle, so every page has in-degree >= 1 and a crawler entering
    anywhere reaches all of it.

    Grouped on (state, county) rather than county alone: county names repeat across
    states (Benton, Washington, Montgomery), and merging them would link residents to
    another state's pages - the same wrong-geography error the ingest side keeps
    hitting. A ZIP whose meta carries no county gets NO siblings: absent stays absent,
    never guessed.

    Deterministic by construction (sorted input, positional slice), because the build
    is asserted byte-identical across two runs.
    """
    groups = {}
    for z, p in pages.items():
        if p["county"] and p["state"]:
            groups.setdefault((p["state"], p["county"]), []).append(z)
    for zs in groups.values():
        zs.sort()
        n = len(zs)
        for i, z in enumerate(zs):
            ring = [zs[(i + k) % n] for k in range(1, min(SIB_CAP, n - 1) + 1)]
            pages[z]["siblings"] = [{"zip": s, "name": pages[s]["name"]} for s in ring]


# ---------------------------------------------------------------- render
def _card_title(it, t, u):
    """A card with a project page links its name there (a real, crawlable link); the
    official record stays one click away beside it. Without a page, the name links to the
    record, as before."""
    if it.get("project"):
        return f'<a href="{esc(it["project"])}">{t}</a>'
    return f'<a href="{esc(u)}" rel="nofollow noopener">{t}</a>'


def _card_source(it, u):
    if it.get("project"):
        return f' <a href="{esc(u)}" rel="nofollow noopener">official record</a>'
    return ""


def _dev_items(items):
    """Rule D cards. Omitted entirely when the plane did not qualify the ZIP —
    this function never invents an absence sentence."""
    if not items:
        return ""
    li = []
    for it in items:
        t, u = esc(it.get("title") or ""), safe_url(it.get("url"))
        if not t or not u:
            continue
        bits = [x for x in (it.get("type"), it.get("lifecycle")) if x]
        when = esc(it.get("date") or "")
        inner = _card_title(it, t, u)
        if bits:
            inner += f' <span class="quiet">{esc(" · ".join(bits))}</span>'
        if when:
            inner += f" <time>{when}</time>"
        inner += _card_source(it, u)
        li.append(f"<li>{inner}</li>")
    if not li:
        return ""
    return f'<section class="zsec"><h2>Development</h2><ul>' + "".join(li) + "</ul></section>"


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


OG_IMAGE = f"{BASE}/og-default.png"
# ONE stylesheet tag for every generated page type (ZIP and city), so its cache key is
# written once and test/lib-cache-keys.test.mjs keeps seeing exactly one generator tag.
APP_CSS_LINK = '<link rel="stylesheet" href="/app.css?v=16c0ab06">\n'


def coverage_panel(p):
    """The coverage panel for a ZIP with no Census-drawn area. Same words as shell.js
    HS.zipCoveragePanelHTML (both read lib/zip-coverage.json's copy); test/zip-coverage.test.mjs
    fails if the two ever differ. No count, no '0 projects', no empty-search sentence."""
    cov, z = p["coverage"], p["zip"]
    c = cov["copy"]
    # The nearby link is absolute on purpose: the document sets <base href="/">, so a bare
    # "#zip-nearby" would resolve to the HOME page and leave this one.
    sub = lambda t: t.replace("{zip}", z)
    return (f'<section class="zcov" id="hs-zip-coverage" data-zip-coverage="{esc(cov["mode"])}" data-zip="{esc(z)}">'
            f'<h2>{esc(sub(c["title"]))}</h2>'
            + "".join(f'<p style="margin:10px 0 0">{esc(sub(t))}</p>' for t in c["body"])
            + f'<p class="zcov-cta"><a class="inlinebtn" id="zcovAddress" href="/?near={esc(z)}#homeSearch">{esc(c["primary_cta"])}</a> '
              f'<a class="inlinebtn" id="zcovNearby" href="/community/{esc(z)}/#zip-nearby">{esc(c["secondary_cta"])}</a></p></section>')


def render(p, built):
    z, name, st = p["zip"], p["name"], p["state"]
    label = f"{name}, {st}" if st else name
    if p["rule_f"]:
        title = f"{label} — local government notices, meetings & news | HomeSignal"
        desc = (f"Government notices, upcoming public meetings and local news for ZIP {z} "
                f"({label}): {p['n_gn']} notices, {p['n_um']} upcoming meetings, "
                f"{p['n_ln_journalism']} local news items on record.")
    elif p.get("rule_d"):
        title = f"{label} — development records | HomeSignal"
        desc = (f"Development records on file for ZIP {z} ({label}): "
                f"{p.get('rule_d_count') or len(p.get('dev_entities') or [])} "
                f"distinct projects compiled from official sources.")
    else:
        title = f"{label} — local government notices, meetings & news | HomeSignal"
        desc = (f"HomeSignal tracks government notices, public meetings and local news for "
                f"ZIP {z} ({label}). No qualifying records on file yet — checks repeat "
                f"automatically.")
    robots = "index, follow" if (p["rule_f"] or p.get("rule_d")) else "noindex, follow"
    canon = f"{BASE}/community/{z}/"
    ln_show = [x for x in p["ln"] if not x["weather"]][:LN_CAP]
    wx = [x for x in p["ln"] if x["weather"]][:3]
    um_show = p["um"][:UM_CAP]
    um_items = [{"title": m.get("title"), "url": m.get("source_url"),
                 "date": (m.get("meeting_date") or "")[:10]} for m in um_show]

    county_bit = f" in {esc(p['county'])} County" if p["county"] else ""
    lead = ("Development records, government notices, public meetings and local news"
            if p.get("rule_d") else
            "Government notices, public meetings and local news")
    cov = p.get("coverage")
    if cov:
        # A ZIP with no Census-drawn area (lib/zip-coverage.json). Title and description are the
        # founder's patterns; robots stays the usual Rule F decision (never noindex merely for
        # lacking a ZCTA). Nothing here claims a ZIP-wide map, a ZIP-wide count or a ZIP-wide
        # search: the records below are what the governments and publishers that cover this ZIP
        # have posted, and the panel says what this page cannot show.
        title = cov["copy"]["page_title"].replace("{zip}", z)
        desc = cov["copy"]["meta_description"].replace("{zip}", z)
        lead = ("Government notices, public meetings and local news from the governments and "
                "publishers that cover")
    # Usable links in the INITIAL HTML (Step 12). Internal, crawlable, no JavaScript: the
    # ZIP's own development/map page and the site root. Deliberately NOT the legacy
    # community.html?zip= URL — that page canonicalises here, so linking to it from here
    # would re-create the duplicate-identity ambiguity this unit removes.
    links = (f'<nav class="zsec"><a href="/homesignalmap.html?zip={esc(z)}">'
             f'Development &amp; permits map for {esc(z)}</a> · '
             f'<a href="/">HomeSignal home</a> · '
             f'<a href="/how-it-works.html">How HomeSignal works</a></nav>')
    if cov:
        # No ZIP map exists for this ZIP, so no link to one; the address search is the way in.
        links = (f'<nav class="zsec"><a href="/?near={esc(z)}#homeSearch">Search an address near {esc(z)}</a> · '
                 f'<a href="/">HomeSignal home</a> · '
                 f'<a href="/how-it-works.html">How HomeSignal works</a></nav>')
    # The sibling block goes AFTER that nav and carries a DIFFERENT class, deliberately.
    # scripts/prove-zip-pages-live.mjs scrapes `<nav class="zsec">[\s\S]*?</nav>` and takes
    # the FIRST match to assert the page's usable internal links; a second zsec nav placed
    # above would steal that match and redden the daily production monitor. And
    # `<section class="zsec"><h2>` is how the control classifier counts real content
    # sections - reusing it here would let an empty Alerts page satisfy that proof
    # vacuously, weakening a check rather than adding one.
    sibs = p.get("siblings") or []
    if sibs:
        where = f"{esc(p['county'])} County, {esc(st)}" if st else f"{esc(p['county'])} County"
        items = "".join(f'<li><a href="/community/{esc(s["zip"])}/">{esc(s["name"])}</a></li>'
                        for s in sibs)
        nearby_id = ' id="zip-nearby"' if cov else ""
        links += (f'<nav class="zsib"{nearby_id} aria-label="More ZIP codes in this county">'
                  f'<h2>More ZIP codes in {where}</h2><ul>{items}</ul></nav>')
    elif cov:
        # The panel's "Search nearby ZIPs" link needs somewhere to land even when the county
        # offers no sibling ZIP.
        links += ('<nav class="zsib" id="zip-nearby" aria-label="Search nearby ZIPs">'
                  '<h2>Search nearby ZIPs</h2><p><a href="/#homeSearch">Search another ZIP code or an address</a></p></nav>')
    # UP to the city page (SEO plan step 10: City -> ZIP -> Project). Only a city page
    # that exists is linked; its own class, for the same reason as zsib above.
    cts = p.get("cities") or []
    if cts:
        items = "".join(
            f'<li><a href="{esc(city_path(c))}">Development across {esc(c["place"])}, '
            f'{esc(c["state"])}</a> <span class="quiet">{c["count"]} projects in '
            f'{len(c["zips"])} ZIP codes</span></li>' for c in cts)
        links += (f'<nav class="zcity" aria-label="City development pages">'
                  f'<h2>City development</h2><ul>{items}</ul></nav>')
    # Every project page on this ZIP, including ones that have left the cards above. Its
    # own class: the first `zsec` nav is the one prove-zip-pages-live.mjs reads.
    npl = len(p.get("project_list") or [])
    if npl:
        links += (f'<nav class="zproj" aria-label="Projects on record"><a href="'
                  f'{project_list_path(z)}">All {npl} project{"s" if npl != 1 else ""} on record '
                  f'in {esc(z)}</a></nav>')
    body = (
        f'<main id="hs-ssr"><header><p class="eyebrow">Activity</p>'
        f'<h1>{esc(z)} · {esc(label)}</h1>'
        + (f'<p>{lead} ZIP {esc(z)}{county_bit}.</p></header>' + coverage_panel(p)
           if cov else
           f'<p>{lead} that apply to the whole of '
           f'ZIP {esc(z)}{county_bit}.</p></header>')
        + ("" if cov else _dev_items(p.get("dev_entities") or []))
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
        # SHARING. The homepage carried Open Graph tags and the generated ZIP documents did
        # not, so every link a resident pasted into Messages, Slack, Facebook or LinkedIn
        # rendered bare — on the 8,180 pages the whole service is meant to spread through.
        # og:image is ABSOLUTE because social crawlers do not resolve relative URLs (and do
        # not read <base>); it is same-origin, so the document's own img-src 'self' is
        # unaffected. og:type is "website", not "article": these documents are standing
        # per-ZIP pages that are rewritten every build, not dated posts.
        f'<meta property="og:type" content="website">\n'
        f'<meta property="og:site_name" content="HomeSignal">\n'
        f'<meta property="og:locale" content="en_US">\n'
        f'<meta property="og:title" content="{esc(title)}">\n'
        f'<meta property="og:description" content="{esc(desc)}">\n'
        f'<meta property="og:url" content="{esc(canon)}">\n'
        f'<meta property="og:image" content="{esc(OG_IMAGE)}">\n'
        f'<meta name="twitter:card" content="summary_large_image">\n'
        f'<meta name="twitter:title" content="{esc(title)}">\n'
        f'<meta name="twitter:description" content="{esc(desc)}">\n'
        f'<meta name="twitter:image" content="{esc(OG_IMAGE)}">\n'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; base-uri \'self\'; '
        "object-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' "
        'https://qwnnmljucajnexpxdgxr.supabase.co wss://qwnnmljucajnexpxdgxr.supabase.co; '
        # frame-src/child-src 'self': the ZIP page's map is a same-origin iframe of
        # homesignalmap.html, shown to every visitor since 2026-10-02 (it was signed-in
        # only before). lib/map.js and the Esri/jsDelivr widening PCM-4 added are both gone.
        'frame-src \'self\'; child-src \'self\'; '
        'form-action \'self\'">\n'
        + APP_CSS_LINK + '</head>\n'
        # data-nav="explore": this document loads the shared shell, and the public ZIP page
        # is an Explore child (founder navigation plan v3), the same identity community.html
        # declares. The city/project/project-list/guide families below carry no shell.
        # data-explore="activity": it is the Activity page in the Explore dropdown, as
        # community.html is (founder, 2026-10-02).
        f'<body data-nav="explore" data-zip="{esc(z)}" data-explore="activity">\n{body}\n'
        '<template id="hs-content"><div class="page" id="commPage"></div></template>\n'
        '<script src="/config.js"></script>\n<script src="/seed/delvalle.js"></script>\n'
        '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n'
        # zip-authoritative.js is the CANONICAL OWNER of ZIP geography semantics and this
        # document is its second consumer: lib/data.js::rpcAllRows classifies
        # app_projects_for_zip's {unavailable, zip_geography_status} envelope through
        # HS.zipAuthOutcome, and the Development section renders HS.zipAuthUnmeasuredFact
        # instead of an absence sentence. Same parity rule as gov-notice-copy.js below —
        # both hosts run ONE runtime, so a dependency added to community.html alone breaks
        # this one. Fails CLOSED if absent (outcome 'unavailable', no absence claim).
        '<script src="/lib/zip-authoritative.js?v=20261002a"></script>\n'
        '<script src="/lib/data.js"></script>\n<script src="/lib/topic-prefs.js"></script>\n'
        '<script src="/lib/templates.js?v=49ae3c36"></script>\n<script src="/lib/impact.js"></script>\n'
        # lib/project-type.js: the canonical Development Type (pure — no DOM, no map runtime).
        # The Development & Growth Type badge reads HS.canonicalProjectType from it. Same parity
        # rule as the files around it: both hosts run ONE runtime. lib/map.js stays OFF (§5a).
        '<script src="/lib/project-type.js?v=108e00a6"></script>\n'
        # gov-notice-copy.js MUST load before community-page.js: the shared runtime calls
        # HS.govNoticeCopy.build() for a ZIP with no notices, and this document is the other
        # host of that same runtime. It was added to community.html alone, so every generated
        # page threw "Cannot read properties of undefined (reading 'build')" the moment a
        # sampled ZIP had zero notices - which is what turned the Pages build gate red
        # (run 33929420398, ZIPs 01001 and 01002). Parity with community.html is asserted by
        # test/zip-page-shared-runtime.test.mjs so the next shared dependency cannot ship to
        # one host only.
        '<script src="/lib/premium-waitlist.js?v=02c305ee"></script>\n'
        '<script src="/lib/community-request.js?v=e1d9c7d7"></script>\n'
        '<script src="/shell.js?v=c6b8d60b"></script>\n'
        '<script src="/lib/gov-notice-copy.js"></script>\n'
        '<script src="/lib/community-page.js?v=67435c86"></script>\n'
        "</body>\n</html>\n")


# ---------------------------------------------------------------- city pages (plan step 9)
def city_path(c):
    return f"/city/{c['state'].lower()}/{c['slug']}/"


def link_cities(pages, cities):
    """Attach each city page to the ZIP pages it groups (the ZIP -> city up-link)."""
    for key in sorted(cities):
        c = cities[key]
        for z in c["zips"]:
            if z in pages:
                pages[z].setdefault("cities", []).append(c)


def _mix(items, heading):
    li = "".join(f"<li>{esc(x['label'])} <span class=\"quiet\">{x['n']}</span></li>"
                 for x in items)
    return f'<section class="zsec"><h2>{esc(heading)}</h2><ul>{li}</ul></section>'


def render_city(c, pages, built):
    """One city Development page. Static HTML, no scripts: everything it says is in the
    plane, and every project links to its official source record."""
    place, st, n = c["place"], c["state"], c["count"]
    label = f"{place}, {st}"
    nz = len(c["zips"])
    # A held ZIP (boundary not yet measured) is named on the page but never counted, so
    # the sentences say how many ZIP codes the count actually covers.
    counted = nz - len([z for z in c["held_zips"] if z in c["zips"]])
    across = (f"the {nz} ZIP codes named {place}" if counted == nz else
              f"{counted} of the {nz} ZIP codes named {place}")
    top = ", ".join(f"{x['label'].lower()} {x['n']}" for x in c["type_mix"][:3])
    title = f"Development in {label} — {n} projects on record | HomeSignal"
    desc = (f"{n} development projects on file across {counted} ZIP codes in {label}, "
            f"compiled from official records ({top}).")
    canon = f"{BASE}{city_path(c)}"
    reps = []
    for it in c["reps"]:
        bits = [x for x in (it.get("type"), it.get("lifecycle")) if x]
        inner = _card_title(it, esc(it["title"]), it["url"])
        if bits:
            inner += f' <span class="quiet">{esc(" · ".join(bits))}</span>'
        if it.get("date"):
            inner += f' <time>{esc(it["date"])}</time>'
        inner += _card_source(it, it["url"])
        if it.get("zip") and it["zip"] in pages:
            inner += f' <a href="/community/{esc(it["zip"])}/">ZIP {esc(it["zip"])}</a>'
        reps.append(f"<li>{inner}</li>")
    zli = []
    for z in c["zips"]:
        pg = pages.get(z)
        if not pg:
            continue
        note = ""
        if z in c["held_zips"]:
            note = ' <span class="quiet">not yet measured — not counted</span>'
        elif pg.get("rule_d"):
            note = f' <span class="quiet">{pg.get("rule_d_count")} projects</span>'
        zli.append(f'<li><a href="/community/{esc(z)}/">{esc(pg["name"])}</a>{note}</li>')
    body = (
        f'<main id="hs-ssr"><header><p class="eyebrow"><a href="/">HomeSignal</a> · '
        f'City development</p>'
        f'<h1>Development in {esc(label)}</h1>'
        f'<p>{n} distinct development projects on file across {esc(across)}. A project '
        f'that appears in more than one of these ZIP codes is counted once.</p></header>'
        + _mix(c["type_mix"], "Project types")
        + _mix(c["lifecycle_mix"], "Where projects stand")
        + (f'<section class="zsec"><h2>Recent projects</h2><ul>{"".join(reps)}</ul></section>'
           if reps else "")
        + f'<nav class="zsib" aria-label="ZIP codes in {esc(place)}">'
          f'<h2>ZIP codes in {esc(label)}</h2><ul>{"".join(zli)}</ul></nav>'
        + f'<p class="quiet">ZIP codes are grouped by the place name on their HomeSignal '
          f'page, which follows the postal name and can differ from city limits. Compiled '
          f'from official public records on <time datetime="{esc(built)}">{esc(built)}</time>. '
          f'Every project links to its source record; nothing on this page is generated '
          f'or inferred.</p>'
        + '<nav class="zsec"><a href="/">HomeSignal home</a> · '
          '<a href="/how-it-works.html">How HomeSignal works</a> · '
          f'<a href="{GUIDE_WHAT}">What is being built near me?</a></nav>'
        + '</main>')
    return (
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
        '<meta charset="UTF-8">\n<base href="/">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        '<meta name="robots" content="index, follow">\n'
        f"<title>{esc(title)}</title>\n"
        f'<meta name="description" content="{esc(desc)}">\n'
        f'<link rel="canonical" href="{esc(canon)}">\n'
        f'<meta property="og:type" content="website">\n'
        f'<meta property="og:site_name" content="HomeSignal">\n'
        f'<meta property="og:locale" content="en_US">\n'
        f'<meta property="og:title" content="{esc(title)}">\n'
        f'<meta property="og:description" content="{esc(desc)}">\n'
        f'<meta property="og:url" content="{esc(canon)}">\n'
        f'<meta property="og:image" content="{esc(OG_IMAGE)}">\n'
        f'<meta name="twitter:card" content="summary_large_image">\n'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; '
        "base-uri 'self'; object-src 'none'; img-src 'self' data:; font-src 'self'; "
        "style-src 'self' 'unsafe-inline'; script-src 'none'; form-action 'self'\">\n"
        + APP_CSS_LINK + '</head>\n'
        f'<body data-nav="city">\n{body}\n</body>\n</html>\n')


def build_cities(cities, pages, out_dir, built):
    written = 0
    for key in sorted(cities):
        c = cities[key]
        if not CITY_KEY_RE.match(key):
            sys.exit(f"ERROR: city key refused: {key!r}")
        missing = [z for z in c["zips"] if z not in pages]
        if missing:
            sys.exit(f"ERROR: city {key} names non-canonical ZIPs {missing[:5]}")
        d = os.path.join(out_dir, "city", c["state"].lower(), c["slug"])
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "wb").write(render_city(c, pages, built).encode("utf-8"))
        written += 1
    return written


def _head(title, desc, canon, og_type="website", robots="index, follow", ld=None):
    return (
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
        '<meta charset="UTF-8">\n<base href="/">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        f'<meta name="robots" content="{robots}">\n'
        f"<title>{esc(title)}</title>\n"
        f'<meta name="description" content="{esc(desc)}">\n'
        f'<link rel="canonical" href="{esc(canon)}">\n'
        f'<meta property="og:type" content="{og_type}">\n'
        f'<meta property="og:site_name" content="HomeSignal">\n'
        f'<meta property="og:locale" content="en_US">\n'
        f'<meta property="og:title" content="{esc(title)}">\n'
        f'<meta property="og:description" content="{esc(desc)}">\n'
        f'<meta property="og:url" content="{esc(canon)}">\n'
        f'<meta property="og:image" content="{esc(OG_IMAGE)}">\n'
        f'<meta name="twitter:card" content="summary_large_image">\n'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; '
        "base-uri 'self'; object-src 'none'; img-src 'self' data:; font-src 'self'; "
        "style-src 'self' 'unsafe-inline'; script-src 'none'; form-action 'self'\">\n"
        + (_ld_json(ld) if ld else "")
        + APP_CSS_LINK + '</head>\n')


def _ld_json(obj):
    """Structured data for search engines. A JSON data block is never executed, so the
    page still ships no script (CSP script-src 'none' stays). '<' is escaped so no value
    can close the element."""
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    body = body.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return f'<script type="application/ld+json">{body}</script>\n'


MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def human_day(day):
    """2026-09-28 -> Sep 28, 2026. Anything else is returned unchanged."""
    if not DAY_RE.match(str(day or "")):
        return str(day or "")
    y, m, d = day.split("-")
    return f"{MONTHS[int(m) - 1]} {int(d)}, {y}"


def project_list_path(z):
    return f"/community/{z}/projects/"


RELATED_CAP = 6


def related_projects(pr, pages, projects, cap=RELATED_CAP):
    """Other project pages on the same ZIP page(s), for "More projects in ...". ZIP
    membership is the site's geography (never a distance: the project data carries no
    coordinates, and generated pages make no distance claim). Tracked projects first, then
    newest date on record, then key, so the list is deterministic."""
    seen, out = {pr["key"]}, []
    for z in pr["zips"]:
        for k in (pages.get(z) or {}).get("project_list") or []:
            if k in seen or k not in projects:
                continue
            seen.add(k)
            out.append(projects[k])
    out.sort(key=lambda o: o["key"])
    out.sort(key=lambda o: o["date"], reverse=True)
    out.sort(key=lambda o: 0 if o["tracked"] else 1)
    return out[:cap], len(out)


def render_project(pr, pages, built, projects=None):
    """One project page. Static HTML; its only script element is inert structured data.
    Everything it states is in the plane: the source's own name, address, record number,
    date and status, labelled by lib/project-type.js, and the official record it came from.
    Location is the ZIP pages the project is on. `as_of` is the day the status was read;
    a project HomeSignal no longer tracks says so, and shows the last status it had."""
    zips = [z for z in pr["zips"] if z in pages]
    first = pages[zips[0]]
    where = f"{first['name']}, {first['state']}" if first.get("state") else first["name"]
    kind = pr["type"] or "Development project"
    year = pr["date"][:4] if pr["date"] else ""
    addr = pr["address"]
    named = pr["title"]
    if addr and addr.lower() not in named.lower():
        named = f"{named}, {addr}"
    title = f"{named} — {kind} in {where}" + (f" ({year})" if year else "") + " | HomeSignal"
    when = f" Date on record: {pr['date']}" + (f" ({pr['date_kind']})" if pr["date_kind"] else "") \
        + "." if pr["date"] else ""
    at = f" at {addr}" if addr else ""
    status_word = "last recorded as" if not pr["tracked"] else ""
    desc = (f"{pr['title']}: {kind.lower()}{at} in {where}, "
            f"{(status_word + ' ') if status_word else ''}{pr['lifecycle'].lower()}.{when} "
            f"Linked to its source record.")
    canon = f"{BASE}{pr['path']}"
    as_of = human_day(pr["as_of"])
    as_of_el = (f'<time datetime="{esc(pr["as_of"])}">{esc(as_of)}</time>' if pr["as_of"] else "")
    facts = []
    if addr:
        facts.append(("Address", esc(addr)))
    if pr["type"]:
        facts.append(("Type", esc(pr["type"])))
    facts.append(("Where it stands" if pr["tracked"] else "Last recorded status",
                  esc(pr["lifecycle"])))
    if as_of_el:
        facts.append(("Status as of" if pr["tracked"] else "Last seen", as_of_el))
    if pr["date"]:
        d = f'<time datetime="{esc(pr["date"])}">{esc(pr["date"])}</time>'
        if pr["date_kind"]:
            d += f' <span class="quiet">({esc(pr["date_kind"])})</span>'
        facts.append(("Date on record", d))
    facts.append(("Record number", esc(pr["case"])))
    src_id = (f' <span class="quiet">({esc(pr["registry_id"])})</span>'
              if pr["source"] != pr["registry_id"] else "")
    facts.append(("Source", esc(pr["source"]) + src_id))
    facts.append(("Official record",
                  f'<a href="{esc(pr["url"])}" rel="nofollow noopener">View the source record</a>'))
    dl = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in facts)
    zli = "".join(f'<li><a href="/community/{esc(z)}/">{esc(pages[z]["name"])}</a></li>'
                  for z in zips)
    seen, cli, city_crumb = set(), [], None
    for z in zips:
        for c in pages[z].get("cities") or []:
            if c["key"] in seen:
                continue
            seen.add(c["key"])
            if city_crumb is None:
                city_crumb = (f'{c["place"]}, {c["state"]}', city_path(c))
            cli.append(f'<a href="{city_path(c)}">Development across '
                       f'{esc(c["place"])}, {esc(c["state"])}</a>')
    city_nav = (f'<nav class="zcity" aria-label="City development">{" · ".join(cli)}</nav>'
                if cli else "")
    # Home > City > ZIP > Project, the same path the page's own links follow.
    crumbs = [("HomeSignal", "/")]
    if city_crumb:
        crumbs.append(city_crumb)
    crumbs.append((first["name"], f"/community/{zips[0]}/"))
    crumbs.append((pr["title"], pr["path"]))
    ld = {"@context": "https://schema.org", "@type": "BreadcrumbList",
          "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n,
                               "item": f"{BASE}{u}"} for i, (n, u) in enumerate(crumbs)]}
    crumb_nav = ('<nav class="zcrumb" aria-label="Breadcrumb">'
                 + " › ".join(f'<a href="{esc(u)}">{esc(n)}</a>' for n, u in crumbs[:-1])
                 + '</nav>')
    status_line = f'<p>{esc(kind)} · {esc(pr["lifecycle"])}' + (
        f' <span class="quiet">as of {as_of_el}</span>' if (as_of_el and pr["tracked"]) else "") + '</p>'
    notice = ""
    if not pr["tracked"]:
        # Inline style: app.css is shared and frozen ("do not restyle"); the page CSP allows
        # inline styles. The notice must read as a status change, not as body text.
        notice = (f'<p class="notice" role="note" style="border-left:4px solid #b45309;'
                  f'background:#fff7ed;padding:12px 14px;margin:14px 0">'
                  f'HomeSignal no longer tracks this project. '
                  f'Its last recorded status was <strong>{esc(pr["lifecycle"])}</strong>'
                  + (f', as of {as_of_el}' if as_of_el else "")
                  + f'. <a href="{esc(pr["url"])}" rel="nofollow noopener">Check the official '
                    f'record</a> for its current status.</p>')
    src = esc(pr["source"])
    footer = (f'Status as of {as_of_el}, from {src}\'s public records. ' if pr["tracked"] and as_of_el
              else f'Last seen in {src}\'s public records on {as_of_el}. ' if as_of_el else "")
    body = (
        f'<main id="hs-ssr">{crumb_nav}<header><p class="eyebrow"><a href="/">HomeSignal</a> · '
        f'Development project</p>'
        f'<h1>{esc(pr["title"])}</h1>'
        + (f'<p class="addr">{esc(addr)}, {esc(where)}</p>' if addr else "")
        + status_line + '</header>'
        + notice
        + f'<section class="zsec"><h2>On the record</h2><dl>{dl}</dl></section>'
        f'<section class="zsec"><h2>Where it is</h2>'
        f'<p>On the HomeSignal page for {"these ZIP codes" if len(zips) > 1 else "this ZIP code"}:</p>'
        f'<ul>{zli}</ul>'
        f'<p><a href="/homesignalmap.html?zip={esc(zips[0])}">See it on the Development map</a></p>'
        f'</section>'
        + _related_section(pr, zips, first, pages, projects)
        + city_nav
        + f'<p class="quiet">{footer}The name, address, record number, date '
          f'and status are the source\'s own; nothing on this page is generated or inferred.</p>'
        + '<nav class="zsec"><a href="/">HomeSignal home</a> · '
          '<a href="/how-it-works.html">How HomeSignal works</a> · '
          f'<a href="{GUIDE_CHECK}">How to check proposed development near a house</a></nav>'
        + '</main>')
    return (_head(title, desc, canon, og_type="article", ld=ld)
            + f'<body data-nav="project">\n{body}\n</body>\n</html>\n')


def _related_section(pr, zips, first, pages, projects):
    if not projects:
        return ""
    rel, total = related_projects(pr, pages, projects)
    if not rel:
        return ""
    where = esc(first["name"]) if len(zips) == 1 else "these ZIP codes"
    li = []
    for o in rel:
        bits = [x for x in (o["type"], o["lifecycle"]) if x]
        inner = f'<a href="{esc(o["path"])}">{esc(o["title"])}</a>'
        if o["address"]:
            inner += f' <span class="addr">{esc(o["address"])}</span>'
        if bits:
            inner += f' <span class="quiet">{esc(" · ".join(bits))}</span>'
        if o["date"]:
            inner += f' <time datetime="{esc(o["date"])}">{esc(o["date"])}</time>'
        if not o["tracked"]:
            inner += ' <span class="quiet">(no longer tracked)</span>'
        li.append(f"<li>{inner}</li>")
    more = ""
    if total > len(rel):
        more = (f'<p><a href="{project_list_path(zips[0])}">All {total + 1} projects on record '
                f'in {esc(zips[0])}</a></p>') if len(zips) == 1 else (
               "<p>" + " · ".join(f'<a href="{project_list_path(z)}">All projects on record in '
                                   f'{esc(z)}</a>' for z in zips) + "</p>")
    return (f'<section class="zsec"><h2>More projects in {where}</h2><ul>{"".join(li)}</ul>'
            f'{more}</section>')


def render_project_list(z, keys, projects, pages):
    """Every project page on one ZIP, newest first. It exists so a project that has left
    the ZIP page's cards keeps a link; it is a list, not content, so it is not indexed
    (noindex, follow) and is not in any sitemap."""
    p = pages[z]
    label = f"{p['name']}, {p['state']}" if p.get("state") else p["name"]
    rows = sorted((projects[k] for k in keys), key=lambda pr: (pr["date"], pr["key"]), reverse=True)
    li = []
    for pr in rows:
        bits = [x for x in (pr["type"], pr["lifecycle"]) if x]
        inner = f'<a href="{esc(pr["path"])}">{esc(pr["title"])}</a>'
        if pr["address"]:
            inner += f' <span class="addr">{esc(pr["address"])}</span>'
        if bits:
            inner += f' <span class="quiet">{esc(" · ".join(bits))}</span>'
        if pr["date"]:
            inner += f' <time datetime="{esc(pr["date"])}">{esc(pr["date"])}</time>'
        if not pr["tracked"]:
            inner += ' <span class="quiet">(no longer tracked)</span>'
        li.append(f"<li>{inner}</li>")
    title = f"Development projects on record in {z} · {label} | HomeSignal"
    desc = (f"Every development project HomeSignal has a page for in ZIP {z} ({label}), "
            f"newest first, each linked to its official record.")
    body = (f'<main id="hs-ssr"><header><p class="eyebrow"><a href="/">HomeSignal</a> · '
            f'<a href="/community/{esc(z)}/">{esc(z)}</a></p>'
            f'<h1>Development projects on record in {esc(z)} · {esc(label)}</h1>'
            f'<p>{len(rows)} project{"s" if len(rows) != 1 else ""}, newest first.</p></header>'
            f'<section class="zsec"><ul>{"".join(li)}</ul></section>'
            f'<nav class="zsec"><a href="/community/{esc(z)}/">Back to {esc(z)} · {esc(label)}</a> · '
            f'<a href="/">HomeSignal home</a></nav></main>')
    return (_head(title, desc, f"{BASE}{project_list_path(z)}", robots="noindex, follow")
            + f'<body data-nav="project-list">\n{body}\n</body>\n</html>\n')


def build_projects(projects, pages, out_dir, built):
    written, nbytes = 0, 0
    for key in sorted(projects):
        pr = projects[key]
        if not PROJECT_PATH_RE.match(pr["path"]):
            sys.exit(f"ERROR: project path refused: {pr['path']!r}")
        missing = [z for z in pr["zips"] if z not in pages]
        if len(missing) == len(pr["zips"]):
            sys.exit(f"ERROR: project {key!r} names no canonical ZIP ({missing[:5]})")
        d = os.path.join(out_dir, *pr["path"].strip("/").split("/"))
        os.makedirs(d, exist_ok=True)
        h = render_project(pr, pages, built, projects).encode("utf-8")
        open(os.path.join(d, "index.html"), "wb").write(h)
        written += 1
        nbytes += len(h)
    for z in sorted(pages):
        keys = pages[z].get("project_list")
        if not keys:
            continue
        d = os.path.join(out_dir, *project_list_path(z).strip("/").split("/"))
        os.makedirs(d, exist_ok=True)
        h = render_project_list(z, keys, projects, pages).encode("utf-8")
        open(os.path.join(d, "index.html"), "wb").write(h)
        nbytes += len(h)
    return written, nbytes


# ---------------------------------------------------------------- guide pages (plan step 13)
# A small, fixed set of pages built around real research questions — never one page per
# keyword or per place (the plan's "avoid doorway-page patterns"). Each gives plain guidance
# and a real HomeSignal lookup path that works with no script: a GET form that opens the
# Development map for a ZIP, and the map's own address search. The lists on them (city pages,
# recent proposals) come from the same plane the city and project pages are built from.
GUIDE_WHAT = "/guides/what-is-being-built-near-me/"
GUIDE_CHECK = "/guides/check-proposed-development-near-a-house/"
GUIDE_RECENT_N = 12


def _zip_form(label_id):
    return (f'<form class="zsec" action="/homesignalmap.html" method="get" role="search">'
            f'<label for="{label_id}">Your ZIP code</label> '
            f'<input id="{label_id}" name="zip" inputmode="numeric" pattern="[0-9]{{5}}" '
            f'maxlength="5" required placeholder="e.g. 78704"> '
            f'<button type="submit">Open the Development map</button></form>'
            f'<p>Have a street address? <a href="/homesignalmap.html">Search it on the Development '
            f'map</a> and choose how far around it to look.</p>')


def _guide_nav(here):
    other = [(GUIDE_WHAT, "What is being built near me?"),
             (GUIDE_CHECK, "How do I check proposed development near a house?")]
    li = "".join(f'<li><a href="{u}">{esc(t)}</a></li>' for u, t in other if u != here)
    return f'<nav class="zsec" aria-label="Guides"><h2>More guides</h2><ul>{li}</ul></nav>'


def _page(title, desc, path, body_html, built):
    body = (body_html
            + f'<p class="quiet">Updated <time datetime="{esc(built)}">{esc(built)}</time>. '
              f'Every project HomeSignal shows links to the official record it came from.</p>'
            + '<nav class="zsec"><a href="/">HomeSignal home</a> · '
              '<a href="/how-it-works.html">How HomeSignal works</a></nav></main>')
    return (_head(title, desc, f"{BASE}{path}", og_type="article")
            + f'<body data-nav="guide">\n{body}\n</body>\n</html>\n')


def render_guide_what(cities, built):
    by_state = {}
    for c in sorted(cities.values(), key=lambda c: (c["state"], c["place"])):
        by_state.setdefault(c["state"], []).append(c)
    city_html = ""
    if by_state:
        groups = "".join(
            f'<h3>{esc(st)}</h3><ul>' + "".join(
                f'<li><a href="{city_path(c)}">{esc(c["place"])}</a> '
                f'<span class="quiet">{c["count"]} projects</span></li>' for c in cs) + '</ul>'
            for st, cs in sorted(by_state.items()))
        nc = sum(len(v) for v in by_state.values())
        city_html = (f'<section class="zsec"><h2>Browse development by city</h2>'
                     f'<p>{nc} {"city has" if nc == 1 else "cities have"} enough development '
                     f'on record for a page of {"its" if nc == 1 else "their"} own.</p>'
                     f'{groups}</section>')
    body = (
        '<main id="hs-ssr"><header><p class="eyebrow"><a href="/">HomeSignal</a> · Guide</p>'
        '<h1>What is being built near me?</h1>'
        '<p>Most construction leaves a public record before work starts: a permit application, '
        'a site plan, a zoning case or a public hearing notice. HomeSignal collects those '
        'official records and maps them by ZIP code, so you can see what is proposed, approved '
        'and already built near you.</p></header>'
        + _zip_form("zipWhat")
        + '<section class="zsec"><h2>What you will see</h2>'
          '<p>Each project is sorted by where it stands:</p><ul>'
          '<li><strong>Proposed</strong> — filed, under review, or waiting for a hearing.</li>'
          '<li><strong>Approved</strong> — permitted or approved, and may not be built yet.</li>'
          '<li><strong>Operating / built</strong> — finished or in use.</li>'
          '<li><strong>Lifecycle unknown</strong> — the record does not say.</li></ul>'
          '<p>And by what kind of project it is: data center, industrial, residential, roads '
          '&amp; infrastructure, commercial, civic &amp; public, or other. Each one links to the '
          'record it came from, so you can read the details for yourself.</p></section>'
        + '<section class="zsec"><h2>Where the records come from</h2>'
          '<p>City and county building permits, site plans and subdivision plats, zoning and '
          'rezoning cases, planning hearings, and state transportation projects, read from the '
          'governments that publish them.</p></section>'
        + '<section class="zsec"><h2>What the map cannot tell you</h2><ul>'
          '<li>Coverage depends on what your city or county publishes online. An empty map does '
          'not mean nothing is planned.</li>'
          '<li>Records appear after they are filed. A project that is only being discussed will '
          'not be in any record yet.</li>'
          '<li>For anything that matters to a decision, confirm with your city or county '
          'planning department.</li></ul></section>'
        + city_html
        + _guide_nav(GUIDE_WHAT))
    return _page("What is being built near me? Check development by ZIP code | HomeSignal",
                 "Look up proposed, approved and recently built development near you from "
                 "official permits, site plans and zoning cases, mapped by ZIP code.",
                 GUIDE_WHAT, body, built)


def render_guide_check(projects, pages, built):
    recent = sorted((pr for pr in projects.values()
                     if not pr["held"] and pr["lifecycle"] == "Proposed" and pr["date"]),
                    key=lambda pr: (pr["date"], pr["key"]), reverse=True)[:GUIDE_RECENT_N]
    rec_html = ""
    if recent:
        li = []
        for pr in recent:
            z = next((z for z in pr["zips"] if z in pages), None)
            where = f' <span class="quiet">{esc(pages[z]["name"])}, {esc(pages[z]["state"])}</span>' if z else ""
            li.append(f'<li><a href="{pr["path"]}">{esc(pr["title"])}</a>{where} '
                      f'<time>{esc(pr["date"])}</time></li>')
        rec_html = (f'<section class="zsec"><h2>Recently filed proposals</h2><p>A sample of the '
                    f'newest proposed projects on HomeSignal. Each page shows the official record, '
                    f'where the project is and what it is.</p><ul>{"".join(li)}</ul></section>')
    body = (
        '<main id="hs-ssr"><header><p class="eyebrow"><a href="/">HomeSignal</a> · Guide</p>'
        '<h1>How do I check proposed development near a house?</h1>'
        '<p>Before you buy, rent or build, it helps to know what is planned nearby. Five checks '
        'cover most of it.</p></header>'
        + '<section class="zsec"><h2>1. Find out who decides</h2><p>Land inside city limits is '
          'usually governed by the city; land outside them by the county. Their planning and '
          'zoning departments hold the applications, and state transportation departments list '
          'road projects.</p></section>'
        + '<section class="zsec"><h2>2. Look up the address</h2><p>Use HomeSignal\'s '
          'Development map. Start with projects marked Proposed: those are the ones still '
          'being decided.</p>'
        + _zip_form("zipCheck") + '</section>'
        + '<section class="zsec"><h2>3. Read the official record</h2><p>Open each project\'s '
          'record. Look at the status, the dates, what is being built and how big it is. A '
          'rezoning or a site plan says more about what is coming than a single building '
          'permit.</p></section>'
        + '<section class="zsec"><h2>4. Look for hearings and comment windows</h2><p>Many '
          'proposals go before a planning commission or council, with public notice beforehand. '
          'HomeSignal ZIP pages list government notices and upcoming public meetings where your '
          'local government publishes them. A hearing is where residents can speak.</p></section>'
        + '<section class="zsec"><h2>5. Ask the planning department</h2><p>Plans that have not '
          'been filed will not be in any record. The city or county planning desk can tell you '
          'about pre-application meetings, the future land-use map and what the zoning allows '
          'on nearby lots.</p></section>'
        + rec_html
        + _guide_nav(GUIDE_CHECK))
    return _page("How to check proposed development near a house | HomeSignal",
                 "Five checks for what is planned near a home: who decides, the address lookup, "
                 "the official record, public hearings, and the planning department.",
                 GUIDE_CHECK, body, built)


def build_guides(cities, projects, pages, out_dir, built):
    written = []
    for path, html_ in ((GUIDE_WHAT, render_guide_what(cities, built)),
                        (GUIDE_CHECK, render_guide_check(projects, pages, built))):
        d = os.path.join(out_dir, *path.strip("/").split("/"))
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "wb").write(html_.encode("utf-8"))
        written.append(path)
    return written


# ---------------------------------------------------------------- sitemap (in-artifact)
SITEMAP_LEGACY_RE = re.compile(
    r"[ \t]*<url>\s*<loc>[^<]*community\.html\?zip=\d{5}</loc>.*?</url>\s*", re.S)

# The development half. Measured 2026-09-19 against production: every one of these URLs
# serves the SAME document, because GitHub Pages selects content by PATH and ignores the
# query string entirely (docs/crawler-ground-truth-2026-09-03.md).
#   ?zip=78617 -> 309,689 bytes, md5 0282424d481b23d738a8dc038c0b7ee2
#   ?zip=84302 -> 309,689 bytes, md5 0282424d481b23d738a8dc038c0b7ee2   <- identical
# Both ship `noindex, nofollow` in their initial HTML and both canonicalise to the
# ZIP-LESS https://homesignal.net/homesignalmap.html. homesignalmap.html flips its own
# robots-meta client-side from app_community_meta.indexable, but never rewrites the
# canonical — so even a rendered crawl consolidates all 11,718 into one URL and not one
# of them can rank for a ZIP. Advertising them is not a no-op: it is 11,718 "submitted
# URL marked noindex" errors in Search Console and 59% of the crawl budget spent on
# duplicates of one page, taken away from the real /community/<zip>/ documents.
SITEMAP_DEV_RE = re.compile(
    r"[ \t]*<url>\s*<loc>[^<]*homesignalmap\.html\?zip=\d{5}</loc>.*?</url>\s*", re.S)


def _url_el(loc, lastmod=None):
    """lastmod is the day the page's facts last changed, never the build day: a lastmod
    that moves every day tells Google nothing, and it learns to ignore it."""
    lm = f"    <lastmod>{lastmod}</lastmod>\n" if lastmod and DAY_RE.match(lastmod) else ""
    return (f"  <url>\n    <loc>{html.escape(loc)}</loc>\n{lm}"
            f"    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>")


SITEMAP_MAX_URLS = 50000        # the sitemaps.org limit for one file


def reconcile_sitemap(out_dir, indexable, city_paths=(), project_paths=(), guide_paths=(),
                      lastmod=None):
    """Rewrite the ARTIFACT's sitemap so the advertised community set is exactly the set of
    documents this build made index-eligible.

    WHY IN THE ARTIFACT AND NOT IN THE REPO. `sitemap.xml` is generated by
    scripts/gen_sitemap.py and COMMITTED, and until the Pages deployment source is switched
    to GitHub Actions that committed file is what production serves. Advertising
    /community/<zip>/ from the repo would advertise 7,000 URLs that do not exist yet — a
    sitemap full of 404s. Rewriting the copy INSIDE the artifact means the sitemap becomes
    correct at exactly the moment the documents it points at start existing, and stays
    untouched if they never do. Same reason the deploy job is gated on main.

    The development half (`homesignalmap.html?zip=`) is REMOVED, not carried over.

    ⚠️ THIS REVERSES THIS FUNCTION'S ORIGINAL "leave the development half alone
    (page-purpose separation)" RULE, deliberately. That rule was right about page PURPOSE
    and wrong about what was being advertised: page-purpose separation assumes the two
    halves are two sets of documents. They are not. The community half became real
    per-ZIP documents; the development half never did, so all 11,718 of its URLs resolve
    to ONE noindex document that canonicalises away from every ZIP (see SITEMAP_DEV_RE
    above for the measurement). A sitemap entry for a URL whose own robots value says
    noindex is the exact contradiction the committed generator's docstring forbids — it
    was simply never checked on this half.

    This removes the ADVERTISEMENT only. It changes no document, no robots directive, and
    nothing a resident sees: /homesignalmap.html?zip=<zip> keeps working exactly as it
    does today, and stays reachable from the Place pages. Restoring the advertisement is
    the job of making those URLs real documents (`/development/<zip>/`, the pattern
    `/community/<zip>/` already uses), at which point this filter is what should be
    replaced — not reverted.

    `scripts/gen_sitemap.py` still WRITES those URLs into the committed sitemap.xml. That
    is left alone for the same reason its community half is: nothing serves the committed
    file, the artifact is what ships, and retiring the committed generator's halves is a
    separate change (its own docstring already logs that follow-up).
    """
    path = os.path.join(out_dir, "sitemap.xml")
    zips = sorted(indexable)
    block = "\n".join(_url_el(f"{BASE}/community/{z}/") for z in zips)
    # City pages (plan step 9) exist only when they qualify, so every one is indexable.
    cps = sorted(city_paths)
    if cps:
        block += "\n" + "\n".join(_url_el(f"{BASE}{cp}") for cp in cps)
    # Project pages (plan step 12) are written only for featured, durable projects: every
    # one is indexable.
    pps = sorted(project_paths)
    if pps:
        block += "\n" + "\n".join(_url_el(f"{BASE}{pp}", (lastmod or {}).get(pp)) for pp in pps)
    gps = sorted(guide_paths)
    if gps:
        block += "\n" + "\n".join(_url_el(f"{BASE}{gp}") for gp in gps)
    if not os.path.exists(path):
        print("WARNING: no sitemap.xml staged in the artifact — writing community URLs only")
        body = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + block + "\n</urlset>\n")
        open(path, "w", encoding="utf-8").write(body)
        # No staged sitemap to filter, so nothing was removed from either half. Both keys
        # are stated rather than omitted: main() reads them unconditionally, and a missing
        # key here is a KeyError that kills the whole build on the no-sitemap path only —
        # a branch the SEO suite's happy path never takes.
        return {"removed": 0, "removed_dev": 0, "added": len(zips), "cities": len(cps),
                "projects": len(pps), "guides": len(gps)}
    txt = open(path, encoding="utf-8").read()
    removed = len(SITEMAP_LEGACY_RE.findall(txt))
    txt = SITEMAP_LEGACY_RE.sub("", txt)
    removed_dev = len(SITEMAP_DEV_RE.findall(txt))
    txt = SITEMAP_DEV_RE.sub("", txt)
    if "</urlset>" not in txt:
        sys.exit("ERROR: staged sitemap.xml has no </urlset> — refusing to write a broken sitemap")
    txt = txt.replace("</urlset>", block + "\n</urlset>")
    open(path, "w", encoding="utf-8").write(txt)
    n = len(re.findall(r"<loc>[^<]*/community/(\d{5})/</loc>", txt))
    if n != len(zips):
        sys.exit(f"ERROR: sitemap carries {n} community URLs for {len(zips)} indexable ZIPs")
    nc = len(re.findall(r"<loc>[^<]*/city/[a-z]{2}/[a-z0-9-]+/</loc>", txt))
    if nc != len(cps):
        sys.exit(f"ERROR: sitemap carries {nc} city URLs for {len(cps)} city pages")
    npj = len(re.findall(r"<loc>[^<]*/project/[a-z0-9-]+/[a-z0-9-]+/</loc>", txt))
    if npj != len(pps):
        sys.exit(f"ERROR: sitemap carries {npj} project URLs for {len(pps)} project pages")
    ngd = len(re.findall(r"<loc>[^<]*/guides/[a-z0-9-]+/</loc>", txt))
    if ngd != len(gps):
        sys.exit(f"ERROR: sitemap carries {ngd} guide URLs for {len(gps)} guide pages")
    if re.search(r"community\.html\?zip=", txt):
        sys.exit("ERROR: the legacy community.html?zip= URL survived in the artifact sitemap")
    # Every advertised URL must agree with its own robots directive. The development URLs
    # are noindex and canonicalise away from the ZIP, so one surviving here is a defect —
    # and a silent one, because a sitemap full of noindex URLs still parses and still
    # returns 200. Fail the build rather than ship it.
    if re.search(r"homesignalmap\.html\?zip=", txt):
        sys.exit("ERROR: a noindex homesignalmap.html?zip= URL survived in the artifact sitemap")
    return {"removed": removed, "removed_dev": removed_dev, "added": len(zips), "cities": len(cps),
            "projects": len(pps), "guides": len(gps)}


# ---------------------------------------------------------------- family sitemaps (plan step 14)
# Search Console reports indexing per SUBMITTED sitemap, so one sitemap per page family is what
# lets it measure each family separately. These are ADDITIONAL to sitemap.xml, which is
# unchanged; every URL in them is also in sitemap.xml. The two ZIP families overlap on
# purpose: a ZIP that passes both Rule F and Rule D is in both, so each rule is measured
# over the whole set of pages it qualifies.
SITEMAP_FAMILIES = ("zip-alerts", "zip-development", "city", "project", "guide")


def write_family_sitemaps(out_dir, families, lastmod=None):
    d = os.path.join(out_dir, "sitemaps")
    os.makedirs(d, exist_ok=True)
    counts = {}
    for name in SITEMAP_FAMILIES:
        paths = sorted(families.get(name) or [])
        if len(paths) > SITEMAP_MAX_URLS:
            sys.exit(f"ERROR: sitemaps/{name}.xml would list {len(paths)} URLs, over the "
                     f"{SITEMAP_MAX_URLS} limit for one file — split it before publishing")
        body = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + "".join(_url_el(f"{BASE}{p}", (lastmod or {}).get(p)) + "\n" for p in paths)
                + "</urlset>\n")
        open(os.path.join(d, f"{name}.xml"), "w", encoding="utf-8").write(body)
        counts[name] = len(paths)
    return counts


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
    ap.add_argument("--dev-plane", default=None,
                    help="compact Development SEO plane JSON (Rule D). "
                         "Production: missing/stale is a hard error.")
    ap.add_argument("--dev-cities", default=None,
                    help="city pages' data JSON published beside the plane "
                         "(default: data/development_seo_cities.json). Production: missing, or "
                         "from a different run than the plane, is a hard error.")
    ap.add_argument("--dev-projects", default=None,
                    help="project pages' data JSON published beside the plane "
                         "(default: data/development_seo_projects.json). Production: missing, "
                         "or from a different run than the plane, is a hard error.")
    ap.add_argument("--zip-coverage", default=COVERAGE_PATH,
                    help="ZIP coverage model JSON (default: lib/zip-coverage.json). Tests point "
                         "this at a fixture model; production always uses the committed one.")
    ap.add_argument("--allow-missing-dev-plane", action="store_true",
                    help="fixture-only: a missing plane is {} (no Rule D). "
                         "Refused in production.")
    a = ap.parse_args()
    t0 = time.time()
    DEADLINE[0] = t0 + FETCH_BUDGET
    now_iso = a.now or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    if a.fixture:
        d = json.load(open(a.fixture, encoding="utf-8"))
    else:
        d = fetch_data(_anon_key(), now_iso)

    if a.allow_missing_dev_plane and not a.fixture:
        sys.exit("ERROR: --allow-missing-dev-plane is fixture-only")
    plane_path = a.dev_plane
    if plane_path is None and a.fixture:
        sibling = os.path.join(os.path.dirname(os.path.abspath(a.fixture)),
                               "development_seo_plane.json")
        if os.path.isfile(sibling):
            plane_path = sibling
    if plane_path is None:
        plane_path = os.path.join(os.path.dirname(__file__), "..", "data",
                                  "development_seo_plane.json")
    # Fixtures skip the freshness clock (their generated_at is pinned). They
    # still annotate through lib/project-type.js when a plane file is present.
    # Production requires a current plane; missing/stale is a hard error.
    plane_required = not a.fixture
    if a.fixture and a.allow_missing_dev_plane:
        plane_required = False
    cities_path = a.dev_cities
    if cities_path is None and a.fixture:
        sibling = os.path.join(os.path.dirname(os.path.abspath(a.fixture)),
                               "development_seo_cities.json")
        if os.path.isfile(sibling):
            cities_path = sibling
    if cities_path is None and not a.fixture:
        cities_path = os.path.join(os.path.dirname(__file__), "..", "data",
                                   "development_seo_cities.json")
    projects_path = a.dev_projects
    if projects_path is None and a.fixture:
        sibling = os.path.join(os.path.dirname(os.path.abspath(a.fixture)),
                               "development_seo_projects.json")
        if os.path.isfile(sibling):
            projects_path = sibling
    if projects_path is None and not a.fixture:
        projects_path = os.path.join(os.path.dirname(__file__), "..", "data",
                                     "development_seo_projects.json")
    cities, projects = {}, {}
    d["_dev_plane"] = load_dev_plane(plane_path, required=plane_required, cities_out=cities,
                                     cities_path=cities_path, projects_out=projects,
                                     projects_path=projects_path)

    zips = d["zips"]
    if len(zips) != len(set(zips)):
        sys.exit(f"ERROR: duplicate ZIPs in canonical registry: {len(zips)} rows, {len(set(zips))} distinct")
    if "80249" in set(zips):
        sys.exit("ERROR: ZIP 80249 present in the canonical registry - removed drift page")
    print(f"canonical registry: {len(zips)} rows, {len(set(zips))} distinct, 0 duplicates")
    # ZIP COVERAGE (founder, 2026-10-03; replaces the 2026-10-01 "withheld pages" list).
    # lib/zip-coverage.json names the ZIPs with no Census-drawn area. Every one of them keeps a
    # document, a canonical URL and its usual sitemap rule: no map and no ZIP-wide development
    # claim, a coverage panel instead. Only a ZIP whose retirement the internal record shows as
    # USPS-verified (page_mode retired) gets no document - none today. Against production every listed ZIP must be
    # canonical, or a typo would change nothing while the build reported success (a fixture is a
    # small slice of the registry, so it is only intersected).
    coverage = load_zip_coverage(a.zip_coverage)
    modes = {z: coverage_mode(e) for z, e in coverage["zips"].items()}
    nonstandard = {z for z, m in modes.items() if m != "standard"}
    retired = {z for z, m in modes.items() if m == "retired"}
    stray = sorted(set(coverage["zips"]) - set(zips))
    if stray and not a.fixture:
        sys.exit(f"ERROR: coverage ZIP(s) not in the canonical registry: {stray}")
    registry_n = len(zips)
    zips = [z for z in zips if z not in retired]
    d["zips"] = zips
    present = {z: m for z, m in modes.items() if z in set(zips) and m != "standard"}
    counts = {m: sum(1 for x in present.values() if x == m) for m in ("specialized_zip", "verification_pending")}
    print(f"zip coverage   : {len(coverage['zips'])} modelled; documents for {len(present)} "
          f"({counts['specialized_zip']} specialized_zip, {counts['verification_pending']} verification_pending); "
          f"{len(retired)} retired; building {len(zips)} of {registry_n}")
    # City and project pages list the ZIPs they cover. A ZIP with no Census-drawn area has no
    # ZIP-wide development records, so it leaves those lists, and it may only appear there as a
    # listed or held ZIP: a city that COUNTS such a ZIP as Rule D, or a project whose only ZIP is
    # one, would make a page describe ZIP-wide records that cannot exist, so the build stops and
    # names it rather than guessing.
    for key, c in cities.items():
        counted = [z for z in c["rule_d_zips"] if z in nonstandard]
        if counted:
            sys.exit(f"ERROR: city {key} counts coverage-limited ZIP(s) {counted} as Rule D")
        c["zips"] = [z for z in c["zips"] if z not in nonstandard]
        c["held_zips"] = [z for z in c["held_zips"] if z not in nonstandard]
    for key, pr in projects.items():
        kept = [z for z in pr["zips"] if z not in nonstandard]
        if not kept:
            sys.exit(f"ERROR: project {key!r} is only on coverage-limited ZIP(s) {pr['zips'][:5]}")
        pr["zips"] = kept

    pages = assemble(d, now_iso)
    if len(pages) != len(zips):
        sys.exit(f"ERROR: assembled {len(pages)} pages for {len(zips)} canonical ZIPs")
    for z, m in present.items():
        # Rule D (ZIP-wide development entities) and the development cards need a ZIP area; this
        # ZIP has none, so neither applies. Rule F (government notices, meetings, news) is
        # unchanged: it does not depend on a boundary.
        pages[z]["coverage"] = {"mode": m, "copy": coverage["copy"][m], "entry": coverage["zips"][z]}
        pages[z]["rule_d"], pages[z]["rule_d_count"], pages[z]["dev_entities"] = False, 0, []
    link_cities(pages, cities)
    linked = link_projects(pages, cities, projects)
    npass = sum(1 for p in pages.values() if p["rule_f"])
    ndpass = sum(1 for p in pages.values() if p.get("rule_d"))
    stats = build(pages, a.out, zips, now_iso[:10])
    indexable = sorted(z for z, p in pages.items() if p["rule_f"] or p.get("rule_d"))
    ncity = build_cities(cities, pages, a.out, now_iso[:10])
    city_paths = sorted(city_path(c) for c in cities.values())
    nproj, proj_bytes = build_projects(projects, pages, a.out, now_iso[:10])
    project_paths = sorted(pr["path"] for pr in projects.values())
    guide_paths = build_guides(cities, projects, pages, a.out, now_iso[:10])
    project_lastmod = {pr["path"]: pr["changed_on"] for pr in projects.values()}
    sm = reconcile_sitemap(a.out, indexable, city_paths, project_paths, guide_paths,
                           lastmod=project_lastmod)
    fam = write_family_sitemaps(a.out, {
        "zip-alerts": [f"/community/{z}/" for z, p in pages.items() if p["rule_f"]],
        "zip-development": [f"/community/{z}/" for z, p in pages.items() if p.get("rule_d")],
        "city": city_paths, "project": project_paths, "guide": guide_paths},
        lastmod=project_lastmod)

    print(f"documents      : {stats['documents']}")
    print(f"rule F pass    : {npass}")
    print(f"rule F fail    : {len(pages) - npass}")
    print(f"rule D pass    : {ndpass}")
    print(f"indexable      : {len(indexable)} (Rule F OR Rule D)")
    print(f"city pages     : {ncity}")
    print(f"project pages  : {nproj} ({proj_bytes/1048576:.1f} MB; "
          f"{sum(1 for p in projects.values() if p['held'])} held; {linked} linked from a card; "
          f"{sum(1 for p in projects.values() if not p['tracked'])} no longer tracked; "
          f"{sum(1 for p in pages.values() if p.get('project_list'))} ZIP project lists)")
    print(f"artifact bytes : {stats['bytes']} ({stats['bytes']/1048576:.1f} MB)")
    print(f"avg html bytes : {stats['avg']}")
    print(f"max html bytes : {stats['max']} (zip {stats['max_zip']})")
    print(f"sitemap        : -{sm['removed']} legacy community.html?zip= URLs, "
          f"-{sm['removed_dev']} noindex homesignalmap.html?zip= URLs, "
          f"+{sm['added']} /community/<zip>/ URLs, +{sm['cities']} /city/ URLs, "
          f"+{sm['projects']} /project/ URLs, +{sm['guides']} /guides/ URLs")
    print("family sitemaps : " + ", ".join(f"{k} {v}" for k, v in fam.items()))
    print(f"build seconds  : {time.time()-t0:.1f}")
    if stats["documents"] != len(zips):
        sys.exit("ERROR: document count != canonical ZIP count")
    if stats["bytes"] + proj_bytes > 900 * 1024 * 1024:
        sys.exit("ERROR: artifact exceeds the safe GitHub Pages budget")
    # dev_indexable_zips is ADDITIVE and exists so the crawler proof can NAME the current
    # members of a control class when a frozen control drifts out of it. The build already
    # computes p["dev_indexable"] per ZIP and threw it away; without it, "Alerts FAIL +
    # development PASS" is underivable from the artifact, so a drifted class-C control can
    # only be replaced by hand-querying production. It changes no document, no robots
    # directive and no sitemap entry — it is a fact about the build, written down.
    dev_idx = sorted(z for z, p in pages.items() if p["dev_indexable"])
    json.dump({"documents": stats["documents"], "rule_f_pass": npass,
               "canonical_registry": registry_n, "retired_zips": sorted(retired),
               "coverage_zips": {z: m for z, m in sorted(present.items())},
               "rule_f_fail": len(pages) - npass,
               "rule_d_pass": ndpass,
               "indexable_zips": indexable, "dev_indexable_zips": dev_idx,
               "sitemap_community_urls": sm["added"],
               "sitemap_dev_urls_removed": sm["removed_dev"],
               "city_pages": city_paths, "sitemap_city_urls": sm["cities"],
               "project_pages": project_paths, "sitemap_project_urls": sm["projects"],
               "guide_pages": sorted(guide_paths), "sitemap_guide_urls": sm["guides"],
               "family_sitemaps": fam},
              open(os.path.join(a.out, "zip-pages-manifest.json"), "w"))
    print("OK")


if __name__ == "__main__":
    main()
