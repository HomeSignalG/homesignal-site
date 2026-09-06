// PAGES PUBLISH TRIGGER - the push filter must cover what the artifact actually SHIPS.
//
// THE BUG THIS PINS. pages.yml's push `paths:` named the nine inputs of the ZIP-page
// GENERATOR, while its "Stage the static site" step rsyncs the WHOLE repo minus
// .github/docs/test/node_modules into the artifact. Those are different questions, and the
// gap was total: 339 of 344 shipped files - index.html, app.css, homesignalmap.html,
// partials/shell.html, every lib/*.js - could change on main without triggering a publish.
// Measured over the 20 commits before the fix: 18 touched a shipped file, and pages fired on
// push for 0 of them. The site stayed current only because a human dispatched the workflow by
// hand after nearly every merge (17 of 22 main runs were workflow_dispatch).
//
// WHY A TEST AND NOT A COMMENT. The failure is silent: nothing goes red when a newly shipped
// file has no publish trigger, so the site just quietly stops updating for that file. This
// derives the shipped set from the workflow's OWN rsync line rather than from a second
// hand-maintained list, so a new shipped path is covered without anyone remembering to add it
// here.
//
// WHAT IT DOES NOT COVER, stated because an earlier draft of this comment claimed both
// directions and a mutation proved it wrong: it checks SHIPPED-BUT-NOT-TRIGGERED only.
// Adding an rsync --exclude without touching the filter SHRINKS the shipped set, so this
// suite still passes - the filter is then merely over-broad, which costs a wasted build and
// publishes nothing incorrect. Removing lib/ from the artifact would break the site, but it
// would break it at the rsync, not here, and check 4 is the only place over-triggering is
// asserted at all (for docs/ and unrelated workflows, where the cost is real).
//
// Run: node test/pages-publish-trigger.test.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!c) fails++;
};

const wf = readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8');

// -- 1. THE SHIPPED SET, READ OUT OF THE WORKFLOW'S OWN rsync LINE --------------------
// Not a copy of it. If someone adds or drops an --exclude, this moves with them.
const rsync = (wf.match(/rsync -a[\s\S]*?\.\/ _site\//) || [])[0] || '';
ok(rsync.length > 0, '1: the staging rsync command was located in pages.yml');
const excludes = [...rsync.matchAll(/--exclude '([^']+)'/g)].map(m => m[1]);
ok(excludes.length >= 5, '1: its --exclude list parsed', excludes.join(' '));
// '.git' and '_site' are VCS/build artefacts, never tracked sources.
const excludedTrees = excludes.filter(e => !['.git', '_site'].includes(e));

const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean);
const ships = tracked.filter(f => !excludedTrees.some(t => f === t || f.startsWith(t + '/')));
ok(ships.length > 100, '1: the shipped set is non-trivial', ships.length + ' files');

// -- 2. THE PUSH FILTER, PARSED FROM THE WORKFLOW -------------------------------------
const onBlock = wf.slice(wf.indexOf('\non:'), wf.indexOf('\npermissions:'));
const pushBlock = onBlock.slice(onBlock.indexOf('  push:'), onBlock.indexOf('  schedule:'));
const prIdx = pushBlock.indexOf('  pull_request:');
const pushOnly = prIdx === -1 ? pushBlock : pushBlock.slice(0, prIdx);
const pushPaths = [...pushOnly.matchAll(/^      - '([^']+)'$/gm)].map(m => m[1]);
ok(pushPaths.length > 0, '2: push paths parsed', pushPaths.length + ' patterns');

// GitHub semantics: later patterns override earlier ones; a leading '!' removes.
const toRe = (g) => new RegExp('^' + g
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*/g, ' ').replace(/\*/g, '[^/]*').replace(/ /g, '.*') + '$');
function triggers(file) {
  let hit = false;
  for (const p of pushPaths) {
    const neg = p.startsWith('!');
    if (toRe(neg ? p.slice(1) : p).test(file)) hit = !neg;
  }
  return hit;
}

// -- 3. EVERY SHIPPED FILE TRIGGERS A PUBLISH -----------------------------------------
const orphans = ships.filter(f => !triggers(f));
ok(orphans.length === 0,
  '3: every shipped file triggers a publish - ' + ships.length + ' checked',
  orphans.length ? orphans.slice(0, 8).join(', ') + (orphans.length > 8 ? ' +' + (orphans.length - 8) + ' more' : '') : 'none orphaned');

// Named explicitly, because these are the ones a resident sees and the ones that were broken.
['homesignalmap.html', 'index.html', 'app.css', 'lib/map.js', 'partials/shell.html', 'community.html']
  .filter(f => ships.includes(f))
  .forEach(f => ok(triggers(f), '3: ' + f + ' triggers a publish'));

// -- 4. THE EXCLUDED TREES MUST NOT TRIGGER (or every docs edit runs a 30-min build) --
ok(!triggers('docs/some-note.md'), '4: a docs-only change does NOT trigger a publish');
ok(!triggers('.github/workflows/unit-tests.yml'), '4: an unrelated workflow does NOT trigger');
// ...except the gate inputs that deliberately live inside them.
['.github/workflows/pages.yml', 'test/zip-pages-seo.test.mjs', 'test/fixtures/zip-pages.json']
  .forEach(f => ok(triggers(f), '4: gate input re-included: ' + f));

// -- 5. SCOPE - main only, and the pre-merge proof still exists -----------------------
ok(/ {2}push:\s*\n\s*branches: \[main\]/.test(wf),
  '5: push is scoped to main (a broad filter on every branch would run this build per commit)');
ok(/ {2}pull_request:\s*\n\s*paths:/.test(wf),
  '5: the pre-merge proof survives as a pull_request trigger');
ok(/if: github\.ref == 'refs\/heads\/main'/.test(wf),
  '5: deploy is still gated on main, so a PR build can never publish');

console.log('\n' + (fails ? fails + ' FAILED' : 'pages-publish-trigger: all checks passed'));
process.exit(fails ? 1 : 0);
