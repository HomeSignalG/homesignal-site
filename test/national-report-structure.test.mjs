// THE NATIONAL DEVELOPMENT ACTIVITY REPORT — structural pins (Development Activity plan, Order G).
// Each pin defends an architectural invariant that a behavioural test cannot see, because breaking it changes no output
// today: one classifier, one geocoder, one spatial read, nothing stored, JWT on, the rights registry closed.
// Reads source text only (comments stripped where a comment could quote what the code must not contain).
// Run: node test/national-report-structure.test.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
/** Code with // and block comments removed, so a pin cannot be satisfied (or tripped) by prose that quotes the thing. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const FN = 'supabase/functions/get-development-activity-report';
const MOD = 'supabase/functions/_shared/national-report.ts';
const GATE = 'supabase/functions/_shared/admin-gate.ts';
const REST = 'supabase/functions/_shared/service-rest.ts';
const files = { module: MOD, handler: FN + '/handler.ts', data: FN + '/data.ts', index: FN + '/index.ts', gate: GATE, rest: REST, reads: 'supabase/functions/_shared/change-reads.ts' };
const src = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, read(f)]));
const all = Object.values(src).map(code).join('\n');

// ---- 1. one classifier: Type and lifecycle are decided in lib/project-type.js and nowhere else ------------------------------
{
  const authority = read('lib/project-type.js');
  const gen = read('supabase/functions/_shared/project-type.generated.js');
  const header = [
    '// GENERATED FILE — DO NOT EDIT. Source of truth: lib/project-type.js.',
    '// Regenerate with: node scripts/gen-project-type-module.mjs',
    '// Everything below the marker line is lib/project-type.js, byte for byte.',
    '// test/national-report-structure.test.mjs fails when it is not.',
    '// ==== BEGIN lib/project-type.js (verbatim) ====',
  ].join('\n') + '\n';
  ok(gen === header + authority, '1a the copy the edge function loads is lib/project-type.js byte for byte under a fixed header (regenerate with scripts/gen-project-type-module.mjs)', gen.length - (header + authority).length);
  ok(gen.startsWith('// GENERATED FILE — DO NOT EDIT'), '1b and says on its first line that it is generated');
  ok(/canonicalProjectType\(/.test(code(src.module)) && /canonicalLifecycle\(/.test(code(src.module)), '1c the module asks the authority for Type and lifecycle');
  ok(!/CATEGORY_REGISTRY|function classifyProjectType|function lifecycleKey|LIFECYCLE_LABELS/.test(all), '1d and defines no Type or lifecycle rule of its own');
  ok(!/['"](built|active|on file)['"]/i.test(all), '1e nor maps any publisher status word to a lifecycle key');
  ok(/import '\.\/project-type\.generated\.js';/.test(src.module), '1f the module loads the generated copy, and only that (not lib/, which is outside the function bundle)');
  ok(!/from ['"][^'"]*\/lib\//.test(all), '1g nothing in the function reaches outside its own tree');
  const gen2 = read('scripts/gen-project-type-module.mjs');
  ok(/--check/.test(gen2) && /HEADER_LINES/.test(gen2), '1h the generator has a --check mode');
}

// ---- 2. one geocoder, one spatial read, one registry ----------------------------------------------------------------------------
{
  ok(/\/functions\/v1\/geocode-address/.test(src.data), '2a the address is resolved by the existing geocode-address function');
  ok(!/census\.gov|geocoding\./i.test(all), '2b there is no second geocoder client in the function');
  ok(/rpc\/n5_projects_within_radius/.test(src.data) && /p_radius_mi/.test(src.data), '2c nearby projects come from the canonical spatial read');
  ok(!/ST_DWithin|st_distance|haversine|earth_distance/i.test(all) && !/Math\.(sin|cos|atan2|asin)\(/.test(all), '2d and no distance is computed here');
  ok(/canonical_zip_registry/.test(src.data), '2e ZIP support is asked of canonical_zip_registry');
  ok(/dev_change_event_reportable/.test(src.reads) && !/dev_change_event\?/.test(code(src.reads)) && !/dev_change_event\?/.test(code(src.data)), '2f changes are read from the ledger\'s reportable view, never the raw event table');
  ok(!/get-future-surroundings-report|nyc-v1|allowlist\.ts|soda|socrata/i.test(all), '2g the legacy NYC engine is not a dependency: there is one commercial engine');
  ok(!/\b(nyc|new york|manhattan|brooklyn|queens|bronx|wsdot|austin|seattle|denver|phoenix|boston|chicago)\b/i.test(all), '2h the engine names no city and no source');
  const fnDirs = readdirSync(join(root, 'supabase/functions')).filter((d) => statSync(join(root, 'supabase/functions', d)).isDirectory());
  ok(fnDirs.includes('get-future-surroundings-report'), '2i (control) the legacy engine still exists, so 2g is a real absence and not an empty search');
}

// ---- 3. nothing is stored -------------------------------------------------------------------------------------------------------------
{
  const inFn = readdirSync(join(root, FN)).map((f) => read(FN + '/' + f)).join('\n');
  ok(!/issueSnapshot|report_snapshot_issue|report-snapshot\.ts/.test(code(inFn)), '3a the edge function never calls or imports the snapshot writer');
  ok(!/report_private_context|report_snapshot/.test(code(inFn)), '3b and names neither table');
  ok(/import \{ snapshotBodyOf, subjectRelativeKeys \} from '\.\/report-snapshot\.ts';/.test(src.module), '3c the module imports only the pure body and key helpers from the snapshot module');
  const callers = [];
  const walk = (d) => { for (const e of readdirSync(join(root, d))) { const p = d + '/' + e; if (statSync(join(root, p)).isDirectory()) walk(p); else if (/\.(ts|js|mjs)$/.test(e) && /report_snapshot_issue/.test(code(read(p)))) callers.push(p); } };
  walk('supabase/functions');
  ok(callers.join() === 'supabase/functions/_shared/report-snapshot.ts', '3d across every edge function the writer is named by its own module and nothing else', callers);
  ok(/stored: false/.test(src.handler) && /report_id: null/.test(src.handler), '3e the response states it stored nothing');
  ok(!/\.insert\(|method: 'PUT'|method: 'PATCH'|method: 'DELETE'/.test(all), '3f and the data layer makes no write of any kind');
  const methods = [...src.data.matchAll(/method: '([A-Z]+)'/g)].map((m) => m[1]);
  ok(methods.length === 2 && methods.every((m) => m === 'POST'), '3g the only POSTs are the geocoder call and the spatial read (a read-only RPC)', methods);
}

// ---- 4. the access model ---------------------------------------------------------------------------------------------------------------
{
  const cfg = read('supabase/config.toml');
  ok(/\[functions\.get-development-activity-report\]\s*\nverify_jwt = true/.test(cfg), '4a the function pins verify_jwt = true');
  const wf = read('.github/workflows/deploy-edge-functions.yml').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'); // YAML comments removed
  const noJwt = [...wf.matchAll(/--no-verify-jwt/g)].length;
  ok(noJwt === 1 && /if \[ "\$FN" = "get-address-report" \]/.test(wf) && !/get-development-activity-report/.test(wf), '4b the deploy workflow\'s one --no-verify-jwt exception is get-address-report, and this function is not in it', noJwt);
  const h = code(src.handler);
  const g = code(src.gate);
  const at = (s) => h.indexOf(s);
  const gat = (s) => g.indexOf(s);
  ok(at('authorizeAdmin(req, deps)') > 0 && at('authorizeAdmin(req, deps)') < at('readBounded(req)') && at('readBounded(req)') < at('deps.geocode('),
    '4c the order is: the shared gate (authenticate, then allow-list), then read the body, then any geocode or data read', [at('authorizeAdmin(req, deps)'), at('readBounded(req)'), at('deps.geocode(')]);
  ok(gat('deps.authenticate(') > 0 && gat('deps.authenticate(') < gat('deps.isAdmin('), '4c the gate itself authenticates before it asks the allow-list', [gat('deps.authenticate('), gat('deps.isAdmin(')]);
  ok(!/auth\/v1\/user|dashboard_admins\?|rows\[0\]\.email|deps\.authenticate\(|deps\.isAdmin\(/.test(h + code(src.data)), '4c and the handler and the report reads carry NO copy of the gate: it lives once, in the shared modules');
  ok(!/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/.test(h + g), '4d there is no wildcard CORS origin');
  ok(/MAX_BODY_BYTES = 4096/.test(g) && /Cache-Control': 'no-store'/.test(g), '4e the body is bounded and responses are no-store');
  ok(/dashboard_admins/.test(src.rest) && !/dashboard_admins.*(insert|update|delete)/i.test(src.rest), '4f the allow-list is read from dashboard_admins, never written');
  ok(/error: 'internal'/.test(h) && !/e\.message|err\.message|String\(e\)/.test(h + g), '4g an unexpected error is answered without its message');
  ok(!/console\./.test(all), '4h and nothing logs (the address may be in scope everywhere here)');
  ok(/SUPABASE_SERVICE_ROLE_KEY/.test(src.index) && !/SUPABASE_SERVICE_ROLE_KEY/.test(code(src.handler) + code(src.data) + code(src.module) + g + code(src.rest)), '4i only index.ts reads the service key; every other file receives it');
}

// ---- 5. purity: the module and the handler can reach nothing by themselves ---------------------------------------------------------
{
  for (const k of ['module', 'handler', 'data', 'gate', 'rest', 'reads']) {
    ok(!/\bDeno\b|process\.env|\brequire\(/.test(code(src[k])), '5' + 'abcdef'[['module', 'handler', 'data', 'gate', 'rest', 'reads'].indexOf(k)] + ' ' + files[k].split('/').pop() + ' reads no environment and no runtime global');
  }
  ok(!/\bfetch\(/.test(code(src.module)) && !/\bfetch\(/.test(code(src.handler)) && !/\bfetch\(/.test(code(src.data)) && !/\bfetch\(/.test(code(src.gate)), '5d none of them calls a bare fetch: the network arrives injected');
  ok(/\(input, init\) => fetch\(input, init\)/.test(code(src.index)), '5e index.ts is the one place the real fetch is handed in');
}

// ---- 6. the rights registry is CLOSED ------------------------------------------------------------------------------------------------
{
  const reg = JSON.parse(read('supabase/functions/_shared/report-rights.json'));
  ok(Array.isArray(reg.cleared) && reg.cleared.length === 0,
    '6a NO SOURCE FAMILY IS CLEARED. Adding one is a recorded clearance (audit reference, date, attribution), and this pin is edited in the same change so the decision is visible twice', reg.cleared.length);
  ok(/corporate-output-source-rights-audit-2026-09-27\.md/.test(reg.authority) && /HOLD is never cleared/.test(reg.rule), '6b the registry names its authority and says a HOLD is never cleared');
  ok(existsSync(join(root, reg.authority)), '6c and the authority file exists');
  ok(/report-rights\.json/.test(src.index) && /rights/.test(code(src.handler)) && /validateRights\(/.test(code(src.module)), '6d the function loads that file and validates it on every request');
  ok(!/rights_class/.test(all), '6e the report does not read the ledger\'s rights_class column (it is NULL by design; rights are enforced here, from the audit)');
  const m = code(src.module);
  ok(/registry_id may not be a pattern/.test(m) && /duplicate registry_id/.test(m), '6f the registry rejects wildcards and duplicates');
}

// ---- 7. it is gated in CI ----------------------------------------------------------------------------------------------------------------
{
  const unit = read('.github/workflows/unit-tests.yml');
  ok(/'supabase\/functions\/\*\*'/.test(unit) && /'test\/\*\*'/.test(unit) && /'supabase\/config\.toml'/.test(unit) && /'scripts\/\*\*'/.test(unit), '7a the required unit check runs when the function, its tests, its generator or the JWT config change');
  const runner = read('scripts/run-unit-tests.mjs');
  ok(/\.test\.mjs/.test(runner) && /readdirSync\(testDir\)/.test(runner), '7b and it discovers test files by directory, so these three suites cannot be forgotten');
  for (const t of ['national-report.test.mjs', 'national-report-function.test.mjs', 'national-report-structure.test.mjs']) {
    ok(existsSync(join(root, 'test', t)) && !/browser/.test(t), '7c ' + t + ' exists and is an offline suite');
  }
}

// ---- 8. the round trip through the real writer is wired, disposable-only, and credential-free ------------------------------------------
{
  const wf = read('.github/workflows/report-snapshot-suite.yml');
  ok(/bash test\/national_report_pg\/run\.sh/.test(wf), '8a the snapshot workflow runs the national round trip');
  ok(/actions\/setup-node@v4[\s\S]{0,120}node-version: '22'/.test(wf), '8b on Node 22 (the round trip imports TypeScript, which Node strips on import from 22.18)');
  const block = (from, to) => wf.slice(wf.indexOf(from), wf.indexOf(to));
  const pr = block('  pull_request:', '  push:'), push = block('  push:', '  workflow_dispatch:');
  const needs = ["'test/national_report_pg/**'", "'supabase/functions/_shared/national-report.ts'", "'supabase/functions/_shared/report-rights.json'", "'supabase/functions/_shared/project-type.generated.js'"];
  ok(pr.length > 100 && needs.every((p) => pr.includes(p)), '8c the PULL REQUEST trigger (the merge gate) runs when the engine, its rights registry, its generated authority copy or the round trip change', needs.filter((p) => !pr.includes(p)));
  ok(push.length > 100 && needs.every((p) => push.includes(p)), '8c and so does the push-to-main trigger', needs.filter((p) => !push.includes(p)));
  ok(!/secrets\./.test(wf) && /Refuse to run if any Supabase credential is present/.test(wf), '8d the workflow holds no secret and refuses to run if a Supabase credential is present');
  const run = read('test/national_report_pg/run.sh');
  ok(/case "\$PGDATABASE" in \*disposable\*\)/.test(run) && /ABORT/.test(run), '8e the round trip refuses any database not named disposable');
  ok(/SUPABASE_DB_URL/.test(run) && /SUPABASE_WRITE_KEY/.test(run), '8f and refuses to run when a Supabase credential is in the environment');
  ok(/docs\/report-snapshot\.sql/.test(run) && /docs\/report-private-context\.sql/.test(run), '8g it applies the SHIPPED SQL of record, not a copy');
  const rt = read('test/national_report_pg/roundtrip.mjs');
  ok(/issueSnapshot\(rpc,/.test(rt) && /national-report\.ts/.test(rt) && /report-snapshot\.ts/.test(rt), '8h it stores through the real snapshot module and assembles with the real engine');
  ok(!/mock|stub|fake/i.test(code(rt).replace(/\/\/.*$/gm, '')), '8i and uses no stand-in for either');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
