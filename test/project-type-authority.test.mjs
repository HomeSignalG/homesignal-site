#!/usr/bin/env node
// THE CANONICAL DEVELOPMENT TYPE HAS ONE HOME — lib/project-type.js — and every consumer reads it.
//
// WHY THIS EXISTS. The Type classifier was trapped inside lib/map.js, the Map 1 rendering
// runtime. A surface that shows a Type but draws no map (the ZIP page's Development & Growth
// cards) could reach Map 1's answer only by loading that runtime, which the ZIP hosts
// deliberately do not (test/zcta-boundary-reader.test.mjs §5a). The classifier was MOVED,
// verbatim, into a pure module; lib/map.js now reads it and refuses to load without it.
//
// What a regression here looks like, and which section catches it:
//   §1 a second classifier appears (rules re-typed into lib/map.js or anywhere else)
//   §2 Map 1 stops consuming the authority (resolveMarker classifies on its own)
//   §3 the module drags in runtime (DOM, map libraries, network, storage, geography)
//   §4 a precedence rule moves — Pennhurst (raw Industrial) stops being a data centre, etc.
//   §5 HS.canonicalProjectType drifts from the Map 1 ZIP-mode chain on the real vocabulary
//   §6 a page or harness loads lib/map.js without the authority in front of it
//
// Run: node test/project-type-authority.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let failures = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { failures++; console.error('FAIL — ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
};
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"\\])\/\/.*$/gm, '$1');

const PT_SRC = read('lib/project-type.js');
const MAP_SRC = read('lib/map.js');

// ── §1 ONE classifier ────────────────────────────────────────────────────────────────────
const RULE_DECLS = [/const CATEGORY_REGISTRY = \{/, /const TYPE_EXACT = \{/, /const LAYER_EXACT = \{/,
  /const GENERIC_EXACT = /, /const KEYWORD_RULES = \[/, /const NAME_RULES = \[/, /const DATACENTER_RE = /,
  /const DATACENTER_NOT_RE = /, /const DATACENTER_SERVING_RE = /, /const DATACENTER_COMPETING_RE = /,
  /const DATACENTER_CLASS_FIELDS = /, /const TERMINAL_NEUTRAL = /, /function classifyProjectType\(/,
  /function statedDataCenter\(/, /function terminalNeutral\(/, /function refineFromName\(/,
  /function typeInfoFromExact\(/];
for (const re of RULE_DECLS) {
  ok(re.test(code(PT_SRC)), `1a lib/project-type.js declares ${re.source.replace(/\\/g, '')}`);
  ok(!re.test(code(MAP_SRC)), `1b lib/map.js does NOT declare ${re.source.replace(/\\/g, '')}`);
}
// No other shipped browser file declares a rule table or a classifier either.
const libFiles = readdirSync(join(root, 'lib')).filter((f) => f.endsWith('.js') && f !== 'project-type.js');
const rivals = libFiles.filter((f) => RULE_DECLS.some((re) => re.test(code(read('lib/' + f)))));
ok(rivals.length === 0, '1c no other lib/*.js declares a Type rule table or classifier', rivals.join(','));
ok(/const PT = HS\.projectType;/.test(MAP_SRC)
   && /const classifyProjectType = PT\.classifyProjectType;/.test(MAP_SRC)
   && /const statedDataCenter = PT\.statedDataCenter;/.test(MAP_SRC)
   && /const CATEGORY_REGISTRY = PT\.CATEGORY_REGISTRY;/.test(MAP_SRC),
   '1d lib/map.js binds the registry, classifier and data-centre rule FROM the authority');

// ── §2 Map 1 consumes it (behaviour, not text) ──────────────────────────────────────────
function load(files, winHS) {
  const win = { HS: winHS || {} };
  for (const f of files) new Function('window', 'document', read(f))(win, undefined);
  return win.HS;
}
{
  // Load the authority, then wrap its classifier BEFORE lib/map.js binds it. If resolveMarker
  // classified on its own, the spy would never be called.
  const HS = load(['lib/project-type.js']);
  const real = HS.projectType.classifyProjectType;
  let calls = 0;
  HS.projectType.classifyProjectType = function (it) { calls++; return real(it); };
  load(['lib/map.js'], HS);
  const m = HS.resolveMarker({ type: 'Civic/Public', name: 'East Vincent Elevated Storage Tank' });
  ok(calls > 0 && m.typeKey === 'civic', '2a HS.resolveMarker classifies THROUGH the authority', calls + ' calls');
  ok(HS.CATEGORY_REGISTRY === HS.projectType.CATEGORY_REGISTRY, '2b Map 1 legend/filter registry IS the authority registry object');
  ok(HS.classifyProjectType === real, '2c HS.classifyProjectType is the authority function, not a copy');
}
{
  let threw = '';
  try { load(['lib/map.js']); } catch (e) { threw = e.message; }
  ok(/requires lib\/project-type\.js/.test(threw), '2d lib/map.js refuses to load without the authority', threw);
}

// ── §3 the module is pure ────────────────────────────────────────────────────────────────
const PT_CODE = code(PT_SRC);
const FORBIDDEN = [/\bdocument\b/, /\bL\./, /maplibre/i, /\bTHREE\b/, /leaflet/i, /\bfetch\(/, /XMLHttpRequest/,
  /localStorage|sessionStorage/, /supabase/i, /\.rpc\(/, /addEventListener/, /\blat\b|\blng\b/, /\bzip\b/i,
  /residentialGate|zipAuth|n5/, /import\s|require\(/, /setTimeout|requestAnimationFrame/];
for (const re of FORBIDDEN) ok(!re.test(PT_CODE), `3a lib/project-type.js code carries no ${re.source}`);
{
  // Runs in a bare context — no window, no document — and exports exactly its surface.
  const ctx = vm.createContext({});
  vm.runInContext(PT_SRC, ctx);
  const HS = ctx.HS;
  ok(HS && typeof HS.canonicalProjectType === 'function', '3b loads in a context with no window and no document');
  ok(JSON.stringify(Object.keys(HS).sort()) === JSON.stringify(['CATEGORY_REGISTRY', 'canonicalProjectType',
    'canonicalFacilityType', 'canonicalLifecycle', 'categoryFor', 'classifyFacilityOverlayType', 'classifyProjectType', 'projectType'].sort()),
    '3c exports only the Type surface (development Type + facility identity) and the lifecycle vocabulary', Object.keys(HS).join(','));
}

// ── §4 precedence, pinned on real record shapes ─────────────────────────────────────────
const HS = load(['lib/project-type.js', 'lib/map.js', 'lib/n5-radius.js', 'lib/residential-qualify.js',
  'lib/zip-authoritative.js', 'lib/maps-social-theme.js']);
const REG = HS.CATEGORY_REGISTRY;
const PENN = { type: 'Industrial', type_raw: 'Industrial', name: 'Pennhurst Data Centers', status: 'Proposed' };
const zipModeType = (row) => {
  const gate = HS.residentialGateDrops; HS.residentialGateDrops = undefined;   // Type, not membership
  try { return HS.resolveTrackerMarker(HS.zipAuthSiteFromMarker({ lat: 40, lng: -75, project_ref: 'x' }, row)).typeKey; }
  finally { HS.residentialGateDrops = gate; }
};
ok(HS.canonicalProjectType(PENN).typeKey === 'datacenter', '4a Pennhurst (raw Industrial) → canonical datacenter');
ok(HS.canonicalProjectType(PENN).label === REG.datacenter.label, '4b ...labelled from the registry ("Data center")');
ok(zipModeType(PENN) === 'datacenter', '4c ...and Map 1 ZIP mode draws it as datacenter');
ok(HS.mapsSocialTypeKey({ content_family: 'MAPS', tile: 'development',
  evidence: { type: 'Industrial', project_name: 'Pennhurst Data Centers', project_id: 'x' } }) === 'datacenter',
  '4d ...and MAPS (evidence.visual.type_key) records datacenter');
const CASES = [
  // [input, expected typeKey, why]
  [{ type: 'other project', name: 'Fire pump at the Data Center' }, 'other', 'terminal-neutral outranks the data-centre name'],
  [{ type: 'Data Center', name: 'Campus A' }, 'datacenter', 'stated data-centre class'],
  [{ type: 'Utility', name: 'Transmission line feeding the Ashburn data center campus' }, 'infrastructure', 'incidental-reference guard'],
  [{ type: 'Development', name: '1100 Datacenter Rd SFR addition' }, 'other', 'street-name guard — an address is not a data centre'],
  [{ type: 'Residential', name: 'Bechtel Farm At Stony Run' }, 'residential', 'exact class'],
  [{ type: 'Industrial', name: 'Warehouse addition' }, 'industrial', 'exact class'],
  [{ type: 'Commercial', name: 'Pennhurst' }, 'commercial', 'exact class'],
  [{ type: 'Civic/Public', name: 'East Vincent Elevated Storage Tank' }, 'civic', 'exact class (terminal civic)'],
  [{ type: 'Utility', name: 'Spring City Road over Stony Run Bridge Replacement' }, 'infrastructure', 'utility → infrastructure'],
  [{ type: 'Development', name: '595 Pikeland Avenue' }, 'other', 'generic bucket, name states no class → honest fallback'],
  [{ type: 'unclassified', name: 'Del Valle High School' }, 'civic', 'name phase'],
  [{ type: '', name: '' }, 'other', 'nothing stated → other'],
];
for (const [row, want, why] of CASES) {
  const c = HS.canonicalProjectType(row);
  ok(c && c.typeKey === want && zipModeType(row) === want,
    `4e "${row.type}" / "${row.name}" → ${want} (${why})`, JSON.stringify(c) + ' map1=' + zipModeType(row));
  ok(c && c.label === REG[want].label, `4e' ...labelled "${REG[want].label}" from the registry, never the source string`, c && c.label);
}
ok(Object.keys(REG).filter((k) => !REG[k].isFacility).every((k) => CASES.some((c) => c[1] === k)),
  '4f every development Type in the registry is exercised');
// Facility vs development: the facility IDENTITY is Map 1's (resolveMarker), and it is not a Type.
ok(HS.resolveMarker({ _facility: true, type: 'datacenter', name: 'X' }).categoryKey === 'datacenter'
   && HS.resolveMarker({ _facility: true, type: '', name: 'Acme' }).typeKey === 'facility',
   '4g facility identity stays in resolveMarker (dual data centre / plain facility)');
ok(HS.canonicalProjectType({ type: 'Regulated facility', name: 'Acme' }) === null,
   '4h a record whose class resolves to the facility identity has NO development Type');
ok(HS.canonicalProjectType(null) === null, '4i no row → null, never a guess');
// type_raw is NOT a Map 1 classifier input (ZIP mode carries it as permit_class). A record whose
// only data-centre statement is type_raw is Industrial on Map 1, so it must be Industrial here.
const RAW_ONLY = { type: 'Industrial', type_raw: 'Data Center', name: 'Building 7 shell' };
ok(zipModeType(RAW_ONLY) === 'industrial' && HS.canonicalProjectType(RAW_ONLY).typeKey === 'industrial',
   '4j a type_raw-only data-centre statement follows Map 1 (industrial), not the raw field');

// ── §5 parity with Map 1 ZIP mode over the committed national class vocabulary ───────────
const reg = JSON.parse(read('supabase/functions/get-address-report/jurisdiction-registry.json'));
const pairs = [];
(function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === 'object') {
    if (o.type_map && typeof o.type_map === 'object') for (const [k, v] of Object.entries(o.type_map)) pairs.push([k, String(v)]);
    Object.values(o).forEach(walk);
  }
})(reg);
const names = new Set(CASES.map((c) => c[0].name).concat(['Pennhurst Data Centers']));
(function walkDir(d) {
  for (const f of readdirSync(join(root, d))) {
    const p = d + '/' + f;
    if (statSync(join(root, p)).isDirectory()) walkDir(p);
    else if (p.endsWith('.json')) {
      try {
        (function h(o) {
          if (Array.isArray(o)) return o.forEach(h);
          if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
            if (typeof v === 'string' && /^(name|title|label|project_name|description)$/i.test(k) && v.length <= 300) names.add(v); else h(v);
          }
        })(JSON.parse(read(p)));
      } catch (e) { /* not JSON we can read */ }
    }
  }
})('fixtures');
(function (d) { for (const f of readdirSync(join(root, d))) if (f.endsWith('.json')) { try { (function h(o) {
  if (Array.isArray(o)) return o.forEach(h);
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && /^(name|title|label|project_name|description)$/i.test(k) && v.length <= 300) names.add(v); else h(v);
  }
})(JSON.parse(read(d + '/' + f))); } catch (e) { /* skip */ } } })('test/fixtures');
const rows = [];
for (const [raw, mapped] of pairs) {
  rows.push({ type: mapped, type_raw: raw, name: raw });
  rows.push({ type: mapped, type_raw: raw, name: '' });   // raw disagrees with mapped, nothing in the name
  rows.push({ type: raw, name: '' });
}
for (const n of names) for (const t of ['', 'Development', 'unclassified', 'Industrial', 'Utility', 'other project']) rows.push({ type: t, name: n });
let mism = 0; const ex = [];
for (const row of rows) {
  const c = HS.canonicalProjectType(row);
  const mk = zipModeType(row);
  const want = REG[mk] && !REG[mk].isFacility ? mk : null;
  if ((c ? c.typeKey : null) !== want) { mism++; if (ex.length < 3) ex.push(JSON.stringify(row) + ' → ' + (c && c.typeKey) + ' vs ' + mk); }
}
ok(pairs.length >= 3000 && names.size >= 100 && rows.length >= 9000,
  `5a the corpus is the real vocabulary, not a hand list (${pairs.length} class mappings, ${names.size} names, ${rows.length} rows)`);
ok(mism === 0, `5b HS.canonicalProjectType == Map 1 ZIP-mode Type on all ${rows.length} rows`, ex.join(' | '));

// ── §6 every host of lib/map.js loads the authority first ────────────────────────────────
const pages = readdirSync(root).filter((f) => f.endsWith('.html'));
for (const p of pages) {
  const s = read(p).replace(/<!--[\s\S]*?-->/g, '');
  const iMap = s.search(/<script src="\/?lib\/map\.js/);
  if (iMap < 0) continue;
  const iPt = s.search(/<script src="\/?lib\/project-type\.js/);
  ok(iPt > -1 && iPt < iMap, `6a ${p} loads lib/project-type.js before lib/map.js`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
