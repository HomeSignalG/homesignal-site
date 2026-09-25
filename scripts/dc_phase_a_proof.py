#!/usr/bin/env python3
"""dc_phase_a_proof.py — the ONE comparator behind the hardened Phase A proof.

Every OLD-vs-NEW comparison AND every positive control goes through the functions below, so a
control that is detected proves the comparator the real result used, not a helper beside it.

Inputs are directories of CSV dumps (with header) written by scripts/dc-atlas-phase-a-proof.sh,
which owns every query (this module reads files only, and never a database):
    start_ids.csv        canonical_entity_id           (the entities of the common starting state)
    entities.csv         canonical entity decision columns
    links.csv            entity-observation link decision columns
    decisions.csv        identity decision columns
    geo.csv              canonical geography decision fields
    map1.csv             Map 1 over every registry ZIP

MINTED ENTITY IDS ARE RANDOM (the identity resolver mints with gen_random_uuid()), so two correct runs of the
same resolver on the same input differ in the uuid of every entity they mint. An entity that is not
in the common starting state is therefore identified by its EVIDENCE: the smallest observation id
linked to it ('NEW:<oid>'). Every uuid of such an entity is rewritten to that key in EVERY field of
EVERY file before comparing. Entities of the starting state keep their uuid (they are shared).

Comparisons are MULTISETS of whole normalized rows (never totals), each reported with an
order-independent-by-construction fingerprint: md5 over the rows sorted by Python codepoint order.
"""
import csv, hashlib, json, re, sys
from collections import Counter

UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')


def read(path):
    with open(path, newline='') as f:
        r = csv.reader(f)
        header = next(r)
        return header, [tuple(row) for row in r]


def entity_key_map(d, start_ids):
    """uuid -> stable key for every entity NOT in the starting state, from its links."""
    hdr, links = read(f'{d}/links.csv')
    io, ie = hdr.index('home_signal_observation_id'), hdr.index('canonical_entity_id')
    first = {}
    for row in links:
        e, o = row[ie], row[io]
        if e not in start_ids and (e not in first or o < first[e]):
            first[e] = o
    _, ents = read(f'{d}/entities.csv')
    m = {}
    for row in ents:
        e = row[0]
        if e in start_ids:
            continue
        if e not in first:
            raise SystemExit(f'REFUSED: minted entity {e} has no linked observation; it cannot be keyed by evidence')
        m[e] = 'NEW:' + first[e]
    if len(set(m.values())) != len(m):
        raise SystemExit('REFUSED: two minted entities share an evidence key')
    return m


def normalize(rows, m):
    if not m:
        return rows
    sub = lambda s: UUID.sub(lambda x: m.get(x.group(0), x.group(0)), s)
    return [tuple(sub(v) for v in r) for r in rows]


def fp(rows):
    return hashlib.md5('\n'.join(sorted('\x1f'.join(r) for r in rows)).encode()).hexdigest()


def multiset_diff(a, b):
    ca, cb = Counter(a), Counter(b)
    return sum(((ca - cb) + (cb - ca)).values())


def load_side(d, start_ids):
    m = entity_key_map(d, start_ids)
    out = {}
    for name in ('entities', 'links', 'decisions', 'geo', 'map1'):
        try:
            hdr, rows = read(f'{d}/{name}.csv')
        except FileNotFoundError:
            continue
        out[name] = (hdr, normalize(rows, m))
    out['_minted'] = len(m)
    return out


def map1_facts(hdr, rows):
    iz, isk, ilat, ilng = hdr.index('zip'), hdr.index('source_key'), hdr.index('lat'), hdr.index('lng')
    by = {}
    for r in rows:
        z, pts = by.setdefault(r[isk], ([], []))
        z.append(r[iz]); pts.append((r[ilat], r[ilng]))
    return {k: (sorted(z), sorted(p)) for k, (z, p) in by.items()}


def compare_map1(a, b):
    (ha, ra), (hb, rb) = a, b
    if ha != hb:
        raise SystemExit(f'REFUSED: Map 1 column sets differ: {ha} vs {hb}')
    fa, fb = map1_facts(ha, ra), map1_facts(hb, rb)
    iz = ha.index('zip')
    return {
        'rows': [len(ra), len(rb)],
        'zip_pages': [len({r[iz] for r in ra}), len({r[iz] for r in rb})],
        'facilities': [len(fa), len(fb)],
        'fp': [fp(ra), fp(rb)],
        'row_diff': multiset_diff(ra, rb),
        'added': len(set(fb) - set(fa)),
        'removed': len(set(fa) - set(fb)),
        'moved': sum(1 for k in set(fa) & set(fb) if fa[k][1] != fb[k][1]),
        'zip_changed': sum(1 for k in set(fa) & set(fb) if fa[k][0] != fb[k][0]),
    }


def compare_table(a, b):
    (ha, ra), (hb, rb) = a, b
    if ha != hb:
        raise SystemExit(f'REFUSED: column sets differ: {ha} vs {hb}')
    return {'rows': [len(ra), len(rb)], 'fp': [fp(ra), fp(rb)], 'row_diff': multiset_diff(ra, rb)}


def compare(da, db, start_file, parts):
    start_ids = {r[0] for r in read(start_file)[1]}
    A, B = load_side(da, start_ids), load_side(db, start_ids)
    res = {'minted': [A['_minted'], B['_minted']]}
    for p in parts:
        if p not in A or p not in B:
            raise SystemExit(f'REFUSED: {p} missing on one side')
        res[p] = compare_map1(A[p], B[p]) if p == 'map1' else compare_table(A[p], B[p])
    if 'entities' in parts:
        res['identity_row_diff'] = sum(res[p]['row_diff'] for p in ('entities', 'links', 'decisions') if p in res)
    return res


def is_zero(res):
    """The zero-effect predicate used for the REAL result: every row diff 0, every fingerprint equal,
    and for Map 1 no added / removed / moved / ZIP-changed facility and equal totals."""
    for p, r in res.items():
        if not isinstance(r, dict):
            continue
        if r['row_diff'] != 0 or r['fp'][0] != r['fp'][1]:
            return False
        if p == 'map1' and (r['added'] or r['removed'] or r['moved'] or r['zip_changed']
                            or r['rows'][0] != r['rows'][1] or r['zip_pages'][0] != r['zip_pages'][1]
                            or r['facilities'][0] != r['facilities'][1]):
            return False
    return True


def matches(res, expected):
    """A positive control passes only if every expected value is observed EXACTLY."""
    for path, want in expected.items():
        cur = res
        for k in path.split('.'):
            cur = cur[int(k)] if isinstance(cur, list) else cur[k]
        if cur != want:
            return False
    return True


def main(argv):
    cmd = argv[1]
    if cmd == 'compare':      # compare DIR_A DIR_B START_FILE PARTS MODE [EXPECTED_JSON]
        da, db, start, parts, mode = argv[2], argv[3], argv[4], argv[5].split(','), argv[6]
        res = compare(da, db, start, parts)
        print(json.dumps(res, sort_keys=True))
        if mode == 'zero':
            return 0 if is_zero(res) else 3
        expected = json.loads(argv[7])
        ok = matches(res, expected) and not is_zero(res)
        print('CONTROL_EXPECTED ' + json.dumps(expected, sort_keys=True))
        print('CONTROL_DETECTED ' + ('true' if ok else 'false'))
        return 0 if ok else 4
    if cmd == 'gate':         # gate FILE  (key|value lines from the admission/evidence gate SQL)
        kv = dict(l.strip().split('|', 1) for l in open(argv[2]) if '|' in l)
        bad = []
        if kv.get('ATLAS_ADMITTED') != 'f': bad.append('ATLAS_ADMITTED=' + str(kv.get('ATLAS_ADMITTED')))
        if kv.get('ATLAS_EVIDENCE_ROWS') != '0': bad.append('ATLAS_EVIDENCE_ROWS=' + str(kv.get('ATLAS_EVIDENCE_ROWS')))
        if kv.get('EPOCH_EVIDENCE_ROWS', '0') == '0': bad.append('control: EPOCH_EVIDENCE_ROWS=0')
        print('GATE ' + ('PASS' if not bad else 'FAIL ' + ','.join(bad)))
        return 0 if not bad else 5
    raise SystemExit('usage')


if __name__ == '__main__':
    sys.exit(main(sys.argv))
