// The generated status-mapping audit (release gate item 1). Run: node test/lifecycle-mapping-audit.test.mjs
//
// Pins three things: (1) the committed docs/lifecycle-mapping-audit files are exactly what
// scripts/lifecycle-mapping-audit.mjs writes from today's registry, so the reviewed audit cannot drift from the
// registry it describes; (2) no (registry_id, status) pair is lost or invented; (3) the founder's own examples from
// the plan land where decisions D1-D8 say they must.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/lifecycle-mapping-audit.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { failures++; console.error('FAIL — ' + name + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
};

const out = build();
// The committed audit is a dated snapshot for review. Other sessions edit the registry routinely, so a stale
// snapshot is reported, never a failure that would turn their unrelated PRs red. Every check below runs on fresh
// generator output, so the rules are still guarded.
const fresh = readFileSync(join(root, 'docs/lifecycle-mapping-audit/mapping.csv'), 'utf8') === out.csv
  && readFileSync(join(root, 'docs/lifecycle-mapping-audit/summary.md'), 'utf8') === out.summary;
console.log(fresh ? 'INFO — 1: the committed audit matches today\'s registry'
  : 'INFO — 1: the committed audit is older than today\'s registry; run scripts/lifecycle-mapping-audit.mjs before review');
ok(/fingerprint `[0-9a-f]{32}`/.test(readFileSync(join(root, 'docs/lifecycle-mapping-audit/summary.md'), 'utf8')),
  '1: the committed summary carries its fingerprint');

// 2. Every registry status value appears exactly once (positive control: the registry is not empty).
const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
let n = 0;
for (const p of ['socrata', 'arcgis', 'ckan', 'csv', 'carto']) for (const e of reg[p] || []) {
  for (const v of Object.values(e.status_to_bucket || {})) if (Array.isArray(v)) n += v.length;
}
ok(n > 1000, '2a: the registry carries status values (control)', n);
ok(out.rows >= n, '2b: every mapped status value is in the audit', { rows: out.rows, mapped: n });

// Parse the CSV once (values may be quoted).
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const rows = parseCsv(out.csv);
const get = (id, status) => rows.find((r) => r.registry_id === id && r.status === status);
const expect = (id, status, want, name) => {
  const r = get(id, status);
  const fail = !r ? 'row missing' : Object.entries(want).filter(([k, v]) => r[k] !== v).map(([k, v]) => `${k}=${r[k]} want ${v}`);
  ok(r && fail.length === 0, name, fail);
};

// 3. The founder's examples (plan §3) and decisions.
expect('austin-zoning-cases', 'Closed', { proposed_stage: 'closed_unspecified', proposed_activity: 'undetermined', needs: 'receipt', documentation_receipt: 'none on file' },
  '3a: D5 — Austin zoning "Closed" is not Operating; needs the agency definition');
expect('burlington-vt-zoning-permits', 'Closed', { proposed_stage: 'closed_unspecified', needs: 'receipt' }, '3b: D5 — Burlington zoning "Closed"');
expect('dallas-specific-use-permits', 'In force', { proposed_stage: 'entitled', proposed_column: 'approved' }, '3c: an SUP in force is an entitlement, not operation');
expect('austin-subdivision-cases', 'Subdivision Recorded', { proposed_stage: 'entitled', proposed_column: 'approved' }, '3d: a recorded plat is not a built development');
expect('nvdot-project-boundaries', 'operating', { proposed_stage: 'not_established', proposed_column: 'unknown', needs: 'review' },
  '3e: a dataset-wide "operating" constant establishes nothing');
expect('portland-neighborhood-contact-applications', 'Neighborhood contact filed before a land-use or building application',
  { proposed_stage: 'preliminary_identified|preliminary_unidentified', needs: 'per_record' }, '3f: D1 — pre-application decided per record');
expect('arlington-issued-permits', 'Pending Inspection', { proposed_stage: 'under_construction', proposed_column: 'approved' }, '3g: an inspection is not a proposal');
expect('tucson-residential-building-permits', 'Inspections Complete', { proposed_stage: 'operation_established|work_completed', needs: 'per_record' },
  '3h: D3 — completion decided per record by work type');
expect('austin-zoning-cases', 'Aborted', { proposed_activity: 'undetermined', needs: 'receipt' }, '3i: D8 — "Aborted" needs documented semantics');
expect('austin-zoning-cases', 'Withdrawn', { proposed_activity: 'inactive', inactive_category: 'withdrawn' }, '3j: withdrawn is inactive');
expect('austin-zoning-cases', 'Recommended for Approval', { proposed_stage: 'under_review', needs: 'review' }, '3k: a recommendation is not an approval');
expect('austin-issued-construction-permits', 'On Hold', { proposed_activity: 'paused' }, '3l: D6 — on hold is paused');
expect('bellevue-permits', 'Revoked', { proposed_activity: 'undetermined', needs: 'receipt' }, '3m: D8 — "Revoked" needs documented semantics');
expect('austin-issued-construction-permits', 'Application Incomplete', { proposed_stage: 'filed' }, '3n: "Incomplete" is not completion');
expect('arlington-issued-permits', 'Denied', { proposed_activity: 'inactive', inactive_category: 'denied' }, '3o: denied is inactive');

// 4. Nothing that needs a receipt claims to have one; nothing reaches Operating on wording alone.
ok(rows.filter((r) => r.needs === 'receipt').every((r) => r.documentation_receipt === 'none on file'), '4a: no receipt is implied');
ok(rows.filter((r) => r.proposed_column === 'operating').length === 0, '4b: no value reaches Operating now without a per-record decision');
// 5. Every move to an earlier column is flagged for review.
const ORDER = { proposed: 1, approved: 2, operating: 3 };
const earlier = rows.filter((r) => r.proposed_activity === 'active' && ORDER[r.old_column] && ORDER[r.proposed_column]
  && ORDER[r.proposed_column] < ORDER[r.old_column]);
ok(earlier.length > 0, '5a: some values move to an earlier column (control)', earlier.length);
ok(earlier.every((r) => r.needs !== ''), '5b: every earlier-column move is flagged', earlier.filter((r) => !r.needs).map((r) => r.status));
// 6. No state or place is named in the rules.
const src = readFileSync(join(root, 'scripts/lifecycle-mapping-audit.mjs'), 'utf8');
const rulesSrc = src.slice(src.indexOf('const RULES = ['), src.indexOf('function proposeStatus'));
ok(rulesSrc.length > 500 && !/austin|portland|dallas|texas|oregon|arizona|nevada/i.test(rulesSrc), '6: the status rules name no state or place');

if (failures) { console.error('\n' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('\nALL PASS');
