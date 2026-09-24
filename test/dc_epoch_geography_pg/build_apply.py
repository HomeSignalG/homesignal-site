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


if __name__ == '__main__':
    # --extract FILE PREFIX...: print the shipped statements of FILE whose text starts with a PREFIX,
    # so another suite can load one object from the DDL of record without keeping a copy of it.
    if sys.argv[1:2] == ['--extract']:
        sys.stdout.write('\n\n'.join(pick(sys.argv[2], sys.argv[3:])) + '\n')
        sys.exit(0)
    text = build()
    if '--check' in sys.argv:
        ok = OUT.exists() and OUT.read_text() == text
        print('apply file is current' if ok else 'apply file is STALE: regenerate it'); sys.exit(0 if ok else 1)
    OUT.write_text(text)
    print(f'wrote {OUT.relative_to(ROOT)} ({len(text)} bytes, sha256 {hashlib.sha256(text.encode()).hexdigest()[:16]})')
