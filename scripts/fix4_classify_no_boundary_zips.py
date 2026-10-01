#!/usr/bin/env python3
"""Fix 4: classify every canonical ZIP that has no Census ZCTA boundary.

THE ONE PLACE A CLASS IS DECIDED. The output CSV, the offline test and the CI check all read
what this script writes; none of them re-decides a class.

A canonical ZIP with no geo.zcta_boundary row is one of three things:

  * a LEGITIMATE non-ZCTA ZIP: Census publishes no polygon for it in the current (2020)
    delineation, and the ZIP dataset knows it (a PO Box, unique-organization or military ZIP, a
    standard ZIP Census did not delineate, or one the dataset flags as decommissioned).
  * a ZIP WHOSE EXISTENCE IS NOT ESTABLISHED: Census has no polygon AND the ZIP dataset does not
    list the code at all, so it may not be a real ZIP. That is a registry question, not a boundary
    question.
  * a HOMESIGNAL OMISSION: Census DOES publish a current ZCTA for the code and HomeSignal has no
    boundary row for it. That is an acquisition or generation defect to correct.

The first two stay `not_measured`. A polygon is never manufactured for any of them: no centroid,
no radius, no neighbouring ZCTA, no superseded 2010 polygon.

WHO DECIDES WHAT. The omission test is Census membership, computed HERE from the committed Census
code sets (census-zcta-codes-2026-10-01.json, a bitmap per delineation) and refused unless it equals
the set comparison the database made (no-boundary-zips.sql step 4, `census_layers[].no_boundary_hits`).
The other classes come from the zipcodes 3.0.0 package, whose
type and active flags come from unitedstateszipcodes.org (its METADATA, "Zipcode Data"); USPS ZIP
Locale Detail is used there only to add active ZIPs the base data lacks. So nothing here is a USPS
statement, and the names say "dataset", not "USPS".

Inputs, committed beside the output and fingerprinted:

  docs/maps-coverage/fix4/no-boundary-zips-2026-10-01.psv
      the production export (no-boundary-zips.sql step 1, saved verbatim).
  docs/maps-coverage/fix4/census-zcta-evidence-2026-10-01.json
      generated whole by no-boundary-zips.sql step 4; it carries the export's md5s.
  docs/maps-coverage/fix4/census-zcta-codes-2026-10-01.json
      generated whole by no-boundary-zips.sql step 5: the Census code sets themselves, so the
      evidence's md5s stay checkable after pg_net expires the responses.
  zipcodes==3.0.0 (PyPI)
      the ZIP dataset most HomeSignal community builds (Michigan onward) were generated from.
      Refused at any other version, or if its data does not fingerprint to ZIPCODES_ROWS_MD5.

What the checks prove, and what they do not: they prove the committed files agree with each other
and regenerate exactly. The DATABASE and CENSUS values rest on the dated reads in the two
generated files, whose md5s the database itself returned (recorded in the receipt).

Usage:
  python3 scripts/fix4_classify_no_boundary_zips.py              # write the outputs
  python3 scripts/fix4_classify_no_boundary_zips.py --check      # regenerate, compare, write nothing
  python3 scripts/fix4_classify_no_boundary_zips.py --self-test  # every class branch and every refusal
  python3 scripts/fix4_classify_no_boundary_zips.py --self-test-offline
      # the same without the zipcodes package (a stand-in empty dataset): run by the required
      # offline unit test, so a rule or guard removed from this file fails `unit`, not only the
      # advisory no-boundary-zip-classification workflow.

stdlib only, apart from the pinned zipcodes package.
"""

import argparse
import base64
import csv
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
FIX4 = os.path.join(ROOT, 'docs', 'maps-coverage', 'fix4')
INPUT_PSV = os.path.join(FIX4, 'no-boundary-zips-2026-10-01.psv')
EVIDENCE = os.path.join(FIX4, 'census-zcta-evidence-2026-10-01.json')
CODES = os.path.join(FIX4, 'census-zcta-codes-2026-10-01.json')
OUT_CSV = os.path.join(FIX4, 'no-boundary-zip-classification.csv')
OUT_SUMMARY = os.path.join(FIX4, 'no-boundary-zip-classification.summary.json')

ZIPCODES_VERSION = '3.0.0'
# md5 of the dataset's "zip|type|active" rows, sorted, '\n'-joined: 42,789 rows on 2026-10-01.
ZIPCODES_ROWS = 42789
ZIPCODES_ROWS_MD5 = 'ef16c548843af5ab92a26531c941b323'

# The closed vocabulary: class -> (group, disposition). Order is the order the rules are tried in
# classify(), and the order the summary reports them in.
CLASSES = (
    # Census publishes a current ZCTA for this code; HomeSignal has no boundary row for it.
    ('HOMESIGNAL_OMISSION', 'homesignal_omission', 'correct_boundary'),
    # Not in the ZIP dataset at all (not even as decommissioned) and no Census ZCTA.
    ('NOT_IN_ZIP_DATASET', 'existence_not_established', 'not_measured'),
    # The dataset flags it as no longer active (active = false).
    ('DECOMMISSIONED_IN_DATASET', 'legitimate_non_zcta', 'not_measured'),
    # Active ZIPs, by the dataset's type.
    ('PO_BOX_ZIP', 'legitimate_non_zcta', 'not_measured'),
    ('UNIQUE_ZIP', 'legitimate_non_zcta', 'not_measured'),
    ('MILITARY_ZIP', 'legitimate_non_zcta', 'not_measured'),
    ('STANDARD_ZIP_NO_CENSUS_ZCTA', 'legitimate_non_zcta', 'not_measured'),
)
GROUP = {c: g for c, g, _ in CLASSES}
DISPOSITION = {c: d for c, _, d in CLASSES}
GROUPS = ('legitimate_non_zcta', 'existence_not_established', 'homesignal_omission')
TYPE_CLASS = {
    'PO BOX': 'PO_BOX_ZIP',
    'UNIQUE': 'UNIQUE_ZIP',
    'MILITARY': 'MILITARY_ZIP',
    'STANDARD': 'STANDARD_ZIP_NO_CENSUS_ZCTA',
}

HEADER = ('zip', 'state', 'county', 'page_name', 'zipcodes_type', 'zipcodes_active', 'zipcodes_city',
          'census_zcta_2020', 'census_zcta_2010', 'class', 'group', 'disposition')


class Refusal(Exception):
    pass


def fail(msg):
    raise Refusal('STOP: ' + msg)


def md5(data):
    return hashlib.md5(data if isinstance(data, bytes) else data.encode('utf-8')).hexdigest()


def decode_codes(bitmap_base64):
    """The sorted five-digit codes a step-5 bitmap marks: bit i, most significant bit first."""
    try:
        b = base64.b64decode(bitmap_base64, validate=True)
    except (ValueError, TypeError):
        fail('a Census code bitmap is not valid base64')
    if len(b) != 12500:
        fail(f'a Census code bitmap is {len(b)} bytes, not 12,500')
    return [f'{i:05d}' for i in range(100000) if (b[i >> 3] >> (7 - (i & 7))) & 1]


def load_inputs(psv_path, evidence_path, codes_path):
    with open(evidence_path, 'rb') as f:
        ev = json.loads(f.read().decode('utf-8'))
    with open(codes_path, 'rb') as f:
        codes_raw = f.read()
    code_layers = json.loads(codes_raw.decode('utf-8'))['layers']
    with open(psv_path, 'rb') as f:
        raw = f.read()

    want = ev['input_export']
    if md5(raw) != want['file_md5']:
        fail(f'input file md5 {md5(raw)} is not the database export\'s file_md5 {want["file_md5"]}')
    text = raw.decode('utf-8')
    if not text.endswith('\n') or '\r' in text:
        fail('input file must be LF-terminated rows')
    lines = text[:-1].split('\n')
    zips = [line.split('|', 1)[0] for line in lines]
    if len(lines) != want['rows']:
        fail(f'input has {len(lines)} rows, the database exported {want["rows"]}')
    if md5('\n'.join(lines)) != want['rows_md5'] or md5(','.join(zips)) != want['zip_md5']:
        fail('input rows or ZIPs do not fingerprint to the database export')
    if zips != sorted(zips) or len(set(zips)) != len(zips):
        fail('input ZIPs are not unique and in byte order')

    rows = []
    for line in lines:
        parts = line.split('|')
        if len(parts) != 4 or len(parts[0]) != 5 or not parts[0].isdigit():
            fail(f'malformed input row: {line!r}')
        rows.append(dict(zip(('zip', 'state', 'county', 'page_name'), parts)))

    layers = ev['census_layers']
    by_delineation = {}
    for lay in layers:
        if lay['http_status'] != 200 or lay['exceeded_transfer_limit_present']:
            fail(f'Census layer {lay["layer"]} was not read completely')
        if lay['features'] != lay['distinct_codes'] or lay['features'] <= 0:
            fail(f'Census layer {lay["layer"]} has duplicate or no codes')
        if lay['positive_control_registry_zips_with_boundary_found'] <= 0:
            fail(f'Census layer {lay["layer"]} has a zero positive control')
        by_delineation.setdefault(lay['delineation'], []).append(lay)
    if set(by_delineation) != {'2020', '2010'}:
        fail(f'evidence must carry the 2020 and 2010 delineations, has {sorted(by_delineation)}')
    for name, lays in by_delineation.items():
        sets = {(lay['codes_md5'], tuple(lay['no_boundary_hits'])) for lay in lays}
        if len(sets) != 1:
            fail(f'the {name} Census layers disagree with each other')

    # Census membership comes from the committed code sets, one per delineation, each of which must
    # decode to exactly the code set the evidence recorded for that delineation.
    if sorted(c['delineation'] for c in code_layers) != ['2010', '2020']:
        fail('the code file must carry exactly one 2020 and one 2010 code set')
    zipset = set(zips)
    hits = {}
    for c in code_layers:
        codes = decode_codes(c['bitmap_base64'])
        name = c['delineation']
        if len(codes) != c['codes'] or md5(','.join(codes)) != c['codes_md5']:
            fail(f'the {name} code bitmap does not decode to its recorded count and md5')
        rec = by_delineation[name][0]
        if c['codes_md5'] != rec['codes_md5'] or c['codes'] != rec['features']:
            fail(f'the {name} code set is not the one the evidence recorded')
        hits[name] = zipset.intersection(codes)
        if hits[name] != set(rec['no_boundary_hits']):
            fail(f'the {name} code set contains {sorted(hits[name])} of the input, '
                 f'but the evidence recorded {rec["no_boundary_hits"]}')

    boundary_is_census = all(lay['codes_md5'] == ev['boundary_table']['codes_md5']
                             and lay['features'] == ev['boundary_table']['rows']
                             for lay in by_delineation['2020'])
    return rows, hits['2020'], hits['2010'], boundary_is_census, md5(raw), md5(codes_raw)


def zip_dataset():
    try:
        import zipcodes
    except ImportError:
        fail(f'pip install zipcodes=={ZIPCODES_VERSION}')
    from importlib.metadata import version, distribution
    v = version('zipcodes')
    if v != ZIPCODES_VERSION:
        fail(f'zipcodes is {v}; this classification is pinned to {ZIPCODES_VERSION}')
    home = os.path.realpath(str(distribution('zipcodes').locate_file('')))
    if not os.path.realpath(zipcodes.__file__).startswith(home + os.sep):
        fail(f'the imported zipcodes ({zipcodes.__file__}) is not the installed distribution')
    return dataset_index(zipcodes.list_all())


def dataset_index(data):
    """The dataset as {zip: record}, refused unless it is exactly the pinned 3.0.0 data."""
    rows = sorted(f"{z['zip_code']}|{z['zip_code_type']}|{'true' if z['active'] is True else 'false'}"
                  for z in data)
    if len(rows) != ZIPCODES_ROWS or md5('\n'.join(rows)) != ZIPCODES_ROWS_MD5:
        fail(f'the zipcodes data is not the pinned 3.0.0 data ({len(rows)} rows, md5 {md5(chr(10).join(rows))})')
    return {z['zip_code']: z for z in data}


def classify(in_census_2020, rec):
    if in_census_2020:
        return 'HOMESIGNAL_OMISSION'
    if rec is None:
        return 'NOT_IN_ZIP_DATASET'
    if rec['active'] is not True:
        return 'DECOMMISSIONED_IN_DATASET'
    cls = TYPE_CLASS.get(rec['zip_code_type'])
    if cls is None:
        fail(f'unknown ZIP type {rec["zip_code_type"]!r} for {rec["zip_code"]}')
    return cls


def build(psv_path=INPUT_PSV, evidence_path=EVIDENCE, codes_path=CODES, dataset=None):
    rows, hits2020, hits2010, boundary_is_census, input_md5, codes_md5 = load_inputs(psv_path, evidence_path, codes_path)
    idx = dataset if dataset is not None else zip_dataset()

    out = []
    for r in rows:
        rec = idx.get(r['zip'])
        cls = classify(r['zip'] in hits2020, rec)
        out.append({
            **r,
            'zipcodes_type': rec['zip_code_type'] if rec else '',
            'zipcodes_active': ('true' if rec['active'] is True else 'false') if rec else '',
            'zipcodes_city': rec['city'] if rec else '',
            'census_zcta_2020': 'true' if r['zip'] in hits2020 else 'false',
            'census_zcta_2010': 'true' if r['zip'] in hits2010 else 'false',
            'class': cls,
            'group': GROUP[cls],
            'disposition': DISPOSITION[cls],
        })

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=HEADER, lineterminator='\n')
    w.writeheader()
    w.writerows(out)
    csv_text = buf.getvalue()

    classes = {c: sum(1 for o in out if o['class'] == c) for c, _, _ in CLASSES}
    groups = {g: sum(1 for o in out if o['group'] == g) for g in GROUPS}
    if sum(classes.values()) != len(out) or sum(groups.values()) != len(out):
        fail('classes do not partition the input')
    by_type = {}
    for o in out:
        k = f'{o["zipcodes_type"] or "(absent)"} / active={o["zipcodes_active"] or "(absent)"}'
        by_type[k] = by_type.get(k, 0) + 1
    with open(evidence_path, 'rb') as f:
        evidence_md5 = md5(f.read())
    summary = {
        '_doc': 'Generated by scripts/fix4_classify_no_boundary_zips.py. Do not edit by hand.',
        'inputs': {'input_file_md5': input_md5, 'evidence_file_md5': evidence_md5, 'codes_file_md5': codes_md5,
                   'zipcodes': {'version': ZIPCODES_VERSION, 'rows': ZIPCODES_ROWS, 'rows_md5': ZIPCODES_ROWS_MD5}},
        'rows': len(out),
        'zip_md5': md5(','.join(o['zip'] for o in out)),
        'csv_md5': md5(csv_text),
        'boundary_table_equals_census_2020': boundary_is_census,
        'groups': groups,
        'classes': classes,
        # The class -> group and disposition tables themselves, so the contract is checked even for
        # a class no row carries today (HOMESIGNAL_OMISSION has 0 rows).
        'class_groups': dict(GROUP),
        'dispositions': dict(DISPOSITION),
        'stays_not_measured': sum(n for c, n in classes.items() if DISPOSITION[c] == 'not_measured'),
        'had_2010_zcta': sum(1 for o in out if o['census_zcta_2010'] == 'true'),
        'had_2010_zcta_by_class': {c: sum(1 for o in out if o['class'] == c and o['census_zcta_2010'] == 'true')
                                   for c, _, _ in CLASSES},
        'zipcodes_type_by_active': dict(sorted(by_type.items())),
    }
    return csv_text, json.dumps(summary, indent=2) + '\n', summary


# ── self-test: every class branch and every refusal, on synthetic and tampered inputs ──────────
def self_test(offline=False):
    """offline=True never imports zipcodes: the build runs on an empty stand-in dataset, so every
    input ZIP that is not a Census hit classifies NOT_IN_ZIP_DATASET. That is enough to exercise
    every rule and every refusal; only the pinned-dataset checks need the real package."""
    failures = []

    def expect(name, cond):
        print(('PASS' if cond else 'FAIL') + ' - ' + name)
        if not cond:
            failures.append(name)

    def refuses(name, fn, want):
        # The STOP must be the guard named by `want`, not an earlier one that happens to fire.
        try:
            fn()
        except Refusal as e:
            expect(f'{name} -> {str(e)[:70]}', want in str(e))
            return
        expect(f'{name} (expected a STOP, got none)', False)

    def rec(z, t, a):
        return {'zip_code': z, 'zip_code_type': t, 'active': a, 'city': 'X'}

    expect('a Census hit is an omission even for a PO Box ZIP', classify(True, rec('1', 'PO BOX', True)) == 'HOMESIGNAL_OMISSION')
    expect('a Census hit is an omission even when the dataset lacks the ZIP', classify(True, None) == 'HOMESIGNAL_OMISSION')
    expect('absent from the dataset -> NOT_IN_ZIP_DATASET', classify(False, None) == 'NOT_IN_ZIP_DATASET')
    expect('inactive -> DECOMMISSIONED_IN_DATASET, whatever the type', classify(False, rec('1', 'STANDARD', False)) == 'DECOMMISSIONED_IN_DATASET')
    # Written out, not read from TYPE_CLASS: a check that derives its expectation from the table it
    # checks cannot fail.
    for t, c in (('PO BOX', 'PO_BOX_ZIP'), ('UNIQUE', 'UNIQUE_ZIP'), ('MILITARY', 'MILITARY_ZIP'),
                 ('STANDARD', 'STANDARD_ZIP_NO_CENSUS_ZCTA')):
        expect(f'active {t} -> {c}', classify(False, rec('1', t, True)) == c)
    expect('the dataset types are exactly those four', sorted(TYPE_CLASS) == ['MILITARY', 'PO BOX', 'STANDARD', 'UNIQUE'])
    refuses('an unknown ZIP type', lambda: classify(False, rec('1', 'NEW TYPE', True)), 'unknown ZIP type')
    expect('every class has a group and a disposition',
           all(GROUP[c] in GROUPS and DISPOSITION[c] in ('not_measured', 'correct_boundary') for c, _, _ in CLASSES))
    expect('only an omission is corrected', [c for c, _, d in CLASSES if d == 'correct_boundary'] == ['HOMESIGNAL_OMISSION'])

    if offline:
        real = {}
        out = build(dataset=real)[2]
        expect('the build succeeds on the committed inputs (stand-in dataset)',
               out['rows'] > 0 and out['classes']['NOT_IN_ZIP_DATASET'] == out['rows'] - out['classes']['HOMESIGNAL_OMISSION'])
    else:
        real = zip_dataset()
        expect('the real build succeeds on the committed inputs', build(dataset=real)[2]['rows'] > 0)
        refuses('a dataset that is not the pinned data', lambda: dataset_index(list(real.values())[:-1]), 'not the pinned 3.0.0 data')

    def tampered(edit_psv=None, edit_ev=None, edit_codes=None):
        d = tempfile.mkdtemp()
        try:
            p, e, c = os.path.join(d, 'in.psv'), os.path.join(d, 'ev.json'), os.path.join(d, 'codes.json')
            shutil.copy(INPUT_PSV, p)
            shutil.copy(EVIDENCE, e)
            shutil.copy(CODES, c)
            if edit_codes:
                with open(c, encoding='utf-8') as f:
                    j = json.load(f)
                edit_codes(j)
                with open(c, 'w', encoding='utf-8') as f:
                    json.dump(j, f)
            if edit_psv:
                with open(p, 'rb') as f:
                    b = f.read()
                with open(p, 'wb') as f:
                    f.write(edit_psv(b))
            if edit_ev:
                with open(e, encoding='utf-8') as f:
                    j = json.load(f)
                edit_ev(j)
                with open(e, 'w', encoding='utf-8') as f:
                    json.dump(j, f)
            return build(p, e, c, dataset=real)
        finally:
            shutil.rmtree(d)

    refuses('a dropped input row', lambda: tampered(edit_psv=lambda b: b.split(b'\n', 1)[1]), 'is not the database export')
    refuses('CRLF line endings', lambda: tampered(edit_psv=lambda b: b.replace(b'\n', b'\r\n')), 'is not the database export')
    refuses('an edited page name', lambda: tampered(edit_psv=lambda b: b.replace(b'Amherst', b'Amhurst', 1)), 'is not the database export')

    def set_layer(j, i, k, v):
        j['census_layers'][i][k] = v

    refuses('a Census layer that was not read completely',
            lambda: tampered(edit_ev=lambda j: set_layer(j, 0, 'http_status', 500)), 'was not read completely')
    refuses('a Census layer with a zero positive control',
            lambda: tampered(edit_ev=lambda j: set_layer(j, 0, 'positive_control_registry_zips_with_boundary_found', 0)),
            'zero positive control')
    refuses('2020 layers that disagree', lambda: tampered(edit_ev=lambda j: set_layer(j, 0, 'codes_md5', '0' * 32)),
            'disagree with each other')
    refuses('a missing 2010 delineation',
            lambda: tampered(edit_ev=lambda j: j.__setitem__('census_layers', [x for x in j['census_layers'] if x['delineation'] != '2010'])),
            'must carry the 2020 and 2010')
    refuses('a recorded hit outside the input',
            lambda: tampered(edit_ev=lambda j: [x['no_boundary_hits'].append('99999') for x in j['census_layers'] if x['delineation'] == '2010']),
            'but the evidence recorded')

    def flip(j, delineation, code):
        # Toggle one code in a delineation's bitmap; returns the new (count, md5).
        for x in j['layers']:
            if x['delineation'] == delineation:
                b = bytearray(base64.b64decode(x['bitmap_base64']))
                i = int(code)
                b[i >> 3] ^= 1 << (7 - (i & 7))
                x['bitmap_base64'] = base64.b64encode(bytes(b)).decode()
                codes = decode_codes(x['bitmap_base64'])
                return len(codes), md5(','.join(codes))

    # A consistent world in which Census publishes a 2020 ZCTA for one input ZIP (01004) that the
    # boundary table lacks: the code set, its fingerprints and the recorded hits all say so.
    new = {}

    def census_gains_01004(j):
        n, m = flip(j, '2020', '01004')
        for x in j['layers']:
            if x['delineation'] == '2020':
                x['codes'], x['codes_md5'] = n, m
        new['2020'] = (n, m)

    refuses('a code bitmap that does not decode to its recorded md5',
            lambda: tampered(edit_codes=lambda j: flip(j, '2020', '01004')), 'does not decode')
    refuses('a code bitmap that is not 12,500 bytes',
            lambda: tampered(edit_codes=lambda j: [x.__setitem__('bitmap_base64', x['bitmap_base64'][:-4]) for x in j['layers']]),
            'not 12,500')
    refuses('a code file missing a delineation',
            lambda: tampered(edit_codes=lambda j: j.__setitem__('layers', [x for x in j['layers'] if x['delineation'] == '2020'])),
            'exactly one 2020 and one 2010')
    refuses('a self-consistent code set that is not the one the evidence recorded',
            lambda: tampered(edit_codes=census_gains_01004), 'not the one the evidence recorded')
    refuses('recorded hits that the code set does not contain',
            lambda: tampered(edit_ev=lambda j: [x.__setitem__('no_boundary_hits', ['01004']) for x in j['census_layers']
                                                 if x['delineation'] == '2020']), 'but the evidence recorded')

    def evidence_gains_01004(j):
        n, m = new['2020']
        for x in j['census_layers']:
            if x['delineation'] == '2020':
                x['features'] = x['distinct_codes'] = n
                x['codes_md5'] = m
                x['no_boundary_hits'] = ['01004']
    out = tampered(edit_codes=census_gains_01004, edit_ev=evidence_gains_01004)[2]
    expect('a Census 2020 ZCTA the boundary table lacks surfaces as one omission, to be corrected',
           out['classes']['HOMESIGNAL_OMISSION'] == 1 and out['groups']['homesignal_omission'] == 1
           and out['boundary_table_equals_census_2020'] is False and out['stays_not_measured'] == out['rows'] - 1)

    print(f'\n{"FAILED" if failures else "OK"} - {len(failures)} failure(s)')
    return 1 if failures else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description='Classify the canonical ZIPs with no Census ZCTA boundary (Fix 4).')
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='regenerate and compare with the committed outputs; write nothing')
    mode.add_argument('--self-test', action='store_true', help='exercise every class branch and every refusal')
    mode.add_argument('--self-test-offline', action='store_true',
                      help='the same, without the zipcodes package (a stand-in empty dataset)')
    args = ap.parse_args(argv)
    try:
        if args.self_test or args.self_test_offline:
            return self_test(offline=args.self_test_offline)
        csv_text, summary_text, summary = build()
        if args.check:
            bad = []
            for path, text in ((OUT_CSV, csv_text), (OUT_SUMMARY, summary_text)):
                try:
                    with open(path, 'rb') as f:
                        if f.read() != text.encode('utf-8'):
                            bad.append(path)
                except FileNotFoundError:
                    bad.append(path)
            if bad:
                fail('committed output differs from a fresh regeneration: ' + ', '.join(os.path.relpath(b, ROOT) for b in bad))
            print('OK: committed classification equals a fresh regeneration')
        else:
            with open(OUT_CSV, 'wb') as f:
                f.write(csv_text.encode('utf-8'))
            with open(OUT_SUMMARY, 'wb') as f:
                f.write(summary_text.encode('utf-8'))
            print('wrote', os.path.relpath(OUT_CSV, ROOT), 'and', os.path.relpath(OUT_SUMMARY, ROOT))
    except Refusal as e:
        print(e, file=sys.stderr)
        return 2
    for g in GROUPS:
        print(f'  {g:<30} {summary["groups"][g]:>4}')
    for c, _, _ in CLASSES:
        print(f'    {c:<28} {summary["classes"][c]:>4}')
    print(f'  rows {summary["rows"]}   stays not_measured {summary["stays_not_measured"]}   csv md5 {summary["csv_md5"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
