#!/usr/bin/env python3
"""Generate docs/dc-epoch-geography-apply.sql FROM the DDL of record -- never retyped.

Production already carries Steps 2A/3A/3B. Re-running whole files would re-create
dc_current_observation (dropping its security_invoker reloption) and re-issue unchanged objects,
so the apply carries ONLY the objects this change adds or alters, sliced out of the committed
files by a dollar-quote-aware statement splitter, in dependency order:
  Step 3D whole -> Step 3A record keys, review, candidates, adjudicator, resolver
  -> Step 3B uncertainty column + resolver -> the Map 1 reader.
It opens with a FAIL-CLOSED drift guard: the live bodies of the four functions it replaces must
still fingerprint to what main shipped, or nothing is applied (another writer's change is never
overwritten). Run: python3 test/dc_epoch_geography_pg/build_apply.py [--check]
"""
import re, sys, hashlib, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/dc-epoch-geography-apply.sql'
# prosrc md5 of the live functions this apply replaces, measured 2026-09-24 and equal to main@58aeb8c
EXPECT_LIVE = {
    'dc_adjudicate_pair': '27874cd1819cf24fe60746bf7dd8075f',
    'dc_resolve_canonical': '5a3eb4e3d4fa337452649c789e335f22',
    'dc_resolve_geography': 'e8680f1ea7a38242e53dff667e6a96bf',
    'map1_dc_zip_members': 'b143605c4cacca1a6da462443a0add7a',
}


def split(sql):
    stmts, start, i, n, dq = [], 0, 0, len(sql), None
    while i < n:
        if dq:
            j = sql.find(dq, i)
            if j < 0:
                raise SystemExit('unterminated dollar quote')
            i, dq = j + len(dq), None
            continue
        if sql.startswith('--', i):
            j = sql.find('\n', i); i = n if j < 0 else j; continue
        c = sql[i]
        if c == "'":
            j = i + 1
            while True:
                k = sql.find("'", j)
                if k < 0: raise SystemExit('unterminated string')
                if sql.startswith("''", k): j = k + 2; continue
                j = k + 1; break
            i = j; continue
        m = re.match(r'\$[A-Za-z_]*\$', sql[i:i + 40])
        if m:
            dq = m.group(0); i += len(dq); continue
        if c == ';':
            stmts.append(sql[start:i + 1]); start = i + 1
        i += 1
    return stmts


def code(s):
    return ' '.join(l for l in s.split('\n') if not l.strip().startswith('--')).strip()


def pick(path, preds):
    """Every statement whose comment-stripped text starts with one of `preds` (each must match)."""
    stmts = split((ROOT / path).read_text())
    out, hit = [], {p: 0 for p in preds}
    for s in stmts:
        c = ' '.join(code(s).split())
        for p in preds:
            if c.startswith(p):
                out.append(s.strip('\n')); hit[p] += 1
    missing = [p for p, k in hit.items() if k == 0]
    if missing:
        raise SystemExit(f'{path}: no statement starts with {missing}')
    return out


def build():
    d3 = [s.strip('\n') for s in split((ROOT / 'docs/dc-step3d-derived-location.sql').read_text())]
    a3 = pick('docs/dc-step3a-canonical-identity.sql', [
        'create or replace view public.dc_observation_record_key',
        'revoke all on public.dc_observation_record_key',
        'comment on view public.dc_observation_record_key',
        'create or replace function public.dc_normalize_street(',
        'create or replace function public.dc_site_address(',
        'create or replace function public.dc_name_designations(',
        'create or replace view public.dc_observation_site_address',
        'revoke all on public.dc_observation_site_address',
        'comment on view public.dc_observation_site_address',
        'create or replace view public.dc_identity_candidate',
        'comment on view public.dc_identity_candidate',
        'revoke all on public.dc_identity_candidate',
        'create or replace function public.dc_adjudicate_pair(',
        'comment on function public.dc_adjudicate_pair(',
        'create or replace function public.dc_resolve_canonical(',
        'comment on function public.dc_resolve_canonical(',
        'create or replace view public.dc_entity_identity_open',
        'revoke all on public.dc_entity_identity_open',
        'comment on view public.dc_entity_identity_open',
        'create or replace view public.dc_record_identity',
        'revoke all on public.dc_record_identity',
        'comment on view public.dc_record_identity',
        'create or replace function public.dc_record_citation(',
        'comment on function public.dc_record_citation(',
    ])
    b3 = pick('docs/dc-step3b-canonical-geography.sql', [
        'alter table public.dc_entity_geography add column if not exists positional_uncertainty_m',
        'create or replace view public.dc_entity_geography_evidence',
        'revoke all on public.dc_entity_geography_evidence',
        'comment on view public.dc_entity_geography_evidence',
        'create or replace function public.dc_resolve_geography(',
        'comment on function public.dc_resolve_geography(',
    ])
    mp = pick('docs/map1-dc-publication.sql', [
        'create or replace function public.map1_dc_zip_members(',
        'revoke all on function public.map1_dc_zip_members(',
        'grant execute on function public.map1_dc_zip_members(',
        'comment on function public.map1_dc_zip_members(',
    ])
    guard = ["do $guard$",
             "declare r record; bad text := '';",
             "begin",
             "  for r in select * from (values " + ", ".join(
                 f"('{k}', '{v}')" for k, v in sorted(EXPECT_LIVE.items())) + ") x(fn, want) loop",
             "    if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
             "         where n.nspname = 'public' and p.proname = r.fn) is distinct from r.want then",
             "      bad := bad || ' ' || r.fn;",
             "    end if;",
             "  end loop;",
             "  if bad <> '' then",
             "    raise exception 'DRIFT: live definition(s) no longer match main@58aeb8c:%. Nothing applied.', bad;",
             "  end if;",
             "end $guard$;"]
    parts = ['-- GENERATED by test/dc_epoch_geography_pg/build_apply.py from the DDL of record. Do not edit.',
             '-- One transaction: the drift guard, then Step 3D, 3A, 3B and the Map 1 reader, in dependency order.',
             'begin;', '\n'.join(guard)]
    for label, block in (('STEP 3D  docs/dc-step3d-derived-location.sql', d3),
                         ('STEP 3A  docs/dc-step3a-canonical-identity.sql (changed objects)', a3),
                         ('STEP 3B  docs/dc-step3b-canonical-geography.sql (changed objects)', b3),
                         ('MAP 1    docs/map1-dc-publication.sql', mp)):
        parts.append(f'-- ===== {label} =====')
        parts.extend(block)
    parts.append('commit;')
    return '\n\n'.join(parts) + '\n'


# ── THE PRODUCTION DRY RUN MUST NOT LOCK A LIVE OBJECT ──────────────────────────────────────────
# 2026-09-24, measured: a dry run that applied this DDL to the LIVE schema inside a transaction it
# rolled back still held ACCESS EXCLUSIVE on public.dc_entity_geography (ALTER TABLE ADD COLUMN)
# until the rollback -- ~7 minutes -- and one resident map1_dc_zip_members call returned 500 on it.
# "Rolled back" is not "harmless": DDL locks live until the transaction ends. So the dry run builds
# the WHOLE changed chain in a private scratch schema that exists only inside its own transaction:
#   * every object this apply CREATES, and every live table it ALTERS or its resolvers WRITE, is
#     re-pointed to the scratch schema (the writable tables are copied in first, read-only);
#   * everything else (the evidence plane, unchanged functions) is only READ from public.
# The set is DERIVED from the apply body, never listed by hand, and assert_no_live_target()
# refuses the output if any DDL or DML statement still targets public.
def dryrun_names(body):
    created = set(re.findall(r'create (?:or replace )?(?:function|view|table(?: if not exists)?) public\.([a-z0-9_]+)', body))
    written = set(re.findall(r'(?:alter table|insert into|update|delete from) public\.([a-z0-9_]+)', body))
    return created, written - created


def dryrun_rewrite(sql, schema, names):
    return re.sub(r'\bpublic\.(' + '|'.join(sorted(names, key=len, reverse=True)) + r')\b',
                  schema + r'.\1', sql)


TARGET = re.compile(r'^(?:create (?:or replace )?(?:function|view|table(?: if not exists)?)|alter table|insert into|update|'
                    r'delete from|truncate(?: table)?|drop (?:table|view|function|trigger [a-z0-9_]+ on|trigger if exists [a-z0-9_]+ on)(?: if exists)?|'
                    r'comment on (?:table|view|function)|revoke all on(?: function)?|grant [a-z, ]+ on(?: function)?|'
                    r'create (?:unique )?index(?: if not exists)? [a-z0-9_]+ on|create trigger [a-z0-9_]+ [a-z ]+? on)\s+([a-z0-9_]+)\.', re.I)


def assert_no_live_target(sql):
    bad = []
    for s in split(sql):
        c = ' '.join(code(s).split()).lower()
        m = TARGET.match(c)
        if m and m.group(1) == 'public':
            bad.append(c[:120])
        elif re.match(r'^(create|alter|drop|insert|update|delete|truncate|comment|revoke|grant)\b', c) and not m \
                and not c.startswith(('create schema', 'create temp', 'create temporary')):
            bad.append('UNRECOGNISED ' + c[:110])
    if bad:
        raise SystemExit('REFUSED: the dry run would change a live object:\n  ' + '\n  '.join(bad))


def dryrun_body(schema):
    body = build().replace('\nbegin;\n', '\n', 1).rstrip()
    assert body.endswith('commit;')
    body = body[:-len('commit;')]
    created, written = dryrun_names(body)
    prelude = ['create schema %s;' % schema]
    for tbl in sorted(written):
        prelude.append('create table %s.%s (like public.%s including all);' % (schema, tbl, tbl))
        prelude.append('insert into %s.%s select * from public.%s;' % (schema, tbl, tbl))
    out = '\n'.join(prelude) + '\n\n' + dryrun_rewrite(body, schema, created | written)
    # the prelude's own reads of public are "from public.x", never a target: check the rewritten body
    assert_no_live_target(dryrun_rewrite(body, schema, created | written))
    return out, created | written


if __name__ == '__main__':
    # --dryrun-body SCHEMA: the apply, re-pointed to a scratch schema (see above)
    # --dryrun-rewrite SCHEMA FILE: another SQL file re-pointed the same way (load SQL, report)
    if sys.argv[1:2] == ['--self-test']:
        # the live-target refusal must refuse, or a green dry run proves nothing
        for bad in ('alter table public.dc_entity_geography add column x int;',
                    'create or replace view public.dc_x as select 1;',
                    'insert into public.dc_identity_decision select 1;',
                    'create trigger t before update on public.dc_address_geocode for each row execute function f();',
                    'drop table public.dc_x;'):
            try:
                assert_no_live_target(bad)
            except SystemExit:
                continue
            raise SystemExit('SELF-TEST FAIL: not refused: ' + bad)
        assert_no_live_target('alter table dcdry.dc_entity_geography add column x int;\n'
                              'insert into dcdry.dc_identity_decision select * from public.dc_identity_decision;')
        print('SELF-TEST PASS: 5 live-object statements refused, scratch-schema statements accepted')
        sys.exit(0)
    if sys.argv[1:2] == ['--dryrun-body']:
        sys.stdout.write(dryrun_body(sys.argv[2])[0] + '\n')
        sys.exit(0)
    if sys.argv[1:2] == ['--dryrun-rewrite']:
        _, names = dryrun_body(sys.argv[2])
        out = dryrun_rewrite((ROOT / sys.argv[3]).read_text(), sys.argv[2], names)
        assert_no_live_target(out)
        sys.stdout.write(out)
        sys.exit(0)
    # --extract FILE PREFIX...: print the shipped statements of FILE whose text starts with a PREFIX,
    # so another suite can load one object from the DDL of record without keeping a copy of it.
    if sys.argv[1:2] == ['--extract']:
        sys.stdout.write('\n\n'.join(pick(sys.argv[2], sys.argv[3:])) + '\n')
        sys.exit(0)
    text = build()
    if '--body' in sys.argv:
        # the same statements WITHOUT their own begin/commit, for a caller that owns the transaction
        # (the production dry run applies them inside a transaction it always rolls back)
        body = text.replace('\nbegin;\n', '\n', 1)
        assert body.rstrip().endswith('commit;'), 'apply file shape changed'
        sys.stdout.write(body.rstrip()[:-len('commit;')] + '\n')
        sys.exit(0)
    if '--check' in sys.argv:
        ok = OUT.exists() and OUT.read_text() == text
        print('apply file is current' if ok else 'apply file is STALE: regenerate it'); sys.exit(0 if ok else 1)
    OUT.write_text(text)
    print(f'wrote {OUT.relative_to(ROOT)} ({len(text)} bytes, sha256 {hashlib.sha256(text.encode()).hexdigest()[:16]})')
