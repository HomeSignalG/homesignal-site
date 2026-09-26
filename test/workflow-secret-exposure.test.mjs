// Workflow secret exposure: no job that reads a secret (or inherits secrets) may run on pull_request unless
// its job-level `if:` is a pure conjunction containing github.event_name == 'workflow_dispatch' (or
// != 'pull_request' when pull_request_target is not a trigger); no workflow-level env may carry a secret.
//
// HYGIENE, NOT A BOUNDARY. On pull_request GitHub runs the workflow file from the PR's own head, so a
// same-repo PR can delete a guard, or add a new workflow, and still read repository secrets. The only real
// boundary is a protected GitHub `environment:` with required reviewers holding those secrets. This test
// stops the accidental case: a secret-holding job wired to run on every PR that touches its paths.
//
// KNOWN_EXPOSED lists jobs that do so today BY DESIGN of their owning session, each with its reason. An
// entry is a recorded decision, never a snooze: adding one needs a reason, and an entry that no longer
// matches a live exposure FAILS, so the list can only shrink.
// ingest note: homesignal-ingest runs 14 PR-time DB gates with SUPABASE_WRITE_KEY by design (measured
// 2026-09-26); not covered here. The boundary for both repos is a protected environment / read-only key.
//
// Run: node test/workflow-secret-exposure.test.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wfDir = join(root, '.github', 'workflows');

const KNOWN_EXPOSED = {
  'dc-geocode-probe.yml:probe': 'zero-write geocoding probe run on PRs that change it (session 01LBMSdQ, 2026-09-24)',
  'dc-step3c-probe.yml:probe': 'read-only publisher probe run on PRs that change it (session 01F18S91, 2026-09-24)',
  'dc-step3c-reconcile.yml:reconcile': 'read-only live reconciliation that is a PR verification gate by design (session 01F18S91, 2026-09-24)',
};

// A job is excluded from pull_request only by a job-level `if:` that is a pure conjunction (no `||`, no
// negation) containing one of these conjuncts EXACTLY. `!= 'pull_request'` does not exclude
// pull_request_target, so it is accepted only when that trigger is absent.
const GUARD_DISPATCH = "github.event_name == 'workflow_dispatch'";
const GUARD_NOT_PR = "github.event_name != 'pull_request'";

function prTriggers(onText) {
  return { pr: /\bpull_request\b(?!_target)/.test(onText), prt: /\bpull_request_target\b/.test(onText) };
}

function jobIf(body) {
  const idx = body.findIndex((l) => /^ {4}if:/.test(l));
  if (idx < 0) return '';
  let v = body[idx].replace(/^ {4}if:\s*/, '');
  if (/^[>|][-+]?\s*$/.test(v)) {          // block scalar: join the indented continuation
    const parts = [];
    for (const l of body.slice(idx + 1)) { if (/^ {6,}\S/.test(l)) parts.push(l.trim()); else break; }
    v = parts.join(' ');
  }
  return v.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}\s*$/, '').replace(/^(['"])(.*)\1$/, '$2').trim();
}

export function guarded(cond, trig) {
  // `||` is load-bearing: `dispatch && x || pull` has an exact dispatch conjunct yet runs on PRs.
  // Any conjunct ANDed with the exact dispatch guard is safe, so negation elsewhere is allowed.
  if (!cond || /\|\|/.test(cond)) return false;
  const conj = cond.split('&&').map((c) => c.trim().replace(/^\(+/, '').replace(/\)+$/, '').trim().replace(/\s+/g, ' '));
  if (conj.includes(GUARD_DISPATCH)) return true;
  return conj.includes(GUARD_NOT_PR) && !trig.prt;
}

export function exposures(name, text) {
  const lines = text.split('\n');
  const onIdx = lines.findIndex((l) => /^(on|"on"|'on'):/.test(l));
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (onIdx < 0 || jobsIdx < 0) return [];
  let onEnd = lines.findIndex((l, k) => k > onIdx && /^\S/.test(l));
  if (onEnd < 0) onEnd = lines.length;
  const trig = prTriggers(lines.slice(onIdx, onEnd).join('\n'));
  if (!trig.pr && !trig.prt) return [];
  const out = [];
  // workflow-level env: applies to every job, so no job guard can contain it
  const envIdx = lines.findIndex((l) => /^env:\s*$/.test(l));
  if (envIdx >= 0) {
    const envBody = [];
    for (const l of lines.slice(envIdx + 1)) { if (/^\s/.test(l) || l === '') envBody.push(l); else break; }
    if (/\$\{\{\s*secrets\./.test(envBody.join('\n'))) out.push(`${name}:<workflow env>`);
  }
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const body = cur.body.join('\n');
    const usesSecret = /\$\{\{\s*secrets\./.test(body) || /^ {4}secrets:\s*inherit\s*$/m.test(body);
    if (usesSecret && !guarded(jobIf(cur.body), trig)) out.push(`${name}:${cur.name}`);
  };
  for (const l of lines.slice(jobsIdx + 1)) {
    const jm = l.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jm) { flush(); cur = { name: jm[1], body: [] }; continue; }
    if (/^\S/.test(l)) break;
    if (cur) cur.body.push(l);
  }
  flush();
  return out;
}

// positive and negative controls: the detector must flag an unguarded job and pass a guarded one
const WF = (jobIf) => `on:\n  pull_request:\n  workflow_dispatch: {}\njobs:\n  a:\n${jobIf}    runs-on: x\n    steps:\n      - run: echo \${{ secrets.X }}\n`;
assert.deepEqual(exposures('t.yml', WF('')), ['t.yml:a'], 'control: an unguarded secret job on pull_request must be flagged');
assert.deepEqual(exposures('t.yml', WF("    if: github.event_name == 'workflow_dispatch'\n")), [], 'control: dispatch-only job passes');
assert.deepEqual(exposures('t.yml', WF("    if: github.event_name != 'pull_request'\n")), [], 'control: != pull_request passes');
assert.deepEqual(exposures('t.yml', WF('').replace('  pull_request:\n', '')), [], 'control: no pull_request trigger, nothing to flag');
// bypass shapes found by the 2026-09-26 audit: each must be FLAGGED
const J = (h) => WF(h);
for (const [label, text] of [
  ['|| true', J("    if: github.event_name == 'workflow_dispatch' || true\n")],
  ['|| pull_request', J("    if: github.event_name == 'workflow_dispatch' || github.event_name == 'pull_request'\n")],
  ['negated', J("    if: \"!(github.event_name == 'workflow_dispatch')\"\n")],
  ['always()', J('    if: always()\n')],
  ['dispatch && x || pull_request', J("    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' || github.event_name == 'pull_request'\n")],
  ['!= pull_request under pull_request_target', "on:\n  pull_request_target:\njobs:\n  a:\n    if: github.event_name != 'pull_request'\n    runs-on: x\n    steps:\n      - run: echo ${{ secrets.X }}\n"],
]) assert.deepEqual(exposures('t.yml', text), ['t.yml:a'], `bypass must be flagged: ${label}`);
assert.deepEqual(exposures('t.yml', "on:\n  pull_request:\nenv:\n  K: ${{ secrets.X }}\njobs:\n  a:\n    if: github.event_name == 'workflow_dispatch'\n    runs-on: x\n    steps:\n      - run: echo $K\n"),
  ['t.yml:<workflow env>'], 'bypass must be flagged: workflow-level env secret');
assert.deepEqual(exposures('t.yml', "on:\n  pull_request:\njobs:\n  a:\n    uses: ./.github/workflows/x.yml\n    secrets: inherit\n"),
  ['t.yml:a'], 'bypass must be flagged: secrets: inherit');
assert.deepEqual(exposures('t.yml', 'on: [pull_request]\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo ${{ secrets.X }}\n'),
  ['t.yml:a'], 'list-form trigger must be flagged');
// guarded shapes that must PASS (no false alarms)
for (const [label, h] of [
  ['block scalar', "    if: >-\n      github.event_name == 'workflow_dispatch'\n"],
  ['${{ }} wrapped', "    if: ${{ github.event_name == 'workflow_dispatch' }}\n"],
  ['conjunction', "    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'\n"],
  ['conjunction with negation', "    if: github.event_name == 'workflow_dispatch' && !cancelled()\n"],
]) assert.deepEqual(exposures('t.yml', J(h)), [], `guarded shape must pass: ${label}`);

const found = [];
let scanned = 0;
for (const f of readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n)).sort()) {
  scanned++;
  found.push(...exposures(f, readFileSync(join(wfDir, f), 'utf8')));
}
assert.ok(scanned > 20, `control: scanned ${scanned} workflow files, expected the repo's full set`);
const unexpected = found.filter((k) => !(k in KNOWN_EXPOSED));
const stale = Object.keys(KNOWN_EXPOSED).filter((k) => !found.includes(k));
assert.deepEqual(unexpected, [], `secret-holding jobs run on pull_request without an event guard: ${unexpected.join(', ')}`);
assert.deepEqual(stale, [], `KNOWN_EXPOSED entries no longer exposed (remove them): ${stale.join(', ')}`);
console.log(`workflow-secret-exposure: ${scanned} workflows scanned, ${found.length} known PR exposures, 0 unexpected`);
