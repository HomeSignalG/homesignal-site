#!/usr/bin/env python3
"""THE GATE for the founder's same-building ruling (2026-10-23). Run by scripts/dc-osm-dedupe-gate.sh.

Input: Map 1 over every registry ZIP on a replica of production, BEFORE and AFTER the apply artifact
(CSV with header, NULL written as \\N). The PREDICTION is computed here from BEFORE alone, with its own
distance and name rule, never by asking the reader: an OSM row disappears exactly when, on the same ZIP
page, exactly one canonical row lies within 150 m and names the same site, and that canonical row has
exactly one such OSM row. Everything else must be byte-identical.

Exit 0 only if every check passes. Usage: dc_osm_dedupe_gate.py BEFORE.csv AFTER.csv [--self-test]
"""
import csv, math, re, sys
from collections import defaultdict

RADIUS_M = 150.0
EARTH_M = 6370986.0          # the sphere PostGIS ST_DistanceSphere uses
CODE = re.compile(r'^[a-z]{2,5}[0-9]{1,3}[a-z]?$')
NULL = '\\N'


def toks(s):
    return [t for t in re.split(r'[^a-z0-9]+', (s or '').lower()) if t]


def same_site(a_name, a_op, b_name, b_op):
    ta, tb, oa, ob = toks(a_name), toks(b_name), toks(a_op), toks(b_op)
    brand = bool(ta and tb and ta[0] == tb[0]) or bool(oa and ob and oa[0] == ob[0])
    na = ' '.join(toks(re.sub(r'\([^)]*\)', '', a_name or '')))
    nb = ' '.join(toks(re.sub(r'\([^)]*\)', '', b_name or '')))
    site = (na != '' and na == nb) or any(CODE.match(x) and x in tb for x in ta)
    return brand and site


def dist_m(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_M * math.asin(min(1.0, math.sqrt(h)))


def read(path):
    with open(path, newline='') as f:
        r = csv.reader(f)
        head = next(r)
        rows = [dict(zip(head, [None if v == NULL else v for v in row])) for row in r]
    return head, rows


def predict(rows):
    """The (zip, osm source_key) pairs the ruling hides, plus the pairs it found (for the receipt)."""
    by_zip = defaultdict(list)
    for r in rows:
        by_zip[r['zip']].append(r)
    hidden, found = set(), []
    for z, rs in by_zip.items():
        osm = [r for r in rs if r['publication_basis'] == 'legacy_osm_compat']
        can = [r for r in rs if r['publication_basis'] == 'canonical']
        pairs = []
        for o in osm:
            for c in can:
                d = dist_m(float(o['lat']), float(o['lng']), float(c['lat']), float(c['lng']))
                if d <= RADIUS_M and same_site(o['project_name'], o['developer_or_operator'],
                                               c['project_name'], c['developer_or_operator']):
                    pairs.append((o['source_key'], c['source_key'], d, o['project_name'], c['project_name']))
        n_o = defaultdict(int); n_c = defaultdict(int)
        for ok, ck, *_ in pairs:
            n_o[ok] += 1; n_c[ck] += 1
        for ok, ck, d, on, cn in pairs:
            one = n_o[ok] == 1 and n_c[ck] == 1
            found.append((z, ok, ck, d, on, cn, one))
            if one:
                hidden.add((z, ok))
    return hidden, found


def key(r):
    return (r['zip'], r['source_key'])


def gate(before_path, after_path):
    hb, before = read(before_path)
    ha, after = read(after_path)
    checks = []
    def check(name, ok, detail=''):
        checks.append((name, bool(ok), detail))

    hidden, found = predict(before)
    b_by, a_by = {key(r): r for r in before}, {key(r): r for r in after}
    removed = set(b_by) - set(a_by)
    check('G01_BEFORE_IS_NOT_EMPTY', len(before) > 0 and hb == ha,
          f"{len(before)} rows, {sum(r['publication_basis'] == 'legacy_osm_compat' for r in before)} OSM")
    check('G02_ONE_ROW_PER_ZIP_AND_RECORD', len(b_by) == len(before) and len(a_by) == len(after))
    check('G03_REMOVED_EQUALS_PREDICTION_EXACTLY', removed == hidden,
          f'{len(removed)} removed / {len(hidden)} predicted; unexpected {sorted(removed - hidden)[:5]}; '
          f'missed {sorted(hidden - removed)[:5]}')
    check('G04_NO_ROW_ADDED', not (set(a_by) - set(b_by)))
    check('G05_EVERY_KEPT_ROW_BYTE_IDENTICAL', all(a_by[k] == b_by[k] for k in a_by if k in b_by),
          f'{sum(a_by[k] != b_by[k] for k in a_by if k in b_by)} rows changed')
    check('G06_EVERY_REMOVED_ROW_IS_OSM', all(b_by[k]['publication_basis'] == 'legacy_osm_compat' for k in removed))
    check('G07_CANONICAL_ROWS_ALL_KEPT',
          sum(r['publication_basis'] == 'canonical' for r in before) == sum(r['publication_basis'] == 'canonical' for r in after))
    check('G08_ROWS_RECONCILE', len(before) == len(after) + len(removed), f'{len(before)} = {len(after)} + {len(removed)}')
    # a pair the ruling would hide must not sit so close to 150 m that the two distance formulas could disagree
    check('G09_NO_PAIR_ON_THE_RADIUS', not any(abs(f[3] - RADIUS_M) < 0.5 for f in found))
    for c in checks:
        print('%s|%s|%s' % (c[0], 'true' if c[1] else 'false', c[2]))
    for z, ok, ck, d, on, cn, one in sorted(found):
        print('CHANGE|%s|%s %s %.0f m: OSM %r = canonical %r' % ('HIDDEN' if one else 'KEPT_AMBIGUOUS', z, ok, d, on, cn))
    return all(c[1] for c in checks)


def self_test():
    assert same_site('IAD55', 'Digital Realty', 'Digital Realty IAD55', 'Digital Realty')
    assert same_site('Acme Data Center (Building 1)', None, 'Acme Data Center', None)
    assert not same_site('Vantage WA13', 'Vantage', 'Vantage WA12', 'Vantage')
    assert not same_site('Equinix SV5', 'Equinix', 'Equinix SV1', 'Equinix')
    assert not same_site('Acme IAD55', None, 'Other IAD55', None)
    assert not same_site(None, 'Same Op', None, 'Same Op')
    assert abs(dist_m(30.0, -89.9, 30.0009, -89.9) - 100.07) < 0.2
    rows = [dict(zip=z, source_key=k, publication_basis=b, lat=la, lng=ln, project_name=n, developer_or_operator=None)
            for z, k, b, la, ln, n in [
                ('1', 'o1', 'legacy_osm_compat', '30.0505', '-89.9', 'Stack POR03'),
                ('1', 'c1', 'canonical', '30.05', '-89.9', 'Stack POR03'),
                ('1', 'c2', 'canonical', '30.0503', '-89.9', 'Stack POR03'),
                ('1', 'o2', 'legacy_osm_compat', '30.0609', '-89.9', 'Acme Data Center (B)'),
                ('1', 'c3', 'canonical', '30.06', '-89.9', 'Acme Data Center'),
                ('2', 'o3', 'legacy_osm_compat', '30.0609', '-89.9', 'Acme Data Center (B)')]]
    hidden, _ = predict(rows)
    assert hidden == {('1', 'o2')}, hidden
    print('self-test PASS')


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        self_test(); sys.exit(0)
    ok = gate(sys.argv[1], sys.argv[2])
    if not ok:
        print('GATE REFUSED')
    sys.exit(0 if ok else 1)
