#!/usr/bin/env python3
"""IndexNow publication for HomeSignal — deploy first, notify second.

This module is the transport and the safety net. It decides NOTHING about which pages changed:
the notification set is `delta["submit"]`, produced by scripts/page_semantics.py from the SAME
rendering that wrote the documents. Here we only (a) publish the verification key file, (b) prove
the new bytes are live, and (c) POST the already-computed set to the IndexNow bulk endpoint.

Policy, all enforced in code and pinned by test/indexnow-*.test.mjs:
  * the key comes from the INDEXNOW_KEY secret, is validated against the protocol (8-128 chars of
    letters, digits, hyphen), and is never printed, logged, or written anywhere but indexnow.txt;
  * nothing is submitted until the live site serves the candidate state, the key file, and the
    exact bytes of a sample of the changed pages (a crawler that arrives early sees stale HTML);
  * only canonical https://homesignal.net page URLs are ever sent: no query strings, no
    homesignalmap.html?zip=, no community.html?zip=, no other host;
  * at most 10,000 URLs per POST;
  * 200/202 accepted; 400/403/422 hard failure; 429 and 5xx/network bounded exponential retry;
  * a failure here never touches the deployment: it runs after `deploy`, in its own job.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import page_semantics as ps

ENDPOINT = "https://api.indexnow.org/indexnow"
HOST = ps.BASE.split("://", 1)[1]   # from the brand contract via page_semantics
KEY_LOCATION = f"https://{HOST}/indexnow.txt"
KEY_FILE = "indexnow.txt"
MAX_URLS_PER_POST = 10_000
KEY_RE = re.compile(r"^[A-Za-z0-9-]{8,128}$")

ACCEPTED = (200, 202)
HARD_FAIL = (400, 403, 422)
RETRY_STATUS = (429,)          # plus every 5xx and every network error
MAX_RETRIES = 4                # attempts = 1 + MAX_RETRIES per batch
BACKOFF_BASE = 2
BACKOFF_CAP = 60
VERIFY_SAMPLE = 6

# A run that would tell a search engine about more than this share of every page we have is not a
# content update, it is a template change or a fingerprint defect. It is held, loudly.
MASS_RATIO = 0.5
MASS_FLOOR = 1000


class IndexNowError(Exception):
    pass


def valid_key(k):
    # fullmatch, not match: Python's `$` also matches before a trailing newline.
    return bool(k) and bool(KEY_RE.fullmatch(k))


def redact(text, key):
    t = str(text)
    return t.replace(key, "***") if key else t


# ---------------------------------------------------------------- URL policy
def canonical_url(path):
    """The only URL shape we ever notify. `path` is a generator-produced canonical path."""
    if ps.family_of(path) is None:
        raise IndexNowError(f"refusing to notify a non-canonical path: {path!r}")
    return f"https://{HOST}{path}"


def check_url(url):
    m = re.fullmatch(r"https://homesignal\.net(/[^?#\s]*)", url)
    if not m or ps.family_of(m.group(1)) is None:
        raise IndexNowError(f"refusing to submit a non-canonical URL: {url!r}")
    return url


def url_list(paths):
    seen, out = set(), []
    for p in paths:
        u = check_url(canonical_url(p))
        if u not in seen:
            seen.add(u)
            out.append(u)
    return sorted(out)


def chunks(urls, size=MAX_URLS_PER_POST):
    if not (1 <= size <= MAX_URLS_PER_POST):
        raise IndexNowError(f"batch size {size} outside 1..{MAX_URLS_PER_POST}")
    return [urls[i:i + size] for i in range(0, len(urls), size)]


# ---------------------------------------------------------------- transport
def default_post(url, body, headers, timeout=30):
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read() if hasattr(e, "read") else b""


def default_get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "HomeSignal-indexnow-verify/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""


def _retry_after(headers, attempt):
    raw = {k.lower(): v for k, v in (headers or {}).items()}.get("retry-after")
    try:
        if raw is not None:
            return min(float(raw), BACKOFF_CAP)
    except ValueError:
        pass
    return min(BACKOFF_BASE ** (attempt + 1), BACKOFF_CAP)


def submit(urls, key, *, post=default_post, sleep=time.sleep, now=None):
    """POST `urls` in batches. Returns a sanitized receipt list; raises IndexNowError on failure.
    The key is placed in the request body only, and redacted from anything that is raised."""
    if not valid_key(key):
        raise IndexNowError("INDEXNOW_KEY is missing or malformed (8-128 of A-Z a-z 0-9 -)")
    now = now or (lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    for u in urls:
        check_url(u)
    receipts = []
    for n, batch in enumerate(chunks(urls), 1):
        body = json.dumps({"host": HOST, "key": key, "keyLocation": KEY_LOCATION,
                           "urlList": batch}).encode("utf-8")
        headers = {"Content-Type": "application/json; charset=utf-8"}
        attempts, status, last = 0, None, ""
        while True:
            attempts += 1
            try:
                status, hdrs, resp = post(ENDPOINT, body, headers)
            except Exception as e:                     # network error: retryable
                status, hdrs, resp = None, {}, redact(e, key).encode()
            last = redact(resp.decode("utf-8", "replace")[:200] if isinstance(resp, bytes) else resp, key)
            if status in ACCEPTED:
                break
            if status in HARD_FAIL or (status is not None and status < 500 and status not in RETRY_STATUS):
                receipts.append({"batch": n, "urls": len(batch), "status": status,
                                 "attempts": attempts, "at": now(), "result": "hard-failure"})
                raise IndexNowError(f"batch {n}: HTTP {status} is not retryable ({last})")
            if attempts > MAX_RETRIES:
                receipts.append({"batch": n, "urls": len(batch), "status": status,
                                 "attempts": attempts, "at": now(), "result": "retries-exhausted"})
                raise IndexNowError(f"batch {n}: still failing after {attempts} attempts "
                                    f"(last status {status})")
            sleep(_retry_after(hdrs, attempts - 1))
        receipts.append({"batch": n, "urls": len(batch), "status": status,
                         "attempts": attempts, "retries": attempts - 1, "at": now(),
                         "result": "accepted" if status == 200 else "accepted-key-validation-pending"})
    return receipts


# ---------------------------------------------------------------- key file + artifact hygiene
def write_key_file(out_dir, key, event_name=""):
    """Returns (written: bool, message). Never raises for a missing or bad key: the deployment
    must not depend on a secret. A malformed key is reported loudly and the file is not written."""
    if event_name == "pull_request":
        return False, "pull_request run: the key file is never written"
    if not key:
        return False, "INDEXNOW_KEY is not configured: indexnow.txt not written, IndexNow will skip"
    if not valid_key(key):
        return False, "INDEXNOW_KEY is set but malformed: indexnow.txt not written"
    with open(os.path.join(out_dir, KEY_FILE), "w", encoding="utf-8", newline="") as f:
        f.write(key)
    return True, "indexnow.txt written"


def check_artifact(out_dir, key):
    """The key may exist in the artifact in exactly one place: indexnow.txt. Returns problems."""
    problems, scanned = [], 0
    kb = key.encode("utf-8") if key else b""
    path = os.path.join(out_dir, KEY_FILE)
    if key and valid_key(key):
        if os.path.exists(path):
            if open(path, "rb").read() != kb:
                problems.append("indexnow.txt does not contain exactly the key")
        # (absent with a key set is allowed: the build skipped it, e.g. a pull_request run)
    elif os.path.exists(path):
        problems.append("indexnow.txt shipped without a valid configured key")
    for root, _, files in os.walk(out_dir):
        for f in files:
            p = os.path.join(root, f)
            scanned += 1
            if kb and os.path.relpath(p, out_dir) != KEY_FILE:
                with open(p, "rb") as fh:
                    if kb in fh.read():
                        problems.append(f"the key appears in {os.path.relpath(p, out_dir)}")
    return problems, scanned


# ---------------------------------------------------------------- prove the new bytes are live
def verify_live(delta, key, *, get=default_get, sleep=time.sleep, clock=time.time, wait=600, every=30,
                strict_state=True):
    """Block until the live site serves: the key file, the candidate state, and the exact bytes of
    a sample of the changed pages (and a 404 for a sample of removed ones). Raises on timeout."""
    deadline = clock() + wait
    last = "not checked"
    while True:
        try:
            last = _verify_once(delta, key, get, strict_state)
            if last is None:
                return
        except Exception as e:                    # a flaky fetch is a reason to wait, not to abort
            last = redact(e, key)
        if clock() >= deadline:
            raise IndexNowError(f"live site does not yet serve this build after {wait}s: {last}")
        sleep(every)


def _verify_once(delta, key, get, strict_state=True):
    cb = f"?cb={int(time.time())}"
    st, body = get(f"https://{HOST}/{KEY_FILE}{cb}")
    if st != 200 or body.decode("utf-8", "replace").strip() != key:
        return f"indexnow.txt not served correctly (HTTP {st})"
    if not strict_state:
        # Re-submission of an older delta (indexnow-resubmit): a newer deploy may legitimately have
        # moved the state on. The key file is still required; the URLs are all live canonical pages
        # or 404s, and telling a search engine about them again is harmless.
        return None
    st, body = get(f"https://{HOST}/sitemaps/page-state.json{cb}")
    if st != 200:
        return f"page-state.json HTTP {st}"
    live = json.loads(body.decode("utf-8"))
    if live.get("state_hash") != delta["candidate_state_hash"]:
        return "page-state.json is not this build's state yet"
    ver = delta.get("verify") or {}
    for path, want in sorted((ver.get("present") or {}).items()):
        st, body = get(f"https://{HOST}{path}")      # exactly what a crawler requests, no cache-bust
        if st != 200 or hashlib.sha256(body).hexdigest()[:32] != want:
            return f"{path} is not serving this build's bytes yet (HTTP {st})"
    for path in sorted(ver.get("absent") or []):
        st, _ = get(f"https://{HOST}{path}")
        if st not in (404, 410):
            return f"{path} still answers HTTP {st}, expected 404/410"
    return None


# ---------------------------------------------------------------- carry-over of unsent notifications
BACKLOG_RUNS = 20          # how far back through completed pages runs to look
BACKLOG_DAYS = 7           # and no further: an old miss is better served by the sitemap lastmod


def default_gh(args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args[:3])} failed: {r.stderr.strip()[:200]}")
    return r.stdout


def unsent_paths(repo, current_run, *, gh=default_gh, now=None):
    """Paths a PREVIOUS run computed and deployed but whose IndexNow job did not succeed.

    WHY. `deploy` always precedes `indexnow`, so a notification failure leaves the pages live and
    the next build's baseline already containing them: they would never differ again and the
    search engines would never be told. Walking back from the newest completed pages run, the
    first run whose `indexnow` job SUCCEEDED covers everything older (each success carried what
    was outstanding at the time), so we stop there. A run whose indexnow job did not run (nothing
    to send, a seed, or a build/deploy that failed, in which case its pages are not live and the
    next delta re-includes them) contributes nothing."""
    now = now or datetime.now(timezone.utc)
    runs = json.loads(gh(["api", f"repos/{repo}/actions/workflows/pages.yml/runs?branch=main&status=completed&per_page={BACKLOG_RUNS}"]))
    out = set()
    for run in runs.get("workflow_runs") or []:
        if str(run.get("id")) == str(current_run):
            continue
        created = datetime.strptime(run["created_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if (now - created).days >= BACKLOG_DAYS:
            break
        jobs = json.loads(gh(["api", f"repos/{repo}/actions/runs/{run['id']}/jobs?per_page=30"]))
        job = next((j for j in jobs.get("jobs") or [] if j.get("name") == "indexnow"), None)
        if job is None or job.get("conclusion") in (None, "skipped"):
            continue
        if job["conclusion"] == "success":
            break
        with tempfile.TemporaryDirectory() as d:
            try:
                gh(["run", "download", str(run["id"]), "-R", repo, "-n", "indexnow-delta", "-D", d])
                delta = json.load(open(os.path.join(d, "indexnow-delta.json"), encoding="utf-8"))
            except Exception as e:                                  # expired artifact: say so, move on
                print(f"::warning::run {run['id']}: its IndexNow job failed but its delta cannot be read ({redact(e, '')})")
                continue
        out.update(p for p in delta.get("submit") or [] if ps.family_of(p))
    return sorted(out)


def merge_backlog(delta, carried):
    """Add carried paths to this run's set. A seed/reseed announces nothing, carried or not."""
    carried = sorted(p for p in carried if ps.family_of(p))
    delta["carried"] = [] if delta.get("seed") else carried
    if not delta.get("seed"):
        delta["submit"] = sorted(set(delta["submit"]) | set(carried))
    return delta


# ---------------------------------------------------------------- the guarded notify step
def mass_change(delta):
    n = len(delta.get("submit") or [])
    return n >= MASS_FLOOR and n > MASS_RATIO * max(delta.get("candidate_pages") or 1, 1)


def notify(delta, key, *, allow_mass=False, post=default_post, get=default_get, sleep=time.sleep,
           wait=600, every=30, clock=time.time, strict_state=True):
    """The whole post-deploy step. Returns a sanitized receipt dict; raises IndexNowError."""
    paths = delta.get("submit") or []
    rec = {"build_id": delta.get("build_id"), "baseline_state_hash": delta.get("baseline_state_hash"),
           "candidate_state_hash": delta.get("candidate_state_hash"),
           "added": len(delta.get("added") or []), "changed": len(delta.get("changed") or []),
           "indexability_changed": len(delta.get("indexability_changed") or []),
           "removed": len(delta.get("removed") or []), "submitted": 0, "batches": [],
           "seed": bool(delta.get("seed")), "outcome": "", "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    if delta.get("seed"):
        rec["outcome"] = f"seed: {delta.get('seed_reason')}"
        return rec
    if not paths:
        rec["outcome"] = "no public page changed: nothing to notify"
        return rec
    if not key:
        rec["outcome"] = "skipped: INDEXNOW_KEY is not configured"
        return rec
    if not valid_key(key):
        raise IndexNowError("INDEXNOW_KEY is set but malformed (8-128 of A-Z a-z 0-9 -)")
    urls = url_list(paths)
    if mass_change(delta) and not allow_mass:
        rec["outcome"] = (f"HELD: {len(urls)} of {delta.get('candidate_pages')} pages changed at once "
                          f"(> {int(MASS_RATIO * 100)}%): a template change or a fingerprint defect, not "
                          f"fresh content. Re-run indexnow-resubmit with allow_mass_change=true if intended.")
        raise IndexNowError(rec["outcome"])
    verify_live(delta, key, get=get, sleep=sleep, wait=wait, every=every, clock=clock,
                strict_state=strict_state)
    rec["batches"] = submit(urls, key, post=post, sleep=sleep)
    rec["submitted"] = len(urls)
    rec["outcome"] = "submitted"
    return rec


# ---------------------------------------------------------------- CLI
def _write_summary(rec):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    lines = ["### IndexNow", "",
             f"- outcome: **{rec.get('outcome')}**",
             f"- added {rec.get('added')} · changed {rec.get('changed')} · indexability flips "
             f"{rec.get('indexability_changed')} · removed {rec.get('removed')} → submitted {rec.get('submitted')}",
             f"- baseline `{rec.get('baseline_state_hash')}` → candidate `{rec.get('candidate_state_hash')}`"]
    for b in rec.get("batches") or []:
        lines.append(f"- batch {b['batch']}: {b['urls']} URLs, HTTP {b['status']}, attempts {b['attempts']}")
    text = "\n".join(lines) + "\n"
    if path:
        open(path, "a", encoding="utf-8").write(text)
    print(text)


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("write-key"); w.add_argument("--out", required=True)
    c = sub.add_parser("check-artifact"); c.add_argument("--dir", required=True)
    co = sub.add_parser("carry-over", help="add URLs an earlier run's failed IndexNow job never sent")
    co.add_argument("--delta", required=True)
    n = sub.add_parser("notify")
    n.add_argument("--delta", required=True)
    n.add_argument("--receipt", default=None)
    n.add_argument("--allow-mass", action="store_true")
    n.add_argument("--relax-state", action="store_true",
                   help="re-submission of an older delta: do not require the live state to equal it")
    n.add_argument("--wait", type=int, default=600)
    a = ap.parse_args(argv)
    key = os.environ.get("INDEXNOW_KEY", "").strip()

    if a.cmd == "write-key":
        ok, msg = write_key_file(a.out, key, os.environ.get("GITHUB_EVENT_NAME", ""))
        print(msg)
        if key and not valid_key(key) and os.environ.get("GITHUB_EVENT_NAME") != "pull_request":
            print("::error::INDEXNOW_KEY is set but is not a valid IndexNow key; IndexNow is disabled until fixed")
        return 0
    if a.cmd == "check-artifact":
        problems, scanned = check_artifact(a.dir, key)
        print(f"indexnow artifact check: scanned {scanned} files, {len(problems)} problem(s)")
        for p in problems:
            print("  PROBLEM:", p)
        return 1 if problems else 0
    if a.cmd == "carry-over":
        delta = json.load(open(a.delta, encoding="utf-8"))
        try:
            carried = unsent_paths(os.environ["GITHUB_REPOSITORY"], os.environ.get("GITHUB_RUN_ID", ""))
        except Exception as e:     # never block a deploy on a history lookup; say so loudly
            print(f"::warning::could not look up unsent IndexNow notifications ({redact(e, '')}); "
                  f"anything an earlier failed notification missed will need indexnow-resubmit")
            return 0
        merge_backlog(delta, carried)
        json.dump(delta, open(a.delta, "w", encoding="utf-8"), indent=1, sort_keys=True)
        print(f"carried over {len(delta['carried'])} URL(s) an earlier IndexNow job did not send; "
              f"{len(delta['submit'])} to submit in total")
        return 0
    delta = json.load(open(a.delta, encoding="utf-8"))
    rec = {}
    try:
        rec = notify(delta, key, allow_mass=a.allow_mass, wait=a.wait, strict_state=not a.relax_state)
    except IndexNowError as e:
        rec = {"outcome": f"FAILED: {redact(e, key)}", "submitted": 0,
               "baseline_state_hash": delta.get("baseline_state_hash"),
               "candidate_state_hash": delta.get("candidate_state_hash"),
               "added": len(delta.get("added") or []), "changed": len(delta.get("changed") or []),
               "indexability_changed": len(delta.get("indexability_changed") or []),
               "removed": len(delta.get("removed") or []), "batches": []}
        _write_summary(rec)
        if a.receipt:
            json.dump(rec, open(a.receipt, "w"), indent=1)
        print(f"::error::{rec['outcome']}")
        return 1
    _write_summary(rec)
    if a.receipt:
        text = json.dumps(rec, indent=1)
        assert not key or key not in text
        open(a.receipt, "w").write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
