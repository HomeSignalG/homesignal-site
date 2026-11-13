// Reviewed project points for Map 1 (development/map-index.json, 2026-11-12).
//
// A published development page gets ONE point on ONE ZIP map only through a site_location link a reviewer
// approved, whose point the database put in exactly one ZIP (docs/development-dossier.sql
// development_site_location_facts). Runs the SHIPPED generator (scripts/gen_zip_pages.py) on the shared
// dossier fixture, then Map 1's own reader and popup functions from homesignalmap.html. Pinned:
//   1. the build writes the point, the page's name and path, and the reviewer's basis; nothing else
//   2. no location, two locations, a point on a shared ZIP edge, or bad coordinates: no point
//   3. the dossier page says "Approximate location", links the ZIP map and says it is not a boundary
//   4. Map 1 reads only that file, accepts only well-formed entries for its own ZIP, and the popup
//      says approximate, not a boundary, and links the project page
//   5. the point is not a record: it is not in siteMarkers, so no count, rail or filter includes it
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { root, dossiers, build, read } from './lib/development-pages-fixture.mjs';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m, d); } };
const A = '/development/ma/valley-campus/';
const LOC = (ref, zips, extra = {}) => ({
  kind: 'site_location', ref, role: 'approximate_location', grade: 'b',
  evidence_url: 'https://www2.tceq.texas.gov/airperm/index.cfm?x=1', evidence_label: 'State air permit record',
  evidence_note: 'Placed from the agency’s written directions to the site.', text: 'one point near the port road',
  facts: { lat: Number(ref.split(',')[0]), lng: Number(ref.split(',')[1]), zips }, ...extra });
const idxOf = (out) => {
  const f = join(out, 'development', 'map-index.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

// 1. one approved location in one ZIP
const d1 = dossiers(); d1.dossiers['valley-campus'].links.push(LOC('42.3800,-72.5200', ['01002']));
const b1 = build(d1);
ok(b1.r.status === 0, 'the build passes with a location link', b1.r.stderr);
const i1 = idxOf(b1.out);
ok(i1 && i1.schema === 'development-map-index/1', 'the build writes development/map-index.json', JSON.stringify(i1));
ok(i1 && JSON.stringify(i1.zips) === JSON.stringify({ '01002': [{
  basis: 'Placed from the agency’s written directions to the site.', lat: 42.38, lng: -72.52,
  name: 'Valley data center <campus>', path: A }] }), 'one point: the page, its name, the point and the basis, nothing more',
  JSON.stringify(i1 && i1.zips));

// 2. every refusal leaves the project off the map
const none = idxOf(build(dossiers()).out);
ok(none && JSON.stringify(none.zips) === '{}', 'no location link: no point', JSON.stringify(none));
const d2 = dossiers(); d2.dossiers['valley-campus'].links.push(LOC('42.3800,-72.5200', ['01002']), LOC('42.3900,-72.5300', ['01002']));
ok(JSON.stringify(idxOf(build(d2).out).zips) === '{}', 'two location links: no point, rather than a guessed one');
const d3 = dossiers(); d3.dossiers['valley-campus'].links.push(LOC('42.3800,-72.5200', ['01002', '01003']));
ok(JSON.stringify(idxOf(build(d3).out).zips) === '{}', 'a point on a shared ZIP edge: on no map');
const d4 = dossiers(); d4.dossiers['valley-campus'].links.push(LOC('42.3800,-72.5200', []));
ok(JSON.stringify(idxOf(build(d4).out).zips) === '{}', 'a point in no ZIP with a page: no point');
const d5 = dossiers(); d5.dossiers['valley-campus'].links.push(LOC('42.3800,-72.5200', ['01002'], { facts: { lat: '42.38', lng: -72.52, zips: ['01002'] } }));
ok(JSON.stringify(idxOf(build(d5).out).zips) === '{}', 'a coordinate that is not a number: no point');
ok(!existsSync(join(build(undefined).out, 'development', 'map-index.json')), 'no dossiers, no map index');

// 3. the dossier page names it as an approximate point, not a site or a boundary
const pa = read(b1.out, A);
ok(/Approximate location on the <a href="\/map\/01002\/">ZIP 01002 map<\/a>: one point near the port road\./.test(pa),
   'the page says Approximate location and links the ZIP map', (pa.match(/Approximate location[^<]*<a[^>]*>[^<]*<\/a>[^<]*/) || [''])[0]);
ok(/One point, not a surveyed site or a project boundary\./.test(pa), 'the page says it is not a surveyed site or a boundary');
ok(pa.includes('href="https://www2.tceq.texas.gov/airperm/index.cfm?x=1"'), 'the location cites its source');
ok(!/footprint of the project|project boundary:/i.test(pa), 'the page never calls the point a footprint');

// 4. Map 1's reader and popup, from the shipped page
const html = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
const fnSrc = (name) => {
  const i = html.indexOf('  function ' + name + '(');
  if (i < 0) return '';
  let depth = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) { if (html[k] === '{') depth++; else if (html[k] === '}' && --depth === 0) return html.slice(i, k + 1); }
  return '';
};
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fnSrc('esc') + '\n' + fnSrc('escAttr') + '\n' + fnSrc('reviewedPointsFor') + '\n' + fnSrc('reviewedPopupHTML') +
  '\nthis.reviewedPointsFor = reviewedPointsFor; this.reviewedPopupHTML = reviewedPopupHTML;', ctx);
ok(typeof ctx.reviewedPointsFor === 'function' && typeof ctx.reviewedPopupHTML === 'function', 'Map 1 carries the reader and the popup');
ok(/var MAP_INDEX_URL = "development\/map-index\.json";/.test(html), 'Map 1 reads the file the build writes');
const pts = ctx.reviewedPointsFor(i1, '01002');
ok(pts.length === 1 && pts[0].path === A, 'the reader returns the point for its own ZIP', JSON.stringify(pts));
ok(ctx.reviewedPointsFor(i1, '01003').length === 0, 'and nothing for another ZIP');
const bad = { schema: 'development-map-index/1', zips: { '01002': [
  { path: 'https://evil.example/', name: 'x', lat: 1, lng: 1 }, { path: A, name: '', lat: 1, lng: 1 },
  { path: A, name: 'x', lat: 'NaN', lng: 1 }, { path: A, name: 'x', lat: 91, lng: 1 }] } };
ok(ctx.reviewedPointsFor(bad, '01002').length === 0, 'a foreign path, no name, or a bad coordinate is refused');
ok(ctx.reviewedPointsFor({ schema: 'other', zips: i1.zips }, '01002').length === 0, 'a file of another shape is refused');
const pop = ctx.reviewedPopupHTML(pts[0]);
ok(/Approximate location: one point placed from the records\. It is not a surveyed site or a project boundary\./.test(pop),
   'the popup says approximate, not a site or a boundary', pop);
ok(pop.includes("href='/development/ma/valley-campus/'") && pop.includes('Project page'), 'the popup links the project page');
ok(pop.includes('Valley data center &lt;campus&gt;') && !pop.includes('<campus>'), 'the name is escaped');

// 5. the point is not a record
const draw = fnSrc('drawReviewedProjects');
ok(draw && !/siteMarkers/.test(draw) && !/applyFilter|bucketOf|publishVerifyState/.test(draw),
   'the point is drawn on its own layer, outside the records, counts and filters');
ok(/drawParcels\(\);\n\s*drawReviewedProjects\(\);/.test(html), 'it is redrawn whenever the records are');
ok(/loadZip\(z\); loadDevTracker\(z\); loadReviewedProjects\(z\);/.test(html) && /loadZip\(ez\);[^\n]*\n\s*loadReviewedProjects\(ez\);/.test(html),
   'the full map and the ZIP-page embed both load it');

// 6. a linked hearing dated on or after the build day is in What's next; a past one is not (the page
// used to say "No upcoming hearing" beside a timeline that listed one)
const d6 = dossiers();
d6.dossiers['valley-campus'].links.push({ kind: 'government_record', ref: 'https://city.example.gov/notice.pdf', role: 'hearing',
  grade: 'a', evidence_url: 'https://city.example.gov/notice.pdf', evidence_label: 'Hearing notice',
  text: 'The commission will consider an abatement; the notice states no outcome.', date: '2026-12-09',
  date_label: 'Hearing scheduled, 7:00 p.m.', facts: {} });
const p6 = read(build(d6).out, A);
const next6 = (p6.match(/<ul class="dnext">[\s\S]*?<\/ul>/g) || []).join(' ');
ok(/Dec 9, 2026<\/strong>: Hearing scheduled, 7:00 p\.m\.\. The commission will consider an abatement/.test(next6),
   "a future hearing is listed in What's next with the source's own date and words", next6.slice(0, 400));
ok(!/Jul 15, 2026/.test(next6), "a past agenda item is not in What's next");
ok(!/No upcoming hearing or deadline confirmed/.test(p6), 'the page no longer says no hearing is on record');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
