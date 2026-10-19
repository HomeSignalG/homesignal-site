#!/usr/bin/env node
// Delete branches that are FINISHED WITH — never one that still carries work.
//
// REPORT ONLY unless --apply (or CLEANUP_APPLY=true) AND the fingerprint the report printed is
// handed back (--expect / CLEANUP_EXPECT). Refusals never repeat the fingerprint, so the only
// place to get it is the report itself.
//
// MIRROR: this file is byte-identical in homesignal-site (scripts/cleanup-branches.mjs) and
// homesignal-ingest (scripts/cleanup_branches.mjs). It is a TOOL, not a truth decision, so a
// second copy is the lesser evil next to a cross-repo token. Each repo's test pins this file's
// sha256: that catches an accidental edit in ONE repo; it cannot see the other repo, so keep
// the two pins equal by hand when you change it.
//
// WHY A WORKFLOW AT ALL. The sandbox's GitHub proxy refuses branch deletion, and the GitHub
// web UI has no multi-select: 134 leftover `cursor/` branches would be 134 separate clicks.
// A runner's own GITHUB_TOKEN may delete refs in its own repo; no secret is involved.
//
// THE RULE IS COMPUTED, NEVER TRANSCRIBED (CLAUDE.md rule 7). There is no list of branch
// names in this file. A branch under the target is DELETABLE only when ALL of these hold:
//   1. it is not the default branch and not protected;
//   2. no OPEN pull request has it as its head (deleting the head closes that PR);
//   3. no OPEN pull request has it as its base, fork PRs included (same reason);
//   4. no release names it as its target branch;
//   5. its name is plain ASCII path text (anything odd is held, not escaped);
//   6. EVERY commit on it is reachable from the default branch or from the head of a CLOSED
//      pull request. That is the data-loss test: after deletion nothing becomes unreachable.
//      An OPEN pull request's ref does not count, because a force-push moves it. A squash-
//      merged or closed-unmerged branch passes through its own closed PR's ref; a branch with
//      no PR and commits main lacks FAILS.
// Anything that fails is HELD with its reasons printed. "Cannot tell" is HELD, never deleted.
//
// THE CONTROLS ON THE INPUTS: every mirrored refs/pr/<N> must be in the PR list read from the
// API (else the list is incomplete), and every CLOSED PR's mirrored ref must equal the head
// sha the API reports (else the mirror is stale). Either failure refuses the whole run.
//
// THE DELETE IS ATOMIC. It is a `git push --force-with-lease=refs/heads/<name>:<planned sha>`
// of an empty ref, so it succeeds only if the branch still points where the report saw it. A
// commit pushed after the report makes the lease fail and the branch is SKIPPED. Just before
// each delete the open-PR checks (head and base) are repeated; an unreadable answer skips.
//
// STRICT ON PURPOSE: a branch updated after its PR closed (e.g. "Merge branch 'main' into …")
// has a tip that no closed PR holds, so it is HELD even if that merge is its only extra commit.
//
// NOT CONSULTED: GitHub environments, deployment branch policies and anything else outside
// git, branches and pull requests. The main-only guard in the workflow stops accidents; it is
// not a security boundary (a branch could edit its own copy of the workflow).
//
// WHAT RESTORING LOOKS LIKE. A pull request page keeps a "Restore branch" button after the
// head branch is deleted, and refs/pull/N/head keeps the commits regardless.
import { execFileSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MAX_DELETE = 200;           // blast-radius ceiling; the fingerprint is the real guard
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;
const FP_SHAPE = /^[0-9a-f]{16}$/;

// ---------------------------------------------------------------------------------------
// target: a PREFIX ending in "/" (everything under it) or ONE exact branch name. No globs, no
// trimming — " cursor/" is refused rather than quietly fixed, because a target that was
// silently rewritten is a target nobody typed.
export function parseTarget(raw) {
  if (typeof raw !== 'string' || !PLAIN.test(raw)) {
    throw new Error(`refusing target ${JSON.stringify(raw)}: plain branch-name characters only`);
  }
  if (raw.length < 4) throw new Error(`refusing target ${JSON.stringify(raw)}: too short to be a scope`);
  if (raw.includes('..') || raw.includes('//')) throw new Error(`refusing target ${JSON.stringify(raw)}`);
  return raw.endsWith('/') ? { kind: 'prefix', value: raw } : { kind: 'exact', value: raw };
}

const matches = (t, name) => (t.kind === 'prefix' ? name.startsWith(t.value) : name === t.value);
const plainName = (n) => PLAIN.test(n) && !n.includes('..') && !n.includes('//') && !n.endsWith('/') && !n.endsWith('.lock');

// Collation-free by construction: names are hashed after a plain code-unit sort, in this
// process, on both sides of every comparison (rule 9 concerns a DB sorting against a
// different sorter; there is no second sorter here).
export function fingerprint(names) {
  return createHash('sha256').update([...names].sort().join('\n')).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------------------
// PURE decision. `unpreserved` maps branch -> array of commit shas that neither the default
// branch nor any closed PR holds. A branch ABSENT from the map (or null) means "could not be
// measured" and is HELD. `merged` (branch -> bool) and `releaseTargets` (branch -> [tags])
// are optional.
export function selectDeletable({ repo, target, defaultBranch, branches, prs, unpreserved, merged, releaseTargets }) {
  const t = typeof target === 'string' ? parseTarget(target) : target;
  const me = String(repo).toLowerCase();
  const names = new Set(branches.map((b) => b.name));
  if (!names.has(defaultBranch)) throw new Error(`branch list does not contain the default branch ${defaultBranch}`);

  const push = (m, k, v) => m.set(k, [...(m.get(k) || []), v]);
  const headPrs = new Map();   // same-repo head -> [numbers], any state (for the report)
  const openHead = new Map();
  const openBase = new Map();
  for (const p of prs) {
    // A fork's branch of the same NAME is a different branch: only same-repo heads count.
    if (String(p.head_repo || '').toLowerCase() === me) {
      push(headPrs, p.head_ref, p.number);
      if (p.state === 'open') push(openHead, p.head_ref, p.number);
    }
    // The base is always a branch of THIS repo, whoever opened the PR (forks included).
    if (p.state === 'open' && p.base_ref) push(openBase, p.base_ref, p.number);
  }

  const targeted = branches.filter((b) => matches(t, b.name));
  const deletable = [];
  const held = [];
  for (const b of targeted) {
    const reasons = [];
    if (b.name === defaultBranch) reasons.push('default-branch');
    if (b.protected) reasons.push('protected');
    if (!plainName(b.name)) reasons.push('unusual-name');
    if (openHead.has(b.name)) reasons.push(`open-pr-head:#${openHead.get(b.name).join(',#')}`);
    if (openBase.has(b.name)) reasons.push(`open-pr-base:#${openBase.get(b.name).join(',#')}`);
    const rel = releaseTargets ? releaseTargets.get(b.name) : undefined;
    if (rel && rel.length) reasons.push(`release-target:${rel.join(',')}`);
    const u = unpreserved ? unpreserved.get(b.name) : undefined;
    if (u === undefined || u === null) reasons.push('preservation-unknown');
    else if (u.length > 0) reasons.push(`unpreserved-commits:${u.length}`);
    const row = { name: b.name, sha: b.sha, prs: headPrs.get(b.name) || [], merged: !!(merged && merged.get(b.name)) };
    if (reasons.length) held.push({ ...row, reasons });
    else deletable.push(row);
  }
  // Every targeted branch lands in exactly one of the two lists (the loop above has no other
  // exit); the tests pin targeted = deletable + held so a change that drops one fails there.
  const byName = (a, c) => (a.name < c.name ? -1 : a.name > c.name ? 1 : 0);
  deletable.sort(byName);
  held.sort(byName);
  return {
    target: t,
    targeted: targeted.length,
    deletable,
    held,
    fingerprint: fingerprint(deletable.map((d) => d.name)),
  };
}

// Commits on `tip` reachable from neither the default branch nor any preserver sha (the heads
// of CLOSED pull requests). Empty array = deleting the branch makes nothing unreachable.
// Preservers go through stdin as ^<sha> lines: --not does not reach revisions read by --stdin.
export function unpreservedCommits({ git, tip, defaultBranch, preservers = [] }) {
  const input = preservers.map((s) => `^${s}`).join('\n') + '\n';
  const out = git(['rev-list', '--stdin', tip, `^origin/${defaultBranch}`], input);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------------------
export function listAll(api, path) {
  const items = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= 100; page++) {
    const chunk = api(`${path}${sep}per_page=100&page=${page}`);
    if (!Array.isArray(chunk)) throw new Error(`expected a list from ${path}`);
    items.push(...chunk);
    if (chunk.length < 100) return items;
  }
  throw new Error(`more than 100 pages from ${path}: refusing to guess`);
}

// The last line of an error's stderr (or message): what GitHub or git actually said.
export function errText(e) {
  const raw = String((e && e.stderr && e.stderr.toString()) || (e && e.message) || e || '');
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  return (lines[lines.length - 1] || 'unknown error').slice(0, 300);
}

function parseArgs(argv, env) {
  const o = {
    target: env.CLEANUP_TARGET ?? 'cursor/',
    apply: env.CLEANUP_APPLY === 'true',   // only the literal string: a typo REPORTS, never deletes
    expect: env.CLEANUP_EXPECT ?? '',
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') o.apply = true;
    else if (argv[i] === '--target') o.target = argv[++i];
    else if (argv[i] === '--expect') o.expect = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  o.expect = String(o.expect || '').trim();
  return o;
}

export function run({ argv = [], env = {}, api, git, log = console.log, summary = () => {} }) {
  const refuse = (msg) => {
    log(`REFUSED: ${msg}`);
    summary(`## Refused — nothing was deleted\n\n${msg}\n`);
    return { exit: 1, refused: msg, deleted: [], skipped: [], failed: [] };
  };
  let opts;
  let t;
  try {
    opts = parseArgs(argv, env);
    t = parseTarget(opts.target);
  } catch (e) {
    return refuse(e.message);
  }
  // The second run's two inputs, checked before anything is read. None of these messages
  // repeats a fingerprint: the report is the only place to get one.
  if (!opts.apply && opts.expect) {
    return refuse('You pasted a fingerprint but "apply" is OFF, so NOTHING WAS DELETED. Run again with apply ticked.');
  }
  if (opts.apply && !opts.expect) {
    return refuse('apply needs the fingerprint from a report run. Run with apply OFF first, open that run\'s Summary, and copy the 16 characters after FINGERPRINT:.');
  }
  if (opts.apply && !FP_SHAPE.test(opts.expect)) {
    return refuse(`expected_fingerprint must be exactly the 16 characters after "FINGERPRINT:" (lowercase letters a-f and digits). You pasted ${opts.expect.length} characters.`);
  }

  const repo = env.GITHUB_REPOSITORY || '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return refuse(`GITHUB_REPOSITORY is not owner/repo: ${JSON.stringify(repo)}`);
  const owner = repo.split('/')[0];

  const meta = api(`repos/${repo}`);
  const defaultBranch = meta && meta.default_branch;
  if (!defaultBranch) return refuse('could not read the default branch');
  if (t.kind === 'exact' && t.value === defaultBranch) return refuse(`target is the default branch ${defaultBranch}`);

  const branches = listAll(api, `repos/${repo}/branches`).map((b) => ({
    name: b.name,
    sha: b.commit && b.commit.sha,
    protected: !!b.protected,
  }));
  const defRow = branches.find((b) => b.name === defaultBranch);
  if (!defRow) return refuse(`branch read is incomplete: ${branches.length} branches and no ${defaultBranch}`);

  // CONTROLS, so a broken read cannot masquerade as "nothing to protect".
  const localDefault = git(['rev-parse', `origin/${defaultBranch}`]).trim();
  if (localDefault !== defRow.sha) {
    return refuse(`checkout is stale: origin/${defaultBranch} is ${localDefault.slice(0, 10)} here, ${String(defRow.sha).slice(0, 10)} on GitHub. Run again.`);
  }
  const prRefs = new Map();   // PR number -> sha of the mirrored refs/pr/<N>
  for (const line of git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/pr/']).split('\n')) {
    const m = /^refs\/pr\/(\d+) ([0-9a-f]{40})$/.exec(line.trim());
    if (m) prRefs.set(Number(m[1]), m[2]);
  }
  if (prRefs.size === 0) return refuse('no pull-request refs were fetched (refs/pr/*); without them nothing can be proven preserved');

  const prs = listAll(api, `repos/${repo}/pulls?state=all`).map((p) => ({
    number: p.number,
    state: p.state,
    head_ref: p.head && p.head.ref,
    head_repo: (p.head && p.head.repo && p.head.repo.full_name) || '',
    head_sha: p.head && p.head.sha,
    base_ref: p.base && p.base.ref,
  }));
  if (prs.length === 0) return refuse('pull-request read returned nothing; refusing to decide without it');
  const prByNumber = new Map(prs.map((p) => [p.number, p]));
  const missingFromList = [...prRefs.keys()].filter((n) => !prByNumber.has(n));
  if (missingFromList.length) {
    return refuse(`the pull-request list is incomplete: ${missingFromList.length} mirrored refs (first refs/pr/${missingFromList[0]}) have no PR in it. Run again.`);
  }
  const preservers = [];
  let closedWithoutRef = 0;
  for (const p of prs) {
    if (p.state !== 'closed') continue;   // an OPEN PR's ref moves on force-push: never a preserver
    const local = prRefs.get(p.number);
    if (!local) { closedWithoutRef++; continue; }
    if (local !== p.head_sha) {
      return refuse(`the pull-request ref mirror is stale: refs/pr/${p.number} is ${local.slice(0, 10)} here, ${String(p.head_sha).slice(0, 10)} on GitHub. Run again.`);
    }
    preservers.push(local);
  }

  const releaseTargets = new Map();
  for (const r of listAll(api, `repos/${repo}/releases`)) {
    if (r && r.target_commitish) {
      releaseTargets.set(r.target_commitish, [...(releaseTargets.get(r.target_commitish) || []), r.tag_name || `id ${r.id}`]);
    }
  }

  const unpreserved = new Map();
  const merged = new Map();
  for (const b of branches.filter((x) => matches(t, x.name))) {
    try {
      unpreserved.set(b.name, unpreservedCommits({ git, tip: b.sha, defaultBranch, preservers }));
    } catch (_) {
      unpreserved.set(b.name, null);   // object missing locally => cannot tell => HELD
    }
    try {
      git(['merge-base', '--is-ancestor', b.sha, `origin/${defaultBranch}`]);
      merged.set(b.name, true);
    } catch (_) {
      merged.set(b.name, false);
    }
  }
  const plan = selectDeletable({ repo, target: t, defaultBranch, branches, prs, unpreserved, merged, releaseTargets });
  // A target that matches NOTHING is indistinguishable from a clean result unless it is
  // refused: "cursor" (no slash) is a valid exact name that no branch has.
  if (plan.targeted === 0) {
    return refuse(`target ${JSON.stringify(opts.target)} matched no branch (of ${branches.length}). A prefix must end in "/"; check for a typo.`);
  }

  // ----- the report -----------------------------------------------------------------
  const nMerged = plan.deletable.filter((d) => d.merged).length;
  const lines = [];
  lines.push(`# Branch cleanup report: ${repo}  target ${t.kind === 'prefix' ? t.value + '*' : t.value}`);
  lines.push('');
  lines.push(`default branch ${defaultBranch} · ${branches.length} branches · ${prs.length} pull requests read · ${prRefs.size} PR refs mirrored · ${preservers.length} closed-PR heads count as keepers${closedWithoutRef ? ` (${closedWithoutRef} closed PRs had no ref)` : ''}`);
  lines.push(`targeted ${plan.targeted} = **${plan.deletable.length} deletable** (${nMerged} merged into ${defaultBranch}, ${plan.deletable.length - nMerged} kept only by a closed pull request) + **${plan.held.length} held**`);
  lines.push('');
  if (plan.held.length) {
    lines.push('## HELD (will not be touched)');
    for (const h of plan.held) lines.push(`- \`${h.name}\` — ${h.reasons.join(' · ')}${h.prs.length ? ` (PRs #${h.prs.join(', #')})` : ''}`);
    lines.push('');
  }
  lines.push('## DELETABLE');
  for (const d of plan.deletable) {
    const how = d.merged ? `merged into ${defaultBranch}` : `NOT merged; its commits stay in closed PR #${d.prs.join(', #')}`;
    lines.push(`- \`${d.name}\` ${String(d.sha).slice(0, 10)} — ${how}`);
  }
  lines.push('');
  lines.push(`FINGERPRINT: ${plan.fingerprint}`);
  const report = lines.join('\n');
  log(report);
  summary(report + '\n');

  if (!opts.apply) {
    const how = plan.deletable.length
      ? `REPORT ONLY — nothing deleted. To delete exactly these ${plan.deletable.length}: run again with apply ticked and the FINGERPRINT above in expected_fingerprint.`
      : 'REPORT ONLY — nothing is deletable.';
    log(how);
    summary(`\n**${how}**\n`);
    return { exit: 0, plan, deleted: [], skipped: [], failed: [] };
  }

  // ----- apply ----------------------------------------------------------------------
  if (plan.deletable.length === 0) {
    log('APPLY: nothing deletable, nothing deleted.');
    summary('\n**APPLY: nothing deletable, nothing deleted.**\n');
    return { exit: 0, plan, deleted: [], skipped: [], failed: [] };
  }
  if (opts.expect !== plan.fingerprint) {
    return refuse('expected_fingerprint does not match this run: the list changed since that report, or the fingerprint came from another repo or target. Run the report again and use its fingerprint.');
  }
  if (plan.deletable.length > MAX_DELETE) return refuse(`${plan.deletable.length} exceeds the ceiling of ${MAX_DELETE}`);

  const before = branches.map((b) => b.name);
  const deleted = [];
  const skipped = [];
  const failed = [];
  const enc = (n) => encodeURIComponent(n);
  for (const b of plan.deletable) {
    try {
      // The report is minutes old: repeat the open-PR checks. Anything unreadable skips.
      const asHead = api(`repos/${repo}/pulls?state=open&head=${enc(`${owner}:${b.name}`)}`);
      const asBase = api(`repos/${repo}/pulls?state=open&base=${enc(b.name)}`);
      if (!Array.isArray(asHead) || !Array.isArray(asBase)) { skipped.push([b.name, 'could not read open pull requests']); continue; }
      if (asHead.length) { skipped.push([b.name, `open PR #${asHead[0].number} now has it as head`]); continue; }
      if (asBase.length) { skipped.push([b.name, `open PR #${asBase[0].number} now has it as base`]); continue; }
    } catch (e) {
      skipped.push([b.name, `could not read open pull requests: ${errText(e)}`]);
      continue;
    }
    try {
      // Atomic: succeeds only if the branch still points at the planned sha.
      git(['push', `--force-with-lease=refs/heads/${b.name}:${b.sha}`, 'origin', `:refs/heads/${b.name}`]);
      deleted.push(b.name);
      log(`DELETED ${b.name} (was ${b.sha})`);   // logged at once, so a crash still leaves a record
    } catch (e) {
      const all = String((e && e.stderr && e.stderr.toString()) || (e && e.message) || '');
      if (/stale info|fetch first|non-fast-forward/i.test(all)) skipped.push([b.name, 'tip moved since the report (lease refused)']);
      else failed.push([b.name, errText(e)]);
    }
  }

  // Verify by RE-READING, never by trusting the delete responses.
  const afterSet = new Set(listAll(api, `repos/${repo}/branches`).map((b) => b.name));
  const deletedSet = new Set(deleted);
  const stillThere = deleted.filter((n) => afterSet.has(n));
  const collateral = before.filter((n) => !afterSet.has(n) && !deletedSet.has(n));
  const out = [];
  out.push(`APPLIED: deleted ${deleted.length} · skipped ${skipped.length} · failed ${failed.length}`);
  for (const [n, why] of skipped) out.push(`  SKIPPED ${n}: ${why}`);
  for (const [n, why] of failed) out.push(`  FAILED  ${n}: ${why}`);
  if (skipped.length) out.push('  Skipped branches were left alone. Run the report again to see them.');
  if (stillThere.length) out.push(`  VERIFY FAILED: still present after delete: ${stillThere.join(', ')}`);
  if (collateral.length) out.push(`  VERIFY FAILED: gone but not deleted by this run: ${collateral.join(', ')}`);
  const restore = plan.deletable.filter((d) => deletedSet.has(d.name) && d.prs.length);
  if (restore.length) out.push(`  Restore any of them from its pull request page (${restore.length} have one).`);
  log(out.join('\n'));
  summary('\n## Apply result\n\n' + out.map((l) => l.trim()).join('\n\n') + '\n');
  const bad = failed.length || stillThere.length || collateral.length;
  return { exit: bad ? 1 : 0, plan, deleted, skipped, failed, stillThere, collateral };
}

// ---------------------------------------------------------------------------------------
export function ghApi(path, method) {
  const args = ['api', path];
  if (method && method !== 'GET') args.push('-X', method);
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = out.trim();
  return s ? JSON.parse(s) : null;
}
const realGit = (args, input) => execFileSync('git', args, {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  input: input === undefined ? '' : input,
  stdio: ['pipe', 'pipe', 'pipe'],
});

// Compare REAL paths: Node resolves the main module through symlinks, argv[1] does not, so a
// plain URL comparison silently skips main (exit 0, nothing done) under a symlinked path.
function invokedAsCli() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch (_) {
    return false;
  }
}

if (invokedAsCli()) {
  const res = run({
    argv: process.argv.slice(2),
    env: process.env,
    api: ghApi,
    git: realGit,
    summary: (md) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); },
  });
  process.exitCode = res.exit;
}
