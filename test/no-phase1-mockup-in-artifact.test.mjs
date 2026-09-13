// FIX 18 — the Phase 1 mockup is a design reference, never a shipped page.
//
// `homesignalphase1_13.html` is the approved Phase 1 SPA mockup (self-titled
// "HomeSignal — Alerts & Development mockups"). app.css was lifted VERBATIM from its
// <style> block and lib/templates.js mirrors its markup, so the repo still needs it as
// the design source of truth. It is NOT a product page: every link in it is href="#",
// it loads no repo asset, nothing links to it, and it carries 20+ instances of the
// "your home" ownership language Fix 9 removed from the product.
//
// It nevertheless reached production for the life of the repo, because
// .github/workflows/pages.yml stages the artifact with
//     rsync -a --exclude '.git' --exclude '.github' --exclude '_site' \
//              --exclude 'test' --exclude 'docs' --exclude 'node_modules' ./ _site/
// i.e. it ships EVERY repo file that is not in that exclude list. The mockup was not
// deployed on purpose — it survived because it existed at the repo root.
//
// Fix 18 moved it to docs/, the one tree proven excluded from the artifact. This guard
// pins BOTH halves, because either one alone is a silent regression:
//   - the file is not in the shipped set (it cannot come back to the root), and
//   - `docs` is still excluded by the real producer (its hiding place still hides it).
//
// Run: node test/no-phase1-mockup-in-artifact.test.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative, sep } from 'node:path';

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 300) : ''));
  if (!c) fails++;
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCKUP = 'homesignalphase1_13.html';
const KEPT_AT = join('docs', MOCKUP);

// ---- 1. THE PRODUCER -------------------------------------------------------------------
// Read the exclude list out of pages.yml rather than restating it, so this guard tracks the
// real staging rule. A copy would keep passing after the producer changed, which is the
// failure mode the whole test exists to prevent.
const pagesYml = readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8');
const rsyncLine = pagesYml.slice(pagesYml.indexOf('rsync -a'));
const excludes = [...rsyncLine.slice(0, rsyncLine.indexOf('./ _site/')).matchAll(/--exclude '([^']+)'/g)]
  .map((m) => m[1]);

ok(excludes.length > 0, `1a: pages.yml rsync exclude list was parsed (${excludes.length} entries) — a regex that stops matching must not read as clean`, excludes);
ok(excludes.includes('docs'),
  "1b: pages.yml still excludes 'docs' — the mockup's hiding place still hides it", excludes);

// ---- 2. THE SHIPPED SET ----------------------------------------------------------------
// Model the rsync: every repo file except the excluded top-level trees.
const skip = new Set(excludes.concat(['.git']));
const shipped = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(root, abs);
    if (skip.has(rel.split(sep)[0])) continue;
    if (statSync(abs).isDirectory()) walk(abs);
    else shipped.push(rel);
  }
})(root);

ok(shipped.length > 0, `2a: the shipped set is non-empty (${shipped.length} files) — an empty set would pass every check below over nothing`);
ok(shipped.includes('index.html'),
  '2b: control — index.html IS in the shipped set, so membership is really being measured');

// ---- 3. THE INVARIANT ------------------------------------------------------------------
const shippedMockups = shipped.filter((p) => /(^|[\\/])homesignalphase1_[^\\/]*\.html$/.test(p));
ok(shippedMockups.length === 0,
  `3a: no homesignalphase1_* page is in the deployable artifact`, shippedMockups);
ok(!shipped.includes(MOCKUP),
  `3b: ${MOCKUP} is not at the shipped site root`);

// ---- 4. THE REFERENCE IS PRESERVED -----------------------------------------------------
// Deleting the mockup outright would also satisfy §3, and would break the design contract
// app.css and lib/templates.js state. This clone is shallow (git history is truncated), so
// a deleted blob is not reliably recoverable in-session either.
ok(existsSync(join(root, KEPT_AT)),
  `4a: the mockup is still kept at ${KEPT_AT} as the design reference`);
const mock = existsSync(join(root, KEPT_AT)) ? readFileSync(join(root, KEPT_AT), 'utf8') : '';
ok(/<title>HomeSignal — Alerts &amp; Development mockups<\/title>/.test(mock),
  '4b: the kept file is the Phase 1 mockup itself, not an empty placeholder');
ok(/lifted VERBATIM from the approved\s*\n?\s*mockup homesignalphase1_13\.html/.test(readFileSync(join(root, 'app.css'), 'utf8')),
  '4c: app.css still names the mockup as its design source (the reason it is kept)');

// ---- 5. NO DANGLING DEPLOYMENT REFERENCE -----------------------------------------------
const robots = readFileSync(join(root, 'robots.txt'), 'utf8');
ok(!robots.includes(MOCKUP),
  '5a: robots.txt carries no Disallow for the removed URL — a rule for a page that does not exist is a dangling deployment reference that also advertises it');

const sitemap = existsSync(join(root, 'sitemap.xml')) ? readFileSync(join(root, 'sitemap.xml'), 'utf8') : '';
ok(!sitemap.includes(MOCKUP), '5b: sitemap.xml does not advertise the mockup');

// ---- 6. NOTHING SHIPPED LINKS TO IT ----------------------------------------------------
// Reachability, not just membership: a link from a shipped page would make the 404 a
// resident-visible defect rather than a clean removal.
const linkers = shipped
  .filter((p) => /\.(html|js|css|json|xml|txt)$/i.test(p))
  .filter((p) => new RegExp('(href|src)\\s*=\\s*["\'][^"\']*' + MOCKUP).test(readFileSync(join(root, p), 'utf8')));
ok(linkers.length === 0, '6a: no shipped file links to the mockup', linkers);

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
