"""The provisioned disk size comes from Supabase, with the DISK_TOTAL_MB setting only as a fallback.

The disk autoscales, so a hand-typed size goes stale on the first resize and then understates
free space until auto-open stops starting builds (founder, 2026-10-01: "i can not be doing this
for years"). Pins:
  1. a readable disk config is used (size_gb is GiB; minus the 512 MiB system margin);
  2. an API failure, a missing field or a zero size falls back to DISK_TOTAL_MB;
  3. the size is read once per process, not once per shard;
  4. disk_free_mb subtracts from the read size, never from the setting directly.
Run: python3 scripts/test_disk_size.py
"""
import importlib
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SUPABASE_ACCESS_TOKEN", "test")
os.environ["DISK_TOTAL_MB"] = "36352"

import n5_shard  # noqa: E402

FAILS = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def world(answer):
    """answer: a dict to return as JSON, or an Exception to raise."""
    S = importlib.reload(n5_shard)
    S.print = lambda *a, **k: None
    calls = {"n": 0, "url": None}

    def urlopen(req, timeout=None):
        calls["n"] += 1
        calls["url"] = req.full_url
        if isinstance(answer, Exception):
            raise answer
        return Resp(json.dumps(answer).encode())

    S.urllib.request.urlopen = urlopen
    return S, calls


S, c = world({"attributes": {"size_gb": 40, "iops": 3000, "type": "gp3"}})
check("a readable disk config is used: 40 GB -> 40*1024 - 512 MiB", S.provisioned_disk_mb() == 40 * 1024 - 512)
check("it asks the project's own disk config", c["url"].endswith("/v1/projects/qwnnmljucajnexpxdgxr/config/disk"))
S.provisioned_disk_mb()
S.provisioned_disk_mb()
check("read once per process, not once per call", c["n"] == 1)

S, c = world({"attributes": {"size_gb": 36}})
check("today's 36 GB reproduces the hand-set 36,352 exactly", S.provisioned_disk_mb() == 36352)

for name, ans in [("an HTTP failure", OSError("HTTP 500")), ("a missing field", {"attributes": {}}),
                  ("no attributes at all", {}), ("a zero size", {"attributes": {"size_gb": 0}})]:
    S, c = world(ans)
    check(f"{name} falls back to DISK_TOTAL_MB", S.provisioned_disk_mb() == 36352)

S, c = world({"attributes": {"size_gb": 54}})
S.sql = lambda q, tag="", **k: [{"db": 20000.0, "wal": 1000.0}]
free, db, wal = S.disk_free_mb()
check("free space subtracts from the READ size (54 GB disk, 21,000 MB used)",
      free == 54 * 1024 - 512 - 21000 and (db, wal) == (20000.0, 1000.0))
check("the 2,048 MB floor is unchanged", S.DISK_FLOOR_MB == 2048)

print(f"\n{len(FAILS)} failure(s)")
sys.exit(1 if FAILS else 0)
