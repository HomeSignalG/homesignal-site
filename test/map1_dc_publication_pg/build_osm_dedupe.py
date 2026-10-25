#!/usr/bin/env python3
"""Generate the same-building artifacts FROM the DDL of record -- never retyped (claims rule 7).

Founder ruling 2026-10-23 ("b"): hide an OpenStreetMap pin when exactly one canonical pin drawn on the
same ZIP page lies within 150 m and names the same site (docs/map1-dc-publication.sql, header).

  docs/dc-osm-dedupe-apply.sql     add public.dc_names_same_site and the new Map 1 reader
  docs/dc-osm-dedupe-rollback.sql  restore the reader production carried before, drop the helper

The apply carries exactly the statements the ruling adds or changes, sliced out of the committed file by
#1324's dollar-quote-aware splitter (imported, not copied). Inside ONE transaction:
  1. a FAIL-CLOSED drift guard: the live reader must fingerprint to what production carried on
     2026-10-23 (md5(prosrc) 2146b68a...) and the helper must not exist yet, or nothing is applied;
  2. the statements;
  3. an in-transaction post-condition: the reader is the new body, the helper is the new body, anon can
     execute the reader and cannot execute the helper.

The rollback reader is DERIVED by reversing exactly the one edit to the reader body, and the derivation
is PROVEN: it must fingerprint to the pre-change production md5, or the builder refuses.
Run: python3 test/map1_dc_publication_pg/build_osm_dedupe.py [--check]
"""
import hashlib, importlib.util, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/dc-osm-dedupe-apply.sql'
OUT_ROLLBACK = ROOT / 'docs/dc-osm-dedupe-rollback.sql'
_spec = importlib.util.spec_from_file_location('epoch_apply', ROOT / 'test/dc_epoch_geography_pg/build_apply.py')
_epoch = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_epoch)
pick = _epoch.pick

MAP = 'docs/map1-dc-publication.sql'
# md5(prosrc) read on production 2026-10-23 (equal to the file at main@4e91e9d2)
MAP1_BEFORE = '2146b68afc2cda03948b1e1cd51b29b8'

HELPER = ['create or replace function public.dc_names_same_site(',
          'revoke all on function public.dc_names_same_site(text, text, text, text) from public',
          'revoke all on function public.dc_names_same_site(text, text, text, text) from anon',
          'comment on function public.dc_names_same_site(']
READER = ['create or replace function public.map1_dc_zip_members(',
          'revoke all on function public.map1_dc_zip_members(',
          'grant execute on function public.map1_dc_zip_members(',
          'comment on function public.map1_dc_zip_members(']

OLD_MEMBERS = """  members as (
    select * from judged where verdict = 'member' and zcta_hits <= 1
     order by source_key collate "C"
     limit (select n + 1 from lim)),"""
NEW_START = "  admitted as (select * from judged where verdict = 'member' and zcta_hits <= 1),"
NEW_END = """     order by a.source_key collate "C"
     limit (select n + 1 from lim)),"""


def body_md5(stmt, tag):
    m = re.search(r'\bas \$' + tag + r'\$(.*?)\$' + tag + r'\$', stmt, re.S)
    assert m, f'statement shape changed ({tag})'
    return hashlib.md5(m.group(1).encode()).hexdigest()


def statements():
    got = {}
    for p in HELPER + READER:
        s = pick(MAP, [p])
        assert len(s) == 1, f'{p}: {len(s)} statements'
        got[p] = s[0]
    return got


def fn_md5(name):
    return ("(select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n"
            f"        where n.nspname = 'public' and p.proname = '{name}')")


def block(name, map1_md5, helper_md5, message):
    helper = (f"  if to_regprocedure('public.dc_names_same_site(text,text,text,text)') is not null then bad := bad || ' (dc_names_same_site already exists)'; end if;"
              if helper_md5 is None else
              f"  if {fn_md5('dc_names_same_site')} is distinct from '{helper_md5}' then bad := bad || ' dc_names_same_site'; end if;\n"
              "  if has_function_privilege('anon', 'public.dc_names_same_site(text,text,text,text)', 'execute') then\n"
              "    bad := bad || ' (anon can execute dc_names_same_site)';\n"
              "  end if;")
    return "\n".join([
        f"do ${name}$",
        "declare bad text := '';",
        "begin",
        f"  if {fn_md5('map1_dc_zip_members')} is distinct from '{map1_md5}' then bad := bad || ' map1_dc_zip_members'; end if;",
        helper,
        "  if not has_function_privilege('anon', 'public.map1_dc_zip_members(text)', 'execute') then",
        "    bad := bad || ' (anon cannot execute the Map 1 reader)';",
        "  end if;",
        "  if bad <> '' then",
        f"    raise exception '{message}%', bad;",
        "  end if;",
        f"end ${name}$;"])


def post(b):
    return b.replace("raise exception 'POST-CONDITION failed:%', bad;",
                     "raise exception 'POST-CONDITION failed:%. Rolled back.', bad;")


def rollback_reader(rd):
    i, j = rd.find(NEW_START), rd.find(NEW_END)
    assert rd.count(NEW_START) == 1 and rd.count(NEW_END) == 1 and 0 <= i < j, 'reader shape changed'
    out = rd[:i] + OLD_MEMBERS + rd[j + len(NEW_END):]
    assert body_md5(out, 'function') == MAP1_BEFORE, 'rollback reader does not fingerprint to the pre-change body'
    return out


def build():
    s = statements()
    rollback_reader(s[READER[0]])   # proves the reversal before an apply is ever emitted
    map_after, helper_after = body_md5(s[READER[0]], 'function'), body_md5(s[HELPER[0]], 'fn')
    parts = ['-- GENERATED by test/map1_dc_publication_pg/build_osm_dedupe.py from the DDL of record. Do not edit.',
             '-- Founder ruling 2026-10-23: hide an OSM pin whose one canonical twin on the same ZIP page lies within',
             '-- 150 m and names the same site. No pin moves; OSM stays a separate layer.',
             '-- One transaction: drift guard, the helper, the Map 1 reader, in-transaction post-condition.',
             'begin;',
             block('guard', MAP1_BEFORE, None, 'DRIFT: production is not the 2026-10-23 state (or this change is already applied):'),
             '-- ===== docs/map1-dc-publication.sql: the same-site name rule =====',
             *[s[p] for p in HELPER],
             '-- ===== docs/map1-dc-publication.sql: the one data-centre reader =====',
             *[s[p] for p in READER],
             post(block('post', map_after, helper_after, 'POST-CONDITION failed:')),
             'commit;']
    return '\n\n'.join(parts) + '\n'


def build_rollback():
    s = statements()
    rd = rollback_reader(s[READER[0]])
    parts = ['-- GENERATED by test/map1_dc_publication_pg/build_osm_dedupe.py. Do not edit.',
             '-- ROLLBACK of the 2026-10-23 same-building rule: restore the Map 1 reader production carried before',
             '-- (proven to fingerprint to it) and drop the helper. Applied only by dc-osm-dedupe-apply.yml with',
             '-- confirm=ROLLBACK-OSM-DEDUPE.',
             'begin;',
             block('guard', body_md5(s[READER[0]], 'function'), body_md5(s[HELPER[0]], 'fn'),
                   'DRIFT: production does not carry the definitions this rollback reverses:'),
             rd, *[s[p] for p in READER[1:]],
             'drop function public.dc_names_same_site(text, text, text, text);',
             post(block('post', MAP1_BEFORE, None, 'POST-CONDITION failed:')),
             'commit;']
    return '\n\n'.join(parts) + '\n'


if __name__ == '__main__':
    outs = ((OUT, build()), (OUT_ROLLBACK, build_rollback()))
    if '--check' in sys.argv:
        stale = [o.name for o, t in outs if not (o.exists() and o.read_text() == t)]
        print('same-building apply + rollback files are current' if not stale else f'STALE: regenerate {stale}')
        sys.exit(1 if stale else 0)
    for o, t in outs:
        o.write_text(t)
        print(f'wrote {o.relative_to(ROOT)} ({len(t)} bytes, sha256 {hashlib.sha256(t.encode()).hexdigest()})')
