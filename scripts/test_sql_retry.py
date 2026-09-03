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

sys.exit(1 if fails else 0)
