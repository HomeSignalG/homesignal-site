// A MAPS capture whose two scope records disagree is NOT bound, and the capture job now
// records ONE scope in both places.
//
// Measured 2026-09-22 on production row aba59030 (MAPS · Data Center Theme, 64165, RBC Data
// Center Campus): a ZIP-map fallback stored `visual.scope = 'zip'` beside
// `visual.capture_policy.scope = 'project'`. The second came from
// `HS.mapsDcCapturePolicyRecord`, which defaults to 'project' when told nothing — and
// neither capture path told it anything. `mapsCaptureBound` read the first and unlocked
// Approve; public.hs_maps_dc_capture_policy_violations reads the second, demands a target
// the ZIP map never sought, and refuses at the trigger. The founder would have seen an
// enabled button that fails on click.
//
// Run: node test/maps-capture-scope-conflict.test.mjs
import { readFileSync } from 'node:fs';

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m); } };

globalThis.window = globalThis.window || globalThis;
globalThis.document = globalThis.document || { getElementById: () => null, querySelectorAll: () => [] };
for (const f of ['../lib/map.js', '../lib/maps-social-theme.js', '../lib/maps-capture-policy.js',
                 '../lib/maps-capture-binding.js']) {
  (0, eval)(readFileSync(new URL(f, import.meta.url), 'utf8'));
}
const HS = globalThis.window.HS;

const SNAP = {
  statuses: { operating: true, approved: true, proposed: true, unknown: true },
  types: { datacenter: true, industrial: false, residential: false, infrastructure: false,
    commercial: false, civic: false, other: false },
  regulatory: false,
};
const policy = (scope) => ({
  policy: 'dc-map-state@1',
  ...(scope ? { scope } : {}),
  applied: SNAP, final: SNAP,
  rendered: { target_on_map: false, target_sought: false, on_map_total: 7,
    non_datacenter_development_on_map: 0, regulatory_only_on_map: 0,
    regulatory_badges_drawn: 0, dual_identity_target: false },
});

// The production row's evidence, verbatim where it matters to the key.
function row64165(cpScope, visualScope = 'zip') {
  const r = {
    id: 'aba59030-c58e-4f17-ab40-ca098151465f', content_family: 'MAPS', tile: 'development',
    status: 'draft', zip: '64165', image_bucket_path: 'maps/64165/zip-1t2hdb81ohkw.png',
    evidence: {
      lat: 39.3201689806401, lng: -94.5762390223065, type: 'Development', theme: 'datacenter',
      status: 'Proposed', project_id: '70c74c56-cb9e-4925-bf48-43f7650f5d3b',
      source_key: 'arcgis:kcmo-development-cases:CD-CPC-2026-00142',
      project_name: 'RBC Data Center Campus Major Amendment This is a revision to the PMPD plan (CD-AA-2026-00054) approved on May 29, 2026. ',
      visual: { scope: visualScope, state: 'REAL_MAP_VISUAL', capture_policy: policy(cpScope) },
    },
  };
  r.evidence.visual.capture_key = HS.mapsCaptureKey(r, 'zip');
  return r;
}

// ── §0 CONTROLS ─────────────────────────────────────────────────────────────────────────
{
  const r = row64165('project');
  ok(r.evidence.visual.capture_key === 'v1|64165|zip-scope|datacenter|dc-map-state@1',
    '0a: the fixture reproduces the production capture key byte for byte');
  ok(HS.mapsDcCapturePolicyEvidence(r.evidence.visual).ok === true,
    '0b: the map-state evidence itself passes the JS policy check — the conflict is the ONLY defect');
  ok(HS.mapsCaptureBound(row64165('zip')) === true,
    '0c: control — the same row with ONE consistent scope is bound (ZIP fallback is legitimate)');
}

// ── §1 THE CONFLICT IS REFUSED ──────────────────────────────────────────────────────────
{
  const r = row64165('project');
  ok(HS.mapsCaptureScopeConflict(r.evidence.visual) === true, '1a: the conflict is detected');
  ok(HS.mapsCaptureBound(r) === false, '1b: a self-contradicting scope record is NOT bound');
  ok(HS.mapsCaptureState(r) !== HS.MAPS_CAPTURE_STATES.READY, '1c: and does not report READY');
  const gate = HS.mapsMapGateBlock(r);
  ok(!!gate && /two different scopes \(zip on the picture, project in its map-state record\)/.test(gate),
    '1d: the Approve gate blocks and names the actual reason');
  ok(HS.mapsCaptureDue(r, Date.now()).due === true,
    '1e: the capture job treats it as due, so it is re-photographed rather than stuck');
}

// ── §2 WHAT IS NOT A CONFLICT ───────────────────────────────────────────────────────────
{
  ok(HS.mapsCaptureScopeConflict({ scope: 'zip' }) === false, '2a: visual scope alone');
  ok(HS.mapsCaptureScopeConflict({ capture_policy: { scope: 'zip' } }) === false, '2b: policy scope alone');
  ok(HS.mapsCaptureScopeConflict({ scope: 'zip', capture_policy: { scope: 'zip' } }) === false, '2c: both equal');
  ok(HS.mapsCaptureScopeConflict(null) === false && HS.mapsCaptureScopeConflict({}) === false, '2d: absent');
  // The 18 absence captures in production carry NO capture_policy.scope. They must stay bound.
  const absence = {
    content_family: 'MAPS', tile: 'development', status: 'draft', zip: '84301',
    image_bucket_path: 'maps/84301/nodc-1lxtyhz2srqe.png',
    evidence: { theme: 'datacenter', theme_answer: 'none_found',
      visual: { capture_key: 'v1|84301|absence|datacenter|dc-map-state@1', capture_policy: policy(null) } },
  };
  ok(HS.mapsCaptureBound(absence) === true, '2e: an absence capture with no stated scope stays bound');
}

// ── §3 THE CAPTURE JOB STATES THE SCOPE IT SHOT ─────────────────────────────────────────
{
  const rec = (scope) => HS.mapsDcCapturePolicyRecord(
    { applied: SNAP, before: SNAP, dispatched: {} },
    { final: SNAP, rendered: policy().rendered, ...(scope ? { scope } : {}) });
  ok(rec('zip').scope === 'zip' && rec('project').scope === 'project',
    '3a: the record builder carries an explicit scope through');
  ok(rec(null).scope === 'project', '3b: control — told nothing, it still defaults to project (the stricter reading)');

  const SRC = readFileSync(new URL('../scripts/maps-social-image.mjs', import.meta.url), 'utf8');
  const calls = [...SRC.matchAll(/\[policyApply, (\{ \.\.\.verify, scope: '(project|zip)' \}|verify)\],/g)];
  ok(calls.length === 2, `3c: both record-building call sites found (${calls.length})`);
  ok(calls.every((m) => m[2]), '3d: neither call site leaves the scope to the builder default');
  const projAt = SRC.indexOf("scope: 'project' }],");
  const zipAt = SRC.indexOf("scope: 'zip' }],");
  const before = (at, n) => SRC.slice(Math.max(0, at - n), at);
  ok(projAt > -1 && /mapsDcCaptureVerifyAtShutter\(key\)/.test(before(projAt, 700))
      && /proj\.source_key/.test(before(projAt, 700)),
    '3e: the PROJECT stamp is on the path that verifies a target project');
  ok(zipAt > -1 && /mapsDcCaptureVerifyAtShutter\(null\)/.test(before(zipAt, 700)),
    '3f: the ZIP stamp is on the path that seeks no target');
}

console.log(bad ? `\n${bad} FAILED (${n} checks)` : `\nALL CHECKS PASSED (${n} checks)`);
if (bad) process.exit(1);
