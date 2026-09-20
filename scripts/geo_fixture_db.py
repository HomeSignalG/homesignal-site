#!/usr/bin/env python3
"""Shared psql plumbing for the geography fixtures, with a disposable-target guard.

WHY THE GUARD EXISTS. These fixtures open with `drop schema geo cascade`. Pointed
at the wrong DSN that is not a test failure, it is the incident. The guard runs
BEFORE any destructive statement and refuses unless FOUR independent signals agree
the target is disposable. It fails closed: if a signal cannot be read, that is a
refusal, not a pass.

Every psql invocation uses -v ON_ERROR_STOP=1 and its RETURN CODE is checked.
psql exits 0 on a script whose statements errored unless ON_ERROR_STOP is set, so
the two belong together; checking neither is how a fixture reports success over a
database that rejected half of it.

stdlib only.
"""
import os
import re
import subprocess

PROD_MARKERS = (
    ("public.app_projects", 1000),
    ("geo.zip_authoritative_membership", 1000),
    ("geo.zip_authoritative_marker", 1000),
    ("geo.n5_geom", 1000),
)
PROD_CRON = ("dev-reports-rolling-refresh", "pipeline-health-monitor")


class NotDisposable(RuntimeError):
    pass


def _psql(dsn, sql, check=True):
    p = subprocess.run(
        ["psql", dsn, "-v", "ON_ERROR_STOP=1", "-X", "-tA", "-c", sql],
        capture_output=True, text=True,
    )
    if check and p.returncode != 0:
        raise RuntimeError(f"psql exit {p.returncode}: {p.stderr.strip()}")
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def run_sql(dsn, sql):
    return _psql(dsn, sql)[1]


def run_file(dsn, path, expect_failure=False):
    """Run a .sql file. Return code IS the verdict - psql alone will not tell you."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"artifact does not exist: {path}")
    p = subprocess.run(
        ["psql", dsn, "-v", "ON_ERROR_STOP=1", "-X", "-f", path],
        capture_output=True, text=True,
    )
    out = p.stdout + p.stderr
    if expect_failure:
        if p.returncode == 0:
            raise RuntimeError(f"{path} was expected to FAIL and exited 0:\n{out[-800:]}")
        return p.returncode, out
    if p.returncode != 0:
        raise RuntimeError(f"{path} exited {p.returncode}:\n{out[-1500:]}")
    return p.returncode, out


def require_disposable(dsn):
    """Refuse unless four independent signals agree this database is disposable."""
    # (1) explicit opt-in. Never inferred.
    if os.environ.get("GEO_FIXTURE_DISPOSABLE") != "1":
        raise NotDisposable(
            "REFUSING: GEO_FIXTURE_DISPOSABLE=1 is not set. These fixtures DROP SCHEMAs; "
            "the opt-in is deliberate and must never be defaulted on.")

    # (2) the host must be local. A DSN with no host= is a local socket.
    host = None
    m = re.search(r"\bhost=([^\s]+)", dsn)
    if m:
        host = m.group(1)
    if host is not None and host not in ("localhost", "127.0.0.1", "::1") and not host.startswith("/"):
        raise NotDisposable(f"REFUSING: host={host!r} is not local.")

    # (3) no production-sized relation may exist. Read fails closed.
    for rel, limit in PROD_MARKERS:
        # Existence and count are SEPARATE statements on purpose: a CASE still plans
        # its ELSE branch, so `case when to_regclass(x) is null then -1 else (count
        # from x) end` raises 42P01 on an absent relation and the guard would refuse
        # a perfectly disposable empty database. Measured while writing this.
        rc, out, err = _psql(dsn, f"select to_regclass('{rel}') is not null;", check=False)
        if rc != 0:
            raise NotDisposable(f"REFUSING: could not probe {rel} for existence: {err}")
        if out != "t":
            continue  # absent: cannot be the production relation
        rc, out, err = _psql(
            dsn, f"select count(*) from (select 1 from {rel} limit {limit}) z;", check=False)
        if rc != 0:
            raise NotDisposable(f"REFUSING: could not read {rel} to prove it is not production: {err}")
        try:
            n = int(out)
        except ValueError:
            raise NotDisposable(f"REFUSING: unreadable count for {rel}: {out!r}")
        if n >= limit:
            raise NotDisposable(
                f"REFUSING: {rel} holds >= {limit} rows. This looks like production or a "
                f"populated copy of it.")

    # (4) no production cron job may be present.
    rc, out, err = _psql(dsn, "select to_regclass('cron.job') is not null;", check=False)
    if rc != 0:
        raise NotDisposable(f"REFUSING: could not probe the cron catalog: {err}")
    if out == "t":
        rc, out, err = _psql(
            dsn, "select coalesce(string_agg(jobname, ','), '') from cron.job;", check=False)
        if rc != 0:
            raise NotDisposable(
                f"REFUSING: could not read the cron catalog to prove it is not production: {err}")
        for job in PROD_CRON:
            if job in out:
                raise NotDisposable(f"REFUSING: cron job {job!r} is present. This is production.")

    return True
