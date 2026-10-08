#!/usr/bin/env python3
"""A stand-in for scripts/n5_preactivation_browser.mjs, used ONLY by run_lifecycle.py, which
proves the orchestration (READY -> prove -> ACTIVATE) through the real orchestrator. The browser
step itself is proven separately, in a real browser, by test/n5-preactivation-browser.browser.test.mjs.

It reads the same input file and writes the same result shape. It passes a ZIP only when both
generations' answers are present and carry a status, so a broken input still fails here.
STUB_BROWSER_RESULT=fail makes it report a mismatch on every ZIP (a failed browser proof)."""
import json
import os
import sys

args = sys.argv[1:]
inp = json.load(open(args[args.index("--input") + 1]))
fail = os.environ.get("STUB_BROWSER_RESULT", "") == "fail"
zips = inp.get("zips") or []
good = [z for z in zips if isinstance(z.get("candidate"), dict) and isinstance(z.get("baseline"), dict)
        and z["candidate"].get("status") and z["baseline"].get("status")]
mismatches = len(zips) if fail else len(zips) - len(good)
out = {"candidate_generation_id": inp.get("candidate_generation_id"),
       "baseline_generation_id": inp.get("baseline_generation_id"),
       "zips_checked": len(good), "mismatches": mismatches,
       "differing_zips": sum(1 for z in good if z["candidate"] != z["baseline"]),
       "passed": mismatches == 0 and len(good) > 0, "stub": True}
json.dump(out, open(args[args.index("--out") + 1], "w"))
sys.exit(0 if out["passed"] else 1)
