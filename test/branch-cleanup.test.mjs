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
//      fingerprint; input controls; atomic delete; last-moment re-checks; verification
//   §5 the command line           — exit code and the entry guard, including a symlinked path
//   §6 the workflow file          — dispatch-only, apply defaults false, main-only, no secrets
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_REL = '../scripts/cleanup-branches.mjs'; // homesignal-ingest: '../scripts/cleanup_branches.mjs'
const SCRIPT_PATH = join(HERE, SCRIPT_REL);
const ROOT = join(HERE, '..');
const SELF_REL = relative(ROOT, fileURLToPath(import.meta.url));
const WORKFLOW = join(ROOT, '.github', 'workflows', 'cleanup-branches.yml');
const M = await import(SCRIPT_REL);

// The script is a byte-identical mirror in two repos. This pin catches an accidental edit in
// THIS repo; keep it equal to the other repo's pin by hand.
const PINNED_SHA256 = 'a1bd10493528ac9205c143bc800c17c8ddd6e0a430cf0c74b6b87e6ea54193e2';

test('the script is the pinned mirror (edit BOTH repos, then update this pin in both)', () => {
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
    br('cursor/base-of-a-fork-pr', 'f2'),
    br('cursor/protected-one', 'g1', { protected: true }),
    br('cursor/weird name', 'h1'),
    br('cursor/never-measured', 'i1'),
    br('cursor/fork-clash', 'j1'),
    br('cursor/release-source', 'l1'),
    br('feature/not-targeted', 'k1'),
    br('old-cursor/inside-a-longer-name', 'n1'),     // contains "cursor/" but does not start with it
  ];
  const prs = [
    pr(1, 'closed', 'cursor/squash-merged'),
    pr(2, 'closed', 'cursor/closed-unmerged'),
    pr(3, 'open', 'cursor/open-pr'),
    pr(4, 'open', 'someone/else', { base_ref: 'cursor/is-a-base' }),
    pr(5, 'open', 'cursor/fork-clash', { head_repo: 'stranger/demo' }), // a FORK's branch of the same name
    pr(6, 'open', 'patch-1', { head_repo: 'stranger/demo', base_ref: 'cursor/base-of-a-fork-pr' }),
  ];
  const ok = (n) => [n, none];
  const unpreserved = new Map([
    ok('cursor/merged-by-ancestry'), ok('cursor/squash-merged'), ok('cursor/closed-unmerged'),
    ['cursor/no-pr-unique-work', ['x1', 'x2']], ok('cursor/open-pr'), ok('cursor/is-a-base'), ok('cursor/base-of-a-fork-pr'),
    ok('cursor/protected-one'), ok('cursor/weird name'), ok('cursor/fork-clash'), ok('cursor/release-source'),
    // 'cursor/never-measured' deliberately ABSENT
  ]);
  const merged = new Map([['cursor/merged-by-ancestry', true]]);
  const releaseTargets = new Map([['cursor/release-source', ['v1.0']]]);
  return M.selectDeletable({ repo: REPO, target: 'cursor/', defaultBranch: 'main', branches, prs, unpreserved, merged, releaseTargets, ...over });
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
  assert.equal(why['cursor/base-of-a-fork-pr'], 'open-pr-base:#6', 'a fork PR targeting our branch holds it too');
  assert.equal(why['cursor/protected-one'], 'protected');
  assert.equal(why['cursor/weird name'], 'unusual-name');
  assert.equal(why['cursor/never-measured'], 'preservation-unknown');
  assert.equal(why['cursor/release-source'], 'release-target:v1.0');
});

test('§2 the merged label is carried, never guessed', () => {
  const p = plan();
  assert.equal(p.deletable.find((d) => d.name === 'cursor/merged-by-ancestry').merged, true);
  assert.equal(p.deletable.find((d) => d.name === 'cursor/closed-unmerged').merged, false);
});

test('§2 a FORK\'s open PR with the same branch name neither holds nor preserves our branch', () => {
  const fork = plan().deletable.find((d) => d.name === 'cursor/fork-clash');
  assert.ok(fork, 'our branch is not held by a stranger\'s PR');
  assert.deepEqual(fork.prs, [], 'and the stranger\'s PR is not credited to it');
});

test('§2 partition identity, and a prefix only matches at the START of a name', () => {
  const p = plan();
  assert.equal(p.targeted, 12, 'twelve names start with cursor/');
  assert.equal(p.deletable.length + p.held.length, p.targeted);
  const touched = new Set([...p.deletable, ...p.held].map((x) => x.name));
  for (const n of ['feature/not-targeted', 'main', 'old-cursor/inside-a-longer-name']) assert.ok(!touched.has(n), n);
});

test('§2 names git allows but this tool will not touch are held', () => {
  const odd = ['cursor/a..b', 'cursor/end/', 'cursor/x.lock', 'cursor/ünicode', 'cursor/a@{b', 'cursor/back\\slash', 'cursor/t~1', 'cursor/c^2', 'cursor/q?'];
  const branches = [br('main', 'm0'), ...odd.map((n) => br(n, 's')), br('cursor/a.b_c-d', 'ok')];
  const unpreserved = new Map([...odd, 'cursor/a.b_c-d'].map((n) => [n, none]));
  const p = M.selectDeletable({ repo: REPO, target: 'cursor/', defaultBranch: 'main', branches, prs: [], unpreserved });
  assert.deepEqual(p.deletable.map((d) => d.name), ['cursor/a.b_c-d'], 'control: an ordinary name is deletable');
  for (const h of p.held) assert.deepEqual(h.reasons, ['unusual-name'], h.name);
  assert.equal(p.held.length, odd.length);
});

test('§2 the default branch is held even when targeted exactly, and an unmeasured read is held', () => {
  const branches = [br('main', 'm0'), br('cursor/x', 'x0')];
  const d = M.selectDeletable({ repo: REPO, target: 'main', defaultBranch: 'main', branches, prs: [], unpreserved: new Map([['main', none]]) });
  assert.equal(d.deletable.length, 0);
  assert.deepEqual(d.held[0].reasons, ['default-branch']);
  const q = M.selectDeletable({ repo: REPO, target: 'cursor/x', defaultBranch: 'main', branches, prs: [], unpreserved: null });
  assert.deepEqual(q.held[0].reasons, ['preservation-unknown']);
  assert.throws(() => M.selectDeletable({ repo: REPO, target: 'cursor/', defaultBranch: 'main', branches: [br('cursor/x', 'x0')], prs: [], unpreserved: new Map() }), /default branch/);
});

test('§2 the fingerprint binds exactly the deletable names', () => {
  const p = plan();
  assert.equal(p.fingerprint, M.fingerprint(p.deletable.map((d) => d.name)));
  const a = M.fingerprint(['b', 'a', 'c']);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, M.fingerprint(['c', 'b', 'a']));
  for (const other of [['a', 'b'], ['a', 'b', 'd'], ['a', 'b', 'c', 'c2']]) assert.notEqual(a, M.fingerprint(other));
  const lessOne = plan({ unpreserved: new Map([['cursor/squash-merged', none]]) });
  assert.notEqual(lessOne.fingerprint, p.fingerprint, 'a different deletable set gives a different fingerprint');
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
  // squash-merged: branch commits are NOT in main, the closed PR's head holds them
  g('checkout', '-q', '-b', 'squash-pr'); commit('s1.txt', 's1'); T.squash = commit('s2.txt', 's2');
  g('checkout', '-q', 'main'); commit('squashed.txt', 'the squash commit');
  // closed unmerged: only the closed PR's head holds it
  g('checkout', '-q', '-b', 'closed-pr'); T.closed = commit('k.txt', 'k1'); g('checkout', '-q', 'main');
  // advanced past its PR head by a real commit
  g('checkout', '-q', '-b', 'advanced'); T.advancedPrHead = commit('a1.txt', 'a1'); T.advanced = commit('a2.txt', 'a2 after the PR closed'); g('checkout', '-q', 'main');
  // updated from main after its PR closed: the tip is a merge commit nothing holds
  g('checkout', '-q', '-b', 'update-merge'); T.updatePrHead = commit('u1.txt', 'u1');
  g('checkout', '-q', 'main'); commit('later-main.txt', 'main moved on');
  g('checkout', '-q', 'update-merge'); g('merge', '-q', '--no-edit', 'main'); T.updateMerge = g('rev-parse', 'HEAD'); g('checkout', '-q', 'main');
  // orphan work: two commits, no PR, not in main
  g('checkout', '-q', '-b', 'orphan'); commit('o1.txt', 'o1'); T.orphan = commit('o2.txt', 'o2'); g('checkout', '-q', 'main');
  // stacked: step-a's commit is held ONLY by an OPEN PR on step-b
  g('checkout', '-q', '-b', 'step-a'); T.stepA = commit('sa.txt', 'a1'); g('checkout', '-q', '-b', 'step-b'); T.stepB = commit('sb.txt', 'b1'); g('checkout', '-q', 'main');
  // merged by merge commit (no-ff): main holds it
  g('checkout', '-q', '-b', 'merge-commit'); T.mergeCommit = commit('mc.txt', 'mc'); g('checkout', '-q', 'main'); g('merge', '-q', '--no-ff', '-m', 'merge mc', 'merge-commit');
  g('update-ref', 'refs/remotes/origin/main', g('rev-parse', 'main'));
  // remote-tracking refs and PR refs exist in a real checkout: neither may count by itself
  g('update-ref', 'refs/remotes/origin/orphan', T.orphan);
  g('update-ref', 'refs/pr/14', T.stepB);
  const git = (args, input) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: ENV, input: input === undefined ? '' : input });
  // closed-PR heads, as the tool passes them
  T.closedHeads = [T.squash, T.closed, T.advancedPrHead, T.updatePrHead];
  return { dir, git, T };
}

test('§3 nothing is "preserved" that deleting would make unreachable (real git)', () => {
  const { git, T } = world();
  const u = (tip) => M.unpreservedCommits({ git, tip, defaultBranch: 'main', preservers: T.closedHeads });
  assert.deepEqual(u(T.mergedFf), [], 'fast-forward merged: main holds it');
  assert.deepEqual(u(T.mergeCommit), [], 'merge-commit merged: main holds it');
  assert.deepEqual(u(T.squash), [], 'squash merged: the closed PR head holds it');
  assert.deepEqual(u(T.closed), [], 'closed unmerged: the closed PR head holds it');
  assert.deepEqual(u(T.advanced), [T.advanced], 'a commit pushed after the PR closed is NOT held');
  assert.deepEqual(u(T.updateMerge), [T.updateMerge], 'an update-from-main merge after close is NOT held (strict on purpose)');
  assert.equal(u(T.orphan).length, 2, 'work with no PR is NOT held, even though a remote-tracking ref points at it');
});

test('§3 an OPEN pull request\'s ref is not a keeper (a force-push would move it)', () => {
  const { git, T } = world();
  assert.deepEqual(M.unpreservedCommits({ git, tip: T.stepA, defaultBranch: 'main', preservers: T.closedHeads }), [T.stepA],
    'refs/pr/14 (open) holds step-a today; the tool must not rely on it');
  assert.deepEqual(M.unpreservedCommits({ git, tip: T.stepA, defaultBranch: 'main', preservers: [T.stepB] }), [],
    'control: had that PR been closed, its head would hold step-a');
});

test('§3 the preserver list is what protects the squash/closed cases (control)', () => {
  const { git, T } = world();
  assert.equal(M.unpreservedCommits({ git, tip: T.squash, defaultBranch: 'main', preservers: [] }).length, 2);
  assert.equal(M.unpreservedCommits({ git, tip: T.closed, defaultBranch: 'main', preservers: [] }).length, 1);
});

// ===== §4 run() end to end on a fake GitHub =================================================
const sha = (s) => createHash('sha1').update(s).digest('hex');
const ORIG_BRANCHES = () => [
  { name: 'main', commit: { sha: sha('m0') }, protected: true },
  { name: 'cursor/one', commit: { sha: sha('o1') }, protected: false },
  { name: 'cursor/two', commit: { sha: sha('t1') }, protected: false },
  { name: 'cursor/keep', commit: { sha: sha('k1') }, protected: false },
  { name: 'other/untouched', commit: { sha: sha('u1') }, protected: false },
];
const prRow = (number, state, ref, s, o = {}) => ({ number, state, head: { ref, repo: { full_name: o.headRepo || REPO }, sha: s }, base: { ref: o.base || 'main' } });

function fakeGithub({ extraBranches = [], extraPrs = [], releases = [], hooks = {} } = {}) {
  const S = {
    branches: [...ORIG_BRANCHES(), ...extraBranches],
    prs: [prRow(1, 'closed', 'cursor/one', sha('o1')), prRow(2, 'closed', 'cursor/two', sha('t1')), ...extraPrs],
    releases,
    unpreserved: { 'cursor/one': [], 'cursor/two': [], 'cursor/keep': ['zz'] },
    merged: { 'cursor/one': true },
    extraRefs: [],   // refs/pr lines not backed by a PR, to simulate an incomplete list
    refOverride: {}, // PR number -> sha, to simulate a stale mirror
    deletes: [], pushes: [], calls: [],
  };
  const page = (arr, q) => { const n = Number(/(?:^|&)page=(\d+)/.exec(q)[1]); return arr.slice((n - 1) * 100, n * 100); };
  S.api = (path, method) => {
    S.calls.push([method || 'GET', path]);
    if (path === `repos/${REPO}`) return { default_branch: 'main' };
    let m;
    if ((m = /^repos\/[^/]+\/[^/]+\/branches\?(.*)$/.exec(path))) return page(S.branches, m[1]);
    if (/pulls\?state=open&head=/.test(path)) {
      if (hooks.recheckGarbage) return null;
      return hooks.openHeadAppears && path.includes(encodeURIComponent(`HomeSignalG:${hooks.openHeadAppears}`)) ? [{ number: 99 }] : [];
    }
    if (/pulls\?state=open&base=/.test(path)) return hooks.openBaseAppears && path.endsWith(`base=${encodeURIComponent(hooks.openBaseAppears)}`) ? [{ number: 98 }] : [];
    if ((m = /^repos\/[^/]+\/[^/]+\/pulls\?state=all&(.*)$/.exec(path))) return page(S.prs, m[1]);
    if ((m = /^repos\/[^/]+\/[^/]+\/releases\?(.*)$/.exec(path))) return page(S.releases, m[1]);
    throw new Error('fake github: unexpected ' + path);
  };
  const fail = (stderr) => { const e = new Error('Command failed'); e.stderr = stderr; throw e; };
  S.git = (args, input) => {
    if (args[0] === 'rev-parse') return (hooks.staleCheckout ? sha('OLD') : sha('m0')) + '\n';
    if (args[0] === 'for-each-ref') {
      const lines = S.prs.map((p) => `refs/pr/${p.number} ${S.refOverride[p.number] || p.head.sha}`);
      return [...lines, ...S.extraRefs].join('\n') + '\n';
    }
    if (args[0] === 'rev-list') {
      assert.equal(args[1], '--stdin');
      assert.ok(input === undefined || /^(\^[0-9a-f]{40}\n)*\n?$/.test(input), 'preservers arrive on stdin as ^sha lines');
      const name = S.branches.find((b) => b.commit.sha === args[2])?.name;
      if (!(name in S.unpreserved)) throw new Error('missing object');
      return S.unpreserved[name].join('\n');
    }
    if (args[0] === 'merge-base') {
      const name = S.branches.find((b) => b.commit.sha === args[2])?.name;
      if (!S.merged[name]) fail('');
      return '';
    }
    if (args[0] === 'push') {
      S.pushes.push(args);
      const lease = /^--force-with-lease=refs\/heads\/(.+):([0-9a-f]{40})$/.exec(args[1]);
      assert.ok(lease, 'every delete carries a lease on the planned sha');
      assert.equal(args[3], `:refs/heads/${lease[1]}`);
      const name = lease[1];
      const b = S.branches.find((x) => x.name === name);
      if (hooks.leaseStale === name || !b || b.commit.sha !== lease[2]) fail(` ! [rejected]        ${name} (stale info)\nerror: failed to push some refs`);
      if (hooks.failPush === name) fail('remote: Permission to HomeSignalG/demo.git denied to github-actions[bot].\nfatal: unable to access: The requested URL returned error: 403');
      S.deletes.push(name);
      if (hooks.ghostDelete === name) return '';
      S.branches = S.branches.filter((x) => x.name !== name);
      if (hooks.collateral) S.branches = S.branches.filter((x) => x.name !== hooks.collateral);
      return '';
    }
    throw new Error('unexpected git ' + args.join(' '));
  };
  return S;
}
const ENVV = { GITHUB_REPOSITORY: REPO };
const go = (S, argv = [], env = {}) => {
  const logs = []; const sums = [];
  const r = M.run({ argv, env: { ...ENVV, ...env }, api: S.api, git: S.git, log: (l) => logs.push(l), summary: (s) => sums.push(s) });
  return { r, logs: logs.join('\n'), summary: sums.join('\n') };
};
const fpOf = (S) => go(S, ['--target', 'cursor/']).r.plan.fingerprint;

test('§4 REPORT ONLY deletes nothing and prints a report a human can approve', () => {
  const S = fakeGithub();
  const { r, logs, summary } = go(S, ['--target', 'cursor/']);
  assert.equal(r.exit, 0);
  assert.equal(S.pushes.length, 0);
  assert.deepEqual(r.plan.deletable.map((d) => d.name), ['cursor/one', 'cursor/two']);
  assert.equal(r.plan.fingerprint, M.fingerprint(['cursor/one', 'cursor/two']));
  assert.match(logs, /- `cursor\/one` [0-9a-f]{10} — merged into main/);
  assert.match(logs, /- `cursor\/two` [0-9a-f]{10} — NOT merged; its commits stay in closed PR #2/);
  assert.match(logs, /- `cursor\/keep` — unpreserved-commits:1/);
  assert.match(logs, /2 deletable\*\* \(1 merged into main, 1 kept only by a closed pull request\) \+ \*\*1 held/);
  assert.match(logs, new RegExp(`FINGERPRINT: ${r.plan.fingerprint}`));
  assert.ok(summary.includes(`FINGERPRINT: ${r.plan.fingerprint}`), 'the Summary carries the report');
  assert.match(logs, /REPORT ONLY/);
});

test('§4 a typo in apply never deletes, even with the RIGHT fingerprint pasted', () => {
  for (const v of ['True', 'TRUE', '1', 'yes', 'false', '', ' true']) {
    const S = fakeGithub();
    const fp = fpOf(fakeGithub());
    const { r, logs } = go(S, [], { CLEANUP_TARGET: 'cursor/', CLEANUP_APPLY: v, CLEANUP_EXPECT: fp });
    assert.equal(S.pushes.length, 0, `CLEANUP_APPLY=${JSON.stringify(v)} must not delete`);
    assert.equal(r.exit, 1, 'a pasted fingerprint with apply off is a refusal, not a green run');
    assert.match(logs, /apply" is OFF, so NOTHING WAS DELETED/);
  }
});

test('§4 refusals about the fingerprint never repeat it', () => {
  const fp = fpOf(fakeGithub());
  const cases = [
    ['', /apply needs the fingerprint from a report run/],
    [`FINGERPRINT: ${fp}`, /exactly the 16 characters/],
    [fp.toUpperCase(), /exactly the 16 characters/],
    [fp.slice(0, 15), /exactly the 16 characters/],
    ['0000000000000000', /does not match this run/],
  ];
  for (const [expect, why] of cases) {
    const S = fakeGithub();
    const { r, logs } = go(S, ['--target', 'cursor/', '--apply', '--expect', expect]);
    assert.equal(r.exit, 1, `expect=${JSON.stringify(expect)}`);
    assert.equal(S.pushes.length, 0);
    assert.match(logs, why);
    const refusal = logs.split('\n').filter((l) => l.startsWith('REFUSED'));
    assert.equal(refusal.length, 1);
    assert.ok(!refusal[0].includes(fp), 'the refusal does not hand out the fingerprint');
  }
});

test('§4 apply with the right fingerprint deletes exactly the plan, by lease, and logs each delete', () => {
  const S = fakeGithub();
  const fp = fpOf(fakeGithub());
  const { r, logs, summary } = go(S, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.equal(r.exit, 0, logs);
  assert.deepEqual(S.deletes.sort(), ['cursor/one', 'cursor/two']);
  assert.deepEqual(S.pushes.map((p) => p[1]).sort(), [`--force-with-lease=refs/heads/cursor/one:${sha('o1')}`, `--force-with-lease=refs/heads/cursor/two:${sha('t1')}`]);
  assert.deepEqual(S.branches.map((b) => b.name).sort(), ['cursor/keep', 'main', 'other/untouched']);
  assert.match(logs, new RegExp(`DELETED cursor/one \\(was ${sha('o1')}\\)`));
  assert.match(logs, /APPLIED: deleted 2 · skipped 0 · failed 0/);
  assert.match(summary, /## Apply result/);
});

test('§4 the population changing between report and apply refuses', () => {
  const fp = fpOf(fakeGithub());
  const S = fakeGithub({ extraBranches: [{ name: 'cursor/new-arrival', commit: { sha: sha('n1') }, protected: false }] });
  S.unpreserved['cursor/new-arrival'] = [];
  const { r } = go(S, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.equal(r.exit, 1);
  assert.equal(S.pushes.length, 0);
});

test('§4 a commit pushed after the report makes the lease fail: SKIPPED, not deleted, not failed', () => {
  const fp = fpOf(fakeGithub());
  const S = fakeGithub({ hooks: { leaseStale: 'cursor/one' } });
  const { r, logs } = go(S, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.deepEqual(S.deletes, ['cursor/two']);
  assert.match(logs, /SKIPPED cursor\/one: tip moved since the report \(lease refused\)/);
  assert.equal(r.failed.length, 0);
  assert.equal(r.exit, 0);
});

test('§4 last-moment re-checks: a new open PR (head OR base), or an unreadable answer, skips', () => {
  const fp = fpOf(fakeGithub());
  const A = fakeGithub({ hooks: { openHeadAppears: 'cursor/one' } });
  assert.match(go(A, ['--target', 'cursor/', '--apply', '--expect', fp]).logs, /SKIPPED cursor\/one: open PR #99 now has it as head/);
  assert.deepEqual(A.deletes, ['cursor/two']);
  const B = fakeGithub({ hooks: { openBaseAppears: 'cursor/two' } });
  assert.match(go(B, ['--target', 'cursor/', '--apply', '--expect', fp]).logs, /SKIPPED cursor\/two: open PR #98 now has it as base/);
  assert.deepEqual(B.deletes, ['cursor/one']);
  const C = fakeGithub({ hooks: { recheckGarbage: true } });
  assert.match(go(C, ['--target', 'cursor/', '--apply', '--expect', fp]).logs, /SKIPPED cursor\/one: could not read open pull requests/);
  assert.equal(C.deletes.length, 0, 'cannot tell => skip');
});

test('§4 a failed delete says WHY, does not stop the others, and fails the run', () => {
  const fp = fpOf(fakeGithub());
  const F = fakeGithub({ hooks: { failPush: 'cursor/one' } });
  const f = go(F, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.equal(f.r.exit, 1);
  assert.match(f.logs, /FAILED {2}cursor\/one: fatal: unable to access: The requested URL returned error: 403/);
  assert.deepEqual(F.deletes, ['cursor/two']);
});

test('§4 verification by re-listing catches a delete that did not take, and a collateral loss', () => {
  const fp = fpOf(fakeGithub());
  const G = fakeGithub({ hooks: { ghostDelete: 'cursor/one' } });
  const g = go(G, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.equal(g.r.exit, 1);
  assert.match(g.logs, /VERIFY FAILED: still present after delete: cursor\/one/);
  const C = fakeGithub({ hooks: { collateral: 'other/untouched' } });
  const c = go(C, ['--target', 'cursor/', '--apply', '--expect', fp]);
  assert.equal(c.r.exit, 1);
  assert.match(c.logs, /gone but not deleted by this run: other\/untouched/);
});

test('§4 the inputs are checked: an incomplete PR list or a stale ref mirror refuses the run', () => {
  const inc = fakeGithub(); inc.extraRefs.push(`refs/pr/77 ${sha('x77')}`);
  assert.match(go(inc, ['--target', 'cursor/']).logs, /REFUSED: the pull-request list is incomplete: 1 mirrored refs \(first refs\/pr\/77\)/);
  const stale = fakeGithub(); stale.refOverride[2] = sha('old head');
  assert.match(go(stale, ['--target', 'cursor/']).logs, /REFUSED: the pull-request ref mirror is stale: refs\/pr\/2/);
  const open = fakeGithub({ extraPrs: [prRow(3, 'open', 'cursor/elsewhere', sha('e1'))] }); open.refOverride[3] = sha('moved');
  assert.equal(go(open, ['--target', 'cursor/']).r.exit, 0, 'control: an OPEN PR\'s ref may move; it is never a keeper, so no refusal');
});

test('§4 refuses a broken read rather than deciding on it', () => {
  const noPrRefs = fakeGithub(); const g0 = noPrRefs.git; noPrRefs.git = (a, i) => (a[0] === 'for-each-ref' ? '' : g0(a, i));
  assert.match(go(noPrRefs, ['--target', 'cursor/']).logs, /REFUSED: no pull-request refs/);
  const noPrs = fakeGithub(); noPrs.prs = []; noPrs.extraRefs.push(`refs/pr/1 ${sha('o1')}`);
  assert.match(go(noPrs, ['--target', 'cursor/']).logs, /REFUSED: pull-request read returned nothing/);
  assert.match(go(fakeGithub({ hooks: { staleCheckout: true } }), ['--target', 'cursor/']).logs, /REFUSED: checkout is stale/);
  assert.match(go(fakeGithub(), ['--target', 'main']).logs, /REFUSED: target is the default branch/);
  assert.match(go(fakeGithub(), ['--target', 'cursor']).logs, /REFUSED: target "cursor" matched no branch/);
  assert.equal(go(fakeGithub(), ['--target', 'cursor/']).r.exit, 0, 'control: the correctly spelled target is not refused');
  assert.equal(M.run({ argv: [], env: {}, api: () => ({}), git: () => '', log() {} }).exit, 1, 'no GITHUB_REPOSITORY');
});

test('§4 a branch git cannot measure is HELD at run level (cannot tell is never deletable)', () => {
  const S = fakeGithub({ extraBranches: [{ name: 'cursor/no-object', commit: { sha: sha('gone') }, protected: false }] });
  // no unpreserved entry: the fake rev-list throws "missing object" for it
  const { r } = go(S, ['--target', 'cursor/']);
  assert.deepEqual(r.plan.held.find((h) => h.name === 'cursor/no-object').reasons, ['preservation-unknown']);
});

test('§4 open-PR, fork-base, protected and release holds come through run() end to end', () => {
  const extraBranches = [
    { name: 'cursor/has-open-pr', commit: { sha: sha('h1') }, protected: false },
    { name: 'cursor/fork-target', commit: { sha: sha('f1') }, protected: false },
    { name: 'cursor/locked', commit: { sha: sha('p1') }, protected: true },
    { name: 'cursor/released', commit: { sha: sha('r1') }, protected: false },
  ];
  const extraPrs = [
    prRow(3, 'open', 'cursor/has-open-pr', sha('h1')),
    prRow(4, 'open', 'patch-1', sha('fk'), { headRepo: 'stranger/demo', base: 'cursor/fork-target' }),
  ];
  const S = fakeGithub({ extraBranches, extraPrs, releases: [{ id: 1, tag_name: 'v9', target_commitish: 'cursor/released' }] });
  for (const b of extraBranches) S.unpreserved[b.name] = [];
  const why = Object.fromEntries(go(S, ['--target', 'cursor/']).r.plan.held.map((h) => [h.name, h.reasons.join('|')]));
  assert.equal(why['cursor/has-open-pr'], 'open-pr-head:#3');
  assert.equal(why['cursor/fork-target'], 'open-pr-base:#4');
  assert.equal(why['cursor/locked'], 'protected');
  assert.equal(why['cursor/released'], 'release-target:v9');
});

test('§4 pagination: 250 branches and 250 PRs are all read; an open PR on page 3 still holds', () => {
  const extraBranches = Array.from({ length: 250 }, (_, i) => ({ name: `cursor/bulk-${String(i).padStart(3, '0')}`, commit: { sha: sha(`b${i}`) }, protected: false }));
  const extraPrs = Array.from({ length: 250 }, (_, i) => prRow(100 + i, 'closed', `old/${i}`, sha(`p${i}`)));
  extraPrs[249] = prRow(349, 'open', 'cursor/bulk-249', sha('b249'));
  const S = fakeGithub({ extraBranches, extraPrs });
  for (const e of extraBranches) S.unpreserved[e.name] = [];
  const { r } = go(S, ['--target', 'cursor/']);
  assert.equal(r.plan.targeted, 253, 'one, two, keep + 250: a 100-row page limit would hide most of them');
  assert.deepEqual(r.plan.held.find((h) => h.name === 'cursor/bulk-249').reasons, ['open-pr-head:#349'], 'the PR on page 3 was read');
  const S2 = fakeGithub({ extraBranches, extraPrs });
  for (const e of extraBranches) S2.unpreserved[e.name] = [];
  const big = go(S2, ['--target', 'cursor/', '--apply', '--expect', r.plan.fingerprint]);
  assert.equal(big.r.exit, 1);
  assert.match(big.logs, /exceeds the ceiling/);
  assert.equal(S2.pushes.length, 0);
});

// ===== §5 the command line ===================================================================
test('§5 run as a command, the refusal exit code reaches the shell (also through a symlink)', () => {
  const env = { ...process.env, GITHUB_REPOSITORY: '', GITHUB_STEP_SUMMARY: '', CLEANUP_APPLY: '', CLEANUP_EXPECT: '', CLEANUP_TARGET: '' };
  const direct = spawnSync(process.execPath, [SCRIPT_PATH, '--target', 'cursor/'], { encoding: 'utf8', env });
  assert.equal(direct.status, 1, direct.stderr);
  assert.match(direct.stdout, /REFUSED: GITHUB_REPOSITORY is not owner\/repo/);
  const dir = mkdtempSync(join(tmpdir(), 'bc-link-'));
  const link = join(dir, 'linked.mjs');
  symlinkSync(SCRIPT_PATH, link);
  const viaLink = spawnSync(process.execPath, [link, '--target', 'cursor/'], { encoding: 'utf8', env });
  assert.equal(viaLink.status, 1, 'through a symlink the tool still runs; it must not exit 0 having done nothing');
  assert.match(viaLink.stdout, /REFUSED/);
});

// ===== §6 the workflow file ==================================================================
const WF = readFileSync(WORKFLOW, 'utf8');
const WFC = WF.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const block = (start, end) => WFC.slice(WFC.indexOf(start), WFC.indexOf(end, WFC.indexOf(start) + 1));

test('§6 dispatch-only: workflow_dispatch is the ONLY trigger', () => {
  const on = block('\non:', '\npermissions:');
  const keys = on.split('\n').filter((l) => /^ {2}[a-z_]+:/.test(l)).map((l) => l.trim().replace(/:.*$/, ''));
  assert.deepEqual(keys, ['workflow_dispatch']);
});

test('§6 apply defaults to false and the inputs exist', () => {
  assert.match(WFC, /apply:\n\s+description: [^\n]+\n\s+type: boolean\n\s+required: false\n\s+default: false\n/);
  assert.match(WFC, /expected_fingerprint:\n/);
  assert.match(WFC, /target:\n\s+description: [^\n]+\n\s+required: false\n\s+default: 'cursor\/'\n/);
});

test('§6 least privilege, no secrets, one run at a time', () => {
  const perms = block('\npermissions:', '\nconcurrency:');
  assert.deepEqual(perms.split('\n').map((l) => l.trim()).filter(Boolean), ['permissions:', 'contents: write', 'pull-requests: read']);
  assert.ok(!/secrets\./.test(WFC), 'uses the run\'s own token only');
  assert.match(WFC, /\n\s+GH_TOKEN: \$\{\{ github\.token \}\}\n/);
  assert.match(WFC, /concurrency:\n\s+group: cleanup-branches\n\s+cancel-in-progress: false\n/);
});

test('§6 the main-only guard, the suite gate and the tool step are exactly what they claim', () => {
  const guard = /\n\s+if \[ "\$GITHUB_REF" != "refs\/heads\/main" \]; then\n[^\n]*\n\s+exit 1\n\s+fi\n/;
  assert.match(WFC, guard, 'the guard compares GITHUB_REF to main and exits 1');
  const iGuard = WFC.search(guard);
  const iCheckout = WFC.indexOf('uses: actions/checkout@');
  const iSuite = WFC.indexOf(`run: node --test ${SELF_REL}\n`);
  const iMirror = WFC.indexOf(`run: git fetch --no-tags origin '+refs/pull/*/head:refs/pr/*'\n`);
  const iTool = WFC.indexOf(`run: node scripts/${basename(SCRIPT_PATH)}\n`);
  assert.ok(iGuard > 0 && iGuard < iCheckout, 'guard before checkout');
  assert.ok(iSuite > iCheckout, `this very suite (${SELF_REL}) gates the run`);
  assert.ok(iMirror > iSuite && iTool > iMirror, 'PR refs mirrored before the tool runs, and the tool takes no extra flags');
  assert.match(WFC, /fetch-depth: 0\n/);
});

test('§6 inputs reach the script only through env, never interpolated into shell', () => {
  const lines = WFC.split('\n').filter((l) => l.includes('github.event.inputs'));
  assert.deepEqual(lines.map((l) => l.trim()).sort(), [
    'CLEANUP_APPLY: ${{ github.event.inputs.apply }}',
    'CLEANUP_EXPECT: ${{ github.event.inputs.expected_fingerprint }}',
    'CLEANUP_TARGET: ${{ github.event.inputs.target }}',
  ]);
});
