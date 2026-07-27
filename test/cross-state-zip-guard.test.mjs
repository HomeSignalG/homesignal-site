// cross-state ZIP modeling guard — regression tests.
//
// Every fixture below is the REAL shape of a row that shipped to production, taken
// from docs/cross-state-zip-repair-seed.sql. The PRE-REPAIR fixtures are the exact
// modeling that served El Paso, Texas news on 23 genuine New Mexico ZIP pages; the
// POST-REPAIR fixtures are what production carries now. So none of these is a
// tautology about a function existing — the pre-repair set FAILS and the
// post-repair set PASSES, which is the whole point of the guard.
//
// Run: node test/cross-state-zip-guard.test.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadZipStateCrosswalk,
  assertQuarantineIsHonest,
  checkZipStateIntegrity,
  QUARANTINED_ZCTA_ONLY,
} from '../scripts/lib/zip-state-crosswalk.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const crosswalk = loadZipStateCrosswalk(path.join(root, 'docs/zip-state-v3.csv'));

// ── The crosswalk itself ───────────────────────────────────────────────────────
ok(crosswalk.size > 40000, `crosswalk loaded (${crosswalk.size} ZIPs)`);
ok(crosswalk.get('79922') === 'TX', '79922 is authoritatively TX (El Paso), not NM');
ok(crosswalk.get('79835') === 'TX', '79835 is authoritatively TX (Canutillo), not NM');
ok(crosswalk.get('84536') === 'UT', '84536 is authoritatively UT (Monument Valley), not AZ');
ok(crosswalk.get('88001') === 'NM', '88001 (Las Cruces) is genuinely NM — the guard must not touch it');

// ── Quarantine list is explicit, named, and honest ─────────────────────────────
ok(Object.keys(QUARANTINED_ZCTA_ONLY).length === 2, 'exactly two quarantined ZCTA-only ZIPs');
ok('84684' in QUARANTINED_ZCTA_ONLY && '84685' in QUARANTINED_ZCTA_ONLY, 'quarantine names 84684 and 84685');
ok(!crosswalk.has('84684') && !crosswalk.has('84685'), 'both quarantined ZIPs really are ABSENT from the crosswalk');
try { assertQuarantineIsHonest(crosswalk); ok(true, 'assertQuarantineIsHonest passes on the real crosswalk'); }
catch (e) { ok(false, 'assertQuarantineIsHonest passes on the real crosswalk: ' + e.message); }
// …and it must REFUSE to let the list hide a ZIP the dataset actually knows.
try {
  assertQuarantineIsHonest(new Map([...crosswalk, ['84684', 'UT']]));
  ok(false, 'assertQuarantineIsHonest rejects a quarantine entry that exists in the crosswalk');
} catch (e) {
  ok(/stale/i.test(e.message), 'assertQuarantineIsHonest rejects a quarantine entry that exists in the crosswalk');
}

// ── Fixtures ───────────────────────────────────────────────────────────────────
const donaAna   = { id: 'r-nm-dona-ana', name: 'Doña Ana County', slug: 'dona-ana-county-nm', level: 'county', state: 'NM', county: 'Doña Ana', parent_id: null, zip_codes: [] };
const elPasoTx  = { id: 'r-tx-el-paso',  name: 'El Paso County',  slug: 'el-paso-county-tx',  level: 'county', state: 'TX', county: 'El Paso',  parent_id: null, zip_codes: [] };
const navajoAz  = { id: 'r-az-navajo',   name: 'Navajo County',   slug: 'navajo-county-az',   level: 'county', state: 'AZ', county: 'Navajo',   parent_id: null, zip_codes: [] };
const sanJuanUt = { id: 'r-ut-san-juan', name: 'San Juan County', slug: 'san-juan-county-ut', level: 'county', state: 'UT', county: 'San Juan', parent_id: null, zip_codes: [] };
const whitmanWa = { id: 'r-wa-whitman',  name: 'Whitman County',  slug: 'whitman-county-wa',  level: 'county', state: 'WA', county: 'Whitman',  parent_id: null, zip_codes: [] };
const latahId   = { id: 'r-id-latah',    name: 'Latah County',    slug: 'latah-county-id',    level: 'county', state: 'ID', county: 'Latah',    parent_id: null, zip_codes: [] };
const boxElder  = { id: 'r-ut-box-elder',name: 'Box Elder County',slug: 'box-elder-county-ut',level: 'county', state: 'UT', county: 'Box Elder',parent_id: null, zip_codes: [] };

const zipPage = (id, name, state, county, parent, zip) =>
  ({ id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), level: 'zip', state, county, parent_id: parent, zip_codes: [zip] });

const ruleSet = (vs, zip) => new Set(vs.filter((v) => v.zip === zip).map((v) => v.rule));

// ── 1. PRE-REPAIR: the exact production modeling that caused the incident ───────
// This is the proof the verifier WOULD HAVE FAILED before the 19-ZIP repair.
{
  const pre = [
    { ...donaAna, zip_codes: ['79835', '79922', '88001'] },   // NM county claiming two TX ZIPs
    { ...navajoAz, zip_codes: ['84536'] },                    // AZ county claiming a UT ZIP
    { ...latahId,  zip_codes: ['99128'] },                    // ID county claiming a WA ZIP
    elPasoTx, sanJuanUt, whitmanWa,
    zipPage('z-79922', 'El Paso (79922)',        'NM', 'Doña Ana', 'r-nm-dona-ana', '79922'),
    zipPage('z-79835', 'Canutillo (79835)',      'NM', 'Doña Ana', 'r-nm-dona-ana', '79835'),
    zipPage('z-84536', 'Monument Valley (84536)','AZ', 'Navajo',   'r-az-navajo',   '84536'),
    zipPage('z-99128', 'Farmington (99128)',     'ID', 'Latah',    'r-id-latah',    '99128'),
    zipPage('z-88001', 'Las Cruces (88001)',     'NM', 'Doña Ana', 'r-nm-dona-ana', '88001'),
  ];
  const v = checkZipStateIntegrity(pre, crosswalk);
  ok(v.length > 0, 'PRE-REPAIR model FAILS the guard (it would have caught the incident)');

  for (const [zip, label] of [['79922', 'ZIP 79922'], ['79835', 'ZIP 79835'], ['84536', 'ZIP 84536'], ['99128', 'ZIP 99128 (new-county-root case)']]) {
    const rules = ruleSet(v, zip);
    ok(rules.has('zip-state-mismatch'),        `${label}: modeled state flagged`);
    ok(rules.has('root-state-mismatch'),       `${label}: wrong-state root flagged`);
    ok(rules.has('wrong-state-county-claim'),  `${label}: wrong-state county claim flagged`);
  }
  ok(ruleSet(v, '88001').size === 0, 'ordinary valid ZIP 88001 (Las Cruces, NM) is NOT flagged in the broken model');
}

// ── 2. POST-REPAIR: what production carries now — must be clean ─────────────────
{
  const post = [
    { ...donaAna, zip_codes: ['88001'] },
    { ...elPasoTx, zip_codes: [] },              // models coverage via child ZIP pages only
    { ...sanJuanUt, zip_codes: ['84536'] },      // models coverage in its array
    { ...whitmanWa, zip_codes: ['99128'] },      // newly-created county root
    navajoAz, latahId,
    zipPage('z-79922', 'El Paso (79922)',        'TX', 'El Paso',  'r-tx-el-paso',  '79922'),
    zipPage('z-79835', 'Canutillo (79835)',      'TX', 'El Paso',  'r-tx-el-paso',  '79835'),
    zipPage('z-84536', 'Monument Valley (84536)','UT', 'San Juan', 'r-ut-san-juan', '84536'),
    zipPage('z-99128', 'Farmington (99128)',     'WA', 'Whitman',  'r-wa-whitman',  '99128'),
    zipPage('z-88001', 'Las Cruces (88001)',     'NM', 'Doña Ana', 'r-nm-dona-ana', '88001'),
  ];
  const v = checkZipStateIntegrity(post, crosswalk);
  ok(v.length === 0, 'POST-REPAIR model PASSES the guard — 0 violations' + (v.length ? ': ' + JSON.stringify(v) : ''));
}

// ── 3. Each rule fires independently (no rule is dead code) ────────────────────
{
  // Rule 1 only: ZIP page state wrong, root right.
  const v1 = checkZipStateIntegrity(
    [elPasoTx, zipPage('z', 'El Paso (79922)', 'NM', 'El Paso', 'r-tx-el-paso', '79922')], crosswalk);
  ok(ruleSet(v1, '79922').has('zip-state-mismatch') && !ruleSet(v1, '79922').has('root-state-mismatch'),
     'rule 1 fires alone when only the ZIP row state is wrong');

  // Rule 2 only: ZIP page state right, root in another state.
  const v2 = checkZipStateIntegrity(
    [donaAna, zipPage('z', 'El Paso (79922)', 'TX', 'El Paso', 'r-nm-dona-ana', '79922')], crosswalk);
  ok(ruleSet(v2, '79922').has('root-state-mismatch') && !ruleSet(v2, '79922').has('zip-state-mismatch'),
     'rule 2 fires alone when only the root state is wrong');

  // Rule 3 only: page + root correct, but a foreign-state county still claims it.
  const v3 = checkZipStateIntegrity(
    [elPasoTx, { ...donaAna, zip_codes: ['79922'] },
     zipPage('z', 'El Paso (79922)', 'TX', 'El Paso', 'r-tx-el-paso', '79922')], crosswalk);
  ok(ruleSet(v3, '79922').has('wrong-state-county-claim'), 'rule 3 fires on a stale wrong-state county claim');

  // Rule 4: claimed by county roots in two different states.
  const v4 = checkZipStateIntegrity(
    [{ ...elPasoTx, zip_codes: ['79922'] }, { ...donaAna, zip_codes: ['79922'] },
     zipPage('z', 'El Paso (79922)', 'TX', 'El Paso', 'r-tx-el-paso', '79922')], crosswalk);
  ok(ruleSet(v4, '79922').has('multi-state-county-claim'), 'rule 4 fires when two states both claim one ZIP');

  // Broken parent chain is reported, not crashed on.
  const v5 = checkZipStateIntegrity(
    [zipPage('z', 'El Paso (79922)', 'TX', 'El Paso', 'does-not-exist', '79922')], crosswalk);
  ok(ruleSet(v5, '79922').has('broken-parent-chain'), 'a dangling parent_id is reported as a violation');

  // An unknown ZIP that is NOT a named quarantine entry must fail closed.
  const v6 = checkZipStateIntegrity(
    [boxElder, zipPage('z', 'Nowhere (99999)', 'UT', 'Box Elder', 'r-ut-box-elder', '99999')], crosswalk);
  ok(ruleSet(v6, '99999').has('zip-not-in-crosswalk'), 'an unknown, un-quarantined ZIP fails closed');
}

// ── 4. Quarantined ZIPs are exempt from the state rules but NOT from the rest ──
{
  const q = [boxElder, zipPage('z', 'Quarantined (84684)', 'UT', 'Box Elder', 'r-ut-box-elder', '84684')];
  ok(checkZipStateIntegrity(q, crosswalk).length === 0,
     'quarantined 84684 is exempt from the state assertion (no authoritative value exists)');

  // …but a quarantined ZIP claimed by two states is still an internal contradiction.
  const qBad = [
    { ...boxElder, zip_codes: ['84684'] }, { ...navajoAz, zip_codes: ['84684'] },
    zipPage('z', 'Quarantined (84684)', 'UT', 'Box Elder', 'r-ut-box-elder', '84684'),
  ];
  ok(ruleSet(checkZipStateIntegrity(qBad, crosswalk), '84684').has('multi-state-county-claim'),
     'a quarantined ZIP claimed across two states is STILL flagged (exemption is narrow)');
}

console.log(fails ? `\n${fails} assertion(s) failed` : '\nAll cross-state ZIP guard assertions passed.');
process.exit(fails ? 1 : 0);
