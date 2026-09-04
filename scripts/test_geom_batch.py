"""Offline proof that the n5_geom insert batches by BYTES as well as row count.

No network, no DB: the batching loop is reproduced from n5_shard.py and driven over
synthetic rows. It asserts the three properties that matter, because the failure this
guards against (HTTP 413 on shard 891) was a statement that looked fine by row count.
"""
import sys

MAX_BYTES = 4_000_000
MAX_ROWS = 25


def batches(rows):
    """The shipped loop, returning the statements it would send."""
    out, batch, nbytes = [], [], 0
    for r in rows:
        rb = len(r.encode("utf-8"))
        if batch and (nbytes + rb > MAX_BYTES or len(batch) >= MAX_ROWS):
            out.append(list(batch)); batch.clear(); nbytes = 0
        batch.append(r); nbytes += rb
    if batch:
        out.append(list(batch))
    return out


fails = 0
def ok(c, name):
    global fails
    print(("PASS" if c else "FAIL") + " - " + name)
    if not c: fails += 1


# 1. Many tiny rows: the ROW cap governs, exactly as before this change.
tiny = ["x" * 40 for _ in range(100)]
b = batches(tiny)
ok(all(len(x) <= MAX_ROWS for x in b), "tiny rows never exceed the row cap")
ok(sum(len(x) for x in b) == 100, "tiny rows: nothing dropped (100)")
ok(len(b) == 4, "100 tiny rows -> 4 statements of 25 (got %d)" % len(b))

# 2. Dense polygons: the BYTE cap governs and fires BEFORE 25 rows.
#    This is the shard-891 shape - each row big enough that 25 would blow the limit.
big = ["p" * 500_000 for _ in range(25)]
b = batches(big)
ok(all(sum(len(r.encode()) for r in x) <= MAX_BYTES for x in b),
   "dense rows: every statement is within the byte budget")
ok(max(len(x) for x in b) < MAX_ROWS, "dense rows: byte cap fired before the row cap")
ok(sum(len(x) for x in b) == 25, "dense rows: nothing dropped (25)")

# 3. A single row larger than the whole budget is SENT ALONE, never dropped.
huge = ["z" * (MAX_BYTES + 10)]
b = batches(huge)
ok(len(b) == 1 and len(b[0]) == 1, "an over-budget row is sent alone, not dropped")

# 4. Mixed traffic: order preserved exactly, nothing lost.
mixed = ["a" * 10, "b" * 3_000_000, "c" * 10, "d" * 3_000_000, "e" * 10]
b = batches(mixed)
flat = [r for x in b for r in x]
ok(flat == mixed, "mixed rows: order preserved and nothing lost")
ok(all(sum(len(r.encode()) for r in x) <= MAX_BYTES or len(x) == 1 for x in b),
   "mixed rows: every statement within budget unless it is a single over-budget row")

sys.exit(1 if fails else 0)
