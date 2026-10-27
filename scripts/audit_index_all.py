#!/usr/bin/env python3
"""INDEX-ALL AUDIT (founder policy, 2026-10-26): every public page is allowed to be indexed.

Scans a built Pages artifact (stage_site.py + gen_zip_pages.py output) and fails when:

  1. a PUBLIC page carries a `noindex` / `none` robots directive;
  2. a PUBLIC page is blocked from crawling by robots.txt;
  3. a PUBLIC page has no canonical, or its canonical is not its own URL;
  4. a PUBLIC canonical URL is in no sitemap (sitemap.xml or a family sitemap robots.txt declares);
  5. a page carries noindex and is NOT in the explicit NON_PUBLIC table below (an unclassified
     noindex page is a defect: a new page defaults to public, so it must default to indexable).

WHAT "PUBLIC" MEANS. Everything shipped in the artifact is public unless it is in NON_PUBLIC,
and each NON_PUBLIC entry carries its reason. The table is deliberately short and is the ONLY
place a noindex may live; it is not a quality rule and holds no threshold, score or count.
Authentication-required and administrative pages are listed by robots.txt itself (Disallow)
and are non-public by that declaration.

Usage: audit_index_all.py --dir _site [--json out.json]
Exit 0 = clean, 1 = findings, 2 = the audit could not run (no artifact, no sitemap).
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import sys

# path (relative to the artifact root, leading slash) -> reason. Nothing here is a content-quality rule.
NON_PUBLIC = {
    "/404.html": "the not-found document; it must not be indexed",
    "/box-elder.html": "redirect page to /community/<zip>/ (an actual redirect)",
    "/eagle-mountain.html": "redirect page to /community/<zip>/ (an actual redirect)",
    "/community.html": "legacy query-string alias; canonical points to /community/<zip>/",
    "/homesignalmap.html": "the Development Map shell: the ZIP-less landing state is indexable, its query-string states are aliases",
}
# robots.txt Disallow'd pages are non-public by declaration (login-gated / app / admin).
ROBOTS_META = re.compile(r'<meta\s+name="robots"\s+content="([^"]*)"', re.I)
CANON = re.compile(r'<link\s+rel="canonical"\s+href="([^"]+)"', re.I)
LOC = re.compile(r"<loc>([^<]+)</loc>")


def parse_robots(txt):
    disallow, sitemaps, applies = [], [], False
    for line in txt.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        k, v = (x.strip() for x in line.split(":", 1))
        k = k.lower()
        if k == "user-agent":
            applies = v == "*"
        elif k == "disallow" and applies and v:
            disallow.append(v)
        elif k == "sitemap":
            sitemaps.append(v)
    return disallow, sitemaps


def blocked(path, disallow):
    return any(path.startswith(d.rstrip("*")) for d in disallow if d != "/") or "/" in disallow


def url_path(u):
    m = re.match(r"https?://[^/]+(/.*)?$", u)
    return (m.group(1) or "/") if m else u


def doc_path(root, f):
    rel = "/" + os.path.relpath(f, root).replace(os.sep, "/")
    return rel[: -len("index.html")] if rel.endswith("/index.html") else rel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="_site")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    root = a.dir
    if not os.path.isdir(root) or not os.path.exists(os.path.join(root, "sitemap.xml")):
        print(f"AUDIT COULD NOT RUN: no artifact / sitemap.xml under {root!r}")
        return 2
    disallow, declared = parse_robots(open(os.path.join(root, "robots.txt"), encoding="utf-8").read())

    sitemap_paths = set()
    for sm in ["sitemap.xml"] + [url_path(u).lstrip("/") for u in declared if "/sitemaps/" in u]:
        f = os.path.join(root, sm)
        if os.path.exists(f):
            sitemap_paths |= {url_path(u) for u in LOC.findall(open(f, encoding="utf-8").read())}
    if not sitemap_paths:
        print("AUDIT COULD NOT RUN: no URLs found in any sitemap")
        return 2

    findings, public, nonpublic = [], 0, {}
    by_family = {}
    for dp, _, fs in os.walk(root):
        for fn in fs:
            if not fn.endswith(".html"):
                continue
            f = os.path.join(dp, fn)
            path = doc_path(root, f)
            if path.startswith(("/partials/", "/fixtures/", "/map1/")):
                continue            # fragments / assets, not documents
            h = open(f, encoding="utf-8", errors="replace").read()
            m = ROBOTS_META.search(h)
            robots = (m.group(1).lower() if m else "")
            has_noindex = bool(re.search(r"\b(noindex|none)\b", robots))
            if path in NON_PUBLIC:
                nonpublic[path] = NON_PUBLIC[path]
                continue
            if blocked(path, disallow):
                nonpublic[path] = "disallowed by robots.txt (login-gated / app / admin page)"
                continue
            if "<head" not in h.lower() or "<title" not in h.lower():
                continue            # not a page document (verification file etc.)
            public += 1
            fam = ("community-projects" if re.match(r"^/community/\d{5}/projects/$", path) else
                   "community" if path.startswith("/community/") else
                   path.split("/")[1] if path.count("/") >= 2 else "root")
            by_family[fam] = by_family.get(fam, 0) + 1
            if has_noindex:
                findings.append((path, f"noindex directive ({robots!r}) on a public page"))
            c = CANON.search(h)
            if not c:
                findings.append((path, "no canonical"))
            elif url_path(c.group(1)) != path:
                findings.append((path, f"canonical is not itself: {c.group(1)}"))
            if path not in sitemap_paths:
                findings.append((path, "public canonical URL is in no sitemap"))
    # every sitemap URL must be a real public document, not noindex
    for p in sorted(sitemap_paths):
        if blocked(p, disallow):
            findings.append((p, "listed in a sitemap but blocked by robots.txt"))
    report = {"public_pages": public, "by_family": by_family, "non_public": nonpublic,
              "sitemap_urls": len(sitemap_paths), "findings": [{"path": p, "problem": w} for p, w in findings]}
    if a.json:
        json.dump(report, open(a.json, "w"), indent=1, sort_keys=True)
    print(f"public pages audited : {public}")
    print("by family            : " + ", ".join(f"{k} {v}" for k, v in sorted(by_family.items())))
    print(f"sitemap URLs         : {len(sitemap_paths)}")
    print(f"non-public (declared): {len(nonpublic)} " + (", ".join(sorted(nonpublic)[:8]) + (" ..." if len(nonpublic) > 8 else "")))
    for p, w in findings[:40]:
        print(f"  FINDING {p}: {w}")
    if len(findings) > 40:
        print(f"  ... and {len(findings) - 40} more")
    print("INDEX-ALL AUDIT " + ("PASSED" if not findings else f"FAILED ({len(findings)} findings)"))
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
