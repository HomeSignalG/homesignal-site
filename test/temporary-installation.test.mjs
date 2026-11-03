// A TEMPORARY STRUCTURE IS TEMPORARY ACTIVITY, NEVER A NEW BUILDING (relevance-3, 2026-11-03). Found on the site-generated report for 3101 Western Ave,
// Seattle: "Erect (6) temporary structures for 2026 Christmas Market" was read as new construction ("erect"), ranked among new buildings on page 1 and
// pushed the 83-unit supportive housing off it. Wordings below are real records from a national sample of app_projects (2026-11-03).
// Run: node test/temporary-installation.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import('../supabase/functions/_shared/national-report.ts');
globalThis.window = globalThis;
await import('../lib/project-type.js');
await import('../lib/da-report-view.js');
const V = globalThis.HS.daReportView;
let fails = 0, total = 0;
const ok = (c, name, detail) => { total++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 700)); } };
const R = (name, scope_text = null, type_raw = 'Commercial') => M.relevance({ name, scope_text, type_raw }, 'commercial');

// ---- 1. the rule ------------------------------------------------------------------------------------------------------------------------------------
const xmas = R('Erect (6) temporary structures for 2026 Christmas Market at Seattle Center from 11/20', 'Erect (6) temporary structures for 2026 Christmas Market at Seattle Center from 11/20 - 12/27/2026 per plan. All components provided and assembled by professional crew.');
ok(xmas.include && xmas.basis === 'temporary_event' && !('scale' in xmas && xmas.scale?.units), '1a Seattle: "Erect (6) temporary structures for ... Christmas Market" is temporary activity, not new construction', xmas);
ok(['install a temporary booth, dc comics booth #4365, within an existing exhibition', 'installation of a temporary/seasonal air inflated structure. no change of use',
  'install of temporary platform and led wall, no alteration to existing structures', 'temporary structure from may 1st 2026 - oct 27th 2026 (180 days)',
  'installation of temporary exhibit and pennants pursuant to zr 22-232 as per plans'].every((t) => R(t).basis === 'temporary_event'),
  '1b booths, an inflated structure, a platform, a dated temporary structure and an exhibit are temporary activity (NYC, Chicago wordings)');
const keep = { 'Construct a residential high rise building occupy per plan': 'new_construction', 'Shoring and excavation for future construction of a residential high rise building per plan.': 'site_work',
  'structural temporary shoring of existing deteriorated vault structure': null, 'permit - new construction ***hoist permit*** installation of temporary single 8000lbs construction hoist': 'new_construction',
  'commercial building sp - wake county office building - e trades - temporary power, connecting building 2000a service': null };
const got = Object.fromEntries(Object.keys(keep).map((t) => { const r = R(t); return [t, r.include ? r.basis : null]; }));
ok(Object.keys(keep).every((t) => keep[t] === null ? got[t] !== 'temporary_event' : got[t] === keep[t]),
  '1c construction support ("temporary shoring", "temporary power", "temporary hoist") and real buildings are not read as temporary activity', got);
ok(M.RELEVANCE_RULE_VERSION === 'relevance-3', '1d the rule version moved to relevance-3');

// ---- 2. the Seattle report: the market is judged on its dates and leaves the new-building lead ---------------------------------------------------
{
  const fx = JSON.parse(readFileSync(join(root, 'test/fixtures/report-quality/seattle-3101-western-2026-11-02.json'), 'utf8'));
  const attribution = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/source-attribution.json'), 'utf8'));
  const base = fx.projects.find((p) => /7118487-CN/.test(p.source_key));
  const market = { ...JSON.parse(JSON.stringify(fx.projects.find((p) => /7163589-CN/.test(p.source_key)) ?? base)), source_key: 'socrata:data.seattle.gov:76t5-zqzr:7163182-CN',
    name: 'Erect (6) temporary structures for 2026 Christmas Market at Seattle Center from 11/20', scope_text: 'Erect (6) temporary structures for 2026 Christmas Market at Seattle Center from 11/20 - 12/27/2026 per plan.' };
  const housing = { ...JSON.parse(JSON.stringify(base)), scope_text: 'Establish use as permanent supportive housing for 83 stacked dwelling units and human services facilities per land use code. Construct new mixed-use building occupy per plan.' };
  const projects = fx.projects.map((p) => (p === base ? housing : p)).concat([market]);
  const rowOf = fx.rows.find((r) => r.source_key === market.source_key.replace('7163182', '7163589')) ?? null;
  const rows = rowOf ? fx.rows.concat([{ ...rowOf, source_key: market.source_key }]) : fx.rows;
  const SUBJECT = { address: '3101 Western Ave, Seattle, WA 98121', matched_address: null, lat: fx._meta.subject_point[0], lng: fx._meta.subject_point[1], zip: '98121' };
  const a = M.assemble({ now: new Date('2026-11-03T16:00:00Z'), subject: SUBJECT, radius_mi: 0.5, view: 'customer', zip_supported: true, attribution, rows, projects, ledger: fx.ledger, events: fx.events, health: fx.health });
  const m = a.intelligence.projects.find((p) => p.source_key === market.source_key || p.project_id === market.source_key || /Christmas Market/.test(p.name ?? ''));
  ok(!!rowOf && !!(m && m.relevance.basis === 'temporary_event' && m.activity_window), '2a the market is in the report as temporary activity with its documented window (Nov 20 to Dec 27)', m && { r: m.relevance, w: m.activity_window });
  const html = V.html({ status: 'OK', coverage_state: a.coverage_state, report: a.intelligence, render: a.renderOnly }, { subject: SUBJECT.address });
  const lines = [...((html.match(/data-da-overview>([\s\S]*?)<\/ol>/) || ['', ''])[1]).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => x[1].replace(/<[^>]+>/g, ''));
  ok(!lines.some((l) => /^New construction:.*Christmas/.test(l)) && lines.some((l) => /83 stacked dwelling units/.test(l)),
    '2b page 1 never calls the market new construction, and the 83-unit supportive housing is back on it', lines);
}
console.log(`\n${total - fails} passed, ${fails} failed of ${total}`);
process.exit(fails ? 1 : 0);
