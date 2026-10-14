#!/usr/bin/env python3
"""Generate / verify the identity-alias file for a registry entry. READ-ONLY against the publisher; writes only the file you name.

  gen_identity_aliases.py --registry-id denton-county-dev-permits --scan --stdout          # runner: print the file (job log is the channel)
  gen_identity_aliases.py --registry-id denton-county-dev-permits --scan --out PATH        # runner: write it
  gen_identity_aliases.py --registry-id denton-county-dev-permits --check-live             # runner, daily: re-scan, compare with the committed file
  gen_identity_aliases.py --from-json FIXTURE.json --registry-id X --stdout                # offline: build from a saved scan

The scan reads EVERY feature of the layer (where=1=1, never the registry's extra_where: identity is a property of the layer,
and a ZIP envelope or a type whitelist sees only some of a reused id's features). Paging follows exceededTransferLimit and the
publisher's own page size; a failed page FAILS the run (an incomplete scan must never become a committed alias set).

The sandbox this repo is developed in has no egress to publisher hosts: the scan runs on a GitHub runner
(.github/workflows/check-identity-aliases.yml). Nothing here is applied to production.
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import identity_aliases as ia  # noqa: E402

ROOT = os.path.dirname(HERE)
REGISTRY = os.path.join(ROOT, "supabase/functions/get-address-report/jurisdiction-registry.json")
ALIAS_DIR = os.path.join(ROOT, "supabase/functions/get-address-report/identity-aliases")
UA = "Mozilla/5.0 (HomeSignal identity-alias scan; read-only)"
PAGE = 1000


def registry_entry(registry_id):
    reg = json.load(open(REGISTRY, encoding="utf-8"))
    for e in reg.get("arcgis", []):
        if e.get("registry_id") == registry_id:
            return e
    raise SystemExit(f"STOP: no arcgis registry entry {registry_id!r}")


def http_json(url, params, tries=3):
    body = urllib.parse.urlencode(params).encode()
    last = None
    for a in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                j = json.loads(r.read().decode("utf-8", "replace"))
            if isinstance(j, dict) and j.get("error"):
                raise RuntimeError(json.dumps(j["error"])[:200])
            return j
        except Exception as ex:                      # noqa: BLE001 - re-raised below after the retries
            last = ex
            time.sleep(3 * (a + 1))
    raise SystemExit(f"STOP: publisher read failed after {tries} tries: {last}")


def scan_layer(service_url, oid_field, id_field, fetch=http_json):
    """Every feature of the layer as {attrs, x, y}. Raises (SystemExit) on any failed page; never returns a partial scan."""
    url = service_url.rstrip("/") + "/query"
    feats, off = [], 0
    while True:
        j = fetch(url, {"f": "json", "where": "1=1", "outFields": "*", "returnGeometry": "true", "outSR": "4326",
                        "resultOffset": off, "resultRecordCount": PAGE, "orderByFields": oid_field})
        fs = j.get("features")
        if not isinstance(fs, list):
            raise SystemExit("STOP: a page came back without a features array; refusing a partial scan")
        for f in fs:
            g = f.get("geometry") or {}
            feats.append({"attrs": f.get("attributes") or {}, "x": ia.finite_coord(g.get("x")), "y": ia.finite_coord(g.get("y"))})
        off += len(fs)
        if not fs or (j.get("exceededTransferLimit") is False) or (j.get("exceededTransferLimit") is not True and len(fs) < PAGE):
            break
        if off > 2_000_000:
            raise SystemExit("STOP: scan exceeded 2,000,000 features; refusing")
    if not feats:
        raise SystemExit("STOP: the layer returned zero features; refusing to treat an empty read as 'no reuse'")
    if not any(ia.norm_id(f["attrs"].get(id_field)) for f in feats):
        raise SystemExit(f"STOP: no feature carries {id_field}; the id column name is wrong (a zero here is an instrument fault, not 'no reuse')")
    return feats


def build(entry, feats, scan_date):
    cm = entry.get("column_map") or {}
    id_field = cm.get("case_number")
    if not isinstance(id_field, str):
        raise SystemExit("STOP: entry has no single-column case_number to disambiguate")
    return ia.build_alias_file(feats, entry["registry_id"], id_field, "OBJECTID", scan_date, entry["service_url"])


def dump(obj):
    return json.dumps(obj, indent=1, sort_keys=False, allow_nan=False) + "\n"   # raises on NaN/Infinity: the file must be strict JSON


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--registry-id", required=True)
    ap.add_argument("--scan", action="store_true")
    ap.add_argument("--from-json", help="offline: a saved scan [{attrs,x,y},...]")
    ap.add_argument("--out")
    ap.add_argument("--stdout", action="store_true")
    ap.add_argument("--check-live", action="store_true")
    ap.add_argument("--date", default=time.strftime("%Y-%m-%d", time.gmtime()))
    a = ap.parse_args(argv)
    entry = registry_entry(a.registry_id)
    if a.from_json:
        feats = json.load(open(a.from_json, encoding="utf-8"))
    elif a.scan or a.check_live:
        feats = scan_layer(entry["service_url"], "OBJECTID", (entry.get("column_map") or {}).get("case_number"))
    else:
        raise SystemExit("STOP: choose --scan, --check-live or --from-json")
    fresh = build(entry, feats, a.date)
    problems = ia.validate_alias_file(fresh)
    if problems:
        raise SystemExit("STOP: generated file fails its own validation: " + "; ".join(problems))
    s = fresh["scan"]
    print(f"[scan] features {s['features']} | distinct ids {s['distinct_ids']} | reused ids {s['reused_ids']} "
          f"(all true duplicates {s['reused_ids_all_true_duplicates']}, with distinct records {s['reused_ids_with_distinct_records']}) | "
          f"alias entries {s['aliased_features']} (distinct records {s['distinct_record_features']}, duplicates folded {s['duplicate_features_collapsed']})",
          file=sys.stderr)
    if a.check_live:
        path = os.path.join(ALIAS_DIR, a.registry_id + ".json")
        if not os.path.exists(path):
            print(f"FAIL: no committed alias file {path}; the live layer has {s['reused_ids']} reused ids", file=sys.stderr)
            return 1
        old = ia.load_alias_file(path)
        bad = ia.diff_alias_files(old, fresh)
        if bad:
            for b in bad:
                print("FAIL: " + b, file=sys.stderr)
            print("Regenerate with --scan, review the diff, and commit; never edit the file by hand.", file=sys.stderr)
            return 1
        print("OK: committed alias file equals the live layer's reuse set", file=sys.stderr)
        return 0
    text = dump(fresh)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    if a.stdout:
        print("----- BEGIN ALIAS FILE -----")
        print(text, end="")
        print("----- END ALIAS FILE -----")
    return 0


if __name__ == "__main__":
    sys.exit(main())
