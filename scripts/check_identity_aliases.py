#!/usr/bin/env python3
"""CI parity check (offline, stdlib): the registry, the alias files, and the engine's loader agree.   --root DIR for tests.

Fails when:
  A. an arcgis entry names identity_aliases_file but the file is absent, unsound, belongs to another registry_id /
     column, or the entry also sets identity_fields (a compound identity already exists);
  B. a file in identity-aliases/ is not named by any entry (a generated fix nobody reads) or not loaded by
     identity-aliases/index.ts (the engine would ship the registry line and silently use legacy keys);
  C. index.ts loads a file that does not exist;
  D. a file's own alias_fingerprint / counts do not recompute (hand-edited);
  E0. the engine (index.ts) does not load IDENTITY_ALIAS_FILES and hand it to arcgisForZip as deps.identityAliases;
  E. scripts/n5_shard.py no longer routes fetch_features through scripts/identity_aliases.py (the fetcher and the
     connector would key the same record differently).
Prints the control it measured (entries checked / files found) so a vacuous pass is visible.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import identity_aliases as ia  # noqa: E402


def check(root):
    reg_path = os.path.join(root, "supabase/functions/get-address-report/jurisdiction-registry.json")
    adir = os.path.join(root, "supabase/functions/get-address-report/identity-aliases")
    idx = os.path.join(adir, "index.ts")
    errs = []
    reg = json.load(open(reg_path, encoding="utf-8"))
    entries = [e for e in reg.get("arcgis", []) if e.get("identity_aliases_file")]
    for k, v in reg.items():                          # the option is ArcGIS-only; anywhere else it would be ignored
        if k != "arcgis" and isinstance(v, list):
            for e in v:
                if isinstance(e, dict) and e.get("identity_aliases_file"):
                    errs.append(f"{e.get('registry_id')}: identity_aliases_file is only honoured on arcgis entries")
    files = sorted(f for f in os.listdir(adir) if f.endswith(".json")) if os.path.isdir(adir) else []
    idx_text = open(idx, encoding="utf-8").read() if os.path.exists(idx) else ""
    if not idx_text:
        errs.append("identity-aliases/index.ts is missing")
    loaded = set(re.findall(r'^\s*"([^"]+\.json)"\s*:', idx_text, re.M))
    imported = set(re.findall(r'^import\s+\w+\s+from\s+"\./([^"]+\.json)"\s+with\s+\{\s*type:\s*"json"\s*\}', idx_text, re.M))
    named = set()
    for e in entries:
        name = e["identity_aliases_file"]
        rid = e["registry_id"]
        named.add(name)
        if e.get("identity_fields"):
            errs.append(f"{rid}: identity_fields and identity_aliases_file are mutually exclusive")
        path = os.path.join(adir, name)
        if not os.path.exists(path):
            errs.append(f"{rid}: identity_aliases_file {name} does not exist in identity-aliases/")
            continue
        obj = ia.load_alias_file(path)
        for p in ia.validate_alias_file(obj):
            errs.append(f"{name}: {p}")
        if obj.get("registry_id") != rid:
            errs.append(f"{name}: registry_id {obj.get('registry_id')!r} != entry {rid!r}")
        cn = (e.get("column_map") or {}).get("case_number")
        if obj.get("id_field") != cn:
            errs.append(f"{name}: id_field {obj.get('id_field')!r} != entry column_map.case_number {cn!r}")
        if name not in loaded or name not in imported:
            errs.append(f"{rid}: {name} is named by the registry but identity-aliases/index.ts does not import AND list it")
    for f in files:
        if f not in named:
            errs.append(f"{f}: present but no registry entry names it (an unread alias file does nothing)")
        if f not in loaded or f not in imported:
            errs.append(f"{f}: present but identity-aliases/index.ts does not import AND list it")
    for f in sorted(loaded | imported):
        if f not in files:
            errs.append(f"index.ts loads {f} but the file does not exist")
    engine = os.path.join(root, "supabase/functions/get-address-report/index.ts")
    if os.path.exists(engine):
        t = open(engine, encoding="utf-8").read()
        if not re.search(r'import\s*\{\s*IDENTITY_ALIAS_FILES\s*\}\s*from\s*"\./identity-aliases/index\.ts"', t) or "identityAliases: IDENTITY_ALIAS_FILES" not in t:
            errs.append("engine index.ts does not import IDENTITY_ALIAS_FILES and pass it to arcgisForZip as identityAliases (the registry line would silently do nothing)")
    shard = os.path.join(root, "scripts/n5_shard.py")
    if os.path.exists(shard):
        t = open(shard, encoding="utf-8").read()
        if "identity_aliases" not in t or "identity_aliases_file" not in t:
            errs.append("scripts/n5_shard.py does not route fetch_features through identity_aliases (fetcher and connector would disagree)")
    print(f"[check_identity_aliases] arcgis entries opting in: {len(entries)} | alias files: {len(files)} | index.ts loads: {len(loaded)}")
    return errs


def main():
    root = sys.argv[sys.argv.index("--root") + 1] if "--root" in sys.argv else os.path.dirname(HERE)
    errs = check(root)
    for e in errs:
        print("FAIL: " + e)
    if errs:
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
