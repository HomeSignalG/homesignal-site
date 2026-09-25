#!/usr/bin/env node
// AN EPA RECORD PROVES REGISTRATION, NOT OPERATION (founder, 2026-09-24).
//
// Every EPA/FRS facility used to read "Operating": the engine stamped `type:"built"` on every
// registry point, public.app_refresh_zip wrote the literal 'Operating', lib/map.js hardcoded
// lifecycle:'operating' on all three facility branches, Map 1's list concatenated every
// facility into "Operating now", and the ZIP card and the facility dossier printed the word.
// No retained EPA field states a physical lifecycle (FRS = registry presence; ICIS-NPDES =
// PERMIT status). Measured 2026-09-24: 197,991 facility rows, 197,991 'Operating', 0 sourced.
//
// The canonical unknown already existed and is reused, not invented:
//   stored   'On file'   (what app_refresh_zip writes for a development record with no bucket)
//   key      'unknown'   (lib/project-type.js lifecycleKey — ONE vocabulary, Map 1 + ZIP page)
//   label    'Lifecycle unknown'
//
// The producer/marker half is pinned by test/facility-lifecycle-unknown.test.mjs. THIS file pins
// the two founder presentation decisions of 2026-09-24 and the shared vocabulary behind them:
//   §5 ONE vocabulary: Map 1 and the ZIP page read the same keys and labels
//   §6 Map 1 list bands derive from lifecycle, never from record kind — incl. "Lifecycle unknown"
//   §7 the ZIP card and the dossier show the canonical label, never a literal or the raw 'On file'
//   §9 ZIP 19475, the five named facilities
//
// Run: node test/lifecycle-unknown-presentation.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let failures = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { failures++; console.error('FAIL — ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
};
// Strip // line comments and /* */ blocks so a pin never matches the comment that quotes
// the retired code.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
function load(files, HS0) {
  const win = { HS: HS0 || {} };
  for (const f of files) new Function('window', 'document', read(f))(win, undefined);
  return win.HS;
}
const HS = load(['lib/project-type.js', 'lib/map.js']);
const frs = (s) => (s && s.registry_id) ? String(s.registry_id) : '';
const track = (site) => HS.resolveTrackerMarker(site, frs);
const epaSite = (layer, extra) => Object.assign({ label: 'EPA SITE', layer, scope: 'point',
  registry_id: '110000000001', record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110000000001' }, extra || {});

// ── §5 one vocabulary ───────────────────────────────────────────────────────────────────
{
  const L = HS.projectType.LIFECYCLE_LABELS;
  ok(JSON.stringify(HS.LIFECYCLE_KEYS) === JSON.stringify(HS.projectType.LIFECYCLE_KEYS),
    '5a Map 1 lifecycle keys ARE the shared keys');
  ok(['proposed', 'approved', 'operating', 'unknown'].every((k) => HS.mapStatus({ status: k === 'unknown' ? 'On file' : k }).label === L[k]),
    '5b Map 1 labels ARE the shared labels');
  ok(['Proposed', 'Approved', 'Operating', 'Active', 'Built', 'On file', 'Decided', '', null, 'Terminated', 'Closed']
    .every((s) => HS.mapStatus({ status: s }).k === HS.canonicalLifecycle({ status: s }).key),
    '5c Map 1 and the ZIP page resolve every status to the same key');
  const MAP = code(read('lib/map.js'));
  ok(!/s === 'operating' \|\| s === 'active' \|\| s === 'built'/.test(MAP) && !/'Lifecycle unknown'/.test(MAP),
    '5d lib/map.js carries no second copy of the rule or the label');
  // The ZIP page's facility helpers and card are retired (founder decision, 2026-09-25: static
  // regulatory inventory is not a "What's changing" item), so no surface there can carry a copy
  // of a lifecycle label. Map 1 and the dossier still say it in the shared words (§6, §7c, §9).
  const CPR = code(read('lib/community-page.js'));
  ok(/HS\.devTypeBadge = function/.test(CPR) && !/HS\.fac(TypeBadge|LifecycleLabel)/.test(CPR)
     && !/facilities\.slice\(0,6\)\.map/.test(CPR),
    '5e positive control: the ZIP runtime is found, and it carries no facility helper or card');
  ok(!/Lifecycle unknown/.test(CPR), '5f the ZIP runtime carries no copy of a lifecycle label');
}

// ── §6 Map 1 list bands derive from lifecycle ──────────────────────────────────────────
{
  const PAGE = code(read('homesignalmap.html'));
  ok(!/builtRows = [^;]*\.concat\(fac\)/.test(PAGE) && /var points = permits\.concat\(fac\);/.test(PAGE),
    '6a "Operating now" no longer appends facilities by kind (facilities join the point set and are banded by lifecycle)');
  ok(/var builtRows = points\.filter\(function\(s\)\{ return bucketOf\(s\.type, s\)==="operating"; \}\);/.test(PAGE),
    '6b "Operating now" is the points whose lifecycle is operating');
  ok(/var unknownRows = points\.concat\(dev\)\.filter\(function\(s\)\{ return bucketOf\(s\.type, s\)==="unknown"; \}\);/.test(PAGE),
    '6c "Lifecycle unknown" holds ANY record whose lifecycle is unknown — permits, facilities and notices alike');
  ok(/listInto\("unknownList", unknownRows,/.test(PAGE) && /id="unknownList"/.test(read('homesignalmap.html'))
     && /band-h t-unknown">Lifecycle unknown</.test(read('homesignalmap.html')),
    '6d the band is rendered, under the legend\'s own label');
  ok(!/operating now"/.test(PAGE), '6e no popup string asserts "operating now" for a facility');
  ok(/var lcWord = mk\.lifecycleLabel \? " · " \+ mk\.lifecycleLabel : "";/.test(PAGE),
    '6f the facility popup word is the pin\'s own lifecycleLabel (the shared vocabulary)');
  ok(/COLORS\[bucketOf\(s\.type, s\)\]/.test(PAGE) && !/COLORS\[s\.type\]/.test(PAGE),
    '6g the list dot is the lifecycle colour, not the raw type');
  // the band membership rule, executed over a realistic mix
  const bucket = (s) => track(s).lifecycle;
  const permits = [{ scope: 'point', relevance: 'development', type: 'built', use_type: 'Industrial' },
    { scope: 'point', relevance: 'development', type: 'something-else', use_type: 'Commercial' }];
  const fac = [epaSite('industrial', { type: 'built' }), epaSite('energy')];
  const dev = [{ scope: 'area', relevance: 'development', type: 'proposed' }, { scope: 'area', relevance: 'development' }];
  const points = permits.concat(fac);
  const built = points.filter((s) => bucket(s) === 'operating');
  const unk = points.concat(dev).filter((s) => bucket(s) === 'unknown');
  ok(built.length === 1 && built[0] === permits[0], '6h Operating now = the one stated-built permit, no facility');
  ok(unk.length === 4 && fac.every((f) => unk.includes(f)), '6i Lifecycle unknown holds both facilities, the unstated permit and the unstated notice');
}

// ── §7 ZIP card and dossier ─────────────────────────────────────────────────────────────
{
  // 7a/7b — the ZIP facility card is retired (2026-09-25); the lifecycle it printed is pinned
  // at the shared authority instead, on the same Plotts Energy row.
  const row = { name: 'PLOTTS ENERGY', type: 'energy', status: 'On file', record_kind: 'facility',
    facility_env: { epa: { permit_status: 'Terminated' } } };
  ok(HS.canonicalLifecycle(row).label === 'Lifecycle unknown' && HS.canonicalFacilityType(row).label === 'Roads & infrastructure',
    '7a Plotts Energy: "Lifecycle unknown", Type Roads & infrastructure');
  ok(!/Operating|Closed|Terminated/.test(HS.canonicalLifecycle(row).label),
    '7b the lifecycle shows no Operating, no Closed and no raw permit status');
  const DEV = read('development.html');
  ok(!/<span class="status active">Operating<\/span>/.test(DEV) && /HS\.canonicalLifecycle\(f\)/.test(DEV)
     && /lib\/project-type\.js\?v=/.test(DEV),
    '7c the facility dossier reads the canonical label, not a hardcoded green "Operating"');
}

// ── §9 ZIP 19475 ────────────────────────────────────────────────────────────────────────
// Class and permit values as stored in app_projects for 19475 (measured 2026-09-24).
const Z = [
  ['A.C. MILLER CONCRETE PRODUCTS, INC.', 'industrial', null, 'Industrial'],
  ['AC MILLER CONCRETE - SPRING CITY PLANT', 'industrial', 'Effective', 'Industrial'],
  ['CROMBY GENERATING STATION', 'energy', 'Effective', 'Roads & infrastructure'],
  ['PLOTTS ENERGY', 'energy', 'Terminated', 'Roads & infrastructure'],
  ['PECO - CROMBY SUBSTATION', 'energy', null, 'Roads & infrastructure']];
for (const [name, cls, permit, typeLabel] of Z) {
  const env = permit ? { epa: { permit_status: permit } } : undefined;
  const row = { name, type: cls, status: 'On file', record_kind: 'facility', facility_env: env };
  const pin = track(epaSite(cls, { label: name, type: 'built', env }));
  const t = HS.canonicalFacilityType(row);
  ok(t.label === typeLabel && pin.typeLabel === typeLabel
     && HS.canonicalLifecycle(row).label === 'Lifecycle unknown' && pin.lifecycle === 'unknown'
     && pin.signal && pin.signal.letter === 'R',
    `9 ${name}: TYPE ${typeLabel} · LIFECYCLE unknown · REGULATORY yes${permit ? ' (permit ' + permit + ' stays evidence only)' : ''}`);
}

console.log(failures ? `\n${failures} assertion(s) failed` : '\nall passed');
process.exit(failures ? 1 : 0);
