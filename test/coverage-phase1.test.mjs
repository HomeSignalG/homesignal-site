// DEVELOPMENT ACTIVITY REPORT — COVERAGE AND CREDIT, PHASE 1 (founder decisions 2026-11-19): the 18 approved cases.
//   U1-U5  the coverage assessment (source class, 72-hour read freshness, fail-closed)        C1-C4  the credit decision
//   R1-R2  the registry is the sole classification authority; the locked radius and window     V1-V4  one disclosure, printed identically; no old brand
//   I1-I3  the request handler: what is shown, what is charged, and the order of the two
// Run: node test/coverage-phase1.test.mjs        No national ZIP or source count is hardcoded here: every figure is read from the file under test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CA = await import('../supabase/functions/_shared/coverage-assess.ts');
const CR = await import('../supabase/functions/_shared/credit-rule.ts');
const M = await import('../supabase/functions/_shared/national-report.ts');
const H = await import('../supabase/functions/get-development-activity-report/handler.ts');
const G = await import('../scripts/gen-source-class.mjs');
import { runInNewContext } from 'node:vm';
const sandbox = { window: {} };
runInNewContext(readFileSync(join(root, 'lib/da-report-view.js'), 'utf8'), sandbox);
const V = sandbox.window.HS.daReportView;

const NOW = new Date('2026-10-04T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();
const LOCAL = 'austin-site-plan-cases';            // registry class: local_permit_planning
const ROAD = 'wsdot-project-delivery-plan-proposed'; // registry class: statewide_transportation
const hr = (registry_id, last_success_at = hoursAgo(1), x = {}) => ({ registry_id, fetch_failures_24h: 0, blocked_24h: 0, truncated_24h: 0, last_success_at, ...x });
const base = (o = {}) => ({ now: NOW, applicable: [], found: [], displayed: [], health: [], truncated: false, notHydrated: 0, judgedCount: 0, agencyOf: () => 'Agency', ...o });
const fam = (a) => a.verified_for_credit;

// ---- U. the coverage assessment ---------------------------------------------------------------------------------------------------------------
ok(CA.sourceClassOf(LOCAL) === 'local_permit_planning' && CA.sourceClassOf(ROAD) === 'statewide_transportation', 'U1 a source\'s class is the registry\'s, nothing else');
ok(CA.sourceClassOf('not-a-registered-source') === null && CA.sourceClassOf(null) === null && CA.sourceClassOf('') === null, 'U2 an unclassified source has no class, so it can never be chargeable');
{
  const a = CA.assessCoverage(base({ displayed: [LOCAL], found: [LOCAL], health: [hr(LOCAL, hoursAgo(73))] }));
  ok(a.verified_for_credit === false && CA.readStateOf(hr(LOCAL, hoursAgo(73)), NOW) === 'STALE_READ', 'U3 a last successful read older than 72 hours is not verified', a.local_permit_read_state);
}
{
  const a = CA.assessCoverage(base({ displayed: [LOCAL], found: [LOCAL], health: [hr(LOCAL, hoursAgo(71))] }));
  ok(a.verified_for_credit === true && a.credit_basis === 'LOCAL_PERMIT_PLANNING_RECORD_SHOWN' && CA.READ_FRESHNESS_HOURS === 72, 'U4 a healthy read inside 72 hours with a local permit record shown is verified', a);
}
{
  const none = CA.assessCoverage(base({ displayed: [LOCAL], found: [LOCAL], health: [] }));
  const noTime = CA.assessCoverage(base({ displayed: [LOCAL], found: [LOCAL], health: [hr(LOCAL, null)] }));
  const bad = CA.assessCoverage(base({ displayed: [LOCAL], found: [LOCAL], health: [hr(LOCAL, hoursAgo(1), { fetch_failures_24h: 1 })] }));
  ok(!none.verified_for_credit && !noTime.verified_for_credit && !bad.verified_for_credit, 'U5 no health row, no read time, or a failed read each fail closed');
}

// ---- C. the credit decision -------------------------------------------------------------------------------------------------------------------
const act = (outcome) => ({ outcome, label: 'x', rule_version: M.ACTIVITY_RULE_VERSION });
const cov = (v) => ({ coverage_disclosure: { rule_version: CA.COVERAGE_RULE_VERSION, verified_for_credit: v, credit_basis: v ? 'LOCAL_PERMIT_PLANNING_RECORD_SHOWN' : null } });
const ask = (coverage, activity = act('DEVELOPMENT_SHOWN')) => CR.creditDecision({ status: 'OK', view: 'customer', activity, coverage, storable: true });
ok(ask(cov(true)).uses_report === true && ask(cov(true)).reason === 'DEVELOPMENT_SHOWN', 'C1 a verified local permit/planning report uses one report');
ok(ask(cov(false)).uses_report === false && ask(cov(false)).reason === 'COVERAGE_NOT_VERIFIED', 'C2 a shown but unverified (e.g. transportation-only) report uses none');
ok(ask(cov(false), act('NO_VERIFIED_COVERAGE')).uses_report === false && ask(cov(true), act('NO_VERIFIED_COVERAGE')).uses_report === false, 'C3 an empty limited-coverage report is never charged, whatever the coverage says');
ok(ask(undefined).uses_report === false && ask({}).uses_report === false && ask({ coverage_disclosure: { rule_version: 'coverage-rule-0', verified_for_credit: true } }).uses_report === false, 'C4 missing, malformed or unrecognised coverage fails closed');

// ---- R. registry authority, locked parameters -------------------------------------------------------------------------------------------------
{
  const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
  const cap = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/capital-program-sources.generated.json'), 'utf8')).families ?? {};
  const r = G.build(reg, cap);
  const gen = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/source-class.generated.json'), 'utf8')).families;
  const listedLocal = Object.keys(cap).filter((k) => gen[k] === 'local_permit_planning');
  ok(r.problems.length === 0 && JSON.stringify(r.file.families) === JSON.stringify(gen) && listedLocal.length === 0, 'R1 every registry source is classified, the bundle equals the registry, and no documented transportation program is a permit source', [r.problems.slice(0, 3), listedLocal]);
  const e = M.assemble({ now: NOW, subject: { address: 'x', matched_address: null, lat: 1, lng: 2, zip: '97477' }, radius_mi: 0.5, view: 'customer', zip_supported: true, attribution: { version: 1, attribution: {} }, rows: [], projects: [], ledger: [], events: [], health: [], applicable_families: [] });
  ok(e.intelligence.radius_mi === 0.5 && e.intelligence.recent_days === 90 && /^development-activity-national-/.test(M.REPORT_VERSION), 'R2 the radius stays 0.5 mile and the display bucket 90 days', [e.intelligence.radius_mi, e.intelligence.recent_days]);
}

// ---- V. one disclosure, printed identically ---------------------------------------------------------------------------------------------------
const world = (family, health) => M.assemble({ now: NOW, subject: { address: '1 A St', matched_address: null, lat: 1, lng: 2, zip: '97477' }, radius_mi: 0.5, view: 'customer', zip_supported: true,
  attribution: { version: 1, attribution: {} }, rows: [{ source_key: 'k1', feature_id: 'f', registry_id: family, provenance: 'proven_stored_point', distance_mi: 0.2, geometry_type: 'Point', has_more: false }],
  projects: [{ source_key: 'k1', registry_id: family, record_kind: 'development', name: 'New 40-unit apartment building', type: 'Residential', type_raw: null, status: 'Approved', stage: null, developer: null, size: null, investment: null, submitted_at: '2026-09-20', date_kind: 'issued', address: '900 Elm Ave', source_ref: 'https://example.gov/r/1' }],
  ledger: [], events: [], health, applicable_families: [family] });
{
  const t = world(ROAD, [hr(ROAD)]);
  const d = t.intelligence.coverage.coverage_disclosure;
  ok(d && typeof d.paragraph === 'string' && d.paragraph.startsWith(CA.COVERAGE_BASE) && d.verified_for_credit === false, 'V1 the engine builds the disclosure once, with the standard base sentence', d && d.paragraph);
  ok(V && V.html && V.html({ status: 'OK', view: 'customer', report: t.intelligence, render: t.renderOnly, coverage_state: t.coverage_state }).includes('monitored by JODY'), 'V2 the report view prints the engine\'s disclosure');
  const w = JSON.parse(JSON.stringify(t.intelligence)); delete w.coverage.coverage_disclosure;
  ok(V.html({ status: 'OK', view: 'customer', report: w, render: t.renderOnly, coverage_state: 'REPORT_READY' }).includes('Additional development activity may exist'), 'V3 a report stored before the disclosure existed still renders, with the fixed statement');
}
{
  const strings = [CA.COVERAGE_BASE, CA.NO_RECORDS_HEADLINE, CA.LOCAL_SOURCE_NOT_VERIFIED, CA.PARTIAL_TRANSPORT_ONLY(['A']), CA.PARTIAL_NO_LOCAL_RECORD(['A']), ...['AREA_INCOMPLETE', 'NO_SOURCE', 'NO_LOCAL_PERMIT_SOURCE', 'SOURCE_UNHEALTHY', 'SOURCE_STALE', 'HEALTH_UNKNOWN', 'FOOTPRINT_NOT_VERIFIED'].map((r) => CA.emptyReasonText(r, ['A']))];
  const src = ['supabase/functions/_shared/coverage-assess.ts', 'supabase/functions/_shared/credit-rule.ts'].map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
  ok(strings.every((s) => !/HomeSignal/i.test(s)) && !/HomeSignal/.test(src), 'V4 no customer text and no new module mentions the old brand');
}

// ---- I. the handler ---------------------------------------------------------------------------------------------------------------------------
function build(family, health) {
  const calls = [];
  const rec = (name, fn) => async (...a) => { calls.push(name); return fn(...a); };
  const proj = { source_key: 'k1', registry_id: family, record_kind: 'development', name: 'New 40-unit apartment building', type: 'Residential', type_raw: null, status: 'Approved', stage: null, developer: null, size: null, investment: null, submitted_at: '2026-09-20', date_kind: 'issued', address: '900 Elm Ave', source_ref: 'https://example.gov/r/1' };
  const base = {
    now: () => NOW, attribution: { version: 1, attribution: { [LOCAL]: 'Data: fixture', [ROAD]: 'Data: fixture' } },
    authenticate: async (t) => (t === 'member' ? { email: 'a@b.test', id: '0f0e4d2c-1b3a-4c5d-8e9f-a1b2c3d4e5f6' } : null), isAdmin: async () => false,
    geocode: async () => ({ matchedAddress: '1 A ST', lat: 1, lng: 2, zip: '97477' }), zipSupported: async () => true,
    radius: async () => [{ source_key: 'k1', feature_id: 'pt:1', registry_id: family, provenance: 'proven_stored_point', distance_mi: 0.2, geometry_type: 'Point', has_more: false }],
    hydrate: async () => [proj], ledger: async () => [], events: async () => [], health: async () => health, jurisdictions: async () => [],
    trialOf: async () => ({ status: 'active', credits_used: 3, credits_remaining: 7, expired: false }),
    planOf: async () => ({ brokerage_id: 'b0b0b0b0-1111-4222-8333-444444444444', role: 'owner', state: 'none', credit_limit: 100, credits_used: 0, credits_remaining: 0, period_ends_at: null }),
    rateClaim: async () => ({ allowed: true }),
    issue: async () => ({ replayed: false, report_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', content_hash: 'h', report_version: M.REPORT_VERSION, generated_at: NOW.toISOString(), private_context_id: 'cccccccc-dddd-4eee-8fff-000000000000', report: { stored: 'body' }, credit: { ordinal: 4, credits_used: 4, credits_remaining: 6, evaluation_status: 'active', allotment: 'trial', period_ends_at: null } }),
    storedReport: async () => '{}', contextMatches: async () => 'match', savedReports: async () => [], openSavedReport: async () => null, subjectOf: async () => ({ address: null, label: null }), headerOf: async () => ({ brokerage: 'F', agent: null }),
  };
  const deps = {}; for (const [k, v] of Object.entries(base)) deps[k] = typeof v === 'function' && k !== 'now' ? rec(k, v) : v;
  return { deps, calls };
}
const go = async (f, health) => {
  const t = build(f, health);
  const res = await H.makeHandler(t.deps)(new Request('https://x/functions/v1/get-development-activity-report', { method: 'POST', headers: { authorization: 'Bearer member', 'content-type': 'application/json' }, body: JSON.stringify({ address: '1 A St, Springfield, OR 97477', idempotency_key: '3b2c1d4e-5f60-4718-8a9b-0c1d2e3f4a5b' }) }));
  return { ...t, status: res.status, json: JSON.parse(await res.text()) };
};
{
  const a = await go(LOCAL, [hr(LOCAL)]);
  ok(a.status === 200 && a.json.charged === true && a.calls.filter((c) => c === 'issue').length === 1 && a.json.stored === true, 'I1 a verified local permit report is shown, charged once and stored', [a.status, a.json.credit]);
  const b = await go(ROAD, [hr(ROAD)]);
  ok(b.status === 200 && b.json.charged === false && !b.calls.includes('issue') && b.json.report.projects.length === 1 && b.json.report.coverage.coverage_disclosure.limitations.some((l) => l.code === 'PARTIAL_COVERAGE_TRANSPORT_ONLY'),
    'I2 a transportation-only report is shown in full and disclosed as partial, never charged, and the issue function is never reached', [b.json.charged, b.json.credit]);
}
{
  const src = readFileSync(join(root, 'supabase/functions/get-development-activity-report/handler.ts'), 'utf8').replace(/\/\/.*$/gm, '');
  const decide = src.indexOf('creditDecision('), issue = src.indexOf('deps.issue(');
  const sites = src.split('deps.issue(').length - 1;
  ok(decide > 0 && issue > decide && sites === 1 && /coverage: out\.intelligence\?\.coverage/.test(src), 'I3 the credit decision (given the coverage) comes before the single call site of the issue function');
}
console.log(`${n - bad} passed, ${bad} failed of ${n}`);
process.exit(bad ? 1 : 0);
