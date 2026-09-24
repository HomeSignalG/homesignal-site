#!/usr/bin/env node
// DEVELOPMENT & GROWTH TYPE BADGE — the ZIP page shows the canonical Development Type.
//
// The Type is DECIDED once, by HS.canonicalProjectType (lib/project-type.js) — the classifier
// Map 1 draws with and MAPS records as evidence.visual.type_key. This page only DISPLAYS it,
// from the structured key and the registry label. This suite renders the SHIPPED card template
// (sliced out of lib/community-page.js) over rows normalised by the SHIPPED lib/data.js, so what
// it checks is what a resident would see:
//   §1 each registry Type renders as its registry label
//   §2 Pennhurst: badge DATA CENTER while "On the record" still states the source's Industrial
//   §3 the badge reads no raw type and no prose; fails closed with no badge
//   §4 the card is otherwise byte-identical to the pre-badge template, and membership/order/count
//      logic is untouched
//   §5 both ZIP hosts load the pure authority before the runtime, and never lib/map.js
//
// Run: node test/community-dev-type-badge.test.mjs
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

// ── the SHIPPED pieces, no map runtime ──────────────────────────────────────────────────
const win = { HS: {} };
new Function('window', 'document', read('lib/project-type.js'))(win, undefined);
const HS = win.HS;
ok(typeof HS.resolveMarker === 'undefined', '0a the harness loads NO map runtime — the badge must work without it');
HS.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
HS.onReady = () => {};                                   // the page boot needs a DOM; not run here
const RT = read('lib/community-page.js');
new Function('HS', RT)(HS);
ok(typeof HS.devTypeBadge === 'function', '0b lib/community-page.js exports HS.devTypeBadge');

// lib/data.js::normProject / factualSowhat, sliced verbatim (same technique as
// test/maps-source-identity.test.mjs) — the "On the record" line comes from here.
const DATA = read('lib/data.js');
const fs = DATA.match(/  function factualSowhat\(p\) \{[\s\S]*?\n  \}/);
const np = DATA.match(/  function normProject\(p\) \{[\s\S]*?\n  \}/);
ok(!!fs && !!np, '0c factualSowhat and normProject found in lib/data.js');
const normProject = new Function(fs[0] + '\n' + np[0] + '\nreturn normProject;')();
ok(/if \(p\.type\) bits\.push\(p\.type\);/.test(fs[0]),
  '0d "On the record" still states the SOURCE type (p.type) — its semantics are not redefined here');

// The card template, sliced from the shipped runtime and evaluated with its real body.
const CARD_START = "topProjects.slice(0,3).map(function(p){";
const i0 = RT.indexOf(CARD_START);
const i1 = RT.indexOf("}).join('')", i0);
ok(i0 > 0 && i1 > i0, '0e the Development & Growth card template is found in lib/community-page.js');
const cardBody = RT.slice(i0 + CARD_START.length, i1);
HS.barColor = () => '#999';
HS.tpl = { browsingStatusLabel: (p) => String(p.status || ''), devImpactBlock: () => '<div class="impact">IMPACT</div>' };
const renderCard = new Function('HS', 'p', cardBody);
const card = (row) => renderCard(HS, normProject(row));
const REG = HS.CATEGORY_REGISTRY;

// ── §1 every Type ────────────────────────────────────────────────────────────────────────
const ROWS = [
  [{ name: 'East Vincent Elevated Storage Tank', type: 'Civic/Public', type_raw: 'Institutional', status: 'Proposed' }, 'civic'],
  [{ name: 'Bechtel Farm At Stony Run', type: 'Residential', type_raw: 'Residential', status: 'Proposed' }, 'residential'],
  [{ name: '595 Pikeland Avenue', type: 'Residential', type_raw: 'Residential', status: 'Proposed' }, 'residential'],
  [{ name: 'Pennhurst Data Centers', type: 'Industrial', type_raw: 'Industrial', status: 'Proposed' }, 'datacenter'],
  [{ name: 'Warehouse addition', type: 'Industrial', status: 'Approved' }, 'industrial'],
  [{ name: 'Pennhurst', type: 'Commercial', type_raw: 'Commercial', status: 'Proposed' }, 'commercial'],
  [{ name: 'Spring City Road over Stony Run Bridge Replacement', type: 'Utility', type_raw: 'Bridge Replacement', status: 'Approved' }, 'infrastructure'],
  [{ name: 'Lot 4 plan', type: 'Development', status: 'Proposed' }, 'other'],
];
for (const [row, key] of ROWS) {
  const html = card(row);
  const label = REG[key].label;
  ok(html.includes(`data-type-key="${key}"`) && html.includes('>' + HS.esc(label) + '</span>'),
    `1a ${row.name} (${row.type}) → badge ${key} "${label}"`, html.slice(0, 260));
}
ok(Object.keys(REG).filter((k) => !REG[k].isFacility).every((k) => ROWS.some((r) => r[1] === k)),
  '1b every development Type in the registry is rendered at least once');

// ── §2 Pennhurst ─────────────────────────────────────────────────────────────────────────
const penn = card(ROWS[3][0]);
ok(/data-type-key="datacenter"[^>]*>Data center<\/span>/.test(penn), '2a Pennhurst badge is the registry "Data center" (CSS uppercases it: DATA CENTER)');
ok(/<b>On the record:<\/b> Industrial · proposed<\/p>/.test(penn), '2b Pennhurst "On the record" still reads the source: Industrial · proposed', penn);
ok(!/class="devtype"[^>]*>Industrial/.test(penn), '2c the badge never reads Industrial');
ok(/text-transform:uppercase/.test(read('app.css').match(/\.card \.lens\{[^}]*\}/)[0]),
  '2d the badge inherits .card .lens uppercase — the label is displayed, not rewritten');

// ── §3 no raw type, no prose, fail closed ────────────────────────────────────────────────
const badgeSrc = RT.slice(RT.indexOf('HS.devTypeBadge = function'), RT.indexOf('HS.onReady('));
const badgeCode = badgeSrc.replace(/^\s*\/\/.*$/gm, '');
ok(/HS\.canonicalProjectType\(p\)/.test(badgeCode), '3a the badge asks HS.canonicalProjectType');
ok(!/p\.type|type_raw|sowhat|impact|On the record|\.test\(|match\(|RegExp|toLowerCase/i.test(badgeCode),
  '3b the badge reads no raw type, no prose, and applies no rule of its own', badgeCode);
ok(/t\.typeKey/.test(badgeCode) && /t\.label/.test(badgeCode), '3c it renders the structured key and the registry label');
const prose = Object.assign({}, ROWS[0][0], { sowhat: 'Data center · proposed', impact_text: 'A proposed industrial is…' });
ok(card(prose).includes('data-type-key="civic"'), '3d contradictory Impact / sowhat prose cannot move the badge');
ok(HS.devTypeBadge(null) === '', '3e no row → no badge');
{
  const saved = HS.canonicalProjectType; delete HS.canonicalProjectType;
  ok(HS.devTypeBadge(ROWS[0][0]) === '', '3f authority absent → no badge, never a guess');
  HS.canonicalProjectType = saved;
}
ok(HS.devTypeBadge({ name: 'Acme', type: 'Regulated facility' }) === '', '3g a facility-identity class is not a development Type → no badge');

// ── §4 card otherwise unchanged; membership / order / count untouched ────────────────────
const stripBadge = (h) => h.replace(/<span class="devtype"[^>]*>[^<]*<\/span>/, '');
const PRE_BADGE = "return '<div class=\"card mini\" style=\"border-left-color:' + HS.barColor(p) + ';margin-bottom:10px\">'\n"
  + "          + '<span class=\"lens\">' + HS.esc(HS.tpl.browsingStatusLabel(p)) + ' · ' + HS.esc(p.dist||'') + '</span><h3>' + HS.esc(p.name) + '</h3>'\n"
  + "          + HS.tpl.devImpactBlock(p)\n"
  + "          + '<p class=\"sowhat\"><b>' + (p.sowhat_factual ? 'On the record:' : 'How it impacts you:') + '</b> ' + HS.esc(p.sowhat||'') + '</p></div>';";
const preCard = new Function('HS', 'p', PRE_BADGE);
ok(ROWS.every(([row]) => stripBadge(card(row)) === preCard(HS, normProject(row))),
  '4a with the badge removed, every card is byte-identical to the pre-badge template');
ok(RT.includes("var topProjects = proposed.concat(active); if (!topProjects.length) topProjects = projects;")
   && RT.includes(CARD_START), '4b membership and order logic (topProjects, slice(0,3)) is unchanged');
ok(RT.includes("Development &amp; growth <span class=\"gc\">— ' + devTotal + (devTotal===1?' record':' records')"),
  '4c the record count line is unchanged');

// ── §5 hosts ─────────────────────────────────────────────────────────────────────────────
const before = (s, a, b) => s.indexOf(a) > -1 && s.indexOf(b) > -1 && s.indexOf(a) < s.indexOf(b);
const legacy = read('community.html').replace(/<!--[\s\S]*?-->/g, '');
const gen = read('scripts/gen_zip_pages.py').replace(/^\s*#.*$/gm, '');
ok(before(legacy, 'src="lib/project-type.js', 'src="lib/community-page.js'), '5a community.html loads the authority before the runtime');
ok(before(gen, 'src="/lib/project-type.js', 'src="/lib/community-page.js'), '5b generated /community/<zip>/ pages load it before the runtime');
ok(!/lib\/map\.js/.test(legacy) && !/lib\/map\.js/.test(gen), '5c neither ZIP host loads lib/map.js');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
