// source-monitor reports instead of pushing (2026-10-22, founder "remove deploy key").
//
// Until then the nightly job committed docs/source-monitor-report.md (and, when a source passed
// the auto-wire gate, the new jurisdiction-registry.json entry) straight to main with an SSH
// deploy key, then dispatched deploy-edge-functions. That credential is being deleted. This test
// pins the replacement, keeping what the push existed for:
//   1. the gate's output is a PROPOSAL: never written to the registry, never pushed (pure module)
//   2. the report is still produced: stdout, the job summary, and the run's artifact
//   3. a proposal is never dropped silently: the run fails with plain instructions to open a PR
//   4. the two drift gates still fail the run exactly as before, after the evidence is uploaded
//   5. the job needs only `contents: read`: no push, no deploy key, no dispatch
// test/no-deploy-key-push.test.mjs holds every workflow to the same rule.
//
// Run: node test/source-monitor-no-push.test.mjs   (discovered by scripts/run-unit-tests.mjs)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectProposals, proposalSectionLines, proposalsFileText, familyOf, REGISTRY_FILE }
  from '../scripts/lib/source-monitor-proposals.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail !== undefined ? '\n     ' + JSON.stringify(detail).slice(0, 600) : ''));
  if (!c) fails++;
};
const code = (src, marker = '//') => src.split('\n').filter((l) => !l.trim().startsWith(marker)).join('\n');

// ── 1. The proposal module: behaviour on fixtures ────────────────────────────────────────────
{
  const SVC = 'https://example.test/arcgis/rest/services/Permits/FeatureServer/0';
  const registry = {
    arcgis: [{ registry_id: 'existing-arcgis', platform: 'arcgis', service_url: SVC }],
    socrata: [{ registry_id: 'existing-socrata', platform: 'socrata', dataset_id: 'abcd-1234' }],
  };
  const before = JSON.stringify(registry);
  const wire = (id, platform, target, src) => ({ id: target, result: 'wire', res: { result: 'wire', entry: { registry_id: id, platform, ...src, status_to_bucket: { Issued: 'approved' } } } });
  const findings = [
    wire('new-arcgis', 'arcgis', 't1', { service_url: 'https://example.test/new/FeatureServer/0' }),
    wire('new-socrata', 'socrata', 't2', { dataset_id: 'wxyz-9999' }),
    wire('new-arcgis', 'arcgis', 't3', { service_url: 'https://example.test/new/FeatureServer/0' }),   // same id twice: one proposal
    wire('existing-arcgis', 'arcgis', 't4', { service_url: SVC }),        // already wired: rebuilt, never proposed
    { id: 't5', result: 'flag', res: { result: 'flag', shape: 'polygon' } },
    { id: 't6', result: 'stale', res: { result: 'stale' } },
    null,
    // The review's case (Colorado Springs, 2026-10-22): the gate builds a DIFFERENT id for a service
    // that is already wired. Same service_url => already wired, never a proposal to wire it twice.
    wire('city-of-example-planning-applications', 'arcgis', 't7', { service_url: SVC }),
    // A genuinely new dataset whose gate-built id is already taken by a different source: proposed,
    // marked as an id collision, never silently skipped.
    wire('existing-socrata', 'socrata', 't8', { dataset_id: 'new0-0000' }),
  ];
  const { proposals, rebuilt } = collectProposals(findings, registry);
  ok(JSON.stringify(proposals.map((p) => [p.registry_id, p.family, p.target, !!p.id_collision])) === JSON.stringify([
    ['new-arcgis', 'arcgis', 't1', false], ['new-socrata', 'socrata', 't2', false], ['existing-socrata', 'socrata', 't8', true]]),
    '1a a source not wired yet is a proposal, filed under its family, once per registry_id (first finding wins); a taken id is flagged', proposals);
  ok(JSON.stringify(rebuilt.map((p) => p.registry_id)) === JSON.stringify(['existing-arcgis', 'city-of-example-planning-applications']),
    '1b a source already wired (same service_url or dataset_id, whatever its id) is "rebuilt" (gate validation), never a proposal', rebuilt);
  ok(proposalSectionLines(proposals, rebuilt).join('\n').includes('already used by a DIFFERENT source')
    && JSON.parse(proposalsFileText(proposals))[2].id_collision === true,
    '1b2 an id collision is named in the report and in the artifact file');
  ok(JSON.stringify(registry) === before,
    '1c the registry it is handed is NOT modified: the old code pushed the entry into it in memory and then wrote the file');
  ok(collectProposals([], registry).proposals.length === 0 && collectProposals(undefined, undefined).proposals.length === 0,
    '1d no findings, or no registry, propose nothing and do not throw');
  ok(familyOf({ platform: 'arcgis' }) === 'arcgis' && familyOf({ platform: 'socrata' }) === 'socrata' && familyOf({}) === 'socrata',
    '1e the family rule is the one the monitor used when it appended entries');

  ok(proposalsFileText([]) === '[]\n', '1f the artifact file is written even when empty: `[]` is the evidence that nothing was proposed');
  const fileText = proposalsFileText(proposals);
  const parsed = JSON.parse(fileText);
  ok(parsed.length === 3 && parsed[0].entry.registry_id === 'new-arcgis' && parsed[0].family === 'arcgis' && !('arcgis' in parsed[0].entry && Array.isArray(parsed[0].entry.arcgis)),
    '1g the artifact file holds the entries only, never a rewritten registry (a whole-file rewrite reformats ~17,000 unrelated lines)', parsed);

  const sec = proposalSectionLines(proposals, rebuilt).join('\n');
  ok(/### Proposed registry entries/.test(sec) && /NOT wired/.test(sec), '1h the report names the proposals as NOT wired', sec);
  ok(sec.includes(REGISTRY_FILE) && /pull request/i.test(sec) && /deploy-edge-functions/.test(sec) && /function=get-address-report/.test(sec),
    '1i …with the plain steps: add the entry to the registry file on a branch, open a PR, then run deploy-edge-functions', sec);
  ok((sec.match(/```json/g) || []).length === 3 && sec.includes('"registry_id": "new-socrata"'), '1j …and each proposed entry in full, as JSON');
  ok(/Gate validation/.test(sec) && sec.includes('existing-arcgis'), '1k rebuilt entries are listed separately, as validation');
  const onlyRebuilt = proposalSectionLines([], rebuilt).join('\n');
  ok(!/Proposed registry entries/.test(onlyRebuilt) && /Gate validation/.test(onlyRebuilt), '1l an include_wired run with nothing new proposes nothing');
  ok(proposalSectionLines([], []).length === 0, '1m nothing passed the gate: no extra section');
}

// ── 2. The monitor script writes nothing into the repo and still produces the report ─────────
const MON = readFileSync(join(ROOT, 'scripts/source-monitor.mjs'), 'utf8');
const MONC = code(MON);
{
  ok(!/writeFileSync\(\s*REGISTRY_PATH/.test(MONC) && !/appendFileSync\(\s*REPORT_PATH/.test(MONC) && !/writeFileSync\(\s*REPORT_PATH/.test(MONC),
    '2a the script never writes the registry or appends to the committed report (the push existed only to carry those writes)');
  ok(/readFileSync\(REGISTRY_PATH/.test(MONC) && /readFileSync\(REPORT_PATH/.test(MONC),
    '2b control: it still READS both (the registry to probe, the frozen report for the previous dev-backed count)');
  ok(/collectProposals\(findings, registry\)/.test(MONC) && !/\.push\(f\.res\.entry\)/.test(MONC),
    '2c Phase 3 goes through the proposal module and pushes no entry into the in-memory registry');
  ok(/console\.log\(section\)/.test(MONC) && /appendFileSync\(process\.env\.GITHUB_STEP_SUMMARY, section\)/.test(MONC)
    && /writeFileSync\(`\$\{OUT_DIR\}\/run-report\.md`, section\)/.test(MONC),
    '2d the report is still produced: stdout, the job summary, and run-report.md in the evidence folder');
  ok(/writeFileSync\(`\$\{OUT_DIR\}\/proposed-registry-entries\.json`, proposalsFileText\(proposals\)\)/.test(MONC),
    '2e the proposed entries go to the evidence folder');
  ok(/const OUT_DIR = process\.env\.SOURCE_MONITOR_OUT_DIR \|\| ''/.test(MONC), '2f the folder comes from SOURCE_MONITOR_OUT_DIR');
  ok(/if \(proposals\.length\) console\.log\('REGISTRY_PROPOSED=1'\)/.test(MONC) && !/REGISTRY_CHANGED/.test(MONC),
    '2g a proposal prints REGISTRY_PROPOSED=1 (the old REGISTRY_CHANGED marker is gone)');
  ok(/if \(driftReal\.length\) console\.log\('STATUS_DRIFT=1'\)/.test(MONC) && /if \(tdriftReal\.length\) console\.log\('TYPE_DRIFT=1'\)/.test(MONC),
    '2h the drift markers are unchanged');
  ok(/proposalSectionLines\(proposals, rebuilt\)/.test(MONC), '2i the proposals are in the report section (so in the summary and the artifact)');
}

// ── 3. The workflow ──────────────────────────────────────────────────────────────────────────
const WF = readFileSync(join(ROOT, '.github/workflows/source-monitor.yml'), 'utf8');
const WFC = code(WF, '#');
const stepText = (name) => {
  const i = WF.indexOf(`- name: ${name}`);
  if (i < 0) return '';
  const rest = WF.slice(i + 1);
  const j = rest.search(/\n {6}- (name|uses|run):/);
  return WF.slice(i, j < 0 ? WF.length : i + 1 + j);
};
{
  const perms = (WF.match(/^permissions:\n((?: {2}.*\n)+)/m) || [])[1] || '';
  ok(perms.trim() === 'contents: read', '3a permissions are exactly `contents: read`: no contents: write, no actions: write, no pull-requests', perms);
  ok(!/\bgit\s+push\b/.test(WFC) && !/\bgit\s+commit\b/.test(WFC) && !/gh workflow run/.test(WFC) && !/deploy-edge-functions\.yml/.test(WFC),
    '3b no commit, no push, no workflow dispatch');
  ok(!/DEPLOY_KEY/.test(WFC) && !/ssh-key/.test(WFC), '3c no deploy key and no ssh-key checkout');
  ok(/- uses: actions\/checkout@v4\n {8}with:\n {10}persist-credentials: false\n/.test(WF), '3d the checkout keeps no credential');

  const run = stepText('Run source monitor');
  ok(/SOURCE_MONITOR_OUT_DIR: \$\{\{ runner\.temp \}\}\/source-monitor/.test(run) && /cp monitor-out\.txt "\$SOURCE_MONITOR_OUT_DIR\/monitor-out\.txt"/.test(run),
    '3e the monitor step writes its evidence folder and copies the full log into it', run);
  ok(/grep -q '\^REGISTRY_PROPOSED=1\$' monitor-out\.txt/.test(run) && /echo "registry_proposed=true" >> "\$GITHUB_OUTPUT"/.test(run),
    '3f it turns REGISTRY_PROPOSED=1 into a step output');

  const up = stepText('Upload the run report');
  ok(/if: always\(\)/.test(up) && /uses: actions\/upload-artifact@v4/.test(up) && /name: source-monitor-\$\{\{ github\.run_id \}\}/.test(up)
    && /path: \$\{\{ runner\.temp \}\}\/source-monitor\//.test(up) && /retention-days: 30/.test(up),
    '3g the evidence folder is uploaded as source-monitor-<run id>, kept 30 days, even when the run is red', up);

  const prop = stepText('Fail on a proposed registry entry (passed the auto-wire gate, needs a PR to wire)');
  ok(/if: always\(\) && steps\.monitor\.outputs\.registry_proposed == 'true'/.test(prop) && /\n {10}exit 1\n/.test(prop),
    '3h a proposal FAILS the run (never dropped silently)', prop);
{
  // A crashed monitor must not pass green: `node … | tee` hides node's exit code (no pipefail), and
  // with no nightly commit any more nothing else would show the crash (review, 2026-10-22).
  const run = WF.slice(WF.indexOf('node scripts/source-monitor.mjs'));
  const step = run.slice(0, run.indexOf('\n      - '));
  ok(/\| tee monitor-out\.txt\n\s*rc=\$\{PIPESTATUS\[0\]\}/.test(step) && /exit "\$rc"/.test(step)
    && step.indexOf('exit "$rc"') > step.lastIndexOf('GITHUB_OUTPUT'),
    '3z a crashed monitor fails its step, AFTER the step outputs are written (node exit code kept past tee)', step.slice(0, 400));
}
  ok(/open a PR/.test(prop) && /jurisdiction-registry\.json/.test(prop) && /deploy-edge-functions/.test(prop) && /proposed-registry-entries\.json/.test(prop),
    '3i …with plain instructions: where the entry is, which file it goes in, open a PR, then deploy');

  // The drift gates: `if:` and `exit 1` byte for byte as before 2026-10-22. Only the pointer to
  // where the table lives changed (the committed report no longer gets new runs).
  const st = stepText('Fail on status-domain drift (unmapped statuses are dropping records)');
  const ty = stepText('Fail on type-domain drift (unlisted include_types values are never fetched)');
  ok(st.includes("        if: always() && steps.monitor.outputs.status_drift == 'true'\n") && /\n {10}exit 1\n/.test(st),
    '3j the status-drift gate is unchanged: always(), keyed on STATUS_DRIFT, exit 1', st);
  ok(ty.includes("        if: always() && steps.monitor.outputs.type_drift == 'true'\n") && /\n {10}exit 1\n/.test(ty),
    '3k the type-drift gate is unchanged: always(), keyed on TYPE_DRIFT, exit 1', ty);
  ok(/this run's job summary \(also in its source-monitor artifact\)/.test(st) && /this run's job summary \(also in its source-monitor artifact\)/.test(ty)
    && !/docs\/source-monitor-report\.md/.test(st + ty),
    '3l both point the fixer at the job summary and artifact, not at the frozen committed report');
  ok(/grep -q '\^STATUS_DRIFT=1\$' monitor-out\.txt/.test(run) && /grep -q '\^TYPE_DRIFT=1\$' monitor-out\.txt/.test(run),
    '3m the drift greps are unchanged');

  const order = ['Run source monitor', 'Upload the run report', 'Fail on a proposed registry entry', 'Fail on status-domain drift', 'Fail on type-domain drift', 'Live scoreboard']
    .map((n) => WF.indexOf(`- name: ${n}`));
  ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), '3n step order: monitor, upload, the three red gates, then the live scoreboard last', order);
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL PASS');
