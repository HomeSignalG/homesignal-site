#!/usr/bin/env python3
"""Brand overlay for a STAGED artifact (Jody migration, Step 3).

Reads the brand contract (docs/brand/brand-contract.v1.json, the one authority) and rewrites a tree
that scripts/stage_site.py (+ gen_zip_pages.py) already produced. It never touches the source tree,
so the live HomeSignal build is byte-for-byte unaffected: `--identity homesignal` is a verified no-op.

What it changes for `--identity jody`
  * public origin  https://homesignal.net / https://www.homesignal.net  -> the contract's Jody origin
    (canonicals, og:url, sitemaps, robots, JSON-LD, the two shipped host allowlists)
  * bare host      homesignal.net -> jodytracks.com   (but NOT inside an e-mail address or a did:web id)
  * display name   HomeSignal -> Jody ; HomeSignal.net -> jodytracks.com
  * tagline        "Know what's coming." on the home page title and the footer
  * --staging      the tree is made un-indexable: noindex on every page, robots.txt disallows all,
                   sitemaps/CNAME/indexnow key are removed.  A staging tree can never be mistaken for a launch.

What it deliberately does NOT change (each is an identifier or an external dependency, not a brand word)
  * file paths and URLs' paths (identical-path SEO migration, Step 4): homesignalmap.html stays
  * e-mail addresses (@homesignal.net): the Jody mailboxes do not exist until Step 6
  * did:web:homesignal.net (immutable Bluesky identity), the Supabase project, repo names, CSS/storage keys
Every rule is counted; a rule that matches nothing in a tree where it must, or a leftover the
scanner cannot classify, FAILS the run. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

CONTRACT = Path(__file__).resolve().parent.parent / "docs" / "brand" / "brand-contract.v1.json"
TEXT_EXT = {".html", ".js", ".json", ".xml", ".txt", ".css", ".svg", ".webmanifest", ".md", ".csv"}
TAGLINE = "Know what’s coming."
TAGLINE_ASCII = "Know what's coming."

# A bare host, but not part of an e-mail address, a did:web id, or a longer hostname.
HOST_RE = re.compile(r"(?<![@:\w.\-])(www\.)?homesignal\.net(?![\w\-])")
ORIGIN_RE = re.compile(r"https://(?:www\.)?homesignal\.net(?![\w\-])")
# A link VALIDATOR written as a regex literal. The server still emits homesignal.net links until Step 8,
# so the Jody build must accept BOTH origins (rewriting to the new one alone would reject every link).
ESC_ORIGIN_RE = re.compile(r"https:\\/\\/homesignal\\\.net")
# The two-tone wordmark: Home<span ...>Signal</span>  ->  Jo<span ...>dy</span> (keeps the accent styling).
WORDMARK_RE = re.compile(r"Home<span([^>]*)>Signal</span>")
NAME_NET_RE = re.compile(r"HomeSignal\.net(?![\w\-])")
NAME_RE = re.compile(r"HomeSignal(?![\w\-])")

# What may remain after rewriting a jody tree (everything else is a defect).
ALLOWED_LEFTOVER = [
    re.compile(r"[A-Za-z0-9._%+\-]+@homesignal\.net"),      # mailboxes, until Step 6
    re.compile(r"did:web:homesignal\.net"),                  # immutable Bluesky identity
    re.compile(r"homesignal-(?:ingest|site|tracker|video|zip-order)[A-Za-z0-9._\-/]*"),
    re.compile(r"homesignalmap[A-Za-z0-9_.\-]*"),            # file names / ids, identical paths
    re.compile(r"homesignal_[a-z_.]+"),                      # database identifiers
    re.compile(r"\(\?:homesignal\\\.net\|"),                       # the dual-origin validator this script writes
    re.compile(r"'@homesignal'|@homesignal'"),                    # iCalendar UID suffix (an identifier)
    re.compile(r"window\.HomeSignalVideoProducer(?:\.init)?"),   # JS global identifier
    re.compile(r"https://www\.reddit\.com/user/HomeSignalnet"),  # an external account handle
    re.compile(r"HomeSignal-detected"),                            # a code comment
    re.compile(r"homesignalphase1_13\.html"),
]


def load_contract(path: Path = CONTRACT) -> dict:
    c = json.loads(path.read_text(encoding="utf-8"))
    for k in ("identities", "current_identity", "future_identity"):
        if k not in c:
            sys.exit(f"ERROR: brand contract has no {k!r}")
    return c


def _is_text(p: Path) -> bool:
    return p.suffix.lower() in TEXT_EXT or p.name in {"CNAME", "robots.txt"}


def rewrite_text(s: str, origin: str, host: str) -> tuple[str, dict]:
    n = {}
    s, n["esc"] = ESC_ORIGIN_RE.subn(lambda m: r"https:\/\/(?:homesignal\.net|" + host.replace(".", r"\.") + ")", s)
    s, n["origin"] = ORIGIN_RE.subn(origin, s)
    s, n["host"] = HOST_RE.subn(lambda m: ("www." + host) if m.group(1) else host, s)
    s, n["wordmark"] = WORDMARK_RE.subn(r"Jo<span\1>dy</span>", s)
    s, n["name_net"] = NAME_NET_RE.subn(host, s)
    s, n["name"] = NAME_RE.subn("Jody", s)
    return s, n


def _noindex(html: str) -> str:
    if re.search(r'<meta[^>]+name=["\']robots["\']', html, re.I):
        html = re.sub(r'(<meta[^>]+name=["\']robots["\'][^>]+content=["\'])[^"\']*(["\'])',
                      r"\1noindex, nofollow\2", html, flags=re.I)
        return html
    meta = '\n<meta name="robots" content="noindex, nofollow">'
    # `<head` must not match `<header`: the group requires whitespace or `>` right after the word.
    return re.sub(r"<head(\s[^>]*)?>", lambda m: f"<head{m.group(1) or ''}>{meta}", html, count=1, flags=re.I)


def apply_tagline(rel: str, s: str) -> tuple[str, int]:
    hits = 0
    if rel == "index.html":
        s2 = re.sub(r"(<title>Jody)[^<]*(</title>)", rf"\1 — {TAGLINE}\2", s, count=1)
        hits += int(s2 != s)
        s = s2
        s2 = re.sub(r'(property="og:title" content=")[^"]*(")', rf"\1Jody — {TAGLINE}\2", s, count=1)
        hits += int(s2 != s)
        s = s2
        s2 = re.sub(r'(name="twitter:title" content=")[^"]*(")', rf"\1Jody — {TAGLINE}\2", s, count=1)
        hits += int(s2 != s)
        s = s2
    if rel == "partials/shell.html":
        s2 = re.sub(r'(<footer class="hs-footer" id="hs-footer">)',
                    rf'\1\n  <p class="hs-footer__tagline">{TAGLINE}</p>', s, count=1)
        hits += int(s2 != s)
        s = s2
    return s, hits


def leftovers(text: str) -> list[str]:
    masked = text
    for rx in ALLOWED_LEFTOVER:
        masked = rx.sub("\0", masked)
    return re.findall(r"[A-Za-z0-9_.@:/\-]*[Hh]ome[Ss]ignal[A-Za-z0-9_.@:/\-]*", masked)


def run(root: Path, identity: str, staging: bool, contract: dict) -> dict:
    ident = contract["identities"].get(identity)
    if ident is None:
        sys.exit(f"ERROR: unknown identity {identity!r}")
    report = {"identity": identity, "staging": staging, "files": 0, "changed": 0,
              "counts": {"wordmark": 0, "esc": 0, "origin": 0, "host": 0, "name_net": 0, "name": 0, "tagline": 0, "noindex": 0},
              "leftovers": {}}
    if identity == contract["current_identity"]:
        if staging:
            sys.exit("ERROR: --staging is only meaningful for a non-current identity")
        return report                                   # verified no-op: the live brand is untouched
    origin = ident["origin"].rstrip("/")
    host = origin.split("://", 1)[1]
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if re.fullmatch(r"google[0-9a-f]+\.html", rel):
            p.unlink()            # a site-verification token proves ownership of the OLD domain only
            continue
        if staging and (rel in {"CNAME", "indexnow.txt"} or rel.startswith("sitemaps/") or rel == "sitemap.xml"):
            p.unlink()
            continue
        report["files"] += 1
        if not _is_text(p):
            continue
        before = p.read_text(encoding="utf-8")
        after, n = rewrite_text(before, origin, host)
        for k, v in n.items():
            report["counts"][k] += v
        after, t = apply_tagline(rel, after)
        report["counts"]["tagline"] += t
        if p.suffix == ".html":
            if staging:
                after = _noindex(after)
                report["counts"]["noindex"] += 1
        if rel == "robots.txt" and staging:
            after = "User-agent: *\nDisallow: /\n"
        if after != before:
            p.write_text(after, encoding="utf-8")
            report["changed"] += 1
        left = leftovers(after)
        if left:
            report["leftovers"][rel] = sorted(set(left))[:10]
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dir", required=True)
    ap.add_argument("--identity", required=True)
    ap.add_argument("--staging", action="store_true")
    ap.add_argument("--contract", default=str(CONTRACT))
    ap.add_argument("--report", default="")
    a = ap.parse_args(argv)
    contract = load_contract(Path(a.contract))
    root = Path(a.dir)
    if not root.is_dir():
        sys.exit(f"ERROR: {root} is not a directory")
    rep = run(root, a.identity, a.staging, contract)
    print(json.dumps(rep, indent=2, sort_keys=True))
    if a.report:
        Path(a.report).write_text(json.dumps(rep, indent=2, sort_keys=True))
    if rep["leftovers"]:
        print("ERROR: unclassified HomeSignal strings remain in the rewritten tree", file=sys.stderr)
        return 1
    if rep["identity"] != contract["current_identity"] and (rep["counts"]["origin"] + rep["counts"]["host"]) == 0:
        print("ERROR: no origin was rewritten - the overlay ran over nothing", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
