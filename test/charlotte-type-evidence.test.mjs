// Charlotte Land Dev "Commercial Projects": the publisher's ProjectType / Category describe the
// APPLICATION WORKFLOW, not the project's land use, so they must never decide a project Type.
//
// Founder decision (2026-10-10): Type describes the actual project or action, not the government
// process used to review it. Evidence hierarchy: (1) an explicit use/activity field, (2) an
// official project description, (3) a high-confidence TITLE under the existing nationally tested
// rules, (4) workflow labels are NOT evidence, (5) otherwise the existing honest "Other project"
// with "Impact not determined from available records."
//
// Before: `use_type_const: "Commercial"` stamped every one of 4,387 projects Commercial because
// the LAYER is scoped to "commercial land development". A greenway pre-submittal meeting therefore
// read "Potential construction and customer traffic, parking and noise".
// After: ProjectType is read (type_source) and every live value maps to the GENERIC bucket, so
// the existing classifier decides from the title and otherwise falls back to Other project.
//
// This drives the SHIPPED connector (sources/arcgis.ts) and the SHIPPED classifier + impact
// authority (lib/project-type.js, lib/da-report-view.js); nothing here re-implements a rule.
// Rows are the publisher's own, captured from the live layer on 2026-10-10.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const { arcgisForZip } = await import(join(root, 'supabase/functions/get-address-report/sources/arcgis.ts'));
const sb = { window: {} };
runInNewContext(readFileSync(join(root, 'lib/project-type.js'), 'utf8'), sb);
runInNewContext(readFileSync(join(root, 'lib/da-report-view.js'), 'utf8'), sb);
const HS = sb.window.HS, V = HS.daReportView;

const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const entry = reg.arcgis.find((e) => e.registry_id === 'charlotte-land-dev-commercial-projects');
const GENERIC = ['Development', 'unclassified'];

console.log('1) the registry entry');
{
  ok(entry && !entry.use_type_const, 'no source-wide Type constant: the layer name is not evidence of any project\'s use');
  ok(entry.column_map.type_source === 'ProjectType', 'ProjectType is read per record');
  ok(!Object.values(entry.column_map).includes('Category'), 'Category (a status-like field) is never mapped');
  const vals = Object.values(entry.type_map || {});
  ok(vals.length === 54 && vals.every((v) => GENERIC.includes(v)),
    'all 54 live ProjectType values map to the GENERIC bucket, none to a use', `n=${vals.length}`);
  // Fingerprint of the key set against the layer read of 2026-10-10 (54 distinct non-null values,
  // md5 over the "C"-collated sort). A change here means the publisher's vocabulary was re-read.
  const fp = createHash('md5').update(Object.keys(entry.type_map).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('\n')).digest('hex');
  ok(fp === '59d5aa37499ba7c01f5092862024717d', 'type_map keys equal the publisher\'s ProjectType set', fp);
  ok(!entry.commercial_work_evidence, 'no commercial work-evidence gate is attached (nothing to downgrade)');
}

console.log('\n2) the shipped connector → classifier → impact, on the publisher\'s own rows');
const poly = [[[-80.9, 35.2], [-80.89, 35.2], [-80.89, 35.21], [-80.9, 35.21], [-80.9, 35.2]]];
const acc = (cap3) => `https://aca-prod.accela.com/CHARLOTTE/Cap/CapDetail.aspx?Module=LandDevelopment&TabName=LandDevelopment&capID1=22LDR&capID2=00000&capID3=${cap3}&agencyCode=CHARLOTTE`;
const row = (id, name, pt, extra = {}) => ({
  attributes: { OBJECTID: id, UID: 'U' + id, ProjectName: name, ProjectType: pt, Category: 'Pre-submittals', Status: 'Scheduled',
    OpenDate: 1642636800000, StatusDate: 1642636800000, Address: '2827 TYVOLA RD', ProjectNumber: 'LDX-2022-' + id,
    ParcelNumber: '17118401', ProjectDetail: acc('0002' + id), ...extra },
  geometry: { rings: poly },
});
const rows = [
  row(1, 'Briar Little Hope Greenway', 'Pre-Submittal Meeting - Non Urban'),                       // verbatim
  row(2, 'McAlpine Creek Greenway', 'Pre-Submittal Meeting - Non Urban', { Address: '0 PINEVILLE-MATTHEWS RD' }), // verbatim
  row(3, 'CLT 15 12MW Data Center', 'Land Development Construction Plan', { Status: 'Approved' }),
  row(4, 'Kairoi Monroe', 'Commercial (Regular 15 business day Review)'),                         // workflow says Commercial, title says nothing
  row(5, '200 Atando Multi-Family', 'Pre-Submittal Meeting - Urban'),
  row(6, 'Berkley Group Tower Telecommunications Tower Site', 'Commercial Expedited (5 business day Review)'),
  row(7, 'Brand New Workflow Project', 'A Workflow Name The Publisher Invents Next Year'),         // unmapped, present
  row(8, 'Blank Workflow Project', null),                                                          // blank
];
const stub = async () => new Response(JSON.stringify({ objectIdFieldName: 'OBJECTID', geometryType: 'esriGeometryPolygon',
  fields: [], features: rows, exceededTransferLimit: false }), { status: 200, headers: { 'content-type': 'application/json' } });
const { sites } = await arcgisForZip('28210', [{ state: 'NC', county: 'Mecklenburg' }], [entry],
  { fetch: stub, zipCentroid: { lat: 35.205, lng: -80.895 } });
const by = {};
for (const s of sites) {
  const t = HS.canonicalProjectType({ type: s.use_type, name: s.title });
  by[s.title] = { stored: s.use_type, key: t.typeKey, qol: V.qolImpact({ type: { key: t.typeKey, label: t.label }, publisher_status: 'Scheduled' }) };
}
ok(sites.length === 8, 'all eight records are emitted — no eligible project is removed', String(sites.length));
const g1 = by['Briar Little Hope Greenway'], g2 = by['McAlpine Creek Greenway'];
ok(g1.key === 'other' && g2.key === 'other', 'both greenway pre-submittal records are Other project, not Commercial', JSON.stringify([g1.key, g2.key]));
ok(g1.qol.kind === 'unknown' && g1.qol.text === 'Impact not determined from available records.' && g2.qol.kind === 'unknown',
  'and carry the honest fallback, not customer-traffic / parking wording', g1.qol.text);
ok(by['Kairoi Monroe'].key === 'other', 'a "Commercial … Review" WORKFLOW label with a title that states nothing is NOT Commercial');
ok(by['CLT 15 12MW Data Center'].key === 'datacenter' && by['CLT 15 12MW Data Center'].qol.kind === 'potential',
  'a title that states a data center is preserved by the existing DATACENTER rule (no ID exception)');
ok(by['200 Atando Multi-Family'].key === 'residential', 'a title that states multi-family is preserved by the existing name rules');
ok(by['Berkley Group Tower Telecommunications Tower Site'].key === 'infrastructure', 'a title that states a tower is preserved by the existing name rules');
ok(by['Brand New Workflow Project'].stored === 'unclassified' && by['Brand New Workflow Project'].key === 'other',
  'FAIL-CLOSED: a new, unmapped ProjectType value is unclassified → Other project, never Commercial');
ok(by['Blank Workflow Project'].stored === 'unclassified' && by['Blank Workflow Project'].key === 'other',
  'FAIL-CLOSED: a blank ProjectType is unclassified → Other project, never Commercial');
ok(sites.every((s) => s.use_type !== 'Commercial'), 'no workflow value stamps Commercial');
const want = Object.fromEntries(rows.map((r) => [r.attributes.ProjectName, r.attributes.ProjectType]));
ok(sites.every((s) => (s.type_raw ?? null) === (want[s.title] ?? null)),
  'the publisher\'s own ProjectType words are kept verbatim as type_raw (provenance), not reinterpreted');
ok(sites.every((s) => s.bucket && s.record_url && Number.isFinite(s.lat) && Number.isFinite(s.lng)),
  'status bucket, record URL and geometry are untouched by the Type change');

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll checks passed.');
process.exit(fails ? 1 : 0);
