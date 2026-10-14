"""Offline proof of the compound-identity rule, its generator, its fingerprints, the shard fetch routing and the CI checker.

    python3 -I scripts/test_identity_aliases.py            (also run by test/identity-alias-parity.test.mjs)

No network. Layer data is test/fixtures/identity-aliases/denton-shaped-scan.json - SYNTHETIC rows shaped like the Denton
DEV_Permits layer, one per reuse shape the rule must decide. The shard test drives the SHIPPED scripts/n5_shard.fetch_features
against a fake ArcGIS layer (the scripts/test_recovery_batching.py pattern). Property list:

  - the lowest OBJECTID of a reused id keeps the legacy identity; a different record gets <id>#<OBJECTID>; a true duplicate shares
  - ids that appear once, blank ids and ids not in the file are never touched
  - the result does not depend on input order; the fingerprints are order-independent and move on ANY renumbering/re-keying
  - a hand-edited file fails validation; a stale alias is never applied to a re-keyed id (source_identity)
  - fetch_features asks the publisher for the BARE id, routes each feature by OBJECTID, and gives each key only its own feature
  - without the opt-in the fetch is byte-for-byte what it was (both features of a reused id under the legacy key)
  - an opted-in entry with an unusable file is EXCLUDED, never fetched under legacy keys
  - the CI checker fails on every registry/file/loader disagreement it claims to
"""
import copy
import json
import os
import random
import re
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
os.environ.setdefault("SUPABASE_ACCESS_TOKEN", "test-token-not-a-secret")
import identity_aliases as ia  # noqa: E402
import check_identity_aliases as chk  # noqa: E402
import n5_shard as M  # noqa: E402

fails = 0


def ok(c, name, detail=None):
    global fails
    print(("PASS" if c else "FAIL") + " - " + name + ("" if c or detail is None else "\n     " + str(detail)[:400]))
    if not c:
        fails += 1


FIX = os.path.join(ROOT, "test/fixtures/identity-aliases")
SCAN = json.load(open(os.path.join(FIX, "denton-shaped-scan.json"), encoding="utf-8"))["features"]
PARITY = json.load(open(os.path.join(FIX, "parity-cases.json"), encoding="utf-8"))
RID, IDF, OIDF = "denton-county-dev-permits", "PermitID", "OBJECTID"


def build(feats, **kw):
    return ia.build_alias_file(feats, RID, IDF, OIDF, "2026-10-14", "synthetic", **kw)


F = build(SCAN)
A = F["aliases"]

# ── 1. the rule ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok(A == {"12": "19990001#12", "21": "19990002#21", "31": "19990003#31", "41": "19990004#41", "42": "19990004#41",
         "311": "20062250#311", "4001": "20062248#4001"}, "alias set is exactly the expected one", A)
ok("101" not in A and "10" not in A and "20" not in A and "30" not in A and "40" not in A and "55" not in A and "310" not in A,
   "the LOWEST OBJECTID of every reused id keeps the legacy identity (not in the file)")
ok("56" not in A and "11" not in A, "true duplicates of the legacy record keep the legacy identity (not in the file)")
ok(A["42"] == A["41"], "a true duplicate of a NON-primary record shares that record's alias")
ok(A["311"] == "20062250#311", "features with no geometry are never assumed identical (distinct record, alias)")
ok(not any(k in A for k in ("200", "201", "300", "301")), "unique ids and blank ids are never touched")
s = F["scan"]
ok((s["features"], s["blank_id"], s["distinct_ids"], s["reused_ids"], s["aliased_features"], s["distinct_record_features"], s["duplicate_features_collapsed"])
   == (20, 2, 9, 7, 7, 6, 3), "scan stats add up: 20 features, 2 blank, 9 ids, 7 reused, 7 aliased = 6 distinct + 1 folded alias; 3 folded in all", s)
ok(s["reused_ids_all_true_duplicates"] == 1 and s["reused_ids_with_distinct_records"] == 6, "groups classified: 1 all-duplicate, 6 with distinct records")

# attribute difference at the SAME place is a different record (the 19990002 pair); far apart with identical attributes too (19990003)
ok(A.get("21") and A.get("31"), "same place + different attributes, and same attributes + far apart, are both distinct records")
# the tolerance is real: at 100 m the 55/56-style pair stops being a duplicate
far = copy.deepcopy(SCAN)
for f in far:
    if f["attrs"]["OBJECTID"] == 56:
        f["x"] += 0.002
ok("56" in build(far)["aliases"], "the 30 m tolerance is real: a ~170 m neighbour with identical attributes is a distinct record")

# ── 2. determinism and fingerprints ─────────────────────────────────────────────────────────────────────────────────────────────
for seed in range(5):
    sh = SCAN[:]
    random.Random(seed).shuffle(sh)
    b = build(sh)
    if b["aliases"] != A or b["scan"]["layer_fingerprint"] != F["scan"]["layer_fingerprint"] or b["scan"]["alias_fingerprint"] != F["scan"]["alias_fingerprint"]:
        ok(False, f"input order {seed} changes the result")
        break
else:
    ok(True, "the file does not depend on the order the layer was read in (5 shuffles; order-independent fingerprints)")
ok(ia.fingerprint([("1", "a"), ("2", "b")]) == ia.fingerprint([("2", "b"), ("1", "a")]), "fingerprint is order-independent")
ok(ia.fingerprint([("1", "a")]) != ia.fingerprint([("1", "b")]) and ia.fingerprint([("1", "a")]) != ia.fingerprint([("2", "a")]),
   "fingerprint moves when either the OBJECTID or the identity changes")
ok(ia.fingerprint([]) == "n:0:0", "empty fingerprint is well-defined (and the count is part of it)")

# ── 3. the renumbering guard: the live check goes red on any change to the (OBJECTID -> id) mapping ──────────────────────────────
ok(ia.diff_alias_files(F, build(SCAN)) == [], "an unchanged layer: the live comparison is clean")
swap = copy.deepcopy(SCAN)
for f in swap:
    if f["attrs"]["OBJECTID"] == 101:
        f["attrs"]["OBJECTID"] = 4001
    elif f["attrs"]["OBJECTID"] == 4001:
        f["attrs"]["OBJECTID"] = 101
sw = ia.diff_alias_files(F, build(swap))
ok(build(swap)["aliases"] == A and build(swap)["scan"]["layer_fingerprint"] == F["scan"]["layer_fingerprint"],
   "control: two features of ONE id trading OBJECTIDs leaves the alias set AND the (oid -> id) fingerprint unchanged (why they are not enough)")
ok(any("moved" in x and "now sits elsewhere" in x for x in sw), "...yet the evidence table catches it (the legacy key would silently change owner)", sw)
# a renumbering the alias set cannot see: two UNIQUE ids trade OBJECTIDs
sw2 = copy.deepcopy(SCAN)
for f in sw2:
    if f["attrs"]["OBJECTID"] == 200:
        f["attrs"]["OBJECTID"] = 201
    elif f["attrs"]["OBJECTID"] == 201:
        f["attrs"]["OBJECTID"] = 200
d2 = ia.diff_alias_files(F, build(sw2))
ok(build(sw2)["aliases"] == A and any("layer_fingerprint moved" in x for x in d2),
   "a renumbering the alias set cannot see (two unique ids trade OBJECTIDs) is still caught by layer_fingerprint", d2)
newreuse = copy.deepcopy(SCAN) + [{"attrs": {"OBJECTID": 9001, "PermitID": "Z-3", "PermitType": "HOUSE", "PermitStat": "Approved", "PropertySi": "ELSEWHERE", "DateReceiv": 1}, "x": -90.0, "y": 30.0}]
d3 = ia.diff_alias_files(F, build(newreuse))
ok(any("alias set differs" in x and "1 new" in x for x in d3) and any("layer_fingerprint" in x for x in d3), "a NEW reuse at the publisher turns the check red", d3)
try:
    build(SCAN + [copy.deepcopy(SCAN[0])])
    ok(False, "a scan that repeats an OBJECTID is refused")
except ValueError:
    ok(True, "a scan that repeats an OBJECTID is refused (not one row per feature)")

# ── 4. validation and the Python twin of applyIdentityAlias ────────────────────────────────────────────────────────────────────
ok(ia.validate_alias_file(F) == [], "a generated file validates")
bad = copy.deepcopy(F)
bad["aliases"]["4001"] = "20062248#101"
ok(any("alias_fingerprint" in p for p in ia.validate_alias_file(bad)), "a hand-edited alias fails the fingerprint check")
bad = copy.deepcopy(F)
del bad["aliases"]["12"]
ok(ia.validate_alias_file(bad) != [], "a deleted alias fails validation")
bad = copy.deepcopy(F)
bad["aliases"]["5"] = "x#9"
bad["scan"]["alias_fingerprint"] = ia.fingerprint(bad["aliases"].items())
bad["scan"]["aliased_features"] = len(bad["aliases"])
ok(any("LATER representative" in p for p in ia.validate_alias_file(bad)), "an alias pointing at a later OBJECTID is refused")

for c in PARITY["cases"]:
    ok(ia.source_identity(c["base"], c["row"].get("OBJECTID"), PARITY["file"]) == c["expected"], "PY: " + c["name"],
       ia.source_identity(c["base"], c["row"].get("OBJECTID"), PARITY["file"]))
ok(PARITY["file"]["aliases"] == A and PARITY["file"]["scan"]["layer_fingerprint"] == F["scan"]["layer_fingerprint"],
   "the parity table's embedded file equals the file built from the scan fixture (the table cannot drift from the generator)")

# ── 5. the shard fetch (scripts/n5_shard.py::fetch_features) against a fake layer ──────────────────────────────────────────────
BYID = {}
for f in SCAN:
    if f["attrs"].get(IDF) and str(f["attrs"][IDF]).strip():
        BYID.setdefault(str(f["attrs"][IDF]).strip(), []).append(f)


class Layer:
    def __init__(self):
        self.asked = []
        self.calls = 0

    def __call__(self, url, params=None, method="GET", timeout=None):
        self.calls += 1
        if "where" not in params:
            return {"geometryType": "esriGeometryPoint", "maxRecordCount": 2000,
                    "fields": [{"name": IDF, "type": "esriFieldTypeString"}, {"name": OIDF, "type": "esriFieldTypeOID"}]}, None
        vals = [v.strip("'") for v in params["where"].split("IN (")[1].rstrip(")").split(",")]
        self.asked.append((vals, params["outFields"]))
        feats = []
        for v in vals:
            for f in BYID.get(v, []):
                attrs = {IDF: f["attrs"][IDF]}
                if OIDF in params["outFields"]:
                    attrs[OIDF] = f["attrs"][OIDF]
                feats.append({"attributes": attrs, "geometry": {"x": f["x"] if f["x"] is not None else 0.0, "y": f["y"] if f["y"] is not None else 0.0}})
        return {"features": feats}, None


_ROW = re.compile(r"^\('([^']*)','[^']*','([^']*)'")


def run(entry, keys, alias_files=None):
    tmp = tempfile.mkdtemp()
    try:
        for name, obj in (alias_files or {}).items():
            json.dump(obj, open(os.path.join(tmp, name), "w"))
        M.ALIAS_DIR = tmp
        lay = Layer()
        M.http = lay
        written = []
        M.insert_batched = lambda pre, rows, suf, tag, start=25, on_oversize=None: written.extend(rows)
        M.say = lambda k, v: None
        st = M.fetch_features(RID, entry, keys, "762")
        return st, lay, [_ROW.match(r).groups() for r in written]
    finally:
        shutil.rmtree(tmp)


def K(i):
    return f"arcgis:{RID}:{i}"


ENTRY = {"registry_id": RID, "service_url": "https://example.test/FeatureServer/0", "column_map": {"case_number": IDF}}
OPTED = dict(ENTRY, identity_aliases_file="a.json")
FILES = {"a.json": F}

st, lay, rows = run(OPTED, [K("20062248"), K("20062248#4001")], FILES)
got = {}
for sk, fid in rows:
    got.setdefault(sk, []).append(fid)
ok(st["status"] == "OK" and set(got) == {K("20062248"), K("20062248#4001")} and len(got[K("20062248")]) == 1 and len(got[K("20062248#4001")]) == 1,
   "opted in: the legacy key gets ONLY the lowest-OBJECTID feature, the alias key ONLY its own", (st, got))
ok(len(lay.asked) == 1 and lay.asked[0][0] == ["20062248"] and OIDF in lay.asked[0][1],
   "the publisher is asked for the BARE id once, with OBJECTID in outFields (never for '20062248#4001')", lay.asked)
ok(st["unasked_echoes"] == 0, "nothing echoed that was not asked for", st)

st, lay, rows = run(OPTED, [K("20062248")], FILES)
ok(len(rows) == 1 and st["unasked_echoes"] == 1, "asking only the legacy key: the other permit is NOT stored under it (it is reported as unasked)", (len(rows), st))

st, lay, rows = run(OPTED, [K("20110001"), K("19990004"), K("19990004#41"), K("19990001"), K("19990001#12")], FILES)
got = {}
for sk, fid in rows:
    got.setdefault(sk, []).append(fid)
ok(len(got.get(K("20110001"), [])) == 2, "a true duplicate pair stays under one key with both features (multiplicity preserved)", got)
ok(len(got.get(K("19990004"), [])) == 1 and len(got.get(K("19990004#41"), [])) == 2, "duplicates folded onto an alias travel with that alias; the legacy key keeps only its own feature", got)
ok(len(got.get(K("19990001"), [])) == 2 and len(got.get(K("19990001#12"), [])) == 1, "a duplicate of the legacy record stays on the legacy key; the different record at the same place is separate", got)

st0, lay0, rows0 = run(ENTRY, [K("20062248")], FILES)
ok(len(rows0) == 2 and {r[0] for r in rows0} == {K("20062248")} and st0["unasked_echoes"] == 0 and OIDF not in lay0.asked[0][1],
   "WITHOUT the opt-in: both features under the legacy key and outFields unchanged - today's behaviour, byte for byte", (rows0, lay0.asked))

st, lay, rows = run(OPTED, [K("20062248")], {})
ok(st["status"] == "EXCLUDED" and "unreadable" in st["reason"] and lay.calls == 0, "opted in but the file is missing: EXCLUDED, no request made (never fetched under legacy keys)", st)
st, lay, rows = run(OPTED, [K("20062248")], {"a.json": dict(F, registry_id="other")})
ok(st["status"] == "EXCLUDED" and lay.calls == 0, "a file for another registry is EXCLUDED", st)
tampered = copy.deepcopy(F)
tampered["aliases"]["4001"] = "20062248#101"
st, lay, rows = run(OPTED, [K("20062248")], {"a.json": tampered})
ok(st["status"] == "EXCLUDED" and "unsound" in st["reason"], "a hand-edited file is EXCLUDED", st)
st, lay, rows = run(dict(OPTED, identity_fields=["PermitID", "OBJECTID"]), [K("20062248")], FILES)
ok(st["status"] == "EXCLUDED", "identity_fields + identity_aliases_file is EXCLUDED", st)

# the shard's rule IS the shared rule: routing is source_identity, not a private copy
src = open(os.path.join(HERE, "n5_shard.py"), encoding="utf-8").read()
ok("ia.source_identity(" in src and "ia.reverse_index(" in src and "def load_entry_aliases" in src,
   "n5_shard routes through identity_aliases.source_identity / reverse_index (no private copy of the rule)")


# ── 6. the CI checker ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def mini(opted=True, index_lists=True, file_obj=None, extra_file=False, shard_ok=True, ident_fields=False, engine_ok=True):
    r = tempfile.mkdtemp()
    d = os.path.join(r, "supabase/functions/get-address-report")
    os.makedirs(os.path.join(d, "identity-aliases"))
    os.makedirs(os.path.join(r, "scripts"))
    e = {"registry_id": RID, "platform": "arcgis", "column_map": {"case_number": IDF}}
    if opted:
        e["identity_aliases_file"] = "denton-county-dev-permits.json"
    if ident_fields:
        e["identity_fields"] = ["a", "b"]
    json.dump({"arcgis": [e], "socrata": []}, open(os.path.join(d, "jurisdiction-registry.json"), "w"))
    if file_obj is not False:
        json.dump(file_obj or F, open(os.path.join(d, "identity-aliases/denton-county-dev-permits.json"), "w"))
    if extra_file:
        json.dump(F, open(os.path.join(d, "identity-aliases/orphan.json"), "w"))
    idx = 'import a from "./denton-county-dev-permits.json" with { type: "json" };\nexport const X = {\n  "denton-county-dev-permits.json": a,\n};\n' if index_lists else "export const X = {};\n"
    open(os.path.join(d, "identity-aliases/index.ts"), "w").write(idx)
    open(os.path.join(r, "scripts/n5_shard.py"), "w").write("identity_aliases identity_aliases_file" if shard_ok else "nothing")
    imp = 'import { IDENTITY_ALIAS_FILES } from "./identity-aliases/index.ts";\n'
    body = {True: imp + "const x = { identityAliases: IDENTITY_ALIAS_FILES };\n", False: "const x = {};\n",
            "import_only": imp + "const x = {};\n", "pass_only": "const x = { identityAliases: IDENTITY_ALIAS_FILES };\n"}[engine_ok]
    open(os.path.join(d, "index.ts"), "w").write(body)
    return r


def chk_errs(**kw):
    r = mini(**kw)
    try:
        import io
        import contextlib
        with contextlib.redirect_stdout(io.StringIO()):
            return chk.check(r)
    finally:
        shutil.rmtree(r)


ok(chk_errs() == [], "checker: a consistent registry + file + loader passes", chk_errs())
ok(chk_errs(opted=False, file_obj=False, index_lists=False) == [], "checker: no opt-in and no files passes (today's committed state)")
ok(any("does not exist" in e for e in chk_errs(file_obj=False)), "checker: registry names a missing file -> FAIL")
ok(any("does not import AND list" in e for e in chk_errs(index_lists=False)), "checker: file not loaded by index.ts -> FAIL (the engine would silently use legacy keys)")
ok(any("no registry entry names it" in e for e in chk_errs(opted=False)), "checker: orphan alias file -> FAIL")
ok(any("orphan.json" in e for e in chk_errs(extra_file=True)), "checker: a second unreferenced file -> FAIL")
t = copy.deepcopy(F)
t["aliases"]["4001"] = "20062248#101"
ok(any("alias_fingerprint" in e for e in chk_errs(file_obj=t)), "checker: hand-edited file -> FAIL")
ok(any("registry_id" in e for e in chk_errs(file_obj=dict(F, registry_id="x"))), "checker: file for another registry -> FAIL")
ok(any("id_field" in e for e in chk_errs(file_obj=dict(F, id_field="Other"))), "checker: file for another column -> FAIL")
ok(any("mutually exclusive" in e for e in chk_errs(ident_fields=True)), "checker: identity_fields + alias file -> FAIL")
ok(any("n5_shard" in e for e in chk_errs(shard_ok=False)), "checker: n5_shard not routed through the shared rule -> FAIL")
for variant in (False, "import_only", "pass_only"):
    ok(any("engine index.ts" in e for e in chk_errs(engine_ok=variant)), f"checker: engine wiring {variant!r} (not both imported AND handed to arcgisForZip) -> FAIL")
# ── missing geometry must be null, never NaN (the first Denton file carried NaN: not JSON, broke the edge module) ────────────────
import gen_identity_aliases as gen  # noqa: E402

NAN = float("nan")
nan_scan = [
    {"attrs": {IDF: "2010", OIDF: 1}, "x": NAN, "y": NAN},                 # the shape ArcGIS gives an empty point
    {"attrs": {IDF: "2010", OIDF: 2}, "x": "NaN", "y": "NaN"},             # ... or the string
    {"attrs": {IDF: "2010", OIDF: 3}, "x": float("inf"), "y": 1.0},
    {"attrs": {IDF: "2010", OIDF: 4}, "x": -97.1, "y": None},              # half a point
    {"attrs": {IDF: "9", OIDF: 5}, "x": -97.1, "y": 33.2},
    {"attrs": {IDF: "9", OIDF: 6}, "x": -97.1, "y": 33.2},                 # same attrs, same place: a true duplicate
]
nf = build(nan_scan)
txt = gen.dump(nf)                                                          # allow_nan=False: raises if any NaN survived
strict = json.loads(txt, parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
ev = {r["oid"]: r for r in strict["evidence"]}
ok(all(ev[o]["x"] is None and ev[o]["y"] is None for o in ("1", "2", "3", "4")), "missing / non-finite / half geometry is written as null/null", ev)
ok(ia.finite_coord(NAN) is None and ia.finite_coord("NaN") is None and ia.finite_coord(float("-inf")) is None and ia.finite_coord(True) is None
   and ia.finite_coord("-97.5") == -97.5 and ia.finite_coord(0) == 0.0, "finite_coord: NaN/inf/bool -> None, numbers and numeric strings kept")
ok(set(nf["aliases"]) == {"2", "3", "4"} and "6" not in nf["aliases"],
   "NaN geometry is never 'identical': three distinct records alias, the real duplicate (5,6) still folds", nf["aliases"])
ok(ia.true_duplicate({"attrs": {IDF: "a", OIDF: 1}, "x": NAN, "y": NAN}, {"attrs": {IDF: "a", OIDF: 2}, "x": NAN, "y": NAN}, OIDF) is False,
   "two NaN points are not a true duplicate")
try:
    json.dumps({"x": NAN}, allow_nan=False)
    raised = False
except ValueError:
    raised = True
ok(raised, "control: strict dumping a NaN raises (what gen.dump now relies on)")
try:
    gen.dump({"evidence": [{"x": NAN}]})
    dump_raises = False
except ValueError:
    dump_raises = True
ok(dump_raises, "gen.dump REFUSES a NaN instead of writing it")
ok(not [p for p in ia.validate_alias_file(strict)], "the null-geometry file validates", ia.validate_alias_file(strict))
bad = copy.deepcopy(strict)
bad["evidence"][0]["x"] = NAN
ok(any("non-finite" in p for p in ia.validate_alias_file(bad)), "validate_alias_file rejects a NaN evidence coordinate")
bad2 = copy.deepcopy(strict)
bad2["evidence"][0]["y"] = None
bad2["evidence"][0]["x"] = 1.5
ok(any("half-missing" in p for p in ia.validate_alias_file(bad2)), "validate_alias_file rejects a half-missing coordinate")
_tmp = tempfile.mkdtemp()
try:
    _p = os.path.join(_tmp, "x.json")
    open(_p, "w").write(json.dumps(strict).replace('"x": null', '"x": NaN', 1) if '"x": null' in json.dumps(strict) else "{\"x\": NaN}")
    try:
        ia.load_alias_file(_p)
        loads = True
    except ValueError:
        loads = False
    ok(not loads, "load_alias_file is a STRICT parser: a file containing NaN is refused")
finally:
    shutil.rmtree(_tmp)
# every committed alias file parses as strict JSON (what the edge bundler requires)
_adir = os.path.join(ROOT, "supabase/functions/get-address-report/identity-aliases")
_files = sorted(f for f in os.listdir(_adir) if f.endswith(".json"))
def _strict(path):
    try:
        json.loads(open(path, encoding="utf-8").read(), parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
        return True
    except ValueError:
        return False


_bad = [f for f in _files if not _strict(os.path.join(_adir, f))]
ok(not _bad, f"every committed alias file ({len(_files)}) is strict JSON (no NaN/Infinity)", _bad)

real = chk.check(ROOT)
ok(real == [], "checker: THE REAL TREE passes", real)

sys.exit(1 if fails else 0)
