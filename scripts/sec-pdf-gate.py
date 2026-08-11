#!/usr/bin/env python3
"""Phase 9E §2 — the binary-integrity gate.

Fetch the three Phase 9D blocking controls on a GitHub runner and prove, per document:

  1. HTTP 200
  2. downloaded byte count == declared Content-Length (where the server declares one)
  3. the PDF opens (magic bytes + pdfinfo exit 0), page count recorded
  4. SHA-256 recorded
  5. text extraction succeeds (pdftotext exit 0, non-empty)
  6. the binary survived where pg_net destroyed it — measured BYTES vs BYTES, and the
     order text pg_net could not reach is now recovered
  7. known substantive language from the order is present

Required markers are kept to what must appear in any SEC order PDF (the Commission
name and the release's own number). Everything else is REPORTED as a census rather
than asserted, because asserting language I have not verified would make this gate
fail for a reason that is not the thing it is testing.

Writes nothing anywhere. No secrets are read. Receipts go to stdout, which is the
job log — the channel the sandbox can actually read back.

Exit 1 if any control fails any check.
"""

import hashlib
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

# SEC asks automated clients to identify themselves. Domain contact only — no personal
# address is committed to the repo.
USER_AGENT = "HomeSignal-EvidenceGraph/1.0 (+https://homesignal.net)"

# The three controls, with the pg_net truncation Phase 9D measured against each
# response's own Content-Length. `pgnet_retained` / `declared` are quoted from
# docs/evidence-phase1-migration.sql, PHASE 9D section, lines 1089-1091.
CONTROLS = [
    {
        "release_ref": "34-106074",
        "url": "https://www.sec.gov/files/litigation/admin/2026/34-106074.pdf",
        "file_number": "3-22112",
        "publish_date": "2026-08-11",
        "pgnet_retained": 444,
        "pgnet_declared": 126786,
        "release_digits": "106074",
    },
    {
        "release_ref": "IA-4857",
        "url": "https://www.sec.gov/files/litigation/admin/2018/ia-4857.pdf",
        "file_number": None,  # not captured by the 9C index parse for this row
        "publish_date": "2018-02-22",
        "pgnet_retained": 1433,
        "pgnet_declared": 89991,
        "release_digits": "4857",
    },
    {
        "release_ref": "34-80365",
        "url": "https://www.sec.gov/files/litigation/admin/2017/34-80365.pdf",
        "file_number": "3-17897",
        "publish_date": "2017-04-03",
        "pgnet_retained": 747,
        "pgnet_declared": 104929,
        "release_digits": "80365",
    },
]

# Reported, not required. This census is the raw material for the Phase 9D §7-§9
# normalisation design: it says which posture/relief language actually occurs, per era.
CENSUS_TERMS = [
    "ADMINISTRATIVE PROCEEDING",
    "ORDER INSTITUTING",
    "cease-and-desist",
    "Respondent",
    "willfully violated",
    "disgorgement",
    "prejudgment interest",
    "civil money penalt",
    "Section 4C",
    "Rule 102(e)",
    "consented to the entry",
    "without admitting or denying",
    "OFFER OF SETTLEMENT",
    "IT IS HEREBY ORDERED",
]

# CORRECTED AFTER RUN 1 (31532143841). The first version of this gate compared extracted
# TEXT CHARACTERS against pg_net's RETAINED BYTES and required 10x. That is the wrong pair:
# the ratio tracks how compressed a PDF is, not whether the bytes survived. 34-106074 is a
# 2-page order inside a 126,786-byte file (fonts and embedded objects dominate), so it
# yields only 2,369 chars — 5.3x — and the gate failed a document it had just proven intact
# in six other checks. The instrument was wrong, not the document.
#
# Two checks replace it, each measuring the thing it names:
#   * BYTES vs BYTES — the integrity claim. Measured on the three controls:
#     126,786/444 = 285.6x · 89,991/1,433 = 62.8x · 104,929/747 = 140.5x.
#   * ORDER TEXT RECOVERED — the capability claim, which is the one that actually matters.
#     Re-measured through pg_net on 2026-08-11 (req 55807/55808/55809), all three fragments
#     contain ZERO order text: 'SECURITIES AND EXCHANGE COMMISSION' false, 'In the Matter of'
#     false, 'ORDER INSTITUTING' false; 34-106074's 444 bytes are literally
#     '%PDF-1.6 ... /Linearized 1/L 119955/O 94 ...' — the header and linearisation dict,
#     truncated before any content stream. So the runner does not merely recover MORE text;
#     it recovers the ONLY text. That is a category change, and it is what these two assert.
MIN_BYTE_RATIO_VS_PGNET = 50.0


def fetch(url):
    """Return (status, headers, body_bytes) or raise."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/pdf"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, dict(r.headers), r.read()


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, **kw)


def check_one(c):
    """Run every check for one control. Returns (checks, facts)."""
    checks = []  # (name, passed, detail)
    facts = {"release_ref": c["release_ref"], "url": c["url"]}

    def add(name, passed, detail):
        checks.append((name, bool(passed), detail))

    # ---- 1. HTTP 200 -------------------------------------------------------------
    try:
        status, headers, body = fetch(c["url"])
    except urllib.error.HTTPError as e:
        add("http_200", False, f"HTTPError {e.code} {e.reason}")
        return checks, facts
    except Exception as e:  # noqa: BLE001 - any transport failure is a gate failure
        add("http_200", False, f"{type(e).__name__}: {e}")
        return checks, facts

    facts["http_status"] = status
    add("http_200", status == 200, f"HTTP {status}")

    # ---- 2. downloaded bytes == declared Content-Length ---------------------------
    declared_raw = headers.get("Content-Length")
    downloaded = len(body)
    facts["downloaded_bytes"] = downloaded
    facts["declared_bytes"] = int(declared_raw) if declared_raw and declared_raw.isdigit() else None
    if facts["declared_bytes"] is None:
        # "where available" — absence of the header is recorded, not counted as failure.
        add("bytes_match_declared", True,
            f"server declared no Content-Length; downloaded {downloaded:,} bytes (UNVERIFIED against a declaration)")
    else:
        add("bytes_match_declared", downloaded == facts["declared_bytes"],
            f"downloaded {downloaded:,} == declared {facts['declared_bytes']:,}"
            if downloaded == facts["declared_bytes"]
            else f"downloaded {downloaded:,} != declared {facts['declared_bytes']:,}")

    # ---- 4. SHA-256 (recorded; a record, not a pass/fail) -------------------------
    facts["pdf_sha256"] = hashlib.sha256(body).hexdigest()
    add("sha256_recorded", True, facts["pdf_sha256"])

    path = f"/tmp/{c['release_ref']}.pdf"
    with open(path, "wb") as fh:
        fh.write(body)

    # ---- 3. the PDF opens ---------------------------------------------------------
    magic_ok = body[:5] == b"%PDF-"
    info = run(["pdfinfo", path])
    info_out = info.stdout.decode("utf-8", "replace")
    pages = None
    m = re.search(r"^Pages:\s+(\d+)", info_out, re.M)
    if m:
        pages = int(m.group(1))
    facts["page_count"] = pages
    opened = magic_ok and info.returncode == 0 and pages is not None and pages > 0
    add("pdf_opens", opened,
        f"magic={body[:5]!r} pdfinfo_rc={info.returncode} pages={pages}"
        + ("" if info.returncode == 0 else " stderr=" + info.stderr.decode("utf-8", "replace")[:200]))

    # ---- 5. text extraction succeeds ----------------------------------------------
    # -layout preserves the two-column caption block SEC orders open with; native text
    # first, exactly as §3 requires. OCR is a separate, later decision and is not run here.
    tx = run(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"])
    text = tx.stdout.decode("utf-8", "replace")
    facts["text_chars"] = len(text)
    facts["text_sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    facts["extraction_method"] = "pdftotext -layout (poppler)"
    add("text_extracted", tx.returncode == 0 and len(text.strip()) > 0,
        f"pdftotext_rc={tx.returncode} chars={len(text):,}"
        + ("" if tx.returncode == 0 else " stderr=" + tx.stderr.decode('utf-8', 'replace')[:200]))

    # A PDF that opens but yields (almost) no text is an image scan — that is the
    # ocr_required branch, and it must be visible here rather than silently passing.
    chars_per_page = (len(text) / pages) if pages else 0
    facts["chars_per_page"] = round(chars_per_page, 1)
    facts["native_text"] = chars_per_page >= 200
    add("native_text_not_image_scan", chars_per_page >= 200,
        f"{chars_per_page:,.1f} chars/page ({'native text' if chars_per_page >= 200 else 'looks like an image scan -> OCR branch'})")

    # ---- 6a. the binary survived — BYTES vs BYTES ----------------------------------
    byte_ratio = downloaded / c["pgnet_retained"] if c["pgnet_retained"] else 0
    facts["pgnet_retained"] = c["pgnet_retained"]
    facts["byte_ratio_vs_pgnet"] = round(byte_ratio, 1)
    facts["text_chars_per_pgnet_byte"] = round(len(text) / c["pgnet_retained"], 1) if c["pgnet_retained"] else None
    add("binary_survived_vs_pgnet", byte_ratio >= MIN_BYTE_RATIO_VS_PGNET,
        f"{downloaded:,} bytes intact vs {c['pgnet_retained']:,} pg_net retained = {byte_ratio:,.1f}x "
        f"(pg_net kept {100.0 * c['pgnet_retained'] / c['pgnet_declared']:.2f}% of {c['pgnet_declared']:,} declared)")

    # ---- 6b. the order text pg_net could not reach is now recovered ----------------
    # pg_net's fragment provably carries none of these (measured, see the constant above),
    # so their presence here is the capability the runner adds, not a nicety.
    flat_pre = re.sub(r"\s+", " ", text)
    caption_ok = "In the Matter of" in flat_pre and "UNITED STATES OF AMERICA" in flat_pre.upper()
    facts["caption_recovered"] = caption_ok
    add("order_text_recovered", caption_ok,
        "caption block recovered ('UNITED STATES OF AMERICA' + 'In the Matter of') — "
        "pg_net's fragment contains neither"
        if caption_ok else "caption block NOT found in extracted text")

    # ---- 7. known substantive language --------------------------------------------
    flat = re.sub(r"\s+", " ", text)
    add("marker_commission_name", "SECURITIES AND EXCHANGE COMMISSION" in flat.upper(),
        "'SECURITIES AND EXCHANGE COMMISSION' present" if "SECURITIES AND EXCHANGE COMMISSION" in flat.upper()
        else "Commission name ABSENT")
    add("marker_release_number", c["release_digits"] in flat,
        f"release digits {c['release_digits']} "
        + ("present" if c["release_digits"] in flat else "ABSENT"))

    # Census — reported only, never asserted.
    census = {}
    for term in CENSUS_TERMS:
        census[term] = len(re.findall(re.escape(term), flat, re.I))
    if c["file_number"]:
        census[f"file number {c['file_number']}"] = len(re.findall(re.escape(c["file_number"]), flat))
    facts["census"] = census
    facts["text_head"] = flat[:600]

    return checks, facts


def main():
    print("=" * 78)
    print("PHASE 9E §2 — SEC PDF BINARY-INTEGRITY GATE")
    print("Runner acquisition only. Nothing is written. No secrets are read.")
    print("=" * 78)

    all_pass = True
    summary = []

    for i, c in enumerate(CONTROLS):
        if i:
            time.sleep(2)  # polite spacing between SEC requests
        print()
        print("-" * 78)
        print(f"CONTROL {i + 1}/3 — {c['release_ref']}  ({c['publish_date']})")
        print(f"  {c['url']}")
        print("-" * 78)

        checks, facts = check_one(c)
        passed = all(p for _, p, _ in checks)
        all_pass = all_pass and passed

        for name, p, detail in checks:
            print(f"  [{'PASS' if p else 'FAIL'}] {name:<32} {detail}")

        if "census" in facts:
            print("\n  Substantive-language census (REPORTED, not asserted):")
            for term, n in facts["census"].items():
                print(f"      {n:>4}  {term}")
            print("\n  First 600 chars of extracted text (whitespace-flattened):")
            print("      " + facts["text_head"].replace("\n", " ")[:600])

        print("\n  FACTS (json):")
        print("  " + json.dumps({k: v for k, v in facts.items() if k not in ("census", "text_head")}))

        summary.append((c["release_ref"], passed, facts))

    print()
    print("=" * 78)
    print("GATE SUMMARY")
    print("=" * 78)
    for ref, passed, f in summary:
        print(f"  {'PASS' if passed else 'FAIL'}  {ref:<12} "
              f"{f.get('downloaded_bytes', 0):>9,} bytes  "
              f"{str(f.get('page_count')):>4} pp  "
              f"{f.get('text_chars', 0):>8,} chars  "
              f"{f.get('byte_ratio_vs_pgnet', 0):>7,.1f}x pg_net bytes")
    print()
    if all_pass:
        print("GATE PASSED — all three controls prove binary integrity on the runner.")
        print("§2 permits proceeding to the representative test set.")
        return 0
    print("GATE FAILED — do NOT proceed to large-scale acquisition (§2).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
