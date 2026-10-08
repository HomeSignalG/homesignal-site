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
const files = { module: MOD, handler: FN + '/handler.ts', data: FN + '/data.ts', index: FN + '/index.ts', gate: GATE, rest: REST, reads: 'supabase/functions/_shared/change-reads.ts', reportReads: 'supabase/functions/_shared/report-reads.ts' };
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
  // the named exceptions read an EVALUATION's status (docs/evaluation-entitlement.sql; one reading, trialStanding, and the gate's use of
  // it) and a private context's state, never a publisher word. (Build step 8 moved the stored-report address read, and its second look at a private
  // context's state, into _shared/private-subject.ts, which this scan does not cover; test/report-private-context-structure.test.mjs 5c5 pins it.)
  const trialStatus = /export function trialStanding\(t: TrialState\): 'active' \| 'complete' \| 'ended' \{[\s\S]*?\n\}|if \(standing !== 'active' && standing !== 'complete'\)|if \(!c \|\| c\.state !== 'active' \|\|/g;
  ok((all.match(trialStatus) || []).length === 3 && !/['"](built|active|on file)['"]/i.test(all.replace(trialStatus, '')),
    '1e nor maps any publisher status word to a lifecycle key (the named exceptions read an EVALUATION status, in trialStanding and the gate\'s one use of it, and a private context\'s state, never a publisher word)');
  ok(/import '\.\/project-type\.generated\.js';/.test(src.module), '1f the module loads the generated copy, and only that (not lib/, which is outside the function bundle)');
  ok(!/from ['"][^'"]*\/lib\//.test(all), '1g nothing in the function reaches outside its own tree');
  const gen2 = read('scripts/gen-project-type-module.mjs');
  ok(/--check/.test(gen2) && /HEADER_LINES/.test(gen2), '1h the generator has a --check mode');
}

// ---- 2. one geocoder, one spatial read, one registry ----------------------------------------------------------------------------
{
  ok(/\/functions\/v1\/geocode-address/.test(src.data), '2a the address is resolved by the existing geocode-address function');
  ok(!/census\.gov|geocoding\./i.test(all), '2b there is no second geocoder client in the function');
  // build step 9: the spatial read moved, unchanged, into _shared/report-reads.ts so the report and the Watch call it the same way
  ok(/rpc\/n5_projects_within_radius/.test(src.reportReads) && /p_radius_mi/.test(src.reportReads) && /radius: reportReads\.radius,/.test(code(src.data)) && !/n5_projects_within_radius/.test(code(src.data)),
    '2c nearby projects come from the canonical spatial read, defined once (_shared/report-reads.ts) and used by this function through it');
  // The one place trigonometry is allowed is bearingDeg (the map's direction, 100526 step 2). It returns a direction, never a
  // distance, and its result goes only to the response-only block. Everything else stays free of geometry.
  const bearingFn = /export function bearingDeg\([\s\S]*?\n\}/.exec(src.module);
  const allButBearing = bearingFn ? all.replace(code(bearingFn[0]), '') : all;
  ok(!!bearingFn && !/ST_DWithin|st_distance|haversine|earth_distance/i.test(all) && !/Math\.(sin|cos|atan2|asin)\(/.test(allButBearing), '2d and no distance is computed here (trigonometry only inside bearingDeg)');
  ok(!!bearingFn && !/distance/i.test(code(bearingFn[0])) && /bearings\[p\.source_key\] = b;/.test(src.module) && (src.module.match(/bearingDeg\(/g) || []).length === 2,
    '2d2 bearingDeg computes no distance, and its one caller writes only the response-only bearings');
  ok(/canonical_zip_registry/.test(src.data), '2e ZIP support is asked of canonical_zip_registry');
  ok(/dev_change_event_reportable/.test(src.reads) && !/dev_change_event\?/.test(code(src.reads)) && !/dev_change_event\?/.test(code(src.data)), '2f changes are read from the ledger\'s reportable view, never the raw event table');
  ok(!/get-future-surroundings-report|nyc-v1|allowlist\.ts|soda|socrata/i.test(all), '2g the legacy NYC engine is not a dependency: there is one commercial engine');
  ok(!/\b(nyc|new york|manhattan|brooklyn|queens|bronx|wsdot|austin|seattle|denver|phoenix|boston|chicago)\b/i.test(all), '2h the engine names no city and no source');
  const fnDirs = readdirSync(join(root, 'supabase/functions')).filter((d) => statSync(join(root, 'supabase/functions', d)).isDirectory());
  ok(fnDirs.includes('get-future-surroundings-report'), '2i (control) the legacy engine still exists, so 2g is a real absence and not an empty search');
}

// ---- 3. nothing is stored without a credit (build step 5b: only a charged trial report, through the evaluation's one transaction) -------------
{
  const inFn = readdirSync(join(root, FN)).map((f) => read(FN + '/' + f)).join('\n');
  const fnCode = code(inFn), dataCode = code(src.data), hanCode = code(src.handler);
  ok(!/issueSnapshot|report_snapshot_issue/.test(fnCode) && (dataCode.match(/issueBrokerageReport\(/g) || []).length === 1 && !/issueBrokerageReport/.test(hanCode),
    '3a the edge function never calls the plain snapshot writer: its ONE store is issueBrokerageReport (snapshot + credit, one transaction, the allotment decided by the database), called once, from the data layer');
  ok((hanCode.match(/deps\.issue\(/g) || []).length === 1 && /if \(!trial \|\| !credit\.uses_report\) \{\n\s*return reply\(req, \{[\s\S]*?\}\);\n\s*\}\n\s*\n\s*\n?\s*let issued: EvaluationIssue;/.test(hanCode),
    '3a2 and the handler reaches it only past the one branch that returns for an admin, and for a report the credit rule does not charge');
  const tablesNamed = [...fnCode.matchAll(/report_private_context\w*|report_snapshot\w*/g)].map((m) => m[0]);
  // build step 6: the address of a STORED report is read for the member's own saved-reports list and reopened report; build step 7 returns the
  // address AND the client label together (cleaned for printing); build step 8 moves that read into the ONE shared reader
  // (_shared/private-subject.ts), which the public share-link function also uses for the address alone. This data layer only asks it.
  ok(JSON.stringify(tablesNamed) === '["report_snapshot","report_private_context_read"]'
    && /subjectOf: \(contextId\) => subjects\.subjectOf\(contextId, LABEL_MAX\),/.test(dataCode) && (dataCode.match(/c\.label/g) || []).length === 0
    && /rest<\{ body: string \}>\('report_snapshot\?select=body&report_id=eq\.' \+ encodeURIComponent\(reportId\)\)/.test(dataCode)
    && /return norm\(c\.address\) === norm\(address\) \? 'match' : 'mismatch';/.test(dataCode) && !/c\.(normalized_address|latitude|longitude|property_keys)/.test(dataCode),
    '3b it names the stored report once (its body, by id, for a retried key) and the private context once (the address compared inside the data layer, where only match / mismatch / unknown leaves); a stored report\'s address and client label (build steps 6 and 7) are asked of the ONE shared reader (build step 8)', tablesNamed);
  ok(/import \{ snapshotBodyOf, subjectRelativeKeys \} from '\.\/report-snapshot\.ts';/.test(src.module), '3c the module imports only the pure body and key helpers from the snapshot module');
  const callers = [];
  const walk = (d) => { for (const e of readdirSync(join(root, d))) { const p = d + '/' + e; if (statSync(join(root, p)).isDirectory()) walk(p); else if (/\.(ts|js|mjs)$/.test(e) && /report_snapshot_issue/.test(code(read(p)))) callers.push(p); } };
  walk('supabase/functions');
  ok(callers.join() === 'supabase/functions/_shared/report-snapshot.ts', '3d across every edge function the writer is named by its own module and nothing else', callers);
  ok(/stored: false,\n          report_id: null,/.test(src.handler) && /charged: false,/.test(src.handler), '3e an uncharged report states it stored nothing and charged nothing');
  ok(!/\.insert\(|method: 'PUT'|method: 'PATCH'|method: 'DELETE'/.test(all), '3f and the data layer makes no write of any kind');
  const methods = [...src.data.matchAll(/method: '([A-Z]+)'/g)].map((m) => m[1]);
  const rpcs = [...dataCode.matchAll(/\brpc\('(\w+)'/g)].map((m) => m[1]);
  const restCode = code(read('supabase/functions/_shared/service-rest.ts'));
  ok(methods.length === 1 && methods.every((m) => m === 'POST') && (code(src.reportReads).match(/method: 'POST'/g) || []).length === 1 && JSON.stringify(rpcs) === '["report_private_context_read"]'
     && /issueBrokerageReport\(rpc,/.test(dataCode) && /const evaluation = makeEvaluationReads\(rpc\);/.test(dataCode) && /trialOf: evaluation\.trialOf,/.test(dataCode)
     && /const billing = makeBillingReads\(rpc\);/.test(dataCode) && /planOf: billing\.usageOf,/.test(dataCode)
     && /const \{ base, svc, rest, rpc, authenticate, isAdmin \} = makeServiceReads\(cfg, fetchFn\);/.test(dataCode)
     && (restCode.match(/method: 'POST'/g) || []).length === 1 && /base \+ '\/rest\/v1\/rpc\/' \+ fn/.test(restCode),
    '3g the only POSTs here are the geocoder call (this file) and the spatial read (_shared/report-reads.ts, one POST); every database function goes through the ONE helper in service-rest.ts: the private-context check here, the trial read through _shared/evaluation-reads.ts, the plan read through _shared/billing-reads.ts, and the charged issue through the snapshot module', [methods, rpcs]);
}

// ---- 4. the access model ---------------------------------------------------------------------------------------------------------------
{
  const cfg = read('supabase/config.toml');
  ok(/\[functions\.get-development-activity-report\]\s*\nverify_jwt = true/.test(cfg), '4a the function pins verify_jwt = true');
  const wf = read('.github/workflows/deploy-edge-functions.yml').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'); // YAML comments removed
  const noJwt = [...wf.matchAll(/--no-verify-jwt/g)].length;
  // build step 8 adds the SECOND, deliberate exception: view-shared-report, for the client who opens a private share link and has no account; build step 11 adds
  // the THIRD: development-activity-billing-webhook, for the payment processor, which sends no Supabase token (its HMAC signature is the credential).
  // The pin is exactly those three branches, so a fourth cannot arrive unnoticed (test/report-share-delivery-structure.test.mjs and test/billing-structure.test.mjs pin the others).
  ok(noJwt === 3 && /if \[ "\$FN" = "get-address-report" \]/.test(wf) && /elif \[ "\$FN" = "view-shared-report" \]/.test(wf) && /elif \[ "\$FN" = "development-activity-billing-webhook" \]/.test(wf) && !/get-development-activity-report/.test(wf),
    '4b the deploy workflow\'s only --no-verify-jwt exceptions are get-address-report, view-shared-report and development-activity-billing-webhook, and this function is not in them', noJwt);
  const h = code(src.handler);
  const g = code(src.gate);
  const at = (s) => h.indexOf(s);
  const gat = (s) => g.indexOf(s);
  ok(at('authorizeReportCaller(req, deps)') > 0 && at('authorizeReportCaller(req, deps)') < at('readBounded(req)') && at('readBounded(req)') < at('deps.geocode(') && !/authorizeAdmin\(/.test(h),
    '4c the order is: the shared gate (authenticate, then an admin or an active trial member), then read the body, then any geocode or data read', [at('authorizeReportCaller(req, deps)'), at('readBounded(req)'), at('deps.geocode(')]);
  ok(gat('deps.authenticate(') > 0 && gat('deps.authenticate(') < gat('deps.isAdmin('), '4c the gate itself authenticates before it asks the allow-list', [gat('deps.authenticate('), gat('deps.isAdmin(')]);
  ok(!/auth\/v1\/user|dashboard_admins\?|rows\[0\]\.email|deps\.authenticate\(|deps\.isAdmin\(/.test(h + code(src.data)), '4c and the handler and the report reads carry NO copy of the gate: it lives once, in the shared modules');
  ok(!/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/.test(h + g), '4d there is no wildcard CORS origin');
  ok(/MAX_BODY_BYTES = 4096/.test(g) && /Cache-Control': 'no-store'/.test(g), '4e the body is bounded and responses are no-store');
  ok(/dashboard_admins/.test(src.rest) && !/dashboard_admins.*(insert|update|delete)/i.test(src.rest), '4f the allow-list is read from dashboard_admins, never written');
  ok(/error: 'internal'/.test(h) && !/e\.message|err\.message|String\(e\)/.test(h + g), '4g an unexpected error is answered without its message');
  // audit fix 9 (2026-10-07): index.ts alone passes ONE sink to _shared/safe-log.ts, which writes a name, a status and a number; everything else here still logs nothing
  const allButIndex = Object.entries(src).filter(([k]) => k !== 'index').map(([, v]) => code(v)).join('\n');
  ok(!/console\./.test(allButIndex) && (code(src.index).match(/console\./g) || []).length === 1 && /\(line\) => console\.log\(line\)/.test(code(src.index)), '4h and nothing logs but the one fixed-text line (the address may be in scope everywhere here)');
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

// ---- 6. the rights registry: every entry is a RECORDED DECISION --------------------------------------------------------------------
// Until 2026-10-04 this registry was closed (no source cleared). Founder ruling R7 (docs/development-activity-founder-ruling-r7-2026-10-04.md) lists every source in
// the jurisdiction registry; test/report-rights-r7.test.mjs pins the list itself. A cleared source also switches on charging and storing trial reports (since build
// step 5b), so a change to this list is a change to what is stored, not only to what is shown.
{
  const reg = JSON.parse(read('supabase/functions/_shared/report-rights.json'));
  ok(Array.isArray(reg.cleared) && reg.cleared.length > 0 && reg.cleared.every((e) => /^docs\/[A-Za-z0-9._\-\/]+\.md §\d+$/.test(e.audit_ref) && existsSync(join(root, e.audit_ref.replace(/ §\d+$/, '')))),
    '6a every cleared source names the recorded decision it rests on (a real file and section), so the list is never a default', reg.cleared.length);
  ok(/corporate-output-source-rights-audit-2026-09-27\.md/.test(reg.authority) && /Founder ruling R7/.test(reg.rule) && /NOT a publisher grant/.test(reg.rule) && /HOLD finding stays a HOLD finding/.test(reg.rule),
    '6b the registry names its authority and says plainly that the listing is a founder decision, not a publisher grant, and that no HOLD finding is rewritten');
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

// ---- 9. ONE owner for the report's outcome and ONE for the credit decision (founder ruling R5, 2026-10-02) --------------------------
{
  const CR = 'supabase/functions/_shared/credit-rule.ts';
  const cr = read(CR), crc = code(cr);
  ok(!/\bDeno\b|process\.env|\brequire\(|\bfetch\(/.test(crc), '9a the credit rule is pure: no environment, no runtime global, no network');
  ok(/^import \{ ACTIVITY_OUTCOMES, ACTIVITY_RULE_VERSION \} from '\.\/national-report\.ts';$/m.test(cr) && (crc.match(/^import /gm) || []).length === 1,
    '9b it imports only the outcome vocabulary and its version from the engine (it judges the engine\'s answer, it does not re-derive it)');
  ok(/const CHARGED: ReadonlySet<string> = new Set\(\['DEVELOPMENT_SHOWN', 'NO_DEVELOPMENT_ACTIVITY'\]\);/.test(crc) && !/NO_DATA_INGESTED/.test(crc.replace(/export const CREDIT_REASONS[\s\S]*?\] as const;/, '')),
    '9c the charged outcomes are exactly the two that answer the question about the area; "No data ingested" is never in the charged set');
  const fnFiles = [];
  const walk = (d) => { for (const e of readdirSync(join(root, d))) { const q = d + '/' + e; if (statSync(join(root, q)).isDirectory()) walk(q); else if (/\.(ts|js|mjs|html)$/.test(e)) fnFiles.push(q); } };
  walk('supabase/functions'); walk('lib');
  for (const e of readdirSync(root)) if (/\.html$/.test(e)) fnFiles.push(e);
  const defines = (re) => fnFiles.filter((f) => re.test(code(read(f))));
  ok(defines(/function creditDecision\(/).join() === CR, '9d creditDecision is defined in one file across every function, lib module and page', defines(/function creditDecision\(/));
  ok(defines(/function activityOutcome\(/).join() === MOD, '9e activityOutcome is defined in one file', defines(/function activityOutcome\(/));
  ok(defines(/uses_report\s*:/).join() === CR, '9f nothing but the credit rule writes a uses_report answer', defines(/uses_report\s*:/));
  const mod = code(src.module);
  ok((mod.match(/activityOutcome\(/g) || []).length === 2 && /const outcome = activityOutcome\(projects\.length\);/.test(mod),
    '9g the engine asks activityOutcome once, with the number of projects in THIS report (after the rights gate), never the spatial answer');
  const fnBody = /export function activityOutcome\([\s\S]*?\n\}/.exec(mod);
  ok(!!fnBody && !/NO_DEVELOPMENT_ACTIVITY/.test(fnBody[0]), '9h today\'s outcome rule cannot return "No development activity": that needs the VERIFIED ZERO proof, which has no inputs yet');
  ok(/const credit = creditDecision\(\{ status: 'OK', view, activity: out\.intelligence\?\.activity, storable \}\);/.test(code(src.handler))
    && (code(src.handler).match(/creditDecision\(/g) || []).length === 3, '9i the handler asks the rule for every report and every no-report answer, and decides nothing itself');
  ok(!/evaluation_report_issue|evaluation_usage|report_credit/.test(code(src.handler)) && !/evaluation_report_issue|evaluation_credit/.test(code(src.data))
    && /if \(!trial \|\| !credit\.uses_report\)/.test(code(src.handler)),
    '9j the handler names no ledger; the data layer charges only through the snapshot module; and an admin, or a report the rule does not charge, never reaches it');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
