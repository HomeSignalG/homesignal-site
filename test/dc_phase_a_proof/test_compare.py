#!/usr/bin/env python3
"""Offline tests of scripts/dc_phase_a_proof.py — the comparator the Phase A proof relies on.
Every detection class the production run's positive controls exercise is pinned here too, on
synthetic data with a known answer, so a comparator that quietly stops detecting fails offline
before it ever reads production. Run: python3 test/dc_phase_a_proof/test_compare.py"""
import csv, os, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import dc_phase_a_proof as P  # noqa: E402

S1 = '11111111-1111-4111-8111-111111111111'   # start-state entities (shared uuid)
S2 = '22222222-2222-4222-8222-222222222222'
O1, O2, O3, O4 = ('aaaaaaaa-0000-4000-8000-00000000000%d' % i for i in (1, 2, 3, 4))
MA = 'bbbbbbbb-0000-4000-8000-00000000000a'   # minted on side A
MB = 'cccccccc-0000-4000-8000-00000000000b'   # the SAME entity minted on side B (different uuid)

MAP_H = ['zip', 'source_key', 'lat', 'lng', 'canonical_entity_id', 'publication_basis']


def side(minted, *, cls='CONFIRMED_DC', flags='{}', map_rows=None, links_extra=(), decisions=None):
    d = tempfile.mkdtemp()
    def w(name, header, rows):
        with open(f'{d}/{name}.csv', 'w', newline='') as f:
            wr = csv.writer(f); wr.writerow(header); wr.writerows(rows)
    w('entities', ['canonical_entity_id', 'classification'], [(S1, cls), (S2, 'DC_CANDIDATE'), (minted, 'DC_CANDIDATE')])
    w('links', ['home_signal_observation_id', 'canonical_entity_id', 'link_rule_key'],
      [(O1, S1, 'R0'), (O2, S2, 'R0'), (O3, minted, 'R0')] + list(links_extra))
    w('decisions', ['observation_a', 'observation_b', 'decision_state'], decisions or [(O1, O3, 'CONFIRMED_DISTINCT')])
    w('geo', ['canonical_entity_id', 'lat', 'lng', 'quality_flags'],
      [(S1, '40.1', '-75.1', flags), (S2, '41.2', '-76.2', '{}'), (minted, '42.3', '-77.3', '{}')])
    w('map1', MAP_H, map_rows if map_rows is not None else [
        ('19001', 'dc:' + S1, '40.1', '-75.1', S1, 'canonical'),
        ('19002', 'dc:' + S2, '41.2', '-76.2', S2, 'canonical'),
        ('19003', 'dc:' + minted, '42.3', '-77.3', minted, 'canonical'),
        ('19004', 'osm:9', '43.4', '-78.4', '', 'legacy_osm_compat')])
    return d


def start_file():
    f = tempfile.mktemp(suffix='.csv')
    with open(f, 'w', newline='') as h:
        wr = csv.writer(h); wr.writerow(['canonical_entity_id']); wr.writerows([[S1], [S2]])
    return f


ALL = ['entities', 'links', 'decisions', 'geo', 'map1']


class Compare(unittest.TestCase):
    def setUp(self):
        self.start = start_file()

    def run_(self, a, b, parts=ALL):
        return P.compare(a, b, self.start, parts)

    def test_same_evidence_different_minted_uuid_is_zero(self):
        r = self.run_(side(MA), side(MB))
        self.assertTrue(P.is_zero(r), r)
        self.assertEqual(r['minted'], [1, 1])

    def test_map1_one_moved_row(self):
        a = side(MA); b = side(MB, map_rows=[
            ('19001', 'dc:' + S1, '40.10001', '-75.1', S1, 'canonical'),
            ('19002', 'dc:' + S2, '41.2', '-76.2', S2, 'canonical'),
            ('19003', 'dc:' + MB, '42.3', '-77.3', MB, 'canonical'),
            ('19004', 'osm:9', '43.4', '-78.4', '', 'legacy_osm_compat')])
        r = self.run_(a, b, ['map1'])['map1']
        self.assertEqual((r['row_diff'], r['moved'], r['zip_changed'], r['added'], r['removed']), (2, 1, 0, 0, 0))
        self.assertFalse(P.is_zero({'map1': r}))

    def test_equal_totals_swap_is_detected(self):
        a = side(MA); b = side(MB, map_rows=[
            ('19002', 'dc:' + S1, '41.2', '-76.2', S1, 'canonical'),
            ('19001', 'dc:' + S2, '40.1', '-75.1', S2, 'canonical'),
            ('19003', 'dc:' + MB, '42.3', '-77.3', MB, 'canonical'),
            ('19004', 'osm:9', '43.4', '-78.4', '', 'legacy_osm_compat')])
        r = self.run_(a, b, ['map1'])['map1']
        self.assertEqual(r['rows'][0], r['rows'][1]); self.assertEqual(r['zip_pages'][0], r['zip_pages'][1])
        self.assertEqual(r['facilities'][0], r['facilities'][1])
        self.assertEqual((r['moved'], r['zip_changed'], r['row_diff']), (2, 2, 4))
        self.assertFalse(P.is_zero({'map1': r}))

    def test_added_and_removed(self):
        rows = [('19001', 'dc:' + S1, '40.1', '-75.1', S1, 'canonical'),
                ('19002', 'dc:' + S2, '41.2', '-76.2', S2, 'canonical'),
                ('19003', 'dc:' + MB, '42.3', '-77.3', MB, 'canonical'),
                ('19005', 'osm:10', '44.4', '-79.4', '', 'legacy_osm_compat')]
        r = self.run_(side(MA), side(MB, map_rows=rows), ['map1'])['map1']
        self.assertEqual((r['added'], r['removed']), (1, 1))

    def test_identity_difference(self):
        r = self.run_(side(MA), side(MB, cls='DC_CANDIDATE'), ['entities', 'links', 'decisions'])
        self.assertEqual(r['identity_row_diff'], 2)
        self.assertFalse(P.is_zero(r))

    def test_minted_entity_with_different_evidence_is_a_difference(self):
        r = self.run_(side(MA), side(MB, links_extra=[(O4, MB, 'R0')]), ['entities', 'links', 'decisions'])
        self.assertEqual(r['links']['row_diff'], 1)
        self.assertEqual(r['identity_row_diff'], 1)   # the identity total must include links
        self.assertFalse(P.is_zero(r))

    def test_geography_difference(self):
        r = self.run_(side(MA), side(MB, flags='{PROOF_CONTROL}'), ['geo'])
        self.assertEqual(r['geo']['row_diff'], 2)
        self.assertFalse(P.is_zero(r))

    def test_multiplicity_is_counted(self):
        r = self.run_(side(MA), side(MB, decisions=[(O1, O3, 'CONFIRMED_DISTINCT'), (O1, O3, 'CONFIRMED_DISTINCT')]), ['decisions'])
        self.assertEqual(r['decisions']['row_diff'], 1)

    def test_fingerprint_is_order_independent_and_content_sensitive(self):
        a = [('1', 'x'), ('2', 'y')]
        self.assertEqual(P.fp(a), P.fp(list(reversed(a))))
        self.assertNotEqual(P.fp(a), P.fp([('1', 'x'), ('2', 'z')]))
        self.assertNotEqual(P.fp(a), P.fp(a + [('2', 'y')]))
        r = self.run_(side(MA), side(MB, flags='{X}'), ['geo'])['geo']
        self.assertNotEqual(r['fp'][0], r['fp'][1])

    def test_is_zero_refuses_each_map1_signal_on_its_own(self):
        base = {'row_diff': 0, 'fp': ['a', 'a'], 'added': 0, 'removed': 0, 'moved': 0, 'zip_changed': 0,
                'rows': [5, 5], 'zip_pages': [3, 3], 'facilities': [5, 5]}
        self.assertTrue(P.is_zero({'map1': dict(base)}))
        for k, v in (('added', 1), ('removed', 1), ('moved', 1), ('zip_changed', 1), ('rows', [5, 6]),
                     ('zip_pages', [3, 4]), ('facilities', [5, 4]), ('fp', ['a', 'b']), ('row_diff', 2)):
            self.assertFalse(P.is_zero({'map1': dict(base, **{k: v})}), k)

    def test_control_must_match_exactly(self):
        r = {'map1': {'row_diff': 2, 'moved': 1}}
        self.assertTrue(P.matches(r, {'map1.row_diff': 2, 'map1.moved': 1}))
        self.assertFalse(P.matches(r, {'map1.row_diff': 2, 'map1.moved': 2}))

    def gate(self, text):
        f = tempfile.mktemp()
        open(f, 'w').write(text)
        return subprocess.run([sys.executable, os.path.join(ROOT, 'scripts/dc_phase_a_proof.py'), 'gate', f],
                              capture_output=True, text=True).returncode

    def test_gate(self):
        self.assertEqual(self.gate('ATLAS_ADMITTED|f\nATLAS_EVIDENCE_ROWS|0\nEPOCH_EVIDENCE_ROWS|31\n'), 0)
        self.assertEqual(self.gate('ATLAS_ADMITTED|t\nATLAS_EVIDENCE_ROWS|0\nEPOCH_EVIDENCE_ROWS|31\n'), 5)
        self.assertEqual(self.gate('ATLAS_ADMITTED|f\nATLAS_EVIDENCE_ROWS|4\nEPOCH_EVIDENCE_ROWS|31\n'), 5)
        self.assertEqual(self.gate('ATLAS_ADMITTED|f\nATLAS_EVIDENCE_ROWS|0\nEPOCH_EVIDENCE_ROWS|0\n'), 5)

    def test_cli_zero_and_control_modes(self):
        py = [sys.executable, os.path.join(ROOT, 'scripts/dc_phase_a_proof.py'), 'compare']
        a, b = side(MA), side(MB)
        self.assertEqual(subprocess.run(py + [a, b, self.start, 'map1', 'zero'], capture_output=True).returncode, 0)
        c = side(MB, flags='{X}')
        self.assertEqual(subprocess.run(py + [a, c, self.start, 'geo', 'zero'], capture_output=True).returncode, 3)
        ok = subprocess.run(py + [a, c, self.start, 'geo', 'control', '{"geo.row_diff": 2}'], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0); self.assertIn('CONTROL_DETECTED true', ok.stdout)
        # a control whose mutation is NOT observed must fail
        miss = subprocess.run(py + [a, b, self.start, 'geo', 'control', '{"geo.row_diff": 2}'], capture_output=True, text=True)
        self.assertEqual(miss.returncode, 4); self.assertIn('CONTROL_DETECTED false', miss.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=1)
