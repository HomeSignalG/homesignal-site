// DETERMINISTIC PROOF THAT WEATHER NEVER COUNTS TOWARD RULE F — no live data, no network.
//
// WHY (founder, 2026-11-23). The crawler proof used to learn this from whatever weather the NWS happened
// to publish that day (the `weather_thin` class). That made the build depend on WHERE the weather was:
// 19 thin ZIPs on 11-21, 0 on 11-22/23, and every `pages` run failed or skipped on it.
//
// WHAT IT DOES. It builds a small synthetic dataset, runs the SHIPPED generator (scripts/gen_zip_pages.py,
// the same assemble() and renderer production uses) over it, and checks both the generator's own Rule F
// decision (zip-pages-manifest.json `rule_f_zips`) and the rendered bytes of each page.
//
// THE THRESHOLD IS NOT CHOSEN HERE. Every boundary below is derived from the generator's own constant
// `RULE_F_MIN` (read from the source, never copied) : "at least RULE_F_MIN non-weather Alerts items"
// (generator docstring, line 22). A case sits exactly at RULE_F_MIN-1 and at RULE_F_MIN, each with heavy
// weather beside it, so a rule that let weather add to the count would flip the first case.
//
// IT FAILS CLOSED. If python is missing, the generator errors, a case ZIP is not rendered, or the
// manifest cannot be read, the result is {ok:false, error}. It never returns "nothing to check".
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderedNonWeatherItems } from './zip-page-controls.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN = join(ROOT, 'scripts', 'gen_zip_pages.py');

/** The generator's own Rule F minimum, read from its source. Throws if it cannot be found. */
export function generatorRuleFMin(gen = GEN) {
  const m = /^RULE_F_MIN\s*=\s*(\d+)/m.exec(readFileSync(gen, 'utf8'));
  if (!m) throw new Error('RULE_F_MIN not found in scripts/gen_zip_pages.py');
  return Number(m[1]);
}

const WX = 'https://api.weather.gov/';
/** Cases: n_wx weather alerts, n_ln local-news items, n_gn government notices; expect = Rule F decision. */
export function cases(min = generatorRuleFMin()) {
  const c = [
    { zip: '90001', wx: 6, ln: min - 1, gn: 0, expect: false, why: `heavy weather + ${min - 1} non-weather (one short of Rule F)` },
    { zip: '90002', wx: 6, ln: 0, gn: 0, expect: false, why: 'weather only' },
    { zip: '90003', wx: 1, ln: 0, gn: min - 1, expect: false, why: `weather + ${min - 1} government notices` },
    { zip: '90004', wx: 6, ln: min, gn: 0, expect: true, why: `heavy weather + exactly ${min} local-news items (inverse case)` },
    { zip: '90005', wx: 0, ln: 0, gn: min, expect: true, why: `no weather, exactly ${min} government notices` },
    { zip: '90006', wx: 0, ln: min - 1, gn: 0, expect: false, why: `no weather, ${min - 1} items` },
    { zip: '90007', wx: 2, ln: 1, gn: min - 1, expect: true, why: `weather + mixed sections summing to exactly ${min}` },
  ];
  return c;
}

export function buildFixture(cs) {
  const fx = {
    zips: cs.map((c) => c.zip),
    meta: cs.map((c) => ({ zip: c.zip, name: `Case (${c.zip})`, county: 'Test', state: 'MA', data_quality: 'pass', indexable: true })),
    changes: [], agency: [], retractions: [], meetings: [],
    communities: [{ id: 'county-t', parent_id: null, level: 'county', zip_codes: [], name: 'Test County' }],
  };
  for (const c of cs) {
    fx.communities.push({ id: `zip-${c.zip}`, parent_id: 'county-t', level: 'zip', zip_codes: [c.zip], name: `Case (${c.zip})` });
    for (let i = 0; i < c.wx; i++) {
      const u = `${WX}${c.zip}-${i}`;
      fx.agency.push({ source_url: u, agency_name: 'api.weather.gov' });
      fx.changes.push({ zip: c.zip, community_id: 'c-t', category: 'Local News', title: `Weather alert ${i}`, source_ref: u, occurred_at: '2026-09-03' });
    }
    for (let i = 0; i < c.ln; i++) {
      fx.changes.push({ zip: c.zip, community_id: 'c-t', category: 'Local News', title: `Journalism ${c.zip}-${i}`, source_ref: `https://gazette.example/${c.zip}/${i}`, occurred_at: '2026-09-02' });
    }
    for (let i = 0; i < c.gn; i++) {
      fx.changes.push({ zip: c.zip, community_id: 'c-t', category: 'Government & civic', title: `Notice ${c.zip}-${i}`, source_ref: `https://gov.example/${c.zip}/${i}`, occurred_at: '2026-09-01' });
    }
  }
  return fx;
}

/**
 * Run the proof. Returns { ok, min, results:[{zip,why,expect,ruleF,items,pass}], error? }. Never throws.
 * `deps.exec` is injectable so a test can simulate "the generator cannot run".
 */
export function runWeatherRuleFProof(deps = {}) {
  const exec = deps.exec || execFileSync;
  const dir = mkdtempSync(join(tmpdir(), 'wx-rulef-'));
  try {
    const gen = deps.gen || GEN;           // injectable so a test can run a MUTATED generator
    const min = generatorRuleFMin(gen);
    const cs = cases(min);
    const fxPath = join(dir, 'fixture.json');
    writeFileSync(fxPath, JSON.stringify(buildFixture(cs)));
    const out = join(dir, 'out');
    exec('python3', [gen, '--fixture', fxPath, '--out', out, '--now', '2026-09-04T00:00:00'], { encoding: 'utf8', stdio: 'pipe' });
    const man = JSON.parse(readFileSync(join(out, 'zip-pages-manifest.json'), 'utf8'));
    const set = new Set(man.rule_f_zips || []);
    const results = cs.map((c) => {
      const html = readFileSync(join(out, 'community', c.zip, 'index.html'), 'utf8');
      const items = renderedNonWeatherItems(html);
      const showsWeather = /<h2>Weather alerts<\/h2>/.test(html);
      const ruleF = set.has(c.zip);
      // The rendered page must agree with the decision: a Rule F page shows >= min non-weather items,
      // and a page that is not Rule F does not. Weather sections render exactly when weather exists.
      const pass = ruleF === c.expect && showsWeather === (c.wx > 0)
        && (c.expect ? items >= min : items < min);
      return { zip: c.zip, why: c.why, expect: c.expect, ruleF, items, showsWeather, pass };
    });
    return { ok: results.every((r) => r.pass), min, results };
  } catch (e) {
    return { ok: false, min: null, results: [], error: String(e && e.message || e).split('\n')[0] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
