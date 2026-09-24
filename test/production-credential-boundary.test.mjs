// PRODUCTION CREDENTIAL BOUNDARY — a structural security invariant over .github/**.
//
// Privileged production credentials are issued ONLY through the main-restricted GitHub
// Environment `production`. That Environment (a founder-controlled repository setting) is
// the real boundary: a branch cannot redefine it. This test keeps the workflow side honest
// so the setting has something to enforce:
//
//   R1  a job that references a PRIVILEGED secret declares `environment: production`
//   R2  no privileged secret is referenced outside a job (workflow-level env reaches every job)
//   R3  no job forwards secrets to a reusable workflow (`uses:` + `secrets: inherit` or a
//       privileged secret) - a called workflow cannot declare the caller's Environment
//   R4  every secret name in the tree is CLASSIFIED; an unknown one fails until it is added
//       to PRIVILEGED or NON_PRIVILEGED with a reason - so a new credential cannot slip in
//   R5  a workflow triggered by pull_request / pull_request_target has no privileged path
//       (no privileged secret, no production job): PR code never holds production credentials
//   R6  in a dispatchable workflow, every production job's FIRST step refuses a dispatch
//       chained from another workflow's GITHUB_TOKEN (triggering actor github-actions[bot]),
//       which would otherwise run main's job with inputs chosen by branch code
//   R7  composite/JavaScript actions under .github/actions never read `secrets`
//   R8  the whole `secrets` context is never serialised (toJSON(secrets), secrets[...] dynamic)
//   R9  every Actions VARIABLE (`vars.NAME`) is classified: variables are readable from ANY
//       branch, so a credential parked in one would bypass the Environment entirely
//
// It pins RULES, not today's filenames: a workflow added tomorrow is held to the same rules.
// The scanner is stdlib-only (no YAML package) and proves itself on fixtures below before it
// is trusted on the real tree.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- the security contract
// PRIVILEGED: any credential that can WRITE production (database, storage, functions, or
// main itself). Each is issued only through the `production` Environment.
export const PRIVILEGED = {
  SUPABASE_ACCESS_TOKEN: 'Supabase Management API token: arbitrary SQL, DDL, edge-function deploys',
  SUPABASE_DB_URL: 'direct Postgres connection string: arbitrary SQL',
  SUPABASE_SERVICE_ROLE_KEY: 'service role: bypasses row-level security, writes tables and storage',
  EPA_RECOVERY_TOKEN: 'unlocks SECURITY DEFINER epa_recovery_* RPCs (anon-executable) that write',
  DEPLOY_KEY: 'SSH deploy key with the Protect-Main ruleset bypass: pushes directly to main, '
    + 'which would let branch code rewrite the workflows that DO hold the Environment',
};
// NON_PRIVILEGED: public or per-run values that cannot write production.
export const NON_PRIVILEGED = {
  GITHUB_TOKEN: 'per-run token; cannot push to main (ruleset) and its dispatches are refused by R6',
  SUPABASE_URL: 'public project URL',
  SUPABASE_ANON_KEY: 'public anon key (shipped to browsers); row-level security applies',
  MAPS_HOME_LAT: 'a coordinate, not a credential',
  MAPS_HOME_LNG: 'a coordinate, not a credential',
};
// Actions VARIABLES (vars.NAME) in use. Variables are readable from every branch, so a
// credential must never live in one; an unlisted name fails until it is classified here.
export const ALLOWED_VARS = {};
const ENV_NAME = 'production';
const GUARD_NAME = 'Production boundary: refuse a dispatch chained from another workflow';
const GUARD_IF = "github.event_name == 'workflow_dispatch' && github.triggering_actor == 'github-actions[bot]'";

// ---------------------------------------------------------------- stdlib workflow scanner
const indent = (l) => l.length - l.trimStart().length;
const isStruct = (l) => l.trim() !== '' && !l.trimStart().startsWith('#');
const unq = (s) => s.trim().replace(/^['"]|['"]$/g, '');

// Every secrets reference on a line: secrets.NAME, secrets['NAME'], and whole-context uses.
function secretRefs(line) {
  const out = [];
  for (const m of line.matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)) out.push(m[1]);
  for (const m of line.matchAll(/\bsecrets\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g)) out.push(m[1]);
  // Any other use of the context inside an expression: toJSON(secrets), secrets[expr], `secrets }}`.
  const code = line.replace(/\bsecrets\.[A-Za-z0-9_]+/g, '').replace(/\bsecrets\[\s*['"][A-Za-z0-9_]+['"]\s*\]/g, '');
  if (/\$\{\{[^}]*\bsecrets\b/.test(code)) out.push('*WHOLE-SECRETS-CONTEXT*');
  return out;
}

export function scanWorkflow(text) {
  const L = text.split('\n');
  const res = { triggers: new Set(), jobs: {}, workflowLevelRefs: [], vars: [] };
  L.forEach((l, i) => { for (const m of l.matchAll(/\bvars\.([A-Za-z0-9_]+)/g)) res.vars.push({ name: m[1], line: i + 1 }); });
  // ---- triggers
  const onIdx = L.findIndex((l) => /^(on|"on"|'on'):/.test(l));
  if (onIdx >= 0) {
    const inline = L[onIdx].replace(/^(on|"on"|'on'):/, '').trim();
    if (inline) {
      inline.replace(/[[\]]/g, '').split(',').map(unq).filter(Boolean).forEach((t) => res.triggers.add(t));
    } else {
      let T = null;
      for (let i = onIdx + 1; i < L.length; i++) {
        if (!isStruct(L[i])) continue;
        if (indent(L[i]) === 0) break;
        if (T === null) T = indent(L[i]);
        if (indent(L[i]) === T) {
          const k = L[i].trim();
          if (k.startsWith('- ')) res.triggers.add(unq(k.slice(2)));
          else res.triggers.add(unq(k.split(':')[0]));
        }
      }
    }
  }
  // ---- jobs
  const ji = L.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobsEnd = ji < 0 ? L.length : (() => {
    for (let i = ji + 1; i < L.length; i++) if (isStruct(L[i]) && indent(L[i]) === 0) return i;
    return L.length;
  })();
  let J = null;
  if (ji >= 0) for (let i = ji + 1; i < jobsEnd; i++) if (isStruct(L[i])) { J = indent(L[i]); break; }
  const jobStarts = [];
  if (J !== null) for (let i = ji + 1; i < jobsEnd; i++) {
    if (isStruct(L[i]) && indent(L[i]) === J && /:\s*$/.test(L[i])) jobStarts.push(i);
  }
  jobStarts.forEach((s, k) => {
    const e = k + 1 < jobStarts.length ? jobStarts[k + 1] : jobsEnd;
    const name = unq(L[s].trim().replace(/:\s*$/, ''));
    let P = null;
    for (let i = s + 1; i < e; i++) if (isStruct(L[i])) { P = indent(L[i]); break; }
    const job = { name, environment: null, uses: false, inherit: false, refs: [], firstStep: null, line: s + 1 };
    for (let i = s + 1; i < e; i++) {
      const l = L[i];
      for (const r of secretRefs(l)) job.refs.push({ name: r, line: i + 1 });
      if (!isStruct(l) || indent(l) !== P) continue;
      const t = l.trim();
      if (t.startsWith('environment:')) {
        const v = t.slice('environment:'.length).trim();
        if (v) job.environment = unq(v);
        else for (let x = i + 1; x < e && (!isStruct(L[x]) || indent(L[x]) > P); x++) {
          const m = L[x].trim().match(/^name:\s*(.+)$/);
          if (m && isStruct(L[x])) { job.environment = unq(m[1]); break; }
        }
      }
      if (t.startsWith('uses:')) job.uses = true;
      if (/^secrets:\s*inherit\s*$/.test(t)) job.inherit = true;
      if (t === 'steps:') {
        let x = i + 1;
        while (x < e && !isStruct(L[x])) x++;
        if (x < e && L[x].trimStart().startsWith('- ')) {
          const S = indent(L[x]);
          let y = x + 1;
          while (y < e && (!isStruct(L[y]) || indent(L[y]) > S)) y++;
          job.firstStep = L.slice(x, y).join('\n');
        }
      }
    }
    res.jobs[name] = job;
  });
  // ---- references outside any job (workflow-level env, defaults, on: inputs ...)
  L.forEach((l, i) => {
    const inJob = jobStarts.some((s, k) => i > s && i < (k + 1 < jobStarts.length ? jobStarts[k + 1] : jobsEnd));
    if (!inJob) for (const r of secretRefs(l)) res.workflowLevelRefs.push({ name: r, line: i + 1 });
  });
  return res;
}

const isPriv = (n) => n === '*WHOLE-SECRETS-CONTEXT*' || n in PRIVILEGED;

export function violations(files) {           // files: [{path, text}]
  const v = [];
  for (const { path, text } of files) {
    if (/\.github\/actions\//.test(path)) {
      if (/\bsecrets\b/.test(text.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n'))) {
        v.push(`R7 ${path}: an action reads the secrets context`);
      }
      continue;
    }
    const w = scanWorkflow(text);
    const pr = w.triggers.has('pull_request') || w.triggers.has('pull_request_target');
    const dispatch = w.triggers.has('workflow_dispatch');
    for (const r of w.vars) {
      if (!(r.name in ALLOWED_VARS)) v.push(`R9 ${path}:${r.line} Actions variable vars.${r.name} is unclassified (variables are readable from any branch)`);
    }
    for (const r of w.workflowLevelRefs) {
      if (!(r.name in PRIVILEGED) && !(r.name in NON_PRIVILEGED)) v.push(`R4 ${path}:${r.line} unclassified secret ${r.name}`);
      if (isPriv(r.name)) v.push(`R2 ${path}:${r.line} privileged ${r.name} referenced outside a job`);
    }
    for (const j of Object.values(w.jobs)) {
      const priv = j.refs.filter((r) => isPriv(r.name));
      for (const r of j.refs) {
        if (r.name === '*WHOLE-SECRETS-CONTEXT*') v.push(`R8 ${path}:${r.line} job ${j.name} serialises the whole secrets context`);
        else if (!(r.name in PRIVILEGED) && !(r.name in NON_PRIVILEGED)) v.push(`R4 ${path}:${r.line} unclassified secret ${r.name}`);
      }
      const prod = j.environment === ENV_NAME;
      if (priv.length && !prod) v.push(`R1 ${path} job ${j.name}: uses ${[...new Set(priv.map((r) => r.name))].join(',')} without environment: ${ENV_NAME}`);
      if (j.uses && (j.inherit || priv.length)) v.push(`R3 ${path} job ${j.name}: forwards ${j.inherit ? 'secrets: inherit' : 'privileged secrets'} to a reusable workflow`);
      if (pr && (priv.length || prod)) v.push(`R5 ${path} job ${j.name}: a pull_request-triggered workflow has a production path`);
      if (prod && dispatch) {
        const fs = j.firstStep || '';
        if (!fs.includes(GUARD_NAME) || !fs.includes(GUARD_IF) || !/exit 1/.test(fs)) {
          v.push(`R6 ${path} job ${j.name}: first step is not the chained-dispatch refusal`);
        }
      }
    }
  }
  return v;
}

function treeFiles() {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ya?ml$/.test(f)) out.push({ path: p.slice(root.length + 1), text: readFileSync(p, 'utf8') });
    }
  };
  walk(join(root, '.github', 'workflows'));
  walk(join(root, '.github', 'actions'));
  return out;
}

// ---------------------------------------------------------------- run (only when executed)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let fails = 0;
  const ok = (c, n) => { if (!c) { fails++; console.error('FAIL ' + n); } else console.log('ok   ' + n); };

  // ---- 1. the scanner proves itself on fixtures, one per rule, before the tree is trusted
  const G = (extra = '') => `      - name: '${GUARD_NAME}'\n        if: ${GUARD_IF}\n        run: |\n          exit 1\n${extra}`;
  const wf = (on, jobs, top = '') => `name: t\non:\n${on}\n${top}jobs:\n${jobs}`;
  const fx = {
    clean: wf('  workflow_dispatch: {}', `  a:\n    environment: production\n    runs-on: x\n    steps:\n${G()}      - run: echo \${{ secrets.SUPABASE_DB_URL }}\n`),
    cleanMappingEnv: wf('  schedule:\n    - cron: "1 1 * * *"', `  a:\n    environment:\n      name: production\n      url: https://x\n    steps:\n      - run: echo \${{ secrets.DEPLOY_KEY }}\n`),
    R1: wf('  schedule:\n    - cron: "1 1 * * *"', `  a:\n    runs-on: x\n    steps:\n      - run: echo \${{ secrets.SUPABASE_ACCESS_TOKEN }}\n`),
    R1wrongEnv: wf('  schedule:\n    - cron: "1 1 * * *"', `  a:\n    environment: staging\n    steps:\n      - run: echo \${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}\n`),
    R2: wf('  schedule:\n    - cron: "1 1 * * *"', `  a:\n    environment: production\n    steps:\n      - run: echo hi\n`, 'env:\n  X: ${{ secrets.SUPABASE_DB_URL }}\n'),
    R3inherit: wf('  workflow_dispatch: {}', `  a:\n    uses: ./.github/workflows/other.yml\n    secrets: inherit\n`),
    R3explicit: wf('  workflow_dispatch: {}', `  a:\n    uses: org/repo/.github/workflows/x.yml@main\n    secrets:\n      token: \${{ secrets.SUPABASE_ACCESS_TOKEN }}\n`),
    R4: wf('  schedule:\n    - cron: "1 1 * * *"', `  a:\n    environment: production\n    steps:\n      - run: echo \${{ secrets.SUPABASE_PROD_PASSWORD }}\n`),
    R5: wf('  pull_request:\n    paths: [x]\n  workflow_dispatch: {}', `  a:\n    environment: production\n    steps:\n${G()}      - run: echo \${{ secrets.SUPABASE_DB_URL }}\n`),
    R5inline: wf('', `  a:\n    environment: production\n    steps:\n      - run: echo \${{ secrets.SUPABASE_DB_URL }}\n`).replace('on:\n\n', 'on: [pull_request]\n'),
    R6: wf('  workflow_dispatch: {}', `  a:\n    environment: production\n    steps:\n      - run: echo \${{ secrets.SUPABASE_DB_URL }}\n${G()}`),
    R8: wf('  schedule:\n    - cron: "1 1 * * *"', `  a:\n    runs-on: x\n    steps:\n      - run: echo '\${{ toJSON(secrets) }}'\n`),
    bracket: wf('  schedule:\n    - cron: "1 1 * * *"', `  a:\n    runs-on: x\n    steps:\n      - run: echo \${{ secrets['SUPABASE_DB_URL'] }}\n`),
  };
  const V = (name) => violations([{ path: `.github/workflows/${name}.yml`, text: fx[name] }]);
  ok(V('clean').length === 0, 'fixture: a protected, guarded job is clean ' + JSON.stringify(V('clean')));
  ok(V('cleanMappingEnv').length === 0, 'fixture: `environment: {name: production}` mapping form is recognised');
  ok(V('R1').some((x) => x.startsWith('R1')), 'fixture R1: privileged secret in an unprotected job fails');
  ok(V('R1wrongEnv').some((x) => x.startsWith('R1')), 'fixture R1: another Environment name is not production');
  ok(V('R2').some((x) => x.startsWith('R2')), 'fixture R2: workflow-level env carrying a privileged secret fails');
  ok(V('R3inherit').some((x) => x.startsWith('R3')), 'fixture R3: secrets: inherit to a reusable workflow fails');
  ok(V('R3explicit').some((x) => x.startsWith('R3')), 'fixture R3: a privileged secret passed to a reusable workflow fails');
  ok(V('R4').some((x) => x.startsWith('R4')), 'fixture R4: an unclassified secret name fails');
  ok(V('R5').some((x) => x.startsWith('R5')), 'fixture R5: a pull_request workflow with a production job fails');
  ok(V('R5inline').some((x) => x.startsWith('R5')), 'fixture R5: inline `on: [pull_request]` is recognised');
  ok(V('R6').some((x) => x.startsWith('R6')), 'fixture R6: the guard present but NOT first fails');
  ok(violations([{ path: '.github/actions/x/action.yml', text: 'runs:\n  using: composite\n  steps:\n    - run: echo ${{ secrets.X }}\n' }])
    .some((x) => x.startsWith('R7')), 'fixture R7: an action reading secrets fails');
  ok(V('R8').some((x) => x.startsWith('R8')), 'fixture R8: toJSON(secrets) fails');
  ok(V('bracket').some((x) => x.startsWith('R1')), 'fixture: secrets[\'NAME\'] is read like secrets.NAME');
  ok(violations([{ path: '.github/workflows/v.yml', text: wf('  schedule:\n    - cron: "1 1 * * *"', `  a:\n    runs-on: x\n    steps:\n      - run: echo \${{ vars.SUPABASE_DB_URL }}\n`) }])
    .some((x) => x.startsWith('R9')), 'fixture R9: an unclassified Actions variable fails');

  // ---- 2. the real tree
  const files = treeFiles();
  ok(files.length >= 50, `scanned ${files.length} workflow/action files (positive control: the tree was read)`);
  const all = files.filter((f) => !/\.github\/actions\//.test(f.path)).map((f) => ({ f, w: scanWorkflow(f.text) }));
  const protectedJobs = all.flatMap(({ f, w }) => Object.values(w.jobs).filter((j) => j.environment === ENV_NAME).map((j) => `${f.path}#${j.name}`));
  const privRefs = all.flatMap(({ w }) => Object.values(w.jobs).flatMap((j) => j.refs.filter((r) => isPriv(r.name))));
  ok(privRefs.length > 0 && protectedJobs.length > 0,
    `positive control: ${privRefs.length} privileged references across ${protectedJobs.length} production jobs were found`);
  const v = violations(files);
  ok(v.length === 0, 'the production credential boundary holds across the whole tree' + (v.length ? ':\n  ' + v.join('\n  ') : ''));
  const unused = Object.keys(PRIVILEGED).filter((n) => !privRefs.some((r) => r.name === n));
  ok(unused.length === 0, 'every PRIVILEGED entry is still in use (a stale entry is a contract no one reads): ' + unused.join(','));
  console.log('production jobs:\n  ' + protectedJobs.sort().join('\n  '));

  if (fails) { console.error(`\n${fails} failure(s)`); process.exit(1); }
  console.log('\nproduction credential boundary: all checks passed');
}
