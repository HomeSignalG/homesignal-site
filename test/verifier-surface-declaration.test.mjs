// Offline guard: EVERY VERIFIER MUST DECLARE ITS SURFACE AND TABLE — no network, no DB.
//
// THE RULING (founder, 2026-08-03). Both tables are authoritative, each for its own surface: the
// materializer's caps exist deliberately for list pages, and the map genuinely needs every site.
// The divergence is DESIGN, not defect, and is not being collapsed.
//
// What was missing is that no verification declared WHICH SURFACE it spoke about. On 2026-08-03
// `app_projects` held ZERO saint-paul rows while `development_reports` held 20,000 on a single ZIP
// — same moment, five days, every verifier green. Every "what do residents see" check had been run
// against `app_projects`; homesignalmap.html reads `development_reports` DIRECTLY and uncapped, so
// residents saw the retired data anyway. A clean materialized layer is NOT evidence about a
// surface that bypasses it.
//
// Matrix of record: QUEUE.md item 0d.
// Run: node scripts/run-unit-tests.mjs   (or: node test/verifier-surface-declaration.test.mjs)
import { readFileSync, readdirSync } from 'node:fs';
import { SURFACES, UNVERIFIED_SURFACES, surfaceBanner } from '../scripts/lib/surface-banner.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? '\n     ' + detail : ''}`); }
};
const DIR = new URL('../scripts/', import.meta.url);
const scripts = readdirSync(DIR).filter((f) => /^(verify|audit)-.*\.mjs$/.test(f));

console.log(`1) every verifier declares a surface (${scripts.length} scripts found)`);
{
  // "did not run" and "no match" must not be indistinguishable — so first prove the scan found
  // scripts at all. A zero here would otherwise pass every check below vacuously.
  ok('the scan actually found verifier scripts', scripts.length >= 10, `found ${scripts.length}`);
  for (const f of scripts) {
    const name = f.replace(/\.mjs$/, '');
    const src = readFileSync(new URL(f, DIR), 'utf8');
    ok(`${name} imports and calls surfaceBanner('${name}')`,
      src.includes("from './lib/surface-banner.mjs'") && src.includes(`surfaceBanner('${name}')`),
      'a verifier whose output does not name its surface lets a reader assume the wrong table');
    ok(`${name} is declared in SURFACES`, !!SURFACES[name],
      'declare it in scripts/lib/surface-banner.mjs — do not skip it');
  }
}

console.log('\n2) each declaration is complete and internally consistent');
for (const [name, s] of Object.entries(SURFACES)) {
  ok(`${name} names a surface`, typeof s.surface === 'string' && s.surface.length > 3);
  ok(`${name} lists its tables (possibly empty, never undefined)`, Array.isArray(s.tables));
  ok(`${name} states whether its tables are the CAPPED layer`,
    s.capped === true || s.capped === false || s.capped === null);
  // The materialized layer and the raw cache must never be described the same way.
  // CONTENT tables hold the records a page renders and are the ones that can DISAGREE.
  // `app_community_meta` is deliberately NOT in either set: it carries page metadata
  // (data_quality, indexable, centroid) and no site records, so it can never disagree about
  // content and does not make a verifier "span both layers".
  const MATERIALIZED_CONTENT = ['app_projects', 'app_changes'];
  const RAW_CONTENT = ['development_reports'];
  const hasMat = s.tables.some((t) => MATERIALIZED_CONTENT.includes(t));
  const hasRaw = s.tables.some((t) => RAW_CONTENT.includes(t));
  if (hasRaw && !hasMat) ok(`${name} reading development_reports is marked UNCAPPED`, s.capped === false);
  if (hasMat && !hasRaw) ok(`${name} reading only materialized content is marked CAPPED`, s.capped === true);
  if (hasMat && hasRaw) ok(`${name} spanning BOTH content layers says so`, s.capped === null && /both/i.test(s.note || ''));
}

console.log('\n3) the banner renders and refuses an undeclared name');
{
  const lines = [];
  const orig = console.log;
  console.log = (m) => lines.push(String(m));
  surfaceBanner('verify-development');
  console.log = orig;
  ok('banner names the surface AND the table', /surface = .*table = .*development_reports/.test(lines[0]), lines[0]);
  ok('banner states the capping', /UNCAPPED/.test(lines[0]), lines[0]);
  let threw = false;
  try { surfaceBanner('not-a-verifier'); } catch { threw = true; }
  ok('an UNDECLARED verifier throws rather than printing nothing', threw);
}

console.log('\n4) the surfaces with NO verifier are named — that is where the next silent defect lives');
{
  ok('UNVERIFIED_SURFACES is populated', UNVERIFIED_SURFACES.length > 0);
  const verifiedPages = Object.values(SURFACES).map((s) => s.surface).join(' ');
  for (const entry of UNVERIFIED_SURFACES) {
    const page = entry.split(/\s/)[0];
    ok(`${page} is genuinely unverified (not also claimed by a verifier)`,
      !verifiedPages.includes(page),
      'it appears in a SURFACES declaration — remove it from UNVERIFIED_SURFACES');
  }
  // The one that actually bit: the map page reads the uncapped cache, and it IS verified.
  ok('the map page has at least one verifier',
    Object.values(SURFACES).some((s) => /homesignalmap/.test(s.surface)));
}

console.log(fail ? `\n${fail} check(s) FAILED` : `\nAll ${pass} verifier-surface-declaration checks passed.`);
process.exit(fail ? 1 : 0);
