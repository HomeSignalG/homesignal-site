// The production-credential boundary, on the two NEW production workflows only:
//   .github/workflows/db-read.yml
//   .github/workflows/verify-production-environment.yml
//
// Each job must:
//   ENV         carry exactly ENV_LINE, at job indent, on the line immediately before runs-on:;
//   BOUNDARY    have BOUNDARY_STEP as its FIRST step, byte for byte (comment lines removed, dedented);
//   SECRET      take PROD_ secrets only as the whole value of a step-level env key, reference no
//               other secret anywhere (comments included: GitHub expands ${{ }} inside run comments),
//               and reference at least one PROD_ secret (a bare environment that guards nothing is noise);
//   RUN_EXPR    contain no ${{ }} inside run:, shell:, working-directory: or with: values outside the
//               R15 allowlist, so every input reaches the shell only through env;
//   STATUS_IF   (design R11) give every step that holds a PROD_ secret and whose if: calls always(),
//               failure() or cancelled() the top-level conjunct steps.boundary.outcome != 'failure',
//               with no ||: those steps still run after the boundary step refuses;
//   CHECKOUT_REF (design R12) pass no ref: or repository: to actions/checkout.
// Each workflow must:
//   TRIGGER     be workflow_dispatch only (no pull_request, pull_request_target or workflow_run);
//   PERMISSIONS be exactly `contents: read`, with no job-level override;
//   DEFAULTS    set no defaults: or container:, and no env key BASH_ENV, ENV, BASH_FUNC_*, SHELLOPTS,
//               BASHOPTS or PS4 in any form (block, flow, quoted): each can re-route or neuter the
//               boundary step's shell (BASH_FUNC_exit%% turns its exit 1 into a no-op) while its text
//               stays byte-equal;
//   ACTION_PIN  pin any action outside actions/* to a full 40-hex commit SHA with its tag in a comment;
//   NO_REDIRECT send no Authorization header through urllib unless redirects are refused (a followed
//               redirect resends the header to the new URL): the NoRedirect opener, never urlopen.
// db-read.yml must also:
//   READ_ONLY   name exactly one API URL (non-comment lines): the canonical ENDPOINT line for
//               /database/query/read-only, used as the URL of the only Request(.
//
// The canonical text and constants live in ONE place, test/lib/production-boundary.mjs, and the line
// scanner in test/lib/production-boundary-scan.mjs. The rules for EVERY workflow (the 19 jobs moved onto
// the environment on 2026-10-25 among them) are test/production-boundary.test.mjs; this file holds the
// two workflows built for the environment to stricter rules. HYGIENE, NOT THE BOUNDARY:
// a PR can edit this test, and a line scanner cannot follow code that builds a URL or an expression
// from fragments; the environment's main-only branch rule is what enforces.
//
// Every check is load-bearing: in-memory fixtures prove it fails on a violating copy, and mutations of
// the real files prove it fires on them too (each mutation first asserts that the text changed).
//
// Run: node test/production-boundary-new-workflows.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRIVILEGED_ENV, RETIRED, PRIVILEGED_PENDING, NON_PRIVILEGED, ALLOWED_VARS,
  ENV_LINE, BOUNDARY_STEP, BOUNDARY_STEP_SOURCE, boundaryStepYaml, stripCommentLines, isCommentLine,
  runExpressionAllowed,
} from './lib/production-boundary.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wfDir = join(root, '.github', 'workflows');
const NEW_WORKFLOWS = ['db-read.yml', 'verify-production-environment.yml'];

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

import {
  indentOf, blank, skippable, topBlock, triggerNames, parseJobs, firstStep, dedent, keyBlocks, runBlocks, stepsOf, stepKey, ifExpression, topLevelAnd, BOUNDARY_CONJUNCT, SHELL_ENV_KEY, SECRET_REF, STEP_ENV_SECRET, mut,
} from './lib/production-boundary-scan.mjs';

// The one URL db-read may name, and the forms that must be absent elsewhere (non-comment lines).
const ENDPOINT_LINE = 'ENDPOINT = "https://api.supabase.com/v1/projects/%s/database/query/read-only" % REF';

/** Violations of the new-workflow rules, each prefixed with its check code. */
export function violations(name, text) {
  const out = [];
  const v = (code, msg) => out.push(`${code} ${name}: ${msg}`);
  const lines = text.split('\n');

  // TRIGGER
  const on = topBlock(lines, /^(on|"on"|'on')\s*:/);
  if (!on) v('TRIGGER', 'no on: block');
  else {
    const names = triggerNames(on);
    if (names.length !== 1 || names[0] !== 'workflow_dispatch') {
      const banned = names.filter((t) => ['pull_request', 'pull_request_target', 'workflow_run'].includes(t));
      v('TRIGGER', (banned.length ? `${banned.join(', ')} not allowed; ` : '') +
        `triggers must be exactly [workflow_dispatch], found [${names.join(', ')}]`);
    }
  }

  // PERMISSIONS
  const perm = topBlock(lines, /^permissions\s*:/);
  if (!perm) v('PERMISSIONS', 'no workflow-level permissions:');
  else {
    const entries = perm.inline
      ? perm.inline.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
      : perm.body.filter((l) => !skippable(l)).map((l) => l.replace(/\s+#.*$/, '').trim());
    if (entries.length !== 1 || entries[0].replace(/\s+/g, ' ') !== 'contents: read') {
      v('PERMISSIONS', `workflow permissions must be exactly "contents: read", found [${entries.join('; ')}]`);
    }
  }

  // DEFAULTS (workflow level), and shell-start env keys anywhere, in block, flow or quoted form
  if (lines.some((l) => /^defaults\s*:/.test(l))) v('DEFAULTS', 'workflow-level defaults: is not allowed');
  lines.forEach((l, i) => {
    const m = isCommentLine(l) ? null : l.match(SHELL_ENV_KEY);
    if (m) v('DEFAULTS', `line ${i + 1}: env key ${m[2]} is not allowed (it can re-route or neuter the boundary step's shell)`);
  });

  // ACTION_PIN
  lines.forEach((l, i) => {
    if (isCommentLine(l)) return;
    const m = l.match(/^\s*(?:- )?uses\s*:\s*['"]?([^'"\s#]+)['"]?\s*(#.*)?$/);
    if (!m) return;
    const [, ref, comment] = m;
    if (ref.startsWith('./') || /^actions\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_./-]+)?@\S+$/.test(ref)) return;
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/.test(ref) && comment && /#\s*\S/.test(comment)) return;
    v('ACTION_PIN', `line ${i + 1}: ${ref} is not pinned to a 40-hex commit SHA with its tag in a comment`);
  });

  // SECRET: every reference, anywhere in the file (comments included)
  const secretLines = new Set();
  lines.forEach((l, i) => {
    if (!SECRET_REF.test(l)) return;
    const m = l.match(STEP_ENV_SECRET);
    if (!m || !Object.hasOwn(PRIVILEGED_ENV, m[2])) {
      v('SECRET', `line ${i + 1}: a secret may appear only as the whole value of a step-level env key naming a PROD_ secret: ${l.trim()}`);
      return;
    }
    let k = i - 1;
    while (k >= 0 && (skippable(lines[k]) || indentOf(lines[k]) >= 10)) k--;
    if (k < 0 || !/^ {8}env\s*:\s*$/.test(lines[k])) { v('SECRET', `line ${i + 1}: not inside a step-level env:`); return; }
    let s = k - 1;
    while (s >= 0 && (skippable(lines[s]) || indentOf(lines[s]) >= 8)) s--;
    if (s < 0 || !/^ {6}- /.test(lines[s])) { v('SECRET', `line ${i + 1}: its env: is not a step's`); return; }
    secretLines.add(i);
  });

  // RUN_EXPR: run:, and the other values that reach a shell or an action as text
  const runs = runBlocks(lines);
  const inRun = new Set();
  for (const r of runs) for (let k = r.start + 1; k < r.end; k++) inRun.add(k);
  const scanned = [['run', runs], ...['shell', 'working-directory', 'with'].map((key) => [key, keyBlocks(lines, key, inRun)])];
  for (const [key, blocks] of scanned) {
    for (const r of blocks) {
      const body = r.text.split('\n').filter((l) => !isCommentLine(l) || key === 'run').join('\n');
      const exprs = [...body.matchAll(/\$\{\{([\s\S]*?)\}\}/g)];
      if ((body.match(/\$\{\{/g) || []).length !== exprs.length) v('RUN_EXPR', `${key}: at line ${r.line} has an unclosed \${{`);
      for (const e of exprs) {
        if (!runExpressionAllowed(e[1])) v('RUN_EXPR', `${key}: at line ${r.line} expands \${{${e[1]}}}; pass it through env instead`);
      }
    }
  }

  // NO_REDIRECT
  const code = lines.filter((l) => !isCommentLine(l)).join('\n');
  if (/\burlopen\s*\(/.test(code)) v('NO_REDIRECT', 'urlopen( follows redirects and resends the Authorization header; use OPENER.open(');
  for (const m of code.matchAll(/build_opener\(([^)]*)\)/g)) {
    if (m[1].trim() !== 'NoRedirect') v('NO_REDIRECT', `build_opener(${m[1]}) is not build_opener(NoRedirect)`);
  }
  for (const m of code.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\.open\(/g)) {
    if (m[1] !== 'OPENER') v('NO_REDIRECT', `${m[1]}.open( is not the NoRedirect OPENER`);
  }
  if (/Authorization/.test(code) && !(
    /class NoRedirect\(urllib\.request\.HTTPRedirectHandler\):/.test(code) &&
    /def redirect_request\(self, req, fp, code, msg, headers, newurl\):\s*\n\s*return None\s*\n/.test(code) &&
    /OPENER = urllib\.request\.build_opener\(NoRedirect\)/.test(code) && /\bOPENER\.open\(/.test(code))) {
    v('NO_REDIRECT', 'sends an Authorization header without the NoRedirect opener (redirect_request returning None)');
  }

  // Per job: ENV, BOUNDARY, SECRET (at least one), PERMISSIONS / DEFAULTS overrides
  const jobs = parseJobs(lines);
  if (!jobs || !jobs.length) { v('ENV', 'no jobs found'); return out; }
  for (const job of jobs) {
    const jl = job.body;
    const envLines = jl.filter(({ l }) => !isCommentLine(l) && /^\s*environment\s*:/.test(l));
    if (envLines.length !== 1) v('ENV', `${job.name}: ${envLines.length} environment lines, expected exactly 1`);
    const runsOn = jl.findIndex(({ l }) => /^ {4}runs-on\s*:/.test(l));
    if (runsOn < 0) v('ENV', `${job.name}: no runs-on: at job indent`);
    else if (runsOn === 0 || jl[runsOn - 1].l !== '    ' + ENV_LINE) {
      v('ENV', `${job.name}: the line immediately before runs-on: is not exactly "${ENV_LINE}" at job indent`);
    }

    for (const key of ['permissions', 'defaults', 'container']) {
      if (jl.some(({ l }) => new RegExp(`^ {4}${key}\\s*:`).test(l))) {
        v(key === 'permissions' ? 'PERMISSIONS' : 'DEFAULTS', `${job.name}: job-level ${key}: is not allowed`);
      }
    }

    const step = firstStep(job);
    if (step.error) v('BOUNDARY', `${job.name}: ${step.error}`);
    else {
      const got = dedent(stripCommentLines(step.text), 6);
      if (got !== BOUNDARY_STEP) v('BOUNDARY', `${job.name}: the first step is not byte-equal to BOUNDARY_STEP (test/lib/production-boundary.mjs)`);
    }

    if (!jl.some(({ n }) => secretLines.has(n))) v('SECRET', `${job.name}: names production but references no PROD_ secret`);

    for (const step of stepsOf(job)) {
      const at = `${job.name}, step at line ${step[0].n + 1}`;
      // STATUS_IF (R11)
      const iff = stepKey(step, 'if');
      if (iff !== null && step.some(({ n }) => secretLines.has(n))) {
        const e = ifExpression(iff);
        if (/\b(always|failure|cancelled)\s*\(/.test(e)) {
          if (e.includes('||')) v('STATUS_IF', `${at}: a status-function if: holding a PROD_ secret may not contain ||`);
          else if (!topLevelAnd(e).some((c) => c.replace(/\s+/g, ' ') === BOUNDARY_CONJUNCT)) {
            v('STATUS_IF', `${at}: a status-function if: holding a PROD_ secret needs the top-level conjunct ${BOUNDARY_CONJUNCT}`);
          }
        }
      }
      // CHECKOUT_REF (R12)
      const uses = stepKey(step, 'uses');
      if (uses !== null && /^\s*['"]?actions\/checkout@/.test(uses)) {
        const w = stepKey(step, 'with');
        if (w !== null && /(^|[\s{,])['"]?(ref|repository)['"]?\s*:/m.test(w)) {
          v('CHECKOUT_REF', `${at}: actions/checkout may not take ref: or repository: in a production job`);
        }
      }
    }
  }

  // READ_ONLY (db-read.yml only), on non-comment lines
  if (name === 'db-read.yml') {
    const urlLines = lines.filter((l) => !isCommentLine(l) && /api\.supabase\.com|\/database\//.test(l));
    if (urlLines.length !== 1 || urlLines[0].trim() !== ENDPOINT_LINE) {
      v('READ_ONLY', `exactly one non-comment line may name the API, and it must be: ${ENDPOINT_LINE} (found ${urlLines.length})`);
    }
    const requests = code.match(/\bRequest\(/g) || [];
    if (requests.length !== 1 || !/\bRequest\(\s*ENDPOINT\s*,/.test(code)) {
      v('READ_ONLY', `the only Request( must take ENDPOINT as its URL (found ${requests.length} Request()`);
    }
  }
  return out;
}

const codes = (vs) => [...new Set(vs.map((x) => x.split(' ')[0]))].sort();

// ── 1. the constants ────────────────────────────────────────────────────────────────────────────
ok(ENV_LINE === 'environment: { name: production, deployment: false }', 'ENV_LINE is the one accepted environment form');
ok(BOUNDARY_STEP === stripCommentLines(BOUNDARY_STEP_SOURCE) && !BOUNDARY_STEP.split('\n').some(isCommentLine),
  'BOUNDARY_STEP is BOUNDARY_STEP_SOURCE with its comment lines removed');
ok(BOUNDARY_STEP.startsWith("- name: 'Production boundary: refuse a dispatch the operator did not start'\n  id: boundary\n"),
  'BOUNDARY_STEP opens with its name and id: boundary');
ok(BOUNDARY_STEP.includes("  if: github.event_name == 'workflow_dispatch' && (github.actor != 'HomeSignalG' || github.triggering_actor != 'HomeSignalG')\n"),
  'BOUNDARY_STEP refuses a dispatch unless BOTH actor and triggering_actor are the operator');
ok(BOUNDARY_STEP.endsWith('\n    exit 1') && !/continue-on-error/.test(BOUNDARY_STEP), 'BOUNDARY_STEP ends in exit 1 and never continues on error');
ok(boundaryStepYaml(6).split('\n').every((l) => l === '' || l.startsWith('      ')), 'boundaryStepYaml(6) indents every line for a steps: list');
ok(JSON.stringify(RETIRED.map((n) => 'PROD_' + n).sort()) === JSON.stringify(Object.keys(PRIVILEGED_ENV).sort()),
  'each PRIVILEGED_ENV name is PROD_ + a RETIRED name, and nothing else');
const lists = [Object.keys(PRIVILEGED_ENV), RETIRED, Object.keys(PRIVILEGED_PENDING), Object.keys(NON_PRIVILEGED)];
const all = lists.flat();
ok(new Set(all).size === all.length, 'no secret name is in two of PRIVILEGED_ENV / RETIRED / PRIVILEGED_PENDING / NON_PRIVILEGED');
ok(Object.values(PRIVILEGED_PENDING).every((e) => Array.isArray(e.jobs) && e.jobs.length && e.jobs.every((j) => /^[a-z0-9-]+\.yml#[A-Za-z0-9_-]+$/.test(j)) && e.reason),
  'every PRIVILEGED_PENDING entry names its jobs (workflow.yml#job) and a reason');
ok(Object.values({ ...PRIVILEGED_ENV, ...NON_PRIVILEGED }).every((r) => typeof r === 'string' && r.length > 0), 'every classified name carries a reason');
ok(typeof ALLOWED_VARS === 'object' && Object.keys(ALLOWED_VARS).length === 0, 'ALLOWED_VARS is empty');
ok(runExpressionAllowed(' github.sha ') && runExpressionAllowed('steps.boundary.outputs.x') &&
   !runExpressionAllowed('inputs.x') && !runExpressionAllowed('github.event.inputs.x') && !runExpressionAllowed('github.head_ref'),
  'the R15 run-expression allowlist accepts github.sha and step outputs, refuses inputs and head_ref');

// ── 2. in-memory fixtures: a clean job passes, and each check fails on a violating copy ─────────
const BASE = [
  'name: fx',
  'on:',
  '  workflow_dispatch:',
  '    inputs:',
  '      x: { required: false, type: string }',
  'permissions:',
  '  contents: read',
  'jobs:',
  '  read:',
  '    ' + ENV_LINE,
  '    runs-on: ubuntu-latest',
  '    env:',
  '      INPUT_X: ${{ inputs.x }}',
  '    steps:',
  boundaryStepYaml(6),
  '      # a comment between steps is not part of the step',
  '      - uses: actions/checkout@v4',
  '      - name: work',
  '        env:',
  '          TOKEN: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}',
  '        run: |',
  '          echo "$INPUT_X" "${{ github.sha }}" "${{ steps.boundary.outputs.none }}"',
  '          ' + ENDPOINT_LINE,
  '          req = urllib.request.Request(ENDPOINT, data=b"")',
  '',
].join('\n');

let missed = false;
try { mut(BASE, 'text that is not in the fixture', 'x'); } catch { missed = true; }
ok(missed, 'harness control: an edit that does not apply throws instead of producing an unchanged fixture');
let twice = false;
try { mut('a a', 'a', 'b'); } catch { twice = true; }
ok(twice, 'harness control: an edit that matches twice throws instead of editing the wrong place');

const IF_LINE = "        if: github.event_name == 'workflow_dispatch' && (github.actor != 'HomeSignalG' || github.triggering_actor != 'HomeSignalG')";
ok(BASE.includes(IF_LINE + '\n'), 'fixture control: the base carries the canonical if: line');
ok(violations('fx.yml', BASE).length === 0, 'clean fixture passes every check' + (violations('fx.yml', BASE).length ? ': ' + violations('fx.yml', BASE).join(' | ') : ''));
ok(violations('db-read.yml', BASE).length === 0, 'clean fixture passes as db-read.yml (read-only endpoint named)');

/** A later step with the given if:, holding a PROD_ secret unless withSecret is false. */
function statusStep(cond, withSecret = true) {
  return ['      - name: report', `        if: ${cond}`,
    ...(withSecret ? ['        env:', '          T: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}'] : []),
    '        run: echo report', ''].join('\n');
}
// The redirect-refusing opener, as the two workflows write it (run-block indent).
const NR_BLOCK = [
  '          class NoRedirect(urllib.request.HTTPRedirectHandler):',
  '              def redirect_request(self, req, fp, code, msg, headers, newurl):',
  '                  return None',
  '          OPENER = urllib.request.build_opener(NoRedirect)',
  '          h = {"Authorization": "Bearer x"}',
  '          OPENER.open(req)',
  '',
].join('\n');

const near = [
  ['an extra comment line inside the boundary step', mut(BASE, '        id: boundary\n', '        id: boundary\n        # an extra comment\n')],
  ['a third-party action pinned to a SHA with its tag', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n      - uses: owner/tool@0123456789abcdef0123456789abcdef01234567 # v1.2.3\n')],
  ['permissions in flow form', mut(BASE, 'permissions:\n  contents: read\n', 'permissions: { contents: read }\n')],
  ['a second PROD_ secret in the same step env', mut(BASE, '          TOKEN: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n', '          TOKEN: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n          DB: ${{ secrets.PROD_SUPABASE_DB_URL }}\n')],
  ['a status-function step holding a secret, with the boundary conjunct', BASE + statusStep("always() && steps.boundary.outcome != 'failure'")],
  ['the same, wrapped in ${{ }} with failure()', BASE + statusStep("${{ failure() && steps.boundary.outcome != 'failure' }}")],
  ['a status-function step holding no secret', BASE + statusStep('always()', false)],
  ['a secret-holding step whose if: calls no status function', BASE + statusStep("github.ref == 'refs/heads/main'")],
  ['checkout with sparse-checkout and persist-credentials only', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n        with:\n          sparse-checkout: /config.js\n          persist-credentials: false\n')],
  ['a with: value expanding github.sha', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n        with:\n          path: ${{ github.sha }}\n')],
  ['an env key that merely contains ENV (MY_ENV)', mut(BASE, '      INPUT_X: ${{ inputs.x }}\n', '      INPUT_X: ${{ inputs.x }}\n      MY_ENV: x\n')],
  ['an Authorization header sent through the NoRedirect opener', mut(BASE, '          ENDPOINT = ', NR_BLOCK + '          ENDPOINT = ')],
];
for (const [label, text] of near) {
  const vs = violations('fx.yml', text);
  ok(vs.length === 0, `near miss passes: ${label}` + (vs.length ? ': ' + vs.join(' | ') : ''));
}

const STEP_SECRET = '          TOKEN: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n';
const BAD = [
  // TRIGGER
  ['TRIGGER', 'pull_request trigger', mut(BASE, 'on:\n', 'on:\n  pull_request:\n')],
  ['TRIGGER', 'pull_request_target trigger', mut(BASE, 'on:\n', 'on:\n  pull_request_target:\n')],
  ['TRIGGER', 'workflow_run trigger', mut(BASE, 'on:\n', 'on:\n  workflow_run:\n    workflows: [x]\n')],
  ['TRIGGER', 'a schedule beside workflow_dispatch', mut(BASE, 'on:\n', "on:\n  schedule:\n    - cron: '0 0 * * *'\n")],
  ['TRIGGER', 'list-form trigger with pull_request', mut(BASE, 'on:\n  workflow_dispatch:\n    inputs:\n      x: { required: false, type: string }\n', 'on: [workflow_dispatch, pull_request]\n')],
  // ENV
  ['ENV', 'no environment line', mut(BASE, '    ' + ENV_LINE + '\n', '')],
  ['ENV', 'scalar environment: production', mut(BASE, '    ' + ENV_LINE + '\n', '    environment: production\n')],
  ['ENV', 'deployment: true', mut(BASE, '    ' + ENV_LINE + '\n', '    environment: { name: production, deployment: true }\n')],
  ['ENV', 'block-mapping environment', mut(BASE, '    ' + ENV_LINE + '\n', '    environment:\n      name: production\n')],
  ['ENV', 'environment line after runs-on', mut(BASE, '    ' + ENV_LINE + '\n    runs-on: ubuntu-latest\n', '    runs-on: ubuntu-latest\n    ' + ENV_LINE + '\n')],
  ['ENV', 'a key between the environment line and runs-on', mut(BASE, '    ' + ENV_LINE + '\n', '    ' + ENV_LINE + '\n    timeout-minutes: 5\n')],
  ['ENV', 'no runs-on', mut(BASE, '    runs-on: ubuntu-latest\n', '')],
  ['ENV', 'environment line twice', mut(BASE, '    ' + ENV_LINE + '\n', '    ' + ENV_LINE + '\n    ' + ENV_LINE + '\n')],
  // BOUNDARY
  ['BOUNDARY', 'boundary step missing', mut(BASE, boundaryStepYaml(6) + '\n', '')],
  ['BOUNDARY', 'boundary step second', mut(mut(BASE, '      - uses: actions/checkout@v4\n', ''), '    steps:\n', '    steps:\n      - uses: actions/checkout@v4\n')],
  ['BOUNDARY', 'if: false && prefix', mut(BASE, IF_LINE, IF_LINE.replace('if: ', 'if: false && '))],
  ['BOUNDARY', 'continue-on-error added', mut(BASE, '        id: boundary\n', '        id: boundary\n        continue-on-error: true\n')],
  ['BOUNDARY', 'actor-only clause (triggering_actor dropped)', mut(BASE, IF_LINE, "        if: github.event_name == 'workflow_dispatch' && github.actor != 'HomeSignalG'")],
  ['BOUNDARY', "#1333's denylist", mut(BASE, IF_LINE, "        if: github.event_name == 'workflow_dispatch' && github.triggering_actor == 'github-actions[bot]'")],
  ['BOUNDARY', 'exit 1 softened', mut(BASE, '          exit 1\n', '          exit 0\n')],
  ['BOUNDARY', 'trailing whitespace on a step line', mut(BASE, '        id: boundary\n', '        id: boundary \n')],
  // SECRET
  ['SECRET', 'PROD_ secret in job env', mut(mut(BASE, STEP_SECRET, '          TOKEN: x\n'), '      INPUT_X: ${{ inputs.x }}\n', '      INPUT_X: ${{ inputs.x }}\n      TOKEN: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n')],
  ['SECRET', 'PROD_ secret in with:', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n        with:\n          token: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n')],
  ['SECRET', 'PROD_ secret in run text', mut(BASE, '          ENDPOINT = ', '          echo ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n          ENDPOINT = ')],
  ['SECRET', 'PROD_ secret inside a larger expression', mut(BASE, STEP_SECRET, '          TOKEN: ${{ github.sha && secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n')],
  ['SECRET', 'PROD_ secret with text around it', mut(BASE, STEP_SECRET, '          TOKEN: Bearer ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n')],
  ['SECRET', 'a retired name as a step env value', mut(BASE, STEP_SECRET, '          TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n')],
  ['SECRET', 'a secret in a YAML comment', mut(BASE, '    steps:\n', '    # ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n    steps:\n')],
  ['SECRET', 'toJSON(secrets)', mut(BASE, STEP_SECRET, STEP_SECRET + '          ALL: ${{ toJSON(secrets) }}\n')],
  ['SECRET', 'secrets[expr]', mut(BASE, STEP_SECRET, STEP_SECRET + "          ONE: ${{ secrets['PROD_SUPABASE_DB_URL'] }}\n")],
  ['SECRET', 'workflow-level env holding a PROD_ secret', mut(BASE, 'jobs:\n', 'env:\n  TOKEN: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\njobs:\n')],
  ['SECRET', 'a production job with no PROD_ secret', mut(BASE, STEP_SECRET, '          TOKEN: x\n')],
  // RUN_EXPR
  ['RUN_EXPR', 'inputs.x in run', mut(BASE, '          ENDPOINT = ', '          echo "${{ inputs.x }}"\n          ENDPOINT = ')],
  ['RUN_EXPR', 'github.event.inputs.x in run', mut(BASE, '          ENDPOINT = ', '          echo "${{ github.event.inputs.x }}"\n          ENDPOINT = ')],
  ['RUN_EXPR', 'github.head_ref in run', mut(BASE, '          ENDPOINT = ', '          echo "${{ github.head_ref }}"\n          ENDPOINT = ')],
  ['RUN_EXPR', 'inline run: with an input', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n      - run: echo ${{ inputs.x }}\n')],
  ['RUN_EXPR', 'unclosed ${{', mut(BASE, '          ENDPOINT = ', '          echo "${{ github.sha"\n          ENDPOINT = ')],
  ['RUN_EXPR', 'an input expanded into shell:', mut(BASE, '      - name: work\n', '      - name: work\n        shell: ${{ inputs.x }} {0}\n')],
  ['RUN_EXPR', 'an input expanded into working-directory:', mut(BASE, '      - name: work\n', '      - name: work\n        working-directory: ${{ inputs.x }}\n')],
  ['RUN_EXPR', 'an input expanded into a with: value', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n        with:\n          path: ${{ inputs.x }}\n')],
  ['RUN_EXPR', 'an input in a flow-form with:', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n        with: { path: "${{ inputs.x }}" }\n')],
  // STATUS_IF (R11)
  ['STATUS_IF', 'if: always() on a secret-holding step', BASE + statusStep('always()')],
  ['STATUS_IF', 'if: ${{ !cancelled() }}', BASE + statusStep('${{ !cancelled() }}')],
  ['STATUS_IF', 'if: failure()', BASE + statusStep('failure()')],
  ['STATUS_IF', 'quoted "always()"', BASE + statusStep('"always()"')],
  ['STATUS_IF', 'the boundary conjunct with || true', BASE + statusStep("always() && steps.boundary.outcome != 'failure' || true")],
  ['STATUS_IF', 'the conjunct inverted (== failure)', BASE + statusStep("always() && steps.boundary.outcome == 'failure'")],
  ['STATUS_IF', 'the conjunct only inside a group joined by ||', BASE + statusStep("always() && (steps.boundary.outcome != 'failure' || github.sha)")],
  // CHECKOUT_REF (R12)
  ['CHECKOUT_REF', 'checkout ref: from an input', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n        with:\n          ref: ${{ inputs.x }}\n')],
  ['CHECKOUT_REF', 'checkout ref: main (constant)', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n        with:\n          ref: main\n')],
  ['CHECKOUT_REF', 'checkout repository:', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n        with:\n          repository: other/repo\n')],
  ['CHECKOUT_REF', 'checkout ref in flow form', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n        with: { ref: main }\n')],
  // PERMISSIONS
  ['PERMISSIONS', 'write-all', mut(BASE, 'permissions:\n  contents: read\n', 'permissions: write-all\n')],
  ['PERMISSIONS', 'contents: write', mut(BASE, '  contents: read\n', '  contents: write\n')],
  ['PERMISSIONS', 'an extra permission', mut(BASE, '  contents: read\n', '  contents: read\n  actions: write\n')],
  ['PERMISSIONS', 'no permissions block', mut(BASE, 'permissions:\n  contents: read\n', '')],
  ['PERMISSIONS', 'job-level permissions', mut(BASE, '    runs-on: ubuntu-latest\n', '    runs-on: ubuntu-latest\n    permissions:\n      actions: write\n')],
  // DEFAULTS
  ['DEFAULTS', 'workflow defaults.run.shell', mut(BASE, 'jobs:\n', "defaults:\n  run:\n    shell: 'true {0}'\njobs:\n")],
  ['DEFAULTS', 'job defaults', mut(BASE, '    runs-on: ubuntu-latest\n', "    runs-on: ubuntu-latest\n    defaults:\n      run:\n        shell: 'true {0}'\n")],
  ['DEFAULTS', 'BASH_ENV in job env', mut(BASE, '      INPUT_X: ${{ inputs.x }}\n', '      INPUT_X: ${{ inputs.x }}\n      BASH_ENV: ./x.sh\n')],
  ['DEFAULTS', 'job container', mut(BASE, '    runs-on: ubuntu-latest\n', '    runs-on: ubuntu-latest\n    container: node:22\n')],
  ['DEFAULTS', 'BASH_FUNC_exit%% in job env (exit 1 becomes a no-op)', mut(BASE, '      INPUT_X: ${{ inputs.x }}\n', "      INPUT_X: ${{ inputs.x }}\n      BASH_FUNC_exit%%: '() { :; }'\n")],
  ['DEFAULTS', 'flow-form job env with BASH_ENV', mut(BASE, '    env:\n      INPUT_X: ${{ inputs.x }}\n', '    env: { BASH_ENV: /tmp/x, INPUT_X: "${{ inputs.x }}" }\n')],
  ['DEFAULTS', 'quoted "BASH_ENV" key', mut(BASE, '      INPUT_X: ${{ inputs.x }}\n', '      INPUT_X: ${{ inputs.x }}\n      "BASH_ENV": ./x.sh\n')],
  ['DEFAULTS', 'SHELLOPTS in job env', mut(BASE, '      INPUT_X: ${{ inputs.x }}\n', '      INPUT_X: ${{ inputs.x }}\n      SHELLOPTS: xtrace\n')],
  ['DEFAULTS', 'BASHOPTS in job env', mut(BASE, '      INPUT_X: ${{ inputs.x }}\n', '      INPUT_X: ${{ inputs.x }}\n      BASHOPTS: extdebug\n')],
  ['DEFAULTS', 'workflow-level env PS4', mut(BASE, 'jobs:\n', "env:\n  PS4: '$(x)'\njobs:\n")],
  ['DEFAULTS', 'ENV in a later step env', mut(BASE, STEP_SECRET, STEP_SECRET + '          ENV: ./x.sh\n')],
  // NO_REDIRECT
  ['NO_REDIRECT', 'urlopen( beside an Authorization header', mut(BASE, '          ENDPOINT = ', '          h = {"Authorization": "Bearer x"}\n          urllib.request.urlopen(req)\n          ENDPOINT = ')],
  ['NO_REDIRECT', 'an Authorization header with no NoRedirect opener', mut(BASE, '          ENDPOINT = ', '          h = {"Authorization": "Bearer x"}\n          ENDPOINT = ')],
  ['NO_REDIRECT', 'redirect_request that follows the redirect', mut(BASE, '          ENDPOINT = ', NR_BLOCK.replace('return None', 'return super().redirect_request(req, fp, code, msg, headers, newurl)') + '          ENDPOINT = ')],
  ['NO_REDIRECT', 'a second, default opener', mut(BASE, '          ENDPOINT = ', NR_BLOCK + '          O2 = urllib.request.build_opener()\n          O2.open(req)\n          ENDPOINT = ')],
  // ACTION_PIN
  ['ACTION_PIN', 'third-party action on a tag', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n      - uses: owner/tool@v1\n')],
  ['ACTION_PIN', 'third-party SHA with no tag comment', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n      - uses: owner/tool@0123456789abcdef0123456789abcdef01234567\n')],
  ['ACTION_PIN', 'short SHA', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n      - uses: owner/tool@0123456 # v1\n')],
];
for (const [code, label, text] of BAD) {
  const got = codes(violations('fx.yml', text));
  ok(got.includes(code), `${code} fires on: ${label} (got ${got.join(', ') || 'nothing'})`);
}
// READ_ONLY, under the db-read.yml name
for (const [label, text] of [
  ['write endpoint named', mut(BASE, '/database/query/read-only', '/database/query')],
  ['read-only endpoint missing', mut(BASE, '          ' + ENDPOINT_LINE + '\n', '')],
  ['write endpoint beside the read-only one', mut(BASE, '          ENDPOINT = ', '          W = "https://api.supabase.com/v1/projects/%s/database/query" % REF\n          ENDPOINT = ')],
  ['endpoint built by concatenation', mut(BASE, '"https://api.supabase.com/v1/projects/%s/database/query/read-only"', '"https://api.supabase.com/v1/projects/%s/database/" + "query" + "/read-only"[:0]')],
  ['a second Request(', mut(BASE, '          ENDPOINT = ', '          r2 = urllib.request.Request(OTHER, data=b"")\n          ENDPOINT = ')],
  ['the Request( takes another URL', mut(BASE, 'Request(ENDPOINT,', 'Request(OTHER,')],
]) {
  const got = codes(violations('db-read.yml', text));
  ok(got.includes('READ_ONLY'), `READ_ONLY fires on: ${label} (got ${got.join(', ') || 'nothing'})`);
}

// ── 3. the real files ───────────────────────────────────────────────────────────────────────────
const real = {};
for (const f of NEW_WORKFLOWS) {
  const p = join(wfDir, f);
  ok(existsSync(p), `control: ${f} exists`);
  if (!existsSync(p)) continue;
  real[f] = readFileSync(p, 'utf8');
}
for (const [f, text] of Object.entries(real)) {
  const lines = text.split('\n');
  const jobs = parseJobs(lines) || [];
  const secretRefs = lines.filter((l) => STEP_ENV_SECRET.test(l)).length;
  const runs = runBlocks(lines).length;
  ok(jobs.length >= 1 && jobs.every((j) => !firstStep(j).error),
    `control: ${f} — ${jobs.length} job(s) found (${jobs.map((j) => j.name).join(', ')}), each with a first step`);
  ok(secretRefs >= 1 && runs >= 2, `control: ${f} — ${secretRefs} PROD_ secret reference(s) and ${runs} run: block(s) scanned`);
  const vs = violations(f, text);
  ok(vs.length === 0, `${f}: 0 violations` + (vs.length ? '\n    ' + vs.join('\n    ') : ''));
}

// ── 4. mutations of the real files: the checks fire on them, not only on fixtures ───────────────
if (real['db-read.yml'] && real['verify-production-environment.yml']) {
  const D = real['db-read.yml'];
  const V = real['verify-production-environment.yml'];
  const realIf = IF_LINE;
  for (const [code, f, label, text] of [
    ['ENV', 'db-read.yml', 'delete the environment line', mut(D, '    ' + ENV_LINE + '\n', '')],
    ['BOUNDARY', 'verify-production-environment.yml', 'prefix the boundary if: with false &&', mut(V, realIf, realIf.replace('if: ', 'if: false && '))],
    ['TRIGGER', 'verify-production-environment.yml', 'add a pull_request trigger', mut(V, 'on:\n  workflow_dispatch: {}\n', 'on:\n  workflow_dispatch: {}\n  pull_request:\n')],
    ['RUN_EXPR', 'db-read.yml', 'expand inputs.sql_file into a run:', mut(D, '          set -euo pipefail\n          fail()', '          set -euo pipefail\n          echo "${{ inputs.sql_file }}"\n          fail()')],
    ['READ_ONLY', 'db-read.yml', 'point at the write endpoint', mut(D, '/database/query/read-only" % REF', '/database/query" % REF')],
    ['SECRET', 'verify-production-environment.yml', 'move a PROD_ secret to job env', mut(mut(V, '          SERVICE_KEY: ${{ secrets.PROD_SUPABASE_SERVICE_ROLE_KEY }}\n', ''), '      PROJECT_REF: qwnnmljucajnexpxdgxr\n', '      PROJECT_REF: qwnnmljucajnexpxdgxr\n      SERVICE_KEY: ${{ secrets.PROD_SUPABASE_SERVICE_ROLE_KEY }}\n')],
    // The seven gaps found in review (2026-10-22), each applied to the real file.
    ['STATUS_IF', 'verify-production-environment.yml', 'append an if: always() step holding a PROD_ secret', V + statusStep('always()')],
    ['CHECKOUT_REF', 'verify-production-environment.yml', 'give the checkout a ref: from an input', mut(V, '          persist-credentials: false\n', '          persist-credentials: false\n          ref: ${{ github.event.inputs.x }}\n')],
    ['DEFAULTS', 'db-read.yml', "add BASH_FUNC_exit%%: '() { :; }' to job env", mut(D, '      SUPABASE_PROJECT_REF: qwnnmljucajnexpxdgxr\n', "      SUPABASE_PROJECT_REF: qwnnmljucajnexpxdgxr\n      BASH_FUNC_exit%%: '() { :; }'\n")],
    ['DEFAULTS', 'db-read.yml', 'flow-form job env with BASH_ENV', mut(D, '    env:\n      SUPABASE_PROJECT_REF: qwnnmljucajnexpxdgxr\n', '    env: { BASH_ENV: /tmp/x, SUPABASE_PROJECT_REF: qwnnmljucajnexpxdgxr }\n')],
    ['RUN_EXPR', 'db-read.yml', 'expand an input into shell:', mut(D, '      - name: Validate the branch name and the SQL path\n', '      - name: Validate the branch name and the SQL path\n        shell: ${{ inputs.sql_ref }} {0}\n')],
    ['RUN_EXPR', 'db-read.yml', 'expand an input into working-directory:', mut(D, '      - name: Validate the branch name and the SQL path\n', '      - name: Validate the branch name and the SQL path\n        working-directory: ${{ inputs.sql_file }}\n')],
    ['READ_ONLY', 'db-read.yml', 'build the endpoint by concatenation', mut(D, '"https://api.supabase.com/v1/projects/%s/database/query/read-only"', '"https://api.supabase.com/v1/projects/%s/database/" + "query" + "/read-only"[:0]')],
    // The redirect refusal, on both files.
    ['NO_REDIRECT', 'db-read.yml', 'send the request through urlopen', mut(D, 'with OPENER.open(req, timeout=120) as r:', 'with urllib.request.urlopen(req, timeout=120) as r:')],
    ['NO_REDIRECT', 'verify-production-environment.yml', 'let redirect_request follow', mut(V, '        return None\n\n\n          OPENER', '        return super().redirect_request(req, fp, code, msg, headers, newurl)\n\n\n          OPENER')],
  ]) {
    const got = codes(violations(f, text));
    ok(got.includes(code), `real-file mutation: ${f}, ${label} → ${code} (got ${got.join(', ') || 'nothing'})`);
  }
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL PASS');
