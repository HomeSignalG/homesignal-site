#!/usr/bin/env python3
"""Verify a redirect service for the old host (Jody migration, Step 5).

  --simulate DIR   evaluate the generated rules in DIR. Netlify folder: `_redirects` with a small Netlify-subset interpreter
                   (first match wins, `200!` serves the file, `301!` redirects, `:splat`). Render folder (has render.yaml):
                   the Blueprint route, with Render's documented precedence (a rule applies ONLY when no file exists at
                   the path). Proves OUR RULES; it cannot prove the host - in particular it ASSUMES the host keeps the
                   query string, which only the live probe can show.
  --base URL       probe a LIVE deployment (a *.netlify.app / *.onrender.com preview before DNS, homesignal.net after) with
                   real HTTP and no redirect-following: it must answer the same way the simulator says it should.
  --require-https  with --base: refuse a non-https base (the real test must prove TLS).
  --query-order sorted  with --base: accept Render's measured key sorting (see sorted_query); default `exact` is unchanged.

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
    ("/community/76227/", "redirect", f"{ORIGIN}/community/76227/"),
    ("/homesignalmap.html?zip=76227", "redirect", f"{ORIGIN}/homesignalmap.html?zip=76227"),
    ("/shared-report.html?r=abc123&utm_medium=email", "redirect", f"{ORIGIN}/shared-report.html?r=abc123&utm_medium=email"),
    ("/unsubscribe.html?t=a1b2c3d4e5&z=76227", "redirect", f"{ORIGIN}/unsubscribe.html?t=a1b2c3d4e5&z=76227"),
    ("/search.html?q=a%2Fb&v=%E2%9C%93&e=&d=1&d=2", "redirect", f"{ORIGIN}/search.html?q=a%2Fb&v=%E2%9C%93&e=&d=1&d=2"),
    ("/community/84302", "redirect", f"{ORIGIN}/community/84302"),
    ("/homesignalmap.html?zip=84302&utm_source=bluesky", "redirect", f"{ORIGIN}/homesignalmap.html?zip=84302&utm_source=bluesky"),
    ("/unsubscribe.html?t=abc", "redirect", f"{ORIGIN}/unsubscribe.html?t=abc"),
    ("/shared-report.html", "redirect", f"{ORIGIN}/shared-report.html"),
    ("/sitemap.xml", "redirect", f"{ORIGIN}/sitemap.xml"),
    ("/sitemaps/zip-alerts.xml", "redirect", f"{ORIGIN}/sitemaps/zip-alerts.xml"),
    ("/og-default.png", "redirect", f"{ORIGIN}/og-default.png"),
    ("/some/unknown/path", "redirect", f"{ORIGIN}/some/unknown/path"),
    ("/.well-known/did.json", "file", ".well-known/did.json"),
    ("/google59e1ae3ef6b75e3a.html", "file", "google59e1ae3ef6b75e3a.html"),
    ("/robots.txt", "file", "robots.txt"),
]


def sorted_query(url: str) -> str:
    """Founder-approved 2026-10-13 (Render re-sorts query keys, measured live): the SAME pairs, STABLE-sorted by key, every
    byte of every key=value pair untouched (so duplicate keys keep their relative order, `%2F` is not decoded, an empty
    value stays `e=`). This is a defined transformation, not a loosening: a dropped, re-encoded, merged or re-valued
    parameter still differs and is refused."""
    base, sep, q = url.partition("?")
    if not sep or not q:
        return url
    pairs = q.split("&")
    return base + "?" + "&".join(sorted(pairs, key=lambda p: p.split("=", 1)[0]))


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


def parse_render(text: str) -> tuple[str, str, str]:
    """(source, destination, publish path) from the generated Blueprint. Fails on anything but ONE redirect route."""
    routes = re.findall(r"- type: (\w+)\n\s+source: (\S+)\n\s+destination: (\S+)", text)
    pub = re.search(r"staticPublishPath: (\S+)", text)
    if len(routes) != 1 or routes[0][0] != "redirect" or not pub:
        raise ValueError(f"render.yaml must hold exactly one redirect route and a publish path: {routes} {pub}")
    return routes[0][1], routes[0][2], pub.group(1)


def decide_render(source: str, dest: str, pub: Path, path_q: str):
    u = urlsplit(path_q)
    rel = u.path.lstrip("/")
    f = pub / rel
    if rel and f.is_file():           # Render: a rule is NOT applied when a resource exists at the path
        return ("file", rel)
    if not (source.endswith("/*") and u.path.startswith(source[:-1])):
        return ("none", "")
    # Measured on the real host 2026-10-13 (run 38405046317): Render keeps every byte but sorts the query keys.
    return ("redirect", sorted_query(dest.replace("*", u.path[len(source) - 1:]) + (("?" + u.query) if u.query else "")))


def simulate_render(d: Path) -> list[str]:
    bad = []
    source, dest, pubname = parse_render((d / "render.yaml").read_text())
    pub = d / pubname
    if source != "/*" or not dest.endswith("/*"):
        bad.append(f"the route must be the permanent catch-all /* -> <origin>/*, got {source} -> {dest}")
    if dest != ORIGIN + "/*":
        bad.append(f"destination {dest} is not {ORIGIN}/*")
    if (pub / "index.html").exists():
        bad.append("an index.html in the publish dir would answer / with 200 instead of redirecting")
    published = sorted(p.relative_to(pub).as_posix() for p in pub.rglob("*") if p.is_file())
    allowed = {".well-known/did.json", "robots.txt"} | {n for n in (p.name for p in pub.iterdir()) if re.fullmatch(r"google[0-9a-f]+\.html", n)}
    if set(published) != allowed:
        bad.append(f"publish dir holds {published}, expected exactly {sorted(allowed)}")
    for req, kind, want in CASES:
        got = decide_render(source, dest, pub, req)
        if kind == "redirect":
            want = sorted_query(want)
        if got != (kind, want):
            bad.append(f"{req}: expected {(kind, want)}, rules say {got}")
    return bad


def simulate(d: Path) -> list[str]:
    if (d / "render.yaml").is_file():
        return simulate_render(d)
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


def probe(base: str, d: Path | None, require_https: bool = False, query_order: str = "exact") -> list[str]:
    bad = []
    if require_https and not base.startswith("https://"):
        return [f"base {base} is not https; the real test must prove TLS"]
    host = urlsplit(base).netloc.lower()
    op = urllib.request.build_opener(_NoFollow)
    for req, kind, want in CASES:
        try:
            r = op.open(urllib.request.Request(base.rstrip("/") + req, headers={"User-Agent": "redirect-verify"}), timeout=20)
            status, loc, body = r.status, r.headers.get("Location"), r.read()
        except urllib.error.HTTPError as e:
            status, loc, body = e.code, e.headers.get("Location"), b""
        if kind == "redirect":
            want_n = sorted_query(want) if query_order == "sorted" else want
            if status != 301 or loc != want_n:
                bad.append(f"{req}: got {status} -> {loc}, want 301 -> {want_n}")
            elif urlsplit(loc).netloc.lower() == host:
                bad.append(f"{req}: redirects to its own host ({loc}) - a loop")
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
    ap.add_argument("--files", help="the folder whose files are served (the publish dir), to compare served bytes (with --base)")
    ap.add_argument("--require-https", action="store_true")
    ap.add_argument("--query-order", choices=("exact", "sorted"), default="exact",
                    help="exact (default): the Location must carry the original query string byte for byte. sorted: the original "
                         "pairs stable-sorted by key, values untouched (what Render measurably does; founder-approved 2026-10-13)")
    a = ap.parse_args(argv)
    if not (a.simulate or a.base):
        ap.error("give --simulate DIR and/or --base URL")
    bad = []
    if a.simulate:
        bad += [f"[rules] {b}" for b in simulate(Path(a.simulate))]
    if a.base:
        bad += [f"[live] {b}" for b in probe(a.base, Path(a.files) if a.files else None, a.require_https, a.query_order)]
    print(json.dumps({"ok": not bad, "cases": len(CASES), "problems": bad}, indent=2))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
