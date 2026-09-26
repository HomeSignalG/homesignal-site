#!/usr/bin/env python3
"""Generate the C3c artifacts FROM the DDL of record -- never retyped (claims rule 7).

  docs/dc-osm-map1-apply.sql     admit the OSM layer check and let Map 1 act on it
  docs/dc-osm-map1-rollback.sql  withdraw both again (tested offline)

The apply carries exactly the statements C3c changes, sliced out of the committed files by #1324's own
dollar-quote-aware splitter (imported, not copied):
  Step 3D  dc_derived_address_admitted (+ comment): ('openstreetmap', 'telecom_data_center') added
  Map 1    map1_dc_zip_members (+ its revoke / grant / comment): the OSM CTE reads dc_osm_address_check
Inside ONE transaction:
  1. a FAIL-CLOSED drift guard: the live switch, the live Map 1 reader and the live OSM extraction must
     fingerprint to what production carried after C3a (md5(prosrc) read on production 2026-09-26),
     and both OSM views must exist, or nothing is applied;
  2. the statements;
  3. an in-transaction post-condition: exactly Epoch, Atlas and OSM admitted, the reader is the new
     body, and anon can still execute it.

The rollback is DERIVED by removing exactly the C3c edits from the DDL of record, and the derivation is
PROVEN: both rebuilt bodies must fingerprint to the pre-C3c production md5s, or the builder refuses.
Run: python3 test/dc_osm_layer_pg/build_map1.py [--check]
"""
import hashlib, importlib.util, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/dc-osm-map1-apply.sql'
OUT_ROLLBACK = ROOT / 'docs/dc-osm-map1-rollback.sql'
_spec = importlib.util.spec_from_file_location('epoch_apply', ROOT / 'test/dc_epoch_geography_pg/build_apply.py')
_epoch = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_epoch)
pick = _epoch.pick

D3 = 'docs/dc-step3d-derived-location.sql'
MAP = 'docs/map1-dc-publication.sql'
# md5(prosrc) read on production 2026-09-26 22:26 UTC, after C3a (run 36274352481)
SWITCH_BEFORE = '31cb6c9e7481311ab33042a8845c9276'
MAP1_BEFORE = '9fc1c9f51375f25db5658a14ca36937c'
EXTRACT_LIVE = '7605c217d2d4d4fb0e36cff42015b0f1'   # unchanged by C3c; guarded so C3a is proven live

SWITCH = ['create or replace function public.dc_derived_address_admitted(',
          'comment on function public.dc_derived_address_admitted(']
READER = ['create or replace function public.map1_dc_zip_members(',
          'revoke all on function public.map1_dc_zip_members(',
          'grant execute on function public.map1_dc_zip_members(',
          'comment on function public.map1_dc_zip_members(']

OSM_TUPLE = ", ('openstreetmap', 'telecom_data_center')"
READER_EDITS = [
    ("""           'legacy_osm_compat'::text as publication_basis,
           case when k.admitted and k.check_outcome = 'CORROBORATED'
                then array['CORROBORATED_BY_DERIVED_ADDRESS']::text[] else '{}'::text[] end as quality_flags,
""", """           'legacy_osm_compat'::text as publication_basis, '{}'::text[] as quality_flags,
"""),
    ("""      join lifecycle lc on lc.v = r.normalized_status
      left join public.dc_osm_address_check k on k.osm_record_id = r.id
     where r.map_eligible
       and not (coalesce(k.admitted, false) and k.check_outcome = 'SOURCES_DISAGREE')),""",
     """      join lifecycle lc on lc.v = r.normalized_status
     where r.map_eligible),"""),
]


def body_md5(stmt, tag):
    m = re.search(r'\bas \$' + tag + r'\$(.*?)\$' + tag + r'\$', stmt, re.S)
    assert m, f'statement shape changed ({tag})'
    return hashlib.md5(m.group(1).encode()).hexdigest()


def statements():
    got = {}
    for path, preds in ((D3, SWITCH), (MAP, READER)):
        for p in preds:
            s = pick(path, [p])
            assert len(s) == 1, f'{p}: {len(s)} statements'
            got[p] = s[0]
    return got


def fn_md5(name):
    return ("(select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n"
            f"        where n.nspname = 'public' and p.proname = '{name}')")


def admits(osm):
    return (f"  if {'not ' if osm else ''}public.dc_derived_address_admitted('openstreetmap', 'telecom_data_center')\n"
            "     or not public.dc_derived_address_admitted('compute_atlas', 'facilities')\n"
            "     or not public.dc_derived_address_admitted('epoch_ai', 'data_centers')\n"
            "     or public.dc_derived_address_admitted('openstreetmap', 'other')\n"
            "     or public.dc_derived_address_admitted('some_new_source', 'facilities') then\n"
            "    bad := bad || ' (admission)';\n"
            "  end if;")


def block(name, switch_md5, map1_md5, osm_admitted, message):
    return "\n".join([
        f"do ${name}$",
        "declare bad text := '';",
        "begin",
        f"  if {fn_md5('dc_derived_address_admitted')} is distinct from '{switch_md5}' then bad := bad || ' dc_derived_address_admitted'; end if;",
        f"  if {fn_md5('map1_dc_zip_members')} is distinct from '{map1_md5}' then bad := bad || ' map1_dc_zip_members'; end if;",
        f"  if {fn_md5('dc_publisher_stated_address')} is distinct from '{EXTRACT_LIVE}' then bad := bad || ' dc_publisher_stated_address'; end if;",
        "  if to_regclass('public.dc_osm_derived_point') is null or to_regclass('public.dc_osm_address_check') is null then",
        "    bad := bad || ' (the C3a OSM views are missing)';",
        "  end if;",
        admits(osm_admitted),
        "  if not has_function_privilege('anon', 'public.map1_dc_zip_members(text)', 'execute') then",
        "    bad := bad || ' (anon cannot execute the Map 1 reader)';",
        "  end if;",
        "  if bad <> '' then",
        f"    raise exception '{message}%', bad;",
        "  end if;",
        f"end ${name}$;"])


def build():
    s = statements()
    sw_after, map_after = body_md5(s[SWITCH[0]], ''), body_md5(s[READER[0]], 'function')
    parts = ['-- GENERATED by test/dc_osm_layer_pg/build_map1.py from the DDL of record. Do not edit.',
             '-- C3c: admit the OpenStreetMap layer check; Map 1 withholds an OSM pin its own address contradicts',
             '-- and flags one it corroborates. No pin moves; OSM stays a separate layer.',
             '-- One transaction: drift guard, the switch, the Map 1 reader, in-transaction post-condition.',
             'begin;',
             block('guard', SWITCH_BEFORE, MAP1_BEFORE, False,
                   'DRIFT: production is not the post-C3a state (or C3c is already applied):'),
             '-- ===== STEP 3D  docs/dc-step3d-derived-location.sql (the admission switch) =====',
             s[SWITCH[0]], s[SWITCH[1]],
             '-- ===== MAP 1  docs/map1-dc-publication.sql (the one data-centre reader) =====',
             *[s[p] for p in READER],
             block('post', sw_after, map_after, True, 'POST-CONDITION failed:').replace(
                 "raise exception 'POST-CONDITION failed:%', bad;", "raise exception 'POST-CONDITION failed:%. Rolled back.', bad;"),
             'commit;']
    return '\n\n'.join(parts) + '\n'


def build_rollback():
    s = statements()
    sw = s[SWITCH[0]]
    assert sw.count(OSM_TUPLE) == 1, 'switch shape changed'
    sw_before = sw.replace(OSM_TUPLE, '')
    assert body_md5(sw_before, '') == SWITCH_BEFORE, 'rollback switch does not fingerprint to the pre-C3c body'
    rd = s[READER[0]]
    for new, old in READER_EDITS:
        assert rd.count(new) == 1, 'reader shape changed'
        rd = rd.replace(new, old)
    assert body_md5(rd, 'function') == MAP1_BEFORE, 'rollback reader does not fingerprint to the pre-C3c body'
    parts = ['-- GENERATED by test/dc_osm_layer_pg/build_map1.py. Do not edit.',
             '-- C3c ROLLBACK: withdraw the OSM layer check from the admission switch and restore the pre-C3c',
             '-- Map 1 reader (both bodies proven to fingerprint to production before C3c). Applied only by',
             '-- dc-osm-map1-apply.yml with confirm=ROLLBACK-OSM-MAP1-C3C.',
             'begin;',
             block('guard', body_md5(sw, ''), body_md5(s[READER[0]], 'function'), True,
                   'DRIFT: production does not carry the C3c definitions this rollback reverses:'),
             sw_before, s[SWITCH[1]], rd, *[s[p] for p in READER[1:]],
             block('post', SWITCH_BEFORE, MAP1_BEFORE, False, 'POST-CONDITION failed:').replace(
                 "raise exception 'POST-CONDITION failed:%', bad;", "raise exception 'POST-CONDITION failed:%. Rolled back.', bad;"),
             'commit;']
    return '\n\n'.join(parts) + '\n'


if __name__ == '__main__':
    outs = ((OUT, build()), (OUT_ROLLBACK, build_rollback()))
    if '--check' in sys.argv:
        stale = [o.name for o, t in outs if not (o.exists() and o.read_text() == t)]
        print('C3c apply + rollback files are current' if not stale else f'STALE: regenerate {stale}')
        sys.exit(1 if stale else 0)
    for o, t in outs:
        o.write_text(t)
        print(f'wrote {o.relative_to(ROOT)} ({len(t)} bytes, sha256 {hashlib.sha256(t.encode()).hexdigest()})')
