// ZIP PAGE "REGULATED FACILITIES" TILE — polygon membership, the same count Map 1 uses.
//
// Canonical path: Census ZCTA → geo.zcta_boundary → public.zip_mode_report_sites
//   → HS.data.zipModeReportSites → HS.zipFacilityMemberCount → the tile.
// The page does not invent a second point-in-polygon predicate. K2 in
// test/zip-membership-canonical.test.mjs already owns zipFacilityMemberCount's
// member / null / no_report behaviour; this suite owns the PAGE WIRING.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

ok(stripJs('/* zip_point_membership_in */\nvar a=1; // ST_Intersects\n').includes('var a=1')
   && !stripJs('/* zip_point_membership_in */\nvar a=1; // ST_Intersects\n').includes('zip_point_membership_in')
   && !stripJs('/* zip_point_membership_in */\nvar a=1; // ST_Intersects\n').includes('ST_Intersects'),
  '§0 comment stripper works in both directions');

const PAGE_BLOCK = [
  '  var zipFacReport = await HS.data.zipModeReportSites(zip);',
  '  var facMembers = HS.zipFacilityMemberCount ? HS.zipFacilityMemberCount(zipFacReport) : null;',
  '  var facOutcome = HS.zipReportOutcome ? HS.zipReportOutcome(zipFacReport) : \'unavailable\';',
  '  var facTotal = (facMembers == null) ? \'\\u2014\' : facMembers;',
  '  window.__HS_ZIP_FACILITIES = { status: facOutcome, member: facMembers };'
].join('\n');

const FAIL_CLOSED = 'if (res.error || !res.data || typeof res.data !== \'object\') return null;';

function scriptOrder(src) {
  const za = src.includes('src="/lib/zip-authoritative.js')
    ? src.indexOf('src="/lib/zip-authoritative.js')
    : src.indexOf('src="lib/zip-authoritative.js');
  const dj = src.includes('src="/lib/data.js')
    ? src.indexOf('src="/lib/data.js')
    : src.indexOf('src="lib/data.js');
  const cp = src.includes('src="/lib/community-page.js')
    ? src.indexOf('src="/lib/community-page.js')
    : src.indexOf('src="lib/community-page.js');
  return za !== -1 && dj !== -1 && cp !== -1 && za < dj && dj < cp;
}

function pins(pageSrc, dataSrc) {
  const page = stripJs(pageSrc);
  const data = stripJs(dataSrc);
  const failed = [];
  if (!/rpc\('zip_mode_report_sites'/.test(data)) failed.push('rpc');
  if (!data.includes(FAIL_CLOSED)) failed.push('null-on-invalid');
  if (!/catch\s*\(\s*e\s*\)\s*\{\s*return null;/.test(data)) failed.push('null-on-throw');
  if (!/async facilities\(zip,\s*home\)/.test(dataSrc)) failed.push('list-path-kept');
  if (!/HS\.data\.zipModeReportSites\(zip\)/.test(page)) failed.push('page-reader');
  if (!/HS\.zipFacilityMemberCount/.test(page)) failed.push('member-count');
  if (!/window\.__HS_ZIP_FACILITIES/.test(page)) failed.push('probe');
  if (!/facTotal = \(facMembers == null\) \? '\\u2014' : facMembers/.test(pageSrc)) failed.push('em-dash');
  if (!/statTile\(facTotal, 'Regulated facilities'/.test(page)) failed.push('tile');
  if (/metaCount\('regulated facilities'/.test(page)) failed.push('no-metaCount');
  if (/HS\.data\.facilities\(zip,\s*home\)/.test(page)) failed.push('no-radius-list');
  if (/ST_Intersects|zip_point_membership_in/.test(page)) failed.push('no-page-predicate');
  if (/ST_Intersects|zip_point_membership_in/.test(data)) failed.push('no-reader-predicate');
  return failed;
}

const pageSrc = read('lib/community-page.js');
const dataSrc = read('lib/data.js');
const htmlSrc = read('community.html');
const pySrc = read('scripts/gen_zip_pages.py');

ok(pageSrc.includes(PAGE_BLOCK), '§1 shipped page block is the exact five-line wiring');
ok(dataSrc.includes(FAIL_CLOSED), '§1 shipped reader fail-closes on an invalid RPC answer');

const shipped = pins(pageSrc, dataSrc);
ok(shipped.length === 0, 'M0 shipped sources pass every wiring pin' + (shipped.length ? '  [' + shipped.join(', ') + ']' : ''));

ok(scriptOrder(htmlSrc), '§2 community.html loads zip-authoritative.js, then data.js, then community-page.js');
ok(scriptOrder(pySrc), '§2 gen_zip_pages.py loads zip-authoritative.js, then data.js, then community-page.js');

const m1 = pageSrc.replace(
  "  var facTotal = (facMembers == null) ? '\\u2014' : facMembers;",
  "  var facTotal = metaCount('regulated facilities', 0);"
);
ok(m1 !== pageSrc, 'M1 mutation actually applies');
ok(pins(m1, dataSrc).includes('em-dash') && pins(m1, dataSrc).includes('no-metaCount'),
  'M1 restoring the radius metaCount fails the tile pins');

const m2 = pageSrc.replace(
  PAGE_BLOCK,
  '  var facilities = await HS.data.facilities(zip, home);\n  var facTotal = facilities.length;'
);
ok(m2 !== pageSrc, 'M2 mutation actually applies');
{
  const f = pins(m2, dataSrc);
  ok(f.includes('page-reader') && f.includes('member-count') && f.includes('no-radius-list'),
    'M2 restoring HS.data.facilities fails the polygon-path pins');
}

const m3 = dataSrc.replace(
  FAIL_CLOSED,
  "if (res.error || !res.data || typeof res.data !== 'object') return { zip: zip, status: 'complete', sites: [], facility_counts: { member: 0, outside: 0, not_measured: 0, no_coordinates: 0 } };"
);
ok(m3 !== dataSrc, 'M3 mutation actually applies');
ok(pins(pageSrc, m3).includes('null-on-invalid'),
  'M3 returning a fake complete-zero on an invalid RPC fails the fail-closed pin');

const m4 = pageSrc.replace(
  "  var facTotal = (facMembers == null) ? '\\u2014' : facMembers;",
  '  var facTotal = facMembers;'
);
ok(m4 !== pageSrc, 'M4 mutation actually applies');
ok(pins(m4, dataSrc).includes('em-dash'),
  'M4 dropping the em-dash fails the unknown-count pin');

ok(pins(pageSrc, dataSrc).length === 0, 'M5 shipped sources still pass after the mutations (control)');

console.log('\n' + (fails ? fails + ' assertion(s) FAILED' : 'all assertions passed'));
process.exit(fails ? 1 : 0);
