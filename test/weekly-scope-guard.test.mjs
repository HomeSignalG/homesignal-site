// The Tab 20 scope guard is a FEATURE-BRANCH check: it applies only when the branch touches a weekly-feature path (test/lib/weekly-scope-guard.mjs; policy decision 2026-11-20).
// This proves: (a) an unrelated-only branch is NOT APPLICABLE, (b) weekly-feature changes (with the allowlisted extras) pass, (c) weekly changes mixed with prohibited or unallowed files are
// still rejected, (d) an unavailable comparison ref is reported UNAVAILABLE and never as enforcement. It fetches nothing.
// Run: node test/weekly-scope-guard.test.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const G = await import('./lib/weekly-scope-guard.mjs');
let n = 0, fails = 0;
const ok = (c, name, d) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 400)); } };

// ── the decision ──
const a = G.evaluate(['lib/data.js', 'docs/report-accuracy-universal-2026-11-19.md', 'supabase/functions/_shared/national-report.ts', 'development-activity.html']);
ok(a.status === 'not_applicable' && a.prohibited.length === 0 && a.outside.length === 0, '(a) unrelated-only changes: NOT APPLICABLE (not a pass, not a failure)', a);
ok(G.evaluate([]).status === 'not_applicable', '(a) an empty diff is not applicable too');
ok(G.evaluate(['lib/youtube-thing.js', 'impact/x.py', 'topics.js']).status === 'not_applicable', '(a) prohibited-looking files alone do not make the guard apply: the guard is scoped to branches that touch the weekly feature');
const b = G.evaluate(['lib/acq-weekly-topics.js', 'docs/weekly-2-topic-queue.sql', 'test/weekly-topics.test.mjs', '.github/workflows/weekly-stage2-suite.yml', 'docs/weekly-bluesky-sources.sql', 'acquisition.html', 'CLAUDE.md', 'test/claim-check.test.mjs', 'test/video-bluesky-queue.test.mjs']);
ok(b.status === 'enforced' && b.prohibited.length === 0 && b.outside.length === 0, '(b) weekly-feature changes plus the allowlisted extras pass when enforced', b);
const c1 = G.evaluate(['lib/acq-weekly-topics.js', 'lib/acq-youtube-videos.js']);
ok(c1.status === 'enforced' && c1.prohibited.join() === 'lib/acq-youtube-videos.js', '(c) weekly change + a YouTube file: rule 6 rejects it', c1);
const c2 = G.evaluate(['docs/weekly-video.sql', 'impact/render/plan.py', 'topics.js', 'lib/foo-bluesky.js', 'docs/other-bluesky.sql']);
ok(c2.prohibited.join() === 'impact/render/plan.py,topics.js,lib/foo-bluesky.js,docs/other-bluesky.sql', '(c) Tab 17, topics.js, bluesky lib and non-weekly bluesky docs are all still rejected', c2.prohibited);
const c3 = G.evaluate(['lib/acq-weekly-topics.js', 'lib/data.js', 'supabase/functions/_shared/national-report.ts']);
ok(c3.status === 'enforced' && c3.prohibited.length === 0 && c3.outside.join() === 'lib/data.js,supabase/functions/_shared/national-report.ts', '(c) weekly change + unrelated files: rule 6b rejects the unallowed ones (the original behaviour, unchanged)', c3);
ok(G.evaluate(['docs/weekly-bluesky-sources.sql', 'docs/weekly-x.sql']).prohibited.length === 0, 'the weekly bluesky-sources SQL stays the one allowed bluesky doc');

// ── the git read: unavailable refs ──
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tmp = mkdtempSync(join(tmpdir(), 'wsg-'));
try {
  sh(tmp, 'init', '-q'); sh(tmp, 'config', 'user.email', 't@t'); sh(tmp, 'config', 'user.name', 't');
  const put = (f, c) => { mkdirSync(dirname(join(tmp, f)), { recursive: true }); writeFileSync(join(tmp, f), c); };
  put('README.md', 'x'); sh(tmp, 'add', '-A'); sh(tmp, 'commit', '-qm', 'base');
  const u = G.changedAgainst('origin/main', tmp);
  ok(u.available === false && /not in this checkout/.test(u.reason) && u.changed === undefined, '(d) no origin/main in the checkout: UNAVAILABLE with a reason and no changed list', u);
  ok(G.changedAgainst('refs/heads/definitely-missing', tmp).available === false, '(d) any missing comparison ref is unavailable');
  // an origin/main that exists only as a LOCAL ref (nothing is fetched): unrelated-only branch => not applicable; mixed => enforced and rejected
  sh(tmp, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  put('lib/data.js', 'y'); sh(tmp, 'add', '-A'); sh(tmp, 'commit', '-qm', 'unrelated');
  let r = G.changedAgainst('origin/main', tmp);
  ok(r.available && G.evaluate(r.changed).status === 'not_applicable', 'real git: an unrelated-only branch against a present ref is NOT APPLICABLE', r);
  put('lib/acq-weekly-topics.js', 'z'); sh(tmp, 'add', '-A'); sh(tmp, 'commit', '-qm', 'weekly');
  r = G.changedAgainst('origin/main', tmp); let e = G.evaluate(r.changed);
  ok(e.status === 'enforced' && e.outside.join() === 'lib/data.js', 'real git: the same branch plus a weekly file is enforced and rejects the unrelated file', e);
  // an unrelated history (no merge base) is also unavailable, not a pass
  const orphan = sh(tmp, 'commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'unrelated root').trim(); // an orphan commit made locally: no fetch, no common history
  sh(tmp, 'update-ref', 'refs/remotes/origin/main', orphan);
  ok(G.changedAgainst('origin/main', tmp).available === false, '(d) a ref with no common history is unavailable, not a pass');
} finally { rmSync(tmp, { recursive: true, force: true }); }

// ── the guard's own files never fetch, and the weekly test reports the three outcomes distinctly ──
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const helper = strip(readFileSync(join(root, 'test/lib/weekly-scope-guard.mjs'), 'utf8')), wt = strip(readFileSync(join(root, 'test/weekly-topics.test.mjs'), 'utf8'));
ok(!/['"]fetch['"]|git fetch|['"]pull['"]/.test(helper) && !/git fetch|'fetch'/.test(wt), 'neither the helper nor the weekly test fetches a ref');
ok(/UNAVAILABLE — 6\/6b/.test(wt) && /NOT APPLICABLE — 6\/6b/.test(wt) && !/SKIP — 6/.test(wt), 'weekly-topics prints UNAVAILABLE / NOT APPLICABLE explicitly and no longer prints a bare SKIP');
ok(/ok\(g\.prohibited\.length === 0/.test(wt) && /ok\(g\.outside\.length === 0/.test(wt), 'the two enforcement checks (6 and 6b) are still asserted when the guard applies');
console.log(`\n${n - fails}/${n} passed`); process.exit(fails ? 1 : 0);
