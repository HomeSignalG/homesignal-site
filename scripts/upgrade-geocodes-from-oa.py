#!/usr/bin/env python3
"""upgrade-geocodes-from-oa.py — copy outranking OA points into public.geocodes.

Calls public.upgrade_geocodes_from_national_address_points(): upgrade-only. A Census or
failed cache row becomes openaddresses/parcel_centroid when NAP outranks it. An existing
OA row refreshes coordinates when they moved. Never downgrades. Never deletes.
"""

import json
import os
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path


def supabase_url() -> str:
    u = os.environ.get("SUPABASE_URL", "").strip()
    if u:
        return u.rstrip("/")
    html = (Path(__file__).resolve().parent.parent / "homesignalmap.html").read_text("utf-8")
    m = re.search(r'var ENDPOINT\s*=\s*["\']([^"\']+)["\']', html)
    if not m:
        raise SystemExit("FATAL: SUPABASE_URL not set and ENDPOINT not found in homesignalmap.html")
    return re.sub(r"/functions/v1/.*$", "", m.group(1)).rstrip("/")


def main() -> int:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not key:
        raise SystemExit("FATAL: SUPABASE_SERVICE_ROLE_KEY not set. Stopping — not retrying blind.")
    if os.environ.get("DRY_RUN", "").strip() == "1":
        print("upgrade-geocodes-from-oa: DRY_RUN=1 — skipping write", flush=True)
        return 0
    req = urllib.request.Request(
        f"{supabase_url()}/rest/v1/rpc/upgrade_geocodes_from_national_address_points",
        data=b"{}",
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            body = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        raise SystemExit(f"FATAL: upgrade RPC failed HTTP {e.code} — {detail}") from e
    print("OA_GEOCODE_UPGRADE " + (body or "[]"), flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("\n## Geocode upgrade from OpenAddresses\n\n```json\n")
            try:
                fh.write(json.dumps(json.loads(body), indent=2))
            except json.JSONDecodeError:
                fh.write(body or "[]")
            fh.write("\n```\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
