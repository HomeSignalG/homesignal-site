#!/usr/bin/env python3
"""Compound record identity for layers whose identifier column is REUSED (stdlib only; no network at import).

This is the ONE Python home of the rule. Its TypeScript twin is supabase/functions/get-address-report/sources/identity-aliases.ts
(`applyIdentityAlias`); both are pinned to the same cases by test/identity-alias-parity.test.mjs. scripts/n5_shard.py,
scripts/gen_identity_aliases.py and scripts/check_identity_aliases.py import from here and keep no private copy.

THE RULE (docs/denton-permit-identity-design-2026-10-14.md, extended by docs/denton-workstream-b-2026-10-14.md):
  * Among the features that share one identifier value, the LOWEST OBJECTID keeps the LEGACY identity (the bare id).
  * Any later feature that is a DIFFERENT record gets  <id>#<OBJECTID>.
  * A later feature that is a TRUE PUBLISHER DUPLICATE of an earlier record (same attributes, same place within
    DUPLICATE_M metres) takes THAT record's identity, so exact-identity dedup keeps collapsing it.
  * Unique ids, blank ids and ids not in the file are never touched.

The alias set is computed from a FULL read of the layer (never from a ZIP envelope, which sees only some of a reused id's
features) and fingerprinted ORDER-INDEPENDENTLY (sum of per-row md5 prefixes: no collation, no sort - claims rules 8 and 9).
"""
import hashlib
import json
import math
import re

VERSION = 1
DUPLICATE_M = 30.0                      # two features this close AND attribute-identical are one record
DEFAULT_IGNORE_PREFIXES = ("shape",)    # Shape__Area / Shape__Length etc. are derived, never identity
DEFAULT_IGNORE_FIELDS = ("globalid",)


def norm_id(v):
    """The identifier as the connector reads it: valOrNull(String(v).trim()). None for null/blank."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)                      # JS String(1.0) === "1"
    s = str(v).strip()
    return s or None


def norm_oid(v):
    s = norm_id(v)
    if s is None or not re.fullmatch(r"-?\d+", s):
        raise ValueError(f"object id {v!r} is not an integer")
    return str(int(s))


def row_hash32(text):
    """First 32 bits of md5, as an int. Summed (not sorted) so no collation or ordering can matter."""
    return int(hashlib.md5(text.encode("utf-8")).hexdigest()[:8], 16)


def fingerprint(pairs):
    """Order-independent fingerprint of (oid, identity) pairs: 'n:<count>:<sum of row_hash32>'."""
    n, total = 0, 0
    for oid, ident in pairs:
        n += 1
        total += row_hash32(f"{oid}|{ident}")
    return f"n:{n}:{total}"


def haversine_m(x1, y1, x2, y2):
    p1, p2 = math.radians(y1), math.radians(y2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(x2 - x1) / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(min(1.0, a)))


def _comparable_attrs(attrs, oid_field, ignore_fields):
    skip = {oid_field.lower(), *DEFAULT_IGNORE_FIELDS, *(f.lower() for f in ignore_fields)}
    out = {}
    for k, v in (attrs or {}).items():
        kl = k.lower()
        if kl in skip or kl.startswith(DEFAULT_IGNORE_PREFIXES):
            continue
        out[k] = norm_id(v) if v is not None else None
    return out


def true_duplicate(a, b, oid_field, ignore_fields=(), tol_m=DUPLICATE_M):
    """Both features carry a point, are within tol_m, and have identical comparable attributes.
    A missing point, or ANY difference, means NOT a duplicate (a wrongly-merged pair is the defect this exists to prevent;
    a wrongly-split pair costs one extra identical-looking record)."""
    if a.get("x") is None or a.get("y") is None or b.get("x") is None or b.get("y") is None:
        return False
    if haversine_m(float(a["x"]), float(a["y"]), float(b["x"]), float(b["y"])) > tol_m:
        return False
    return _comparable_attrs(a.get("attrs"), oid_field, ignore_fields) == _comparable_attrs(b.get("attrs"), oid_field, ignore_fields)


def identities(features, id_field, oid_field, ignore_fields=(), tol_m=DUPLICATE_M):
    """features: iterable of {"attrs": {...}, "x": lng|None, "y": lat|None}. Returns ({oid: identity}, stats).
    `identity` is the bare id for the legacy feature and for exact duplicates of it, '<id>#<rep oid>' otherwise."""
    groups, seen_oids, blank = {}, set(), 0
    for f in features:
        a = f.get("attrs") or {}
        oid = norm_oid(a.get(oid_field))
        if oid in seen_oids:
            raise ValueError(f"object id {oid} appears twice: the layer scan is not one row per feature")
        seen_oids.add(oid)
        ident = norm_id(a.get(id_field))
        if ident is None:
            blank += 1
            continue
        groups.setdefault(ident, []).append((int(oid), oid, f))
    out, stats = {}, {"features": len(seen_oids), "blank_id": blank, "distinct_ids": len(groups), "reused_ids": 0,
                      "reused_ids_all_true_duplicates": 0, "reused_ids_with_distinct_records": 0,
                      "aliased_features": 0, "duplicate_features_collapsed": 0, "distinct_record_features": 0}
    for ident, members in groups.items():
        members.sort(key=lambda t: t[0])
        reps = []                                   # [(oid_str, feature)] distinct records so far, lowest oid first
        group_out = {}
        for _, oid, f in members:
            for roid, rf in reps:
                if true_duplicate(f, rf, oid_field, ignore_fields, tol_m):
                    group_out[oid] = group_out[roid]
                    break
            else:
                group_out[oid] = ident if not reps else f"{ident}#{oid}"
                reps.append((oid, f))
        out.update(group_out)
        if len(members) > 1:
            stats["reused_ids"] += 1
            if len(reps) == 1:
                stats["reused_ids_all_true_duplicates"] += 1
            else:
                stats["reused_ids_with_distinct_records"] += 1
            for _, oid, _f in members[1:]:
                if group_out[oid] != ident:
                    stats["aliased_features"] += 1          # carries an alias entry in the file
                if group_out[oid] == f"{ident}#{oid}":
                    stats["distinct_record_features"] += 1  # its own record
                else:
                    stats["duplicate_features_collapsed"] += 1  # shares an earlier record's identity
    return out, stats


def build_alias_file(features, registry_id, id_field, oid_field, scan_date, service_url, ignore_fields=(), tol_m=DUPLICATE_M):
    """The committed file. `aliases` lists ONLY features whose identity is not the bare id (the legacy ones are implicit)."""
    ids, stats = identities(features, id_field, oid_field, ignore_fields, tol_m)
    # bare id per oid, to tell which identities differ from it
    bare = {}
    for f in features:
        a = f.get("attrs") or {}
        i = norm_id(a.get(id_field))
        if i is not None:
            bare[norm_oid(a.get(oid_field))] = i
    aliases = {oid: ident for oid, ident in ids.items() if ident != bare[oid]}
    layer_pairs = [(oid, bare[oid]) for oid in bare]
    # EVIDENCE for every member of a reused id: where each OBJECTID sits. This is what catches a publisher renumbering that
    # SWAPS two features of the same id (the alias set and the (oid -> id) fingerprint are identical before and after such a
    # swap, yet the legacy key would silently change owner - design doc risk 2). Compared with tolerance, so a re-geocoded
    # point does not flap the daily check; also the reviewable table behind each alias.
    members = {}
    for f in features:
        a = f.get("attrs") or {}
        i = norm_id(a.get(id_field))
        if i is not None:
            members.setdefault(i, []).append(f)
    evidence = []
    for i in sorted(members):
        if len(members[i]) < 2:
            continue
        for f in sorted(members[i], key=lambda t: int(norm_oid(t["attrs"].get(oid_field)))):
            oid = norm_oid(f["attrs"].get(oid_field))
            evidence.append({"id": i, "oid": oid, "identity": ids[oid],
                             "x": None if f.get("x") is None else round(float(f["x"]), 6),
                             "y": None if f.get("y") is None else round(float(f["y"]), 6)})
    return {
        "version": VERSION,
        "registry_id": registry_id,
        "id_field": id_field,
        "oid_field": oid_field,
        "aliases": dict(sorted(aliases.items(), key=lambda kv: int(kv[0]))),
        "evidence": evidence,
        "scan": {
            "scan_date": scan_date, "service_url": service_url,
            "rule": "lowest-oid-keeps-legacy; distinct-records-get-id#oid; true-duplicates-share-identity",
            "duplicate_tolerance_m": tol_m, "ignored_fields": sorted(ignore_fields),
            **stats,
            # (oid -> bare id) over EVERY identified feature: any renumbering, new reuse or re-keying moves it
            "layer_fingerprint": fingerprint(layer_pairs),
            # (oid -> identity) over the alias entries: integrity of this file
            "alias_fingerprint": fingerprint(aliases.items()),
        },
    }


def validate_alias_file(obj):
    """Returns a list of problems (empty = sound). Offline: needs no network."""
    p = []
    if not isinstance(obj, dict):
        return ["not an object"]
    if obj.get("version") != VERSION:
        p.append(f"version {obj.get('version')!r} != {VERSION}")
    for k in ("registry_id", "id_field", "oid_field"):
        if not isinstance(obj.get(k), str) or not obj.get(k):
            p.append(f"{k} missing")
    al = obj.get("aliases")
    if not isinstance(al, dict):
        return p + ["aliases is not an object"]
    scan = obj.get("scan") if isinstance(obj.get("scan"), dict) else {}
    for oid, ident in al.items():
        if not re.fullmatch(r"\d+", str(oid)):
            p.append(f"alias key {oid!r} is not an OBJECTID")
        if not isinstance(ident, str) or "#" not in ident:
            p.append(f"alias value for {oid} must be '<id>#<oid>', got {ident!r}")
        else:
            base, _, rep = ident.rpartition("#")
            if not base or not re.fullmatch(r"\d+", rep):
                p.append(f"alias value for {oid} is malformed: {ident!r}")
            elif int(rep) > int(oid):
                p.append(f"alias for {oid} points at a LATER representative {rep}")
    ev = obj.get("evidence")
    if not isinstance(ev, list):
        p.append("evidence missing (the per-feature location table the renumbering check compares)")
    else:
        for r in ev:
            if not isinstance(r, dict) or not all(k in r for k in ("id", "oid", "identity", "x", "y")):
                p.append(f"evidence row malformed: {r!r}")
                continue
            oid, ident = str(r["oid"]), r["identity"]
            if (ident != r["id"]) != (oid in al) or (oid in al and al[oid] != ident):
                p.append(f"evidence for OBJECTID {oid} disagrees with aliases")
        if {str(r.get("oid")) for r in ev if isinstance(r, dict)} < set(al):
            p.append("an alias has no evidence row")
    if scan.get("alias_fingerprint") != fingerprint(al.items()):
        p.append("scan.alias_fingerprint does not recompute from aliases (file edited by hand?)")
    if scan.get("aliased_features") != len(al):
        p.append(f"scan.aliased_features {scan.get('aliased_features')!r} != {len(al)} alias entries")
    if not isinstance(scan.get("layer_fingerprint"), str):
        p.append("scan.layer_fingerprint missing")
    return p


def diff_alias_files(committed, fresh):
    """Why a committed alias file no longer equals a fresh scan of the live layer ([] = equal). The ONE comparison, used by the
    daily live check. A moved layer_fingerprint catches OBJECTID renumbering, new reuse and re-keying even when the alias set
    happens to look the same."""
    bad = []
    if (committed.get("scan") or {}).get("layer_fingerprint") != (fresh.get("scan") or {}).get("layer_fingerprint"):
        bad.append("layer_fingerprint moved (a feature was added, removed, renumbered or re-keyed at the publisher)")
    ce = {str(r["oid"]): r for r in committed.get("evidence") or [] if isinstance(r, dict)}
    fe = {str(r["oid"]): r for r in fresh.get("evidence") or [] if isinstance(r, dict)}
    moved = []
    for oid, r in ce.items():
        q = fe.get(oid)
        if q is None:
            moved.append(f"OBJECTID {oid} is no longer a member of a reused id")
        elif q["id"] != r["id"]:
            moved.append(f"OBJECTID {oid} changed id {r['id']!r} -> {q['id']!r}")
        elif (r["x"] is None) != (q["x"] is None) or (r["x"] is not None and haversine_m(r["x"], r["y"], q["x"], q["y"]) > DUPLICATE_M):
            moved.append(f"OBJECTID {oid} of id {r['id']!r} now sits elsewhere (renumbering/re-geocoding: its legacy-or-alias key would change owner)")
    if moved:
        bad.append(f"{len(moved)} reused-id feature(s) moved: " + "; ".join(moved[:3]))
    ca, fa = committed.get("aliases") or {}, fresh.get("aliases") or {}
    if ca != fa:
        added = sorted(set(fa) - set(ca), key=int)
        gone = sorted(set(ca) - set(fa), key=int)
        changed = sorted((k for k in set(ca) & set(fa) if ca[k] != fa[k]), key=int)
        bad.append(f"alias set differs: {len(added)} new, {len(gone)} no longer needed, {len(changed)} re-pointed"
                   f" (first: new {added[:3]} gone {gone[:3]} changed {changed[:3]})")
    return bad


def load_alias_file(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def source_identity(base, oid, alias_file):
    """Python twin of applyIdentityAlias: the alias when listed AND it extends the row's current id, else `base`."""
    if alias_file is None or base is None or oid is None:
        return base
    key = str(oid).strip()
    if not key:
        return base
    al = (alias_file.get("aliases") or {})
    if key not in al:
        return base
    a = al[key]
    return a if isinstance(a, str) and a.startswith(base + "#") else base


def reverse_index(alias_file):
    """{alias identity: (bare id, [oids])} - what a fetch-by-identity needs. Duplicates collapsed onto one alias share it."""
    out = {}
    for oid, ident in (alias_file or {}).get("aliases", {}).items():
        base = ident.rpartition("#")[0]
        out.setdefault(ident, (base, []))[1].append(oid)
    return out
