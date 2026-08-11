#!/usr/bin/env python3
"""Phase 9E §5/§6/§13 — acquire SEC order PDFs on a runner and land them in STAGING.

THE RUNNER DOES NOT INTERPRET. It fetches bytes, hashes them, extracts text, and writes
mechanical provenance. It never decides whether an order contains findings, which statutes
were charged, what was paid, or who a respondent is. Those are derived later, in the
database, from the staged text — so the derivation is auditable against a stored artifact
rather than against a network fetch nobody can replay.

Its only write is public.stage_sec_pdf, a typed RPC with no parameter capable of expressing
an interpretation. Its only read is public.sec_pdf_work_list, which carries fetch
instructions and nothing else. Both are granted to service_role alone.

Extraction status is assigned on MEASUREMENT, never on optimism:
    native_text         PDF opened and yielded >= MIN_CHARS_PER_PAGE chars/page
    ocr_required        PDF opened but is (near-)textless — an image scan. NOT attempted
                        here: §3 says native text first, and a document that needs OCR must
                        be visibly distinguishable from one that got it.
    corrupt_unsupported bytes arrived but are not a readable PDF
    acquisition_failed  never got the bytes (non-200, truncated, transport error)
A document that fails is RECORDED as failed and the batch continues (quarantine, don't stop).
Silence and failure must never look alike.

Usage:
    sec-pdf-stage.py --set representative
    sec-pdf-stage.py --set corpus [--limit N] [--shard i/N]
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

SEC_UA = "HomeSignal-EvidenceGraph/1.0 (+https://homesignal.net)"

# SEC's published ceiling is 10 requests/second. We use well under it: this is a bulk
# historical pull with no deadline, and being a good citizen of a public records system is
# not optional.
SEC_DELAY_S = 0.4

# A text layer thinner than this is not a document we can read — it is a scan with a few
# stray characters (page numbers, a stamp). Chosen against the three §2 controls, whose
# native pages measured 1,184 / 2,144 / 2,078 chars per page: 200 is roughly a tenth of the
# thinnest real page, so it separates "sparse but real" from "image".
MIN_CHARS_PER_PAGE = 200

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
RUNNER_JOB = os.environ.get("RUNNER_JOB", "local")

# PostgREST caps un-paginated reads at 1,000 rows and TRUNCATES SILENTLY past it — the
# defect this repo already hit once on development_reports. Every read here is paged.
PAGE = 1000


def rest(path, params=None, method="GET", body=None, extra_headers=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read().decode("utf-8", "replace")
        return json.loads(raw) if raw.strip() else None


def load_work_list(which, limit, shard):
    # The representative set is a VIEW, not a committed list: it is defined in the migration
    # of record and is stable by construction (the stratified half takes the FIRST document
    # per release-type x year, so later publications never displace a pick). A hand-copied
    # file would be one more thing that can silently disagree with what it claims to sample.
    if which == "representative":
        rows = rest("sec_pdf_representative_set", {
            "select": "release_ref,index_name,pdf_url,file_number,publish_date,strata,reasons",
            "order": "publish_date.asc,release_ref.asc", "limit": PAGE}) or []
        strat = sum(1 for r in rows if 'stratified' in (r.get('reasons') or ''))
        pair = sum(1 for r in rows if 'section_10_pair' in (r.get('reasons') or ''))
        print(f"Representative set: {len(rows)} distinct documents "
              f"({strat} stratified across release-type x year, {pair} behind §10 pairs)")
        return rows

    rows, offset = [], 0
    while True:
        page = rest("sec_pdf_work_list", {
            "select": "release_ref,index_name,pdf_url,file_number,publish_date",
            "already_staged": "eq.false",
            "order": "publish_date.asc,release_ref.asc",
            "limit": PAGE, "offset": offset})
        if not page:
            break
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    print(f"Work list: {len(rows)} unstaged documents (paged in {PAGE}s — "
          f"PostgREST truncates un-paginated reads at 1,000)")

    if shard:
        i, n = shard
        rows = [r for k, r in enumerate(rows) if k % n == i]
        print(f"Shard {i}/{n}: {len(rows)} documents")
    if limit:
        rows = rows[:limit]
        print(f"Limited to {len(rows)} documents")
    return rows


def acquire(url):
    """Fetch the PDF. Returns a dict of measured facts; never raises for HTTP reasons."""
    out = {"http_status": None, "declared_bytes": None, "downloaded_bytes": None,
           "body": None, "error": None}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": SEC_UA,
                                                   "Accept": "application/pdf"})
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            cl = r.headers.get("Content-Length")
            out.update(http_status=r.status, body=body, downloaded_bytes=len(body),
                       declared_bytes=int(cl) if cl and cl.isdigit() else None)
    except urllib.error.HTTPError as e:
        out.update(http_status=e.code, error=f"HTTP {e.code} {e.reason}")
    except Exception as e:  # noqa: BLE001
        out.update(error=f"{type(e).__name__}: {e}")
    return out


def extract(path):
    """pdfinfo + pdftotext. Returns (pages, text, opened)."""
    info = subprocess.run(["pdfinfo", path], capture_output=True)
    pages = None
    if info.returncode == 0:
        m = re.search(r"^Pages:\s+(\d+)", info.stdout.decode("utf-8", "replace"), re.M)
        if m:
            pages = int(m.group(1))
    if pages is None:
        return None, "", False
    tx = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"],
                        capture_output=True)
    if tx.returncode != 0:
        return pages, "", True
    return pages, tx.stdout.decode("utf-8", "replace"), True


def process(row):
    ref = row["release_ref"]
    url = row["pdf_url"]
    got = acquire(url)
    retrieved_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    payload = {
        "p_release_ref": ref,
        "p_index_name": row.get("index_name") or "administrative_proceedings",
        "p_pdf_url": url,
        "p_file_number": row.get("file_number"),
        "p_http_status": got["http_status"],
        "p_declared_bytes": got["declared_bytes"],
        "p_downloaded_bytes": got["downloaded_bytes"],
        "p_pdf_sha256": None, "p_page_count": None,
        "p_extraction_method": None, "p_extraction_status": "acquisition_failed",
        "p_text_chars": None, "p_text_sha256": None, "p_extracted_text": None,
        "p_runner_job": RUNNER_JOB, "p_retrieved_at": retrieved_at, "p_note": got["error"],
    }

    body = got["body"]
    if body is None or got["http_status"] != 200:
        return payload, "acquisition_failed", 0

    # A truncated body is an acquisition failure, not a short document. This is the exact
    # class pg_net hid in 9D, so it is checked explicitly rather than assumed away.
    if got["declared_bytes"] is not None and got["downloaded_bytes"] != got["declared_bytes"]:
        payload["p_note"] = (f"truncated: downloaded {got['downloaded_bytes']} != "
                             f"declared {got['declared_bytes']}")
        return payload, "acquisition_failed", 0

    payload["p_pdf_sha256"] = hashlib.sha256(body).hexdigest()

    path = "/tmp/stage.pdf"
    with open(path, "wb") as fh:
        fh.write(body)

    if body[:5] != b"%PDF-":
        payload["p_extraction_status"] = "corrupt_unsupported"
        payload["p_note"] = f"magic bytes {body[:5]!r}"
        return payload, "corrupt_unsupported", 0

    pages, text, opened = extract(path)
    payload["p_page_count"] = pages
    if not opened:
        payload["p_extraction_status"] = "corrupt_unsupported"
        payload["p_note"] = "pdfinfo could not open the file"
        return payload, "corrupt_unsupported", 0

    cpp = (len(text) / pages) if pages else 0
    payload["p_extraction_method"] = "pdftotext -layout (poppler 24.02.0)"
    if cpp >= MIN_CHARS_PER_PAGE:
        payload["p_extraction_status"] = "native_text"
        payload["p_text_chars"] = len(text)
        payload["p_text_sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
        payload["p_extracted_text"] = text
        return payload, "native_text", len(text)

    # Opened, but there is no text layer to speak of. Recorded honestly as needing OCR —
    # never staged as if it had been read.
    payload["p_extraction_status"] = "ocr_required"
    payload["p_text_chars"] = len(text)
    payload["p_note"] = f"{cpp:.1f} chars/page over {pages} pages — below {MIN_CHARS_PER_PAGE}"
    return payload, "ocr_required", len(text)


def main():
    ap = argparse.ArgumentParser()
    # RETRY PASS (2026-08-11): the first full corpus run left 4 documents at
    # acquisition_failed because their index href is a RELATIVE landing path
    # ('/enforcement-litigation/administrative-proceedings/33-10857') rather than a PDF URL,
    # so urllib raised "unknown url type". public.sec_pdf_work_list now absolutises such
    # hrefs, and those 4 are still !already_staged, so re-firing corpus mode retries exactly
    # them and nothing else. If a landing page returns HTML rather than a PDF the magic-byte
    # check records corrupt_unsupported — honest, and still never a silent zero.
    ap.add_argument("--set", dest="which", choices=["representative", "corpus"], required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--shard", default="")
    args = ap.parse_args()

    if not SUPABASE_URL or not SERVICE_KEY:
        print("FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not present")
        return 2

    shard = None
    if args.shard:
        i, n = args.shard.split("/")
        shard = (int(i), int(n))

    rows = load_work_list(args.which, args.limit, shard)
    if not rows:
        print("Nothing to do — every document in scope is already staged.")
        return 0

    tally = {}
    outcomes = {}
    failures = []
    t0 = time.time()

    for k, row in enumerate(rows, 1):
        if k > 1:
            time.sleep(SEC_DELAY_S)
        try:
            payload, status, chars = process(row)
        except Exception as e:  # noqa: BLE001 — one bad document never stops the batch
            tally["driver_error"] = tally.get("driver_error", 0) + 1
            failures.append((row["release_ref"], f"{type(e).__name__}: {e}"))
            print(f"  [{k}/{len(rows)}] {row['release_ref']:<12} DRIVER ERROR {e}")
            continue

        tally[status] = tally.get(status, 0) + 1
        try:
            res = rest("rpc/stage_sec_pdf", method="POST", body=payload)
            outcomes[res] = outcomes.get(res, 0) + 1
        except Exception as e:  # noqa: BLE001
            tally["stage_write_failed"] = tally.get("stage_write_failed", 0) + 1
            failures.append((row["release_ref"], f"stage write: {type(e).__name__}: {e}"))
            print(f"  [{k}/{len(rows)}] {row['release_ref']:<12} STAGE WRITE FAILED {e}")
            continue

        if status != "native_text":
            failures.append((row["release_ref"], f"{status}: {payload['p_note']}"))
        if k <= 40 or k % 200 == 0 or status != "native_text":
            print(f"  [{k}/{len(rows)}] {row['release_ref']:<12} {status:<20} "
                  f"{chars:>7,} chars  pages={payload['p_page_count']}")

    dt = time.time() - t0
    print()
    print("=" * 78)
    print(f"STAGED {len(rows)} documents in {dt / 60:.1f} min ({dt / max(len(rows), 1):.2f}s each)")
    print("  extraction status:", json.dumps(tally, sort_keys=True))
    print("  write outcome:    ", json.dumps(outcomes, sort_keys=True))
    if failures:
        print(f"\n  {len(failures)} document(s) did NOT yield native text "
              f"(recorded, not skipped — an absence must be visible):")
        for ref, why in failures[:60]:
            print(f"      {ref:<14} {why}")
        if len(failures) > 60:
            print(f"      ... and {len(failures) - 60} more, all recorded in staging")
    print("=" * 78)
    # A batch with quarantined records is a success; only losing the ability to write is not.
    return 1 if tally.get("stage_write_failed") else 0


if __name__ == "__main__":
    sys.exit(main())
