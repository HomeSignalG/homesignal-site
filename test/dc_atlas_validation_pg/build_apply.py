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

# PHASE A IS DEPLOYED (25 Sep 2026, artifact sha256 below). Stage 10 (2026-09-26) then admitted Atlas
# by editing ONE region of Step 3D: the Atlas line of the admission comment and the admission body.
# The Phase A artifact must keep regenerating byte for byte, so the generator reads Step 3D with
# exactly that region restored to its Phase A text. The two strings below were extracted from git
# (main@4465d4a vs the stage-10 edit), not retyped, and the sha256 pin makes any slip fail closed.
PHASE_A_SHA256 = '891bb2101d1f99d5861529953e7f216cdb1d61c64d898d381efee2c0d39ea5a3'
STAGE10_REGION = "--   compute_atlas/facilities admitted 2026-09-26 (stage 10), after the admission dry run on that\n--                            day's production copy (dc-atlas-admission-dryrun.yml, run 36253526398:\n--                            1 facility added, 26 withheld, 0 moved), reviewed by the founder.\n--                            Applied by scripts/dc-atlas-admission-apply.sh.\ncreate or replace function public.dc_derived_address_admitted(p_source_key text, p_distribution_key text)\nreturns boolean\nlanguage sql\nimmutable\nset search_path to 'public', 'pg_temp'\nas $$ select (p_source_key, p_distribution_key) in (('epoch_ai', 'data_centers'), ('compute_atlas', 'facilities')) $$;\n"
PHASE_A_REGION = "--   compute_atlas/facilities NOT admitted: evidence acquisition only, pending review of the\n--                            national dry run (dc-atlas-dryrun.yml)\ncreate or replace function public.dc_derived_address_admitted(p_source_key text, p_distribution_key text)\nreturns boolean\nlanguage sql\nimmutable\nset search_path to 'public', 'pg_temp'\nas $$ select (p_source_key, p_distribution_key) in (('epoch_ai', 'data_centers')) $$;\n"


def pick(path, preds):
    if path != 'docs/dc-step3d-derived-location.sql':
        return _epoch.pick(path, preds)
    text = (ROOT / path).read_text()
    if text.count(STAGE10_REGION) == 1:
        text = text.replace(STAGE10_REGION, PHASE_A_REGION)
    elif text.count(PHASE_A_REGION) != 1:
        raise SystemExit(f'{path}: neither the stage-10 nor the Phase A admission region is present exactly once')
    stmts = _epoch.split(text)
    out, hit = [], {p: 0 for p in preds}
    for s in stmts:
        c = ' '.join(_epoch.code(s).split())
        for p in preds:
            if c.startswith(p):
                out.append(s.strip('\n')); hit[p] += 1
    missing = [p for p, k in hit.items() if k == 0]
    if missing:
        raise SystemExit(f'{path}: no statement starts with {missing}')
    return out

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
    # ⛔ FROZEN 2026-09-25: this artifact WAS APPLIED to production (Phase A, #1335 -> ccd637e, applied
    # 25 Sep 14:49 UTC). Same rule as test/dc_epoch_geography_pg/build_apply.py: from then on the DDL
    # of record keeps moving (stage 10 admission, the OSM layer check), and regenerating would rewrite
    # history into an artifact nobody applied. --check verifies the FROZEN bytes and nothing else.
    if '--check' in sys.argv:
        got = hashlib.sha256(OUT.read_bytes()).hexdigest() if OUT.exists() else None
        ok = got == PHASE_A_SHA256
        print('apply file is the frozen Phase A artifact applied 2026-09-25' if ok
              else f'apply file is NOT the frozen applied artifact (sha256 {got})')
        sys.exit(0 if ok else 1)
    if not sys.argv[1:]:
        raise SystemExit('REFUSED: the Phase A apply is frozen (applied to production); it is never regenerated')
    text = build()
    if '--body' in sys.argv:
        # the same statements WITHOUT begin/commit, for a caller that owns the transaction (the replica)
        body = text.replace('\nbegin;\n', '\n', 1)
        assert body.rstrip().endswith('commit;'), 'apply file shape changed'
        sys.stdout.write(body.rstrip()[:-len('commit;')] + '\n')
        sys.exit(0)
    if '--check' in sys.argv:
        ok = (OUT.exists() and OUT.read_text() == text
              and hashlib.sha256(text.encode()).hexdigest() == PHASE_A_SHA256)
        print('apply file is current' if ok else 'apply file is STALE: regenerate it'); sys.exit(0 if ok else 1)
    OUT.write_text(text)
    print(f'wrote {OUT.relative_to(ROOT)} ({len(text)} bytes, sha256 {hashlib.sha256(text.encode()).hexdigest()[:16]})')
