#!/usr/bin/env python3
"""ONE page-semantics authority for HomeSignal's generated public documents.

WHAT THIS IS FOR. gen_zip_pages.py already decides what every generated page says. This module
turns that SAME rendering into a stable SEMANTIC FINGERPRINT per canonical URL, so that "did the
public page change?" is answered by the renderer's own output and never by a second, parallel
definition of applicability. From the fingerprints it derives three things, all in one place:

  1. the previous-live vs candidate DELTA (what IndexNow is told about),
  2. a truthful per-URL sitemap <lastmod> (moves only when the semantic fingerprint moves),
  3. the decision whether a freshness-triggered build has anything to publish.

THE FINGERPRINT. sha256 over a projection of the rendered HTML that keeps exactly what a crawler or
resident reads: <title>, every <meta name|property> (robots, description, og:*, twitter:*), the
canonical <link>, JSON-LD blocks, and the <body> with scripts and <template> removed. It drops
deployment plumbing: CSP, <base>, viewport, charset, stylesheet links and every <script src>, and
the build day. A cache-busting `?v=` on a script or stylesheet therefore cannot move it, and
neither can the "Compiled from official public records on <day>" line, which the generator now
renders with BUILD_DAY_TOKEN and substitutes only when it writes the file.

⚠️ Why a token and not "mask the build date after the fact": a project page's own `<time>` for a
decision date can equal the build day. Replacing the day's text would mask that real content on
one build and not the next, and every such page would look changed on the day boundary. The
generator hands the renderer a token that cannot occur in content, and replaces the token last.

WHAT IS NOT HERE. No geography, no eligibility, no Rule F / Rule D, no notion of a ZIP. A page is a
path and some bytes. Anything that decides what a page says stays in gen_zip_pages.py.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

SEMANTIC_VERSION = 1
SCHEMA = "homesignal-page-state"
BASE = "https://homesignal.net"

# Substituted into the HTML by the renderer, replaced by the real day when the file is written.
# html.escape leaves '@' and '-' alone, so it survives esc() unchanged. It is not a value any
# source record can carry in a rendered position: the generator also refuses a build whose
# source data contains it (see assert_token_absent).
BUILD_DAY_TOKEN = "@@HS-BUILD-DAY@@"

FAMILIES = ("zip", "city", "project", "guide")

# A TRACKED project's `as_of` ("Status as of <day>") is set to the plane's own day on every run:
# the plane producer documents it as bookkeeping ("as_of, changed_on, tracked, held are not facts",
# bluesky/lib/development-seo-plane.mjs) and it advances daily for every tracked project. Read as
# content it would re-announce ~14,000 project pages every morning. The renderer therefore renders
# a tracked project a second time with this constant for the FINGERPRINT only; the written page
# keeps the real day. An untracked project's as_of ("Last seen") is a frozen fact and is not
# neutralized.
NEUTRAL_AS_OF = "2000-01-01"
# The canonical URL shape of every family that is tracked. A tracked page is index-eligible or
# can become so; /community/<zip>/projects/ is noindex forever and is not tracked.
PATH_RES = {
    "zip": re.compile(r"^/community/\d{5}/$"),
    "city": re.compile(r"^/city/[a-z]{2}/[a-z0-9]+(?:-[a-z0-9]+)*/$"),
    "project": re.compile(r"^/project/[a-z0-9]+(?:-[a-z0-9]+)*/(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?[0-9a-f]{8}/$"),
    "guide": re.compile(r"^/guides/[a-z0-9]+(?:-[a-z0-9]+)*/$"),
}
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def family_of(path):
    for fam, rx in PATH_RES.items():
        if rx.fullmatch(path):
            return fam
    return None


# ---------------------------------------------------------------- the projection
_SCRIPT_NOT_LD = re.compile(r"<script\b(?![^>]*application/ld\+json)[^>]*>.*?</script>\s*", re.S | re.I)
_TEMPLATE = re.compile(r"<template\b.*?</template>\s*", re.S | re.I)
_INFRA_TAGS = (
    re.compile(r"<meta\s+http-equiv=[^>]*>\s*", re.I),
    re.compile(r"<base\b[^>]*>\s*", re.I),
    re.compile(r"<meta\s+name=\"viewport\"[^>]*>\s*", re.I),
    re.compile(r"<meta\s+charset=[^>]*>\s*", re.I),
    re.compile(r"<link\s+rel=\"stylesheet\"[^>]*>\s*", re.I),
)
_ROBOTS = re.compile(r"<meta\s+name=\"robots\"\s+content=\"([^\"]*)\"", re.I)


def projection(html):
    """The crawler-visible content of one document. Input is the renderer's output with
    BUILD_DAY_TOKEN still in place."""
    s = _SCRIPT_NOT_LD.sub("", html)
    s = _TEMPLATE.sub("", s)
    for rx in _INFRA_TAGS:
        s = rx.sub("", s)
    return s


def fingerprint(html):
    return hashlib.sha256(projection(html).encode("utf-8")).hexdigest()[:32]


def is_indexable(html):
    """Read from the document itself — the single place the robots decision is made — so the
    notification set can never disagree with what a crawler is told."""
    m = _ROBOTS.search(html)
    if not m:
        raise ValueError("document has no robots meta; refusing to guess its indexability")
    return "noindex" not in m.group(1).lower()


def assert_token_absent(obj_json_text):
    if BUILD_DAY_TOKEN in obj_json_text:
        raise SystemExit("ERROR: source data contains the reserved build-day token")


# ---------------------------------------------------------------- state document
class PageState:
    """Collects one entry per tracked canonical path while the generator renders."""

    def __init__(self, built_day=""):
        self.built_day = built_day
        self.entries = {}          # path -> {"h": hash, "i": 0|1, "hint": seed lastmod, "wb": written-bytes hash}

    def add(self, path, html, lastmod_hint=None, semantic_html=None):
        """`html` is what is WRITTEN (build-day token still in place). `semantic_html`, when given,
        is the same document rendered with a bookkeeping field held constant, and is what the
        fingerprint reads instead; see NEUTRAL_AS_OF."""
        fam = family_of(path)
        if fam is None:
            raise ValueError(f"path is not a tracked canonical shape: {path!r}")
        if path in self.entries:
            raise ValueError(f"duplicate tracked path: {path!r}")
        if lastmod_hint is not None and not (DAY_RE.fullmatch(lastmod_hint) or STAMP_RE.fullmatch(lastmod_hint)):
            raise ValueError(f"lastmod hint is not a date: {lastmod_hint!r}")
        # "wb" hashes the bytes that are actually WRITTEN (build day substituted). It is not part of
        # the published state; it lets the post-deploy check prove the live bytes are these bytes.
        written = html.replace(BUILD_DAY_TOKEN, self.built_day).encode("utf-8")
        sem = html if semantic_html is None else semantic_html
        self.entries[path] = {"h": fingerprint(sem), "i": 1 if is_indexable(sem) else 0,
                              "hint": lastmod_hint, "wb": hashlib.sha256(written).hexdigest()[:32]}


def state_hash(pages):
    """Identity of a semantic state: path, fingerprint and indexability only. lastmod is
    metadata ABOUT the state and is deliberately outside it."""
    h = hashlib.sha256()
    for p in sorted(pages):
        e = pages[p]
        h.update(f"{p}|{e['h']}|{e['i']}\n".encode("utf-8"))
    return h.hexdigest()[:32]


def build_document(pages, built_at, build_id="", commit=""):
    """The published candidate state. `pages` maps path -> {"h","i","l"}."""
    return {"schema": SCHEMA, "semantic_version": SEMANTIC_VERSION, "host": BASE,
            "built_at": built_at, "build_id": build_id, "source_commit": commit,
            "state_hash": state_hash(pages), "count": len(pages),
            "pages": {p: {"h": e["h"], "i": e["i"], "l": e.get("l")} for p, e in sorted(pages.items())}}


class BaselineError(Exception):
    pass


def load_baseline(text):
    """Parse and VALIDATE a previously published state document. Returns the dict, or raises
    BaselineError. A document that does not validate is never silently treated as 'no baseline':
    that would turn a corrupt file into a first-run reseed and swallow a real delta."""
    try:
        doc = json.loads(text)
    except ValueError as e:
        raise BaselineError(f"baseline is not JSON: {e}")
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA:
        raise BaselineError("baseline is not a homesignal-page-state document")
    if doc.get("host") != BASE:
        raise BaselineError(f"baseline host is {doc.get('host')!r}, not {BASE!r}")
    if not isinstance(doc.get("semantic_version"), int):
        raise BaselineError("baseline has no integer semantic_version")
    pages = doc.get("pages")
    if not isinstance(pages, dict):
        raise BaselineError("baseline has no pages object")
    for p, e in pages.items():
        if family_of(p) is None:
            raise BaselineError(f"baseline path is not a tracked canonical shape: {p!r}")
        if not (isinstance(e, dict) and isinstance(e.get("h"), str) and e.get("i") in (0, 1)):
            raise BaselineError(f"baseline entry malformed for {p!r}")
        l = e.get("l")
        if l is not None and not (isinstance(l, str) and (DAY_RE.fullmatch(l) or STAMP_RE.fullmatch(l))):
            raise BaselineError(f"baseline lastmod malformed for {p!r}")
    if doc.get("state_hash") != state_hash(pages):
        raise BaselineError("baseline state_hash does not match its own pages (truncated or edited file)")
    return doc


# ---------------------------------------------------------------- delta + lastmod
def finalize(state, baseline, now_stamp, *, override_lastmod=None):
    """Turn collected entries into the candidate pages (with truthful lastmod) and the delta.

    baseline: a validated document, or None (first run / reseed).
    override_lastmod: path -> day for a family whose own data names the modification day
        (project pages: changed_on). It wins over everything for those paths, because it is the
        existing authority and is stronger than "the build saw a different hash".

    lastmod rules, in order:
      override                       -> the override (existing authority)
      same fingerprint as baseline   -> the baseline's lastmod, even when None (never invented)
      changed vs baseline            -> now_stamp (the page really changed in this publication)
      new page, baseline exists      -> now_stamp (it was first published now)
      no baseline (seed)             -> the page's own source-derived hint, else omitted
      baseline from another semantic_version -> hashes are incomparable: keep the baseline's
                                       lastmod where the page existed, hint otherwise. Nothing is
                                       claimed as changed, and nothing is submitted.
    """
    override_lastmod = override_lastmod or {}
    bpages = (baseline or {}).get("pages") or {}
    comparable = bool(baseline) and baseline.get("semantic_version") == SEMANTIC_VERSION
    pages = {}
    for path in sorted(state.entries):
        e = state.entries[path]
        old = bpages.get(path)
        if path in override_lastmod and override_lastmod[path]:
            lm = override_lastmod[path]
        elif baseline is None:
            lm = e["hint"]
        elif not comparable:
            lm = old.get("l") if old else e["hint"]
        elif old is None:
            lm = now_stamp
        elif old["h"] == e["h"]:
            lm = old.get("l")
        else:
            lm = now_stamp
        pages[path] = {"h": e["h"], "i": e["i"], "l": lm}
    return pages


def compute_delta(baseline, pages):
    """Previous-live state vs candidate state -> the IndexNow notification set.

    Submit rules (the whole policy, in one place):
      * a NEW page is submitted only if it is index-eligible;
      * a CHANGED page is submitted only if it is index-eligible both before and after
        (a noindex page that stays noindex has nothing to tell a search engine);
      * a page whose indexability FLIPPED is submitted in both directions — becoming indexable is
        news, and becoming noindex is the one thing a crawler must be told so it re-fetches;
      * a REMOVED page is submitted only if it was index-eligible (so its 404 is discovered).
    No baseline, or a baseline of another semantic_version, submits NOTHING: installing IndexNow
    must not announce 28,000 historical URLs.
    """
    delta = {"added": [], "changed": [], "indexability_changed": [], "removed": [],
             "submit": [], "seed": False, "seed_reason": "", "baseline_state_hash": None,
             "candidate_state_hash": state_hash(pages), "baseline_commit": None,
             "candidate_pages": len(pages), "baseline_pages": 0}
    if baseline is None:
        delta["seed"], delta["seed_reason"] = True, "no baseline: first publication seeds the state, nothing is submitted"
        return delta
    delta["baseline_state_hash"] = baseline.get("state_hash")
    delta["baseline_commit"] = baseline.get("source_commit") or None
    delta["baseline_pages"] = len(baseline.get("pages") or {})
    if baseline.get("semantic_version") != SEMANTIC_VERSION:
        delta["seed"] = True
        delta["seed_reason"] = (f"baseline semantic_version {baseline.get('semantic_version')} != "
                                f"{SEMANTIC_VERSION}: fingerprints are not comparable, nothing is submitted")
        return delta
    bpages = baseline["pages"]
    submit = set()
    for path, new in pages.items():
        old = bpages.get(path)
        if old is None:
            delta["added"].append(path)
            if new["i"]:
                submit.add(path)
        elif old["i"] != new["i"]:
            delta["indexability_changed"].append(path)
            submit.add(path)
        elif old["h"] != new["h"]:
            delta["changed"].append(path)
            if new["i"]:
                submit.add(path)
    for path, old in bpages.items():
        if path not in pages:
            delta["removed"].append(path)
            if old["i"]:
                submit.add(path)
    for k in ("added", "changed", "indexability_changed", "removed"):
        delta[k].sort()
    delta["submit"] = sorted(submit)
    return delta


def verification_sample(state, delta, k=6):
    """A small, deterministic sample of what the live site must be serving before anyone is told:
    the exact written bytes of some changed pages, and a 404 for some removed ones. Evenly spaced
    over the sorted set so it is stable and not just the first few alphabetically."""
    subs = delta["submit"]
    here = [p for p in subs if p in state.entries]
    gone = [p for p in subs if p not in state.entries]
    pick = lambda xs: xs[::max(1, len(xs) // k)][:k] if xs else []
    return {"present": {p: state.entries[p]["wb"] for p in pick(here)}, "absent": pick(gone)}


def decide(delta, *, freshness, sha, reseed=False):
    """Does this run have something to publish?

    A freshness-triggered run exists only to publish new CONTENT. It may skip the deploy when the
    semantic state is unchanged AND the commit being built is the one already live. The second
    clause is load-bearing: GitHub keeps only the newest pending run per concurrency group, so a
    freshness run can replace a pending push-build. If that push changed no page semantics (a
    script, a stylesheet, a partial), "no delta" would otherwise skip the only deploy that ships
    it. Every other trigger (push, daily schedule, plain dispatch) always deploys, as before.
    """
    if not freshness or reseed:
        return {"proceed": True, "reason": "full build (not a freshness-only run)" if not reseed else "reseed requested"}
    if delta["seed"]:
        return {"proceed": True, "reason": "no comparable baseline: publish the seed state"}
    if delta["baseline_state_hash"] != delta["candidate_state_hash"]:
        return {"proceed": True, "reason": "semantic state changed"}
    if delta.get("carried"):
        return {"proceed": True, "reason": "an earlier IndexNow job left URLs unsent: this run sends them"}
    if (delta["baseline_commit"] or "") != (sha or ""):
        return {"proceed": True, "reason": "live build is from another commit"}
    return {"proceed": False, "reason": "no semantic change and the live build is this commit"}


# ---------------------------------------------------------------- CLI (used by pages.yml)
def _cmd_decide(a):
    delta = json.load(open(a.delta, encoding="utf-8"))
    d = decide(delta, freshness=a.freshness == "true", sha=a.sha, reseed=a.reseed == "true")
    print(f"proceed={'true' if d['proceed'] else 'false'}")
    print(f"submit_count={len(delta['submit'])}")
    print(f"reason={d['reason']}", file=sys.stderr)
    return 0


def fetch_baseline(out, *, get=None, sleep=time.sleep, tries=4, url=None):
    """Capture the PREVIOUS LIVE state before anything is built or deployed.

    The `?cb=` query defeats the CDN: GitHub Pages serves with a ten-minute max-age, so a build
    that starts minutes after a deploy could otherwise read the state from TWO deploys ago and
    announce pages that were already announced. 404 means 'there is no baseline' (first
    publication, seed). Any other failure is retried and then FAILS the build: a flaky read must
    not be mistaken for a first run, because a first run notifies nothing.
    Returns 'ok' | 'absent'."""
    url = url or f"{BASE}/sitemaps/page-state.json"
    last = ""
    for n in range(tries):
        cb = f"{url}?cb={int(time.time())}{n}"
        try:
            if get is None:
                req = urllib.request.Request(cb, headers={"User-Agent": "HomeSignal-pages-baseline/1"})
                with urllib.request.urlopen(req, timeout=45) as r:
                    status, body = r.status, r.read()
            else:
                status, body = get(cb)
        except urllib.error.HTTPError as e:
            status, body = e.code, b""
        except Exception as e:                       # network error: retry
            status, body, last = None, b"", str(e)
        if status == 404:
            if os.path.exists(out):
                os.remove(out)
            return "absent"
        if status == 200:
            text = body.decode("utf-8")
            load_baseline(text)                        # validate before trusting it
            open(out, "w", encoding="utf-8").write(text)
            return "ok"
        last = last or f"HTTP {status}"
        if n < tries - 1:
            sleep(min(2 ** (n + 1), 30))
    raise SystemExit(f"ERROR: could not read the live page state ({last}); refusing to treat an unreadable "
                     f"baseline as a first run")


def _cmd_fetch(a):
    print(f"baseline={fetch_baseline(a.out)}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("decide", help="print proceed=true|false for a freshness-aware run")
    d.add_argument("--delta", required=True)
    d.add_argument("--freshness", default="false")
    d.add_argument("--sha", default="")
    d.add_argument("--reseed", default="false")
    d.set_defaults(fn=_cmd_decide)
    f = sub.add_parser("fetch-baseline", help="capture the previous LIVE page state before building")
    f.add_argument("--out", required=True)
    f.set_defaults(fn=_cmd_fetch)
    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
