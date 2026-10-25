// The production-credential boundary over EVERY workflow: the full rule test.
//
// A job is PRIVILEGED when it references a PROD_ secret (PRIVILEGED_ENV in test/lib/production-boundary.mjs).
// Each privileged job must:
//   ENV          carry exactly ENV_LINE on the line immediately before runs-on:, and no other environment line;
//   BOUNDARY     have BOUNDARY_STEP as its FIRST step, byte for byte (comment lines removed, dedented);
//   SECRET       take every secret only as the whole value of a step-level env key;
//   RUN_EXPR     expand no ${{ }} outside the R15 allowlist inside run:, shell:, working-directory: or with:,
//                so every dispatch input reaches the shell through env;
//   STATUS_IF    give every step that holds a secret and whose if: calls always(), failure() or cancelled()
//                the top-level conjunct steps.boundary.outcome != 'failure', with no || (those steps still run
//                after the boundary step refuses);
//   CHECKOUT_REF pass no ref: or repository: to actions/checkout;
//   DEFAULTS     set no job-level defaults: or container:; job-level permissions, if any, read or none only;
//   VARS         read no vars.NAME outside ALLOWED_VARS;
//   ACTION_PIN   pin any action outside actions/* to a full commit SHA with its tag in a comment.
// The workflow that contains a privileged job must:
//   TRIGGER      use only workflow_dispatch, schedule, push to branches [main], and pull_request only when
//                every privileged job's job-level if: excludes pull_request (a conjunction, no ||, holding
//                github.event_name == 'workflow_dispatch' or github.event_name != 'pull_request'): the
//                environment refuses a pull_request run anyway, so an unguarded one is a red check on every PR;
//   PERMISSIONS  declare workflow-level permissions, every entry read or none;
//   DEFAULTS     set no workflow-level defaults:, and no env key that re-routes bash (BASH_ENV, ENV,
//                BASH_FUNC_*, SHELLOPTS, BASHOPTS, PS4) anywhere in the file.
// Across EVERY workflow:
//   CLASSIFY     every secret name is classified, and secrets are never read dynamically (toJSON(secrets),
//                secrets[...], secrets: inherit), which no classification could follow;
//   RETIRED      SUPABASE_SERVICE_ROLE_KEY is named nowhere; SUPABASE_ACCESS_TOKEN only by an OTHER_ENVIRONMENT
//                job that lists it; SUPABASE_DB_URL only by the jobs in DEFERRED_DB_URL_JOBS, each of which still
//                names it (SHRINK-ONLY); no retired or PROD_ name outside a job (workflow env, top comments);
//   PENDING      every PRIVILEGED_PENDING (secret, job) pair exists and no other job names that secret;
//   OTHER_ENV    every OTHER_ENVIRONMENT job exists, names exactly its environment, reads exactly its secrets,
//                and no other job reads those secrets;
//   ENV_NAME     a job names an environment only as ENV_LINE (and is then privileged), as its OTHER_ENVIRONMENT
//                entry, or as a SECRETLESS_ENVIRONMENTS one (and then reads no secret).
//
// HYGIENE, NOT THE BOUNDARY. A branch can edit this test, and a line scanner cannot follow code that builds an
// expression from fragments. What enforces is the environment's main-only branch rule (proven 2026-10-25: a
// dispatch from a branch got no runner and no step). The scanner is test/lib/production-boundary-scan.mjs, the
// same code test/production-boundary-new-workflows.test.mjs reads with.
//
// Every check is load-bearing: the real corpus passes clean, and each rule is shown to fire on a mutation of the
// real files (each mutation first asserts that it changed the text).
//
// Run: node test/production-boundary.test.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRIVILEGED_ENV, RETIRED, DEFERRED_DB_URL_JOBS, OTHER_ENVIRONMENT, SECRETLESS_ENVIRONMENTS, PRIVILEGED_PENDING,
  NON_PRIVILEGED, ALLOWED_VARS, ENV_LINE, BOUNDARY_STEP, boundaryStepYaml, stripCommentLines, isCommentLine,
  runExpressionAllowed,
} from './lib/production-boundary.mjs';
import {
  indentOf, skippable, topBlock, triggerNames, parseJobs, firstStep, dedent, keyBlocks, runBlocks, stepsOf, stepKey,
  ifExpression, topLevelAnd, BOUNDARY_CONJUNCT, SHELL_ENV_KEY, SECRET_REF, STEP_ENV_SECRET, mut,
} from './lib/production-boundary-scan.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wfDir = join(root, '.github', 'workflows');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const DB_URL = 'SUPABASE_DB_URL';
const SRK = 'SUPABASE_SERVICE_ROLE_KEY';
const TOKEN = 'SUPABASE_ACCESS_TOKEN';
const NAME_RE = /\bsecrets\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g;
const DYNAMIC_RE = /toJSON\(\s*secrets\s*\)|\bsecrets\s*\[|^\s*secrets\s*:\s*inherit\b/;
const GUARD_DISPATCH = "github.event_name == 'workflow_dispatch'";
const GUARD_NOT_PR = "github.event_name != 'pull_request'";
const ALLOWED_TRIGGERS = ['workflow_dispatch', 'schedule', 'push', 'pull_request'];

/** The job-level if: of a job, as an expression (block scalar joined), or ''. */
function jobIf(job) {
  const i = job.body.findIndex(({ l }) => /^ {4}if\s*:/.test(l));
  if (i < 0) return '';
  const parts = [job.body[i].l.replace(/^ {4}if\s*:/, '')];
  for (let k = i + 1; k < job.body.length && (skippable(job.body[k].l) || indentOf(job.body[k].l) > 4); k++) {
    if (!isCommentLine(job.body[k].l)) parts.push(job.body[k].l);
  }
  return ifExpression(parts.join('\n')).replace(/\s+/g, ' ');
}

/** True when a job-level if: keeps the job off pull_request runs. */
export function excludesPullRequest(cond) {
  if (!cond || cond.includes('||')) return false;
  const conj = topLevelAnd(cond).map((c) => c.replace(/\s+/g, ' ').trim());
  return conj.includes(GUARD_DISPATCH) || conj.includes(GUARD_NOT_PR);
}

/** A job's environment: null, or { raw, name } (name from scalar, flow or block form). */
function environmentOf(job) {
  const lines = job.body.filter(({ l }) => !isCommentLine(l) && /^ {4}environment\s*:/.test(l));
  if (!lines.length) return { count: 0 };
  const at = job.body.indexOf(lines[0]);
  const inline = lines[0].l.replace(/^ {4}environment\s*:\s*/, '').replace(/\s+#.*$/, '').trim();
  let name = null;
  if (inline.startsWith('{')) { const m = inline.match(/(?:^\{|,)\s*name\s*:\s*['"]?([^,'"}\s]+)/); name = m ? m[1] : null; }
  else if (inline) name = inline.replace(/^['"]|['"]$/g, '');
  else {
    for (let k = at + 1; k < job.body.length && (skippable(job.body[k].l) || indentOf(job.body[k].l) > 4); k++) {
      const m = job.body[k].l.match(/^\s+name\s*:\s*['"]?([^'"\s#]+)/);
      if (m) { name = m[1]; break; }
    }
  }
  return { count: lines.length, raw: lines[0].l, name };
}

/** The lines of the push: trigger's body, or null when push is absent; 'inline' when given inline. */
function pushBody(on) {
  if (on.inline) return /\bpush\b/.test(on.inline) ? 'inline' : null;
  const i = on.body.findIndex((l) => /^ {2}push\s*:/.test(l));
  if (i < 0) return null;
  const inline = on.body[i].replace(/^ {2}push\s*:/, '').replace(/\s+#.*$/, '').trim();
  if (inline && inline !== '{}') return [inline];
  const body = [];
  for (let k = i + 1; k < on.body.length && (skippable(on.body[k]) || indentOf(on.body[k]) > 2); k++) {
    if (!skippable(on.body[k])) body.push(on.body[k]);
  }
  return body;
}

/** True when a push trigger runs on branch main only. */
function pushMainOnly(body) {
  if (!Array.isArray(body)) return false;
  const t = body.map((l) => l.replace(/\s+#.*$/, '').trim());
  if (t.some((l) => /^(tags|tags-ignore|branches-ignore)\s*:/.test(l))) return false;
  const bi = t.findIndex((l) => /^branches\s*:/.test(l));
  if (bi < 0) return false;
  const v = t[bi].replace(/^branches\s*:\s*/, '');
  if (v) return /^\[\s*['"]?main['"]?\s*\]$/.test(v);
  const items = [];
  for (let k = bi + 1; k < t.length && t[k].startsWith('- '); k++) items.push(t[k].slice(2).trim().replace(/^['"]|['"]$/g, ''));
  return items.length === 1 && items[0] === 'main';
}

/** Permission entries of a block (inline or body); every one must be read or none. */
function permissionEntries(block) {
  if (block.inline) {
    if (/^(read-all|\{\s*\})$/.test(block.inline)) return [];
    if (!block.inline.startsWith('{')) return [block.inline];
    return block.inline.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return block.body.filter((l) => !skippable(l)).map((l) => l.replace(/\s+#.*$/, '').trim());
}
const readOnly = (entries) => entries.every((e) => /^[a-z-]+\s*:\s*(read|none)$/.test(e));

/** Every secrets.NAME reference in a file: { name, line (0-based), job (name or null), comment }. */
function secretRefs(lines, jobs) {
  const owner = new Map();
  for (const j of jobs) for (const { n } of j.body) owner.set(n, j.name);
  const refs = [];
  lines.forEach((l, i) => {
    for (const m of l.matchAll(NAME_RE)) refs.push({ name: m[1], line: i, job: owner.get(i) ?? null, comment: isCommentLine(l) });
  });
  return refs;
}

/** Analyse a corpus { file: text }. Returns { violations, privileged, jobRefs } (jobRefs: 'f#job' -> Set of names). */
export function analyse(corpus) {
  const out = [];
  const v = (code, where, msg) => out.push(`${code} ${where}: ${msg}`);
  const privileged = [];
  const jobRefs = new Map();
  const jobsByKey = new Map();

  for (const [f, text] of Object.entries(corpus)) {
    const lines = text.split('\n');
    const jobs = parseJobs(lines);
    if (!jobs || !jobs.length) { v('SCAN', f, 'no jobs found: the scanner cannot read this workflow'); continue; }

    // CLASSIFY (dynamic reads), anywhere in the file
    lines.forEach((l, i) => { if (DYNAMIC_RE.test(l)) v('CLASSIFY', `${f}:${i + 1}`, `secrets read dynamically: ${l.trim()}`); });

    const refs = secretRefs(lines, jobs);
    for (const r of refs) {
      if (r.job === null && (Object.hasOwn(PRIVILEGED_ENV, r.name) || RETIRED.includes(r.name))) {
        v('RETIRED', `${f}:${r.line + 1}`, `${r.name} named outside any job (workflow env or a top comment)`);
      }
    }
    for (const j of jobs) {
      const key = `${f}#${j.name}`;
      jobsByKey.set(key, { f, job: j, lines });
      jobRefs.set(key, new Set(refs.filter((r) => r.job === j.name).map((r) => r.name)));
    }

    // ENV_NAME, per job
    for (const j of jobs) {
      const key = `${f}#${j.name}`;
      const env = environmentOf(j);
      const names = jobRefs.get(key);
      const isPriv = [...names].some((n) => Object.hasOwn(PRIVILEGED_ENV, n));
      if (env.count > 1) v('ENV_NAME', key, `${env.count} environment lines`);
      if (env.count === 0) continue;
      if (env.name === 'production') {
        if (env.raw !== '    ' + ENV_LINE) v('ENV_NAME', key, `names production other than as "${ENV_LINE}": ${env.raw.trim()}`);
        if (!isPriv) v('ENV_NAME', key, 'names production but references no PROD_ secret');
      } else if (Object.hasOwn(OTHER_ENVIRONMENT, key)) {
        if (env.name !== OTHER_ENVIRONMENT[key].environment) v('OTHER_ENV', key, `names environment ${env.name}, expected ${OTHER_ENVIRONMENT[key].environment}`);
      } else if (Object.hasOwn(SECRETLESS_ENVIRONMENTS, env.name)) {
        if (names.size) v('ENV_NAME', key, `environment ${env.name} is listed as secretless, but the job reads ${[...names].join(', ')}`);
      } else {
        v('ENV_NAME', key, `environment ${env.name} is neither production, its OTHER_ENVIRONMENT entry, nor a SECRETLESS_ENVIRONMENTS one`);
      }
    }

    // privileged jobs and their workflow
    const privJobs = jobs.filter((j) => [...jobRefs.get(`${f}#${j.name}`)].some((n) => Object.hasOwn(PRIVILEGED_ENV, n)));
    if (!privJobs.length) continue;
    for (const j of privJobs) privileged.push(`${f}#${j.name}`);

    // TRIGGER
    const on = topBlock(lines, /^(on|"on"|'on')\s*:/);
    if (!on) v('TRIGGER', f, 'no on: block');
    else {
      const names = triggerNames(on);
      const extra = names.filter((t) => !ALLOWED_TRIGGERS.includes(t));
      if (extra.length) v('TRIGGER', f, `trigger(s) ${extra.join(', ')} not allowed beside a production job`);
      const push = pushBody(on);
      if (push !== null && !pushMainOnly(push)) v('TRIGGER', f, 'push must be limited to branches: [main], with no tags');
      if (names.includes('pull_request')) {
        for (const j of privJobs) {
          if (!excludesPullRequest(jobIf(j))) v('TRIGGER', `${f}#${j.name}`, `runs on pull_request: its job-level if: must hold ${GUARD_DISPATCH} or ${GUARD_NOT_PR}, with no ||`);
        }
      }
    }

    // PERMISSIONS (workflow level)
    const perm = topBlock(lines, /^permissions\s*:/);
    if (!perm) v('PERMISSIONS', f, 'no workflow-level permissions:');
    else if (!readOnly(permissionEntries(perm))) v('PERMISSIONS', f, `every workflow permission must be read or none: [${permissionEntries(perm).join('; ')}]`);

    // DEFAULTS (workflow level, and shell-start env keys anywhere in the file)
    if (lines.some((l) => /^defaults\s*:/.test(l))) v('DEFAULTS', f, 'workflow-level defaults: is not allowed beside a production job');
    lines.forEach((l, i) => {
      const m = isCommentLine(l) ? null : l.match(SHELL_ENV_KEY);
      if (m) v('DEFAULTS', `${f}:${i + 1}`, `env key ${m[2]} is not allowed (it can re-route or neuter the boundary step's shell)`);
    });

    // the expression-bearing blocks of the whole file, attributed to jobs below
    const runs = runBlocks(lines);
    const inRun = new Set();
    for (const r of runs) for (let k = r.start + 1; k < r.end; k++) inRun.add(k);
    const scanned = [['run', runs], ...['shell', 'working-directory', 'with'].map((k) => [k, keyBlocks(lines, k, inRun)])];

    for (const j of privJobs) {
      const key = `${f}#${j.name}`;
      const span = new Set(j.body.map(({ n }) => n));
      const jl = j.body;

      // ENV
      const runsOn = jl.findIndex(({ l }) => /^ {4}runs-on\s*:/.test(l));
      if (runsOn < 0) v('ENV', key, 'no runs-on: at job indent');
      else if (runsOn === 0 || jl[runsOn - 1].l !== '    ' + ENV_LINE) v('ENV', key, `the line immediately before runs-on: is not exactly "${ENV_LINE}"`);

      // BOUNDARY
      const step = firstStep(j);
      if (step.error) v('BOUNDARY', key, step.error);
      else if (dedent(stripCommentLines(step.text), 6) !== BOUNDARY_STEP) v('BOUNDARY', key, 'the first step is not byte-equal to BOUNDARY_STEP');

      // SECRET: every reference line in the job is the whole value of a step-level env key
      const secretLines = new Set();
      for (const { n, l } of jl) {
        if (!SECRET_REF.test(l)) continue;
        if (!STEP_ENV_SECRET.test(l)) { v('SECRET', `${key}:${n + 1}`, `a secret may appear only as the whole value of a step-level env key: ${l.trim()}`); continue; }
        let k = n - 1;
        while (k >= 0 && (skippable(lines[k]) || indentOf(lines[k]) >= 10)) k--;
        if (k < 0 || !/^ {8}env\s*:\s*$/.test(lines[k])) { v('SECRET', `${key}:${n + 1}`, 'not inside a step-level env:'); continue; }
        let s = k - 1;
        while (s >= 0 && (skippable(lines[s]) || indentOf(lines[s]) >= 8)) s--;
        if (s < 0 || !/^ {6}- /.test(lines[s])) { v('SECRET', `${key}:${n + 1}`, "its env: is not a step's"); continue; }
        secretLines.add(n);
      }

      // RUN_EXPR
      for (const [k, blocks] of scanned) {
        for (const r of blocks) {
          if (!span.has(r.start)) continue;
          const body = r.text.split('\n').filter((l) => !isCommentLine(l) || k === 'run').join('\n');
          const exprs = [...body.matchAll(/\$\{\{([\s\S]*?)\}\}/g)];
          if ((body.match(/\$\{\{/g) || []).length !== exprs.length) v('RUN_EXPR', `${key}:${r.line}`, `${k}: has an unclosed \${{`);
          for (const e of exprs) if (!runExpressionAllowed(e[1])) v('RUN_EXPR', `${key}:${r.line}`, `${k}: expands \${{${e[1]}}}; pass it through env instead`);
        }
      }

      // DEFAULTS / PERMISSIONS (job level)
      for (const kk of ['defaults', 'container']) if (jl.some(({ l }) => new RegExp(`^ {4}${kk}\\s*:`).test(l))) v('DEFAULTS', key, `job-level ${kk}: is not allowed`);
      const jp = jl.findIndex(({ l }) => /^ {4}permissions\s*:/.test(l));
      if (jp >= 0) {
        const inline = jl[jp].l.replace(/^ {4}permissions\s*:/, '').replace(/\s+#.*$/, '').trim();
        const body = [];
        for (let q = jp + 1; q < jl.length && (skippable(jl[q].l) || indentOf(jl[q].l) > 4); q++) body.push(jl[q].l);
        if (!readOnly(permissionEntries({ inline, body }))) v('PERMISSIONS', key, 'job-level permissions must be read or none');
      }

      // VARS, ACTION_PIN
      for (const { n, l } of jl) {
        if (isCommentLine(l)) continue;
        for (const m of l.matchAll(/\bvars\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) if (!Object.hasOwn(ALLOWED_VARS, m[1])) v('VARS', `${key}:${n + 1}`, `vars.${m[1]} is not in ALLOWED_VARS`);
        const u = l.match(/^\s*(?:- )?uses\s*:\s*['"]?([^'"\s#]+)['"]?\s*(#.*)?$/);
        if (!u) continue;
        const [, ref, comment] = u;
        if (ref.startsWith('./') || /^actions\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_./-]+)?@\S+$/.test(ref)) continue;
        if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/.test(ref) && comment && /#\s*\S/.test(comment)) continue;
        v('ACTION_PIN', `${key}:${n + 1}`, `${ref} is not pinned to a 40-hex commit SHA with its tag in a comment`);
      }

      // STATUS_IF and CHECKOUT_REF, per step
      for (const st of stepsOf(j)) {
        const at = `${key}:${st[0].n + 1}`;
        const iff = stepKey(st, 'if');
        if (iff !== null && st.some(({ n }) => secretLines.has(n))) {
          const e = ifExpression(iff);
          if (/\b(always|failure|cancelled)\s*\(/.test(e)) {
            if (e.includes('||')) v('STATUS_IF', at, 'a status-function if: holding a secret may not contain ||');
            else if (!topLevelAnd(e).some((c) => c.replace(/\s+/g, ' ') === BOUNDARY_CONJUNCT)) v('STATUS_IF', at, `a status-function if: holding a secret needs the top-level conjunct ${BOUNDARY_CONJUNCT}`);
          }
        }
        const uses = stepKey(st, 'uses');
        if (uses !== null && /^\s*['"]?actions\/checkout@/.test(uses)) {
          const w = stepKey(st, 'with');
          if (w !== null && /(^|[\s{,])['"]?(ref|repository)['"]?\s*:/m.test(w)) v('CHECKOUT_REF', at, 'actions/checkout may not take ref: or repository: in a production job');
        }
      }
    }
  }

  // CLASSIFY, RETIRED, PENDING, OTHER_ENV: across every job of every workflow
  const otherSecrets = new Set(Object.values(OTHER_ENVIRONMENT).flatMap((e) => e.secrets));
  const known = new Set([...Object.keys(PRIVILEGED_ENV), ...Object.keys(NON_PRIVILEGED), ...Object.keys(PRIVILEGED_PENDING), ...RETIRED, ...otherSecrets]);
  const usersOf = (name) => [...jobRefs].filter(([, s]) => s.has(name)).map(([k]) => k).sort();
  for (const [key, names] of jobRefs) {
    for (const n of names) if (!known.has(n)) v('CLASSIFY', key, `secret ${n} is not classified in test/lib/production-boundary.mjs`);
  }
  for (const key of usersOf(SRK)) v('RETIRED', key, `${SRK} is retired: use PROD_${SRK} from the environment production`);
  for (const key of usersOf(TOKEN)) {
    if (!(OTHER_ENVIRONMENT[key]?.secrets || []).includes(TOKEN)) v('RETIRED', key, `${TOKEN} is retired: use PROD_${TOKEN} from the environment production`);
  }
  const dbUsers = usersOf(DB_URL);
  for (const key of dbUsers) if (!DEFERRED_DB_URL_JOBS.includes(key)) v('RETIRED', key, `${DB_URL} is deferred only for DEFERRED_DB_URL_JOBS; this job is not one`);
  for (const key of DEFERRED_DB_URL_JOBS) if (!dbUsers.includes(key)) v('DEFERRED', key, `listed in DEFERRED_DB_URL_JOBS but no longer names ${DB_URL}: delete the entry (shrink-only)`);
  for (const [name, entry] of Object.entries(PRIVILEGED_PENDING)) {
    const users = usersOf(name);
    for (const key of entry.jobs) if (!users.includes(key)) v('PENDING', key, `listed for ${name} but no longer names it: delete the pair (shrink-only)`);
    for (const key of users) if (!entry.jobs.includes(key)) v('PENDING', key, `names ${name}, which PRIVILEGED_PENDING allows only for ${entry.jobs.join(', ')}`);
  }
  for (const [key, entry] of Object.entries(OTHER_ENVIRONMENT)) {
    if (!jobsByKey.has(key)) { v('OTHER_ENV', key, 'listed in OTHER_ENVIRONMENT but the job does not exist (shrink-only)'); continue; }
    const env = environmentOf(jobsByKey.get(key).job);
    if (env.name !== entry.environment) v('OTHER_ENV', key, `must name environment ${entry.environment} (found ${env.name ?? 'none'})`);
    const names = [...jobRefs.get(key)].sort();
    if (JSON.stringify(names) !== JSON.stringify([...entry.secrets].sort())) v('OTHER_ENV', key, `reads [${names.join(', ')}], expected exactly [${entry.secrets.join(', ')}]`);
  }
  for (const name of otherSecrets) {
    const allowed = Object.entries(OTHER_ENVIRONMENT).filter(([, e]) => e.secrets.includes(name)).map(([k]) => k);
    for (const key of usersOf(name)) {
      if (!allowed.includes(key) && !(name === TOKEN)) v('OTHER_ENV', key, `${name} belongs to ${allowed.join(', ')} only`);
    }
  }
  return { violations: out, privileged: privileged.sort(), jobRefs };
}

const codes = (vs) => [...new Set(vs.map((x) => x.split(' ')[0]))].sort();

// ── 1. the constants ────────────────────────────────────────────────────────────────────────────
const jobKey = /^[a-z0-9-]+\.yml#[A-Za-z0-9_-]+$/;
ok(DEFERRED_DB_URL_JOBS.every((k) => jobKey.test(k)) && new Set(DEFERRED_DB_URL_JOBS).size === DEFERRED_DB_URL_JOBS.length,
  'DEFERRED_DB_URL_JOBS names jobs as workflow.yml#job, each once');
ok(Object.entries(OTHER_ENVIRONMENT).every(([k, e]) => jobKey.test(k) && e.environment && e.environment !== 'production' &&
  Array.isArray(e.secrets) && e.secrets.length && e.reason), 'every OTHER_ENVIRONMENT entry names its job, a non-production environment, its secrets and a reason');
ok(!Object.hasOwn(SECRETLESS_ENVIRONMENTS, 'production') && Object.values(SECRETLESS_ENVIRONMENTS).every((r) => typeof r === 'string' && r),
  'SECRETLESS_ENVIRONMENTS never lists production, and each entry carries a reason');
ok(!Object.hasOwn(PRIVILEGED_PENDING, 'DEPLOY_KEY'), 'DEPLOY_KEY is no longer pending: no workflow may name it');
ok(runExpressionAllowed('github.workspace') && runExpressionAllowed(' runner.temp ') && !runExpressionAllowed('runner.os') &&
   !runExpressionAllowed('inputs.x') && !runExpressionAllowed('github.event.inputs.x'),
  'the run-expression allowlist accepts the two runner-set paths and still refuses inputs');
ok(excludesPullRequest(GUARD_DISPATCH) && excludesPullRequest(`${GUARD_NOT_PR} && github.ref == 'refs/heads/main'`) &&
   !excludesPullRequest(`${GUARD_DISPATCH} || github.event_name == 'pull_request'`) && !excludesPullRequest('') &&
   !excludesPullRequest("github.event_name == 'push'"), 'the pull_request guard accepts the two exact conjuncts and refuses ||, absence, and others');

// ── 2. the real corpus ──────────────────────────────────────────────────────────────────────────
const files = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort();
const corpus = Object.fromEntries(files.map((f) => [f, readFileSync(join(wfDir, f), 'utf8')]));
const res = analyse(corpus);

ok(files.length >= 50, `control: ${files.length} workflow files read`);
ok(!res.violations.some((x) => x.startsWith('SCAN ')), 'control: the scanner finds jobs in every workflow' +
  (res.violations.some((x) => x.startsWith('SCAN ')) ? ': ' + res.violations.filter((x) => x.startsWith('SCAN ')).join(' | ') : ''));
// Every PROD_ / retired name in the raw text is attributed to a job: no reference escapes the scan.
for (const name of [...Object.keys(PRIVILEGED_ENV), DB_URL, TOKEN]) {
  const raw = Object.values(corpus).reduce((a, t) => a + (t.match(new RegExp(`\\bsecrets\\.${name}\\b`, 'g')) || []).length, 0);
  const users = [...res.jobRefs].filter(([, s]) => s.has(name)).length;
  ok(raw === 0 ? users === 0 : users > 0, `control: ${name} — ${raw} reference(s) in the files, ${users} job(s) naming it`);
}
// Two derivations of the production jobs agree: the jobs that hold a PROD_ secret, and the jobs that carry ENV_LINE.
const envLineJobs = [];
for (const [f, text] of Object.entries(corpus)) {
  for (const j of parseJobs(text.split('\n')) || []) if (j.body.some(({ l }) => l === '    ' + ENV_LINE)) envLineJobs.push(`${f}#${j.name}`);
}
ok(JSON.stringify(envLineJobs.sort()) === JSON.stringify(res.privileged),
  `control: the ${res.privileged.length} jobs holding a PROD_ secret are exactly the ${envLineJobs.length} jobs carrying ENV_LINE`);
for (const anchor of ['db-read.yml#read', 'verify-production-environment.yml#verify', 'db-sql.yml#run-sql',
  'n5-generation.yml#orchestrate', 'maps-social-image.yml#capture', 'source-monitor.yml#monitor', 'phase2-b1-zcta.yml#b1']) {
  ok(res.privileged.includes(anchor), `control: ${anchor} is found as a production job`);
}
ok(!res.privileged.includes('db-migrate-decide.yml#decide') && res.jobRefs.get('db-migrate-decide.yml#decide')?.has(TOKEN),
  'control: db-migrate-decide is seen holding SUPABASE_ACCESS_TOKEN, and is not a production job (its own environment)');
ok(res.violations.length === 0, `the real corpus: 0 violations across ${res.privileged.length} production jobs in ` +
  `${new Set(res.privileged.map((k) => k.split('#')[0])).size} workflows` + (res.violations.length ? '\n    ' + res.violations.join('\n    ') : ''));
console.log('production jobs: ' + res.privileged.join(', '));

// ── 3. mutations of the real files: each rule fires on them ─────────────────────────────────────
const IF_LINE = "        if: github.event_name == 'workflow_dispatch' && (github.actor != 'HomeSignalG' || github.triggering_actor != 'HomeSignalG')";
const BSTEP = boundaryStepYaml(6) + '\n';
/** Re-analyse the corpus with one file replaced (the replacement must differ from the original). */
function withFile(f, text) {
  if (!Object.hasOwn(corpus, f)) throw new Error(`no such workflow: ${f}`);
  if (text === corpus[f]) throw new Error(`mutation of ${f} changed nothing`);
  return analyse({ ...corpus, [f]: text });
}
const C = (f) => corpus[f];
const MUTATIONS = [
  ['ENV', 'n5-generation.yml', 'delete the environment line', (t) => mut(t, '    ' + ENV_LINE + '\n', '')],
  ['ENV', 'maps-social-image.yml', 'move the environment line below runs-on', (t) => mut(t, '    ' + ENV_LINE + '\n    runs-on: ubuntu-latest\n', '    runs-on: ubuntu-latest\n    ' + ENV_LINE + '\n')],
  ['BOUNDARY', 'source-monitor.yml', 'prefix the boundary if: with false &&', (t) => mut(t, IF_LINE, IF_LINE.replace('if: ', 'if: false && '))],
  ['BOUNDARY', 'deploy-edge-functions.yml', 'delete the boundary step', (t) => mut(t, BSTEP, '')],
  ['BOUNDARY', 'denton-launch-audit.yml', 'drop triggering_actor from one job\'s boundary step', (t) => t.replace(IF_LINE, "        if: github.event_name == 'workflow_dispatch' && github.actor != 'HomeSignalG'")],
  ['SECRET', 'phase2-b1-zcta.yml', 'put text around one PROD_ secret', (t) => t.replace(': ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n', ': Bearer ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n')],
  ['RUN_EXPR', 'db-sql.yml', 'expand the sql_file input into the script again', (t) => mut(t, 'run_file "$SQL_FILE"', 'run_file "${{ github.event.inputs.sql_file }}"')],
  ['RUN_EXPR', 'maps-social-image.yml', 'expand inputs.ids into the command line', (t) => mut(t, 'node scripts/maps-social-image.mjs "${args[@]}"', 'node scripts/maps-social-image.mjs ${{ inputs.ids }} "${args[@]}"')],
  ['RUN_EXPR', 'deploy-edge-functions.yml', 'expand the function input into the script', (t) => mut(t, 'FN="$FN_INPUT"', 'FN="${{ github.event.inputs.function }}"')],
  ['STATUS_IF', 'source-monitor.yml', 'give the scoreboard step a bare always()', (t) => mut(t, "        if: always() && steps.boundary.outcome != 'failure'\n", '        if: always()\n')],
  ['CHECKOUT_REF', 'load-openaddresses.yml', 'check out a ref chosen by an input', (t) => mut(t, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.inputs.zips }}\n')],
  ['TRIGGER', 'source-monitor.yml', 'add a pull_request trigger (the job is unguarded)', (t) => mut(t, '\non:\n', '\non:\n  pull_request:\n')],
  ['TRIGGER', 'db-sql.yml', 'let push run on every branch', (t) => mut(t, '    branches: [main]\n', "    branches: ['**']\n")],
  ['TRIGGER', 'n5-generation.yml', 'add a workflow_run trigger', (t) => mut(t, '\non:\n', '\non:\n  workflow_run:\n    workflows: [pages]\n')],
  ['TRIGGER', 'dc-geocode-observations.yml', 'drop the pull_request guard from derive', (t) => mut(t, "    if: github.event_name != 'pull_request'\n", '')],
  ['PERMISSIONS', 'n5-generation.yml', 'contents: write', (t) => mut(t, 'permissions:\n  contents: read\n', 'permissions:\n  contents: write\n')],
  ['PERMISSIONS', 'load-openaddresses.yml', 'remove the permissions block', (t) => mut(t, 'permissions:\n  contents: read\n\n', '')],
  ['DEFAULTS', 'archive-filtered-source-records.yml', 'run the job in a container', (t) => mut(t, '    runs-on: ubuntu-latest\n', '    runs-on: ubuntu-latest\n    container: node:22\n')],
  ['DEFAULTS', 'verify-maps-preview-live.yml', 'add BASH_ENV to a step env', (t) => t.replace(/( {8}env:\n)/, '$1          BASH_ENV: ./x.sh\n')],
  ['ACTION_PIN', 'dc-epoch-dryrun.yml', 'put setup-deno back on the @v2 tag', (t) => t.replace(/denoland\/setup-deno@[0-9a-f]{40} #[^\n]*/, 'denoland/setup-deno@v2')],
  ['VARS', 'dc-step3c-probe.yml', 'read a repository variable in a production job', (t) => t.replace(/( {8}env:\n)/, '$1          X: ${{ vars.SOMETHING }}\n')],
  ['RETIRED', 'maps-social-image.yml', 'go back to the repository service-role key', (t) => mut(t, 'secrets.PROD_SUPABASE_SERVICE_ROLE_KEY', 'secrets.SUPABASE_SERVICE_ROLE_KEY')],
  ['RETIRED', 'dc-step3c-probe.yml', 'go back to the repository access token', (t) => mut(t, 'secrets.PROD_SUPABASE_ACCESS_TOKEN', 'secrets.SUPABASE_ACCESS_TOKEN')],
  ['RETIRED', 'verify-maps-preview-live.yml', 'give a job not in the deferred list the repository database URL', (t) => t.replace(/( {8}env:\n)/, '$1          DB: ${{ secrets.SUPABASE_DB_URL }}\n')],
  ['RETIRED', 'pages.yml', 'name a PROD_ secret in workflow-level env', (t) => mut(t, '\njobs:\n', '\nenv:\n  T: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\njobs:\n')],
  ['DEFERRED', 'n5-rpc-apply.yml', 'a deferred job stops naming the database URL (every line; the list must shrink)', (t) => t.replace(/^.*secrets\.SUPABASE_DB_URL.*\n/gm, '')],
  ['PENDING', 'source-monitor.yml', 'hand INGEST_DISPATCH_TOKEN to another job', (t) => t.replace(/( {8}env:\n)/, '$1          D: ${{ secrets.INGEST_DISPATCH_TOKEN }}\n')],
  ['PENDING', 'n5-generation.yml', 'the pending job stops naming its token (the list must shrink)', (t) => mut(t, '          INGEST_DISPATCH_TOKEN: ${{ secrets.INGEST_DISPATCH_TOKEN }}\n', '')],
  ['CLASSIFY', 'pages.yml', 'an unclassified secret in a non-production workflow', (t) => t.replace(/( {8}env:\n)/, '$1          N: ${{ secrets.SOME_NEW_TOKEN }}\n')],
  ['CLASSIFY', 'pages.yml', 'toJSON(secrets)', (t) => t.replace(/( {8}env:\n)/, '$1          ALL: ${{ toJSON(secrets) }}\n')],
  ['CLASSIFY', 'source-monitor.yml', 'DEPLOY_KEY comes back', (t) => t.replace(/( {8}env:\n)/, '$1          K: ${{ secrets.DEPLOY_KEY }}\n')],
  ['OTHER_ENV', 'db-migrate-decide.yml', 'rename its environment', (t) => mut(t, 'environment: prod-db-write\n', 'environment: prod-db-write-2\n')],
  ['OTHER_ENV', 'db-migrate-decide.yml', 'stop reading the one-time-code seed', (t) => mut(t, '          MIGRATION_TOTP_SECRET: ${{ secrets.MIGRATION_TOTP_SECRET }}\n', '')],
  ['OTHER_ENV', 'source-monitor.yml', 'another job reads the one-time-code seed', (t) => t.replace(/( {8}env:\n)/, '$1          S: ${{ secrets.MIGRATION_TOTP_SECRET }}\n')],
  ['ENV_NAME', 'dc-geocode-observations.yml', 'put ENV_LINE on the secret-free typecheck job', (t) => mut(t, "    if: github.event_name == 'pull_request'\n    runs-on:", "    if: github.event_name == 'pull_request'\n    " + ENV_LINE + '\n    runs-on:')],
  ['ENV_NAME', 'n5-generation.yml', 'name production in scalar form', (t) => mut(t, '    ' + ENV_LINE + '\n', '    environment: production\n')],
  ['ENV_NAME', 'pages.yml', 'name an unlisted environment', (t) => mut(t, '      name: github-pages\n', '      name: staging\n')],
  ['ENV_NAME', 'pages.yml', 'a secret in the secretless github-pages job', (t) => mut(t, '      - id: deployment\n', '      - id: deployment\n        env:\n          K: ${{ secrets.INDEXNOW_KEY }}\n')],
];
for (const [code, f, label, fn] of MUTATIONS) {
  let got;
  try { got = codes(withFile(f, fn(C(f))).violations); } catch (e) { got = [`ERROR ${e.message}`]; }
  ok(got.includes(code), `real-file mutation: ${f}, ${label} → ${code} (got ${got.join(', ') || 'nothing'})`);
}

// ── 4. near misses on the real files: shapes the rules must NOT flag ────────────────────────────
for (const [f, label, fn] of [
  ['source-monitor.yml', 'the boundary conjunct written first', (t) => mut(t, "if: always() && steps.boundary.outcome != 'failure'", "if: steps.boundary.outcome != 'failure' && always()")],
  ['db-sql.yml', 'push branches as a block list', (t) => mut(t, '    branches: [main]\n', '    branches:\n      - main\n')],
  ['n5-generation.yml', 'permissions in flow form', (t) => mut(t, 'permissions:\n  contents: read\n', 'permissions: { contents: read }\n')],
  ['dc-atlas-dryrun.yml', 'an extra conjunct beside the dispatch guard', (t) => mut(t, "    if: github.event_name == 'workflow_dispatch'\n", "    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'\n")],
  ['load-openaddresses.yml', 'checkout with fetch-depth only', (t) => mut(t, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n')],
]) {
  const vs = withFile(f, fn(C(f))).violations;
  ok(vs.length === 0, `near miss passes: ${f}, ${label}` + (vs.length ? ': ' + vs.join(' | ') : ''));
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL PASS');
