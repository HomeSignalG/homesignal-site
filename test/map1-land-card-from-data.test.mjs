// Map 1 land-assembly card: the title and the projects come from data, never from the page.
//
// Measured 2026-10-29: v_resolved_project_zip has 3 rows (84005 → eagle-mountain, 84307 and
// 84336 → stratos-box-elder), but the page used only zrows[0] and hard-coded the title
// "Stratos data center project — land assembly", so Eagle Mountain's map said Stratos. The four
// government tracks were also printed "unresolved" because they are NULL in resolved_projects,
// which only means HomeSignal has not reviewed them here.
//
// This suite (a) forbids a project_key / project-name literal in the land-card code, (b) runs the
// shipped landCardTitle / landCardHTML / renderAnchors from homesignalmap.html on an Eagle
// Mountain fixture and a Stratos fixture, and (c) proves every row for a ZIP gets its own card.
//
// Run: node test/map1-land-card-from-data.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'homesignalmap.html'), 'utf8');

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 300) : ''));
  if (!c) fails++;
};

// Brace-match a `function NAME(` declaration out of the page.
function extract(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function extractVar(name) {
  const re = new RegExp('var ' + name + ' = [\\s\\S]*?\\]\\];');
  const m = html.match(re);
  if (!m) throw new Error('var not found: ' + name);
  return m[0];
}
const stripComments = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');

const NAMES = ['devPageFor', 'hasTrackValue', 'renderTrack', 'landCardTitle', 'landCardTitleIsDescriptive', 'landCardHTML', 'renderAnchors', 'loadDevTracker', 'drawParcels'];
const SRC = {};
for (const n of NAMES) SRC[n] = extract(n);
const GOV = extractVar('GOV_TRACKS');

// ---- (a) no project literal in the land-card code ------------------------------------------
const cardCode = stripComments([GOV, ...NAMES.map((n) => SRC[n])].join('\n'));
ok(!/stratos/i.test(cardCode), 'a1 no "Stratos" literal in the land-card code');
ok(!/eagle[\s-]?mountain/i.test(cardCode), 'a2 no "Eagle Mountain" literal in the land-card code');
ok(!/['"](?:stratos-box-elder|eagle-mountain)['"]/.test(cardCode), 'a3 no project_key literal');
ok(!/box elder/i.test(cardCode), 'a4 no county name literal in the land-card code');
ok(!/zrows\[0\]/.test(SRC.loadDevTracker), 'a5 loadDevTracker does not read only the first row');
ok(/select:"\*"/.test(SRC.loadDevTracker.split('resolved_projects')[1] || ''), 'a6 resolved_projects read with select=*');
ok(!/unresolved/i.test(stripComments(SRC.landCardHTML + SRC.renderTrack)), 'a7 no "unresolved" printed for an unreviewed track');

// ---- run the shipped functions --------------------------------------------------------------
const dom = { dtAnchorBody: { innerHTML: '' } };
const ctx = vm.createContext({
  $: (id) => dom[id],
  esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  escAttr: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
  console,
});
vm.runInContext([GOV, SRC.devPageFor, SRC.hasTrackValue, SRC.renderTrack, SRC.landCardTitle, SRC.landCardTitleIsDescriptive, SRC.landCardHTML, SRC.renderAnchors].join('\n'), ctx);

const SENT = 'Government actions for this land have not been reviewed on this map yet.';
// Fixtures shaped like the production rows (2026-10-29): every government track NULL.
const emParent = {
  project_key: 'eagle-mountain', aliases: [], unconfirmed: [],
  mida_county: null, deq_air_permit: null, water_rights: null, legal_referendum: null,
  governing_bodies: [{ body_name: 'Eagle Mountain City (Council + Planning Commission)', confidence: 'probable' }],
  approval_aliases: [],
};
const emZr = { project_key: 'eagle-mountain', zip: '84005', is_primary_zip: true, parcels_in_anchor_total: 10, parcels_in_this_zip: 10, other_zips: [] };
const emParcels = Array.from({ length: 10 }, (_, i) => ({ apn: 'EM-' + i, owner_of_record: 'UTLCO', zip: '84005', acres: 5 }));
const stParent = {
  project_key: 'stratos-box-elder', aliases: [{ name: 'BAR H RANCH INC', confidence: 'verified' }], unconfirmed: [],
  mida_county: null, deq_air_permit: null, water_rights: null, legal_referendum: null,
  approval_aliases: [{ name: 'STRATOS PROJECT AREA' }],
};
const stZr = { project_key: 'stratos-box-elder', zip: '84307', is_primary_zip: false, primary_zip: '84336', parcels_in_anchor_total: 82, parcels_in_this_zip: 4, other_zips: [] };
const stParcels = [{ apn: 'S-1', owner_of_record: 'BAR H RANCH INC', zip: '84307' }, { apn: 'S-2', owner_of_record: 'BAR H LAND LLC', zip: '84336' }];

const titleOf = (h) => (h.match(/<div class='dt-title'>([^<]*)<\/div>/) || [])[1];

// ---- (b) titles and government status from data ---------------------------------------------
const emNo = ctx.landCardHTML(emZr, emParent, emParcels, '84005');
ok(titleOf(emNo) === 'Land assembly on record', 'b1 Eagle Mountain without display_name → neutral title', titleOf(emNo));
ok(!/stratos/i.test(emNo), 'b2 Eagle Mountain card never says Stratos');
ok(emNo.includes(SENT) && !/dt-track/.test(emNo), 'b3 all tracks NULL → one plain sentence, no track rows');
ok(!/unresolved|approved|pending/i.test(emNo), 'b4 the card claims nothing approved, pending or unresolved');

const emNamed = ctx.landCardHTML(emZr, { ...emParent, display_name: 'Eagle Mountain land assembly' }, emParcels, '84005');
ok(titleOf(emNamed) === 'Eagle Mountain land assembly', 'b5 display_name is used verbatim', titleOf(emNamed));
const NOTE = 'Descriptive label by JODY. No public record names this project.';
ok(!emNamed.includes(NOTE), 'b5a no basis stated → no descriptive note');
const emDesc = ctx.landCardHTML(emZr, { ...emParent, display_name: 'Eagle Mountain land assembly', display_name_basis: 'descriptive' }, emParcels, '84005');
ok(titleOf(emDesc) === 'Eagle Mountain land assembly' && emDesc.includes(NOTE), 'b5b a descriptive label says it is JODY\'s, not a record name', emDesc);
const stRec = ctx.landCardHTML(stZr, { ...stParent, display_name: 'Stratos data center project', display_name_basis: 'record' }, stParcels, '84307');
ok(!stRec.includes(NOTE), 'b5c a record-named project carries no descriptive note');
ok(!ctx.landCardHTML(emZr, { ...emParent, display_name_basis: 'descriptive' }, emParcels, '84005').includes(NOTE),
  'b5d no title, no note (the neutral title is not a JODY project name)');

const stNamed = ctx.landCardHTML(stZr, { ...stParent, display_name: 'Stratos data center project' }, stParcels, '84307');
ok(titleOf(stNamed) === 'Stratos data center project', 'b6 Stratos title comes from its own row', titleOf(stNamed));
ok(/Part of a project centered in ZIP 84336/.test(stNamed), 'b7 straddle line kept');

const xss = ctx.landCardHTML(stZr, { ...stParent, display_name: '<img src=x onerror=1>' }, [], '84307');
ok(!/<img/.test(xss) && /&lt;img/.test(xss), 'b8 display_name is escaped');

const withTrack = ctx.landCardHTML(stZr, { ...stParent, mida_county: { status: 'Agreement recorded', source_url: 'https://example.gov/r' } }, [], '84307');
ok(/MIDA \/ county approval/.test(withTrack) && /Agreement recorded/.test(withTrack) && !withTrack.includes(SENT),
  'b9 a track with a value renders; the sentence does not');
ok(!/DEQ air permit|Water rights|Legal \/ referendum/.test(withTrack), 'b10 tracks without a value are not shown');
ok(ctx.landCardTitle(null) === 'Land assembly on record' && ctx.landCardTitle({ display_name: '   ' }) === 'Land assembly on record',
  'b11 missing or blank display_name → neutral title');

// ---- (c) every row for a ZIP renders its own card -------------------------------------------
ctx.renderAnchors([
  { zr: { ...emZr, zip: '99999' }, parent: { ...emParent, display_name: 'Project A' }, parcels: emParcels },
  { zr: { ...stZr, zip: '99999' }, parent: { ...stParent, display_name: 'Project B' }, parcels: stParcels },
], '99999');
const out = dom.dtAnchorBody.innerHTML;
const titles = [...out.matchAll(/<div class='dt-title'>([^<]*)<\/div>/g)].map((m) => m[1]);
ok((out.match(/<div class='dt-card'>/g) || []).length === 2, 'c1 two rows → two cards');
ok(JSON.stringify(titles) === JSON.stringify(['Project A', 'Project B']), 'c2 each card has its own title', titles);
const [cardA, cardB] = out.split("<div class='dt-card'>").slice(1);
ok(/UTLCO/.test(cardA) && !/BAR H/.test(cardA), 'c3 card A lists only its own parcels');
ok(/BAR H/.test(cardB) && !/UTLCO/.test(cardB), 'c4 card B lists only its own parcels');
ok(/rows\.map\(/.test(SRC.loadDevTracker) && /land_card_title/.test(SRC.loadDevTracker) && /land_card_title/.test(SRC.drawParcels),
  'c5 loadDevTracker fetches per row and tags each drawn parcel with its own card title');

// ---- (d) the link to the published development page ----------------------------------------
const IDX = { schema: 'development-land-index/1', land: { 'stratos-box-elder': { path: '/development/ut/stratos-box-elder/', name: 'Stratos data center project' } } };
const dp = ctx.devPageFor(IDX, stParent);
ok(dp && dp.path === '/development/ut/stratos-box-elder/' && dp.name === 'Stratos data center project', 'd1 a published land gets its page', dp);
ok(ctx.devPageFor(IDX, emParent) === null, 'd2 land with no page gets no link');
ok(ctx.devPageFor(null, stParent) === null && ctx.devPageFor({ land: IDX.land }, stParent) === null,
  'd3 a missing or unrecognised index means no link');
const badPath = { schema: IDX.schema, land: { 'stratos-box-elder': { path: 'javascript:alert(1)', name: 'x' } } };
ok(ctx.devPageFor(badPath, stParent) === null, 'd4 anything but a /development/<st>/<key>/ path is refused');
ok(ctx.devPageFor({ schema: IDX.schema, land: { 'stratos-box-elder': { path: '/development/ut/stratos-box-elder/', name: '  ' } } }, stParent) === null,
  'd5 no name, no link');
ok(ctx.devPageFor({ schema: IDX.schema, land: Object.create({ 'stratos-box-elder': IDX.land['stratos-box-elder'] }) }, stParent) === null,
  'd6 an inherited key is not a published page');
const withLink = ctx.landCardHTML(stZr, stParent, stParcels, '84307', dp);
ok(withLink.includes("<a href='/development/ut/stratos-box-elder/'>Read the project page: Stratos data center project ›</a>"),
  'd7 the card links to the page by its published name', withLink.slice(0, 600));
ok(!/dt-devpage/.test(ctx.landCardHTML(emZr, emParent, emParcels, '84005', null)), 'd8 no page, no link line');
const xssName = ctx.landCardHTML(stZr, stParent, stParcels, '84307', { path: '/development/ut/a/', name: '<img src=x>' });
ok(!/<img/.test(xssName), 'd9 the page name is escaped');
ctx.renderAnchors([{ zr: stZr, parent: stParent, parcels: stParcels, devPage: dp }], '84307');
ok(/Read the project page/.test(dom.dtAnchorBody.innerHTML), 'd10 renderAnchors passes the page to the card');
ok(/LAND_INDEX_URL/.test(SRC.loadDevTracker) && /devPageFor\(idx, parent\)/.test(SRC.loadDevTracker) && /catch\(/.test(SRC.loadDevTracker),
  'd11 loadDevTracker reads the index once and a failed read means no link');
ok(/var LAND_INDEX_URL = "development\/land-index\.json";/.test(html), 'd12 the index URL is the one the build writes');

if (fails) { console.log(`\n${fails} failure(s)`); process.exit(1); }
console.log('\nall land-card checks passed');
