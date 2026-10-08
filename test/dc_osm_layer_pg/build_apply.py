#!/usr/bin/env python3
"""Generate the OSM LAYER ADDRESS CHECK artifacts FROM the DDL of record -- never retyped (claims rule 7).

  docs/dc-osm-layer-apply.sql     add the OpenStreetMap layer's address check (C3a)
  docs/dc-osm-layer-rollback.sql  remove it again (tested offline, applied only on explicit dispatch)

The apply carries exactly the objects C3a changes, sliced out of the committed files by #1324's own
dollar-quote-aware splitter (imported, not copied):
  Step 3D  dc_publisher_stated_address (the OSM extraction branch), dc_osm_derived_point (new),
           dc_geocode_queue (now also reads the OSM layer)
  Step 3B  dc_osm_address_check (new)
Inside ONE transaction:
  1. a FAIL-CLOSED drift guard: every function this chain reads or replaces must still fingerprint to
     main@800b9a3 -- md5(prosrc) measured on production 2026-09-26 AND reproduced from that commit's
     DDL of record, all eight identical -- dc_geocode_queue must still be the pre-C3a view
     (md5(pg_get_viewdef) read on production), and neither OSM view may exist;
  2. the statements;
  3. an in-transaction post-condition: the extraction is the new body, OSM is NOT admitted, nothing
     else changed, both views exist and are unreadable by anon/authenticated.
Nothing adds, alters or drops a table, and the Map 1 reader is untouched.

The rollback is the same shape in reverse. Its statements are DERIVED from the DDL of record by
removing exactly the C3a additions (the OSM extraction block, the queue's OSM branch), and the
derivation is proven, not assumed: the rebuilt extraction must fingerprint to the pre-C3a prosrc md5,
and the rollback's post-condition requires the queue's viewdef md5 to be the pre-C3a one again.
Run: python3 test/dc_osm_layer_pg/build_apply.py [--check]
"""
import hashlib, importlib.util, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/dc-osm-layer-apply.sql'
OUT_ROLLBACK = ROOT / 'docs/dc-osm-layer-rollback.sql'
_spec = importlib.util.spec_from_file_location('epoch_apply', ROOT / 'test/dc_epoch_geography_pg/build_apply.py')
_epoch = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_epoch)
pick = _epoch.pick

D3 = 'docs/dc-step3d-derived-location.sql'
B3 = 'docs/dc-step3b-canonical-geography.sql'
# md5(prosrc), production 2026-09-26 == main@800b9a3's DDL of record (reproduced locally, all eight)
UNCHANGED = {
    'dc_derived_address_admitted': '31cb6c9e7481311ab33042a8845c9276',
    'dc_derived_point_verdict': '4cd5b97def7d6179900cd95ec452d9a7',
    'dc_geocodable_site_address': 'a5c2ef9940d63bc55dceeede44e28f95',
    'dc_geocode_input': '655ff9b7ade2234745669dae8d146bcf',
    'dc_geocode_ladder_version': 'cd0165b7560115198833980a6795b701',
    'dc_site_claims_conflict': '33d7d5e99f4cae4883e843e22bfd03da',
    'map1_dc_zip_members': '9fc1c9f51375f25db5658a14ca36937c',
}
EXTRACT_BEFORE = '83675b5b646487fe1cc70041749232f5'
QUEUE_VIEWDEF_BEFORE = '4a52710c5a8b9cdb140314746896bfc3'   # md5(pg_get_viewdef), production 2026-09-26

EXTRACT_FN = 'create or replace function public.dc_publisher_stated_address('
EXTRACT_CM = 'comment on function public.dc_publisher_stated_address('
QUEUE = ['create or replace view public.dc_geocode_queue', 'revoke all on public.dc_geocode_queue',
         'comment on view public.dc_geocode_queue']
ACQ = ['create or replace view public.dc_osm_derived_point', 'revoke all on public.dc_osm_derived_point',
       'comment on view public.dc_osm_derived_point']
CHK = ['create or replace view public.dc_osm_address_check', 'revoke all on public.dc_osm_address_check',
       'comment on view public.dc_osm_address_check']

OSM_BLOCK_START = "    -- OpenStreetMap (telecom=data_center), the SEPARATE ODbL layer"
OSM_BLOCK_END = "        return;\n    end if;\n    return query select 'NO_RULE'::text"
QUEUE_AFTER = """select q.geocoder_query, public.dc_geocode_ladder_version() as ladder_version,
       bool_or(q.admitted) as admitted
  from (select p.geocoder_query, p.admitted
          from public.dc_observation_derived_point p
         where p.input_quality = 'GEOCODABLE'
           and p.derivation_id is null
        union all
        select o.geocoder_query, o.admitted
          from public.dc_osm_derived_point o
         where o.map_eligible
           and o.input_quality = 'GEOCODABLE'
           and o.derivation_id is null) q
 group by q.geocoder_query;"""
QUEUE_BEFORE = """select p.geocoder_query, public.dc_geocode_ladder_version() as ladder_version,
       bool_or(p.admitted) as admitted
  from public.dc_observation_derived_point p
 where p.input_quality = 'GEOCODABLE'
   and p.derivation_id is null
 group by p.geocoder_query;"""


def prosrc_md5(stmt):
    m = re.search(r'\bas \$fn\$(.*?)\$fn\$;', stmt, re.S)
    assert m, 'extraction statement shape changed'
    return hashlib.md5(m.group(1).encode()).hexdigest()


def statements():
    d3 = {p: pick(D3, [p]) for p in [EXTRACT_FN, EXTRACT_CM] + ACQ + QUEUE}
    b3 = {p: pick(B3, [p]) for p in CHK}
    for k, v in {**d3, **b3}.items():
        assert len(v) == 1, f'{k}: {len(v)} statements'
    return {k: v[0] for k, v in {**d3, **b3}.items()}


def fingerprints_sql(fns):
    return "(values " + ", ".join(f"('{k}', '{v}')" for k, v in sorted(fns.items())) + ")"


def fn_md5_expr():
    return ("(select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n"
            "         where n.nspname = 'public' and p.proname = r.fn)")


def one_fn_md5(name):
    return ("(select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n"
            f"        where n.nspname = 'public' and p.proname = '{name}')")


def queue_md5():
    return "md5(pg_get_viewdef('public.dc_geocode_queue'::regclass))"


def guard(name, extract_md5, views_exist, queue_before, message):
    fns = dict(UNCHANGED, dc_publisher_stated_address=extract_md5)
    views = "exists" if views_exist else "not exists"
    lines = [f"do ${name}$",
             "declare r record; bad text := '';",
             "begin",
             f"  for r in select * from {fingerprints_sql(fns)} x(fn, want) loop",
             f"    if {fn_md5_expr()} is distinct from r.want then bad := bad || ' ' || r.fn; end if;",
             "  end loop;",
             f"  if {'not ' if views_exist else ''}(to_regclass('public.dc_osm_derived_point') is not null",
             f"      {'and' if views_exist else 'or'} to_regclass('public.dc_osm_address_check') is not null) then",
             f"    bad := bad || ' (the OSM views: expected {views})';",
             "  end if;"]
    if queue_before:
        lines += [f"  if {queue_md5()} is distinct from '{QUEUE_VIEWDEF_BEFORE}' then",
                  "    bad := bad || ' dc_geocode_queue';",
                  "  end if;"]
    lines += ["  if bad <> '' then",
              f"    raise exception '{message}%', bad;",
              "  end if;",
              f"end ${name}$;"]
    return "\n".join(lines)


def post(extract_md5, views_exist, queue_before):
    lines = ["do $post$",
             "declare r record; bad text := '';",
             "begin",
             f"  for r in select * from {fingerprints_sql(dict(UNCHANGED, dc_publisher_stated_address=extract_md5))} x(fn, want) loop",
             f"    if {fn_md5_expr()} is distinct from r.want then bad := bad || ' ' || r.fn; end if;",
             "  end loop;",
             "  if public.dc_derived_address_admitted('openstreetmap', 'telecom_data_center')",
             "     or not public.dc_derived_address_admitted('compute_atlas', 'facilities')",
             "     or not public.dc_derived_address_admitted('epoch_ai', 'data_centers') then",
             "    bad := bad || ' (admission)';",
             "  end if;"]
    if views_exist:
        lines += ["  if to_regclass('public.dc_osm_derived_point') is null or to_regclass('public.dc_osm_address_check') is null",
                  "     or has_table_privilege('anon', 'public.dc_osm_derived_point', 'select')",
                  "     or has_table_privilege('authenticated', 'public.dc_osm_derived_point', 'select')",
                  "     or has_table_privilege('anon', 'public.dc_osm_address_check', 'select')",
                  "     or has_table_privilege('authenticated', 'public.dc_osm_address_check', 'select') then",
                  "    bad := bad || ' (OSM views missing or public)';",
                  "  end if;"]
    else:
        lines += ["  if to_regclass('public.dc_osm_derived_point') is not null or to_regclass('public.dc_osm_address_check') is not null then",
                  "    bad := bad || ' (OSM views still present)';",
                  "  end if;"]
    if queue_before:
        lines += [f"  if {queue_md5()} is distinct from '{QUEUE_VIEWDEF_BEFORE}' then",
                  "    bad := bad || ' (dc_geocode_queue is not the pre-C3a view)';",
                  "  end if;"]
    lines += ["  if bad <> '' then",
              "    raise exception 'POST-CONDITION failed:%. Rolled back.', bad;",
              "  end if;",
              "end $post$;"]
    return "\n".join(lines)


def build():
    s = statements()
    extract_after = prosrc_md5(s[EXTRACT_FN])
    parts = ['-- GENERATED by test/dc_osm_layer_pg/build_apply.py from the DDL of record. Do not edit.',
             '-- C3a: the OpenStreetMap layer\'s address check (separate layer; OSM NOT admitted; Map 1 untouched).',
             '-- One transaction: drift guard, the changed Step 3D and 3B objects in dependency order, post-condition.',
             'begin;',
             guard('guard', EXTRACT_BEFORE, False, True,
                   'DRIFT: production no longer matches main@800b9a3 (or C3a is already applied):'),
             '-- ===== STEP 3D  docs/dc-step3d-derived-location.sql (changed objects) =====',
             s[EXTRACT_FN], s[EXTRACT_CM], *[s[k] for k in ACQ], *[s[k] for k in QUEUE],
             '-- ===== STEP 3B  docs/dc-step3b-canonical-geography.sql (new object) =====',
             *[s[k] for k in CHK],
             post(extract_after, True, False),
             'commit;']
    return '\n\n'.join(parts) + '\n'


def build_rollback():
    s = statements()
    fn = s[EXTRACT_FN]
    a = fn.index(OSM_BLOCK_START)
    b = fn.index(OSM_BLOCK_END, a) + len("        return;\n    end if;\n")
    fn_before = fn[:a] + fn[b:]
    assert prosrc_md5(fn_before) == EXTRACT_BEFORE, 'rollback extraction does not fingerprint to the pre-C3a body'
    q = s[QUEUE[0]]
    assert q.count(QUEUE_AFTER) == 1, 'queue shape changed'
    q_before = q.replace(QUEUE_AFTER, QUEUE_BEFORE)
    parts = ['-- GENERATED by test/dc_osm_layer_pg/build_apply.py. Do not edit.',
             '-- C3a ROLLBACK: remove the OpenStreetMap layer\'s address check, restoring the pre-C3a',
             '-- extraction and queue. Tested offline; applied only by dc-osm-layer-apply.yml with',
             '-- confirm=ROLLBACK-OSM-LAYER-C3A. Derivations already in dc_address_geocode are left in place',
             '-- (append-only evidence; nothing reads an OSM query once the views are gone).',
             'begin;',
             guard('guard', prosrc_md5(fn), True, False,
                   'DRIFT: production does not carry the C3a objects this rollback removes:'),
             'drop view public.dc_osm_address_check;',
             q_before,
             'drop view public.dc_osm_derived_point;',
             fn_before,
             post(EXTRACT_BEFORE, False, True),
             'commit;']
    return '\n\n'.join(parts) + '\n'


# ⛔ FROZEN 2026-09-26: the C3a apply was APPLIED to production (run 36274352481) from main@e647a09.
# C3c then moved the admission switch and the Map 1 reader in the DDL of record, so regenerating
# would rewrite history. --check verifies the FROZEN bytes; the offline proof runs pinned to
# e647a09 (.github/workflows/dc-osm-layer-apply.yml).
FROZEN = {OUT: '0501b6ae9d7fa9b856d752815088d58df2c16fbba187d708bf3b0a66853abd35',
          OUT_ROLLBACK: 'ab80519957309d9a6aff664a1913f1d1709ea51bafaf7bdda067b3d495018d17'}


if __name__ == '__main__':
    if '--check' in sys.argv and '--regenerate-at-applied-commit' not in sys.argv:
        bad = [o.name for o, want in FROZEN.items()
               if not o.exists() or hashlib.sha256(o.read_bytes()).hexdigest() != want]
        print('OSM layer apply + rollback files are the frozen applied artifacts' if not bad
              else f'NOT the frozen applied artifacts: {bad}')
        sys.exit(1 if bad else 0)
    if '--regenerate-at-applied-commit' not in sys.argv:
        raise SystemExit('REFUSED: the C3a artifacts are frozen (applied to production); they are never regenerated')
    outs = ((OUT, build()), (OUT_ROLLBACK, build_rollback()))
    if '--check' in sys.argv:
        stale = [o.name for o, t in outs if not (o.exists() and o.read_text() == t)]
        print('OSM layer apply + rollback files are current' if not stale else f'STALE: regenerate {stale}')
        sys.exit(1 if stale else 0)
    for o, t in outs:
        o.write_text(t)
        print(f'wrote {o.relative_to(ROOT)} ({len(t)} bytes, sha256 {hashlib.sha256(t.encode()).hexdigest()})')
