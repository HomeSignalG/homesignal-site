#!/usr/bin/env python3
"""Generate docs/dc-atlas-validation-apply.sql FROM the DDL of record -- never retyped (claims rule 7).

PHASE A of Atlas coordinate validation: evidence ACQUISITION only. The apply carries exactly the
objects this change alters, sliced out of the committed files by #1324's own dollar-quote-aware
statement splitter (imported, not copied):
  Step 3D  extraction / policy / composition / admission gate, the derived-point view, the queue
  Step 3A  the identity candidate view (K3 reads only admitted derivations)
  Step 3B  the geography evidence view, the resolver (rule_version 5)
It adds no table, alters no table, and does not touch the Map 1 reader. Atlas is NOT admitted by
it: Atlas derivations are queued, derived and stored, and change no decision until a reviewed edit
of dc_derived_address_admitted.

It opens with a FAIL-CLOSED drift guard: the live bodies of the functions this chain reads or
replaces must still fingerprint to main@f9d1326 (#1324, measured on production 2026-09-25), and the
functions this apply introduces must not exist yet, or NOTHING is applied.
Run: python3 test/dc_atlas_validation_pg/build_apply.py [--check]
"""
import hashlib, importlib.util, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/dc-atlas-validation-apply.sql'
_spec = importlib.util.spec_from_file_location('epoch_apply', ROOT / 'test/dc_epoch_geography_pg/build_apply.py')
_epoch = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_epoch)
pick = _epoch.pick

# md5(prosrc) of the live functions, measured on production 2026-09-25 AND reproduced locally from
# main@f9d1326's DDL of record: byte-identical, all seven.
EXPECT_LIVE = {
    'dc_adjudicate_pair': '3918d905e8eaad3ced272ab02c88b9aa',
    'dc_derived_point_verdict': '4cd5b97def7d6179900cd95ec452d9a7',
    'dc_geocode_input': '23695d57dae07ca5d2203a562dbb1fdd',
    'dc_resolve_canonical': 'ba2a7505919bdb8c07f462ca42b84974',
    'dc_resolve_geography': 'd9a80300c6f982ef30851aeac810abfc',
    'dc_site_claims_conflict': '33d7d5e99f4cae4883e843e22bfd03da',
    'map1_dc_zip_members': '9fc1c9f51375f25db5658a14ca36937c',
}
MUST_NOT_EXIST = ['dc_publisher_stated_address', 'dc_geocodable_site_address', 'dc_derived_address_admitted']


def build():
    d3 = pick('docs/dc-step3d-derived-location.sql', [
        'create or replace function public.dc_publisher_stated_address(',
        'comment on function public.dc_publisher_stated_address(',
        'create or replace function public.dc_geocodable_site_address(',
        'comment on function public.dc_geocodable_site_address(',
        'create or replace function public.dc_geocode_input(',
        'comment on function public.dc_geocode_input(',
        'create or replace function public.dc_derived_address_admitted(',
        'comment on function public.dc_derived_address_admitted(',
        'create or replace view public.dc_observation_derived_point',
        'revoke all on public.dc_observation_derived_point',
        'comment on view public.dc_observation_derived_point',
        'create or replace view public.dc_geocode_queue',
        'revoke all on public.dc_geocode_queue',
        'comment on view public.dc_geocode_queue',
    ])
    a3 = pick('docs/dc-step3a-canonical-identity.sql', [
        'create or replace view public.dc_identity_candidate',
        'comment on view public.dc_identity_candidate',
        'revoke all on public.dc_identity_candidate',
    ])
    b3 = pick('docs/dc-step3b-canonical-geography.sql', [
        'create or replace view public.dc_entity_geography_evidence',
        'revoke all on public.dc_entity_geography_evidence',
        'comment on view public.dc_entity_geography_evidence',
        'create or replace function public.dc_resolve_geography(',
        'comment on function public.dc_resolve_geography(',
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
             "  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
             "              where n.nspname = 'public' and p.proname in ("
             + ", ".join(f"'{f}'" for f in MUST_NOT_EXIST) + ")) then",
             "    bad := bad || ' (a function this apply introduces already exists)';",
             "  end if;",
             "  if bad <> '' then",
             "    raise exception 'DRIFT: live definition(s) no longer match main@f9d1326:%. Nothing applied.', bad;",
             "  end if;",
             "end $guard$;"]
    parts = ['-- GENERATED by test/dc_atlas_validation_pg/build_apply.py from the DDL of record. Do not edit.',
             '-- PHASE A of Atlas coordinate validation: evidence acquisition only. Atlas is NOT admitted.',
             '-- One transaction: the drift guard, then the changed Step 3D, 3A and 3B objects, in dependency order.',
             'begin;', '\n'.join(guard)]
    for label, block in (('STEP 3D  docs/dc-step3d-derived-location.sql (changed objects)', d3),
                         ('STEP 3A  docs/dc-step3a-canonical-identity.sql (changed objects)', a3),
                         ('STEP 3B  docs/dc-step3b-canonical-geography.sql (changed objects)', b3)):
        parts.append(f'-- ===== {label} =====')
        parts.extend(block)
    parts.append('commit;')
    return '\n\n'.join(parts) + '\n'


if __name__ == '__main__':
    text = build()
    if '--body' in sys.argv:
        # the same statements WITHOUT begin/commit, for a caller that owns the transaction (the replica)
        body = text.replace('\nbegin;\n', '\n', 1)
        assert body.rstrip().endswith('commit;'), 'apply file shape changed'
        sys.stdout.write(body.rstrip()[:-len('commit;')] + '\n')
        sys.exit(0)
    if '--check' in sys.argv:
        ok = OUT.exists() and OUT.read_text() == text
        print('apply file is current' if ok else 'apply file is STALE: regenerate it'); sys.exit(0 if ok else 1)
    OUT.write_text(text)
    print(f'wrote {OUT.relative_to(ROOT)} ({len(text)} bytes, sha256 {hashlib.sha256(text.encode()).hexdigest()[:16]})')
