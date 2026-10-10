// A PROPOSED PROJECT THE SERVING GENERATION KNOWS REACHES THE DEVELOPMENT ACTIVITY REPORT (n5_projects_within_radius, revision 4).
//
// THE DEFECT. The report reads which projects are near an address from public.n5_projects_within_radius, and that function read
// geo.n5_geom only: the frozen phase-1 snapshot (2026-09-01) plus recovered publisher geometry. A project filed after that date was
// drawn on Map 1 (which reads the daily serving generation) and was never returned to the report. Real example, read from production
// 2026-10-10: Austin site-plan case SP-2026-0279C, "Lightsey Residences", Proposed / In Review, filed 2026-09-01.
//
// WHAT THIS PROVES, end to end and not with a hand-made object. test/fixtures/n5-generation-points/ holds
//   real_rows.json  12 REAL records exported from production on 2026-10-10 (their app_projects columns, their stored coordinates, and
//                   whether the coordinate sat in geo.n5_geom or only in the serving generation). md5 5f5caaef..., checked below.
//   rpc_rows.json   what the PREVIOUS DDL and the SHIPPED DDL (docs/n5-spatial-read-rpc.sql) returned over those rows in a real PostGIS,
//                   at two CONSTRUCTED subject points ~0.45 and ~0.55 mile from the project. They are not customer properties.
//                   Regenerate: test/n5_spatial_pg/gen_rpc_rows.py (and an identical regeneration is how this file was checked).
// Those rows go through the REAL request handler (handler.ts -> assemble() in _shared/national-report.ts, with the rights file as it
// ships) and the REAL renderer (lib/da-report-view.js). What is NOT exercised here is the database: the PostGIS behaviour of the new
// function is test/n5_spatial_pg/run_suite.py.
// Run: node test/national-report-generation-points.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (f) => readFileSync(join(root, 'test/fixtures/n5-generation-points', f), 'utf8');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

const H = await import('../supabase/functions/get-development-activity-report/handler.ts');
const sandbox = { window: {} };
runInNewContext(readFileSync(join(root, 'lib/da-report-view.js'), 'utf8'), sandbox);
const V = sandbox.window.HS.daReportView;
const RIGHTS = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/report-rights.json'), 'utf8')); // the list as it ships

const realText = fx('real_rows.json');
const real = JSON.parse(realText);
const rpc = JSON.parse(fx('rpc_rows.json'));
const LIGHTSEY = 'socrata:data.austintexas.gov:mavg-96ck:SP-2026-0279C';
const hydrateAll = real.map((r) => ({ source_key: r.source_key, registry_id: r.registry_id, record_kind: r.record_kind, name: r.name, type: r.type,
  type_raw: r.type_raw, status: r.status, stage: r.stage, developer: r.developer, size: r.size, investment: r.investment, submitted_at: r.submitted_at,
  date_kind: r.date_kind, address: r.address, source_ref: r.source_ref }));

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (h) => decode(h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
async function report(rows, lat) {
  const deps = {
    now: () => new Date('2026-10-10T18:00:00Z'), rights: RIGHTS,
    authenticate: async (t) => (t === 't' ? { email: 'founder@example.com' } : null), isAdmin: async () => true,
    geocode: async () => ({ matchedAddress: 'CONSTRUCTED TEST SUBJECT', lat, lng: -97.77712356, zip: '78704' }),
    zipSupported: async () => true,
    radius: async () => rows.map((r) => ({ source_key: r.source_key, feature_id: r.feature_id, registry_id: r.registry_id, provenance: r.provenance,
      distance_mi: r.distance_mi, geometry_type: r.geometry_type, has_more: r.has_more, marker_lat: r.marker_lat, marker_lng: r.marker_lng })),
    hydrate: async (keys) => hydrateAll.filter((p) => keys.includes(p.source_key)),
    ledger: async () => [], events: async () => [], health: async () => [],
  };
  const res = await H.makeHandler(deps)(new Request('https://x.supabase.co/functions/v1/get-development-activity-report', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify({ address: '1 Constructed Test Subject, Austin, TX 78704' }) }));
  const body = JSON.parse(await res.text());
  const rep = body.report ?? body;
  const html = V.html(body, { subject: 'Constructed test subject' });
  const rowOf = (name) => { const i = html.indexOf(name + '</'); if (i < 0) return null; const a = html.lastIndexOf('<tr', i); return text(html.slice(a, html.indexOf('</tr>', i))); };
  return { status: res.status, rep, html, rowOf, headline: text(html).match(/\d+ official records? within .*? Types:/)?.[0] ?? null };
}

// ---- 0. the fixture is the production export, byte for byte ----
ok(createHash('md5').update(realText).digest('hex') === '5f5caaefe17615309c0455e4b81b9c27', '0a real_rows.json is the production export (md5 of the exported jsonb text)');
ok(real.length === 12 && real.filter((r) => r.src === 'generation').length === 7 && real.filter((r) => r.src === 'n5_geom').length === 5,
  '0b 12 real records: 7 known only to the serving generation, 5 already in geo.n5_geom');

// ---- 1. the defect, on the previous function ----
const keys = (rows) => rows.map((r) => r.source_key);
ok(!keys(rpc.old_045).includes(LIGHTSEY), '1a BEFORE: the previous function does not return Lightsey Residences at ~0.45 mi');
const before = await report(rpc.old_045, rpc.subject_045);
ok(before.status === 200 && before.rep.projects.every((p) => p.project_id !== LIGHTSEY), '1b BEFORE: it is not in the report either');
ok(before.headline && /4 official records/.test(before.headline) && /2 proposed \/ under review/.test(before.headline), '1c BEFORE: the briefing counts 2 proposed / under review', before.headline);

// ---- 2. the fix, on the shipped function's output ----
ok(keys(rpc.new_045).includes(LIGHTSEY), '2a AFTER: the shipped function returns Lightsey Residences at ~0.45 mi');
const lr = rpc.new_045.find((r) => r.source_key === LIGHTSEY);
ok(lr && lr.provenance === 'proven_stored_point' && lr.feature_id === 'pt:1' && Math.abs(lr.distance_mi - 0.45) < 0.01, '2b labelled for what it is (a stored point) at the true distance (0.45 mi +/- 0.01)', lr);
ok(keys(rpc.old_045).every((k) => keys(rpc.new_045).includes(k)), '2c ADDITIVE: every row the previous function returned is still returned');
const after = await report(rpc.new_045, rpc.subject_045);
const p = after.rep.projects.find((x) => x.project_id === LIGHTSEY);
ok(p && p.lifecycle.key === 'proposed' && p.stage && p.stage.key === 'proposed' && p.stage.label === 'Proposed / Under Review', '2d the report places it in Proposed / Under Review (the existing Stage authority, no new vocabulary)', p && p.stage);
ok(p && p.type.key === 'residential' && p.publisher_stage === 'In Review' && p.source.url === real.find((r) => r.source_key === LIGHTSEY).source_ref, '2e verified Type, the publisher\'s own stage, and the official record link are carried');
const row = after.rowOf('Lightsey Residences');
ok(row && /Residential/.test(row) && /Stage: Proposed \/ Under Review/.test(row) && /Agency stage: In Review/.test(row) && /Official source/.test(row), '2f the rendered row shows project, Type, Stage and source', row);
ok(row && /Quality-of-Life Impact: Potential construction noise and traffic/.test(row) && /Not site-verified; no effect is established\./.test(row), '2g the Quality-of-Life wording is the existing evidence-aware text and claims no established effect', row);

// ---- 3. the half-mile edge ----
ok(!keys(rpc.new_055).includes(LIGHTSEY), '3a ~0.55 mi: excluded');
const far = await report(rpc.new_055, rpc.subject_055);
ok(far.rep.projects.every((x) => x.project_id !== LIGHTSEY), '3b ...and absent from the report');

// ---- 4. lifecycle: denied / withdrawn are history, not active proposals ----
const decided = after.rep.projects.filter((x) => String(x.publisher_status).toLowerCase() === 'decided');
ok(decided.length === 4, '4a the four real denied / withdrawn records the generation holds are now returned', decided.map((x) => x.name));
ok(/5 proposed \/ under review/.test(after.headline) && /4 decided \(denied or withdrawn\)/.test(after.headline), '4b the briefing counts 5 open proposals and, separately, 4 decided', after.headline);
const den = after.rowOf('SWAFFORD');
ok(den && /Stage: Decided \(denied or withdrawn\)/.test(den) && /Agency stage: Denied/.test(den) && /no development effect is considered unless it is refiled/.test(den), '4c a denied record keeps its decision notation and is not presented as active', den);

// ---- 5. unresolved Type is not invented ----
const unres = after.rowOf('South Lamar Blvd Street and Utility Improvements Plan');
ok(unres && /Other project/.test(unres) && /Stage: Proposed \/ Under Review/.test(unres), '5 an unclassified Type shows the existing Other project fallback and the project is still reported', unres);

console.log('\n' + (bad ? bad + ' of ' + n + ' FAILED' : 'All ' + n + ' checks passed'));
process.exit(bad ? 1 : 0);
