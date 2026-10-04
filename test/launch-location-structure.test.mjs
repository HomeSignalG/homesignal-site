// THE LAUNCH / MANUAL TEST LOCATION — Brigham City, Utah 84302 (founder, 2026-10-04: "use Brigham City, Utah 84302 everywhere the launch/manual test location is needed.
// Do not use Bingham Canyon or ZIP 84006."). The executable halves are test/brigham-city-84302-journey.test.mjs (the real handler and data layer), the launch gate, the trial
// round trip and the customer page in Chromium. What none of them can see is whether they all still use THE SAME place, and whether the place has quietly been treated as a
// source. Pinned here on COMMENT-STRIPPED code (docs are scanned whole), each with a positive control so a scan that matched nothing cannot pass:
//   * the location is defined ONCE, is Brigham City 84302 (Box Elder), and its own header says it is a place and not a source or a clearance;
//   * every launch-path suite imports that one definition;
//   * no launch-path file or document uses the places the founder ruled out, or the earlier fixture place (Springfield, OR 97477 / Evergreen Terrace);
//   * the ZIP is never a clearance: the shipped rights registry has no ZIP in it, no code turns a covered ZIP into a cleared source, and the journey test reads the registry from disk;
//   * the manual test and the launch record keep step 12 and step 13 OPEN and say a test ZIP does not replace sending the Utah requests or clearing a source.
// Run: node test/launch-location-structure.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
process.on('uncaughtException', (e) => {
  console.log('FAIL — the test stopped: ' + String(e && e.message).slice(0, 160));
  console.log('\n' + (n - bad) + ' passed, ' + (bad + 1) + ' failed of ' + (n + 1));
  process.exit(1);
});
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

// ---- 1. one definition ------------------------------------------------------------------------------------------------------------------------------------------
const LOCRAW = read('test/lib/launch-test-location.mjs');
const LOC = stripJs(LOCRAW);
const L = (await import('./lib/launch-test-location.mjs')).LAUNCH_TEST_LOCATION;
ok(LOC.length > 400 && L && typeof L === 'object', '1a the definition is read and exports LAUNCH_TEST_LOCATION (positive control)', LOC.length);
ok(L.label === 'Brigham City, UT 84302' && L.city === 'Brigham City' && L.state === 'UT' && L.zip === '84302' && L.county === 'Box Elder' && L.address === '20 N Main St, Brigham City, UT 84302',
  '1b it is Brigham City, UT 84302, Box Elder County, at 20 N Main St', L);
ok(Object.isFrozen(L), '1c and it is frozen: no test can change the place for the others');
ok(/PLACE/.test(LOCRAW) && /NOT a data source and NOT a clearance/.test(LOCRAW) && /report-rights\.json/.test(LOCRAW) && /build step 12/.test(LOCRAW),
  '1d its own header says it is a place and not a source or a clearance, names the rights registry that decides clearance, and names step 12');
ok(/20 N Main St/.test(LOC) && (LOC.match(/Brigham City/g) || []).length >= 3 && !/\bimport\b/.test(LOC), '1e it imports nothing: the one place a person can read what the test location is');

// ---- 2. every launch-path suite imports it ----------------------------------------------------------------------------------------------------------------------
const SUITES = ['test/launch_gate_pg/roundtrip.mjs', 'test/trial_report_pg/roundtrip.mjs', 'test/development-activity-reports.browser.test.mjs', 'test/brigham-city-84302-journey.test.mjs'];
ok(SUITES.every((f) => read(f).length > 2000), '2a (control) every launch-path suite is read', SUITES.filter((f) => read(f).length <= 2000));
ok(SUITES.every((f) => /from '(\.\.\/lib|\.\/lib)\/launch-test-location\.mjs'/.test(stripJs(read(f)))), '2b and each imports the one definition', SUITES.filter((f) => !/launch-test-location\.mjs/.test(read(f))));
ok(/geocodeStandIn/.test(stripJs(read('test/launch_gate_pg/roundtrip.mjs'))) && /geocodeStandIn/.test(stripJs(read('test/trial_report_pg/roundtrip.mjs'))) && /geocodeStandIn/.test(stripJs(read('test/development-activity-reports.browser.test.mjs'))),
  '2c the three that stand in for the geocoder use the one stand-in, so the point and ZIP they answer are Brigham City\'s');

// ---- 3. no other place ---------------------------------------------------------------------------------------------------------------------------------------------
const OUT = /Bingham|\b84006\b|\b97477\b|Springfield,? OR|Evergreen Terrace/;
const PROHIBITION = /Do not use Bingham Canyon or ZIP 84006/;
const CODE_FILES = [...SUITES, 'test/lib/launch-test-location.mjs', 'test/launch_gate_pg/run.sh', 'test/trial_report_pg/run.sh'];
ok(CODE_FILES.every((f) => !OUT.test(stripJs(read(f)))), '3a no launch-path suite uses Bingham Canyon, ZIP 84006, Springfield OR 97477 or Evergreen Terrace', CODE_FILES.filter((f) => OUT.test(stripJs(read(f)))));
const DOCS = ['docs/development-activity-manual-test-brigham-city-84302.md', 'docs/development-activity-launch-gate-2026-10-04.md'];
const offending = DOCS.filter((f) => read(f).split('\n').some((l) => OUT.test(l) && !PROHIBITION.test(l)));
ok(DOCS.every((f) => read(f).length > 2000) && offending.length === 0, '3b and neither document uses them except to repeat the founder\'s prohibition', offending);
ok(DOCS.every((f) => /Brigham City/.test(read(f)) && /84302/.test(read(f))), '3c (control) both documents do name Brigham City and 84302');
// the harness that finds a forbidden place must be shown able to: the earlier fixture place IS still the fixture of the unit suites that are not launch-path
ok(OUT.test(stripJs(read('test/national-report.test.mjs'))), '3d (control) the scan finds the earlier fixture place where it is still used (the engine\'s own unit suite, which is not a launch-path file)');

// ---- 4. the ZIP is never a clearance ------------------------------------------------------------------------------------------------------------------------------
const RIGHTS = JSON.parse(read('supabase/functions/_shared/report-rights.json') || '{}');
ok(Array.isArray(RIGHTS.cleared) && Object.keys(RIGHTS).every((k) => ['version', 'cleared', '_note', 'note', 'notes', 'description'].includes(k) || typeof k === 'string'), '4a (control) the rights registry is read and has a `cleared` list', Object.keys(RIGHTS));
ok(!JSON.stringify(RIGHTS).includes('84302') && !JSON.stringify(RIGHTS).toLowerCase().includes('brigham'), '4b nothing in the rights registry names Brigham City or 84302: a place is not in the list of what may be shown');
const entryKeys = new Set((RIGHTS.cleared || []).flatMap((e) => Object.keys(e)));
ok([...entryKeys].every((k) => !/zip|county|city|place|geograph/i.test(k)), '4c and a clearance entry is keyed by a source (registry_id), never by a place: no entry has a zip, county or city field', [...entryKeys]);
const NATIONAL = stripJs(read('supabase/functions/_shared/national-report.ts'));
ok(NATIONAL.length > 5000 && !/zip_supported[^;]*cleared|cleared[^;]*zip_supported/.test(NATIONAL), '4d the engine does not derive clearance from the covered-ZIP flag (positive control: the engine is read)', NATIONAL.length);
const JOURNEY = read('test/brigham-city-84302-journey.test.mjs');
ok(/report-rights\.json/.test(JOURNEY) && /readFileSync/.test(JOURNEY) && /covered ZIP is not a clearance/.test(JOURNEY) && /clearing a different source|different source/i.test(JOURNEY),
  '4e the journey test reads the rights registry from disk (not a copy), and carries the checks that a covered ZIP is not a clearance and that another source\'s clearance changes nothing');
ok(/tripwire|TRIPWIRE|fails on purpose/i.test(JOURNEY), '4f and it says that its "nothing is cleared" control is a tripwire: it fails on purpose the day a source is cleared, so the expected answers get updated deliberately');

// ---- 5. step 12 and step 13 stay open -------------------------------------------------------------------------------------------------------------------------------
const MANUAL = read(DOCS[0]);
const RECORD = read(DOCS[1]);
ok(/Step 12 stays open/.test(MANUAL) && /Step 13 stays open/.test(MANUAL) && /does not replace sending the Utah source requests or clearing a source/.test(MANUAL), '5a the manual test says step 12 and step 13 stay open and that it does not replace sending the requests or clearing a source');
ok(/STILL OPEN/.test(RECORD) && /A test ZIP does not replace sending the requests or clearing a source/.test(RECORD) && /deferred, not done/.test(RECORD), '5b the launch record says step 12 and step 13 are still open, that a test ZIP does not replace the requests, and that the Lemon Squeezy work is deferred, not done');
ok(/Lemon Squeezy account creation, the product, the webhook, the secrets and a real payment test/.test(RECORD), '5c and it names what is deferred: account creation, the product, the webhook, the secrets and a real payment test');
const STEPS = read('docs/development-activity-build-steps-100526.md');
ok(!/~~[^~\n]*(12|Twelve)[^~\n]*Utah[^~\n]*~~/i.test(STEPS) && !/~~[^~\n]*Lemon Squeezy[^~\n]*~~/i.test(STEPS) && STEPS.length > 5000, '5d the build-steps checklist does not strike step 12 or step 13 (positive control: the checklist is read)', STEPS.length);

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
