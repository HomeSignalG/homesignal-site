#!/usr/bin/env node
// REGULATED FACILITIES NEARBY — the card's Type badge is Map 1's facility identity, displayed.
//
// A regulated facility is NOT a development project, and nothing here types one from its name.
// Map 1 already answers "what kind of record is this EPA facility" from its CLASS FIELD only,
// in one fixed order (founder Overlay-on-Type ruling, 2026-09-07):
//   dual data centre → 'datacenter'  ·  classifiable class → that Type  ·  else 'facility'
// That decision now lives once in lib/project-type.js (facilityIdentity) and both surfaces
// read it: Map 1's resolveMarker, and the ZIP page via HS.canonicalFacilityType.
//   §1 Map 1 consumes facilityIdentity (spy) and holds no copy of the rule
//   §2 Community == Map 1 over the committed national class vocabulary
//   §3 name and status cannot move it; no rule of the page's own
//   §4 ZIP 19475's real class values
//   §5 the shipped card: badge beside "Operating", everything else byte-identical
//   §6 the development Type is untouched (Pennhurst is still a data centre)
//
// Run: node test/community-facility-type-badge.test.mjs
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
const code = (s) => s.replace(/^\s*\/\/.*$/gm, '');
function load(files, HS0) {
  const win = { HS: HS0 || {} };
  for (const f of files) new Function('window', 'document', read(f))(win, undefined);
  return win.HS;
}

// ── §1 one decision, and Map 1 reads it ──────────────────────────────────────────────────
const MAP = code(read('lib/map.js'));
ok(!/function classifyFacilityOverlayType\(/.test(MAP) && !/function facilityIdentity\(/.test(MAP),
  '1a lib/map.js declares neither the overlay rule nor the facility identity');
ok(/const facilityIdentity = PT\.facilityIdentity;/.test(MAP) && /const fid = facilityIdentity\(item\);/.test(MAP),
  '1b resolveMarker binds and calls the authority facilityIdentity');
ok(!/statedDataCenter\(item, true\)/.test(MAP) && !/classifyFacilityOverlayType\(item\)/.test(MAP),
  '1c resolveMarker no longer re-derives dual/overlay itself');
{
  const HS = load(['lib/project-type.js']);
  const real = HS.projectType.facilityIdentity;
  let calls = 0;
  HS.projectType.facilityIdentity = (it) => { calls++; return real(it); };
  load(['lib/map.js'], HS);
  const m = HS.resolveMarker({ _facility: true, layer: 'industrial', name: 'A.C. MILLER CONCRETE PRODUCTS, INC.' });
  ok(calls === 1 && m.categoryKey === 'industrial' && m.isFacility === true,
    '1d a Map 1 facility pin is classified THROUGH facilityIdentity', calls + ' ' + m.categoryKey);
}

const HS = load(['lib/project-type.js', 'lib/map.js']);
const REG = HS.CATEGORY_REGISTRY;
// Map 1's facility pin for an EPA site whose class is `layer` (development_reports.sites shape).
const map1 = (cls, name) => HS.resolveTrackerMarker({ layer: cls, label: name || '', registry_id: '110000000001', type: 'built' },
  (s) => s.registry_id).categoryKey;
const comm = (cls, name, status) => HS.canonicalFacilityType({ type: cls, name: name || '', status: status || 'Operating', record_kind: 'facility' });

// ── §2 parity over the committed vocabulary ─────────────────────────────────────────────
const reg = JSON.parse(read('supabase/functions/get-address-report/jurisdiction-registry.json'));
const classes = new Set(['', 'industrial', 'energy', 'logistics', 'research', 'datacenter', 'animal-facility',
  'commercial', 'residential', 'unclassified', 'other project', 'regulated facility', 'Data Center']);
(function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === 'object') {
    if (o.type_map && typeof o.type_map === 'object') for (const [k, v] of Object.entries(o.type_map)) { classes.add(k); classes.add(String(v)); }
    Object.values(o).forEach(walk);
  }
})(reg);
let mism = 0; const ex = []; const seen = new Set();
for (const c of classes) {
  const a = comm(c); const b = map1(c);
  seen.add(b);
  if (!a || a.typeKey !== b || a.label !== REG[b].label) { mism++; if (ex.length < 3) ex.push(c + ' → ' + (a && a.typeKey) + ' vs ' + b); }
}
ok(classes.size > 2000, `2a the corpus is the real class vocabulary (${classes.size} values)`);
ok(mism === 0, `2b Community badge == Map 1 facility pin on all ${classes.size} class values`, ex.join(' | '));
ok(['datacenter', 'facility', 'industrial', 'infrastructure'].every((k) => seen.has(k)),
  '2c the corpus reaches all three identities (dual, overlay, plain)', [...seen].join(','));

// The DUAL identity is its own branch, not a coincidence of the overlay: a stated data centre in
// the class field must come back as kind 'dual' here AND as the dual pin on Map 1.
{
  const d = comm('datacenter');
  const pin = HS.resolveTrackerMarker({ layer: 'datacenter', label: 'X', registry_id: '1' }, (x) => x.registry_id);
  ok(d.kind === 'dual' && d.typeKey === 'datacenter' && pin.isDataCenter === true && /^DUAL:/.test(pin.shapeRule),
    '2d a data-centre class is the DUAL identity on both surfaces', d.kind + ' ' + pin.shapeRule);
  const o = comm('industrial');
  const opin = HS.resolveTrackerMarker({ layer: 'industrial', label: 'X', registry_id: '1' }, (x) => x.registry_id);
  ok(o.kind === 'overlay' && opin.overlayOnType === true && comm('').kind === 'plain',
    '2e overlay and plain identities agree with the pin too');
}

// ── §3 name and status cannot move it; the page has no rule ─────────────────────────────
ok(comm('industrial', 'PENNHURST DATA CENTER CAMPUS').typeKey === 'industrial'
   && map1('industrial', 'PENNHURST DATA CENTER CAMPUS') === 'industrial',
  '3a a data-centre NAME on an industrial class is still Industrial on both — the name is never read');
ok(comm('', 'A.C. MILLER CONCRETE PRODUCTS, INC.').typeKey === 'facility',
  '3b an unclassified facility with an industrial-sounding name stays "Regulated facility"');
ok(['Operating', 'Closed', '', 'Proposed'].every((st) => comm('energy', 'X', st).typeKey === 'infrastructure'),
  '3c status is never read — "Operating" is lifecycle, not Type');
const RT = read('lib/community-page.js');
const fb = code(RT.slice(RT.indexOf('HS.facTypeBadge = function'), RT.indexOf('HS.onReady(')));
ok(/HS\.canonicalFacilityType\(f\)/.test(fb) && /HS\.typeBadge\(t\)/.test(fb),
  '3d the facility badge asks HS.canonicalFacilityType and renders through the shared badge');
ok(!/f\.(name|type|status|developer|dist)|\.test\(|match\(|RegExp|indexOf|toLowerCase/.test(fb),
  '3e ...and reads no field and applies no rule of its own', fb);

// ── §4 ZIP 19475, class values as served by app_projects_for_zip('19475','facility') ──────
const Z = [['A.C. MILLER CONCRETE PRODUCTS, INC.', 'industrial', 'industrial', 'Industrial'],
  ['AC MILLER CONCRETE - SPRING CITY PLANT', 'industrial', 'industrial', 'Industrial'],
  ['CROMBY GENERATING STATION', 'energy', 'infrastructure', 'Roads & infrastructure'],
  ['SCOUT TRUCKING INC', 'logistics', 'industrial', 'Industrial']];
for (const [n, cls, key, label] of Z) {
  const c = comm(cls, n);
  ok(c.typeKey === key && c.label === label && map1(cls, n) === key, `4 ${n} (${cls}) → ${label}, Map 1 ${key}`);
}

// ── §5 the shipped card ─────────────────────────────────────────────────────────────────
HS.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
HS.onReady = () => {};
new Function('HS', RT)(HS);
const START = 'facilities.slice(0,6).map(function(f){';
const i0 = RT.indexOf(START), i1 = RT.indexOf("}).join('')", i0);
ok(i0 > 0 && i1 > i0, '5a the Regulated facilities card template is found');
const card = new Function('HS', 'f', RT.slice(i0 + START.length, i1));
const PRE = "return '<div class=\"card mini\" style=\"border-left-color:#3f7fb0;margin-bottom:10px\">'\n"
  + "            + '<span class=\"lens\">Operating' + (f.dist? ' · ' + HS.esc(f.dist):'') + '</span><h3>' + HS.esc(f.name) + '</h3>'\n"
  + "            + '<p class=\"sowhat\">' + HS.esc(f.type||'Regulated facility') + (f.developer? ' · ' + HS.esc(f.developer):'') + '</p>'\n"
  + "            + (f.source_ref? '<a href=\"' + HS.esc(f.source_ref) + '\" target=\"_blank\" rel=\"noopener\" style=\"font-size:12.5px;font-weight:600\">View public record →</a>':'') + '</div>';";
const pre = new Function('HS', 'f', PRE);
const rows = Z.map(([n, cls]) => ({ name: n, type: cls, status: 'Operating', registry_id: '1', source_ref: 'https://echo.epa.gov/detailed-facility-report?fid=1' }))
  .concat([{ name: 'UNTYPED SITE', type: '', status: 'Operating' }, { name: 'DC SITE', type: 'datacenter', dist: '0.4 mi' }]);
const strip = (h) => h.replace(/<span class="devtype"[^>]*>[^<]*<\/span>/, '');
ok(rows.every((f) => strip(card(HS, f)) === pre(HS, f)), '5b with the badge removed every card is byte-identical to the pre-badge template');
const miller = card(HS, rows[0]);
ok(/<span class="lens">Operating<span class="devtype" data-type-key="industrial"[^>]*>Industrial<\/span><\/span><h3>A\.C\. MILLER CONCRETE PRODUCTS, INC\.<\/h3>/.test(miller),
  '5c A.C. Miller reads "Operating [INDUSTRIAL]" — status first, badge beside it', miller.slice(0, 220));
ok(/data-type-key="facility"[^>]*>Regulated facility</.test(card(HS, rows[4])), '5d an unclassified facility reads "Regulated facility"');
ok(/data-type-key="datacenter"[^>]*>Data center</.test(card(HS, rows[5])) && /· 0\.4 mi<\/span>/.test(card(HS, rows[5])),
  '5e a data-centre class reads "Data center", and the distance still follows');
ok(RT.includes(START) && RT.includes("var facTotal = metaCount('regulated facilities', facilities.length);"),
  '5f membership (slice 0..6), order and the count are the same expressions');

// ── §6 development Type untouched ────────────────────────────────────────────────────────
ok(HS.canonicalProjectType({ type: 'Industrial', name: 'Pennhurst Data Centers' }).typeKey === 'datacenter',
  '6 Pennhurst Data Centers is still the canonical development Type datacenter');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
