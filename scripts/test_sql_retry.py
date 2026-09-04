"""Offline proof that sql()'s retry is load-bearing AND still fails closed.

No network: urllib.request.urlopen is replaced. Asserts the three behaviours that
matter - 429 retries and then succeeds, a non-429 stops IMMEDIATELY without any
retry (so a real SQL error is never masked), and an unending 429 is bounded.
"""
import os, sys, types, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SUPABASE_ACCESS_TOKEN", "test-token-not-a-secret")

import n3_pilot as N

fails = 0
def ok(c, name):
    global fails
    print(("PASS" if c else "FAIL") + " - " + name)
    if not c: fails += 1

class Resp:
    def __init__(self, body): self.body = body.encode()
    def read(self): return self.body
    def __enter__(self): return self
    def __exit__(self, *a): return False

def err(code, retry_after=None):
    h = {}
    if retry_after is not None: h["Retry-After"] = retry_after
    return urllib.error.HTTPError("u", code, "boom", h, __import__("io").BytesIO(b'{"message":"ThrottlerException"}'))

N.time.sleep = lambda s: slept.append(s)

# 1. three 429s then success
slept, calls = [], []
seq = [err(429), err(429), err(429), Resp('[{"n":1}]')]
def fake(req, timeout=None):
    calls.append(1)
    x = seq.pop(0)
    if isinstance(x, urllib.error.HTTPError): raise x
    return x
urllib.request.urlopen = fake
out = N.sql("select 1", "t1")
ok(out == [{"n": 1}], "429 x3 then success returns the real result")
ok(len(calls) == 4, "made exactly 4 attempts (got %d)" % len(calls))
ok(slept == [2, 5, 15], "backoff was 2/5/15s (got %r)" % slept)

# 2. Retry-After header is honoured over the table
slept, seq, calls = [], [err(429, "7"), Resp("[]")], []
out = N.sql("select 1", "t2")
ok(slept == [7.0], "Retry-After header honoured (got %r)" % slept)

# 3. a non-429 must NOT retry - fail closed, immediately
slept, seq, calls = [], [err(400), Resp("[]")], []
try:
    N.sql("select bad", "t3"); ok(False, "HTTP 400 raised")
except SystemExit as e:
    ok("400" in str(e), "HTTP 400 raises SystemExit naming the code")
ok(len(calls) == 1, "HTTP 400 made exactly 1 attempt, no retry (got %d)" % len(calls))
ok(slept == [], "HTTP 400 never slept")

# 4. 500 must NOT retry - a lost response on a write must not double-apply
slept, seq, calls = [], [err(500), Resp("[]")], []
try:
    N.sql("insert x", "t4"); ok(False, "HTTP 500 raised")
except SystemExit:
    ok(True, "HTTP 500 raises SystemExit")
ok(len(calls) == 1, "HTTP 500 made exactly 1 attempt, no retry (got %d)" % len(calls))

# 5. unending 429 is bounded, not infinite
slept, calls = [], []
seq = [err(429)] * 50
try:
    N.sql("select 1", "t5"); ok(False, "unending 429 raised")
except SystemExit as e:
    ok("429" in str(e), "unending 429 stops with the code named")
ok(len(calls) == N.SQL_MAX_ATTEMPTS, "bounded at SQL_MAX_ATTEMPTS=%d (got %d)" % (N.SQL_MAX_ATTEMPTS, len(calls)))


# ---------------------------------------------------------------- read_only 5xx
# A transport timeout in FRONT of the origin (CF 524) is retryable for a statement
# whose re-execution changes nothing, and MUST stay fatal otherwise. Both directions
# are asserted, because only one of them is the safety property.

# 6. read_only=True retries a 524 and returns the real result
slept, calls = [], []
seq = [err(524), err(524), Resp('[{"n":7}]')]
out = N.sql("select count(*) n from geo.n5_association", "t6", read_only=True)
ok(out == [{"n": 7}], "524 x2 then success under read_only")
ok(len(calls) == 3, "read_only 524 made 3 attempts (got %d)" % len(calls))

# 7. the SAME 524 without read_only must NOT retry - a write's status is unprovable
slept, seq, calls = [], [err(524), Resp("[]")], []
try:
    N.sql("insert into geo.n5_association select 1", "t7"); ok(False, "524 write raised")
except SystemExit as e:
    ok("524" in str(e), "524 on a write raises SystemExit naming the code")
ok(len(calls) == 1, "524 on a write made exactly 1 attempt (got %d)" % len(calls))

# 8. read_only is CHECKED, not trusted: a write word refuses before any request
slept, seq, calls = [], [Resp("[]")], []
try:
    N.sql("insert into geo.n5_association select 1", "t8", read_only=True)
    ok(False, "read_only on a write raised")
except SystemExit as e:
    ok("read_only" in str(e) and "insert" in str(e),
       "read_only=True on a write refuses and names the word")
ok(len(calls) == 0, "the refusal happened BEFORE any request (got %d)" % len(calls))

# 9. a real SQL error still fails closed even under read_only
slept, seq, calls = [], [err(400), Resp("[]")], []
try:
    N.sql("select bad", "t9", read_only=True); ok(False, "400 under read_only raised")
except SystemExit:
    ok(True, "HTTP 400 still fatal under read_only")
ok(len(calls) == 1, "400 under read_only made exactly 1 attempt (got %d)" % len(calls))

# 10. the shipped shard_counts SQL passes the guard - the check must not block the
#     very statement it was added for.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import n5_shard as S
_q = S.HEAVY_TIMEOUT_SQL + S.build_associations("934") + "\nselect (select count(*) from legacy) n;"
try:
    N.assert_read_only(_q, "counts"); ok(True, "shipped shard_counts SQL passes the read_only guard")
except SystemExit as e:
    ok(False, "shipped shard_counts SQL was refused: %s" % e)

sys.exit(1 if fails else 0)
