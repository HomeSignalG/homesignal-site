#!/usr/bin/env node
/**
 * FIX 19 — the production artifact boundary.
 *
 * This runs the REAL producer (`scripts/stage_site.py`, the same script
 * `.github/workflows/pages.yml` calls) into a throwaway directory and asserts against the
 * tree it actually wrote. It never restates the contract: a transcribed copy would keep
 * passing after the producer changed, which is the exact failure it exists to prevent —
 * the same reasoning as Fix 18's guard, one level up.
 *
 * WHAT IT PINS
 *   §1 the producer ran and produced a non-empty, index-bearing artifact (no check may
 *      pass over nothing)
 *   §2 the internal families measured live at HTTP 200 before Fix 19 are absent
 *   §3 FAIL-CLOSED: an unknown root .md, an unknown developer script, an unknown .sql and
 *      an unknown file inside a shipped tree are all excluded WITHOUT being named
 *   §4 the required public runtime is present
 *   §5 every local asset any shipped page references is in the artifact — the safety net
 *      that makes an allowlist safe to adopt
 *   §6 the workflow still calls this producer and nothing else
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGER = path.join(REPO, 'scripts', 'stage_site.py');

let failures = 0;
const ok = (name) => console.log(`  PASS  ${name}`);
const fail = (name, detail) => { failures++; console.log(`  FAIL  ${name}\n        ${detail}`); };
const check = (name, cond, detail) => cond ? ok(name) : fail(name, detail);

/** Stage the repo (optionally with extra files written in first) and return the file list. */
function stage(extraFiles = {}) {
  const work = mkdtempSync(path.join(tmpdir(), 'fix19-src-'));
  const out = mkdtempSync(path.join(tmpdir(), 'fix19-out-'));
  // The stager reads from --src; point it at the real repo unless a mutation needs files
  // added, in which case copy the repo shape we care about into a scratch source.
  let src = REPO;
  if (Object.keys(extraFiles).length) {
    execFileSync('cp', ['-a', `${REPO}/.`, work]);
    for (const [rel, body] of Object.entries(extraFiles)) {
      const p = path.join(work, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
    src = work;
  }
  // A producer that REFUSES (non-zero exit) must surface as a named failure, not as an
  // exception that aborts the run before any later section prints. A crash and a clean pass
  // are both "no FAIL lines"; only one of them is evidence.
  let producerError = null;
  try {
    execFileSync('python3', [STAGER, '--src', src, '--out', out], { stdio: 'pipe' });
  } catch (e) {
    producerError = (e.stderr?.toString() || e.message || '').trim().split('\n').pop();
  }
  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(path.relative(out, p).split(path.sep).join('/'));
    }
  })(out);
  rmSync(work, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  files.sort();
  files.producerError = producerError;
  return files;
}

console.log('FIX 19 — production artifact contract\n');

const shipped = stage();
const set = new Set(shipped);

// ---------------------------------------------------------------- §1 the instrument ran
console.log('§1 the producer ran and produced a real artifact');
check('1a the producer exited cleanly', !shipped.producerError,
      `scripts/stage_site.py failed: ${shipped.producerError}`);
check('1a2 artifact is non-empty', shipped.length > 0, 'the stager produced zero files');
check('1b artifact contains index.html', set.has('index.html'), 'index.html missing');
check('1c artifact is plausibly sized (>= 40 files)', shipped.length >= 40,
      `only ${shipped.length} files staged`);

// ------------------------------------------------------- §2 known internal families gone
console.log('\n§2 internal families measured at HTTP 200 before Fix 19 are absent');
const INTERNAL_ROOT = ['CLAUDE.md', 'QUEUE.md', 'PLAN.md', 'DECISIONS.md', 'PROGRESS.md', '.gitignore'];
for (const f of INTERNAL_ROOT) {
  check(`2a ${f} is not shipped`, !set.has(f), `${f} is still in the artifact`);
}
const INTERNAL_TREES = ['scripts/', 'verify/', 'fixtures/', 'supabase/', 'data/', '.claude/', 'docs/', 'test/'];
for (const t of INTERNAL_TREES) {
  const found = shipped.filter((f) => f.startsWith(t));
  check(`2b no ${t} files shipped`, found.length === 0,
        `${found.length} shipped, e.g. ${found.slice(0, 3).join(', ')}`);
}
// build-only artifacts that live INSIDE a shipped tree
for (const f of ['lib/generated/transitions.sql', 'lib/generated/transitions.mjs', 'lib/generated/versions.mjs']) {
  check(`2c build artifact ${f} is not shipped`, !set.has(f), `${f} is still in the artifact`);
}

// ------------------------------------------------------------------- §3 FAIL-CLOSED
// The load-bearing section: files nobody has named must not ship.
console.log('\n§3 fail-closed against files the contract has never heard of');
const canaries = {
  'internal-fix19-canary.md': '# internal notes, must never ship',
  'internal-fix19-tool.mjs': 'export const x = 1;',
  'internal-fix19-tool.py': 'print("internal")',
  'internal-fix19-schema.sql': 'create table internal ();',
  'internal-fix19-notes.txt': 'internal',
  'internal-fix19-dump.json': '{"internal": true}',
  'lib/internal-fix19-notes.md': 'internal note inside a shipped tree',
  'partials/internal-fix19-dump.sql': 'select 1;',
  'internal-fix19-dir/secret.html': '<p>internal</p>',
};
const mutated = new Set(stage(canaries));
for (const rel of Object.keys(canaries)) {
  check(`3 unknown file ${rel} does NOT ship`, !mutated.has(rel),
        `${rel} entered the artifact — the boundary fails OPEN`);
}
// and the mutation must not have broken the artifact, or the zeros above mean nothing
check('3z control: mutated build still ships index.html', mutated.has('index.html'),
      'the canary run produced a broken artifact, so its absences prove nothing');

// -------------------------------------------------------------- §4 required public runtime
console.log('\n§4 required public runtime is present');
const REQUIRED = [
  'index.html', '404.html', 'app.css', 'shell.js', 'config.js', 'share.js',
  'robots.txt', 'sitemap.xml', 'CNAME', '.nojekyll', 'favicon.svg', 'og-default.png',
  'partials/shell.html', 'seed/delvalle.js', 'assets/acquisition-video-producer.js',
  // production page families
  'community.html',        // ZIP / community
  'property.html',         // address / property dossier
  'properties.html',
  'development.html',      // development
  'homesignalmap.html',    // Maps
  'alerts.html',           // Alerts
  'dashboard.html',
  // runtime modules the page families depend on
  'lib/community-page.js', 'lib/map.js', 'lib/data.js', 'lib/templates.js',
  'lib/zip-authoritative.js', 'lib/residential-qualify.js',
  'lib/generated/county-sources.json', 'lib/generated/gov-notice-coverage.json',
];
for (const f of REQUIRED) check(`4 ${f} ships`, set.has(f), `${f} is MISSING from the artifact`);

// ------------------------------------------- §5 nothing shipped references a missing asset
// This is what makes an allowlist safe: forgetting to add a new page or module is a RED
// BUILD here, not a silent 404 in production.
console.log('\n§5 every local asset referenced by a shipped page exists in the artifact');
const REF = /(?:src|href)\s*=\s*"([^"]+)"/g;
const missing = [];
let scanned = 0, refs = 0;
for (const f of shipped) {
  if (!/\.(html|js)$/.test(f)) continue;
  scanned++;
  const body = readFileSync(path.join(REPO, f), 'utf8');
  for (const m of body.matchAll(REF)) {
    let u = m[1].trim();
    if (/^(https?:|\/\/|#|mailto:|data:|javascript:|\{|\$)/.test(u)) continue;
    if (u.includes("'") || u.includes('+') || u.includes('${')) continue; // built at runtime
    u = u.split('?')[0].split('#')[0];
    if (!u || u.endsWith('/')) continue;
    const rel = u.replace(/^\//, '');
    if (!/\.[a-z0-9]{2,5}$/i.test(rel)) continue;
    refs++;
    if (!set.has(rel)) missing.push(`${f} -> ${u}`);
  }
}
check('5a scanned a non-empty set of shipped pages', scanned > 10, `only ${scanned} pages scanned`);
check('5b resolved a non-empty set of local references', refs > 20, `only ${refs} references seen`);
check('5c no shipped page references a missing local asset', missing.length === 0,
      `${missing.length} dangling: ${missing.slice(0, 8).join(' | ')}`);

// ------------------------------------------------------------------- §6 the workflow wiring
console.log('\n§6 pages.yml uses this producer and no other');
const wf = readFileSync(path.join(REPO, '.github', 'workflows', 'pages.yml'), 'utf8');
check('6a pages.yml invokes scripts/stage_site.py', wf.includes('scripts/stage_site.py'),
      'the workflow no longer calls the contract producer');
// Scoped to EXECUTABLE lines only. The header comment legitimately says the word "rsync"
// while recording that it is gone, and a pin that names the string it forbids cannot also
// search the whole file for it — that is how a guard stops guarding without failing.
const wfCode = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
check('6b no executable rsync stage remains', !/\brsync\b/.test(wfCode),
      'an rsync stage is back in the workflow — the denylist producer has returned');
check('6b-control the header still records why rsync was removed', /\brsync\b/.test(wf),
      'the rationale comment vanished, so 6b would now pass vacuously');
check('6c pages.yml runs this contract gate', wf.includes('test/site-artifact-contract.test.mjs'),
      'the workflow does not run the artifact contract gate');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}  ` +
            `(artifact: ${shipped.length} files)`);
process.exit(failures === 0 ? 0 : 1);
