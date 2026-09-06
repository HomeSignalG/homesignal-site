// The pages DEPLOY trigger must match what the pages ARTIFACT ships.
//
// The defect this exists to prevent: `pages.yml` staged the whole repo into the artifact
// (rsync minus .git/.github/_site/test/docs/node_modules) while its push filter named
// FIVE files. Measured 2026-09-06: 339 of 344 shipped files could change, merge to main,
// and never deploy — the site kept serving the previous artifact with nothing reporting a
// problem, because a deploy that never runs is indistinguishable from a deploy with
// nothing to do. PR #1064's Map 1 symbol fix merged and reached no resident for exactly
// this reason (lib/map.js and homesignalmap.html were both outside the list), and so
// would a change to index.html, alerts.html, app.css or anything under lib/.
//
// A list of files cannot hold this invariant — the list is what drifted, because every
// file added after the workflow was written silently defaulted to never-deploy. So the
// assertion is structural: whatever the artifact ships, the trigger watches.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wf = readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };

// ── the two halves, both read from the workflow itself ────────────────────────
// 1. What the artifact EXCLUDES — parsed from the real rsync line, never retyped.
const rsync = wf.match(/rsync -a([\s\S]*?)\.\/ _site\//);
ok(!!rsync, '0: the staging rsync is still recognisable in pages.yml');
const excluded = [...(rsync?.[1] ?? '').matchAll(/--exclude '([^']+)'/g)].map((m) => m[1]);
ok(excluded.length >= 5, `0: rsync excludes parsed (${excluded.join(', ')})`);

// 2. What the push trigger WATCHES — the ordered pattern list, last match wins.
const paths = wf.split(/^\s*paths:\s*$/m)[1]?.split(/^\s{2}\S/m)[0] ?? '';
const patterns = [...paths.matchAll(/^\s*- '([^']+)'$/gm)].map((m) => m[1]);
ok(patterns.length > 0, '0: the push paths filter is still parseable');

// GitHub filter-pattern semantics: evaluate in order, a later match overrides an earlier
// one, `!` negates. `**` spans separators; `*` does not.
function globToRe(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {           // `**` spans separators
        i++;
        if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; }   // `**/` may match nothing
        else out += '.*';
      } else out += '[^/]*';               // `*` stops at a separator
    } else if (c === '?') out += '[^/]';
    else out += /[.+^${}()|[\]\\]/.test(c) ? '\\' + c : c;
  }
  return new RegExp('^' + out + '$');
}
function watched(file) {
  let hit = false;
  for (const raw of patterns) {
    const neg = raw.startsWith('!');
    if (globToRe(neg ? raw.slice(1) : raw).test(file)) hit = !neg;
  }
  return hit;
}
// The matcher is the instrument, so prove it before trusting its verdicts.
for (const [g, f, want] of [['**', 'lib/map.js', true], ['**', 'a.js', true],
                            ['docs/**', 'docs/a/b.md', true], ['docs/**', 'lib/a.js', false],
                            ['*.html', 'index.html', true], ['*.html', 'a/index.html', false],
                            ['lib/*.js', 'lib/map.js', true], ['lib/*.js', 'lib/a/b.js', false]]) {
  ok(globToRe(g).test(f) === want, `0: matcher — "${g}" vs "${f}" should be ${want}`);
}

// Ships == tracked by git and not inside a tree the rsync drops.
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const ships = (f) => !excluded.some((e) => f === e || f.startsWith(e.replace(/\/$/, '') + '/'));
const shipped = tracked.filter(ships);
ok(shipped.length > 100, `1: the artifact ships a real file set (${shipped.length} files)`);

// ── 2. EVERY shipped file triggers a deploy ──────────────────────────────────
const blind = shipped.filter((f) => !watched(f));
ok(blind.length === 0,
  `2: every shipped file triggers the deploy — ${blind.length} would ship without one` +
  (blind.length ? ` (e.g. ${blind.slice(0, 6).join(', ')})` : ''));

// ── 3. The build's own gate inputs still trigger, though they do NOT ship ─────
// They live under test/, which the artifact excludes, so §2 cannot cover them: the build
// RUNS them, so a change to one must still prove itself.
for (const gate of ['test/zip-pages-seo.test.mjs', 'test/zip-pages-no-point.test.mjs',
                    'test/community-page-contract.test.mjs', 'test/fixtures/zip-pages.json',
                    '.github/workflows/pages.yml']) {
  ok(watched(gate), `3: the gate input "${gate}" still triggers the build`);
}

// ── 4. The exclusions are real — a doc or an unrelated workflow must NOT deploy ───
// Without this the whole contract could be satisfied by watching '**' alone, and the
// trigger would fire on every README edit: a different kind of wrong, and a costly one.
for (const quiet of ['docs/maps-go-live-governance.md', 'test/map-markers.test.mjs',
                     '.github/workflows/unit-tests.yml']) {
  ok(!watched(quiet), `4: "${quiet}" does not ship and must not trigger a deploy`);
}

// ── 5. The Map 1 surface specifically, named because it is what broke ────────
for (const f of ['lib/map.js', 'homesignalmap.html', 'index.html', 'app.css',
                 'lib/community-page.js', 'community.html', 'scripts/gen_zip_pages.py']) {
  ok(watched(f), `5: "${f}" triggers a deploy`);
}

console.log(`pages-trigger-covers-artifact: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
