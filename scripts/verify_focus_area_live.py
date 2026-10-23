#!/usr/bin/env python3
"""Read-only live check of a marketing focus area (data/seo-focus-areas.json) on the public host.

Per member ZIP: HTTP status without following redirects, canonical, robots meta + X-Robots-Tag,
robots.txt allowance, membership of sitemap.xml / the ZIP family sitemaps / the focus sitemap,
and inbound internal links from the homepage, guides, city pages and sibling ZIP pages.
The member list is DERIVED from the committed community seed (docs/washington-communities-seed.sql),
never typed. Stdlib only; sends only GETs. Exit 1 on a hard problem (non-200, redirect, wrong
canonical, noindex while listed, listed while noindex); a not-yet-deployed focus sitemap is reported, not failed
unless --require-sitemap.
"""
import argparse, json, os, re, sys, urllib.request, urllib.error, urllib.robotparser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (compatible; JodyTracksSeoCheck/1.0; +https://jodytracks.com)"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    try:
        with OPENER.open(req, timeout=40) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace") if e.fp else ""
    except Exception as e:  # network fault: reported, never a silent pass
        return 0, {}, f"{type(e).__name__}: {e}"


def locs(xml):
    return re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", default="pierce-county-wa")
    ap.add_argument("--origin", default=None)
    ap.add_argument("--require-sitemap", action="store_true")
    a = ap.parse_args()
    area = next(x for x in json.load(open(os.path.join(ROOT, "data", "seo-focus-areas.json")))["areas"] if x["slug"] == a.slug)
    origin = a.origin or json.load(open(os.path.join(ROOT, "docs", "brand", "brand-contract.v1.json")))["identities"][
        json.load(open(os.path.join(ROOT, "docs", "brand", "brand-contract.v1.json")))["current_identity"]]["origin"]
    seed = open(os.path.join(ROOT, "docs", "washington-communities-seed.sql"), encoding="utf-8").read()
    zips = sorted(set(re.findall(rf"'{area['county']}','[a-z0-9-]+','(\d{{5}})','{a.slug}'", seed)))
    print(f"origin {origin}; {len(zips)} {area['name']} ZIPs from the committed seed (expected {area['expected_zips']})")
    problems = []
    if len(zips) != area["expected_zips"]:
        problems.append(f"seed yields {len(zips)} ZIPs, expected {area['expected_zips']}")

    st, _, rtxt = get(f"{origin}/robots.txt")
    rp = urllib.robotparser.RobotFileParser(); rp.parse(rtxt.splitlines())
    sm_lines = re.findall(r"(?im)^sitemap:\s*(\S+)", rtxt)
    print(f"robots.txt HTTP {st}; Sitemap lines: {sm_lines}")

    sm_main = set(locs(get(f"{origin}/sitemap.xml")[2]))
    fam = {}
    for n in ("zip-alerts", "zip-development", "city", "guide"):
        s, _, x = get(f"{origin}/sitemaps/{n}.xml"); fam[n] = set(locs(x)) if s == 200 else set()
        print(f"sitemaps/{n}.xml HTTP {s}, {len(fam[n])} URLs")
    s, _, fx = get(f"{origin}/sitemaps/{a.slug}.xml")
    focus = set(locs(fx)) if s == 200 else None
    print(f"sitemaps/{a.slug}.xml HTTP {s}" + (f", {len(focus)} URLs" if focus is not None else " (not deployed yet)"))
    if focus is None and a.require_sitemap:
        problems.append("focus sitemap not served")

    pages, rows = {}, []
    for z in zips:
        url = f"{origin}/community/{z}/"
        s, h, body = get(url)
        pages[z] = body if s == 200 else ""
        canon = (re.search(r'<link[^>]+rel="canonical"[^>]+href="([^"]+)"', body) or [None, None])[1]
        robots = (re.search(r'<meta name="robots" content="([^"]+)"', body) or [None, None])[1]
        xrt = h.get("X-Robots-Tag") or h.get("x-robots-tag") or ""
        idx = bool(robots and "noindex" not in robots.lower() and "noindex" not in xrt.lower())
        in_main = url in sm_main
        in_focus = None if focus is None else url in focus
        r = dict(zip=z, status=s, location=h.get("Location") or h.get("location"), canonical=canon, robots=robots, xrt=xrt,
                 self_canonical=canon == url, index_eligible=s == 200 and idx and canon == url,
                 crawl_allowed=rp.can_fetch("Googlebot", url), in_sitemap=in_main,
                 in_zip_family=url in fam["zip-alerts"] or url in fam["zip-development"], in_focus=in_focus)
        rows.append(r)
        if s != 200: problems.append(f"{z}: HTTP {s} {r['location'] or ''}")
        elif canon != url: problems.append(f"{z}: canonical {canon!r} != {url}")
        if not r["crawl_allowed"]: problems.append(f"{z}: blocked by robots.txt")
        if in_main and not r["index_eligible"]: problems.append(f"{z}: in sitemap.xml but not index-eligible ({robots!r})")
        if r["index_eligible"] and not in_main: problems.append(f"{z}: index-eligible but missing from sitemap.xml")
        if in_focus and not r["index_eligible"]: problems.append(f"{z}: in focus sitemap but not index-eligible")
        if in_focus is False and r["index_eligible"]: problems.append(f"{z}: index-eligible but missing from focus sitemap")

    # inbound internal links
    def hrefs(html): return set(re.findall(r'href="([^"#]+)"', html))
    def to_zip(h):
        m = re.fullmatch(r"(?:https?://[^/]+)?/community/(\d{5})/?", h); return m.group(1) if m else None
    home = get(f"{origin}/")[2]
    sources = {"homepage": home}
    for u in sorted(fam["guide"]):
        sources["guide " + u.replace(origin, "")] = get(u)[2]
    city_urls = [u for u in sorted(fam["city"]) if f"/city/{area['state'].lower()}/" in u]
    for u in city_urls:
        sources["city " + u.replace(origin, "")] = get(u)[2]
    inbound = {z: {} for z in zips}
    for name, html in sources.items():
        for z in {to_zip(h) for h in hrefs(html)} & set(zips):
            inbound[z][name] = 1
    for z in zips:
        for z2 in {to_zip(h) for h in hrefs(pages[z])} & set(zips) - {z}:
            inbound[z2]["sibling:" + z] = 1
    print("\nZIP | HTTP | self-canonical | robots | crawl | sitemap.xml | zip-family | focus | inbound (non-sibling / sibling)")
    for r in rows:
        ib = inbound[r["zip"]]
        print(f"{r['zip']} | {r['status']} | {r['self_canonical']} | {r['robots']} {r['xrt']} | {r['crawl_allowed']} | {r['in_sitemap']} | "
              f"{r['in_zip_family']} | {r['in_focus']} | {sum(1 for k in ib if not k.startswith('sibling:'))} / {sum(1 for k in ib if k.startswith('sibling:'))}")
    elig = [r["zip"] for r in rows if r["index_eligible"]]
    print(f"\nindex-eligible {len(elig)} of {len(rows)}; excluded: " + ", ".join(f"{r['zip']} ({r['status']}, {r['robots']})" for r in rows if not r["index_eligible"]))
    print("homepage links to focus ZIPs:", sum(1 for z in zips if "homepage" in inbound[z]))
    print("city pages found in the area:", [u.replace(origin, "") for u in city_urls])
    print("ZIPs with NO non-sibling inbound link:", sum(1 for z in zips if not any(not k.startswith('sibling:') for k in inbound[z])))
    print("ZIPs with fewer than 3 sibling inbound links:", [z for z in zips if sum(1 for k in inbound[z] if k.startswith('sibling:')) < 3])
    print("PROBLEMS:", len(problems)); [print(" -", p) for p in problems]
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
