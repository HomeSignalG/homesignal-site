// The hourly EPA recovery repair burst (60 ZIPs at once) can be paused with the repository variable
// EPA_RECOVERY_REPAIR_PAUSED = 'true', and NOTHING ELSE in the workflow depends on it.
// Run: node test/epa-recovery-repair-pause.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wf = readFileSync(join(root, '.github/workflows/epa-recovery-watch.yml'), 'utf8');
let fails = 0;
const ok = (c, n, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (!c && d ? '\n     ' + d : '')); if (!c) fails++; };

const ifs = [...wf.matchAll(/^\s*if:\s*(.+)$/gm)].map((m) => m[1].trim());
const withVar = ifs.filter((c) => c.includes('EPA_RECOVERY_REPAIR_PAUSED'));
ok(withVar.length === 1, '1. exactly one condition reads EPA_RECOVERY_REPAIR_PAUSED', JSON.stringify(withVar));
ok(withVar[0] === "steps.proof.outputs.passed == 'true' && vars.EPA_RECOVERY_REPAIR_PAUSED != 'true'",
  '2. that condition is the original repair condition AND the variable is not exactly "true"', withVar[0]);
const repairStep = wf.slice(wf.indexOf('- name: Step 3'), wf.indexOf('- name:', wf.indexOf('- name: Step 3') + 5));
ok(repairStep.includes('EPA_RECOVERY_REPAIR_PAUSED') && /rpc\/epa_recovery_repair/.test(repairStep),
  '3. the condition sits on the step that calls epa_recovery_repair');
ok((wf.match(/EPA_RECOVERY_REPAIR_PAUSED/g) ?? []).length === 2, '4. the variable is named only in that step (its condition and its comment)');
ok(ifs.filter((c) => c === "steps.proof.outputs.passed == 'true'").length === 1,
  '5. the disable step keeps its original condition (not part of this change)');
ok(/rpc epa_recovery_step2/.test(wf) && /epa_recovery_proof_check/.test(wf) && /cron: '17 \* \* \* \*'/.test(wf),
  '6. the hourly schedule, the proof fire and the proof check are still present');

// GitHub evaluates `vars.X != 'true'` with a missing variable as '' (so the step runs), and compares strings.
const evaluate = (passed, v) => passed === 'true' && (v ?? '') !== 'true';
for (const [v, want] of [[undefined, true], ['true', false], ['false', true], ['TRUE', true], ['', true]]) {
  ok(evaluate('true', v) === want, `7. proof passed, variable ${v === undefined ? 'absent' : JSON.stringify(v)}: repair ${want ? 'runs' : 'skipped'}`);
}
ok(evaluate('false', undefined) === false, '7. proof not passed: repair skipped whatever the variable');
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
