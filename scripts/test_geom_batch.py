"""Offline proof that insert_batched SPLITS on HTTP 413 and never loses a row.

No network, no DB: n3_pilot.sql is replaced with a fake server that refuses any statement
over a secret size. The point is that the client does NOT know that size - the first fix
for shard 891 guessed a 4 MB budget and got 413 again - so the test asserts the client
adapts to whatever the server enforces.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SUPABASE_ACCESS_TOKEN", "test-token-not-a-secret")

import n3_pilot as N

fails = 0
def ok(c, name):
    global fails
    print(("PASS" if c else "FAIL") + " - " + name)
    if not c: fails += 1

SENT = []
LIMIT = 50_000          # the server's secret limit; the client never sees this number

def fake_sql(query, tag="", raise_413=False):
    if len(query) > LIMIT:
        if raise_413:
            raise N.SQLPayloadTooLarge(f"{tag}: {len(query)} chars refused as 413")
        raise SystemExit("413")
    SENT.append(query)
    return []

N.sql = fake_sql
import n5_shard as S
S.sql = fake_sql
S.say = lambda k, v: None

PFX, SFX = "insert into t values ", " on conflict do nothing;"

def run(rows):
    SENT.clear()
    S.insert_batched(PFX, rows, SFX, "test")
    # every statement the fake server accepted must be within its limit
    return SENT

# 1. Rows small enough that the 25-row cap governs; no splitting needed.
rows = ["(%d,'%s')" % (i, "x" * 100) for i in range(100)]
sent = run(rows)
ok(all(len(q) <= LIMIT for q in sent), "small rows: every statement accepted within limit")
ok(sum(q.count("),(") + 1 for q in sent) == 100, "small rows: all 100 rows sent")
ok(len(sent) == 4, "small rows: 4 statements of 25 (got %d)" % len(sent))

# 2. Dense rows - the shard-891 shape. 25 would blow the limit, so it must SPLIT.
rows = ["(%d,'%s')" % (i, "p" * 8_000) for i in range(25)]
sent = run(rows)
ok(all(len(q) <= LIMIT for q in sent), "dense rows: client adapted to the server's limit")
ok(sum(q.count("),(") + 1 for q in sent) == 25, "dense rows: all 25 rows sent, none dropped")
ok(len(sent) > 1, "dense rows: it actually split (got %d statements)" % len(sent))

# 3. ORDER is preserved across the split - a reordering would corrupt first_z3 provenance.
rows = ["(%d,'%s')" % (i, "q" * 6_000) for i in range(30)]
sent = run(rows)
seq = []
for q in sent:
    body = q[len(PFX):-len(SFX)]
    seq += [int(p.split(",")[0].lstrip("(")) for p in body.split("),(")]
ok(seq == list(range(30)), "split preserves row order exactly")

# 4. A single row the server will never accept is a HARD ERROR, never skipped.
try:
    S.insert_batched(PFX, ["(1,'%s')" % ("z" * (LIMIT * 2))], SFX, "test")
    ok(False, "an unsplittable oversize row raises")
except SystemExit as e:
    ok("SINGLE row" in str(e), "an unsplittable oversize row raises and says so")

# 5. Non-413 failures still fail closed (raise_413 only softens 413).
def fake_500(query, tag="", raise_413=False):
    raise SystemExit("STOP: SQL %s failed HTTP 500" % tag)
S.sql = fake_500
try:
    S.insert_batched(PFX, ["(1,'a')"], SFX, "test")
    ok(False, "a non-413 error still stops the run")
except SystemExit as e:
    ok("500" in str(e), "a non-413 error still stops the run")

sys.exit(1 if fails else 0)
