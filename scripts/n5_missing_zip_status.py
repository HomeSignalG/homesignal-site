#!/usr/bin/env python3
"""Parked named-ZIP READY coverage for 94128 / 95219 / 99128.

Step 7 of the TIGER/ZCTA health plan. Offline checker only. Never applies
SQL, never activates a generation, never touches indexable.

Standing founder lock (2026-09-27):
"Do not unlist ~1,005 map pages just because they have plants and no new
construction. 'Nothing is being built' is a valid answer. Those pages stay
listed. This was the old Unit 1 idea; it is rejected."
The `_nfc >= 3` limb of indexable STAYS. Unit 1 is rejected. Plant-only
Map 1 pages remain listed.

This park is not taking the live write for the 3 ZIPs.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

REQUIRED_STATUS_ZIPS = ("94128", "95219", "99128")
REQUIRED_PREFIXES = ("941", "952", "991")

FOUNDER_LOCK_NEEDLES = (
    "Do not unlist ~1,005 map pages",
    "Nothing is being built",
    "This was the old Unit 1 idea; it is rejected",
)

# Built from parts so this file does not contain the contiguous call token
# the scan refuses. A mutation that adds the call still matches.
ACTIVATE_NEEDLE = "n5_generation_" + "activate"
INDEXABLE_ASSIGN_RE = re.compile(
    r"""(?:^|[\s,;(])indexable\s*=(?!=)|(?:'indexable'|"indexable")\s*,""",
    re.MULTILINE,
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def strip_sql_comments(text: str) -> str:
    return "\n".join(line.split("--", 1)[0] for line in text.splitlines())


def strip_hash_comments(text: str) -> str:
    out = []
    for line in text.splitlines():
        if line.lstrip().startswith("#"):
            continue
        if " #" in line:
            line = line.split(" #", 1)[0]
        out.append(line)
    return "\n".join(out)


def strip_py_noise(text: str) -> str:
    text = re.sub(r'"""[\s\S]*?"""', " ", text)
    text = re.sub(r"'''[\s\S]*?'''", " ", text)
    return strip_hash_comments(text)


def fail(msg: str) -> None:
    print("FAIL — " + msg, file=sys.stderr)
    raise SystemExit(1)


def ok(msg: str) -> None:
    print("PASS — " + msg)


def read_text(path: Path) -> str:
    if not path.is_file():
        fail("missing file: " + str(path))
    return path.read_text(encoding="utf-8")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    root = repo_root()
    p = argparse.ArgumentParser(
        description="Offline named-ZIP READY coverage pins (parked; never apply)."
    )
    p.add_argument(
        "--root",
        default=os.environ.get("N5_MISSING_ZIP_ROOT", str(root)),
        help="Repo root (tests may point at a copy).",
    )
    p.add_argument(
        "--candidates",
        default=os.environ.get(
            "N5_MISSING_ZIP_CANDIDATES",
            str(root / "scripts" / "verify-map1-zip-states.mjs"),
        ),
    )
    p.add_argument(
        "--parked-sql",
        default=os.environ.get(
            "N5_MISSING_ZIP_PARKED_SQL",
            str(root / "docs" / "n5-named-zip-status-coverage.sql"),
        ),
    )
    p.add_argument(
        "--publish-sql",
        default=os.environ.get(
            "N5_MISSING_ZIP_PUBLISH_SQL",
            str(root / "docs" / "n5-generation-publish.sql"),
        ),
    )
    p.add_argument(
        "--queue",
        default=os.environ.get("N5_MISSING_ZIP_QUEUE", str(root / "QUEUE.md")),
    )
    p.add_argument(
        "--workflow",
        default=os.environ.get(
            "N5_MISSING_ZIP_WORKFLOW",
            str(root / ".github" / "workflows" / "n5-missing-zip-status.yml"),
        ),
    )
    p.add_argument(
        "--checker",
        default=os.environ.get("N5_MISSING_ZIP_CHECKER", str(Path(__file__).resolve())),
    )
    p.add_argument(
        "--unit1",
        default=os.environ.get(
            "N5_MISSING_ZIP_UNIT1",
            str(root / "docs" / "epa-decouple-phase2-unit1-core-completion-markers.sql"),
        ),
    )
    return p.parse_args(argv)


def require_zips_in(text: str, label: str) -> None:
    missing = [z for z in REQUIRED_STATUS_ZIPS if z not in text]
    if missing:
        fail("%s is missing named ZIP(s) %s" % (label, ", ".join(missing)))
    ok("%s names 94128, 95219, 99128" % label)


def require_founder_lock(text: str, label: str) -> None:
    missing = [n for n in FOUNDER_LOCK_NEEDLES if n not in text]
    if missing:
        fail("%s is missing founder-lock needle(s): %s" % (label, "; ".join(missing)))
    if "Unit 1 idea; it is rejected" not in text and "Unit 1 is rejected" not in text:
        fail("%s does not say Unit 1 is rejected" % label)
    if "_nfc >= 3" not in text:
        fail("%s does not keep the _nfc >= 3 limb" % label)
    ok("%s quotes the founder lock (Unit 1 rejected; plant-only pages stay listed)" % label)


def refuse_activate_and_indexable(path: Path, text: str, *, python: bool = False) -> None:
    body = strip_py_noise(text) if python else strip_sql_comments(strip_hash_comments(text))
    # A call is activate(...) or geo.<fn>. The scan needle is built from
    # parts; that construction is not a call. Do not write the contiguous
    # token in this file — a self-scan would then refuse the checker.
    compact = body.replace(" ", "").replace("\\", "")
    if re.search(re.escape(ACTIVATE_NEEDLE) + r"\s*\(", body) or (
        "geo." + ACTIVATE_NEEDLE
    ) in compact:
        fail("%s calls %s (this park must never activate)" % (path, ACTIVATE_NEEDLE))
    if INDEXABLE_ASSIGN_RE.search(body):
        fail("%s assigns indexable (this park must not touch indexable)" % path)
    ok("%s never activates a generation and never assigns indexable" % path.name)


def check_publish_sql(text: str) -> None:
    body = strip_sql_comments(text)
    if "n5_generation_publish_scope" not in body:
        fail("publish SQL is missing geo.n5_generation_publish_scope")
    if "canonical_zip_registry" not in body:
        fail("publish SQL does not read canonical_zip_registry")
    if "left(r.zip, 3)" not in body and "left(r.zip,3)" not in body.replace(" ", ""):
        fail("publish_scope does not union canonical prefixes from left(r.zip, 3)")
    ok("publish_scope unions shard prefixes with canonical ZIP prefixes")
    if "n5_gen_publish_prefix" not in body:
        fail("publish SQL is missing geo.n5_gen_publish_prefix")
    if re.search(
        r"insert\s+into\s+geo\.maps_zip_geography_status", body, re.IGNORECASE
    ) is None:
        fail("n5_gen_publish_prefix does not INSERT maps_zip_geography_status")
    if "from public.canonical_zip_registry" not in body and (
        "from public.canonical_zip_registry r" not in body
    ):
        # The status insert is from the registry for the prefix.
        if "canonical_zip_registry r" not in body:
            fail("status INSERT is not sourced from canonical_zip_registry")
    ok("status INSERT is sourced from canonical_zip_registry for the prefix")
    if "canonical_zip_without_status" not in body:
        fail("READY problems omit canonical_zip_without_status")
    if "n5_generation_mark_ready" not in body:
        fail("publish SQL is missing geo.n5_generation_mark_ready")
    ok("READY includes canonical_zip_without_status")


def check_parked_sql(text: str) -> None:
    if "DO NOT APPLY" not in text and "PARKED" not in text:
        fail("parked SQL is not marked DO NOT APPLY")
    if "RAISE EXCEPTION" not in text:
        fail("parked SQL must raise on apply (Unit 1 shape)")
    require_founder_lock(text, "parked SQL")
    require_zips_in(text, "parked SQL")
    body = strip_sql_comments(text)
    if "n5_named_zip_status_problems" not in body:
        fail("parked SQL is missing geo.n5_named_zip_status_problems")
    # Named list, not a prefix count. Gutting the array must fail.
    for zip_code in REQUIRED_STATUS_ZIPS:
        if "'%s'" % zip_code not in body and '"%s"' % zip_code not in body:
            fail("parked function body does not name ZIP %s (prefix-count is not enough)" % zip_code)
    if "canonical_zip_registry" not in body:
        fail("named-ZIP gate does not join canonical_zip_registry")
    if "n5_generation_publish_problems" in body:
        fail("parked SQL must be its own function, not a splice of n5_generation_publish_problems")
    ok("parked SQL names the three ZIPs in geo.n5_named_zip_status_problems (not a prefix count)")


def check_candidates(text: str) -> None:
    if "const CANDIDATES" not in text:
        fail("verify-map1-zip-states.mjs has no CANDIDATES list")
    require_zips_in(text, "CANDIDATES")
    for zip_code in REQUIRED_STATUS_ZIPS:
        # Keep them as live unknown/pending observations. Deleting them
        # would make the live verifier vacuously pass.
        if "'%s'" % zip_code not in text and '"%s"' % zip_code not in text:
            fail("CANDIDATES dropped %s (cannot pass by deleting the unknown ZIPs)" % zip_code)
    ok("CANDIDATES still includes 94128, 95219, 99128 (cannot delete)")


def check_queue(text: str) -> None:
    require_zips_in(text, "QUEUE.md")
    if "maps_zip_geography_status" not in text:
        fail("QUEUE.md no longer names maps_zip_geography_status for the 3 ZIPs")
    ok("QUEUE.md still names the 3 ZIPs with no status row")


def check_workflow(text: str) -> None:
    if "workflow_dispatch" not in text:
        fail("workflow is not dispatch-only")
    if re.search(r"^\s*schedule\s*:", text, re.MULTILINE):
        fail("workflow must not have a schedule")
    if re.search(r"^\s*push\s*:", text, re.MULTILINE):
        fail("workflow must not run on push")
    if re.search(r"^\s*pull_request\s*:", text, re.MULTILINE):
        fail("workflow must not run on pull_request")
    # Comments may name the word they forbid ("No database secret"). A pin
    # that searches the whole file for "secret" over-flags that comment.
    body = strip_hash_comments(text)
    lowered = body.lower()
    if "secrets." in lowered:
        fail("workflow must not hold secrets")
    if "supabase" in lowered:
        fail("workflow must not talk to supabase")
    if "apply_migration" in lowered or re.search(r"\bpsql\b", lowered):
        fail("workflow must not apply to the database")
    compact = body.replace(" ", "").replace("\\", "")
    if re.search(re.escape(ACTIVATE_NEEDLE) + r"\s*\(", body) or (
        "geo." + ACTIVATE_NEEDLE
    ) in compact:
        fail("workflow must not activate a generation")
    if "n5_missing_zip_status.py" not in text:
        fail("workflow does not run the parked checker")
    if "n5-missing-zip-status.test.mjs" not in text:
        fail("workflow does not run the structural test")
    ok("workflow is dispatch-only, secret-free, and runs the offline pins")


def check_unit1_rejected(text: str) -> None:
    require_founder_lock(text, "Unit 1 parked SQL")
    if "PHASE 2 UNIT 1 IS REJECTED" not in text:
        fail("Unit 1 parked SQL no longer raises PHASE 2 UNIT 1 IS REJECTED")
    ok("Unit 1 remains rejected; plant-only pages stay listed")


def check_prefixes_in_checker(text: str) -> None:
    for prefix in REQUIRED_PREFIXES:
        if "'%s'" % prefix not in text and '"%s"' % prefix not in text:
            fail("checker dropped required prefix %s" % prefix)
    ok("checker still requires prefixes 941, 952, 991")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    candidates = Path(args.candidates)
    parked = Path(args.parked_sql)
    publish = Path(args.publish_sql)
    queue = Path(args.queue)
    workflow = Path(args.workflow)
    checker = Path(args.checker)
    unit1 = Path(args.unit1)

    cand_text = read_text(candidates)
    parked_text = read_text(parked)
    publish_text = read_text(publish)
    queue_text = read_text(queue)
    wf_text = read_text(workflow)
    checker_text = read_text(checker)
    unit1_text = read_text(unit1)

    check_candidates(cand_text)
    check_parked_sql(parked_text)
    check_publish_sql(publish_text)
    check_queue(queue_text)
    check_workflow(wf_text)
    check_unit1_rejected(unit1_text)
    require_founder_lock(checker_text, "checker")
    require_zips_in(checker_text, "checker")
    check_prefixes_in_checker(checker_text)

    refuse_activate_and_indexable(parked, parked_text)
    refuse_activate_and_indexable(workflow, wf_text)
    refuse_activate_and_indexable(checker, checker_text, python=True)

    named = [z for z in REQUIRED_STATUS_ZIPS if ("'%s'" % z) in strip_sql_comments(parked_text)]
    if len(named) != 3:
        fail(
            "parked named list was gutted (%s of 3 remain); cannot pass by gutting the named list"
            % len(named)
        )
    ok("named list still has all 3 ZIPs")

    print("n5_missing_zip_status: all parked pins held")
    print("REQUIRED_STATUS_ZIPS=" + ",".join(REQUIRED_STATUS_ZIPS))
    print("REQUIRED_PREFIXES=" + ",".join(REQUIRED_PREFIXES))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
