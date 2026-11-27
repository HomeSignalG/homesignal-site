// The date-basis audit as a standing check (report-accuracy-universal, 2026-11-20). HONEST SCOPE: this validates DECLARED metadata only (a basis outside the vocabulary; `filing` declared on a field
// named like a creation/update timestamp). It does NOT certify the ~211 registry date mappings: most declare nothing, and a field name is a lead, never proof (docs/date-basis-audit-2026-11-19.md).
// Run: node --experimental-strip-types test/date-basis-audit.test.mjs
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = await import('../scripts/audit-date-basis.mjs');
let n = 0, fails = 0;
const ok = (c, name, d) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 400)); } };
const run = (args) => spawnSync(process.execPath, [join(root, 'scripts/audit-date-basis.mjs'), ...args], { cwd: root, encoding: 'utf8' });
const r = run(['--check']);
ok(r.status === 0, 'the real registry passes --check (no declared basis contradicts its own field name)', r.stderr);
const reg = (e) => A.audit({ arcgis: [{ registry_id: 'x', column_map: { file_date: 'CreatedDate' }, ...e }] });
ok(A.violations(reg({ file_date_basis: 'filing' })).length === 1, '--check REJECTS "filing" declared on a creation-named field (a genuinely contradictory declaration)');
ok(A.violations(reg({ file_date_basis: 'record_created' })).length === 0, 'and accepts record_created on that field');
ok(A.violations(reg({ file_date_basis: 'received' })).length === 1, '--check REJECTS a basis outside the vocabulary');
ok(A.violations(reg({})).length === 0, 'an undeclared mapping is a candidate for review, NOT a violation (the check does not certify mappings)');
const j = JSON.parse(run(['--json']).stdout);
ok(j.total > 100 && j.counts.declared >= 2 && j.counts.candidate_review >= 1, 'the audit reads the whole registry (' + j.total + ' mappings) and still lists unverified candidates: it is not a certification', j.counts);
console.log(`\n${n - fails}/${n} passed`); process.exit(fails ? 1 : 0);
