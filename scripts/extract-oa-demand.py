#!/usr/bin/env python3
"""extract-oa-demand.py — parse local OpenAddresses region zips into demand-scoped JSONL.

Does not write to Supabase (no service-role required). Used when the GitHub workflow
cannot be dispatched and REST upsert is unavailable. Output is consumed by
oa_upsert_nap_rows() in chunks.

Env:
  OA_LOCAL_DIR   directory of oa-us_*.zip  (default /tmp/oa-load)
  OA_ZIPS_FILE   one ZIP code per line
  OA_STATES_FILE optional 2-letter states; else derived from OA_ZIPS_FILE state column
  OA_OUT         JSONL path (default /tmp/oa-demand.jsonl)
  OA_HOUSESTREET_FILE  optional allowlist; keep a row if housestreet_key is listed
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("oa", HERE / "load-openaddresses.py")
oa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oa)


def load_lines(path: str) -> list[str]:
    return [ln.strip() for ln in Path(path).read_text("utf-8").splitlines() if ln.strip() and not ln.startswith("#")]


def main() -> int:
    zips_file = os.environ.get("OA_ZIPS_FILE", "").strip()
    if not zips_file:
        raise SystemExit("FATAL: OA_ZIPS_FILE is required (one ZIP per line, or ZIP<TAB>STATE)")
    pairs: list[tuple[str, str]] = []
    zips: set[str] = set()
    states: set[str] = set()
    for ln in load_lines(zips_file):
        parts = ln.replace(",", " ").split()
        z = parts[0][:5]
        s = parts[1].upper() if len(parts) > 1 else ""
        zips.add(z)
        if s:
            states.add(s)
        pairs.append((z, s))
    extra_states = os.environ.get("OA_STATES_FILE", "").strip()
    if extra_states:
        states.update(x.upper() for x in load_lines(extra_states))
    if not states:
        states = {s for z, s in pairs if s and s in oa.STATE_REGION}
        # ZIP-only rows: include every mapped state so we do not drop a demand ZIP
        if any(not s for _, s in pairs):
            states = set(oa.STATE_REGION)
    allow = None
    hs_file = os.environ.get("OA_HOUSESTREET_FILE", "").strip()
    if hs_file:
        allow = set(load_lines(hs_file))
    srcdir = Path(os.environ.get("OA_LOCAL_DIR", "/tmp/oa-load"))
    out = Path(os.environ.get("OA_OUT", "/tmp/oa-demand.jsonl"))
    vintage = oa.vintage_stamp()
    loaded_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    regions = sorted({oa.STATE_REGION[s] for s in states if s in oa.STATE_REGION})
    seen: set[str] = set()
    written = 0
    quarantined = 0
    with out.open("w", encoding="utf-8") as fh:
        for region in regions:
            tmp = srcdir / f"oa-{region}.zip"
            if not tmp.exists():
                print(f"  skip {region}: {tmp} missing", flush=True)
                continue
            stats = {"quarantined": 0}
            for canon, lat, lng, state, source, mt in oa.parse_region(region, states, zips, tmp, stats):
                if allow is not None and oa.housestreet_key(canon) not in allow:
                    continue
                batch: list = []
                oa.enqueue(seen, batch, vintage, loaded_at, canon, lat, lng, state, source, mt)
                for row in batch:
                    fh.write(json.dumps(row, separators=(",", ":")) + "\n")
                    written += 1
            quarantined += stats.get("quarantined", 0)
    print(json.dumps({
        "out": str(out),
        "zips": len(zips),
        "states": sorted(states),
        "regions": regions,
        "distinct_canonical": len(seen),
        "rows_written": written,
        "quarantined": quarantined,
        "vintage": vintage,
        "allowlist": len(allow) if allow is not None else None,
    }, sort_keys=True), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
