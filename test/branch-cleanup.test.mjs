// Decision suite for the branch-cleanup tool. Offline: node builtins, a throwaway git repo in
// the OS temp dir, and a FAKE GitHub. Nothing here can reach a network or delete a real branch.
//
// MIRROR: identical in homesignal-ingest/tests/test_branch_cleanup.mjs except for SCRIPT_REL.
//
// WHAT EACH BLOCK PINS, and why it is not decoration:
//   §1 the target syntax          — a typo must REFUSE, never widen
//   §2 the pure decision          — every hold reason, plus the partition identity
//   §3 the data-loss rule on REAL git — "nothing becomes unreachable" is a git fact, so it is
//      tested against git, not against a fixture of what we think git says
//   §4 run() end to end on a fake GitHub — report-only deletes nothing; apply needs the
//      fingerprint; last-moment re-reads; verification by re-listing
//   §5 the workflow file          — dispatch-only, apply defaults false, main-only, no secrets
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_REL = '../scripts/cleanup-branches.mjs'; // homesignal-ingest: '../scripts/cleanup_branches.mjs'
const SCRIPT_PATH = join(HERE, SCRIPT_REL);
const WORKFLOW = join(HERE, '..', '.github', 'workflows', 'cleanup-branches.yml');
const M = await import(SCRIPT_REL);

// The script is a byte-identical mirror in two repos. Editing it means editing both, and this
// pin is what makes a one-sided edit fail instead of drifting.
const PINNED_SHA256 = '3386a80206ddc6705da6e9084d1706e8b6055752beff7eac8eb49e6f5b2f5c9c';

test('the script is the pinned mirror (edit BOTH repos, then update this pin)', () => {
  const got = createHash('sha256').update(readFileSync(SCRIPT_PATH)).digest('hex');
  assert.equal(got, PINNED_SHA256);
});

// ===== §1 target syntax =====================================================================
test('§1 accepts a prefix and an exact name', () => {
  assert.deepEqual(M.parseTarget('cursor/'), { kind: 'prefix', value: 'cursor/' });
  assert.deepEqual(M.parseTarget('claude/dc-atlas-phase-a-apply'), { kind: 'exact', value: 'claude/dc-atlas-phase-a-apply' });
});

test('§1 refuses anything that could widen or rewrite the scope', () => {
  for (const bad of ['', ' ', 'a/', 'cur', '/', '//', '../x/', 'cursor/ ', ' cursor/', 'cursor/*', 'cursor/\n', '-rf/', 'cursor//x/', null, undefined, 7]) {
    assert.throws(() => M.parseTarget(bad), undefined, `should refuse ${JSON.stringify(bad)}`);
  }
});

// ===== §2 the pure decision ==================================================================
const REPO = 'HomeSignalG/demo';
const br = (name, sha, extra = {}) => ({ name, sha, protected: false, ...extra });
const pr = (number, state, head_ref, o = {}) => ({ number, state, head_ref, head_repo: REPO, base_ref: 'main', ...o });
const none = [];

function plan(over = {}) {
  const branches = [
    br('main', 'm0'),
    br('cursor/merged-by-ancestry', 'a1'),          // no PR, but main holds every commit
    br('cursor/squash-merged', 'b1'),                // PR merged, commits live in the PR ref
    br('cursor/closed-unmerged', 'c1'),              // PR closed, commits live in the PR ref
    br('cursor/no-pr-unique-work', 'd1'),            // the FinCEN shape
    br('cursor/open-pr', 'e1'),                      // the #638 shape
    br('cursor/is-a-base', 'f1'),
    br('cursor/protected-one', 'g1', { protected: true }),
    br('cursor/weird name', 'h1'),
    br('cursor/never-measured', 'i1'),
    br('cursor/fork-clash', 'j1'),
    br('feature/not-targeted', 'k1'),
  ];
  const prs = [
    pr(1, 'closed', 'cursor/squash-merged'),
    pr(2, 'closed', 'cursor/closed-unmerged'),
    pr(3, 'open', 'cursor/open-pr'),
    pr(4, 'open', 'someone/else', { base_ref: 'cursor/is-a-base' }),
    pr(5, 'open', 'cursor/fork-clash', { head_repo: 'stranger/demo' }), // a FORK's branch of the same name
  ];
  const unpreserved = new Map([
    ['cursor/merged-by-ancestry', none], ['cursor/squash-merged', none], ['cursor/closed-unmerged', none],
    ['cursor/no-pr-unique-work', ['x1', 'x2']], ['cursor/open-pr', none], ['cursor/is-a-base', none],
    ['cursor/protected-one', none], ['cursor/weird name', none], ['cursor/fork-clash', none],
    // 'cursor/never-measured' deliberately ABSENT
  ]);
  return M.selectDeletable({ repo: REPO, target: 'cursor/', defaultBranch: 'main', branches, prs, unpreserved, ...over });
}

test('§2 every hold reason fires, and only the finished-with branches are deletable', () => {
  const p = plan();
  assert.deepEqual(p.deletable.map((d) => d.name), [
    'cursor/closed-unmerged', 'cursor/fork-clash', 'cursor/merged-by-ancestry', 'cursor/squash-merged',
  ]);
  const why = Object.fromEntries(p.held.map((h) => [h.name, h.reasons.join('|')]));
  assert.equal(why['cursor/no-pr-unique-work'], 'unpreserved-commits:2');
  assert.equal(why['cursor/open-pr'], 'open-pr-head:#3');
  assert.equal(why['cursor/is-a-base'], 'open-pr-base:#4');
  assert.equal(why['cursor/protected-one'], 'protected');
  assert.equal(why['cursor/weird name'], 'unusual-name');
  assert.equal(why['cursor/never-measured'], 'preservation-unknown');
});

test('§2 a FORK\'s open PR with the same branch name neither holds nor preserves our branch', () => {
  const fork = plan().deletable.find((d) => d.name === 'cursor/fork-clash');
  assert.ok(fork, 'our branch is not held by a stranger\'s PR');
  assert.deepEqual(fork.prs, [], 'and the stranger\'s PR is not credited to it');
});

test('§2 partition identity: targeted = deletable + held, and non-targets are never touched', () => {
  const p = plan();
  assert.equal(p.targeted, 10, 'ten cursor/ names in the fixture; main and feature/not-targeted are outside the target');
  assert.equal(p.deletable.length + p.held.length, p.targeted);
  assert.ok(![...p.deletable, ...p.held].some((x) => x.name === 'feature/not-targeted' || x.name === 'main'));
});

test('§2 the default branch and an unmeasured read can never be deletable', () => {
  const branches = [br('main', 'm0'), br('cursor/x', 'x0')];
  const p = M.selectDeletable({ repo: REPO, target: 'cursor/x', defaultBranch: 'main', branches, prs: [], unpreserved: new Map() });
  assert.equal(p.deletable.length, 0);
  assert.deepEqual(p.held[0].reasons, ['preservation-unknown']);
  // no unpreserved map at all
  const q = M.selectDeletable({ repo: REPO, target: 'cursor/x', defaultBranch: 'main', branches, prs: [], unpreserved: null });
  assert.equal(q.deletable.length, 0);
  assert.throws(() => M.selectDeletable({ repo: REPO, target: 'cursor/', defaultBranch: 'main', branches: [br('cursor/x', 'x0')], prs: [], unpreserved: new Map() }), /default branch/);
});

test('§2 fingerprint is order-independent, 16 hex, and moves with any single change', () => {
  const a = M.fingerprint(['b', 'a', 'c']);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, M.fingerprint(['c', 'b', 'a']));
  assert.notEqual(a, M.fingerprint(['a', 'b']));
  assert.notEqual(a, M.fingerprint(['a', 'b', 'd']));
  assert.notEqual(a, M.fingerprint(['a', 'b', 'c', 'c2']));
});

// ===== §3 the data-loss rule, against REAL git ==============================================
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'bc-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: ENV }).trim();
  const commit = (file, msg) => { writeFileSync(join(dir, file), msg); g('add', file); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
  g('init', '-q', '-b', 'main');
  commit('base.txt', 'base');
  const T = {};
  // merged by fast-forward: main holds every commit
  g('checkout', '-q', '-b', 'merged-ff'); T.mergedFf = commit('ff.txt', 'ff'); g('checkout', '-q', 'main'); g('merge', '-q', '--ff-only', 'merged-ff');
  // squash-merged: branch commits are NOT in main, the PR ref holds them
  g('checkout', '-q', '-b', 'squash-pr'); commit('s1.txt', 's1'); T.squash = commit('s2.txt', 's2'); g('update-ref', 'refs/pr/10', T.squash);
  g('checkout', '-q', 'main'); commit('squashed.txt', 'the squash commit');
  // closed unmerged: only the PR ref holds it
  g('checkout', '-q', '-b', 'closed-pr'); T.closed = commit('k.txt', 'k1'); g('update-ref', 'refs/pr/11', T.closed); g('checkout', '-q', 'main');
  // advanced past its PR ref by a real commit
  g('checkout', '-q', '-b', 'advanced'); const a1 = commit('a1.txt', 'a1'); g('update-ref', 'refs/pr/12', a1); T.advanced = commit('a2.txt', 'a2 after the PR closed'); T.advancedExtra = T.advanced; g('checkout', '-q', 'main');
  // updated from main after its PR closed: the tip is a merge commit nothing holds
  g('checkout', '-q', '-b', 'update-merge'); const u1 = commit('u1.txt', 'u1'); g('update-ref', 'refs/pr/13', u1);
  g('checkout', '-q', 'main'); commit('later-main.txt', 'main moved on');
  g('checkout', '-q', 'update-merge'); g('merge', '-q', '--no-edit', 'main'); T.updateMerge = g('rev-parse', 'HEAD'); g('checkout', '-q', 'main');
  // orphan work: two commits, no PR, not in main
  g('checkout', '-q', '-b', 'orphan'); commit('o1.txt', 'o1'); T.orphan = commit('o2.txt', 'o2'); g('checkout', '-q', 'main');
  // merged by merge commit (no-ff): main holds it
  g('checkout', '-q', '-b', 'merge-commit'); T.mergeCommit = commit('mc.txt', 'mc'); g('checkout', '-q', 'main'); g('merge', '-q', '--no-ff', '-m', 'merge mc', 'merge-commit');
  g('update-ref', 'refs/remotes/origin/main', g('rev-parse', 'main'));
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: ENV });
  return { dir, git, T };
}

test('§3 nothing is "preserved" that deleting would make unreachable (real git)', () => {
  const { git, T } = world();
  const u = (tip) => M.unpreservedCommits({ git, tip, defaultBranch: 'main' });
  assert.deepEqual(u(T.mergedFf), [], 'fast-forward merged: main holds it');
  assert.deepEqual(u(T.mergeCommit), [], 'merge-commit merged: main holds it');
  assert.deepEqual(u(T.squash), [], 'squash merged: the PR ref holds it');
  assert.deepEqual(u(T.closed), [], 'closed unmerged: the PR ref holds it');
  assert.deepEqual(u(T.advanced), [T.advanced], 'a commit pushed after the PR closed is NOT held');
  assert.deepEqual(u(T.updateMerge), [T.updateMerge], 'an update-from-main merge after close is NOT held (strict on purpose)');
  assert.equal(u(T.orphan).length, 2, 'work with no PR and not in main is NOT held');
});

test('§3 the PR-ref glob really is what protects the squash/closed cases (control)', () => {
  const { git, T } = world();
  git(['update-ref', '-d', 'refs/pr/10']);
  git(['update-ref', '-d', 'refs/pr/11']);
  assert.equal(M.unpreservedCommits({ git, tip: T.squash, defaultBranch: 'main' }).length, 2, 'without its PR ref the squash branch has 2 unheld commits');
  assert.equal(M.unpreservedCommits({ git, tip: T.closed, defaultBranch: 'main' }).length, 1);
});

// ===== §4 run() end to end on a fake GitHub =================================================
function fakeGithub({ extraBranches = [], hooks = {} } = {}) {
  const S = {
    default: 'main',
    branches: [
      { name: 'main', commit: { sha: 'm0' }, protected: true },
      { name: 'cursor/one', commit: { sha: 'o1' }, protected: false },
      { name: 'cursor/two', commit: { sha: 't1' }, protected: false },
      { name: 'cursor/keep', commit: { sha: 'k1' }, protected: false },
      { name: 'other/untouched', commit: { sha: 'u1' }, protected: false },
      ...extraBranches,
    ],
    prs: [
      { number: 1, state: 'closed', merged_at: 'x', head: { ref: 'cursor/one', repo: { full_name: REPO } }, base: { ref: 'main' } },
      { number: 2, state: 'closed', merged_at: null, head: { ref: 'cursor/two', repo: { full_name: REPO } }, base: { ref: 'main' } },
    ],
    unpreserved: { 'cursor/one': [], 'cursor/two': [], 'cursor/keep': ['zz'] },
    deletes: [], calls: [],
  };
  // /(?:^|&)page=/ and not /page=/, which would match the 'per_page=100' inside the query
  const page = (arr, q) => { const n = Number(/(?:^|&)page=(\d+)/.exec(q)[1]); return arr.slice((n - 1) * 100, n * 100); };
  S.api = (path, method) => {
    S.calls.push([method || 'GET', path]);
    if (method === 'DELETE') {
      const name = path.split('/git/refs/heads/')[1];
      if (hooks.failDelete === name) throw new Error('HTTP 422');
      S.deletes.push(name);
      if (hooks.ghostDelete === name) return null;   // 204, yet the branch is still there
      S.branches = S.branches.filter((b) => b.name !== name);
      if (hooks.collateral) S.branches = S.branches.filter((b) => b.name !== hooks.collateral);
      return null;
    }
    if (path === `repos/${REPO}`) return { default_branch: 'main' };
    let m;
    if ((m = /^repos\/[^/]+\/[^/]+\/branches\?(.*)$/.exec(path))) return page(S.branches, m[1]);
    if ((m = /^repos\/[^/]+\/[^/]+\/branches\/(.+)$/.exec(path))) {
      if (hooks.moveTip === m[1]) return { name: m[1], commit: { sha: 'MOVED' } };
      const b = S.branches.find((x) => x.name === m[1]); if (!b) throw new Error('HTTP 404'); return b;
    }
    if (/pulls\?state=open&head=/.test(path)) return hooks.openPrAppears && path.includes(encodeURIComponent(`HomeSignalG:${hooks.openPrAppears}`)) ? [{ number: 99 }] : [];
    if ((m = /^repos\/[^/]+\/[^/]+\/pulls\?state=all&(.*)$/.exec(path))) return page(S.prs, m[1]);
    throw new Error('fake github: unexpected ' + path);
  };
  S.git = (args) => {
    if (args[0] === 'rev-parse') return 'm0\n';
    if (args[0] === 'for-each-ref') return 'refs/pr/1\nrefs/pr/2\n';
    if (args[0] === 'rev-list') {
      const tip = args[1]; const name = S.branches.find((b) => b.commit.sha === tip)?.name;
      if (!(name in S.unpreserved)) throw new Error('missing object');
      return S.unpreserved[name].join('\n');
    }
    throw new Error('unexpected git ' + args.join(' '));
  };
  return S;
}
const ENVV = { GITHUB_REPOSITORY: REPO };
const go = (S, argv = [], env = {}) => { const logs = []; const r = M.run({ argv, env: { ...ENVV, ...env }, api: S.api, git: S.git, log: (l) => logs.push(l) }); return { r, logs: logs.join('\n') }; };

test('§4 REPORT ONLY deletes nothing, names the fingerprint, and holds the unmerged work', () => {
  const S = fakeGithub();
  const { r, logs } = go(S, ['--target', 'cursor/']);
  assert.equal(r.exit, 0, logs);
  assert.equal(S.deletes.length, 0);
  assert.equal(S.calls.filter(([m]) => m === 'DELETE').length, 0);
  assert.deepEqual(r.plan.deletable.map((d) => d.name), ['cursor/one', 'cursor/two']);
  assert.deepEqual(r.plan.held.map((h) => h.name), ['cursor/keep']);
  assert.match(logs, new RegExp(`FINGERPRINT: ${r.plan.fingerprint}`));
  assert.match(logs, /REPORT ONLY/);
});

test('§4 a typo in apply REPORTS: only the literal string "true" deletes', () => {
  for (const v of ['True', 'TRUE', '1', 'yes', 'false', '', ' true']) {
    const S = fakeGithub();
    go(S, [], { CLEANUP_TARGET: 'cursor/', CLEANUP_APPLY: v, CLEANUP_EXPECT: 'whatever' });
    assert.equal(S.deletes.length, 0, `CLEANUP_APPLY=${JSON.stringify(v)} must not delete`);
  }
});

test('§4 apply with no fingerprint, or the wrong one, refuses and deletes nothing', () => {
  const S0 = fakeGithub();
  const fp = go(S0, ['--target', 'cursor/']).r.plan.fingerprint;
  for (const expect of ['', '0000000000000000', fp.toUpperCase() === fp ? 'x' : fp.toUpperCase()]) {
    const S = fakeGithub();
    const { r, logs } = go(S, ['--target', 'cursor/', '--apply', '--expect', expect]);
    assert.equal(r.exit, 1, `expect=${JSON.stringify(expect)}`);
    assert.equal(S.deletes.length, 0);
    // WHICH refusal fires matters: a missing fingerprint must say so, not read as a mismatch.
    assert.match(logs, expect === '' ? /apply needs expected_fingerprint/ : /does not match this run's/);
  }
});

test('§4 apply with the right fingerprint deletes exactly the plan, then verifies by re-listing', () => {
  const S = fakeGithub();
  const fp = go(fakeGithub(), ['--target', 'cursor/']).r.plan.fingerprint;
  const { r, logs } = go(S, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.equal(r.exit, 0, logs);
  assert.deepEqual(S.deletes.sort(), ['cursor/one', 'cursor/two']);
  assert.deepEqual(S.branches.map((b) => b.name).sort(), ['cursor/keep', 'main', 'other/untouched']);
  assert.match(logs, /APPLIED: deleted 2 · skipped 0 · failed 0/);
});

test('§4 the population changing between report and apply refuses (that is what the fingerprint is for)', () => {
  const fp = go(fakeGithub(), ['--target', 'cursor/']).r.plan.fingerprint;
  const S = fakeGithub({ extraBranches: [{ name: 'cursor/new-arrival', commit: { sha: 'n1' }, protected: false }] });
  S.unpreserved['cursor/new-arrival'] = [];
  const { r } = go(S, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.equal(r.exit, 1);
  assert.equal(S.deletes.length, 0);
});

test('§4 last-moment re-reads: a moved tip or a newly opened PR is skipped, not deleted', () => {
  const fp = go(fakeGithub(), ['--target', 'cursor/']).r.plan.fingerprint;
  const A = fakeGithub({ hooks: { moveTip: 'cursor/one' } });
  const a = go(A, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.deepEqual(A.deletes, ['cursor/two']);
  assert.match(a.logs, /SKIPPED cursor\/one: tip moved/);
  const B = fakeGithub({ hooks: { openPrAppears: 'cursor/two' } });
  const b = go(B, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.deepEqual(B.deletes, ['cursor/one']);
  assert.match(b.logs, /SKIPPED cursor\/two: open PR #99/);
});

test('§4 a failed delete and a collateral deletion are both loud (exit 1)', () => {
  const fp = go(fakeGithub(), ['--target', 'cursor/']).r.plan.fingerprint;
  const F = fakeGithub({ hooks: { failDelete: 'cursor/one' } });
  const f = go(F, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.equal(f.r.exit, 1);
  assert.match(f.logs, /FAILED  cursor\/one/);
  assert.deepEqual(F.deletes, ['cursor/two'], 'one failure does not stop the others');
  const C = fakeGithub({ hooks: { collateral: 'other/untouched' } });
  const c = go(C, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.equal(c.r.exit, 1);
  assert.match(c.logs, /gone but not on the plan: other\/untouched/);
});

test('§4 a delete that was ACCEPTED but did not take effect is caught by the re-listing', () => {
  const fp = go(fakeGithub(), ['--target', 'cursor/']).r.plan.fingerprint;
  const S = fakeGithub({ hooks: { ghostDelete: 'cursor/one' } });
  const { r, logs } = go(S, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.equal(r.exit, 1);
  assert.match(logs, /VERIFY FAILED: still present after delete: cursor\/one/);
});

test('§4 refuses a broken read rather than deciding on it', () => {
  const noPrRefs = fakeGithub(); noPrRefs.git = (a) => (a[0] === 'for-each-ref' ? '' : fakeGithub().git(a));
  assert.match(go(noPrRefs, ['--target', 'cursor/']).logs, /REFUSED: no pull-request refs/);
  const noPrs = fakeGithub(); noPrs.prs = [];
  assert.match(go(noPrs, ['--target', 'cursor/']).logs, /REFUSED: pull-request read returned nothing/);
  const stale = fakeGithub(); stale.git = (a) => (a[0] === 'rev-parse' ? 'OLD\n' : fakeGithub().git(a));
  assert.match(go(stale, ['--target', 'cursor/']).logs, /REFUSED: checkout is stale/);
  assert.match(go(fakeGithub(), ['--target', 'main']).logs, /REFUSED: target is the default branch/);
  assert.match(go(fakeGithub(), ['--target', 'cursor']).logs, /REFUSED: target "cursor" matched no branch/);
  assert.equal(go(fakeGithub(), ['--target', 'cursor/']).r.exit, 0, 'control: the correctly spelled target is not refused');
  assert.equal(M.run({ argv: [], env: {}, api: () => ({}), git: () => '' , log() {} }).exit, 1, 'no GITHUB_REPOSITORY');
});

test('§4 pagination: 250 branches are all read, and the delete ceiling refuses a huge plan', () => {
  const extra = Array.from({ length: 250 }, (_, i) => ({ name: `cursor/bulk-${String(i).padStart(3, '0')}`, commit: { sha: `b${i}` }, protected: false }));
  const S = fakeGithub({ extraBranches: extra });
  for (const e of extra) S.unpreserved[e.name] = [];
  const { r } = go(S, ['--target', 'cursor/']);
  assert.equal(r.plan.targeted, 253, 'one, two, keep + 250: a 100-row page limit would have hidden most of them');
  const fp = r.plan.fingerprint;
  const S2 = fakeGithub({ extraBranches: extra });
  for (const e of extra) S2.unpreserved[e.name] = [];
  const big = go(S2, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.equal(big.r.exit, 1);
  assert.match(big.logs, /exceeds the ceiling/);
  assert.equal(S2.deletes.length, 0);
});

// ===== §5 the workflow file ==================================================================
const WF = readFileSync(WORKFLOW, 'utf8');
const stripComments = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const WFC = stripComments(WF);

test('§5 dispatch-only: no schedule, push, pull_request or workflow_run trigger', () => {
  const on = WFC.slice(WFC.indexOf('\non:'), WFC.indexOf('\npermissions:'));
  assert.match(on, /workflow_dispatch:/);
  for (const t of ['schedule:', 'push:', 'pull_request', 'workflow_run', 'repository_dispatch', 'release:']) {
    assert.ok(!on.includes(t), `must not be triggered by ${t}`);
  }
});

test('§5 apply defaults to false and the fingerprint input exists', () => {
  assert.match(WFC, /apply:[\s\S]*?type: boolean[\s\S]*?default: false/);
  assert.match(WFC, /expected_fingerprint:/);
  assert.match(WFC, /target:[\s\S]*?default: 'cursor\/'/);
});

test('§5 least privilege, no secrets, one run at a time', () => {
  const perms = WFC.slice(WFC.indexOf('\npermissions:'), WFC.indexOf('\nconcurrency:'));
  assert.deepEqual(perms.split('\n').map((l) => l.trim()).filter(Boolean), ['permissions:', 'contents: write', 'pull-requests: read']);
  assert.ok(!/secrets\./.test(WFC), 'uses the run\'s own token only');
  assert.match(WFC, /github\.token/);
  assert.match(WFC, /concurrency:[\s\S]*?cancel-in-progress: false/);
});

test('§5 refuses any ref but main BEFORE checkout, and runs this suite before the tool', () => {
  const iGuard = WFC.indexOf('refs/heads/main');
  const iCheckout = WFC.indexOf('actions/checkout');
  const iSuite = WFC.indexOf('node --test');
  const iTool = WFC.indexOf('cleanup_branches.mjs', iSuite) >= 0 ? WFC.indexOf('cleanup_branches.mjs', iSuite) : WFC.indexOf('cleanup-branches.mjs', iSuite);
  assert.ok(iGuard > 0 && iGuard < iCheckout, 'main-only guard first');
  assert.ok(iSuite > iCheckout && iTool > iSuite, 'suite gates the run');
  assert.match(WFC, /fetch-depth: 0/);
  assert.match(WFC, /refs\/pull\/\*\/head:refs\/pr\/\*/);
});

test('§5 inputs reach the script only through env, never interpolated into shell', () => {
  for (const line of WFC.split('\n')) {
    if (line.includes('github.event.inputs')) assert.match(line, /^\s*CLEANUP_[A-Z]+: \$\{\{ github\.event\.inputs\.[a-z_]+ \}\}\s*$/, line);
  }
  assert.ok(WFC.includes('CLEANUP_APPLY'));
});
