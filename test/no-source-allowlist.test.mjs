// NO PER-SOURCE ALLOWLIST — the national source policy of 2026-11-01 (docs/national-source-policy-2026-11-01.md).
//
// The founder removed, nationally, every requirement that a source's terms be verified before its records appear, and ruled out
// any class approval, review queue or manually maintained source list. What decides whether a record may appear in a Development
// Activity Report is PROVENANCE: a wired connector stamped it with its source family, and it carries its official record link.
//
// This test fails if a per-source allowlist comes back in any form:
//   1. the old files exist again (report-rights.json, its generator, its tests) or any function, workflow or script names them;
//   2. a report module holds a clearance lookup, an "uncleared" blocker or a rights exclusion;
//   3. a source family no file has ever named does not reach the report and the changes view with nothing else edited;
//   4. the provenance rule stops holding (a record with no family, or no record link, appears);
//   5. the credit-line file names a source no wired connector produces, a blank line, or a line with no evidence on file;
//   6. the TDLR TABS adapter stops stamping its source family (its records would again be unlinked and left out);
//   7. a document that once required per-source approval loses its superseded notice.
// Run: node test/no-source-allowlist.test.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d).slice(0, 400) + ']' : '')); } };
/** Source with comments removed, so a comment that QUOTES a forbidden word cannot fail a check, and a comment cannot satisfy one. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\`])\/\/.*$/gm, '$1');

// ---- 1. the old allowlist and everything that maintained it are gone ------------------------------------------------------------------------
const GONE = ['supabase/functions/_shared/report-rights.json', 'scripts/build-report-rights.mjs', 'test/report-rights-r7.test.mjs', 'test/report-rights-evidence.test.mjs'];
ok(GONE.every((f) => !existsSync(join(root, f))), '1a the allowlist, its generator and its two gate tests do not exist', GONE.filter((f) => existsSync(join(root, f))));
const files = [];
const walk = (d) => { for (const e of readdirSync(join(root, d))) { const q = d + '/' + e; const st = statSync(join(root, q)); if (st.isDirectory()) { if (!/node_modules|fixtures/.test(q)) walk(q); } else if (/\.(ts|js|mjs|py|sh|yml|yaml|sql|json)$/.test(e)) files.push(q); } };
for (const d of ['supabase/functions', 'scripts', '.github/workflows', 'lib']) walk(d);
ok(files.length > 300, '1b (control) the walk read the functions, scripts, workflows and libraries', files.length);
const naming = files.filter((f) => /report-rights(\.json)?|build-report-rights/.test(code(read(f))));
ok(naming.length === 0, '1c no function, script, workflow or library names the old allowlist (comments excepted)', naming);

// ---- 2. the report modules hold no clearance lookup -----------------------------------------------------------------------------------------
const REPORT = [
  'supabase/functions/_shared/national-report.ts', 'supabase/functions/_shared/changes-since-report.ts', 'supabase/functions/_shared/property-watch.ts',
  ...['get-development-activity-report', 'follow-development-report', 'run-property-watch'].flatMap((fn) => ['index.ts', 'handler.ts', 'data.ts'].map((f) => 'supabase/functions/' + fn + '/' + f)),
];
const FORBIDDEN = /\bcleared\b|no_rights|validateRights|RightsRegistry|SOURCES_NOT_INCLUDED|NO_INCLUDED_SOURCE|CONTAINS_UNCLEARED|['"]HOLD['"]|['"]CLEARED['"]/;
ok(REPORT.every((f) => existsSync(join(root, f))), '2a (control) every report module exists');
ok(REPORT.some((f) => /validateAttribution/.test(code(read(f)))), '2b (control) the comment stripper keeps code: a real identifier is still found');
const holders = REPORT.filter((f) => FORBIDDEN.test(code(read(f))));
ok(holders.length === 0, '2c no report module holds a clearance lookup, a rights exclusion, an "uncleared" blocker or a HOLD / CLEARED label', holders.map((f) => [f, (code(read(f)).match(FORBIDDEN) || [])[0]]));

// ---- 3. a source no file has ever named appears, with nothing else edited ---------------------------------------------------------------------
const M = await import('../supabase/functions/_shared/national-report.ts');
const C = await import('../supabase/functions/_shared/changes-since-report.ts');
const S = await import('../supabase/functions/_shared/report-snapshot.ts');
const NEW = 'brand-new-source-' + Date.now().toString(36);
const CREDITS = JSON.parse(read('supabase/functions/_shared/source-attribution.json'));
const NOW = new Date('2026-11-01T12:00:00Z');
const SUBJECT = { address: '1 Test Way, Testville, UT 84302', matched_address: '1 TEST WAY, TESTVILLE, UT, 84302', lat: 41.51, lng: -112.01, zip: '84302' };
const row = (k, fam) => ({ source_key: k, feature_id: 'pt:' + k, registry_id: fam, provenance: 'proven_stored_point', distance_mi: 0.2, geometry_type: 'Point', has_more: false });
const proj = (k, fam, x = {}) => ({ source_key: k, registry_id: fam, record_kind: 'development', name: 'Record ' + k, type: 'Residential', type_raw: null, status: 'Proposed', stage: null,
  developer: null, size: null, investment: null, submitted_at: '2026-10-20', date_kind: 'filed', address: 'SR-13', source_ref: 'https://example.gov/record/' + k, ...x });
const run = (rows, projects, view = 'customer') => M.assemble({ now: NOW, view, zip_supported: true, radius_mi: 0.5, attribution: CREDITS, subject: SUBJECT, rows, projects, ledger: [], events: [], health: [] });
ok(!files.some((f) => read(f).includes(NEW)), '3a (control) the new family is named in no file');
const out = run([row('n1', NEW)], [proj('n1', NEW)]);
ok(out.intelligence.projects.length === 1 && out.intelligence.projects[0].source_family === NEW, '3b a record from it is in the customer report', out.intelligence.projects.map((p) => p.source_family));
ok(out.storage_blockers.length === 0 && out.intelligence.coverage.limitations.length === 0, '3c the report is storable and carries no "sources not included" limitation', [out.storage_blockers, out.intelligence.coverage.limitations]);
const stored = { report_id: '11111111-1111-4111-8111-111111111111', content_hash: 'h'.repeat(64), report_version: M.REPORT_VERSION, generated_at: '2026-11-01T12:00:05Z', body: S.snapshotBodyOf(out.intelligence) };
const ev = { identity_key: 'n1', event_type: 'status_changed', material: true, observed_at: '2026-11-02T06:00:00Z', created_at: '2026-11-02T06:05:00Z', prev_facts: { status: 'Proposed' }, new_facts: { status: 'Approved' }, changed_fields: ['status'], publisher_event_type: null, publisher_event_date: null };
const led = { identity_key: 'n1', registry_id: NEW, comparable: true, change_ready: true, observation_count: 2, first_observed_at: '2026-10-20T00:00:00Z', last_observed_at: '2026-11-02T06:00:00Z' };
const since = C.changesSinceReport({ now: new Date('2026-11-02T08:00:00Z'), view: 'customer', attribution: CREDITS, report: stored, ledger: [led], events: [ev], health: [] });
ok(since.changed.length === 1 && since.changed[0].source_family === NEW, '3d its change since the report is shown', since.changed.map((c) => c.source_family));

// ---- 4. provenance still holds ----------------------------------------------------------------------------------------------------------------
const none = run([row('x1', null)], [proj('x1', null)]);
ok(none.intelligence.projects.length === 0 && none.intelligence.coverage.limitations.some((l) => l.code === 'RECORDS_NOT_TRACEABLE'), '4a a record with no source family is left out, and the report says so');
ok(run([row('x1', null)], [proj('x1', null)], 'internal').intelligence.projects.length === 0, '4b in the internal view too');
ok(run([row('x2', NEW)], [proj('x2', NEW, { source_ref: '' })]).intelligence.projects.length === 0, '4c a record with no official record link is left out');

// ---- 5. the credit-line file decides nothing and every line is backed ----------------------------------------------------------------------------
const reg = JSON.parse(read('supabase/functions/get-address-report/jurisdiction-registry.json'));
const regIds = new Set();
(function w(o) { if (Array.isArray(o)) o.forEach(w); else if (o && typeof o === 'object') { if (typeof o.registry_id === 'string') regIds.add(o.registry_id); Object.values(o).forEach(w); } })(reg);
const TABS = await import('../supabase/functions/get-address-report/sources/tdlr-tabs.ts');
const families = new Set([...regIds, TABS.TABS_SOURCE_FAMILY]);
ok(regIds.size > 200, '5a (control) the registry was read', regIds.size);
const keys = Object.keys(CREDITS.attribution || {});
ok(keys.length > 0 && keys.every((k) => families.has(k)), '5b every credit line belongs to a source a wired connector produces', keys.filter((k) => !families.has(k)));
ok(keys.every((k) => typeof CREDITS.attribution[k] === 'string' && CREDITS.attribution[k].trim()), '5c no credit line is blank (a source with none is absent)');
ok(keys.every((k) => { const e = (CREDITS._evidence || {})[k]; if (!e || !existsSync(join(root, e.file))) return false; const t = read(e.file); return t.includes(e.dataset) && /CLEARED WITH ATTRIBUTION/.test(t); }),
  '5d every credit line names the publisher\'s own evidence file, which names the dataset and records the attribution it requires', keys.filter((k) => !(CREDITS._evidence || {})[k]));
ok(/decides NOTHING about which records may appear/.test(CREDITS._doc || ''), '5e the file says, in itself, that it is not an allowlist');
ok(M.validateAttribution(CREDITS).attribution && Object.keys(M.validateAttribution(CREDITS).attribution).length === keys.length, '5f the engine accepts the shipped file');

// ---- 6. TDLR TABS records carry their source family ----------------------------------------------------------------------------------------------
const tabs = code(read('supabase/functions/get-address-report/sources/tdlr-tabs.ts'));
ok(TABS.TABS_SOURCE_FAMILY === 'tdlr-tabs' && /source_registry_id: TABS_SOURCE_FAMILY,/.test(tabs), '6a the TABS adapter stamps every site with its source family, the field the materializer stores as registry_id');

// ---- 7. the documents that once required approval say they are superseded ------------------------------------------------------------------------
const POLICY = 'docs/national-source-policy-2026-11-01.md';
const SUPERSEDED = ['docs/corporate-output-source-rights-audit-2026-09-27.md', 'docs/development-activity-founder-ruling-r7-2026-10-04.md', 'docs/source-clearance-evidence-template.md'];
ok(existsSync(join(root, POLICY)) && /2026-11-01/.test(read(POLICY)), '7a the national source policy document exists');
ok(SUPERSEDED.every((f) => existsSync(join(root, f)) && /^> \*\*SUPERSEDED — 2026-11-01 national source policy\*\*/m.test(read(f).split('\n').slice(0, 12).join('\n')) && read(f).includes(POLICY)),
  '7b each superseded document carries the notice near its top and names the policy', SUPERSEDED.filter((f) => !/SUPERSEDED — 2026-11-01/.test(read(f))));

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
