#!/usr/bin/env python3
"""Generate the C7 artifacts FROM the DDL of record -- never retyped (claims rule 7).

  docs/dc-verdict-apply.sql     the tightened derived-point verdict
  docs/dc-verdict-rollback.sql  the verdict production carried before C7 (tested offline)

C7 changes ONE shared decision, dc_derived_point_verdict (+ its comment), sliced out of the committed
file by #1324's own dollar-quote-aware splitter (imported, not copied). Two new rejections:
  * the matched street DIRECTION contradicts the queried one (300 S Fish Lake Rd is not 300 N);
  * the query has no house number ('31st Avenue East' -- '31' is part of the street name).
Inside ONE transaction:
  1. a FAIL-CLOSED drift guard: the live verdict, switch and Map 1 reader must fingerprint to what
     production carried before C7 (md5(prosrc) read on production 2026-09-27), or nothing is applied;
  2. the statements;
  3. an in-transaction post-condition: the verdict is the new body, and it rejects a direction
     contradiction and an ordinal-led query while still accepting the agreeing control.

The rollback is DERIVED by removing exactly the C7 edits from the DDL of record, and the derivation is
PROVEN: the rebuilt body must fingerprint to the pre-C7 production md5, or the builder refuses.
Run: python3 test/dc_verdict_pg/build_verdict.py [--check]
"""
import hashlib, importlib.util, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/dc-verdict-apply.sql'
OUT_ROLLBACK = ROOT / 'docs/dc-verdict-rollback.sql'
_spec = importlib.util.spec_from_file_location('epoch_apply', ROOT / 'test/dc_epoch_geography_pg/build_apply.py')
_epoch = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_epoch)
pick = _epoch.pick

D3 = 'docs/dc-step3d-derived-location.sql'
# md5(prosrc) read on production 2026-09-27 ~01:05 UTC (after C3c)
VERDICT_BEFORE = '4cd5b97def7d6179900cd95ec452d9a7'
SWITCH_LIVE = '2c05d65aba736fab7c79199e78614ab6'   # unchanged by C7; guarded so C3c is proven live
MAP1_LIVE = '2146b68afc2cda03948b1e1cd51b29b8'     # unchanged by C7

VERDICT = ['create or replace function public.dc_derived_point_verdict(',
           'comment on function public.dc_derived_point_verdict(']

VERDICT_EDITS = [
    ("""    -- a house number is digits (one optional letter) and then a space: '31st Avenue' carries none
    q_no text := substring(coalesce(p_query, '') from '^(\\d+)[A-Za-z]?\\s');
    m_no text := substring(coalesce(p_matched, '') from '^(\\d+)[A-Za-z]?\\s');
    -- the street's leading direction, as its first letter (North/N -> N): 300 S Fish Lake Rd is not 300 N
    q_dir text := upper(left(substring(coalesce(p_query, '') from '(?i)^\\d+[A-Za-z]?\\s+(north|south|east|west|n|s|e|w)\\M'), 1));
    m_dir text := upper(left(substring(coalesce(p_matched, '') from '(?i)^\\d+[A-Za-z]?\\s+(north|south|east|west|n|s|e|w)\\M'), 1));
""", """    q_no text := substring(coalesce(p_query, '') from '^(\\d+)');
    m_no text := substring(coalesce(p_matched, '') from '^(\\d+)');
"""),
    ("""    elsif q_dir is not null and m_dir is not null and q_dir <> m_dir then
        return query select 'REJECTED_MATCH_DIVERGES'::text, null::double precision,
            'matched street direction ' || m_dir || ' is not the queried ' || q_dir;
""", ""),
]
COMMENT_EDIT = ("""ambiguous or divergent matches (house number, street direction, state) never become a site.
ACCEPTED carries the calibrated 2,000 m""", """ambiguous or divergent matches never become a site. ACCEPTED carries the calibrated 2,000 m""")


def body_md5(stmt):
    m = re.search(r'\bas \$fn\$(.*?)\$fn\$', stmt, re.S)
    assert m, 'statement shape changed'
    return hashlib.md5(m.group(1).encode()).hexdigest()


def statements():
    got = {}
    for p in VERDICT:
        s = pick(D3, [p])
        assert len(s) == 1, f'{p}: {len(s)} statements'
        got[p] = s[0]
    return got


def fn_md5(name):
    return ("(select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n"
            f"        where n.nspname = 'public' and p.proname = '{name}')")


def v(q, m):
    return (f"(select verdict from public.dc_derived_point_verdict('range_interpolated', 1, '{q}', '{m}', 40.0, -90.0))")


def behaviour(new):
    """The C7 behaviour in one place: after the apply the two rejections hold; before (and after a
    rollback) both cases are ACCEPTED. The agreeing control must be ACCEPTED either way."""
    want = "'REJECTED_MATCH_DIVERGES'" if new else "'ACCEPTED'"
    return "\n".join([
        f"  if {v('300 S Test Road, Testville, IL 60073', '300 N TEST RD, TESTVILLE, IL, 60073')} is distinct from {want} then bad := bad || ' (direction case)'; end if;",
        f"  if {v('31st Avenue East, Testville, WI 54880', '31 E AVE, TESTVILLE, WI, 54880')} is distinct from {want} then bad := bad || ' (ordinal case)'; end if;",
        f"  if {v('300 S Test Road, Testville, IL 60073', '300 S TEST RD, TESTVILLE, IL, 60073')} is distinct from 'ACCEPTED' then bad := bad || ' (agreeing control)'; end if;"])


def block(name, verdict_md5, new, message):
    return "\n".join([
        f"do ${name}$",
        "declare bad text := '';",
        "begin",
        f"  if {fn_md5('dc_derived_point_verdict')} is distinct from '{verdict_md5}' then bad := bad || ' dc_derived_point_verdict'; end if;",
        f"  if {fn_md5('dc_derived_address_admitted')} is distinct from '{SWITCH_LIVE}' then bad := bad || ' dc_derived_address_admitted'; end if;",
        f"  if {fn_md5('map1_dc_zip_members')} is distinct from '{MAP1_LIVE}' then bad := bad || ' map1_dc_zip_members'; end if;",
        behaviour(new),
        "  if bad <> '' then",
        f"    raise exception '{message}%', bad;",
        "  end if;",
        f"end ${name}$;"])


def post(block_text):
    return block_text.replace("raise exception 'POST-CONDITION failed:%', bad;",
                              "raise exception 'POST-CONDITION failed:%. Rolled back.', bad;")


def build():
    s = statements()
    after = body_md5(s[VERDICT[0]])
    assert after != VERDICT_BEFORE, 'the DDL of record does not carry the C7 verdict'
    parts = ['-- GENERATED by test/dc_verdict_pg/build_verdict.py from the DDL of record. Do not edit.',
             '-- C7: the shared derived-point verdict also rejects a match whose street direction contradicts the',
             '-- query, and a query with no house number. Views read it live; canonical placements follow at the',
             '-- next dc_resolve_geography run. No pin is moved by this statement.',
             'begin;',
             block('guard', VERDICT_BEFORE, False, 'DRIFT: production is not the pre-C7 state (or C7 is already applied):'),
             '-- ===== STEP 3D  docs/dc-step3d-derived-location.sql (the derived-point verdict) =====',
             s[VERDICT[0]], s[VERDICT[1]],
             post(block('post', after, True, 'POST-CONDITION failed:')),
             'commit;']
    return '\n\n'.join(parts) + '\n'


def build_rollback():
    s = statements()
    fn = s[VERDICT[0]]
    for new, old in VERDICT_EDITS:
        assert fn.count(new) == 1, 'verdict shape changed'
        fn = fn.replace(new, old)
    assert body_md5(fn) == VERDICT_BEFORE, 'rollback verdict does not fingerprint to the pre-C7 body'
    cm = s[VERDICT[1]]
    assert cm.count(COMMENT_EDIT[0]) == 1, 'comment shape changed'
    cm = cm.replace(*COMMENT_EDIT)
    parts = ['-- GENERATED by test/dc_verdict_pg/build_verdict.py. Do not edit.',
             '-- C7 ROLLBACK: restore the derived-point verdict production carried before C7 (proven to',
             '-- fingerprint to it). Applied only by dc-verdict-apply.yml with confirm=ROLLBACK-VERDICT-C7.',
             'begin;',
             block('guard', body_md5(s[VERDICT[0]]), True, 'DRIFT: production does not carry the C7 verdict this rollback reverses:'),
             fn, cm,
             post(block('post', VERDICT_BEFORE, False, 'POST-CONDITION failed:')),
             'commit;']
    return '\n\n'.join(parts) + '\n'


if __name__ == '__main__':
    outs = ((OUT, build()), (OUT_ROLLBACK, build_rollback()))
    if '--check' in sys.argv:
        stale = [o.name for o, t in outs if not (o.exists() and o.read_text() == t)]
        print('C7 apply + rollback files are current' if not stale else f'STALE: regenerate {stale}')
        sys.exit(1 if stale else 0)
    for o, t in outs:
        o.write_text(t)
        print(f'wrote {o.relative_to(ROOT)} ({len(t)} bytes, sha256 {hashlib.sha256(t.encode()).hexdigest()})')
