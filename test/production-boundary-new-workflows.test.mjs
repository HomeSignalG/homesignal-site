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
//   RUN_EXPR    contain no ${{ }} inside run: text outside the R15 allowlist, so every input reaches
//               the shell only through env.
// Each workflow must:
//   TRIGGER     be workflow_dispatch only (no pull_request, pull_request_target or workflow_run);
//   PERMISSIONS be exactly `contents: read`, with no job-level override;
//   DEFAULTS    set no defaults:, container: or BASH_ENV/ENV (each can re-route the boundary step's
//               shell, so its exit 1 would not run, while its text stays byte-equal);
//   ACTION_PIN  pin any action outside actions/* to a full 40-hex commit SHA with its tag in a comment.
// db-read.yml must also:
//   READ_ONLY   name the read-only endpoint and no other /database/query endpoint.
//
// The canonical text and constants live in ONE place, test/lib/production-boundary.mjs. This is not
// the full rule test (that comes with the switch of the 36 existing jobs). HYGIENE, NOT THE BOUNDARY:
// a PR can edit this test; the environment's main-only branch rule is what enforces.
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

const indentOf = (l) => l.match(/^ */)[0].length;
const blank = (l) => l.trim() === '';
const skippable = (l) => blank(l) || isCommentLine(l);

// ── the scanner (stdlib line scanner; the repo carries no YAML dependency) ──────────────────────

/** A top-level key's inline value and its indented body. */
function topBlock(lines, keyRe) {
  const i = lines.findIndex((l) => keyRe.test(l));
  if (i < 0) return null;
  const inline = lines[i].replace(keyRe, '').replace(/\s+#.*$/, '').trim();
  const body = [];
  for (let k = i + 1; k < lines.length; k++) {
    if (/^\S/.test(lines[k]) && !isCommentLine(lines[k])) break;
    body.push(lines[k]);
  }
  return { line: i, inline, body };
}

function triggerNames(on) {
  if (on.inline) {
    const t = on.inline.replace(/^\[|\]$/g, '').replace(/^\{|\}$/g, '');
    return t.split(',').map((s) => s.split(':')[0].trim()).filter(Boolean);
  }
  const keyed = on.body.filter((l) => !skippable(l));
  if (!keyed.length) return [];
  const ind = Math.min(...keyed.map(indentOf));
  const names = [];
  for (const l of keyed) {
    if (indentOf(l) !== ind) continue;
    const m = l.match(/^\s*-\s+([A-Za-z_]+)\s*$/) || l.match(/^\s*([A-Za-z_]+)\s*:/);
    names.push(m ? m[1] : l.trim());
  }
  return names;
}

function parseJobs(lines) {
  const j = lines.findIndex((l) => /^jobs\s*:\s*(#.*)?$/.test(l));
  if (j < 0) return null;
  const jobs = [];
  let cur = null;
  for (let k = j + 1; k < lines.length; k++) {
    const l = lines[k];
    if (/^\S/.test(l) && !isCommentLine(l)) break;
    const m = l.match(/^ {2}([A-Za-z0-9_-]+)\s*:\s*(#.*)?$/);
    if (m) { cur = { name: m[1], body: [] }; jobs.push(cur); continue; }
    if (cur) cur.body.push({ n: k, l });
  }
  return jobs;
}

/** The first step's text (lines from its `- ` to the next step), or an error string. */
function firstStep(job) {
  const s = job.body.findIndex(({ l }) => /^ {4}steps\s*:\s*(#.*)?$/.test(l));
  if (s < 0) return { error: 'no steps: block at job indent' };
  let k = s + 1;
  while (k < job.body.length && skippable(job.body[k].l)) k++;
  if (k >= job.body.length || !/^ {6}- /.test(job.body[k].l)) return { error: 'first step not found at 6-space indent' };
  const start = k;
  for (k = start + 1; k < job.body.length; k++) {
    const l = job.body[k].l;
    if (/^ {6}- /.test(l)) break;
    if (!skippable(l) && indentOf(l) < 8) break;
  }
  return { text: job.body.slice(start, k).map((x) => x.l).join('\n') };
}

function dedent(text, n) {
  const pad = ' '.repeat(n);
  const out = [];
  for (const l of text.split('\n')) {
    if (l === '') { out.push(l); continue; }
    if (!l.startsWith(pad)) return null;
    out.push(l.slice(n));
  }
  return out.join('\n');
}

/** Every run: value (inline remainder plus its more-indented continuation lines). */
function runBlocks(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isCommentLine(l)) continue;
    const m = l.match(/^(\s*)(- )?run\s*:(.*)$/);
    if (!m) continue;
    const keyIndent = m[1].length + (m[2] ? 2 : 0);
    const text = [m[3]];
    let k = i + 1;
    for (; k < lines.length; k++) {
      if (blank(lines[k]) || indentOf(lines[k]) > keyIndent) text.push(lines[k]); else break;
    }
    out.push({ line: i + 1, text: text.join('\n') });
    i = k - 1;
  }
  return out;
}

// A line that references secrets in any form: ${{ … secrets … }}, secrets.NAME, secrets[...].
const SECRET_REF = /\$\{\{[^}]*\bsecrets\b|\bsecrets\s*(?:\.\s*[A-Za-z_]|\[)/;
// The only accepted form: the WHOLE value of a step-level env key.
const STEP_ENV_SECRET = /^ {10}([A-Za-z_][A-Za-z0-9_]*): \$\{\{ secrets\.([A-Za-z0-9_]+) \}\}$/;

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

  // DEFAULTS (workflow level)
  if (lines.some((l) => /^defaults\s*:/.test(l))) v('DEFAULTS', 'workflow-level defaults: is not allowed');
  lines.forEach((l, i) => {
    if (!isCommentLine(l) && /^\s+(BASH_ENV|ENV)\s*:/.test(l)) v('DEFAULTS', `line ${i + 1}: ${l.trim().split(':')[0]} is not allowed`);
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

  // RUN_EXPR
  for (const r of runBlocks(lines)) {
    const exprs = [...r.text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)];
    if ((r.text.match(/\$\{\{/g) || []).length !== exprs.length) v('RUN_EXPR', `run: at line ${r.line} has an unclosed \${{`);
    for (const e of exprs) {
      if (!runExpressionAllowed(e[1])) v('RUN_EXPR', `run: at line ${r.line} expands \${{${e[1]}}}; pass it through env instead`);
    }
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
  }

  // READ_ONLY (db-read.yml only)
  if (name === 'db-read.yml') {
    if (!text.includes('/database/query/read-only')) v('READ_ONLY', 'the read-only endpoint /database/query/read-only is not named');
    if (/\/database\/query(?!\/read-only)/.test(text)) v('READ_ONLY', 'names a /database/query endpoint other than /read-only');
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
  '          echo "POST /v1/projects/x/database/query/read-only"',
  '',
].join('\n');

/** Apply one edit; throw if it does not apply exactly once (an edit that misses looks like a pass). */
function mut(text, from, to) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`fixture edit applies ${n} times, expected 1: ${JSON.stringify(from)}`);
  const out = text.replace(from, to);
  if (out === text) throw new Error(`fixture edit changed nothing: ${JSON.stringify(from)}`);
  return out;
}

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

const near = [
  ['an extra comment line inside the boundary step', mut(BASE, '        id: boundary\n', '        id: boundary\n        # an extra comment\n')],
  ['a third-party action pinned to a SHA with its tag', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n      - uses: owner/tool@0123456789abcdef0123456789abcdef01234567 # v1.2.3\n')],
  ['permissions in flow form', mut(BASE, 'permissions:\n  contents: read\n', 'permissions: { contents: read }\n')],
  ['a second PROD_ secret in the same step env', mut(BASE, '          TOKEN: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n', '          TOKEN: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n          DB: ${{ secrets.PROD_SUPABASE_DB_URL }}\n')],
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
  ['SECRET', 'PROD_ secret in run text', mut(BASE, '          echo "POST', '          echo ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n          echo "POST')],
  ['SECRET', 'PROD_ secret inside a larger expression', mut(BASE, STEP_SECRET, '          TOKEN: ${{ github.sha && secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n')],
  ['SECRET', 'PROD_ secret with text around it', mut(BASE, STEP_SECRET, '          TOKEN: Bearer ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n')],
  ['SECRET', 'a retired name as a step env value', mut(BASE, STEP_SECRET, '          TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n')],
  ['SECRET', 'a secret in a YAML comment', mut(BASE, '    steps:\n', '    # ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\n    steps:\n')],
  ['SECRET', 'toJSON(secrets)', mut(BASE, STEP_SECRET, STEP_SECRET + '          ALL: ${{ toJSON(secrets) }}\n')],
  ['SECRET', 'secrets[expr]', mut(BASE, STEP_SECRET, STEP_SECRET + "          ONE: ${{ secrets['PROD_SUPABASE_DB_URL'] }}\n")],
  ['SECRET', 'workflow-level env holding a PROD_ secret', mut(BASE, 'jobs:\n', 'env:\n  TOKEN: ${{ secrets.PROD_SUPABASE_ACCESS_TOKEN }}\njobs:\n')],
  ['SECRET', 'a production job with no PROD_ secret', mut(BASE, STEP_SECRET, '          TOKEN: x\n')],
  // RUN_EXPR
  ['RUN_EXPR', 'inputs.x in run', mut(BASE, '          echo "POST', '          echo "${{ inputs.x }}"\n          echo "POST')],
  ['RUN_EXPR', 'github.event.inputs.x in run', mut(BASE, '          echo "POST', '          echo "${{ github.event.inputs.x }}"\n          echo "POST')],
  ['RUN_EXPR', 'github.head_ref in run', mut(BASE, '          echo "POST', '          echo "${{ github.head_ref }}"\n          echo "POST')],
  ['RUN_EXPR', 'inline run: with an input', mut(BASE, '      - uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n      - run: echo ${{ inputs.x }}\n')],
  ['RUN_EXPR', 'unclosed ${{', mut(BASE, '          echo "POST', '          echo "${{ github.sha"\n          echo "POST')],
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
  ['read-only endpoint missing', mut(BASE, '          echo "POST /v1/projects/x/database/query/read-only"\n', '')],
  ['write endpoint beside the read-only one', mut(BASE, '          echo "POST', '          echo "/v1/projects/x/database/query?fallback"\n          echo "POST')],
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
    ['READ_ONLY', 'db-read.yml', 'point at the write endpoint', mut(D, '/database/query/read-only" % os.environ', '/database/query" % os.environ')],
    ['SECRET', 'verify-production-environment.yml', 'move a PROD_ secret to job env', mut(mut(V, '          SERVICE_KEY: ${{ secrets.PROD_SUPABASE_SERVICE_ROLE_KEY }}\n', ''), '      PROJECT_REF: qwnnmljucajnexpxdgxr\n', '      PROJECT_REF: qwnnmljucajnexpxdgxr\n      SERVICE_KEY: ${{ secrets.PROD_SUPABASE_SERVICE_ROLE_KEY }}\n')],
  ]) {
    const got = codes(violations(f, text));
    ok(got.includes(code), `real-file mutation: ${f}, ${label} → ${code} (got ${got.join(', ') || 'nothing'})`);
  }
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL PASS');
