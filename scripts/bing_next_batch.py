#!/usr/bin/env python3
"""Next batch of ZIP-page URLs for Bing URL Submission (quota 100 a day).

Reads the LIVE sitemap, so only pages the site itself advertises for indexing are offered
(a noindex ZIP page is never in it). Skips every ZIP listed in docs/seo/bing-submitted.txt.
Prints the batch between BEGIN/END markers and, when GITHUB_STEP_SUMMARY is set, as a code
block in the run summary. Read-only: it submits nothing and writes no file.

  python3 scripts/bing_next_batch.py --count 100
  python3 scripts/bing_next_batch.py --sitemap-file sitemap.xml   # offline
"""
import argparse, os, re, sys, urllib.request

HOST = "https://www.jodytracks.com"
SITEMAPS = ("/sitemaps/zip-alerts.xml", "/sitemap.xml")
ZIP_LOC = re.compile(r"<loc>\s*https?://[^<\s/]+/community/(\d{5})/\s*</loc>")


def zips_in(xml):
    """ZIPs of the plain /community/<zip>/ pages in a sitemap, in sitemap order, no repeats."""
    out = []
    for z in ZIP_LOC.findall(xml):
        if z not in out:
            out.append(z)
    return out


def read_submitted(text):
    return {l.strip() for l in text.splitlines() if re.fullmatch(r"\d{5}", l.strip())}


def next_batch(sitemap_zips, submitted, count):
    return [z for z in sitemap_zips if z not in submitted][:count]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "bing-next-batch/1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=100)
    ap.add_argument("--sitemap-file")
    ap.add_argument("--submitted", default="docs/seo/bing-submitted.txt")
    a = ap.parse_args(argv)
    if a.count < 1:
        sys.exit("ERROR: --count must be at least 1")
    zips = []
    if a.sitemap_file:
        zips = zips_in(open(a.sitemap_file, encoding="utf-8").read())
    else:
        for path in SITEMAPS:
            try:
                zips = zips_in(fetch(HOST + path))
            except Exception as e:  # noqa: BLE001 - try the next sitemap, then fail loudly below
                print(f"note: {path}: {e}", file=sys.stderr)
            if zips:
                break
    # A sitemap with no ZIP pages is a read failure, not "nothing left": never report it as done.
    if not zips:
        sys.exit("ERROR: no /community/<zip>/ URLs found in the sitemap; nothing was measured")
    submitted = read_submitted(open(a.submitted, encoding="utf-8").read())
    batch = next_batch(zips, submitted, a.count)
    lines = [f"{HOST}/community/{z}/" for z in batch]
    stats = (f"sitemap ZIP pages {len(zips)} · already submitted {len(submitted)} · "
             f"still to submit {len([z for z in zips if z not in submitted])} · this batch {len(batch)}")
    print(stats)
    print("----- BEGIN BATCH -----")
    print("\n".join(lines))
    print("----- END BATCH -----")
    summ = os.environ.get("GITHUB_STEP_SUMMARY")
    if summ:
        with open(summ, "a", encoding="utf-8") as f:
            f.write(f"### Bing batch\n{stats}\n\n```\n" + "\n".join(lines) + "\n```\n")


if __name__ == "__main__":
    main()
