#!/usr/bin/env python3
"""Phase 9E item 3 — acquire Litigation Release landing-page BODIES.

Same contract as the PDF path: the runner ACQUIRES and applies a STRUCTURAL boundary.
It does not interpret. No posture, statute, sanction or entity is decided here.

WHY THIS EXISTS. The AP order text carries a district court and a docket number but never
cites a Litigation Release number (measured: 0 of 77 staged orders). The litigation-release
side is the other half of the join, and ev_sec_release stores only a respondent name and a
landing URL for it. The landing page carries the release body — unlike the ADMINISTRATIVE
PROCEEDING landing page, which Phase 9D correctly found to be a stub.

BODY BOUNDARY IS STRUCTURAL. The body is the Drupal field container
    class="... field--name-body ... field__item"
and it ends at the page's <footer> landmark. Everything outside is site chrome and sidebar
navigation, which must never be read as release evidence — 9D's near-miss was a keyword
matching inside sidebar nav at byte 41,042 of an AP page.

Parser status is assigned on measurement:
    body_extracted            container and landmark both found, body non-empty
    body_container_missing    no field--name-body on the page
    footer_landmark_missing   container found but no <footer> to bound it
    body_empty                bounded region contained no text
    fetch_failed              never got the page
"""

import argparse
import hashlib
import html as htmllib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

SEC_UA = "HomeSignal-EvidenceGraph/1.0 (+https://homesignal.net)"
SEC_DELAY_S = 0.4
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
RUNNER_JOB = os.environ.get("RUNNER_JOB", "local")
PAGE = 1000

BODY_CONTAINER = re.compile(r'class="[^"]*field--name-body[^"]*"[^>]*>', re.I)
FOOTER_LANDMARK = re.compile(r"<footer\b", re.I)

# Asserted AFTER extraction, never used to clean. If any of these survive the boundary, the
# boundary is wrong and must be fixed at source — the staging RPC refuses such a body.
CHROME_MARKERS = ("Return to top", "Sign up for email updates", "SEC homepage")


def rest(path, params=None, method="GET", body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    headers = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}",
               "Content-Type": "application/json", "Accept": "application/json"}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read().decode("utf-8", "replace")
        return json.loads(raw) if raw.strip() else None


def strip_tags(fragment):
    """Structural markup -> readable text. Block tags become newlines so the caption line
    ('SEC v. X, No. 1:23-cv-456 (D.N.J. filed ...)') survives as its own line."""
    s = re.sub(r"(?i)<(br|/p|/div|/h[1-6]|/li|/tr)\s*/?>", "\n", fragment)
    s = re.sub(r"<[^>]*>", " ", s)
    s = htmllib.unescape(s)
    s = re.sub(r"[ \t ]+", " ", s)
    s = re.sub(r"\n\s*\n\s*", "\n\n", s)
    return s.strip()


def extract_body(page_html):
    """Return (status, body_text, note). Purely structural."""
    m = BODY_CONTAINER.search(page_html)
    if not m:
        return "body_container_missing", None, "no field--name-body container on the page"
    after = page_html[m.end():]
    f = FOOTER_LANDMARK.search(after)
    if not f:
        return "footer_landmark_missing", None, "body container found but no <footer> landmark"
    body = strip_tags(after[:f.start()])
    if not body:
        return "body_empty", None, "bounded region contained no text"
    return "body_extracted", body, None


def load_work(limit):
    # The whole LR corpus, which subsumes the 46 pairs' LR side. A separate "pairs only"
    # path was written and removed: it would have been a second code path exercised once,
    # and the corpus fetch is ~20 minutes.
    rows, offset = [], 0
    params = {"select": "release_ref,url,publish_date,already_staged",
              "already_staged": "eq.false",
              "order": "publish_date.asc,release_ref.asc"}
    while True:
        p = dict(params); p["limit"] = PAGE; p["offset"] = offset
        page = rest("sec_lr_work_list", p)
        if not page:
            break
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    if limit:
        rows = rows[:limit]
    return rows


def process(row):
    url = row["url"]
    payload = {"p_release_ref": row["release_ref"], "p_url": url, "p_http_status": None,
               "p_body_text": None, "p_body_sha256": None, "p_body_chars": None,
               "p_parser_status": "fetch_failed", "p_runner_job": RUNNER_JOB,
               "p_retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "p_note": None}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": SEC_UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            payload["p_http_status"] = r.status
            page_html = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        payload["p_http_status"] = e.code
        payload["p_note"] = f"HTTP {e.code} {e.reason}"
        return payload, "fetch_failed"
    except Exception as e:  # noqa: BLE001
        payload["p_note"] = f"{type(e).__name__}: {e}"
        return payload, "fetch_failed"

    status, body, note = extract_body(page_html)
    payload["p_parser_status"] = status
    payload["p_note"] = note
    if body:
        leaked = [c for c in CHROME_MARKERS if c in body]
        if leaked:
            # Never store it and never strip it — a leak means the BOUNDARY is wrong.
            payload["p_parser_status"] = "body_empty"
            payload["p_note"] = f"boundary leak: body contained {leaked!r} — parser must be fixed"
            return payload, "boundary_leak"
        payload["p_body_text"] = body
        payload["p_body_chars"] = len(body)
        payload["p_body_sha256"] = hashlib.sha256(body.encode("utf-8")).hexdigest()
    return payload, status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    if not SUPABASE_URL or not SERVICE_KEY:
        print("FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not present")
        return 2

    rows = load_work(args.limit)
    print(f"LR body acquisition: {len(rows)} releases to fetch")
    if not rows:
        print("Nothing to do — every release in scope already has a staged body.")
        return 0

    tally, outcomes, failures = {}, {}, []
    t0 = time.time()
    for k, row in enumerate(rows, 1):
        if k > 1:
            time.sleep(SEC_DELAY_S)
        try:
            payload, status = process(row)
        except Exception as e:  # noqa: BLE001
            tally["driver_error"] = tally.get("driver_error", 0) + 1
            failures.append((row["release_ref"], f"{type(e).__name__}: {e}"))
            continue
        tally[status] = tally.get(status, 0) + 1
        try:
            res = rest("rpc/stage_sec_lr_body", method="POST", body=payload)
            outcomes[res] = outcomes.get(res, 0) + 1
        except Exception as e:  # noqa: BLE001
            tally["stage_write_failed"] = tally.get("stage_write_failed", 0) + 1
            failures.append((row["release_ref"], f"stage write: {e}"))
            continue
        if status != "body_extracted":
            failures.append((row["release_ref"], f"{status}: {payload['p_note']}"))
        if k <= 20 or k % 250 == 0 or status != "body_extracted":
            print(f"  [{k}/{len(rows)}] {row['release_ref']:<10} {status:<24} "
                  f"{payload['p_body_chars'] or 0:>6} chars")

    dt = time.time() - t0
    print()
    print("=" * 78)
    print(f"LR BODIES: {len(rows)} releases in {dt/60:.1f} min ({dt/max(len(rows),1):.2f}s each)")
    print("  parser status:", json.dumps(tally, sort_keys=True))
    print("  write outcome:", json.dumps(outcomes, sort_keys=True))
    if failures:
        print(f"\n  {len(failures)} release(s) did NOT yield a body (recorded, not skipped):")
        for ref, why in failures[:60]:
            print(f"      {ref:<12} {why}")
        if len(failures) > 60:
            print(f"      ... and {len(failures)-60} more, all recorded in staging")
    print("=" * 78)
    return 1 if tally.get("stage_write_failed") else 0


if __name__ == "__main__":
    sys.exit(main())
