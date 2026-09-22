// STEP 3C reconciliation — the pure core, the shipped-classifier wiring, and the pins that
// keep the ledger's candidate filter a SUPERSET of what the classifier can accept.
//
// Every app_projects row below is VERBATIM from production (pulled 2026-09-22) unless marked
// synthetic. Run: node test/dc-step3c-reconcile.test.mjs
import fs from 'node:fs';
import {
  reconcile, shippedClassifier, DISPOSITIONS, EXCLUSIONS, POPULATIONS, SUPERSET_SQL,
} from '../scripts/dc-step3c-reconcile.mjs';

let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (c || !detail ? '' : '  :: ' + detail)); if (!c) fails++; };

const isResidentDC = await shippedClassifier();
const legacy = (key, kind, inp, extra = {}) => ({
  record_key: key, has_source_native_key: true,
  source_population: kind === 'facility' ? 'legacy_facility' : 'legacy_development',
  record_grain: kind === 'facility' ? 'FACILITY_REGISTRATION' : 'DEVELOPMENT_FILING',
  resident_storage_plane: 'app_projects', resident_reachable: true, osm_map_eligible: null,
  classifier_inputs: [Object.assign({ record_kind: kind }, inp)], dc_source_key: null,
  source_observation_id: null, ...extra,
});
const osm = (key, reach, elig, extra = {}) => ({
  record_key: key, has_source_native_key: true, source_population: 'osm', record_grain: 'PHYSICAL_SITE',
  resident_storage_plane: 'national_dc_records', resident_reachable: reach, osm_map_eligible: elig,
  classifier_inputs: null, dc_source_key: null, source_observation_id: null, ...extra,
});

// ── 1. The shipped classifier, on the rows where the resident paths DISAGREE ──────────────────
const netrality = legacy('epa_frs:110071064066', 'facility', { type: 'datacenter', name: 'NETRALITY DATA CENTER', status: 'Operating', registry_id: '110071064066' });
const cyrus = legacy('epa_frs:110038203734', 'facility', { type: 'energy', name: 'CYRUS ONE DATA HALL 1 POWER POD 1', status: 'Operating', registry_id: '110038203734' });
const austin = legacy('socrata:data.austintexas.gov:mavg-96ck:SP-2011-0344D', 'development', { type: 'unclassified', type_raw: 'Data Center', name: 'Hewlett Packard- Site 2 EcoPOD', status: 'Approved' });
const boston = legacy('arcgis:massdot-highway-projects:607590', 'development', { type: 'Utility', type_raw: 'Vertical Construction (Ch 149)', name: 'BOSTON- DATA CENTER & HVAC EXPANSION & UPGRADES AT HQ BOSTON', status: 'Operating' });
const heat = legacy('arcgis:jackson-county-or-building-permits:439-25-000349-MECH', 'development', { type: 'Residential', type_raw: 'Residential', name: 'Residential Replacing existing Heap Pump system with new Mitsubishi Hyper Heat equipment.', status: 'Approved' });
const otherProj = legacy('synthetic:other-project', 'development', { type: 'other project', type_raw: null, name: 'Data Center Parkway Office', status: 'Proposed' });

ok(isResidentDC(netrality).dc, '1a EPA FRS facility stamped datacenter is resident DC');
ok(!isResidentDC(cyrus).dc,
  '1b a FACILITY is never run through the development-only site path (the harness defect that manufactured 366 from 365)',
  JSON.stringify(isResidentDC(cyrus)));
ok(isResidentDC(austin).dc && isResidentDC(austin).paths.includes('raw') && !isResidentDC(austin).paths.includes('site'),
  '1c type_raw "Data Center" is DC on the RAW path only (Map 1 site path does not map type_raw)', JSON.stringify(isResidentDC(austin)));
ok(isResidentDC(boston).dc, '1d a DC stated in the name under a coarse type is DC');
ok(!isResidentDC(heat).dc, '1e a "Hyper Heat" heat-pump permit is a superset candidate and NOT a DC');

// ── 2. The superset pins ─────────────────────────────────────────────────────────────────
const ddl = fs.readFileSync(new URL('../docs/dc-step3c-ledger-distinct-record-grain.sql', import.meta.url), 'utf8');
const viewFilter = (ddl.match(/where p\.type\s+~\* '([^']+)'/) || [])[1];
const scriptFilter = (SUPERSET_SQL.match(/p\.type ~\* '([^']+)'/) || [])[1];
ok(viewFilter && viewFilter === scriptFilter, '2a the report counts the SAME superset the view filters (one filter, not two)', `${viewFilter} vs ${scriptFilter}`);
ok((ddl.match(/data\[\^a-z\]\{0,3\}\(cent\|hall\)\|hyper\|server/g) || []).length === 3,
  '2b the view applies that filter to exactly type, type_raw and name');
const superset = new RegExp(viewFilter || 'NO_FILTER_FOUND', 'i');
// Every spelling the shipped classifier accepts must be a superset candidate, or the ledger
// silently omits resident data centres. Probed through the REAL classifier on every class field.
const spellings = ['data center', 'Data Centre', 'DATA CENTER', 'datacenter', 'data-center', 'data_center',
  'data  centre', 'Data Hall', 'datahall', 'hyperscale', 'Hyperscale campus', 'server farm', 'serverfarm', 'data cente'];
let accepted = 0;
for (const s of spellings) {
  for (const field of ['type', 'type_raw', 'name']) {
    const r = legacy('synthetic:' + field + s, 'development', { type: 'Commercial', [field]: s, name: field === 'name' ? s : 'x', status: 'Proposed' });
    if (isResidentDC(r).dc) {
      accepted++;
      ok(superset.test(s), `2c "${s}" in ${field} is accepted by the shipped classifier and IS a superset candidate`);
    }
  }
}
ok(accepted >= 20, `2d the spelling probe exercised the classifier (${accepted} acceptances; a probe that accepts nothing proves nothing)`);
ok(!superset.test('Residential') && !superset.test('Solar Farm'), '2e the superset is not everything (control)');

// ── 3. The pure core ─────────────────────────────────────────────────────────────────────
const ledger = [netrality, cyrus, austin, boston, heat, otherProj,
  osm('way/1', true, true), osm('way/2', false, true), osm('node/3', false, false)];
const controls = { app_projects_candidate_identities: 6, national_dc_records_rows: 3, osm_reachable_via_rpc: 1 };
const base = reconcile(ledger, { isResidentDC, controls });
ok(base.problems.length === 0, '3a a well-formed ledger reconciles with no problems', JSON.stringify(base.problems));
ok(base.summary.RESIDENT_TOTAL === 4, '3b RESIDENT_TOTAL counts only resident DC truth (netrality, austin, boston, way/1)', JSON.stringify(base.summary));
ok(base.summary.UNRESOLVED_BLOCKER === 4 && base.summary.BACKED_BY_CANONICAL_EVIDENCE === 0, '3c unregistered sources are UNRESOLVED_BLOCKER, never "reacquirable"');
ok(base.summary.EXCLUSIONS.NOT_DC_ON_ANY_SHIPPED_READER === 3 && base.summary.EXCLUSIONS.OSM_SERVED_TO_NO_ADMITTED_ZIP === 1
   && base.summary.EXCLUSIONS.OSM_NEVER_SERVED_NOT_MAP_ELIGIBLE === 1, '3d every excluded identity carries its reason');
const sum = DISPOSITIONS.reduce((a, d) => a + base.summary[d], 0);
ok(sum === base.summary.RESIDENT_TOTAL, '3e SUM(dispositions) == RESIDENT_TOTAL');
ok(sum + Object.values(base.summary.EXCLUSIONS).reduce((a, b) => a + b, 0) === ledger.length, '3f dispositions + exclusions == ledger identities');
ok(base.summary.SAFE_FOR_CANONICAL_CUTOVER === 0 && base.summary.BLOCKING_CANONICAL_CUTOVER === 4, '3g accounted is not cutover-safe');

const linked = reconcile([...ledger.slice(0, 8), osm('node/3', false, false)].map((r) => r.record_key === 'way/1' ? { ...r, source_observation_id: '00000000-0000-0000-0000-000000000001', dc_source_key: 'openstreetmap' } : r), { isResidentDC, controls });
ok(linked.summary.BACKED_BY_CANONICAL_EVIDENCE === 1, '3h a scoped evidence link makes a record BACKED');

// ── 4. The refusals (each is a Step 3C mutation target) ───────────────────────────────────
const has = (res, re) => res.problems.some((p) => re.test(p));
ok(has(reconcile(ledger.filter((r) => r.record_key !== 'epa_frs:110071064066'), { isResidentDC, controls }), /omitted or invented/),
  '4a M8 an OMITTED resident record fails against the independent source control');
ok(has(reconcile(ledger, { isResidentDC }), /no independent source controls/), '4b no controls is a refusal, not a pass');
ok(has(reconcile(ledger.filter((r) => r.source_population !== 'osm'), { isResidentDC, controls: { ...controls, national_dc_records_rows: 0, osm_reachable_via_rpc: 0 } }), /population osm is ABSENT/),
  '4c M18 a whole record class removed fails even when every control is lowered to match');
ok(has(reconcile([...ledger, ledger[0]], { isResidentDC, controls: { ...controls, app_projects_candidate_identities: 7 } }), /DUPLICATE_DENOMINATOR_ROWS/),
  '4d a ZIP fan-out duplicate cannot become another data centre');
ok(has(reconcile([...ledger, { ...osm('x/1', true, true), source_population: 'gov_event' }], { isResidentDC, controls }), /UNCLASSIFIED_RESIDENT_GRAINS/),
  '4e an unknown grain (e.g. a government meeting) cannot enter the denominator');
ok(has(reconcile(ledger.map((r) => r.record_key === 'node/3' ? { ...r, resident_reachable: true } : r), { isResidentDC, controls: { ...controls, osm_reachable_via_rpc: 2 } }), /not map_eligible/),
  '4f an unreachable storage record cannot be called resident-facing');
ok(has(reconcile(ledger, { isResidentDC, controls: { ...controls, osm_reachable_via_rpc: 2 } }), /the RPC returns 2/),
  '4g reachability disagreeing with the shipped RPC fails');
ok(has(reconcile(ledger.map((r) => r.record_key === 'way/1' ? { ...r, dc_source_key: 'openstreetmap' } : r), { isResidentDC, controls }), /UNEXPLAINED = 1/),
  '4h a registered source with no current observation is UNEXPLAINED, never silently resolved');
ok(has(reconcile([], { isResidentDC, controls }), /0 rows/), '4i an empty ledger is a failed read');
ok(Object.keys(POPULATIONS).length === 3 && EXCLUSIONS.length === 3 && DISPOSITIONS.length === 8, '4j the vocabularies are closed at their declared sizes');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
