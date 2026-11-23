// DETERMINISTIC: weather never counts toward Rule F. No network, no live data, no Playwright.
// Runs the SHIPPED generator over a synthetic dataset (scripts/lib/weather-rule-f-proof.mjs) and checks the
// Rule F decision and the rendered bytes. Includes the inverse case, the boundary at RULE_F_MIN, a mutated
// generator that MUST fail it, and the fail-closed paths.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWeatherRuleFProof, cases, generatorRuleFMin } from '../scripts/lib/weather-rule-f-proof.mjs';
import { weatherThinMaySkipDeterministic } from '../scripts/lib/zip-page-controls.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('PASS —', n); } else { fail++; console.error('FAIL —', n, d || ''); } };

const min = generatorRuleFMin();
ok(`the threshold is the generator's own RULE_F_MIN (${min}), not a number chosen here`, Number.isInteger(min) && min >= 1);
// The supplementary runtime assertion (#3131) uses the same number.
const ctl = readFileSync(join(root, 'scripts/lib/zip-page-controls.mjs'), 'utf8');
ok('the live-page assertion RULE_F_MIN_RENDERED equals the generator constant',
  new RegExp(`RULE_F_MIN_RENDERED\\s*=\\s*${min}\\b`).test(ctl));

const good = runWeatherRuleFProof();
ok('shipped generator: every synthetic case passes', good.ok === true, JSON.stringify(good.results.filter((r) => !r.pass)));
ok('the cases cover both outcomes with weather present',
  good.results.some((r) => r.showsWeather && r.ruleF) && good.results.some((r) => r.showsWeather && !r.ruleF));
const byZip = Object.fromEntries(good.results.map((r) => [r.zip, r]));
ok(`weather + ${min - 1} items is NOT Rule F even with 6 weather alerts`, byZip['90001'].ruleF === false && byZip['90001'].items === min - 1);
ok(`INVERSE: weather + exactly ${min} items IS Rule F`, byZip['90004'].ruleF === true && byZip['90004'].items === min);
ok('weather-only page is not Rule F', byZip['90002'].ruleF === false && byZip['90002'].items === 0);

// MUTATION: a generator that lets weather count toward Rule F must FAIL this proof. The generator reads many
// repo-relative files, so the mutated copy is written beside the real one (scripts/) and removed in `finally`.
const g = join(root, 'scripts', `gen_zip_pages.mutant-${process.pid}.py`);
try {
  const src = readFileSync(join(root, 'scripts', 'gen_zip_pages.py'), 'utf8');
  const mutated = src.replace('journalism = [x for x in p["ln"] if not x["weather"]]', 'journalism = list(p["ln"])');
  ok('mutation applies (the weather filter line exists exactly once)', mutated !== src);
  writeFileSync(g, mutated);
  const bad = runWeatherRuleFProof({ gen: g });
  ok('MUTATED generator (weather counted toward Rule F): the proof FAILS on a real decision, not an error',
    bad.ok === false && !bad.error, JSON.stringify(bad).slice(0, 300));
  ok('...and it names the weather-carrying case', bad.results.some((r) => !r.pass && r.zip === '90001'));
} finally { rmSync(g, { force: true }); }

// FAIL CLOSED: if the generator cannot run, there is no result to skip on.
const broken = runWeatherRuleFProof({ exec: () => { throw new Error('python3: not found'); } });
ok('generator cannot run: ok is false with an error, never an empty pass', broken.ok === false && /not found/.test(broken.error || ''));
ok('skip gate: empty weather_thin + passing proof => may skip', weatherThinMaySkipDeterministic(['weather_thin'], good) === true);
ok('skip gate: failed proof => no skip', weatherThinMaySkipDeterministic(['weather_thin'], broken) === false);
ok('skip gate: missing proof => no skip', weatherThinMaySkipDeterministic(['weather_thin'], undefined) === false
  && weatherThinMaySkipDeterministic(['weather_thin'], { ok: true, results: [] }) === false);
ok('skip gate: other empty classes never skip', weatherThinMaySkipDeterministic(['local_news'], good) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
