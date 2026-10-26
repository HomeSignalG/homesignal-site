#!/usr/bin/env python3
"""Read-only check of the PUBLIC Development Map landing page (stdlib only; writes nothing, holds no secret).

GETs the public host and prints what a crawler is given for /homesignalmap.html and for the states that must NOT be
indexed, then exits 1 if any expectation fails. The sandbox that wrote this change cannot reach the host, so this is
how production is verified: dispatch .github/workflows/verify-map-landing-live.yml after a deploy.

It reads the RAW response (what a crawler sees before rendering): status, redirect target, X-Robots-Tag, the robots
meta, the canonical, the title, whether the About copy is in the initial HTML, sitemap membership, and the homepage's
plain link. It does NOT read Google Search Console (that needs the property owner's login): check "URL inspection" for
https://jodytracks.com/homesignalmap.html there, then request indexing.
"""
import argparse
import re
import sys
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (compatible; jody-map-landing-verifier)"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, r.geturl(), dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, dict(e.headers), e.read().decode("utf-8", "replace")


def robots_meta(h):
    return re.findall(r'<meta\s+name="robots"\s+content="([^"]*)"', h, re.I)


def canonical(h):
    return re.findall(r'<link\s+rel="canonical"\s+href="([^"]*)"', h, re.I)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--origin", default="https://jodytracks.com")
    ap.add_argument("--zip", default="98335", help="a ZIP whose /map/<zip>/ page is compared (not asserted either way)")
    a = ap.parse_args()
    o = a.origin.rstrip("/")
    landing = o + "/homesignalmap.html"
    bad = []
    rows = []

    def check(name, ok, got=""):
        rows.append((("PASS" if ok else "FAIL"), name, got))
        if not ok:
            bad.append(name)

    st, final, hdr, body = get(landing)
    xr = hdr.get("X-Robots-Tag") or hdr.get("x-robots-tag") or ""
    check("landing: HTTP 200 with no redirect", st == 200 and final == landing, f"{st} {final}")
    check("landing: no X-Robots-Tag noindex", "noindex" not in xr.lower(), xr or "(none)")
    check("landing: raw robots meta is exactly 'index, follow'", robots_meta(body) == ["index, follow"], robots_meta(body))
    check("landing: one self-referencing canonical", canonical(body) == [landing], canonical(body))
    t = (re.search(r"<title>([^<]*)</title>", body) or [None, ""])[1]
    check("landing: Development Map title", "Development Map" in t, t)
    tpl_free = re.sub(r"<template\b.*?</template>", "", body, flags=re.S | re.I)
    check("landing: About copy is in the initial HTML, outside the <template>", 'id="hs-map-about"' in tpl_free
          and "/guides/what-is-being-built-near-me/" in tpl_free)

    for label, path in (("ZIP route", "/homesignalmap.html?zip=" + a.zip), ("address route", "/homesignalmap.html?addr=1+Main+St")):
        s2, _, h2, b2 = get(o + path)
        check(f"{label}: canonicalises to the landing page", canonical(b2) == [landing], canonical(b2))
        # Raw HTML says index; the head script lowers it on render. Report, and require the guard to be present.
        check(f"{label}: the noindex guard script ships in the page", "hs-map-state" in b2 and "robots-meta" in b2, robots_meta(b2))

    s3, _, h3, b3 = get(o + f"/map/{a.zip}/")
    rows.append(("INFO", f"/map/{a.zip}/ robots (its own evidence rule decides)", robots_meta(b3)))
    check(f"/map/{a.zip}/: does not carry the landing copy", "hs-map-about" not in b3, s3)

    ss, _, _, sm = get(o + "/sitemap.xml")
    check("sitemap.xml: lists the landing page once", sm.count(f"<loc>{landing}</loc>") == 1, ss)
    check("sitemap.xml: lists no homesignalmap.html?… URL", "homesignalmap.html?" not in sm)
    sr, _, _, rb = get(o + "/robots.txt")
    check("robots.txt: does not disallow the landing page", not re.search(r"^Disallow:\s*/(?:homesignalmap\.html)?\s*$", rb, re.M), sr)
    sh, _, _, hp = get(o + "/")
    check("homepage: plain crawlable link to the landing page", re.search(r'href="(?:/|https://[^"/]+/)?homesignalmap\.html"', hp) is not None, sh)

    for r in rows:
        print(f"{r[0]:5} {r[1]}" + (f"  [{r[2]}]" if r[2] != "" else ""))
    print(f"\n{len(bad)} failing" if bad else "\nall expectations met")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
