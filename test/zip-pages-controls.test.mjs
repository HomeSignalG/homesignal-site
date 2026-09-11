// OFFLINE SUITE for crawler-proof CONTROL RESOLUTION — no network, no browser, no build.
//
// WHY THIS EXISTS. The controls were FROZEN, and normal ingestion kept moving ZIPs out of
// their class: 07010, then 01002 and 04401 on 2026-09-11. Each time `pages` went red, and a
// red pages build means the site does not update. rule_f_pass read 8,291 / 8,380 / 8,372
// across three builds — TWO OF THEM ON THE SAME COMMIT — so the data genuinely moves
// hour to hour and no pinned ZIP is safe indefinitely.
//
// The argument for freezing was: a control derived from the build it tests cannot catch a
// build-wide misclassification, because the class comes back empty and its assertion passes
// over nothing. That premise is TRUE and the conclusion does not follow — it is answered by
// asserting the class is NON-EMPTY. These checks pin all three behaviours, because getting
// only two of them is how this silently stops guarding:
//   1. a pin that still qualifies is KEPT        (runs stay comparable day to day)
//   2. a pin that has drifted SUBSTITUTES        (drift is visible, never an outage)
//   3. a class with no members is EMPTY          (the build-wide misclassification, loud)
// Run: node scripts/run-unit-tests.mjs   (or: node test/zip-pages-controls.test.mjs)
// Imports the PURE LIB, never scripts/prove-zip-pages.mjs — that module imports playwright,
// which the offline unit job does not install. Importing it here passed locally (this sandbox
// has playwright globally) and failed in CI, and the runner could not warn because it detects
// browser suites by text-matching the TEST FILE for a playwright import, which cannot see a
// transitive one.
import { classifyMembers, chooseControls } from '../scripts/lib/zip-page-controls.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

// A synthetic _site: five ZIPs covering the classes the resolver derives.
const DOC = (o = {}) => [
  o.weather ? '<h2>Weather alerts</h2><ul><li>x</li></ul>' : '',
  o.ln ? '<h2>Local news</h2><ul><li>x</li></ul>' : '',
  o.gn ? '<h2>Government notices</h2><ul><li>x</li></ul>'
       : 'No government notices on file for this ZIP yet.',
  o.um ? '<h2>Upcoming public meetings</h2><ul><li>x</li></ul>'
       : 'No upcoming public meetings on file for this ZIP yet.',
].join('');

const FILES = {
  '10001': DOC({ ln: true, gn: true, um: true }),   // Rule F pass, dev pass
  '10002': DOC({ ln: true, gn: true }),             // Rule F pass, dev FAIL
  '10003': DOC({ weather: true }),                  // Rule F fail, dev pass, weather, empty
  '10004': DOC({}),                                 // Rule F fail, dev fail, honest empty
  '10005': DOC({ ln: true, gn: true, um: true }),   // a second pass+dev page
};
const MAN = { indexable_zips: ['10001', '10002', '10005'], dev_indexable_zips: ['10001', '10003', '10005'] };
const deps = {
  readdir: async () => Object.keys(FILES).map((name) => ({ name, isDirectory: () => true })),
  readFile: async (p) => { const z = String(p).match(/(\d{5})/)[1]; return FILES[z]; },
};

const main = async () => {
  const m = await classifyMembers('_site', MAN, deps);

  console.log('0) the classifier buckets each ZIP by what the DOCUMENT says');
  ok('pass_dev_pass = Rule F pass AND development pass',
    JSON.stringify(m.pass_dev_pass) === JSON.stringify(['10001', '10005']), JSON.stringify(m.pass_dev_pass));
  ok('pass_dev_fail = Rule F pass, development FAIL',
    JSON.stringify(m.pass_dev_fail) === JSON.stringify(['10002']), JSON.stringify(m.pass_dev_fail));
  ok('fail_dev_pass = Rule F FAIL, development pass',
    JSON.stringify(m.fail_dev_pass) === JSON.stringify(['10003']), JSON.stringify(m.fail_dev_pass));
  ok('fail_dev_fail = both FAIL',
    JSON.stringify(m.fail_dev_fail) === JSON.stringify(['10004']), JSON.stringify(m.fail_dev_fail));
  ok('weather_thin = weather DISPLAYED while still under Rule F',
    JSON.stringify(m.weather_thin) === JSON.stringify(['10003']), JSON.stringify(m.weather_thin));
  ok('honest_empty = no notices AND no meetings',
    JSON.stringify(m.honest_empty) === JSON.stringify(['10003', '10004']), JSON.stringify(m.honest_empty));
  ok('a Rule F PASS page is never in weather_thin — weather never carries Rule F',
    !m.weather_thin.includes('10001'));

  console.log('\n1) A PIN THAT STILL QUALIFIES IS KEPT (runs stay comparable)');
  {
    const r = chooseControls({ pass_dev_pass: '10005', point_dense: '99999' }, m);
    ok('the valid pin is used, not the first member', r.controls.pass_dev_pass === '10005', r.controls.pass_dev_pass);
    ok('...and reported as no substitution', r.notes.length === 0, JSON.stringify(r.notes));
    ok('an UNPINNED class produces no note either — a line that fires on every class on every '
      + 'build would bury the one that means something',
      !r.notes.some((n) => /\(none\)/.test(n)), JSON.stringify(r.notes));
    ok('point_dense is passed through untouched — it is the one control that is NOT derived',
      r.controls.point_dense === '99999');
  }

  console.log('\n2) A DRIFTED PIN SUBSTITUTES, AND SAYS SO (this is the outage that stops)');
  {
    // 01002/04401 shape: the pinned ZIP crossed Rule F and left its class.
    const r = chooseControls({ fail_dev_pass: '10001', point_dense: '99999' }, m);
    ok('a drifted pin is replaced by a real member', r.controls.fail_dev_pass === '10003', r.controls.fail_dev_pass);
    ok('no class is reported empty', r.empties.length === 0, JSON.stringify(r.empties));
    ok('the substitution is LOGGED, not silent',
      r.notes.some((n) => /fail_dev_pass: pinned 10001 no longer qualifies -> using 10003/.test(n)),
      JSON.stringify(r.notes));
  }
  {
    const r = chooseControls({ point_dense: '99999' }, m);   // no pin at all
    ok('an unpinned class still resolves to its first member', r.controls.weather_thin === '10003');
  }

  console.log('\n3) AN EMPTY CLASS IS A HARD FAILURE (the reason freezing existed)');
  {
    // Every ZIP passes Rule F — the shape a build-wide misclassification would produce.
    const allPass = { indexable_zips: Object.keys(FILES), dev_indexable_zips: ['10001'] };
    const m2 = await classifyMembers('_site', allPass, deps);
    const r = chooseControls({ point_dense: '99999' }, m2);
    ok('fail_dev_pass reports EMPTY', r.empties.includes('fail_dev_pass'), JSON.stringify(r.empties));
    ok('weather_thin reports EMPTY', r.empties.includes('weather_thin'), JSON.stringify(r.empties));
    ok('...and an empty class yields NO control, so its assertion cannot pass over nothing',
      r.controls.fail_dev_pass === undefined && r.controls.weather_thin === undefined,
      JSON.stringify(r.controls));
    ok('classes that still have members are unaffected', r.controls.pass_dev_pass === '10001');
  }

  console.log('\n4) THE MANIFEST MUST CARRY THE DEVELOPMENT GATE');
  {
    let threw = null;
    try { await classifyMembers('_site', { indexable_zips: ['10001'] }, deps); }
    catch (e) { threw = e.message; }
    ok('a manifest without dev_indexable_zips FAILS CLOSED rather than classifying every ZIP as dev-fail',
      /dev_indexable_zips/.test(threw || ''), String(threw));
  }

  console.log('\n5) NO OFFLINE SUITE MAY REACH PLAYWRIGHT THROUGH A TRANSITIVE IMPORT');
  {
    // THE RUNNER CANNOT CATCH THIS AND THAT IS WHY THE CHECK LIVES HERE.
    // scripts/run-unit-tests.mjs classifies a suite by text-matching
    // /(?:from|import\(|require\()\s*['"]playwright['"]/ against the TEST FILE ITSELF. A file
    // that imports a module that imports playwright reads as offline, is run in the job that
    // installs no playwright, and dies there — while passing on any machine that happens to
    // have playwright installed, which is how this shipped to CI once already.
    const { readFileSync, readdirSync } = await import('node:fs');
    const { dirname, resolve, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const testDir = dirname(fileURLToPath(import.meta.url));
    const PW = /(?:from|import\(|require\()\s*['"]playwright['"]/;
    const reaches = (entry) => {
      const seen = new Set(); const stack = [entry];
      while (stack.length) {
        const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
        let src; try { src = readFileSync(f, 'utf8'); } catch { continue; }
        if (f !== entry && PW.test(src)) return f;      // a DEPENDENCY pulls it in
        for (const m of src.matchAll(/(?:from|import\(|require\()\s*['"](\.[^'"]+)['"]/g)) {
          stack.push(resolve(dirname(f), m[1]));
        }
      }
      return null;
    };
    const offline = readdirSync(testDir).filter((f) => f.endsWith('.test.mjs'))
      .filter((f) => !PW.test(readFileSync(join(testDir, f), 'utf8')));  // the runner's own rule
    ok(`the runner sees offline suites to check (${offline.length})`, offline.length > 0);
    const bad = offline.map((f) => [f, reaches(join(testDir, f))]).filter(([, v]) => v);
    ok('no offline suite reaches playwright transitively', bad.length === 0,
      bad.map(([f, v]) => `${f} -> ${v}`).join(', '));
  }

  console.log(fail ? `\n${fail} check(s) FAILED` : `\nAll ${pass} control-resolution checks passed.`);
  process.exit(fail ? 1 : 0);
};
await main();
