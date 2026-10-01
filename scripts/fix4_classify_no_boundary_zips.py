#!/usr/bin/env python3
"""Fix 4: classify every canonical ZIP that has no Census ZCTA boundary.

THE ONE PLACE THIS DECISION IS MADE. The output CSV, the offline test and the CI check all
read what this script writes; none of them re-decides a class.

A canonical ZIP with no geo.zcta_boundary row is one of two things:

  * a LEGITIMATE non-ZCTA ZIP: Census publishes no current ZCTA polygon for it (PO Box,
    unique-organisation, military, retired, or a standard ZIP Census did not delineate).
    It stays `not_measured`. A polygon is never manufactured for it: no centroid, no radius,
    no neighbouring ZCTA, no superseded 2010 polygon.
  * a HOMESIGNAL OMISSION: Census DOES publish a current ZCTA for that code and HomeSignal
    failed to load or publish it. That is an acquisition or generation defect to correct.

Inputs, all committed beside the output and fingerprinted:

  docs/maps-coverage/fix4/no-boundary-zips-2026-10-01.psv
      the production export (no-boundary-zips.sql step 1). Refused unless its md5s equal
      the ones the database computed (census-zcta-evidence-2026-10-01.json).
  docs/maps-coverage/fix4/census-zcta-evidence-2026-10-01.json
      what Census TIGERweb returned for the current (2020) delineation and the 2010 one.
  zipcodes==3.0.0 (PyPI)
      the USPS ZIP dataset every HomeSignal community build is generated from (CLAUDE.md
      section 3). Refused at any other version.

Usage:
  python3 scripts/fix4_classify_no_boundary_zips.py           # write the outputs
  python3 scripts/fix4_classify_no_boundary_zips.py --check   # regenerate, compare, write nothing

stdlib only, apart from the pinned zipcodes package.
"""

import csv
import hashlib
import io
import json
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
FIX4 = os.path.join(ROOT, 'docs', 'maps-coverage', 'fix4')
INPUT_PSV = os.path.join(FIX4, 'no-boundary-zips-2026-10-01.psv')
EVIDENCE = os.path.join(FIX4, 'census-zcta-evidence-2026-10-01.json')
OUT_CSV = os.path.join(FIX4, 'no-boundary-zip-classification.csv')
OUT_SUMMARY = os.path.join(FIX4, 'no-boundary-zip-classification.summary.json')

ZIPCODES_VERSION = '3.0.0'

# The closed vocabulary. Order is the order the rules are tried in classify(), and the order
# the summary reports them in.
CLASSES = (
    # Census publishes a current ZCTA for this code; HomeSignal has no boundary row for it.
    ('HOMESIGNAL_OMISSION', 'correct_boundary'),
    # Absent from the pinned USPS dataset. Census has no current ZCTA for it either.
    ('NOT_IN_USPS_DATASET', 'not_measured'),
    # Decommissioned in the USPS dataset (active = false).
    ('USPS_RETIRED', 'not_measured'),
    # Active ZIPs whose USPS type is not a delivery area Census delineates.
    ('USPS_PO_BOX', 'not_measured'),
    ('USPS_UNIQUE', 'not_measured'),
    ('USPS_MILITARY', 'not_measured'),
    # Active standard ZIP for which the 2020 delineation published no ZCTA.
    ('USPS_STANDARD_NO_CENSUS_ZCTA', 'not_measured'),
)
DISPOSITION = dict(CLASSES)
TYPE_CLASS = {
    'PO BOX': 'USPS_PO_BOX',
    'UNIQUE': 'USPS_UNIQUE',
    'MILITARY': 'USPS_MILITARY',
    'STANDARD': 'USPS_STANDARD_NO_CENSUS_ZCTA',
}

HEADER = ('zip', 'state', 'county', 'page_name', 'usps_type', 'usps_active', 'usps_city',
          'census_zcta_2020', 'census_zcta_2010', 'class', 'disposition')


def fail(msg):
    sys.exit('STOP: ' + msg)


def md5(s):
    return hashlib.md5(s.encode('utf-8')).hexdigest()


def load_inputs():
    with open(EVIDENCE, encoding='utf-8') as f:
        ev = json.load(f)
    with open(INPUT_PSV, encoding='utf-8') as f:
        lines = f.read().rstrip('\n').split('\n')

    want = ev['no_boundary_input']
    zips = [line.split('|', 1)[0] for line in lines]
    got_rows, got_zips = md5('\n'.join(lines)), md5(','.join(zips))
    if len(lines) != want['rows']:
        fail(f'input has {len(lines)} rows, the database exported {want["rows"]}')
    if got_rows != want['rows_md5'] or got_zips != want['zip_md5']:
        fail(f'input does not match the database export: rows md5 {got_rows} vs '
             f'{want["rows_md5"]}, zip md5 {got_zips} vs {want["zip_md5"]}')
    if zips != sorted(zips) or len(set(zips)) != len(zips):
        fail('input ZIPs are not unique and in byte order')

    rows = []
    for line in lines:
        parts = line.split('|')
        if len(parts) != 4 or len(parts[0]) != 5 or not parts[0].isdigit():
            fail(f'malformed input row: {line!r}')
        rows.append(dict(zip(('zip', 'state', 'county', 'page_name'), parts)))

    # The 2020 layers must all be the boundary table's own code set, or the "no current
    # ZCTA" half of every legitimate class below rests on a set nobody checked.
    bt = ev['boundary_table']
    layers = ev['census_zcta_2020_layers']['layers']
    if not layers:
        fail('no Census 2020 layer in the evidence')
    for lay in layers:
        if lay['features'] != bt['rows'] or lay['codes_md5'] != bt['codes_md5']:
            fail(f'Census layer {lay["id"]} is not the boundary table\'s code set')
        if lay['positive_control_registry_zips_with_boundary_found'] <= 0:
            fail(f'Census layer {lay["id"]} has a zero positive control')
    if ev['census_zcta_2010']['positive_control_registry_zips_with_boundary_found'] <= 0:
        fail('the 2010 layer has a zero positive control')

    hits2020 = set(ev['census_zcta_2020_layers']['no_boundary_hits'])
    hits2010 = set(ev['census_zcta_2010']['no_boundary_hits'])
    for name, hits in (('2020', hits2020), ('2010', hits2010)):
        stray = hits - set(zips)
        if stray:
            fail(f'{name} hits name ZIPs outside the input: {sorted(stray)}')
    return rows, hits2020, hits2010


def usps_index():
    try:
        import zipcodes
    except ImportError:
        fail(f'pip install zipcodes=={ZIPCODES_VERSION}')
    try:
        from importlib.metadata import version
        v = version('zipcodes')
    except Exception:
        v = getattr(zipcodes, '__version__', '?')
    if v != ZIPCODES_VERSION:
        fail(f'zipcodes is {v}; this classification is pinned to {ZIPCODES_VERSION}')
    return {z['zip_code']: z for z in zipcodes.list_all()}


def classify(in_census_2020, usps):
    if in_census_2020:
        return 'HOMESIGNAL_OMISSION'
    if usps is None:
        return 'NOT_IN_USPS_DATASET'
    if usps['active'] is not True:
        return 'USPS_RETIRED'
    cls = TYPE_CLASS.get(usps['zip_code_type'])
    if cls is None:
        fail(f'unknown USPS type {usps["zip_code_type"]!r} for {usps["zip_code"]}')
    return cls


def build():
    rows, hits2020, hits2010 = load_inputs()
    usps = usps_index()

    out = []
    for r in rows:
        u = usps.get(r['zip'])
        cls = classify(r['zip'] in hits2020, u)
        out.append({
            **r,
            'usps_type': u['zip_code_type'] if u else '',
            'usps_active': ('true' if u['active'] is True else 'false') if u else '',
            'usps_city': u['city'] if u else '',
            'census_zcta_2020': 'true' if r['zip'] in hits2020 else 'false',
            'census_zcta_2010': 'true' if r['zip'] in hits2010 else 'false',
            'class': cls,
            'disposition': DISPOSITION[cls],
        })

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=HEADER, lineterminator='\n')
    w.writeheader()
    w.writerows(out)
    csv_text = buf.getvalue()

    counts = {c: 0 for c, _ in CLASSES}
    for o in out:
        counts[o['class']] += 1
    by_type = {}
    for o in out:
        k = f'{o["usps_type"] or "(absent)"} / active={o["usps_active"] or "(absent)"}'
        by_type[k] = by_type.get(k, 0) + 1
    summary = {
        '_doc': 'Generated by scripts/fix4_classify_no_boundary_zips.py. Do not edit by hand.',
        'zipcodes_version': ZIPCODES_VERSION,
        'rows': len(out),
        'zip_md5': md5(','.join(o['zip'] for o in out)),
        'csv_md5': md5(csv_text),
        'classes': counts,
        # The class -> disposition table itself, so the contract is checked even for a class
        # no row carries today (HOMESIGNAL_OMISSION has 0 rows; a rule that quietly accepted
        # an omission as not_measured would otherwise be invisible).
        'dispositions': dict(CLASSES),
        'legitimate_not_measured': sum(n for c, n in counts.items() if DISPOSITION[c] == 'not_measured'),
        'homesignal_omissions': counts['HOMESIGNAL_OMISSION'],
        'had_2010_zcta': sum(1 for o in out if o['census_zcta_2010'] == 'true'),
        'had_2010_zcta_by_class': {c: sum(1 for o in out if o['class'] == c and o['census_zcta_2010'] == 'true')
                                   for c, _ in CLASSES},
        'usps_type_by_active': dict(sorted(by_type.items())),
    }
    if sum(counts.values()) != len(out):
        fail('classes do not partition the input')
    summary_text = json.dumps(summary, indent=2) + '\n'
    return csv_text, summary_text, summary


def main():
    check = '--check' in sys.argv[1:]
    csv_text, summary_text, summary = build()
    if check:
        bad = []
        for path, text in ((OUT_CSV, csv_text), (OUT_SUMMARY, summary_text)):
            try:
                with open(path, encoding='utf-8') as f:
                    if f.read() != text:
                        bad.append(path)
            except FileNotFoundError:
                bad.append(path)
        if bad:
            fail('committed output differs from a fresh regeneration: ' + ', '.join(os.path.relpath(b, ROOT) for b in bad))
        print('OK: committed classification equals a fresh regeneration')
    else:
        with open(OUT_CSV, 'w', encoding='utf-8', newline='') as f:
            f.write(csv_text)
        with open(OUT_SUMMARY, 'w', encoding='utf-8') as f:
            f.write(summary_text)
        print('wrote', os.path.relpath(OUT_CSV, ROOT), 'and', os.path.relpath(OUT_SUMMARY, ROOT))
    for c, _ in CLASSES:
        print(f'  {c:<30} {summary["classes"][c]:>4}')
    print(f'  {"rows":<30} {summary["rows"]:>4}   legitimate not_measured {summary["legitimate_not_measured"]}'
          f'   omissions {summary["homesignal_omissions"]}   csv md5 {summary["csv_md5"]}')


if __name__ == '__main__':
    main()
