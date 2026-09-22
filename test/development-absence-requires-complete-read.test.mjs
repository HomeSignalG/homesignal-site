// DEVELOPMENT ABSENCE IS REACHABLE IF AND ONLY IF THE AUTHORITATIVE READ SUCCEEDED AND
// RETURNED NOTHING.
//
// THE DEFECT THIS FILE EXISTS TO PREVENT. `public.app_projects_for_zip(p_zip, p_kind)`
// returns ONE jsonb value: a bare ARRAY on success, and on a ZIP whose whole-ZIP geography
// is not established a deliberate envelope —
//
//     { "unavailable": true, "zip_geography_status": "not_measured", "projects": null }
//
// The producer is fail-closed and honest. Its CONSUMERS were not. `rpcAllRows` discarded
// the reason, and every resident-facing surface then decided on `rows.length`:
//
//   lib/community-page.js   "No permit or planning records on file for this ZIP yet"
//   development.html        "Nothing on the public record near here yet"
//   property.html           the "Nearby projects" vital printed a confident 0
//
// Measured 2026-09-22 off the indexed geography state (NOT a 12,722-call RPC scan):
// 709 of 12,722 canonical ZIPs take that branch — 706 `not_measured`, 3 `unknown` — of
// which 18 are in Utah. On 84011 the page asserted a verified absence over 60
// source-stated development rows.
//
// THIS IS NOT A NEW CONVENTION. lib/zip-authoritative.js states the same rule as its own
// rule 1 — "`null` IS NOT `[]` … Never use `(x || []).length` to decide" — and already
// owns the status vocabulary and the classifier for the OTHER producer of the same
// geography truth. Nothing here re-decides it; every consumer delegates.
//
// FOUR STATES, and the whole point is that the middle two are not the same fact:
//   VERIFIED DATA      complete read, rows > 0
//   VERIFIED ZERO      complete read, rows === 0     <- the ONLY absence-claim state
//   KNOWN UNAVAILABLE  the producer refused, and said why (not_measured / unknown)
//   READ FAILURE       transport failed, or a shape we do not understand
//
// ⚠️ THE MODEL IS NOT THE PRODUCT. Truth tables prove the RULE; they cannot prove a
// shipped page composes it. Every semantic case below is therefore paired with a
// STRUCTURAL assertion against the real files — read with whole-line comments stripped,
// because this file's own fix comments QUOTE the strings they forbid (CLAUDE.md: "a pin
// that names the string it forbids cannot also search the whole file for it").
//
// Run: node test/development-absence-requires-complete-read.test.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

/** Executable source only: every whole-line // or # comment removed. */
const exec = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|#)/.test(l)).join('\n');
const read = (p) => readFileSync(join(root, p), 'utf8');

const pageSrc = read('lib/community-page.js');
const pageExec = exec(pageSrc);
const dataSrc = read('lib/data.js');
const dataExec = exec(dataSrc);
const devSrc = read('development.html');
const devExec = exec(devSrc);
const propSrc = read('property.html');
const propExec = exec(propSrc);

// ── harness ───────────────────────────────────────────────────────────────────────────
// Drives the SHIPPED lib/data.js against a stubbed supabase client. Nothing is
// reimplemented: rpcAllRows and projects() are the production functions.
function makeSb(...results) {
  let i = 0;
  return { rpc: async () => (i < results.length ? results[i++] : results[results.length - 1]) };
}
let rpcCalls = 0;
function makeCountingSb(result) {
  return { rpc: async () => { rpcCalls++; return result; } };
}
function loadData(sbClient) {
  delete require.cache[require.resolve('../lib/data.js')];
  global.window = {
    HS_CONFIG: { DATA_SOURCE: 'supabase', DEFAULT_ZIP: '84011' },
    HS: { state: { session: null, zip: '84011' } },
    supabase: { createClient: () => sbClient },
  };
  // The canonical owner of the geography vocabulary — loaded exactly as the pages load it.
  delete require.cache[require.resolve('../lib/zip-authoritative.js')];
  require('../lib/zip-authoritative.js');
  require('../lib/data.js');
  return global.window.HS;
}
const UNAVAILABLE = (status) => ({
  data: { unavailable: true, zip_geography_status: status, projects: null }, error: null,
});
const devRow = (id) => ({ id, name: 'Row ' + id, status: 'Proposed', record_url: 'https://x/' + id });

// ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n1. A successful read WITH records is complete and carries its rows');
{
  const HS = loadData(makeSb({ data: [devRow(1), devRow(2)], error: null }));
  const r = await HS.rpcAllRows('84302', 'development');
  ok(r.rows.length === 2, '1a two rows survive');
  ok(r.complete === true, '1b transport complete');
  ok(r.outcome === 'complete', '1c outcome complete');
  ok(r.reason === null, '1d a success carries no reason');
}

console.log('\n2. A successful read with ZERO records is a MEASURED ZERO, not a refusal');
{
  const HS = loadData(makeSb({ data: [], error: null }));
  const r = await HS.rpcAllRows('84302', 'development');
  ok(r.rows.length === 0 && r.complete === true, '2a empty array: zero rows, complete');
  ok(r.outcome === 'complete', '2b an EMPTY array is still a complete read (rule 1, forwards)');
  // The whole point: 2 must not equal 3, 4 or 5.
  const HSb = loadData(makeSb(UNAVAILABLE('not_measured')));
  const nm = await HSb.rpcAllRows('84011', 'development');
  ok(r.outcome !== nm.outcome, '2c measured zero !== not measured');
  const HSc = loadData(makeSb({ data: null, error: { message: 'boom' } }));
  const fail = await HSc.rpcAllRows('84011', 'development');
  ok(r.outcome !== fail.outcome, '2d measured zero !== transport failure');
  ok(r.complete !== fail.complete, '2e ... and they differ on `complete` too');
}

console.log('\n3. KNOWN UNAVAILABLE — the producer refused and said why');
{
  for (const status of ['not_measured', 'unknown']) {
    const HS = loadData(makeSb(UNAVAILABLE(status)));
    const r = await HS.rpcAllRows('84011', 'development');
    ok(r.complete === false, `3a ${status} -> complete:false`);
    ok(r.outcome === 'not_measured', `3b ${status} -> outcome not_measured (both producer words)`);
    ok(r.reason === status, `3c ${status} -> the producer's own word is preserved verbatim`);
    ok(Array.isArray(r.rows) && r.rows.length === 0, `3d ${status} still yields an array`);
  }
  // A status this consumer does not understand must NEVER read as measured-and-empty.
  const HSx = loadData(makeSb(UNAVAILABLE('some_future_word')));
  const x = await HSx.rpcAllRows('84011', 'development');
  ok(x.outcome === 'unavailable', '3e an unrecognised status falls to unavailable, never complete');
  ok(x.complete === false, '3f ... and is never complete');
}

console.log('\n4. READ FAILURE — transport error and unrecognised shapes');
{
  const HS = loadData(makeSb({ data: null, error: { message: 'network' } }));
  const r = await HS.rpcAllRows('84011', 'development');
  ok(r.complete === false && r.outcome === 'unavailable', '4a error -> unavailable, not complete');
  ok(r.rows.length === 0, '4b still an array, never null');

  const HSn = loadData(makeSb({ data: null, error: null }));
  const n = await HSn.rpcAllRows('84011', 'development');
  ok(n.outcome === 'unavailable', '4c a null payload is never a zero');

  // An object that is neither an array nor the unavailable envelope.
  const HSo = loadData(makeSb({ data: { projects: [] }, error: null }));
  const o = await HSo.rpcAllRows('84011', 'development');
  ok(o.outcome === 'unavailable' && o.complete === false, '4d an unknown object shape is unavailable');
}

console.log('\n5. RETRY SEMANTICS — a deterministic refusal is NOT retried; a transient one is');
{
  // Asking the identical question of the identical state gets the identical answer, so a
  // retry there is pure waste on every one of those 709 pages, on every load.
  rpcCalls = 0;
  const HS = loadData(makeCountingSb(UNAVAILABLE('not_measured')));
  await HS.rpcAllRows('84011', 'development');
  ok(rpcCalls === 1, '5a a deliberate unavailable envelope is read ONCE');

  rpcCalls = 0;
  const HSf = loadData(makeCountingSb({ data: null, error: { message: 'boom' } }));
  await HSf.rpcAllRows('84011', 'development');
  ok(rpcCalls === 2, '5b a transport error KEEPS the retry the helper was written for');

  // A retry that succeeds must succeed — the retry is not decorative.
  const HSr = loadData(makeSb({ data: null, error: { message: 'flaky' } }, { data: [devRow(9)], error: null }));
  const r = await HSr.rpcAllRows('84011', 'development');
  ok(r.complete === true && r.rows.length === 1, '5c a transient failure recovers on the retry');
}

console.log('\n6. projects() CARRIES the verdict to the page — it is not lost on the way');
{
  const HS = loadData(makeSb(UNAVAILABLE('not_measured')));
  const out = await HS.data.projects('84011', null);
  ok(Array.isArray(out) && out.length === 0, '6a an array, so every existing consumer still works');
  ok(out.complete === false, '6b `complete` rides on the array');
  ok(out.outcome === 'not_measured', '6c `outcome` rides on the array');
  ok(out.reason === 'not_measured', '6d the producer word rides on the array');

  const HSok = loadData(makeSb({ data: [], error: null }));
  const good = await HSok.data.projects('84302', null);
  ok(good.complete === true && good.outcome === 'complete', '6e a measured zero says so');
}

console.log('\n7. withDistance MUST NOT LAUNDER the verdict (property.html re-distances)');
{
  const HS = loadData(makeSb(UNAVAILABLE('not_measured')));
  const out = await HS.data.projects('84011', null);
  const again = HS.withDistance(out, { lat: 40, lng: -111 });
  ok(again.complete === false, '7a `complete` survives a re-distance');
  ok(again.outcome === 'not_measured', '7b `outcome` survives a re-distance');
  ok(again.sort(() => 0).outcome === 'not_measured', '7c ... and survives the sort that follows it');
  // And a plain array must not ACQUIRE a verdict it never had.
  const plain = HS.withDistance([devRow(1)], null);
  ok(!('complete' in plain) && !('outcome' in plain),
    '7d an array with no verdict does not gain a fabricated one');
}

console.log('\n8. THE COPY COMES FROM THE ONE OWNER, and Map 1 is byte-for-byte unchanged');
{
  const HS = loadData(makeSb({ data: [], error: null }));
  const nm = HS.zipAuthUnmeasuredFact('not_measured', '84011');
  const un = HS.zipAuthUnmeasuredFact('unavailable', '84011');
  ok(/not measured yet/.test(nm) && /84011/.test(nm), '8a not_measured states the fact, names the ZIP');
  ok(/could not be read/.test(un), '8b unavailable states a read failure, not an absence');
  ok(!/no records|nothing|not on file|no permit/i.test(nm + un),
    '8c neither sentence asserts an absence of records');
  ok(!/enter an address/i.test(nm),
    '8d the fact carries NO address-box invitation — the ZIP page has no such control');
  ok(HS.zipAuthUnmeasuredFact('complete', '84011') === '',
    '8e a complete read gets no unread sentence');
  // The refactor must not have reworded Map 1's live sentence on 1,259 pages.
  const expected = 'Development coverage for ZIP 84011 is not measured yet — we will not estimate '
    + 'it from a circle around the ZIP centre. Enter an address for the live view around that address.';
  ok(HS.zipAuthNote({ status: 'not_measured' }, '84011', []) === expected,
    '8f zipAuthNote is BYTE-IDENTICAL to its pre-refactor output');
  ok(HS.zipAuthNote({ status: 'boundary_complete', projects: [], markers: [] }, '84011', [])
      === 'No qualifying development records across ZIP 84011. This is a measurement of the '
        + 'whole ZIP, not an empty search.',
    '8g ... and its measured-zero sentence is untouched');
}

console.log('\n9. THE PRODUCER IS UNTOUCHED — no consumer substitutes its own geography');
{
  // Needles are the GEOGRAPHY SUBSTITUTIONS the founder rule forbids, word-bounded. A bare
  // /radius/ was tried first and matched `border-radius:12px` — an over-flagging pin is how
  // a real violation gets waved through later, so it is scoped to the concept, not the word.
  ok(!/\bzcta\b|st_within|st_intersects|zipCentroid|ZIP_RADIUS|spatial_zip_radius|radius_mi/i.test(pageExec),
    '9a the ZIP page derives no geography of its own');
  ok(!/\bfrom\(['"]app_projects['"]\)/.test(pageExec),
    '9b the ZIP page never falls back to a direct app_projects read');
  ok(!/84011|\b709\b\s*[=:]/.test(pageExec),
    '9c no hard-coded ZIP or cohort list is compiled into the page');
  ok(!/unavailable[\s\S]{0,80}\[\]/.test(dataExec.match(/async function rpcAllRows[\s\S]*?\n  }/)[0]
        .replace(/rows: \[\], complete: false/g, '')),
    '9d rpcAllRows never converts an unavailable envelope into a plain empty result');
}

// ══════════════════════════════════════════════════════════════════════════════════════
// STRUCTURAL — the shipped surfaces must COMPOSE the rule, not merely be able to.
console.log('\n10. STRUCTURAL — lib/community-page.js');
{
  ok(/devReadComplete\s*=\s*projects\.complete === true/.test(pageExec),
    '10a the gate tests `complete === true` (fail closed), not a truthiness');
  ok(/devOutcome\s*=\s*\(projects && projects\.outcome\) \|\| 'unavailable'/.test(pageExec),
    '10b a missing outcome defaults to unavailable, never to complete');
  ok(/devOutcome === 'complete'/.test(pageExec),
    '10c the gate tests for the VALUE complete, not for the absence of a failure');
  // The absence sentence must sit on the devReadComplete branch.
  const absence = pageExec.indexOf('No permit or planning records on file');
  ok(absence > 0, '10d the verified-zero sentence still exists (it was not deleted)');
  const before = pageExec.slice(Math.max(0, absence - 400), absence);
  ok(/devReadComplete/.test(before),
    '10e ... and it is guarded by devReadComplete within the same expression');
  ok(/HS\.zipAuthUnmeasuredFact/.test(pageExec),
    '10f the unread state uses the owner\'s words, not the page\'s own');
  // The page must not re-derive the status vocabulary.
  ok(!/'not_measured'|"not_measured"|boundary_complete/.test(pageExec),
    '10g the page holds NO copy of the producer status vocabulary');
  ok(/devReadComplete && devTotal > projects\.length/.test(pageExec),
    '10h "latest N shown" is not claimed on a read that did not happen');
}

console.log('\n11. STRUCTURAL — development.html');
{
  ok(/devReadComplete\s*=\s*projects\.complete === true/.test(devExec), '11a same fail-closed gate');
  ok(/devOutcome === 'complete'/.test(devExec), '11b tests for the VALUE complete');
  const absence = devExec.indexOf('Nothing on the public record near here yet');
  ok(absence > 0, '11c the verified-zero heading still exists');
  ok(/devReadComplete/.test(devExec.slice(Math.max(0, absence - 400), absence)),
    '11d ... and is guarded by devReadComplete');
  ok(/if \(devReadComplete && !projects\.length/.test(devExec),
    '11e the source-naming coverage block is only built on a read that happened');
  ok(/HS\.zipAuthUnmeasuredFact/.test(devExec), '11f the unread state uses the owner\'s words');
  ok(!/'not_measured'|"not_measured"|boundary_complete/.test(devExec),
    '11g no copy of the producer vocabulary');
}

console.log('\n12. STRUCTURAL — property.html');
{
  ok(/devReadComplete\s*=\s*projects\.complete === true/.test(propExec), '12a same fail-closed gate');
  // The em dash may be written as the character or as the \u2014 escape — both compile to
  // the same string, and pinning one spelling would fail a correct file.
  ok(/devReadComplete \? near\.length : '(\u2014|\\u2014)'/.test(propExec),
    '12b the vital refuses to state a count it cannot stand behind (Map 1\'s em dash)');
  ok(!/'not_measured'|"not_measured"|boundary_complete/.test(propExec),
    '12c no copy of the producer vocabulary');
}

console.log('\n13. STRUCTURAL — the canonical owner is actually LOADED where it is consumed');
{
  // A page that reads HS.zipAuthUnmeasuredFact without loading the module fails closed and
  // silently loses the not_measured/unavailable distinction on every one of its ZIPs.
  for (const f of ['community.html', 'development.html', 'property.html']) {
    ok(/<script src="lib\/zip-authoritative\.js/.test(read(f)), `13a ${f} loads the owner`);
  }
  ok(/<script src="\/lib\/zip-authoritative\.js/.test(read('scripts/gen_zip_pages.py')),
    '13b the generated /community/<zip>/ document loads it too (same shared runtime)');
  ok(/HS\.zipAuthOutcome/.test(dataExec),
    '13c lib/data.js delegates classification to the owner rather than re-deciding');
  ok(!/zip_geography_status === |=== 'not_measured'/.test(dataExec),
    '13d ... and holds no second copy of the status vocabulary');
}

console.log('\n14. THE OWNER STILL OWNS IT — one classifier, both producer shapes');
{
  const HS = loadData(makeSb({ data: [], error: null }));
  const O = HS.zipAuthOutcome;
  // Map 1's envelope (unchanged behaviour).
  ok(O({ status: 'boundary_complete', projects: [], markers: [] }) === 'complete', '14a markers envelope');
  ok(O({ status: 'not_measured', projects: null, markers: null }) === 'not_measured', '14b not_measured');
  ok(O({ status: 'unknown' }) === 'not_measured', '14c unknown is also not-measured');
  // The development producer's two shapes.
  ok(O([]) === 'complete' && O([devRow(1)]) === 'complete', '14d a bare array is complete');
  ok(O({ unavailable: true, zip_geography_status: 'not_measured' }) === 'not_measured',
    '14e the development envelope classifies on zip_geography_status');
  // Fail closed in every direction.
  ok(O(null) === 'unavailable' && O(undefined) === 'unavailable', '14f nothing is never complete');
  ok(O({ status: 'boundary_complete', projects: null, markers: null }) === 'unavailable',
    '14g boundary_complete with NULL arrays is not complete (rule 1)');
  ok(O('boundary_complete') === 'unavailable', '14h a bare string is never complete');
}

console.log('\n' + (fails ? `FAILED — ${fails} assertion(s)` : 'OK — all assertions passed'));
process.exit(fails ? 1 : 0);
