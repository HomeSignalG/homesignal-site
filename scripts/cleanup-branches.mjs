#!/usr/bin/env node
// Delete branches that are FINISHED WITH — never one that still carries work.
//
// REPORT ONLY unless --apply (or CLEANUP_APPLY=true) AND the fingerprint the report printed is
// handed back (--expect / CLEANUP_EXPECT). A report that nobody has read cannot be applied.
//
// MIRROR: this file is byte-identical in homesignal-site (scripts/cleanup-branches.mjs) and
// homesignal-ingest (scripts/cleanup_branches.mjs). It is a TOOL, not a truth decision, so a
// second copy is the lesser evil next to a cross-repo token — but an edit here is an edit
// there, and each repo's test pins this file's sha256 so a one-sided edit fails loudly.
//
// WHY A WORKFLOW AT ALL. The sandbox's GitHub proxy refuses branch deletion, and the GitHub
// web UI has no multi-select: 134 leftover `cursor/` branches would be 134 separate clicks.
// A runner's own GITHUB_TOKEN may delete refs in its own repo; no secret is involved.
//
// THE RULE IS COMPUTED, NEVER TRANSCRIBED (CLAUDE.md rule 7). There is no list of branch
// names in this file. A branch under the target is DELETABLE only when ALL of these hold:
//   1. it is not the default branch and not protected;
//   2. no OPEN pull request has it as its head (deleting the head closes that PR);
//   3. no OPEN pull request has it as its base (deleting the base closes that PR);
//   4. its name is plain ASCII path text (anything odd is held, not escaped);
//   5. EVERY commit on it is reachable from the default branch or from some pull request's
//      ref (refs/pull/N/head). That is the data-loss test: after deletion nothing becomes
//      unreachable. A branch merged by squash passes through its PR ref; a branch merged by
//      merge commit passes through the default branch; a branch whose PR was closed unmerged
//      passes through its PR ref; a branch with NO pull request and commits main lacks FAILS.
// Anything that fails is HELD with its reasons printed. "Cannot tell" is HELD, never deleted.
//
// STRICT ON PURPOSE: a branch updated after its PR closed (e.g. "Merge branch 'main' into …")
// has a tip that no PR ref holds, so it is HELD even though the only unreachable commit is
// that merge. Loosening that is a decision for a human reading the report, not a default.
//
// WHAT RESTORING LOOKS LIKE. A pull request page keeps a "Restore branch" button after the
// head branch is deleted, and refs/pull/N/head keeps the commits regardless.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const MAX_DELETE = 200;           // blast-radius ceiling; the fingerprint is the real guard
export const PR_REF_GLOB = 'refs/pr/*';  // where the workflow mirrors refs/pull/*/head
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;

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

// Collation-free by construction: names are hashed after a plain code-unit sort, in this
// process, on both sides of every comparison (rule 9 concerns a DB sorting against a
// different sorter; there is no second sorter here).
export function fingerprint(names) {
  return createHash('sha256').update([...names].sort().join('\n')).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------------------
// PURE decision. `unpreserved` maps branch -> array of commit shas that neither the default
// branch nor any PR ref holds. A branch ABSENT from the map (or null) means "could not be
// measured" and is HELD.
export function selectDeletable({ repo, target, defaultBranch, branches, prs, unpreserved }) {
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
    if (p.state === 'open' && p.base_ref) push(openBase, p.base_ref, p.number);
  }

  const targeted = branches.filter((b) => matches(t, b.name));
  const deletable = [];
  const held = [];
  for (const b of targeted) {
    const reasons = [];
    if (b.name === defaultBranch) reasons.push('default-branch');
    if (b.protected) reasons.push('protected');
    if (!PLAIN.test(b.name) || b.name.includes('..') || b.name.includes('//') || b.name.endsWith('/')) {
      reasons.push('unusual-name');
    }
    if (openHead.has(b.name)) reasons.push(`open-pr-head:#${openHead.get(b.name).join(',#')}`);
    if (openBase.has(b.name)) reasons.push(`open-pr-base:#${openBase.get(b.name).join(',#')}`);
    const u = unpreserved ? unpreserved.get(b.name) : undefined;
    if (u === undefined || u === null) reasons.push('preservation-unknown');
    else if (u.length > 0) reasons.push(`unpreserved-commits:${u.length}`);
    const row = { name: b.name, sha: b.sha, prs: headPrs.get(b.name) || [] };
    if (reasons.length) held.push({ ...row, reasons });
    else deletable.push(row);
  }
  // Every targeted branch lands in exactly one of the two lists (the loop above has no other
  // exit); tests/ pins targeted = deletable + held so a change that drops one fails there.
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

// Commits on `tip` that are reachable from neither the default branch nor any PR ref.
// Empty array = deleting the branch makes nothing unreachable.
export function unpreservedCommits({ git, tip, defaultBranch }) {
  const out = git(['rev-list', tip, '--not', `origin/${defaultBranch}`, `--glob=${PR_REF_GLOB}`, '--']);
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
    summary(`## Refused\n\n${msg}\n`);
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
  const prRefs = git(['for-each-ref', '--format=%(refname)', 'refs/pr/']).split('\n').filter(Boolean).length;
  if (prRefs === 0) return refuse('no pull-request refs were fetched (refs/pr/*); without them nothing can be proven preserved');

  const prs = listAll(api, `repos/${repo}/pulls?state=all`).map((p) => ({
    number: p.number,
    state: p.state,
    head_ref: p.head && p.head.ref,
    head_repo: (p.head && p.head.repo && p.head.repo.full_name) || '',
    base_ref: p.base && p.base.ref,
  }));
  if (prs.length === 0) return refuse('pull-request read returned nothing; refusing to decide without it');

  const unpreserved = new Map();
  for (const b of branches.filter((x) => matches(t, x.name))) {
    try {
      unpreserved.set(b.name, unpreservedCommits({ git, tip: b.sha, defaultBranch }));
    } catch (_) {
      unpreserved.set(b.name, null);   // object missing locally => cannot tell => HELD
    }
  }
  const plan = selectDeletable({ repo, target: t, defaultBranch, branches, prs, unpreserved });
  // A target that matches NOTHING is indistinguishable from a clean result unless it is
  // refused: "cursor" (no slash) is a valid exact name that no branch has.
  if (plan.targeted === 0) {
    return refuse(`target ${JSON.stringify(opts.target)} matched no branch (of ${branches.length}). A prefix must end in "/"; check for a typo.`);
  }

  // ----- the report -----------------------------------------------------------------
  const lines = [];
  lines.push(`# Branch cleanup report: ${repo}  target ${t.kind === 'prefix' ? t.value + '*' : t.value}`);
  lines.push('');
  lines.push(`default branch ${defaultBranch} · ${branches.length} branches · ${prs.length} pull requests read · ${prRefs} PR refs mirrored`);
  lines.push(`targeted ${plan.targeted} = **${plan.deletable.length} deletable** + **${plan.held.length} held**`);
  lines.push('');
  if (plan.held.length) {
    lines.push('## HELD (will not be touched)');
    for (const h of plan.held) lines.push(`- \`${h.name}\` — ${h.reasons.join(' · ')}${h.prs.length ? ` (PRs #${h.prs.join(', #')})` : ''}`);
    lines.push('');
  }
  lines.push('## DELETABLE');
  for (const d of plan.deletable) lines.push(`- \`${d.name}\` ${String(d.sha).slice(0, 10)}${d.prs.length ? ` (PRs #${d.prs.join(', #')})` : ' (merged by ancestry, no PR)'}`);
  lines.push('');
  lines.push(`FINGERPRINT: ${plan.fingerprint}`);
  const report = lines.join('\n');
  log(report);
  summary(report + '\n');

  if (!opts.apply) {
    const how = plan.deletable.length
      ? `REPORT ONLY — nothing deleted. To delete exactly these ${plan.deletable.length}: run again with apply=true and expected_fingerprint=${plan.fingerprint}`
      : 'REPORT ONLY — nothing is deletable.';
    log(how);
    summary(`\n**${how}**\n`);
    return { exit: 0, plan, deleted: [], skipped: [], failed: [] };
  }

  // ----- apply ----------------------------------------------------------------------
  if (plan.deletable.length === 0) {
    log('APPLY: nothing deletable.');
    return { exit: 0, plan, deleted: [], skipped: [], failed: [] };
  }
  if (!opts.expect) return refuse(`apply needs expected_fingerprint (this report's is ${plan.fingerprint})`);
  if (opts.expect !== plan.fingerprint) {
    return refuse(`expected_fingerprint ${opts.expect} does not match this run's ${plan.fingerprint}: the population changed since the report you read. Read the new report first.`);
  }
  if (plan.deletable.length > MAX_DELETE) return refuse(`${plan.deletable.length} exceeds the ceiling of ${MAX_DELETE}`);

  const before = branches.map((b) => b.name);
  const deleted = [];
  const skipped = [];
  const failed = [];
  for (const b of plan.deletable) {
    try {
      // Re-read at the last moment: the report is minutes old.
      const now = api(`repos/${repo}/branches/${b.name}`);
      if (!now || !now.commit || now.commit.sha !== b.sha) { skipped.push([b.name, 'tip moved since the report']); continue; }
      const open = api(`repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${b.name}`)}`);
      if (Array.isArray(open) && open.length) { skipped.push([b.name, `open PR #${open[0].number} appeared`]); continue; }
      api(`repos/${repo}/git/refs/heads/${b.name}`, 'DELETE');
      deleted.push(b.name);
    } catch (e) {
      failed.push([b.name, String(e.message).split('\n')[0]]);
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
  if (stillThere.length) out.push(`  VERIFY FAILED: still present after delete: ${stillThere.join(', ')}`);
  if (collateral.length) out.push(`  VERIFY FAILED: gone but not on the plan: ${collateral.join(', ')}`);
  const restore = plan.deletable.filter((d) => deletedSet.has(d.name) && d.prs.length);
  if (restore.length) out.push(`  Restore any of them from its pull request page (${restore.length} have one).`);
  log(out.join('\n'));
  summary('\n' + out.join('\n') + '\n');
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
const realGit = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const res = run({
    argv: process.argv.slice(2),
    env: process.env,
    api: ghApi,
    git: realGit,
    summary: (md) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); },
  });
  process.exitCode = res.exit;
}
