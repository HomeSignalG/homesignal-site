#!/usr/bin/env node
// STARTUP CHECK — is the working tree actually what you think it is?
//
// WHY THIS EXISTS (founder instruction, 2026-08-04). Three stale checkouts in one session, each
// producing a CONFIDENT WRONG ANSWER rather than an error:
//   • a false revert alarm — a container-restored tree was compared against origin/main and read
//     as "5 merged PRs are missing"; a clean deploy was nearly cancelled over it;
//   • a wrong file count — 78 test files instead of 83, which is what finally exposed the rollback;
// A THIRD symptom — a missed QUEUE item — was initially blamed on staleness too, and that was
// WRONG: that grep ran from the wrong cwd with `2>/dev/null`, so it read zero files and exited 0.
// This script does NOT catch that class; see the companion rule in maps-go-live-governance.md
// ("never suppress stderr on a search you intend to act on"). Two different failures, one shape.
//
// The through-line: a grep against a stale tree does not fail, it ANSWERS. "No match" and "that
// file is older than the thing you are looking for" are indistinguishable at the call site. This is
// the same family as "an instrument must prove it ran before its silence counts as evidence."
//
// RUN IT: before any measurement or grep you intend to act on, and AGAIN after any container
// restart (the restarts are silent — cwd resets and HEAD can move backwards).
//     node scripts/check-tree-fresh.mjs
// Exit 0 = tree content matches origin/main. Exit 1 = do not trust a grep until you reconcile.
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let bad = 0;
const say = (ok, msg, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${!ok && detail ? `\n     ${detail}` : ''}`);
  if (!ok) bad++;
};

console.log('TREE FRESHNESS CHECK');

try { sh('git fetch origin main --quiet'); }
catch (e) { console.log(`  ! could not fetch origin/main (${String(e.message).split('\n')[0]}) — comparing against the last known ref`); }

const head = sh('git rev-parse --short HEAD');
const main = sh('git rev-parse --short origin/main');
console.log(`     HEAD ${head} · origin/main ${main}`);

// THE QUESTION IS "AM I MISSING WORK", NOT "AM I DIFFERENT FROM MAIN".
// Being AHEAD of main is the normal state of a feature branch and must not alarm — the first
// version of this script did alarm on it, which would have trained everyone to ignore the check.
// Being BEHIND is the dangerous state: your grep cannot see commits that already landed.
let containsMain = false;
try { sh('git merge-base --is-ancestor origin/main HEAD'); containsMain = true; } catch { containsMain = false; }

// What main has that HEAD does not — the files a grep here would be blind to.
let missing = [];
if (!containsMain) {
  try { missing = sh('git diff --name-only HEAD...origin/main').split('\n').filter(Boolean); } catch { /* leave empty */ }
}
// Nightly automation lands on main constantly and is never what a stale checkout is about.
const NOISE = new Set(['sitemap.xml', 'docs/source-monitor-report.md']);
const real = missing.filter((f) => !NOISE.has(f));

say(containsMain || real.length === 0,
  'HEAD contains everything on origin/main (a branch AHEAD of main is fine; BEHIND is not)',
  real.length ? `${real.length} file(s) changed on main that this tree cannot see — a grep here answers a DIFFERENT QUESTION than you think:\n     ` + real.slice(0, 12).join('\n     ') + (real.length > 12 ? `\n     …and ${real.length - 12} more` : '') : '');

if (containsMain) {
  const ahead = sh('git rev-list --count origin/main..HEAD');
  if (ahead !== '0') console.log(`     (${ahead} commit(s) ahead of main — expected on a feature branch)`);
} else if (missing.length !== real.length) {
  console.log(`     (ignored ${missing.length - real.length} nightly-automation file(s))`);
}

// The count that actually caught the rollback. Not an assertion — a number to eyeball against
// what the suite runner reports, because the two are counted differently on purpose.
const nTests = readdirSync(new URL('../test/', import.meta.url)).filter((f) => f.endsWith('.test.mjs')).length;
console.log(`     test/*.test.mjs on disk: ${nTests}   (scripts/run-unit-tests.mjs counts more — it walks subdirectories)`);

// An uncommitted-work warning: a reset that discards these is the OTHER way to lose a session.
const dirty = sh('git status --porcelain').split('\n').filter(Boolean);
if (dirty.length) console.log(`     ⚠ ${dirty.length} uncommitted change(s) — preserve them before any reset`);

console.log(bad
  ? '\nSTALE OR DIVERGED — reconcile before trusting any grep, count, or measurement.'
  : '\nTree is current. Safe to measure.');
process.exit(bad ? 1 : 0);
