// PURE CONTROL-RESOLUTION CORE for the crawler proof — NO network, NO Playwright, NO server.
//
// ⚠️ IT LIVES IN ITS OWN FILE FOR ONE MEASURED REASON. The first version exported these from
// scripts/prove-zip-pages.mjs, which imports `playwright` at module top. The offline `unit`
// job installs no playwright, so importing the test file threw there — while passing locally,
// because this sandbox happens to have playwright installed globally. A green local run was
// an artifact of the environment, not evidence.
//
// And the suite runner could not have warned: scripts/run-unit-tests.mjs classifies a suite
// by TEXT-MATCHING /from ['"]playwright['"]/ against the test file ITSELF, so a TRANSITIVE
// import is invisible to it. The file read as offline and was run in the job that cannot
// satisfy it. Same shape as scripts/lib/verify-communities-assert.mjs, extracted for the
// same reason: a pure core is the only kind of thing an offline job can honestly run.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── CONTROL RESOLUTION: PIN WHEN VALID, SUBSTITUTE WHEN DRIFTED, FAIL WHEN EMPTY ───────
//
// ⚖️ CORRECTING MY OWN ARGUMENT (2026-09-11). Earlier the same day I kept these controls
// FROZEN and justified it like this: "a control derived from the same build it tests cannot
// catch a build-wide misclassification, because the class would come back empty and the
// assertion would pass over nothing." The premise is right and the conclusion does not
// follow — it is answered by ONE extra assertion. Assert the class is NON-EMPTY and a
// build-wide misclassification fails loudly, which is the exact case freezing was
// protecting. Freezing was never the only way to get that property; it was just the way
// that also made normal ingestion turn `pages` red, which stops the site updating.
//
// So the pins stay as PREFERENCES, not requirements:
//   * the pinned ZIP still qualifies -> use it, so day-to-day the proof tests the same
//     pages and stays comparable run to run;
//   * it has drifted out of its class -> substitute the first qualifying ZIP and SAY SO,
//     loudly, in the log. Drift stays VISIBLE, which was the founder's stated intent —
//     it just stops being an outage.
//   * the class is EMPTY -> hard failure. That is the build-wide misclassification, and it
//     is now asserted rather than hoped for.
//
// 07010, 01002 and 04401 each cost a red build for this; rule_f_pass read 8,291 / 8,380 /
// 8,372 across three builds, TWO OF THEM ON THE SAME COMMIT.
export const CLASSIFY = {
  // [name, predicate(f) -> boolean] where f is the per-ZIP facts below.
  pass_dev_pass: (f) => f.idx && f.dev,
  pass_dev_fail: (f) => f.idx && !f.dev,
  fail_dev_pass: (f) => !f.idx && f.dev,
  fail_dev_fail: (f) => !f.idx && !f.dev,
  local_news:    (f) => f.idx && f.lnList,          // Rule F carried with local news present
  weather_thin:  (f) => !f.idx && f.weather,        // weather never counts toward Rule F
  honest_empty:  (f) => f.emptyGn && f.emptyUm,
  fanout:        (f) => f.gnList,
};

// point_dense is NOT derived: it is the single hardest case for the no-leak assertion
// (the densest development ZIP), and "some page with no leak" is a weaker test than
// "the worst page has no leak". It stays pinned.
export const PINNED_ONLY = new Set(['point_dense']);

// PURE HALF #1 — read the built documents and bucket every ZIP into its classes.
// Exported so the behaviour can be driven offline against a synthetic _site, which is the
// only way to prove the substitution and empty-class paths without a live build.
export async function classifyMembers(SITE, man, deps = {}) {
  const rd = deps.readdir || (await import('node:fs/promises')).readdir;
  const rf = deps.readFile || readFile;
  const idx = new Set(man.indexable_zips);
  const dev = new Set(man.dev_indexable_zips || []);
  if (!dev.size) throw new Error('manifest has no dev_indexable_zips — rebuild with the current generator');

  const dirs = (await rd(join(SITE, 'community'), { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d{5}$/.test(d.name)).map((d) => d.name).sort();

  // ONE pass, sorted, so the choice is deterministic: two builds of the same artifact pick
  // the same ZIP and a substitution is reproducible rather than incidental.
  const members = Object.fromEntries(Object.keys(CLASSIFY).map((k) => [k, []]));
  for (const z of dirs) {
    let h; try { h = await rf(join(SITE, 'community', z, 'index.html'), 'utf8'); } catch { continue; }
    const f = {
      idx: idx.has(z), dev: dev.has(z),
      weather: /<h2>Weather alerts<\/h2>/.test(h),
      lnList:  /<h2>Local news<\/h2><ul>/.test(h),
      gnList:  /<h2>Government notices<\/h2><ul>/.test(h),
      emptyGn: h.includes('No government notices on file for this ZIP yet.'),
      emptyUm: h.includes('No upcoming public meetings on file for this ZIP yet.'),
    };
    for (const [k, pred] of Object.entries(CLASSIFY)) if (pred(f)) members[k].push(z);
  }
  return members;
}

// PURE HALF #2 — decide what each control is, given the pins and the measured membership.
// Returns the chosen controls, the classes that are EMPTY (hard failures), and the
// substitutions to report. No I/O, no assertions: the caller owns both.
export function chooseControls(pins, members) {
  const controls = { ...pins };
  const empties = [];
  const notes = [];
  for (const [k, list] of Object.entries(members)) {
    if (PINNED_ONLY.has(k)) continue;
    if (!list.length) { empties.push(k); continue; }
    if (pins[k] && list.includes(pins[k])) { controls[k] = pins[k]; continue; }
    controls[k] = list[0];
    // ⚠️ ONLY A REAL DRIFT IS REPORTED. An UNPINNED class resolving to its first member is
    // the normal path, not a substitution — and once the pins are trimmed to point_dense
    // alone, noting it would print a "no longer qualifies" line for every class on every
    // build. A notice that fires always is the same as no notice, and it would bury the one
    // line that means something.
    if (pins[k]) {
      notes.push(`  ${k}: pinned ${pins[k]} no longer qualifies -> using ${controls[k]} `
        + `(${list.length} member(s); next: ${list.slice(0, 5).join(' ')})`);
    }
  }
  return { controls, empties, notes };
}

