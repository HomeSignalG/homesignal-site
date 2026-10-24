#!/usr/bin/env python3
"""Committed-file database migrations through the Supabase Management API, run by .github/workflows/db-migrate.yml.

Subcommands (stdlib only):
  preflight  READ-ONLY. Checks the file (path allowlist, sha256 pin) and asks production what it already holds
             (ledger row for this sha, objects the file creates). Writes a reviewer summary to $GITHUB_STEP_SUMMARY.
  apply      Writes a 'started' ledger row, runs the file, then marks it 'applied' / 'failed' / 'unknown'.
  verify     READ-ONLY. Runs a committed verify file (select statements only) and prints the rows.

Design rules (see docs/db-migration-runner.md):
  * The file is identified by its sha256, which the approver sees BEFORE approving. A file that differs from the pin is refused.
  * A timeout is never success and never failure: it is recorded 'unknown' and settled by a read-only preflight.
  * Nothing here wraps a migration in begin/rollback. A rolled-back DDL still takes locks (CLAUDE.md 7.11).
  * Credentials come from the environment only and are never printed.
"""
import hashlib, json, os, re, subprocess, sys, urllib.request, urllib.error

ALLOWED = re.compile(r'^(docs/[A-Za-z0-9._-]+\.sql|supabase/migrations/[A-Za-z0-9._-]+\.sql)$')
LEDGER_DDL = """
create table if not exists public.migration_runs (
  id bigserial primary key,
  file_path text not null,
  file_sha256 text not null,
  git_sha text not null,
  git_ref text,
  run_id text,
  actor text,
  status text not null check (status in ('started','applied','failed','unknown')),
  detail text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.migration_runs enable row level security;
revoke all on public.migration_runs from public, anon, authenticated;
"""
RISKY = [r'\bdrop\s+(table|schema|column|function|trigger|index)\b', r'\btruncate\b', r'\bdelete\s+from\b',
         r'\balter\s+table\b[^;]*\bdrop\b', r'\bcron\.(un)?schedule\b', r'\bgrant\b', r'\brevoke\b']


def die(msg, code=1):
    print(f'db_migrate: {msg}', file=sys.stderr)
    sys.exit(code)


def q(sql, timeout=300):
    """POST one query. Returns (http_status, parsed_body). Raises TimeoutError on a client timeout."""
    ref, tok = os.environ.get('SUPABASE_PROJECT_REF'), os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not ref or not tok:
        die('SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN not set (the environment secret is missing)')
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{ref}/database/query',
        data=json.dumps({'query': sql}).encode(), method='POST',
        headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json', 'Accept': 'application/json',
                 'User-Agent': 'HomeSignal-db-migrate/1.0 (+https://homesignal.net)'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:2000]
    except (TimeoutError, urllib.error.URLError) as e:
        if 'timed out' in str(e).lower():
            raise TimeoutError(str(e))
        raise


def read_only(sql):
    s = re.sub(r'--[^\n]*', '', sql).strip().lower()
    if not s.startswith(('select', 'with')) or re.search(r'\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b', s):
        die('refusing a read-only query that is not a plain select')
    code, body = q(sql, 120)
    if code != 200 and code != 201:
        die(f'read-only query failed: HTTP {code} {body}')
    return body


def load(path, pin):
    if not ALLOWED.match(path):
        die(f'{path} is not an allowed migration path (docs/*.sql or supabase/migrations/*.sql)')
    data = open(path, 'rb').read()
    got = hashlib.sha256(data).hexdigest()
    if got != pin.lower():
        die(f'sha256 mismatch: file is {got}, approval pin is {pin}')
    return data.decode()


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def step_summary(lines):
    p = os.environ.get('GITHUB_STEP_SUMMARY')
    text = '\n'.join(lines) + '\n'
    print(text)
    if p:
        open(p, 'a').write(text)


def cmd_preflight(path, pin):
    sql = load(path, pin)
    risky = sorted({m.group(0).lower() for pat in RISKY for m in re.finditer(pat, sql, re.I)})
    creates = sorted(set(re.findall(r'create\s+(?:or\s+replace\s+)?(?:table|function|view|trigger)\s+(?:if\s+not\s+exists\s+)?([\w.]+)', sql, re.I)))
    ledger = read_only("select to_regclass('public.migration_runs') is not null as has_ledger")
    has = bool(ledger and ledger[0].get('has_ledger'))
    prior = []
    if has:
        prior = read_only("select id,status,git_sha,started_at,finished_at,detail from public.migration_runs where file_sha256 = "
                          + lit(pin.lower()) + " order by id")
    lines = ['## Migration preflight (read-only)', f'- file: `{path}`', f'- sha256 (this is what you are approving): `{pin.lower()}`',
             f'- lines: {sql.count(chr(10)) + 1}', f'- creates/replaces: {", ".join(creates) or "none found"}',
             f'- statements a reviewer should read twice: {", ".join(risky) or "none matched"}',
             f'- ledger table present: {has}', f'- earlier runs of this exact file: {json.dumps(prior, default=str) if prior else "none"}']
    if any(r['status'] in ('applied', 'unknown', 'started') for r in prior):
        lines.append('- **WARNING: this file has an earlier run that is applied/unknown/started. Settle it before approving.**')
    step_summary(lines)
    if any(r['status'] == 'applied' for r in prior):
        die('this exact file is already recorded as applied; refusing to run it again', 3)


def cmd_apply(path, pin):
    sql = load(path, pin)
    code, body = q(LEDGER_DDL)
    if code not in (200, 201):
        die(f'ledger setup failed: HTTP {code} {body}')
    gsha, ref, run, actor = (os.environ.get(k, '') for k in ('GITHUB_SHA', 'GITHUB_REF_NAME', 'GITHUB_RUN_ID', 'GITHUB_ACTOR'))
    rows = read_only('select 1 as x')  # connectivity proof before writing
    code, body = q("insert into public.migration_runs (file_path,file_sha256,git_sha,git_ref,run_id,actor,status) values ("
                   + ",".join(lit(v) for v in (path, pin.lower(), gsha, ref, run, actor)) + ",'started') returning id")
    if code not in (200, 201) or not body:
        die(f'could not write the started ledger row: HTTP {code} {body}')
    rid = body[0]['id']
    status, detail = 'unknown', ''
    try:
        code, body = q(sql, 1500)
        if code in (200, 201):
            status = 'applied'
        else:
            status, detail = 'failed', f'HTTP {code} {str(body)[:600]}'
    except TimeoutError as e:
        status, detail = 'unknown', f'client timeout: {e}. NOT success and NOT failure; run preflight/verify to settle.'
    q(f"update public.migration_runs set status={lit(status)}, detail={lit(detail)}, finished_at=now() where id={rid}")
    step_summary(['## Migration result', f'- file sha256: `{pin.lower()}`', f'- ledger id: {rid}', f'- status: **{status}**', f'- {detail}' if detail else ''])
    if status != 'applied':
        die(f'migration status is {status}', 4 if status == 'unknown' else 1)


def cmd_verify(path, pin):
    sql = load(path, pin)
    out = read_only(sql)
    step_summary(['## Verification (read-only)', '```json', json.dumps(out, indent=1, default=str)[:6000], '```'])


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[1] not in ('preflight', 'apply', 'verify'):
        die('usage: db_migrate.py preflight|apply|verify <sql_file> <sha256>', 2)
    {'preflight': cmd_preflight, 'apply': cmd_apply, 'verify': cmd_verify}[sys.argv[1]](sys.argv[2], sys.argv[3])
