// Official-document development projects, PR 1 (site half): offline checks on the two SQL files and the
// suite workflow. The behaviour is proven on a disposable PostGIS (test/official_documents_pg, CI
// official-documents-suite.yml); this file pins what that suite cannot see.
// Run: node test/official-documents-structure.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m, d); } };

const FILES = ['docs/official-documents-map-gate.sql', 'docs/official-documents-contract.sql'];
const sql = Object.fromEntries(FILES.map((f) => [f, read(f)]));
// executable text: comments removed, so a word in an explanation is not a rule
const code = (s) => s.replace(/--[^\n]*/g, '');

// T-26: no place name in the pipeline code
const PLACES = ['starbase', 'cameron', 'spacex', '78521', 'brownsville', 'boca chica'];
for (const f of FILES) {
  const lower = sql[f].toLowerCase();
  ok(PLACES.every((p) => !lower.includes(p)), `T-26 ${f} names no place`, PLACES.filter((p) => lower.includes(p)).join(','));
}
// the control: the check finds a place name when one is there
ok(PLACES.some((p) => 'Starbase notice'.toLowerCase().includes(p)), 'T-26 control: the place list detects a planted name');

// both files say they are not applied, and nothing in them opens a gate
for (const f of FILES) ok(/⛔ NOT APPLIED/.test(sql[f]), `${f} carries the NOT APPLIED banner`);
const gate = code(sql['docs/official-documents-map-gate.sql']);
ok(!/insert\s+into\s+public\.official_document_gate_decision[^;]*\btrue\b/i.test(gate.replace(/official_documents_exposure_(off|restore)[\s\S]*?\$fn\$;/g, '')),
   'no statement outside the kill switch and its rollback writes an open gate');
ok(/coalesce\(\(select d\.is_open[\s\S]*?\), false\)/.test(gate), 'a gate with no decision reads closed');
ok(/'NOT_ACTIVE', 'incremental'\)/.test(code(sql['docs/official-documents-contract.sql'])), 'official_documents is registered NOT_ACTIVE');
ok(!/active_state\s*=\s*'ACTIVE'/.test(code(sql['docs/official-documents-contract.sql'])), 'the contract file activates nothing');

// every new object is closed to the public roles
for (const obj of ['official_document_gate_decision', 'dc_source_admission_gate']) {
  ok(new RegExp(`revoke all on public\\.${obj} from public, anon, authenticated`).test(gate), `${obj}: revoked from public roles`);
}
for (const fn of ['official_document_gate_open', 'dc_source_map_admitted', 'dc_entity_open_actions', 'dc_zip_open_actions',
                  'official_documents_exposure_off', 'official_documents_exposure_restore']) {
  ok(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`).test(gate),
     `${fn}: revoked from public roles`);
}

// splices: every anchor is counted and every splice re-read (claims rule 7)
const anchors = (gate.match(/appears % times/g) || []).length;
const landed = (gate.match(/did not land/g) || []).length;
ok(anchors === 3 && landed === 4, `the map-gate file counts its anchors (${anchors}) and proves each splice landed (${landed})`);

// the workflow never touches production
const wf = read('.github/workflows/official-documents-suite.yml');
ok(!/secrets\./.test(wf), 'the suite workflow names no secret');
ok(/Refuse to run if any Supabase credential is present/.test(wf), 'the suite workflow refuses when a credential is present');
ok(/permissions:\s*\n\s*contents: read/.test(wf), 'the suite workflow holds only contents: read');
for (const f of [...FILES, 'test/official_documents_pg/**']) ok(wf.includes(`'${f}'`), `the suite runs when ${f} changes`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
