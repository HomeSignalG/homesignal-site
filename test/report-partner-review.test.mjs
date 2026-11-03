// THE PARTNER-SAMPLE REVIEW OF 2026-11-03 (founder, on the site-generated PDF for 3101 Western Ave, Seattle). Each check is one item of that review, run on
// the real records near that address (test/fixtures/report-quality/seattle-3101-western-2026-11-02.json) with the agencies' own descriptions where the item
// is about them. Run: node test/report-partner-review.test.mjs
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
const ok = (c, name, detail) => { total++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 900)); } };
const read = (f) => readFileSync(join(root, f), 'utf8');
const fx = JSON.parse(read('test/fixtures/report-quality/seattle-3101-western-2026-11-02.json'));
const attribution = JSON.parse(read('supabase/functions/_shared/source-attribution.json'));
// the agencies' own descriptions, as data.seattle.gov and data.wa.gov published them (read 2026-11-03)
const DESC = {
  '7118487-CN': 'Establish use as permanent supportive housing for 83 stacked dwelling units and human services facilities per land use code. Construct new mixed-use building occupy per plan.',
  '7086944-DM': 'Demolish commercial warehouse building per plan.',
  '7124514-CN': 'Construct repairs to exterior of existing multifamily building (floors 2-12 55 balconies and 24 decks) per plan.',
  '3044180-LU': 'Shoreline Substantial Development application to allow installation of electrical vehicle chargers and associated infrastructure for Port of Seattle Waterfront Fleet assets (Pier 69).',
  '202505363': 'Land Use Application to allow change of use from apartments to lodging (floors 1-4). No change to parking. Submitted to Ecology after the fact on 5/14/26.',
  '202602030': 'Land Use application to allow change of use from apartments to lodging (floors 5-6). Parking for 212 vehicles proposed.',
  '202602036': 'Land Use Application to allow change of use from apartments to lodging (floors 1-4). No change to parking.',
};
const projects = fx.projects.map((p) => { const id = p.source_key.split(':').pop(); return DESC[id] ? { ...p, scope_text: DESC[id] } : p; });
const SUBJECT = { address: '3101 Western Ave, Seattle,', matched_address: null, lat: fx._meta.subject_point[0], lng: fx._meta.subject_point[1], zip: '98121' };
const a = M.assemble({ now: new Date('2026-11-03T16:00:00Z'), subject: SUBJECT, radius_mi: 0.5, view: 'customer', zip_supported: true, attribution, rows: fx.rows, projects, ledger: fx.ledger, events: fx.events, health: fx.health });
const rep = a.intelligence, resp = { status: 'OK', coverage_state: a.coverage_state, report: rep, render: a.renderOnly };
const html = V.html(resp, { subject: SUBJECT.address });
const plain = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ');
const P = (id) => rep.projects.find((p) => p.project_id.endsWith(id) || (p.source_key ?? '').endsWith(id));

// ---- 1. impact notes are the record's own scope only --------------------------------------------------------------------------------------------
{
  const q = (id) => V.qolImpact(P(id)).text;
  ok(!/customer traffic/i.test(q('7086944-DM')) && /demolition/i.test(q('7086944-DM')), '1a demolition: no "customer traffic"', q('7086944-DM'));
  ok(!/air emissions|truck traffic/i.test(q('3044180-LU')), '1b EV chargers: no air-emissions or truck-traffic warning', q('3044180-LU'));
  ok(!/neighborhood activity/i.test(q('7124514-CN')), '1c balcony repairs: no "added neighborhood activity"', q('7124514-CN'));
  const done = rep.projects.find((p) => p.lifecycle && p.lifecycle.key === 'operating' && !(p.stage && p.stage.key));
  ok(done && /completed or closed/.test(V.qolImpact(done).text) && !/once work starts|while the work is under way/.test(V.qolImpact(done).text), '1d a completed record gets no construction warning', done && V.qolImpact(done));
}
// ---- 2/4. the 83-unit building, one line per address, and the selection note ------------------------------------------------------------------
{
  const h = P('7118487-CN');
  ok(h && h.relevance.basis === 'new_construction' && h.relevance.scale && h.relevance.scale.units === 83, '4a "Establish use ... Construct new mixed-use building" is new construction with 83 units', h && h.relevance);
  const ov = [...((html.match(/data-da-overview>([\s\S]*?)<\/ol>/) || ['', ''])[1]).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => plain(m[1]));
  ok(/254-unit/.test(ov[0]) && /83 stacked dwelling units/.test(ov[1]) && /^New construction/.test(ov[1].trim()), '4b page 1: the 254-unit building, then the 83-unit building, as new construction', ov);
  const addrs = ov.map((l) => (/\(([^,]+),/.exec(l) || [])[1]);
  ok(new Set(addrs).size === addrs.length, '4c page 1 lists each street address once', addrs);
  ok(/How this list is chosen/.test(html) && !/Listed by what each record documents: new buildings first/.test(html), '4d the note states the selection method actually used');
}
// ---- 2. temporary activity keeps its agency stage; its dates are separate ----------------------------------------------------------------------
{
  const base = fx.projects.find((p) => /7163589-CN/.test(p.source_key)), row = fx.rows.find((r) => /7163589-CN/.test(r.source_key));
  const key = base.source_key.replace('7163589', '7163182');
  const market = { ...base, source_key: key, name: 'Erect (6) temporary structures for 2026 Christmas Market at Seattle Center from 11/20', stage: 'Reviews In Process',
    scope_text: 'Erect (6) temporary structures for 2026 Christmas Market at Seattle Center from 11/20 - 12/27/2026 per plan. All components provided and assembled by professional crew.' };
  const b = M.assemble({ now: new Date('2026-11-03T16:00:00Z'), subject: SUBJECT, radius_mi: 0.5, view: 'customer', zip_supported: true, attribution,
    rows: fx.rows.concat([{ ...row, source_key: key }]), projects: projects.concat([market]), ledger: fx.ledger, events: fx.events, health: fx.health });
  const m = b.intelligence.projects.find((p) => /Christmas/.test(p.name ?? ''));
  ok(m && m.stage && m.stage.key === 'proposed' && m.relevance.basis === 'temporary_event', '2a the market keeps its agency stage (Proposed / Under review) as temporary activity', m && { stage: m.stage, rel: m.relevance });
  // the market on a page of its own (in the full report it is the seventh kind of change, below the six-line limit)
  const only = { ...b.intelligence, projects: b.intelligence.projects.filter((p) => p === m) };
  const bh = plain(V.html({ status: 'OK', coverage_state: b.coverage_state, report: only, render: b.renderOnly }, { subject: SUBJECT.address }));
  const full = plain(V.html({ status: 'OK', coverage_state: b.coverage_state, report: b.intelligence, render: b.renderOnly }, { subject: SUBJECT.address }));
  const line = (/Temporary installation or event\s*:\s*Erect \(6\) temporary structures[^]*?installation or activity takes place\./.exec(bh) || [''])[0];
  ok(/Documented activity window: Nov 20, 2026 to Dec 27, 2026\./.test(line) && /Agency status: Reviews In Process\./.test(line) && !/whether or when work will happen/.test(line),
    '2b the overview gives the documented window and the agency status, and says only that the installation is not confirmed', line);
  ok(!/and a temporary event, is shown as Stage not stated/.test(full) && /keeps its agency stage/.test(full), '2c the coverage note no longer says a temporary event has no stage');
}
// ---- 3. lifecycle words match on every surface ------------------------------------------------------------------------------------------------
{
  const t = plain(html);
  ok(!/Jody status: /.test(t) && !/→ Operating\b/.test(t) && !/Approved → /.test(t), '3a Change History prints no internal "Jody status: Approved → Operating"', (t.match(/Jody stage: [^.]{0,80}/g) || []).slice(0, 4));
  const legend = (html.match(/<ul class="da-rv-legend">[\s\S]*?<\/ul>/) || [''])[0];
  ok(!/Permit issued \/ Under construction/.test(legend) && /Permit issued/.test(legend), '3b the map legend names an issued permit on its own', plain(legend));
  ok(!/>Permit issued \/ Under construction</.test(html), '3c no Stage control combines an issued permit and work under way');
}
// ---- 5. stage controls reconcile; print shows no controls --------------------------------------------------------------------------------------
{
  const sec = (html.match(/da-rv-sec--filters[\s\S]*?<\/section>/) || [''])[0];
  const cnt = [...sec.matchAll(/data-da-filter="stage" data-da-value="([^"]+)"[^>]*>[^<]*<span class="da-rv-chipn">(\d+)</g)].map((m) => [m[1], +m[2]]);
  const all = (cnt.find((c) => c[0] === 'all') || [0, -1])[1], parts = cnt.filter((c) => c[0] !== 'all').map((c) => c[1]);
  ok(/Stage not stated/.test(sec) && parts.length && parts.reduce((x, y) => x + y, 0) === all, '5a the Stage controls include Stage not stated and add up to All', { all, cnt });
  ok(/\.da-rv-sec--filters \.da-rv-frow[^}]*display:none/.test(V.CSS), '5b the printed report shows no filter chips');
}
// ---- 6. print and header cleanup --------------------------------------------------------------------------------------------------------------
{
  ok(/<p class="da-rv-addr">3101 Western Ave, Seattle<\/p>/.test(html), '6a the subject address carries no trailing comma', (html.match(/<p class="da-rv-addr">[^<]*/) || [''])[0]);
  const fresh = (plain(html).match(/Jody last read the official records in this report ([^;]*);/) || [])[1] || '';
  const D = '[A-Z][a-z]{2} \\d{1,2}, \\d{4}', one = new RegExp('^on ' + D + '$'), range = new RegExp('^between (' + D + ') and (' + D + ')$');
  const rm = fresh.match(range);
  ok(one.test(fresh) || (rm && rm[1] !== rm[2]), '6b the freshness sentence names one date, or a full range', fresh);
  // the same report with every record read on one day: one date, never "between" a single day
  const sameDay = JSON.parse(JSON.stringify(resp));
  sameDay.report.coverage.records_checked = { ...sameDay.report.coverage.records_checked, earliest: '2026-11-01T09:00:00Z', latest: '2026-11-01T18:00:00Z' };
  const f1 = (plain(V.html(sameDay, { subject: SUBJECT.address })).match(/Jody last read the official records in this report ([^;]*);/) || [])[1] || '';
  ok(one.test(f1) && !/between/.test(f1), '6b2 records all read on one day give that one date', f1);
  ok(/@top-left\{content:"JODY Development Activity report"/.test(V.CSS), '6c the page defines its own header, so the browser prints no URL or title there');
}
// ---- 7. readable titles from the full description ---------------------------------------------------------------------------------------------
{
  const t = plain(html);
  ok(/electrical vehicle chargers/.test(t) && !/allow installation of…/.test(t), '7a the EV-charger title keeps its subject', (t.match(/Shoreline Substantial[^.]{0,140}/) || [''])[0]);
  const names = [...html.matchAll(/<span class="da-rv-name">([^<]*)</g)].map((m) => m[1]);
  const lodging = names.filter((n) => /lodging/i.test(n));
  ok(lodging.length === 3 && lodging.some((n) => /floors 5-6/.test(n)) && !names.some((n) => /^315 1st ave n$/i.test(n.trim())),
    '7b the lodging records are titled by what they propose, not by their address', names.filter((n) => /lodging|315 1/i.test(n)));
  ok(names.some((n) => /electrical vehicle chargers/.test(n)), '7c the EV-charger row is titled by its subject', names.filter((n) => /Shoreline|charger/i.test(n)));
}
console.log(`\n${total - fails} passed, ${fails} failed of ${total}`);
process.exit(fails ? 1 : 0);
