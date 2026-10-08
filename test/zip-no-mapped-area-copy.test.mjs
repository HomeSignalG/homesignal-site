// A ZIP WITH NO CENSUS AREA SAYS SO — founder wording, 2026-10-02 ("use this").
//
// The 706 ZIPs with no ZCTA boundary (PO box, single-organization and similar ZIPs; Fix 4)
// used to read "Development coverage for ZIP … is not measured yet", which says the data is
// coming. For these ZIPs it never will. The founder approved the sentence below, word for
// word. It is pinned WHOLE here, on every path a resident can reach it by: a fragment match
// would let the rest of the sentence change and still pass.
//
// Only the producer status 'unknown' (no serving-state row yet: waiting on a build) keeps
// "not measured yet", because only there is it true.
//
// Run: node test/zip-no-mapped-area-copy.test.mjs
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('   got: ' + JSON.stringify(detail)); }
};

global.window = {};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
new Function(read('../lib/zip-authoritative.js'))();
const HS = global.window.HS;

const FOUNDER = 'ZIP 10048 has no mapped area. The Census does not draw a boundary for this ZIP '
  + 'code — usually because it serves PO boxes or a single organization rather than streets — '
  + 'so we can\'t show development records for it. Enter a street address to see development '
  + 'around that address.';
const PENDING = 'Development coverage for ZIP 10048 is not measured yet — we will not estimate '
  + 'it from a circle around the ZIP centre.';

// §1 the sentence itself
ok(HS.zipNoMappedAreaFact('10048') === FOUNDER, '1a the no-mapped-area sentence is the founder\'s, word for word',
  HS.zipNoMappedAreaFact('10048'));
ok(HS.zipNoMappedAreaFact('').indexOf('This ZIP has no mapped area.') === 0, '1b with no ZIP it reads "This ZIP has no mapped area."');

// §2 every path to it — Map 1 (payload status) and the ZIP pages (the array's `reason`)
ok(HS.zipAuthNote({ status: 'not_measured', projects: null, markers: null }, '10048', []) === FOUNDER,
  '2a Map 1: a not_measured payload shows the sentence exactly once, with no second invitation',
  HS.zipAuthNote({ status: 'not_measured' }, '10048', []));
ok(HS.zipAuthNote({ unavailable: true, zip_geography_status: 'not_measured', projects: null }, '10048', []) === FOUNDER,
  '2b the ZIP-page envelope shape reads the same');
ok(HS.zipAuthUnmeasuredFact('not_measured', '10048', 'not_measured') === FOUNDER,
  '2c ZIP pages: outcome not_measured with reason not_measured shows the sentence');
ok(HS.zipAuthUnmeasuredFact('not_measured', '10048') === FOUNDER,
  '2d a page that does not pass the reason still shows the true sentence (the database refuses not_measured on a ZIP with a boundary)');
ok(HS.zipAuthOutcome({ status: 'not_measured' }) === 'not_measured',
  '2e the outcome vocabulary is unchanged (not_measured is still not_measured)');

// §3 the one case that keeps "not measured yet"
ok(HS.zipAuthUnmeasuredFact('not_measured', '10048', 'unknown') === PENDING,
  '3a a ZIP waiting on a build (reason unknown) keeps "not measured yet", unchanged');
ok(HS.zipAuthNote({ status: 'unknown', projects: null, markers: null }, '10048', [])
     === PENDING + ' Enter an address for the live view around that address.',
  '3b ...and Map 1 keeps its own invitation after it, unchanged');

// §4 nothing else moved
ok(HS.zipAuthUnmeasuredFact('unavailable', '10048', 'not_measured') === 'Development coverage for ZIP 10048 could not be read just now.',
  '4a a failed read still says it could not be read, whatever the status');
ok(HS.zipAuthUnmeasuredFact('complete', '10048', 'not_measured') === '', '4b a complete read gets no unread sentence');

// §5 both ZIP pages pass the reason, so the pending case can be told apart
const cp = read('../lib/community-page.js');
const dev = read('../development.html');
ok(/HS\.zipAuthUnmeasuredFact\(devOutcome, zip, projects && projects\.reason\)/.test(cp),
  '5a the ZIP community page passes the producer status');
ok(/HS\.zipAuthUnmeasuredFact\(devOutcome, S\.zip, projects && projects\.reason\)/.test(dev),
  '5b development.html passes the producer status');
ok(/out\.reason = res\.reason;/.test(read('../lib/data.js')), '5c lib/data.js carries the producer status on the projects array');

// §6 the old sentence is gone from every place a resident can see it, except the pending case
const src = read('../lib/zip-authoritative.js');
ok((src.match(/is not measured yet/g) || []).length === 1, '6a "is not measured yet" is written exactly once, for the pending case');

console.log('FAILS: ' + fails);
process.exit(fails ? 1 : 0);
