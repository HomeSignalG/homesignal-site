#!/usr/bin/env python3
"""Committed-file database migrations with a durable, out-of-band approval. See docs/db-migration-runner.md.

  request  <file> <commit>   NO CREDENTIALS. Pins the file's sha256 at <commit>, asks the public read-only function
                             public.migration_state(sha) (anon key) what production already knows, and writes the body of a
                             GitHub issue. The issue is the durable request: it never expires and nothing waits on it.
  decide                     Runs on an issue comment. `/reject` records a refusal. `/approve <sha256> <commit> <code> [unmerged]`
                             is checked (approver, request provenance, sha, authenticator code, single use) and only then executes.

Why the pieces exist:
  * The ungated step holds no production credential at all, so a compromised query cannot write (it has only the public anon key).
  * The write token exists only in the protected environment of the decide job, used only after a verified approval.
  * This session and the founder share one GitHub login, so a comment alone proves nothing. The approval needs a time-based
    one-time code (RFC 6238) from the founder's authenticator; the seed is a secret the session never sees, and each code is
    single use. A timeout never approves anything.
  * A client timeout while applying is recorded `unknown`: not success, not failure.
"""
import base64, hashlib, hmac, json, os, re, struct, subprocess, sys, time, urllib.error, urllib.request

ALLOWED = re.compile(r'^(docs/[A-Za-z0-9._-]+\.sql|supabase/migrations/[A-Za-z0-9._-]+\.sql)$')
SHA_RE, COMMIT_RE = re.compile(r'^[0-9a-f]{64}$'), re.compile(r'^[0-9a-f]{40}$')
MARK = 'db-migrate-request v1'
BOOTSTRAP_DDL = """
create table if not exists public.migration_runs (
  id bigserial primary key, file_path text not null, file_sha256 text not null, git_sha text not null, git_ref text,
  run_id text, actor text, approved_in text, status text not null check (status in ('started','applied','failed','unknown')),
  detail text, started_at timestamptz not null default now(), finished_at timestamptz);
create table if not exists public.migration_totp_used (counter bigint primary key, used_at timestamptz not null default now());
alter table public.migration_runs enable row level security;
alter table public.migration_totp_used enable row level security;
revoke all on public.migration_runs, public.migration_totp_used from public, anon, authenticated;
create or replace function public.migration_state(p_sha text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $f$
  select coalesce(jsonb_agg(jsonb_build_object('status', status, 'finished_at', finished_at) order by id), '[]'::jsonb)
    from public.migration_runs where file_sha256 = p_sha;
$f$;
revoke all on function public.migration_state(text) from public;
grant execute on function public.migration_state(text) to anon, authenticated, service_role;
"""
RISKY = [r'\bdrop\s+(table|schema|column|function|trigger|index)\b', r'\btruncate\b', r'\bdelete\s+from\b',
         r'\balter\s+table\b[^;]*\bdrop\b', r'\bcron\.(un)?schedule\b', r'\bgrant\b', r'\brevoke\b']


def die(msg, code=1):
    print(f'db_migrate: {msg}', file=sys.stderr)
    sys.exit(code)


# ---- one-time code (RFC 6238, HMAC-SHA1, 6 digits, 30 s) --------------------------------------------------------------
def hotp(secret_b32, counter, digits=6):
    key = base64.b32decode(secret_b32.replace(' ', '').upper() + '=' * (-len(secret_b32.replace(' ', '')) % 8))
    h = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    o = h[-1] & 15
    return str((struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 10 ** digits).zfill(digits)


def totp_counter_for(secret_b32, code, now=None, window=1):
    """The counter whose code equals `code` within +-window steps, else None. Constant-time compare."""
    t = int((time.time() if now is None else now) // 30)
    hit = None
    for c in range(t - window, t + window + 1):
        if hmac.compare_digest(hotp(secret_b32, c), code):
            hit = c
    return hit


# ---- production access ---------------------------------------------------------------------------------------------------
def _post(url, headers, payload, timeout):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST',
                                 headers={**headers, 'Content-Type': 'application/json', 'Accept': 'application/json',
                                          'User-Agent': 'HomeSignal-db-migrate/2.0 (+https://homesignal.net)'})
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


def write_sql(sql, timeout=300):
    """Management API (full write). Used ONLY by `decide`, after a verified approval."""
    ref, tok = os.environ.get('SUPABASE_PROJECT_REF'), os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not ref or not tok:
        die('SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN not set')
    base = os.environ.get('DB_MIGRATE_TEST_API') or 'https://api.supabase.com'
    if os.environ.get('DB_MIGRATE_TEST_TIMEOUT'):   # tests only; no workflow sets it (pinned by test)
        timeout = min(timeout, float(os.environ['DB_MIGRATE_TEST_TIMEOUT']))
    return _post(f'{base}/v1/projects/{ref}/database/query', {'Authorization': f'Bearer {tok}'}, {'query': sql}, timeout)


def public_config():
    txt = open('config.js').read()
    url = re.search(r"SUPABASE_URL:\s*'([^']+)'", txt).group(1)
    key = re.search(r"SUPABASE_ANON_KEY:\s*'([^']+)'", txt).group(1)
    return os.environ.get('DB_MIGRATE_TEST_REST') or url, key


def migration_state(sha):
    """Public read-only function. Returns (installed, rows). Needs no secret: the anon key is public by design."""
    url, key = public_config()
    code, body = _post(f'{url}/rest/v1/rpc/migration_state', {'apikey': key, 'Authorization': f'Bearer {key}'}, {'p_sha': sha}, 30)
    if code == 200:
        return True, body or []
    if code in (404, 400) and 'migration_state' in str(body):
        return False, []
    die(f'migration_state failed: HTTP {code} {body}')


# ---- git ---------------------------------------------------------------------------------------------------------------
def git(*a):
    r = subprocess.run(['git', *a], capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def file_at(commit, path):
    if not ALLOWED.match(path):
        die(f'{path} is not an allowed migration path (docs/*.sql or supabase/migrations/*.sql)')
    if not COMMIT_RE.match(commit):
        die('commit must be a full 40-character sha')
    rc, _, _ = git('cat-file', '-e', f'{commit}^{{commit}}')
    if rc:
        die(f'commit {commit} is not in this repository')
    rc, out, _ = git('branch', '-r', '--contains', commit)
    if rc or not out.strip():
        die(f'commit {commit} is not on any branch of this repository')
    rc, _, _ = git('merge-base', '--is-ancestor', commit, 'origin/main')
    on_main = rc == 0
    p = subprocess.run(['git', 'show', f'{commit}:{path}'], capture_output=True)
    if p.returncode:
        die(f'{path} does not exist at {commit}')
    return p.stdout, hashlib.sha256(p.stdout).hexdigest(), on_main


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def out_kv(**kv):
    p = os.environ.get('GITHUB_OUTPUT')
    if p:
        with open(p, 'a') as f:
            for k, v in kv.items():
                f.write(f'{k}={v}\n')


# ---- request (no credentials) ----------------------------------------------------------------------------------------
def cmd_request(path, commit):
    data, sha, on_main = file_at(commit, path)
    sql = data.decode()
    risky = sorted({m.group(0).lower() for pat in RISKY for m in re.finditer(pat, sql, re.I)})
    creates = sorted(set(re.findall(r'create\s+(?:or\s+replace\s+)?(?:table|function|view|trigger)\s+(?:if\s+not\s+exists\s+)?([\w.]+)', sql, re.I)))
    installed, prior = migration_state(sha)
    boot = hashlib.sha256(BOOTSTRAP_DDL.encode()).hexdigest()[:16]
    body = [f'<!-- {MARK} file={path} sha256={sha} commit={commit} on_main={str(on_main).lower()} -->',
            f'## Migration request: `{path}`', '',
            f'- sha256: `{sha}`', f'- commit: `{commit}`', f'- on `main`: **{"yes" if on_main else "NO, an unmerged branch"}**',
            f'- lines: {sql.count(chr(10)) + 1}', f'- creates/replaces: {", ".join(creates) or "none found"}',
            f'- read twice: {", ".join(risky) or "none matched"}',
            f'- runner ledger installed in production: {str(installed).lower()}; earlier runs of this exact file: {json.dumps(prior) if prior else "none"}',
            f'- runner bootstrap DDL fingerprint: `{boot}` (creates the ledger and `migration_state` on first use)', '',
            '### How to decide (this request never expires)',
            f'- Approve: comment `/approve {sha} {commit} <6-digit code from your authenticator>`' + ('' if on_main else ' `unmerged`'),
            '- Reject: comment `/reject <reason>`', '',
            'Nothing runs until a valid approval comment is posted. A timeout, a label or a comment from anyone else does nothing.']
    text = '\n'.join(body) + '\n'
    open(os.environ.get('REQUEST_BODY_FILE', 'request-body.md'), 'w').write(text)
    print(text)
    if any(r.get('status') == 'applied' for r in prior):
        die('this exact file is already recorded as applied; no request created', 3)


# ---- decide ----------------------------------------------------------------------------------------------------------------
def reply(lines):
    text = '\n'.join(lines) + '\n'
    open(os.environ.get('RESULT_FILE', 'result.md'), 'w').write(text)
    print(text)


def refuse(why):
    reply([f'**Refused:** {why}', '', 'Nothing was changed. This request is still open; post a corrected `/approve` when ready.'])
    out_kv(decision='refused')
    sys.exit(0)


def cmd_decide():
    ev = json.load(open(os.environ['GITHUB_EVENT_PATH']))
    issue, comment = ev.get('issue') or {}, ev.get('comment') or {}
    if issue.get('pull_request'):
        die('pull request comments are not approvals', 0)
    labels = {l['name'] for l in issue.get('labels', [])}
    m = re.search(r'<!-- ' + re.escape(MARK) + r' file=(\S+) sha256=([0-9a-f]{64}) commit=([0-9a-f]{40}) on_main=(true|false) -->', issue.get('body') or '')
    if 'migration-request' not in labels or not m or (issue.get('user') or {}).get('login') != 'github-actions[bot]' or issue.get('state') != 'open':
        out_kv(decision='ignored')
        print('not an open request created by the request workflow; ignoring')
        return
    path, sha, commit, on_main = m.group(1), m.group(2), m.group(3), m.group(4) == 'true'
    user = (comment.get('user') or {})
    approvers = {a.strip().lower() for a in (os.environ.get('MIGRATION_APPROVERS') or '').split(',') if a.strip()}
    approvers.add((os.environ.get('GITHUB_REPOSITORY_OWNER') or '').lower())
    if user.get('type') != 'User' or user.get('login', '').lower() not in approvers:
        out_kv(decision='ignored')
        print('commenter is not an approver; ignoring')
        return
    words = (comment.get('body') or '').strip().split()
    if words[:1] == ['/reject']:
        reply([f'**Rejected** by @{user["login"]}: {" ".join(words[1:]) or "no reason given"}', '', 'Nothing was run.'])
        out_kv(decision='rejected')
        return
    if words[:1] != ['/approve']:
        out_kv(decision='ignored')
        return
    if len(words) < 4:
        refuse('usage: /approve <sha256> <commit> <6-digit code>' + ('' if on_main else ' unmerged'))
    a_sha, a_commit, code = words[1].lower(), words[2].lower(), words[3]
    if (a_sha, a_commit) != (sha, commit):
        refuse('the sha256 / commit in your approval do not match this request')
    if not on_main and words[4:5] != ['unmerged']:
        refuse('this commit is not on main; add the word `unmerged` to confirm you mean that')
    try:
        data, got_sha, _ = file_at(commit, path)
    except SystemExit:
        refuse('the file cannot be read at that commit (see the run log)')
    if got_sha != sha:
        refuse(f'the file at that commit hashes to {got_sha}, not the approved sha256')
    seed = os.environ.get('MIGRATION_TOTP_SECRET')
    if not seed:
        refuse('MIGRATION_TOTP_SECRET is not configured, so no approval can be verified')
    counter = totp_counter_for(seed, code)
    if counter is None:
        refuse('the one-time code is wrong or expired; use a fresh code from your authenticator')
    # from here a valid approval exists. Everything below writes.
    code_, body = write_sql(BOOTSTRAP_DDL)
    if code_ not in (200, 201):
        refuse(f'ledger bootstrap failed (HTTP {code_}); nothing else was run')
    code_, body = write_sql(f'insert into public.migration_totp_used (counter) values ({counter})')
    if code_ not in (200, 201):
        refuse('that one-time code was already used; wait for the next one')
    code_, rows = write_sql("select status from public.migration_runs where file_sha256 = " + lit(sha) +
                            " and status in ('applied','started','unknown')")
    if code_ not in (200, 201):
        refuse(f'could not read the ledger (HTTP {code_})')
    if rows:
        refuse(f'this exact file already has a ledger entry ({rows[0]["status"]}); settle that first')
    env = os.environ
    code_, rows = write_sql("insert into public.migration_runs (file_path,file_sha256,git_sha,git_ref,run_id,actor,approved_in,status) values ("
                            + ",".join(lit(v) for v in (path, sha, commit, env.get('GITHUB_REF_NAME', ''), env.get('GITHUB_RUN_ID', ''),
                                                        user['login'], issue.get('html_url', ''))) + ",'started') returning id")
    if code_ not in (200, 201) or not rows:
        refuse(f'could not write the started ledger row (HTTP {code_}); the migration was not run')
    rid = rows[0]['id']
    status, detail = 'unknown', ''
    try:
        code_, body = write_sql(data.decode(), 1500)
        if code_ in (200, 201):
            status = 'applied'
        else:
            status, detail = 'failed', f'HTTP {code_} {str(body)[:600]}'
    except TimeoutError as e:
        detail = f'client timeout: {e}. NOT success and NOT failure; check production read-only before anything else.'
    write_sql(f"update public.migration_runs set status={lit(status)}, detail={lit(detail)}, finished_at=now() where id={rid}")
    reply([f'**{status.upper()}**: `{path}` (sha256 `{sha}`) approved by @{user["login"]}', f'- ledger id: {rid}', f'- {detail}' if detail else ''])
    out_kv(decision=status)
    if status != 'applied':
        sys.exit(4 if status == 'unknown' else 1)


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['request'] and len(a) == 3:
        cmd_request(a[1], a[2])
    elif a[:1] == ['decide'] and len(a) == 1:
        cmd_decide()
    elif a[:1] == ['totp-seed']:
        s = base64.b32encode(os.urandom(20)).decode().rstrip('=')
        print(f'seed: {s}\nauthenticator URI: otpauth://totp/JODY-migrations?secret={s}&issuer=JODY&digits=6&period=30')
    else:
        die('usage: db_migrate.py request <file> <commit> | decide | totp-seed', 2)
