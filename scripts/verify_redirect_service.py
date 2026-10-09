#!/usr/bin/env python3
"""Verify a redirect service for the old host (Jody migration, Step 5).

  --simulate DIR   evaluate the generated `_redirects` in DIR with a small Netlify-subset interpreter (first match wins,
                   `200!` serves the file, `301!` redirects, `:splat`). Proves OUR RULES; it cannot prove the host.
  --base URL       probe a LIVE deployment (a *.netlify.app preview before DNS, homesignal.net after) with real HTTP and
                   no redirect-following: it must answer the same way the simulator says it should.

Cases come from one list (paths a crawler or a resident really uses). Exit 0 only when every case holds.
Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ORIGIN = "https://jodytracks.com"

# (request path+query, expected kind, expected Location or file)
CASES = [
    ("/", "redirect", f"{ORIGIN}/"),
    ("/index.html", "redirect", f"{ORIGIN}/index.html"),
    ("/community/84302/", "redirect", f"{ORIGIN}/community/84302/"),
    ("/community/84302", "redirect", f"{ORIGIN}/community/84302"),
    ("/homesignalmap.html?zip=84302&utm_source=bluesky", "redirect", f"{ORIGIN}/homesignalmap.html?zip=84302&utm_source=bluesky"),
    ("/unsubscribe.html?t=abc", "redirect", f"{ORIGIN}/unsubscribe.html?t=abc"),
    ("/shared-report.html", "redirect", f"{ORIGIN}/shared-report.html"),
    ("/sitemap.xml", "redirect", f"{ORIGIN}/sitemap.xml"),
    ("/sitemaps/zip-alerts.xml", "redirect", f"{ORIGIN}/sitemaps/zip-alerts.xml"),
    ("/og-default.png", "redirect", f"{ORIGIN}/og-default.png"),
    ("/some/unknown/path", "redirect", f"{ORIGIN}/some/unknown/path"),
    ("/.well-known/did.json", "file", ".well-known/did.json"),
    ("/robots.txt", "file", "robots.txt"),
]


def parse_rules(text: str) -> list[tuple[str, str, int, bool]]:
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.fullmatch(r"(\S+)\s+(\S+)\s+(\d{3})(!?)", line)
        if not m:
            raise ValueError(f"unparseable rule: {line!r}")
        out.append((m.group(1), m.group(2), int(m.group(3)), bool(m.group(4))))
    return out


def decide(rules, path_q: str):
    u = urlsplit(path_q)
    for frm, to, status, _force in rules:
        if frm.endswith("/*"):
            if not u.path.startswith(frm[:-1]):
                continue
            splat = u.path[len(frm) - 1:]
        elif u.path == frm:
            splat = ""
        else:
            continue
        if status == 200:
            return ("file", to.lstrip("/"))
        dest = to.replace(":splat", splat)
        return ("redirect", dest + (("?" + u.query) if u.query else ""))
    return ("none", "")


def simulate(d: Path) -> list[str]:
    bad = []
    rules = parse_rules((d / "_redirects").read_text())
    if not rules or rules[-1][0] != "/*" or rules[-1][2] != 301:
        bad.append("the last rule must be the permanent catch-all")
    seen_catch = False
    for frm, _to, st, _f in rules:
        if seen_catch and st == 200:
            bad.append(f"a serve-rule ({frm}) sits AFTER the catch-all and can never match")
        if frm == "/*":
            seen_catch = True
    for req, kind, want in CASES:
        got = decide(rules, req)
        if got != (kind, want):
            bad.append(f"{req}: expected {(kind, want)}, rules say {got}")
        if kind == "file" and not (d / want).is_file():
            bad.append(f"{req}: the file {want} is not in the folder")
    return bad


class _NoFollow(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def probe(base: str, d: Path | None) -> list[str]:
    bad = []
    op = urllib.request.build_opener(_NoFollow)
    for req, kind, want in CASES:
        try:
            r = op.open(urllib.request.Request(base.rstrip("/") + req, headers={"User-Agent": "redirect-verify"}), timeout=20)
            status, loc, body = r.status, r.headers.get("Location"), r.read()
        except urllib.error.HTTPError as e:
            status, loc, body = e.code, e.headers.get("Location"), b""
        if kind == "redirect":
            if status != 301 or loc != want:
                bad.append(f"{req}: got {status} -> {loc}, want 301 -> {want}")
        else:
            if status != 200:
                bad.append(f"{req}: got {status}, want 200")
            elif d is not None and body != (d / want).read_bytes():
                bad.append(f"{req}: served bytes differ from the built file")
    return bad


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--simulate")
    ap.add_argument("--base")
    ap.add_argument("--files", help="the built folder, to compare served bytes (with --base)")
    a = ap.parse_args(argv)
    if not (a.simulate or a.base):
        ap.error("give --simulate DIR and/or --base URL")
    bad = []
    if a.simulate:
        bad += [f"[rules] {b}" for b in simulate(Path(a.simulate))]
    if a.base:
        bad += [f"[live] {b}" for b in probe(a.base, Path(a.files) if a.files else None)]
    print(json.dumps({"ok": not bad, "cases": len(CASES), "problems": bad}, indent=2))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
