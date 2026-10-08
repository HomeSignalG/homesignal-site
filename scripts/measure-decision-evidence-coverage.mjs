#!/usr/bin/env node
// scripts/measure-decision-evidence-coverage.mjs
//
// THE THIRD MEASURED OUTCOME: decision-evidence coverage BY SOURCE and BY APPLICATION.
//
// ⛔ THE ONE THING THIS EXISTS TO PREVENT: reporting shared code coverage as if it were
// knowledge of every municipality. Every one of the 12,722 canonical ZIP pages now runs
// the same decision plane — that is outcome one, and it is true of the CODE. It says
// nothing about whether Chester County's plan-review layer can tell us a conditional-use
// application was denied. Those are different claims and this file keeps them apart.
//
// TWO LEVELS, NEVER SUMMED:
//   • SOURCE coverage   — of the registry entries a resident's page can draw on, how many
//                         CAN report a refusal at all? Computed from each entry's own
//                         declarations (sources/decision.ts::decisionEvidenceLevel), so it
//                         is the same answer for every record that entry produces.
//   • APPLICATION coverage — of the records actually stored, how many carry a decision?
//                         Needs the live database, so it is reported ONLY when a service
//                         key is present, and its absence is printed as NOT MEASURED
//                         rather than as a zero. A zero and an unrun query look identical
//                         otherwise, and that is the failure this repo has already paid
//                         for more than once.
//
//   node scripts/measure-decision-evidence-coverage.mjs            # source coverage
//   node scripts/measure-decision-evidence-coverage.mjs --json     # machine-readable
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const { decisionEvidenceLevel, sourceCanReportDenial, DECISION_OUTCOMES } =
  await import(join(root, 'supabase/functions/get-address-report/sources/decision.ts'));

const FAMILIES = ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft'];
const rows = [];
for (const fam of FAMILIES) {
  for (const e of (Array.isArray(REG[fam]) ? REG[fam] : [])) {
    const s2b = e.status_to_bucket ?? {};
    const declared = {};
    for (const o of DECISION_OUTCOMES) declared[o] = (s2b[o] ?? []).length;
    rows.push({
      registry_id: e.registry_id,
      platform: fam,
      jurisdiction: e.jurisdiction ?? null,
      // Every state this entry serves. Coverage is a GEOGRAPHIC question for a resident —
      // "can my county report a denial" — so the report is groupable by state.
      states: [...new Set((e.coverage ?? []).map((c) => c.state).filter(Boolean))].sort(),
      counties: (e.coverage ?? []).filter((c) => c.county).length,
      evidence: decisionEvidenceLevel(e),
      can_report_denial: sourceCanReportDenial(decisionEvidenceLevel(e)),
      declared_decision_values: declared,
      has_decision_date_column: !!e.column_map?.decision_date,
    });
  }
}

const by = (k) => rows.reduce((a, r) => (a[r[k]] = (a[r[k]] ?? 0) + 1, a), {});
const can = rows.filter((r) => r.can_report_denial);
const cannot = rows.filter((r) => !r.can_report_denial);
// Per-state, because "we have national coverage" is exactly the claim that needs a
// denominator a reader can check.
const states = {};
for (const r of rows) {
  for (const st of (r.states.length ? r.states : ['(none declared)'])) {
    (states[st] ??= { total: 0, can: 0 });
    states[st].total++;
    if (r.can_report_denial) states[st].can++;
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    measured_at: new Date().toISOString().slice(0, 10),
    source_coverage: {
      entries: rows.length,
      by_evidence_level: by('evidence'),
      can_report_denial: can.length,
      cannot_report_denial: cannot.length,
      by_state: states,
    },
    application_coverage: 'NOT MEASURED — needs the live database (see the header)',
    entries: rows,
  }, null, 2));
} else {
  console.log('── DECISION-EVIDENCE COVERAGE, BY SOURCE ───────────────────────────────');
  console.log(`registry entries                ${rows.length}`);
  console.log(`CAN report a refusal            ${can.length}`);
  console.log(`CANNOT report a refusal         ${cannot.length}`);
  console.log(`by evidence level               ${JSON.stringify(by('evidence'))}`);
  console.log(`by platform                     ${JSON.stringify(by('platform'))}`);
  console.log('');
  console.log('⚠️  "date_only" is NOT denial coverage. A decision-date column says WHEN');
  console.log('    something was decided, never THAT it was refused, so it is counted with');
  console.log('    "none". Reading it as coverage is the substitution this report prevents.');
  console.log('');
  console.log('── BY STATE (a source may serve several) ───────────────────────────────');
  for (const st of Object.keys(states).sort()) {
    const s = states[st];
    const pct = s.total ? Math.round((100 * s.can) / s.total) : 0;
    console.log(`  ${st.padEnd(18)} ${String(s.can).padStart(3)} / ${String(s.total).padEnd(3)} sources can report a refusal  (${pct}%)`);
  }
  console.log('');
  console.log('── SOURCES THAT CANNOT REPORT A REFUSAL ────────────────────────────────');
  console.log('   Every record from these is shown with the honest qualification');
  console.log('   "Application on file · Current decision status not verified."');
  for (const r of cannot.slice().sort((a, b) => a.registry_id.localeCompare(b.registry_id))) {
    console.log(`  ${r.registry_id.padEnd(46)} ${r.evidence.padEnd(10)} ${r.states.join(',')}`);
  }
  console.log('');
  console.log('── APPLICATION COVERAGE ────────────────────────────────────────────────');
  console.log('  NOT MEASURED HERE. How many stored applications actually carry a decision');
  console.log('  is a question about the DATABASE, not about this file, and it changes on');
  console.log('  every refresh. It is deliberately not estimated from source coverage: a');
  console.log('  source that CAN report a refusal has not necessarily reported one, and');
  console.log('  presenting capability as if it were incidence is the same error as');
  console.log('  presenting code coverage as knowledge. Measure it against the live');
  console.log('  development_reports / app_projects and report it beside this number.');
}
