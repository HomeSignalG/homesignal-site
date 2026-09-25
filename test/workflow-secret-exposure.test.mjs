// Workflow secret exposure: no job that reads a secret may run on pull_request unless its job-level
// `if:` excludes pull_request (dispatch-only, or != 'pull_request').
//
// HYGIENE, NOT A BOUNDARY. On pull_request GitHub runs the workflow file from the PR's own head, so a
// same-repo PR can delete a guard, or add a new workflow, and still read repository secrets. The only real
// boundary is a protected GitHub `environment:` with required reviewers holding those secrets. This test
// stops the accidental case: a secret-holding job wired to run on every PR that touches its paths.
//
// KNOWN_EXPOSED lists jobs that do so today BY DESIGN of their owning session, each with its reason. An
// entry is a recorded decision, never a snooze: adding one needs a reason, and an entry that no longer
// matches a live exposure FAILS, so the list can only shrink.
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

export function exposures(name, text) {
  const lines = text.split('\n');
  const onIdx = lines.findIndex((l) => /^on:\s*$/.test(l) || /^on:\s*\S/.test(l) || /^"on":/.test(l));
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (onIdx < 0 || jobsIdx < 0) return [];
  const onBlock = lines.slice(onIdx, jobsIdx > onIdx ? jobsIdx : undefined).join('\n');
  if (!/\bpull_request(_target)?\b/.test(onBlock)) return [];
  const out = [];
  const jobLines = lines.slice(jobsIdx + 1);
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const body = cur.body.join('\n');
    if (/\$\{\{\s*secrets\./.test(body)) {
      const m = cur.body.find((l) => /^ {4}if:/.test(l));
      const cond = m ? m.replace(/^ {4}if:\s*/, '') : '';
      const excluded = /github\.event_name\s*==\s*'workflow_dispatch'/.test(cond)
        || /github\.event_name\s*!=\s*'pull_request'/.test(cond);
      if (!excluded) out.push(`${name}:${cur.name}`);
    }
  };
  for (const l of jobLines) {
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
