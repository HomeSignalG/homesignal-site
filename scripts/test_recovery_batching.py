"""Offline proof that the recovery fetch batches from the PUBLISHER and loses nothing.

No network: n5_shard.http is replaced by a fake ArcGIS layer that declares its own
maxRecordCount and can be told to truncate or to fail. The properties asserted are the
ones a silent regression would break:

  - the batch size is derived from maxRecordCount, not from a constant
  - EVERY asked-for identity comes back, exactly once, whatever the batching
  - exceededTransferLimit halves and RE-FETCHES the same range - never skips it
  - a transport error halves too, so one bad identity costs one identity, not 250
  - a publisher that fails identity after identity is declared unreachable, not ground
  - a SINGLE identity that still truncates is a hard stop, because it cannot be
    represented without losing features
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SUPABASE_ACCESS_TOKEN", "test-token-not-a-secret")

import n5_shard as M

fails = 0
def ok(c, name):
    global fails
    print(("PASS" if c else "FAIL") + " - " + name)
    if not c: fails += 1

ENTRY = {"service_url": "https://example.test/FeatureServer/0",
         "identity_fields": ["PERMITNUM"]}
def keys(n):
    return ["arcgis:little-rock-permits:P%05d" % i for i in range(n)]

class Layer:
    """A fake ArcGIS layer. `cap` is the real per-response feature ceiling."""
    def __init__(self, maxrec, cap=None, fail_idents=(), fail_all=False, per_ident_feats=1):
        self.maxrec, self.cap = maxrec, (cap if cap is not None else maxrec)
        self.fail_idents, self.fail_all = set(fail_idents), fail_all
        self.per = per_ident_feats
        self.sizes, self.served = [], []
    def __call__(self, url, params=None, method="GET", timeout=None):
        if params.get("f") == "json" and "where" not in params:
            return {"geometryType": "esriGeometryPoint", "maxRecordCount": self.maxrec,
                    "fields": [{"name": "PERMITNUM", "type": "esriFieldTypeString"}]}, None
        idents = [v.strip("'") for v in params["where"].split("IN (")[1].rstrip(")").split(",")]
        self.sizes.append(len(idents))
        if self.fail_all or (self.fail_idents & set(idents)):
            return None, "HTTP_500"
        feats = []
        for c in idents:
            for k in range(self.per):
                feats.append({"attributes": {"PERMITNUM": c}, "geometry": {"x": 1.0, "y": 2.0}})
        out = {"features": feats[:self.cap]}
        if len(feats) > self.cap:
            out["exceededTransferLimit"] = True
        else:
            self.served.extend(idents)
        return out, None

def run(layer, n):
    M.http = layer
    written = []
    M.insert_batched = lambda pre, rows, suf, tag, start=25, on_oversize=None: written.extend(rows)
    M.say = lambda k, v: None
    return M.fetch_features("little-rock-permits", ENTRY, keys(n), "722"), written

# 1. batch size comes from maxRecordCount (2000//4 = 500 -> capped at BATCH_IDENT_MAX)
L = Layer(maxrec=2000); st, w = run(L, 1000)
ok(max(L.sizes[0:1]) == M.BATCH_IDENT_MAX,
   "first batch is BATCH_IDENT_MAX=%d for maxRecordCount 2000 (got %d)" % (M.BATCH_IDENT_MAX, L.sizes[0]))
ok(len(w) == 1000, "all 1000 identities written (got %d)" % len(w))
ok(len(set(w)) == 1000, "no identity written twice (got %d distinct)" % len(set(w)))

# 2. a SMALL declared cap yields a small batch - the publisher, not the constant, decides
L = Layer(maxrec=100); st, w = run(L, 300)
ok(L.sizes[0] == 25, "maxRecordCount 100 -> batch 25 (got %d)" % L.sizes[0])
ok(len(w) == 300, "all 300 written at the smaller batch (got %d)" % len(w))

# 3. a publisher that LIES about its cap: declares 2000, truncates at 60. The guard must
#    halve and RE-FETCH, never advance past the truncated range.
L = Layer(maxrec=2000, cap=60); st, w = run(L, 500)
ok(len(w) == 500, "truncating publisher still yields every identity (got %d)" % len(w))
ok(len(set(w)) == 500, "and none twice (got %d)" % len(set(w)))
ok(min(L.sizes) <= 60, "batch was halved below the real cap (min %d)" % min(L.sizes))

# 4. one bad identity costs ONE identity, not the whole batch
L = Layer(maxrec=2000, fail_idents=["P00137"]); st, w = run(L, 400)
ok(len(w) == 399, "399 of 400 recovered around a single failing identity (got %d)" % len(w))
ok(st["batch_errors"] == 1, "exactly one error counted (got %s)" % st["batch_errors"])
ok(all("P00137" not in r for r in w), "the failing identity is absent, not fabricated")

# 5. a DOWN publisher is declared unreachable rather than ground through 47k singles
L = Layer(maxrec=2000, fail_all=True); st, w = run(L, 5000)
ok(st["status"] == "PUBLISHER_UNREACHABLE",
   "a wholly failing publisher returns PUBLISHER_UNREACHABLE (got %s)" % st["status"])
ok(len(L.sizes) < 200, "it gave up quickly instead of 5000 single requests (got %d)" % len(L.sizes))
ok(len(w) == 0, "and wrote nothing")

# 6. a SINGLE identity that still truncates is a hard stop - it cannot be represented
L = Layer(maxrec=2000, cap=1, per_ident_feats=5)
try:
    run(L, 8); ok(False, "single-identity truncation raised")
except SystemExit as e:
    ok("SINGLE identity" in str(e), "single-identity truncation is a hard stop (%s)" % str(e)[:60])

# 7. multiplicity is preserved: 3 features per identity all survive
L = Layer(maxrec=2000, per_ident_feats=3); st, w = run(L, 100)
ok(len(w) == 300, "3 features x 100 identities = 300 rows (got %d)" % len(w))
ok(st["features"] == 300, "features count reports 300 (got %s)" % st["features"])

sys.exit(1 if fails else 0)
