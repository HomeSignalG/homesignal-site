#!/usr/bin/env python3
"""SEO parity between two built trees of the SAME data snapshot (Jody migration, Step 4).

  --a  the HomeSignal tree (the live brand)
  --b  the Jody LAUNCH tree (scripts/brand_stage.py --identity jody, without --staging)

Because both trees are produced from ONE generation (the overlay is applied to a copy), the data snapshot is
frozen by construction: any difference below is the migration's, never the data's. The comparison proves the
property that matters for a domain move - every page that is indexable today is indexable at the same path
tomorrow, with the same directive, and nothing is lost, added, or pointed at the old host:

  1. identical set of document paths (the only allowed absence is the old domain's site-verification token)
  2. per page: identical robots directive, identical canonical PATH, canonical HOST moved a -> b
  3. the indexable set (no noindex) is identical, and non-empty (a zero-vs-zero comparison proves nothing)
  4. sitemaps: identical path sets and lastmods per file, hosts moved a -> b, no duplicate, no query-string url
  5. robots.txt: identical rules; Sitemap lines identical modulo host
  6. b contains no reference to a's origin (canonical, og:url, JSON-LD, sitemap, robots)
  7. page-state baseline (sitemaps/page-state.json): identical per-page fingerprints, host moved a -> b. When b was GENERATED
     under the Jody host (an activated build) its fingerprints legitimately differ, because a fingerprint hashes the page text
     and that text names its own host. The difference is then PROVEN host-derived, page by page, never assumed: a's written
     page is mapped to the Jody host and re-fingerprinted, and must equal b's stored fingerprint. A control runs first: a's page
     re-fingerprinted UNMAPPED must reproduce a's own stored fingerprint, or that page cannot be proven and is reported. One
     page that changed in any other way (text, robots, JSON-LD, a project record) fails the proof and is named.

Exit 0 only when every check holds. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import page_semantics as _ps  # noqa: E402  (the ONE fingerprint definition; never re-implemented here)
from urllib.parse import urlsplit

A_HOST = "homesignal.net"
B_HOST = "jodytracks.com"
ALLOWED_ONLY_IN_A = re.compile(r"google[0-9a-f]+\.html")     # a site-verification token proves the OLD domain only


def _page_file(root: Path, key: str) -> Path:
    return root / (key.lstrip("/") + ("index.html" if key.endswith("/") else ""))


def host_derived_fingerprint_problems(root_a: Path, da: dict, db: dict) -> tuple[list[str], int]:
    """Prove, page by page, that b's fingerprints differ from a's ONLY because the page names another host.

    Returns (problems, pages_proven). A page is proven when (control) a's own page, with the build day put back as the token the
    renderer fingerprints, reproduces a's stored fingerprint, AND (proof) the same text with a's origin mapped to b's reproduces b's
    stored fingerprint. A page failing the control is reported as unprovable, never skipped; a page failing the proof is reported as
    changed. The pages must also agree on indexability."""
    pa, pb = da.get("pages", {}), db.get("pages", {})
    day = str(da.get("built_at", ""))[:10]
    problems: list[str] = []
    if sorted(pa) != sorted(pb):
        return ["page-state page sets differ"], 0
    if not day:
        return ["page-state has no build day; the host proof cannot be run"], 0
    proven = 0
    for key in sorted(pa):
        f = _page_file(root_a, key)
        if not f.is_file():
            problems.append(f"{key}: page file missing in tree a; cannot prove")
            continue
        text = f.read_text(encoding="utf-8")
        ctl = None
        for restore in (_ps.BUILD_DAY_TOKEN, _ps.NEUTRAL_AS_OF):
            t = text.replace(day, restore)
            if _ps.fingerprint(t) == pa[key]["h"]:
                ctl = t
                break
        if ctl is None:
            problems.append(f"{key}: control failed (tree a's own page does not reproduce its stored fingerprint); cannot prove")
            continue
        if pa[key].get("i") != pb[key].get("i"):
            problems.append(f"{key}: indexability differs")
            continue
        if _ps.fingerprint(ctl.replace(f"https://{A_HOST}", f"https://{B_HOST}")) != pb[key]["h"]:
            problems.append(f"{key}: fingerprint differs for a reason other than the host")
            continue
        proven += 1
    return problems, proven


def _walk(root: Path) -> dict[str, Path]:
    return {p.relative_to(root).as_posix(): p for p in root.rglob("*") if p.is_file()}


def _robots_meta(html: str) -> str | None:
    m = re.search(r'<meta[^>]+name=["\']robots["\'][^>]*content=["\']([^"\']*)["\']', html, re.I)
    if not m:
        m2 = re.search(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*name=["\']robots["\']', html, re.I)
        m = m2
    return re.sub(r"\s+", " ", m.group(1)).strip().lower() if m else None


def _canonical(html: str) -> str | None:
    m = re.search(r'<link[^>]+rel=["\']canonical["\'][^>]*href=["\']([^"\']+)["\']', html, re.I)
    if not m:
        m = re.search(r'<link[^>]+href=["\']([^"\']+)["\'][^>]*rel=["\']canonical["\']', html, re.I)
    return m.group(1) if m else None


def _split(url: str) -> tuple[str, str]:
    u = urlsplit(url)
    return u.netloc, (u.path or "/") + (("?" + u.query) if u.query else "")


def _sitemap_entries(xml: str) -> list[tuple[str, str]]:
    out = []
    for blk in re.findall(r"<url>(.*?)</url>", xml, re.S):
        loc = re.search(r"<loc>\s*([^<\s]+)\s*</loc>", blk)
        lm = re.search(r"<lastmod>\s*([^<\s]+)\s*</lastmod>", blk)
        if loc:
            out.append((loc.group(1), lm.group(1) if lm else ""))
    return out


def compare(a: Path, b: Path) -> dict:
    fa, fb = _walk(a), _walk(b)
    problems: list[str] = []
    stats = {"files_a": len(fa), "files_b": len(fb)}

    only_a = sorted(set(fa) - set(fb))
    only_b = sorted(set(fb) - set(fa))
    bad_only_a = [p for p in only_a if not ALLOWED_ONLY_IN_A.fullmatch(p)]
    if bad_only_a:
        problems.append(f"paths only in the HomeSignal tree: {bad_only_a[:5]} (+{max(0, len(bad_only_a) - 5)})")
    if only_b:
        problems.append(f"paths only in the Jody tree: {only_b[:5]} (+{max(0, len(only_b) - 5)})")

    common = sorted(set(fa) & set(fb))
    html = [p for p in common if p.endswith(".html")]
    stats["html_pages"] = len(html)
    indexable_a, indexable_b = set(), set()
    directive_diff, canon_diff, canon_host_bad, old_origin_in_b = [], [], [], []
    for p in html:
        ta, tb = fa[p].read_text(encoding="utf-8"), fb[p].read_text(encoding="utf-8")
        ra, rb = _robots_meta(ta), _robots_meta(tb)
        if ra != rb:
            directive_diff.append((p, ra, rb))
        if not ra or "noindex" not in ra:
            indexable_a.add(p)
        if not rb or "noindex" not in rb:
            indexable_b.add(p)
        ca, cb = _canonical(ta), _canonical(tb)
        if (ca is None) != (cb is None):
            canon_diff.append((p, ca, cb))
        elif ca:
            ha, pa = _split(ca)
            hb, pb = _split(cb)
            if pa != pb:
                canon_diff.append((p, ca, cb))
            if ha == A_HOST and hb != B_HOST:
                canon_host_bad.append((p, cb))
        if re.search(r"https://(?:www\.)?" + re.escape(A_HOST), tb):
            old_origin_in_b.append(p)
    if directive_diff:
        problems.append(f"robots directive differs on {len(directive_diff)} page(s): {directive_diff[:3]}")
    if canon_diff:
        problems.append(f"canonical PATH differs on {len(canon_diff)} page(s): {canon_diff[:3]}")
    if canon_host_bad:
        problems.append(f"canonical host did not move to {B_HOST} on {len(canon_host_bad)} page(s): {canon_host_bad[:3]}")
    if old_origin_in_b:
        problems.append(f"the Jody tree still references {A_HOST} in {len(old_origin_in_b)} page(s): {old_origin_in_b[:5]}")
    stats["indexable_a"], stats["indexable_b"] = len(indexable_a), len(indexable_b)
    if indexable_a != indexable_b:
        problems.append(f"indexable sets differ: -{sorted(indexable_a - indexable_b)[:3]} +{sorted(indexable_b - indexable_a)[:3]}")
    if not indexable_a:
        problems.append("no indexable page in the HomeSignal tree - the comparison would prove nothing")

    # sitemaps
    sm = [p for p in common if p == "sitemap.xml" or (p.startswith("sitemaps/") and p.endswith(".xml"))]
    stats["sitemap_files"] = len(sm)
    stats["sitemap_urls_a"] = stats["sitemap_urls_b"] = 0
    for p in sm:
        ea, eb = _sitemap_entries(fa[p].read_text(encoding="utf-8")), _sitemap_entries(fb[p].read_text(encoding="utf-8"))
        stats["sitemap_urls_a"] += len(ea)
        stats["sitemap_urls_b"] += len(eb)
        pa = [(_split(u)[1], lm) for u, lm in ea]
        pb = [(_split(u)[1], lm) for u, lm in eb]
        if sorted(pa) != sorted(pb):
            problems.append(f"{p}: path/lastmod set differs ({len(pa)} vs {len(pb)})")
        if len({u for u, _ in eb}) != len(eb):
            problems.append(f"{p}: duplicate url in the Jody sitemap")
        if any(_split(u)[0] != B_HOST for u, _ in eb):
            problems.append(f"{p}: a Jody sitemap url is not on {B_HOST}")
        if any(("?" in _split(u)[1]) for u, _ in eb) and not any(("?" in _split(u)[1]) for u, _ in ea):
            problems.append(f"{p}: the Jody sitemap gained a query-string url")
    if "sitemap.xml" in common and not stats["sitemap_urls_a"]:
        problems.append("sitemap.xml has no urls in the HomeSignal tree - the comparison would prove nothing")

    # robots.txt
    if "robots.txt" in common:
        def rules(path: Path):
            ls = [l.strip() for l in path.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]
            return [l for l in ls if not l.lower().startswith("sitemap:")], [l for l in ls if l.lower().startswith("sitemap:")]
        ra_rules, ra_sm = rules(fa["robots.txt"])
        rb_rules, rb_sm = rules(fb["robots.txt"])
        if ra_rules != rb_rules:
            problems.append(f"robots.txt rules differ: {ra_rules[:3]} vs {rb_rules[:3]}")
        if [urlsplit(l.split(":", 1)[1].strip()).path for l in ra_sm] != [urlsplit(l.split(":", 1)[1].strip()).path for l in rb_sm]:
            problems.append("robots.txt Sitemap paths differ")
        if any(B_HOST not in l for l in rb_sm):
            problems.append("a robots.txt Sitemap line is not on the Jody host")
        stats["robots_sitemap_lines"] = len(rb_sm)

    # page-state baseline: per-page fingerprints survive, only the host moves
    ps = "sitemaps/page-state.json"
    if ps in common:
        da, db = json.loads(fa[ps].read_text()), json.loads(fb[ps].read_text())
        if da.get("host") != f"https://{A_HOST}" or db.get("host") != f"https://{B_HOST}":
            problems.append(f"page-state host: {da.get('host')} -> {db.get('host')}")
        strip = lambda d: {k: v for k, v in d.items() if k != "host"}
        if strip(da) != strip(db):
            probs, proven = host_derived_fingerprint_problems(a, da, db)
            stats["page_state_hashes_host_derived"] = proven
            if probs:
                problems.append("page-state fingerprints differ beyond the host: " + "; ".join(probs[:5]) + (f" (+{len(probs) - 5} more)" if len(probs) > 5 else ""))
        stats["page_state_pages"] = len(da.get("pages", da))
    return {"ok": not problems, "problems": problems, "stats": stats}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--report", default="")
    a = ap.parse_args(argv)
    res = compare(Path(a.a), Path(a.b))
    print(json.dumps(res, indent=2, sort_keys=True))
    if a.report:
        Path(a.report).write_text(json.dumps(res, indent=2, sort_keys=True))
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
