// THE DEVELOPMENT ACTIVITY REPORT VIEW — behaviour (Development Activity plan, Order I; the full layout is step 3 of
// docs/development-activity-build-steps-100526.md).
//
// lib/da-report-view.js turns the national engine's response into the customer report. This file proves the VIEW against the engine's
// TRUE output: every response below is produced by the real request handler (supabase/functions/get-development-activity-report/
// handler.ts, driven by test/lib/da-report-view-world.mjs), which runs the real assemble() (_shared/national-report.ts) over rows shaped
// like production's. Nothing about the response shape is hand-made. The view is then loaded the way a page would load it (a script
// that attaches to window.HS).
//
// What is proven: the 100526 section order (ruling 3); the hero is a change claim only where the ledger proved one, and a measured zero
// over the report's own records otherwise; every card carries its stage or lifecycle as text plus a shape; Type and Stage filters,
// Things to Review, the map and the action bar show what the engine supplied and nothing else; nothing internal reaches the page; a
// zero-record report never claims there was no activity; escaping, link safety, and the address appearing as text only.
// Run: node test/da-report-view.test.mjs
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

// ---- the view, loaded as a page loads it ------------------------------------------------------------------------------------------
const sandbox = { window: {} };
runInNewContext(readFileSync(join(root, 'lib/da-report-view.js'), 'utf8'), sandbox);
const V = sandbox.window.HS.daReportView;

// ---- the engine: every response comes from its real handler (test/lib/da-report-view-world.mjs), and assemble() is called directly once, to compare
const M = await import('../supabase/functions/_shared/national-report.ts');
import { NOW, FAM_A, FAM_B, RIGHTS_NONE, RIGHTS_AB, ADDRESS, row, proj, RICH, COLD, wire, clone } from './lib/da-report-view-world.mjs';
/** The view of a response. A throw is returned as a marker so the check that looked at it fails BY NAME instead of the whole suite crashing. */
let threw = 0;
const view = (r, subject = ADDRESS) => { try { return V.html(r, { subject }); } catch (e) { threw++; return '[[the view threw: ' + String((e && e.message) || e) + ']]'; } };

// ---- reading the output (it is HTML we generate: simple, non-nesting sections) ------------------------------------------------------------
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const textOf = (h) => decode(h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const sections = (h) => [...h.matchAll(/<section class="da-rv-sec da-rv-sec--(\w+)([^"]*)" aria-label="([^"]*)">([\s\S]*?)<\/section>/g)].map((m) => ({ key: m[1], cls: m[2], label: decode(m[3]), html: m[4] }));
const keysOf = (h) => sections(h).map((s) => s.key).join(',');
const cardsOf = (h) => [...h.matchAll(/<article class="da-rv-card"[^>]*>([\s\S]*?)<\/article>/g)].map((m) => m[1]);
const cardTitle = (c) => decode((/<h3 class="da-rv-title">([\s\S]*?)<\/h3>/.exec(c) || [, ''])[1]);
const sec = (h, key) => sections(h).find((s) => s.key === key);
const attrs = (h) => [...h.matchAll(/\s([a-zA-Z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]);
const metricsOf = (s) => [...s.html.matchAll(/<div class="da-rv-metric"><b>(\d+)<\/b><span>([^<]*)<\/span><\/div>/g)].map((m) => decode(m[2]) + '=' + m[1]);
const stripShapes = (h) => h.replace(/<svg class="da-rv-shape"[\s\S]*?<\/svg>/g, '');

const W = await wire(RICH);
const WCOLD = await wire(COLD);
const WNONE = await wire(RICH, { rights: RIGHTS_NONE });
const WINT = await wire(RICH, { view: 'internal', rights: RIGHTS_NONE });
const html = view(W), htmlCold = view(WCOLD), htmlNone = view(WNONE), htmlInt = view(WINT);
// The internal review page asks for the lifecycle line (opts.showLifecycle); customer renderers do not. These are the pins on what the line says WHEN it is shown.
const viewLife = (r) => V.html(r, { subject: ADDRESS, showLifecycle: true });
const htmlLife = viewLife(W);

// ---- 0. the fixtures ARE the engine's output --------------------------------------------------------------------------------------------
try {
  ok(W.status === 'OK' && W.report.product === 'HOMESIGNAL DEVELOPMENT ACTIVITY' && Array.isArray(W.report.projects), '0a the response is the real handler\'s: status OK, the engine\'s product name, a projects array');
  const direct = M.assemble({ now: NOW, view: 'customer', zip_supported: true, radius_mi: 0.5, rights: RIGHTS_AB,
    subject: { address: ADDRESS, matched_address: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.04612, lng: -122.98123, zip: '97477' },
    rows: RICH.rows, projects: RICH.projects, ledger: RICH.ledger, events: RICH.events, health: [] });
  ok(JSON.stringify(W.report) === JSON.stringify(direct.intelligence), '0b the wire report equals assemble() called directly on the same inputs, byte for byte');
  const asObject = { status: 'OK', coverage_state: direct.coverage_state, report: direct.intelligence, render: direct.renderOnly, stored: false, report_id: null, storable: false, storage_blockers: [] };
  ok(view(asObject) === html, '0c the view of the wire response equals the view of assemble()\'s own object');
  ok(W.report.sections.what_changed_recently.join() === 'k-approved,k-first', '0d engine: two records carry a detected change, newest first', W.report.sections.what_changed_recently);
  ok(W.report.sections.recent_official_activity.join() === 'k-op,k-decided,k-unk,k-proposed', '0e engine: four more carry a recent publisher event, newest first', W.report.sections.recent_official_activity);
  ok(W.report.sections.by_lifecycle.approved.join() === 'k-approved,k-old-appr' && W.report.sections.by_lifecycle.proposed.join() === 'k-decided,k-first,k-proposed,k-sched'
    && W.report.sections.by_lifecycle.operating.join() === 'k-op' && W.report.sections.by_lifecycle.unknown.join() === 'k-unk',
    '0f engine: the four lifecycle buckets (Decided is proposed; an operating record with no event is absent)', W.report.sections.by_lifecycle);
  ok(WNONE.report.projects.length === 0 && WNONE.coverage_state === 'LIMITED_COVERAGE', '0g the SHIPPED rights file (nothing cleared) gives an empty customer report: LIMITED_COVERAGE, zero records');
  ok([html, htmlCold, htmlNone, htmlInt].every((h) => h.startsWith('<article class="da-rv')), '0i the view renders every one of these responses without throwing', [html, htmlCold, htmlNone, htmlInt].map((h) => h.slice(0, 40)));
  ok(WINT.report.projects.length === 8 && WINT.report.projects.every((p) => p.rights === 'HOLD') && WINT.storage_blockers.includes('INTERNAL_VIEW'),
    '0h the internal view carries the records, each marked HOLD, with INTERNAL_VIEW among its blockers (the strings the view must never print)');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- helpers for the single-table layout (2026-10-09, final layout pass) ---------------------------------------------------------------------------
const rowsOf = (h) => [...h.matchAll(/<tr role="row"([^>]*)>([\s\S]*?)<\/tr>/g)].filter((m) => /<th scope="row"/.test(m[2])).map((m) => {
  const cells = [...m[2].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((c) => c[2]);
  return { attrs: m[1], html: m[2], cells, name: decode((/<span class="da-rv-name">([\s\S]*?)<\/span>/.exec(m[2]) || [, ''])[1]) };
});
const evOf = (h) => [...h.matchAll(/<li class="da-rv-evrec"([^>]*)>([\s\S]*?)<\/li>/g)].map((m) => ({ attrs: m[1], html: m[2], name: decode((/<h3 class="da-rv-evtitle">(?:<span class="da-rv-evnum">[^<]*<\/span> )?([\s\S]*?)<\/h3>/.exec(m[2]) || [, ''])[1]) }));
const rowNamed = (h, n) => rowsOf(h).find((r) => r.name === n);

// ---- 1. the layout: header, briefing, ONE three-column table, the map, change history, evidence ---------------------------------------------------
try {
  ok(keysOf(html) === 'filters,records,map,history,evidence', '1a the sections, in order: the screen-only filters, the records table, the map, Change History, Official evidence & coverage', keysOf(html));
  ok(sections(html).map((s) => s.label).join(' | ') === 'Type and stage | Nearby Development | Development Activity Map | Change History | Official evidence & coverage', '1b the section titles', sections(html).map((s) => s.label));
  ok(keysOf(htmlNone) === 'outcome,evidence', '1c an empty report renders only its outcome and Official evidence & coverage', keysOf(htmlNone));
  ok(keysOf(htmlCold) === 'filters,records,map,history,evidence', '1d the cold start (no ledger) has the same layout', keysOf(htmlCold));
  const idx = (t) => html.indexOf(t);
  const order = ['<header class="da-rv-head">', 'data-da-briefing', '<table class="da-rv-table"', 'aria-label="Development Activity Map"', 'aria-label="Change History"', 'aria-label="Official evidence &amp; coverage"', 'aria-label="Report actions"'];
  ok(order.every((t, i) => idx(t) > 0 && (i === 0 || idx(t) > idx(order[i - 1]))), '1e header, briefing, table, map, history, evidence, actions: read off the markup positions', order.map(idx));
  ok(!/What Changed Around|Recent Official Activity|Things to Review With Your Client|Approved \/ Coming<\/h2>|Proposed \/ Under Review<\/h2>/.test(html) && (html.match(/<table\b/g) || []).length === 1,
    '1f the duplicated summaries are gone: no What Changed / Recent Activity / Things to Review / per-stage card sections, and exactly ONE table');
  ok(!/<article class="da-rv-card"/.test(html), '1g there are no record cards');
  const all = textOf(html) + ' ' + textOf(htmlCold) + ' ' + textOf(htmlNone);
  ok(!/What Exists Today|Exists Today|Nearby Places|Neighborhood Map|Surroundings Map/i.test(all), '1h no inventory-style label anywhere (ruling 3)');
  ok(html.startsWith('<article class="da-rv') && html.indexOf('<header') < html.indexOf('<section'), '1i the property / address header comes before every section');
  ok(/Compare property/.test(html), '1j the action bar is still present');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 2. the table: Development | Stage | Quality-of-Life Impact, one row per record, each record once --------------------------------------------
try {
  const heads = [...html.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
  ok(heads.join('|') === 'Development|Stage|Quality-of-Life Impact', '2a exactly three columns, in this order', heads);
  const rows = rowsOf(html);
  ok(rows.length === 8 && W.report.projects.length === 8 && rows.every((r) => r.cells.length === 3), '2b one row per record, each with exactly three cells (8 records)', rows.map((r) => r.cells.length));
  ok(new Set(rows.map((r) => r.name)).size === 8 && rows.map((r) => r.name).sort().join() === W.report.projects.map((p) => p.name).sort().join(), '2c each record is in the table once, by the engine\'s own name');
  const men = rowNamed(html, 'Menchaca Apartments');
  const dev = textOf(men.cells[0]);
  ok(/^Menchaca Apartments Residential 0\.2 mi north · Map 1 Official source/.test(dev), '2d the Development cell: name, Type, distance and direction, map number, then a short source link', dev);
  ok(/Stage: Approved \/ Coming Agency stage: Advertised/.test(textOf(men.cells[1])), '2e the Stage cell: HomeSignal\'s stage, then the publisher\'s own stage under its own label', textOf(men.cells[1]));
  ok(/Potential construction noise and traffic/.test(textOf(men.cells[2])) && /Not site-verified/.test(textOf(men.cells[2])), '2f the impact cell is the qualified rule text');
  // no record's name appears as a heading anywhere else: the evidence block carries only what the row does not
  ok(evOf(html).length === 8 && new Set(evOf(html).map((e) => e.name)).size === 8, '2g one supporting-evidence entry per record');
  const ev = evOf(html).find((e) => e.name === 'Menchaca Apartments').html;
  ok(!/Potential construction|Quality-of-Life|0\.2 mi/.test(textOf(ev)), '2h the evidence entry repeats neither the impact text nor the distance (they are in the row)', textOf(ev));
  ok(/Official record:<\/span> Issued · Sep 24, 2026/.test(ev) && /Status in HomeSignal&#39;s record:<\/span> Approved/.test(ev) && /Data: WSDOT/.test(ev), '2i it keeps the evidence the row does not: filing/issue date, the agency status, the source attribution');
  const nums = rows.map((r) => (/Map (\d+)/.exec(r.cells[0]) || [])[1]).filter(Boolean);
  ok(nums.join() === '1,2,3,4,5,6' && evOf(html).map((e) => (/Map (\d+)/.exec(e.html) || [])[1]).filter(Boolean).join() === '1,2,3,4,5,6', '2j the Map numbers in the table, the evidence and the map agree', nums);
  const mapNums = [...html.matchAll(/<svg class="da-rv-plot[\s\S]*?<\/svg>/g)].map((m) => [...m[0].matchAll(/>(\d+)<\/text>/g)].map((x) => x[1])).flat();
  ok(mapNums.length >= 6 && ['1', '2', '3', '4', '5', '6'].every((n) => mapNums.includes(n)), '2k the numbered markers on the map are the same numbers', mapNums);
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 3. Stage: the engine's stages only, the publisher's own stage beside it, and a stale record says so ------------------------------------------
try {
  const label = (n) => decode((/<span class="da-rv-lifetext">([^<]*)<\/span>/.exec(rowNamed(html, n).cells[1]) || [, ''])[1]);
  ok(label('Menchaca Apartments') === 'Approved / Coming' && label('Riverside Retail Center') === 'Proposed / Under Review' && label('Oak Grove Townhomes') === 'Decided (denied or withdrawn)'
    && label('Highway 99 Widening') === 'Operating / built' && label('Fire Station 12') === 'Stage not stated', '3a each Stage cell carries the engine\'s own stage (or lifecycle, or "Stage not stated"): nothing re-derived');
  const allLabels = rowsOf(html).map((r) => label(r.name));
  ok(allLabels.every((l) => ['Approved / Coming', 'Proposed / Under Review', 'Decided (denied or withdrawn)', 'Permitted / Under Construction', 'Operating / built', 'Stage not stated'].includes(l)), '3b no new lifecycle value is invented', allLabels);
  const old = rowNamed(html, 'Willow Creek Plat'), fresh = rowNamed(html, 'Menchaca Apartments');
  ok(/data-da-stale/.test(old.cells[1]) && /Verify:<\/b> Issued Jan 10, 2025, over a year old\. Confirm it is still active\./.test(old.cells[1]), '3c a record whose official date is over a year old carries a concise Verify line IN its Stage cell', textOf(old.cells[1]));
  ok(!/data-da-stale|over a year old/.test(rowsOf(html).filter((r) => r.name !== 'Willow Creek Plat').map((r) => r.cells[1]).join('')), '3d and no other row does: a recent record is never marked stale');
  const dec = rowNamed(html, 'Oak Grove Townhomes');
  ok(!/Agency stage/.test(dec.cells[1]) && /da-rv-decided/.test(dec.cells[1]), '3e a Decided record shows the Decided stage and no invented publisher stage');
  // the publisher's stage is shown verbatim and escaped; absent when the engine has none
  const two = clone(W); two.report.projects.find((p) => p.project_id === 'k-approved').publisher_stage = '<b>Final</b> review';
  ok(/Agency stage: &lt;b&gt;Final&lt;\/b&gt; review/.test(rowNamed(view(two), 'Menchaca Apartments').cells[1]), '3f the publisher\'s stage is escaped text');
  const none = clone(W); delete none.report.projects.find((p) => p.project_id === 'k-approved').publisher_stage;
  ok(!/Agency stage/.test(rowNamed(view(none), 'Menchaca Apartments').cells[1]), '3g with none stated there is no Agency stage line (nothing is guessed)');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 4. Quality-of-Life Impact: one canonical rule, qualified, no invented measurement ------------------------------------------------------------------
try {
  const qol = (n) => textOf(rowNamed(html, n).cells[2]).replace(/^Quality-of-Life Impact: /, '');
  const kinds = Object.fromEntries(rowsOf(html).map((r) => [r.name, (/data-da-qol="([^"]*)"/.exec(r.html) || [])[1]]));
  ok(kinds['Menchaca Apartments'] === 'potential' && kinds['Oak Grove Townhomes'] === 'denied_or_withdrawn' && Object.values(kinds).every(Boolean), '4a every row carries one impact kind, and a Decided record is "denied or withdrawn"', kinds);
  ok(rowsOf(html).every((r) => /not (site-)?verified|no effect is established|Confirm the outcome/i.test(textOf(r.cells[2])) || /Effects not verified/.test(textOf(r.cells[2]))), '4b every impact text is qualified (not verified / no effect established / confirm)');
  const joined = rowsOf(html).map((r) => textOf(r.cells[2])).join(' ');
  ok(!/\d/.test(joined) && !/property value|home value|price|appreciat|increase in value|score|rating|decibel|minutes|percent|%/i.test(joined), '4c no number, score, rating, measurement or property-value prediction appears in any impact cell', joined.match(/.{15}(\d|value|price|score).{15}/i));
  ok(V.qolImpact({ type: { key: 'residential' }, lifecycle: { key: 'approved' } }).text === V.qolImpact({ type: { key: 'residential' }, lifecycle: { key: 'operating' } }).text, '4d the rule is keyed by Type only (stage does not change the wording)');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 5b. source links and long text ---------------------------------------------------------------------------------------------------------------
try {
  const links = [...html.matchAll(/<table[\s\S]*?<\/table>/g)][0][0];
  ok(!/https?:\/\//.test(textOf(links)) && !/example\.gov/.test(textOf(links)) && (links.match(/class="da-rv-link"/g) || []).length === 8, '5b-a the table shows a short "Official source" label, never a raw address (8 links, 0 visible URLs)');
  ok(/Official source/.test(textOf(links)) && [...links.matchAll(/class="da-rv-link" href="([^"]*)"/g)].every((m) => /^https:\/\/example\.gov\/records\/k-/.test(m[1])), '5b-b each link still points at that record\'s own address');
  ok(/<span class="da-rv-url">https:\/\/example\.gov\/records\/k-approved<\/span>/.test(html), '5b-c the full address is carried once, in the evidence entry (printed there so a paper copy still leads to the record)');
  ok(/\.da-rv-url\{display:none/.test(V.CSS) && /@media print\{[\s\S]*\.da-rv-url\{display:block/.test(V.CSS), '5b-d the address is print-only: hidden on screen, shown in print');
  const longName = 'The Extraordinarily Long Named Mixed-Use Redevelopment Of The Former Downtown Industrial Warehouse District And Adjacent Parcels Phase 2B';
  const ln = clone(W); ln.report.projects.find((p) => p.project_id === 'k-approved').name = longName;
  ln.report.projects.find((p) => p.project_id === 'k-approved').source.url = 'https://example.gov/' + 'very-long-path-segment/'.repeat(12) + 'record?id=1';
  const hl = view(ln);
  ok(rowNamed(hl, longName) && evOf(hl).some((e) => e.name === longName) && /overflow-wrap:anywhere|word-break/.test(V.CSS), '5b-e a very long name and a very long address are kept whole (no truncation) and the stylesheet lets them wrap');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }


// ---- 4. nothing internal reaches the page ----------------------------------------------------------------------------------------------------------
try {
  const FORBIDDEN = [
    'storage_blockers', 'storable', 'INTERNAL_VIEW', 'CONTAINS_UNCLEARED_SOURCE', 'source_family', 'source_families_in_report', FAM_A, FAM_B, 'wsdot', 'austin-site',
    'change_ready', 'observation_count', 'first_observed_at', 'last_observed_at', 'homesignal_observation', 'content_hash', 'report_id', 'assessment_basis',
    'records_returned_for_this_radius', 'NO_INCLUDED_SOURCE', 'SOURCES_NOT_INCLUDED', 'AREA_TRUNCATED', 'SOURCE_NOT_FULLY_READ', 'LIMITED_COVERAGE', 'REPORT_READY',
    'CHANGE_READY', 'OUTSIDE_COVERAGE', 'Signed paid pilots', 'Verdict', 'NOT YET', 'distances_mi', 'project_id', 'source_key', 'feature_id', 'record_kind',
    'date_kind', 'submitted_at', 'type_raw', 'publisher_event', 'detected_at', 'event_type', 'rights', 'allowlist', 'audit', 'debug', 'zip_supported',
  ];
  const WORD = [/\bHOLD\b/, /\bCLEARED\b/, /\bhash\b/i, /\bdebug\b/i];
  const trunc = { ...RICH, rows: RICH.rows.map((r, i) => (i === 0 ? { ...r, has_more: true } : r)) };
  const WTRUNC = await wire(trunc);
  const outputs = { customer: html, cold: htmlCold, 'empty customer (shipped rights)': htmlNone, internal: htmlInt, truncated: view(WTRUNC) };
  ok(WTRUNC.report.coverage.limitations.some((l) => l.code === 'AREA_TRUNCATED'), '4a (control) the truncated fixture really carries the AREA_TRUNCATED limitation, whose code must not print');
  for (const [name, out] of Object.entries(outputs)) {
    const hits = FORBIDDEN.filter((f) => out.includes(f)).concat(WORD.filter((w) => w.test(out)).map(String));
    ok(hits.length === 0, '4b the ' + name + ' output contains none of the ' + (FORBIDDEN.length + WORD.length) + ' internal strings', hits);
  }
  const dirty = html + ' storage_blockers HOLD wsdot-project-delivery-plan-proposed';
  ok(['storage_blockers', 'wsdot'].every((f) => dirty.includes(f)) && WORD[0].test(dirty), '4c (control) the scan is able to see an internal string when one is there');
  ok(htmlInt.includes('Menchaca Apartments') && rowsOf(htmlInt).length >= 8, '4d the internal-view response renders its records like any other, with no internal label (the caller owns any "internal" framing)');
  const risky = /project|source|family|registry|hold|clear|hash|blocker/i;
  ok(attrs(html).every(([k, v]) => !risky.test(k + ' ' + v) || k === 'href'),
    '4e no attribute name or value carries an id, a family, a registry value or a rights word (links excepted)', attrs(html).filter(([k, v]) => risky.test(k + ' ' + v) && k !== 'href').slice(0, 5));
  ok(attrs(html).length > 40, '4e (control) there were attributes to scan (' + attrs(html).length + ')');
  const ALLOWED_ATTRS = new Set(['class', 'aria-label', 'aria-hidden', 'data-lifecycle', 'data-da-qol', 'href', 'target', 'rel', 'viewBox', 'width', 'height', 'focusable', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'cx', 'cy', 'r', 'x', 'y', 'rx', 'd',
    // the 100526 layout: stage badges, the filters, the map, the action bar
    'data-stage', 'data-da-type', 'data-da-stage', 'data-da-filter', 'data-da-value', 'aria-pressed', 'type', 'role', 'scope', 'transform', 'text-anchor', 'dy', 'aria-disabled', 'hidden']);
  const seen = new Set(Object.values(outputs).flatMap((o) => attrs(o).map(([k]) => k)));
  ok([...seen].every((k) => ALLOWED_ATTRS.has(k)) && seen.has('data-lifecycle') && seen.has('href'), '4e2 the only attribute NAMES that ever appear are the closed set of presentation ones: no id, no data-id, no title, no style, no other data-*', [...seen].filter((k) => !ALLOWED_ATTRS.has(k)));
  ok(!/<(script|iframe|object|embed|form|input|img|select|textarea)\b/i.test(html) && !/\son[a-z]+=/i.test(html), '4f the output has no script, frame, form, input or event-handler attribute');
  const buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1]);
  ok(buttons.length > 0 && buttons.every((b) => /\stype="button"/.test(b)), '4f2 its only controls are type="button" buttons (the filters and the action bar), so nothing submits anywhere', buttons.length);
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 5. coverage: the engine's own words, never "no activity" ------------------------------------------------------------------------------------
try {
  const lim = WNONE.report.coverage.limitations.map((l) => l.text);
  ok(lim.length === 1 && lim[0] === 'No official development source for this area is included in this report.', '5a the engine\'s limitation text for the shipped state', lim);
  const ev = sec(htmlNone, 'evidence').html;
  ok(ev.includes('<li>' + lim[0] + '</li>'), '5b a LIMITED_COVERAGE report with zero records shows the engine\'s limitation text verbatim');
  const ABSENCE = /\bno ((recent|new|official) )*(development )?activity|\bno (development|projects?|records?|changes?)( were| was)? (found|nearby|in this area|to report)|\bnothing (was |is )?(found|nearby|happening)|\bno development (was )?found|\bnothing to report|\b0 (projects|records)/i;
  ok(ABSENCE.test('No development activity found near this address') && ABSENCE.test('Nothing nearby') && ABSENCE.test('no recent official activity'), '5c (control) the absence pattern matches the claims it is meant to catch');
  ok(!ABSENCE.test(textOf(htmlNone)), '5d the empty report makes no claim that nothing is happening (hard rule 66: no activity is not the same as no coverage)', textOf(htmlNone));
  ok(textOf(htmlNone).includes(V.DISCLOSURE) && textOf(htmlNone).includes(V.SCOPE_LINE) && textOf(htmlNone).includes(V.SCOPE_NOTE), '5e the standard disclosure and both scope lines are on it');
  ok(/da-rv--empty/.test(htmlNone) && !/da-rv--empty/.test(html), '5f an empty report is marked so its limitation text is drawn prominently');
  const nothingNear = await wire({ rows: [], projects: [], ledger: [], events: [], health: [] });
  ok(nothingNear.report.projects.length === 0 && nothingNear.report.coverage.limitations.length === 0, '5g (control) a cleared-source, zero-record, no-limitation report exists in the engine', nothingNear.report.coverage.limitations);
  const hn = view(nothingNear);
  ok(keysOf(hn) === 'outcome,evidence' && sec(hn, 'outcome').label === 'No data ingested' && !ABSENCE.test(textOf(hn)) && !/<ul class="da-rv-lims">/.test(hn),
    '5h it says "No data ingested", renders the scope and disclosure, and makes no statement of absence either (a query that returns nothing is not proof, plan line 1338)', keysOf(hn));

  // ---- the outcome, in the founder's words (ruling R5, 2026-10-02): "No development activity" vs "No data ingested" ----
  const out = sec(htmlNone, 'outcome');
  ok(out && out.label === 'No data ingested' && /<h2 class="da-rv-h2">No data ingested<\/h2>/.test(out.html) && / da-rv-hero/.test(out.cls),
    '5j the shipped state: the empty report leads with "No data ingested"', out && out.label);
  ok(textOf(out.html).includes('HomeSignal cannot yet confirm it receives official development records for this address, so this report cannot say whether there is development nearby. It is not a finding that there is no development.'),
    '5k and says in plain words that it is HomeSignal\'s gap, not a finding about the area', textOf(out.html));
  ok(JSON.stringify(Object.fromEntries(Object.entries(V.OUTCOMES).map(([k, o]) => [k, o.title]))) === JSON.stringify({ NO_DATA_INGESTED: M.ACTIVITY_LABELS.NO_DATA_INGESTED, NO_DEVELOPMENT_ACTIVITY: M.ACTIVITY_LABELS.NO_DEVELOPMENT_ACTIVITY }),
    '5l the view\'s two titles are the engine\'s labels, word for word');
  const proven = clone(WNONE); proven.report.activity = { outcome: 'NO_DEVELOPMENT_ACTIVITY', label: 'No development activity', rule_version: 'activity-outcome-1' };
  const hp = view(proven), op = sec(hp, 'outcome');
  ok(op && op.label === 'No development activity' && textOf(op.html) === 'No development activity HomeSignal\'s official development records for this address are coming in, and they show no development within 0.5 miles of this property.',
    '5m once the engine can prove it, the empty report says "No development activity" and the radius it covers', op && textOf(op.html));
  const p1 = clone(proven); p1.report.radius_mi = 1;
  ok(/within 1 mile of this property\.$/.test(textOf(sec(view(p1), 'outcome').html)), '5n one mile is "1 mile"');
  const p2 = clone(proven); delete p2.report.radius_mi;
  ok(/show no development near this property\.$/.test(textOf(sec(view(p2), 'outcome').html)), '5n with no radius stated it says "near this property" and invents none');
  const labelLies = clone(WNONE); labelLies.report.activity = { outcome: 'NO_DATA_INGESTED', label: 'No development activity', rule_version: 'activity-outcome-1' };
  ok(sec(view(labelLies), 'outcome').label === 'No data ingested', '5o the words come from the outcome CODE, never the label text: a label that disagrees with its code cannot become a claim');
  const shownButSaysEmpty = clone(W); shownButSaysEmpty.report.activity = { outcome: 'NO_DEVELOPMENT_ACTIVITY', label: 'No development activity', rule_version: 'activity-outcome-1' };
  const shownButIngested = clone(W); shownButIngested.report.activity = { outcome: 'NO_DATA_INGESTED', label: 'No data ingested', rule_version: 'activity-outcome-1' };
  ok(!sec(view(shownButSaysEmpty), 'outcome') && !sec(view(shownButIngested), 'outcome') && !sec(html, 'outcome'),
    '5p a report that carries projects never shows an empty-report outcome, whatever the outcome field says');
  const noField = clone(WNONE); delete noField.report.activity;
  const odd = clone(WNONE); odd.report.activity = { outcome: 'NO_ACTIVITY' };
  const notObj = clone(WNONE); notObj.report.activity = 'NO_DEVELOPMENT_ACTIVITY';
  ok([noField, odd, notObj].every((r) => keysOf(view(r)) === 'evidence'), '5q an older response with no outcome, or an outcome the view does not know, shows no outcome block: the view never infers one from an empty list');
  ok(W.report.activity.outcome === 'DEVELOPMENT_SHOWN' && WNONE.report.activity.outcome === 'NO_DATA_INGESTED' && WINT.report.activity.outcome === 'DEVELOPMENT_SHOWN',
    '5r (control) the engine sends the outcome these tests read: development shown when cleared records are shown, "No data ingested" in the shipped customer view');
  const DIST = /\d\.\d mi\b|Under 0\.1 mi/;
  ok(DIST.test(textOf(html)) && DIST.test(textOf(htmlCold)), '5i (control) with render present, distances are shown');
  const noRender = clone(W); delete noRender.render;
  const emptyRender = clone(W); emptyRender.render = { distances_mi: {} };
  const junkRender = clone(W); junkRender.render = { distances_mi: { 'k-approved': 'near', 'k-first': -1, 'k-proposed': NaN, 'k-decided': null } };
  for (const [name, r] of [['render absent', noRender], ['render with no distances', emptyRender], ['render with unusable distances', junkRender]]) {
    const h = view(r);
    ok(!DIST.test(textOf(h)) && rowsOf(h).length >= 8, '5j ' + name + ': no distance anywhere, and the cards still render');
  }
  ok(/Under 0\.1 mi/.test(textOf(view({ ...clone(W), render: { distances_mi: { 'k-approved': 0.04 } } }))), '5k a distance under a tenth of a mile is shown as such, not as 0.0');
  const wh = await wire({ ...RICH, health: [{ registry_id: FAM_A, fetch_failures_24h: 2, blocked_24h: 0, truncated_24h: 0 }] });
  ok(wh.report.coverage.limitations.some((l) => l.code === 'SOURCE_NOT_FULLY_READ') && /<li>One or more official sources for this area could not be fully read recently\.<\/li>/.test(view(wh)),
    '5l a source that could not be fully read is disclosed in the engine\'s words');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 6. escaping, links, and the address ----------------------------------------------------------------------------------------------------
try {
  const evil = '<script>alert(1)</script>';
  const inj = clone(W);
  const P = (k) => inj.report.projects.find((p) => p.project_id === k);
  P('k-approved').name = evil; P('k-approved').publisher_status = '"><img src=x onerror=alert(1)>'; P('k-approved').type = { key: 'residential', label: '<b>Residential</b>' };
  P('k-approved').source.attribution = '<i>Data</i> & "co"'; P('k-approved').lifecycle.label = '<u>Approved</u>';
  P('k-approved').homesignal_detected_changes[0].changes[0] = { field: '<f>', from: '<from>', to: evil };
  P('k-approved').publisher_event.label = '<em>Issued</em>';
  inj.report.coverage.limitations.push({ code: 'X', text: '<svg onload=alert(1)>' });
  const hi = V.html(inj, { subject: '742 "Evergreen" <b>Terrace</b>' });
  ok(!/<script|<img|<svg onload|<i>|<u>|<em>|<f>|<from>/.test(stripShapes(hi)), '6a no injected element survives: every publisher, ledger, engine and caller string is escaped');
  ok(hi.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && hi.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;') && hi.includes('&lt;i&gt;Data&lt;/i&gt; &amp; &quot;co&quot;')
    && hi.includes('<span class="da-rv-sub da-rv-sub--type">&lt;b&gt;Residential&lt;/b&gt;</span>') && hi.includes('&lt;svg onload=alert(1)&gt;') && hi.includes('742 &quot;Evergreen&quot; &lt;b&gt;Terrace&lt;/b&gt;'), '6b and the text is there, escaped, not dropped');
  ok(attrs(hi).length > 40 && attrs(hi).every(([k]) => !/^on/i.test(k)), '6c no attribute named on* exists in the output');
  const hero = clone(W); hero.report.projects.find((p) => p.project_id === 'k-op').name = evil;
  const hh = view(hero);
  ok(!/<script/.test(hh) && /<span class="da-rv-name">&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/span>/.test(hh),
    '6c2 a hostile name on an operating record row is escaped too');
  const links = clone(W);
  const L = (k, u) => { links.report.projects.find((p) => p.project_id === k).source.url = u; };
  L('k-approved', 'javascript:alert(1)'); L('k-first', 'JAVASCRIPT:alert(1)'); L('k-proposed', 'ftp://example.gov/x'); L('k-decided', 'https://example.gov/a b');
  L('k-old-appr', '//example.com/x'); L('k-op', 'data:text/html,<script>alert(1)</script>'); L('k-unk', 'https://evil.example/"onmouseover="alert(1)'); L('k-sched', 'https://example.gov/ok?x=1&y=2');
  const hl = view(links);
  const hrefs = [...hl.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  ok(hrefs.length > 0 && [...new Set(hrefs)].join() === 'https://example.gov/ok?x=1&amp;y=2', '6d of eight source URLs only the real http(s) one is linked, wherever it is linked (the table row and the card): not javascript:, JAVASCRIPT:, ftp:, a space, protocol-relative, data:, a quote', hrefs);
  ok(!/\sonmouseover=/.test(hl), '6e the quote-carrying URL did not become an attribute');
  const real = [...html.matchAll(/<a class="da-rv-link" href="([^"]*)" target="_blank" rel="noopener noreferrer">/g)];
  const nLinks = [...html.matchAll(/<a\b/g)].length;
  const inTable = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].reduce((a, t) => a + (t[0].match(/<a\b/g) || []).length, 0);
  ok(real.length === nLinks && inTable > 0 && real.length === 8 + inTable && real.every((m) => /^https?:\/\//.test(m[1])), '6f every link on a normal report is http(s), opens in a new tab, with noopener noreferrer (9 cards and 3 review items: 12, plus one per table row that has a link: ' + inTable + ')', [real.length, inTable]);
  ok(/Official source <span aria-hidden="true">→<\/span><span class="da-rv-sr"> for Menchaca Apartments \(opens in a new tab\)<\/span>/.test(html), '6g a link\'s accessible name carries the record it belongs to');
  const subj = '742 Evergreen Terrace, Springfield, OR 97477';
  const hs = V.html(W, { subject: subj });
  ok(hs.split(subj).length - 1 === 1 && /<p class="da-rv-addr">742 Evergreen Terrace, Springfield, OR 97477<\/p>/.test(hs), '6h the caller\'s address appears exactly once, as the header text');
  ok(attrs(hs).every(([, v]) => !/742|Evergreen|Springfield|97477/i.test(v)) && !/href="[^"]*(742|Evergreen)/i.test(hs), '6i it appears in no attribute value of any kind: not an href, data-*, id, class or aria-label, and in no URL');
  const addrXss = V.html(W, { subject: '"><script>alert(1)</script>' });
  ok(!/<script/.test(addrXss) && /&quot;&gt;&lt;script&gt;/i.test(addrXss), '6j a hostile address string is escaped');
  ok(/<p class="da-rv-addr">Address unavailable<\/p>/.test(V.html(W)) && /Address unavailable/.test(V.html(W, { subject: '   ' })) && /Address unavailable/.test(V.html(W, { subject: 42 })), '6k no address supplied (a purged report): the header says "Address unavailable" and shows nothing else');
  const attr = Object.fromEntries(evOf(html).map((e) => [e.name, /<p class="da-rv-attr">([^<]*)<\/p>/.exec(e.html)?.[1] ?? null]));
  ok(attr['Menchaca Apartments'] === 'Data: WSDOT' && attr['Riverside Retail Center'] === null, '6l a cleared source\'s attribution is shown with its record, and a record with none shows none', attr);
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 7. it shows what the engine gave, in the order it gave it, and changes nothing --------------------------------------------------------------------
try {
  const before = JSON.stringify(W);
  const a = view(W), b = view(W);
  ok(JSON.stringify(W) === before && a === b, '7a the view does not mutate the response and gives the same output twice');
  const rev = clone(W);
  rev.report.sections.recent_official_activity = rev.report.sections.recent_official_activity.slice().reverse();
  rev.report.sections.by_stage.proposed = rev.report.sections.by_stage.proposed.slice().reverse();
  const hr = view(rev);
  const propRows = (h) => rowsOf(h).filter((r) => /data-da-stage="proposed"/.test(r.attrs)).map((r) => r.name).join();
  ok(propRows(html) === 'Oak Grove Townhomes,Lakeline Medical Office,Riverside Retail Center,Planned Bridge Replacement' && propRows(hr) === 'Planned Bridge Replacement,Riverside Retail Center,Lakeline Medical Office,Oak Grove Townhomes', '7b the view sorts nothing: a reversed engine list is a reversed run of rows', [propRows(html), propRows(hr)]);
  const ghost = clone(W);
  ghost.report.sections.by_stage.approved.push('no-such-project', 'k-approved');
  ok(rowsOf(view(ghost)).filter((r) => /data-da-stage="approved"/.test(r.attrs)).length === 2, '7d an id the report does not carry is skipped, and a repeated id is shown once');
  const hist = sec(html, 'history').html;
  const items = hist.split('<li class="da-rv-hist">').slice(1);
  ok(items.length === 6 && items.map((i) => decode(/<h3 class="da-rv-title">([\s\S]*?)<\/h3>/.exec(i)[1])).join() === 'Menchaca Apartments,Lakeline Medical Office,Highway 99 Widening,Oak Grove Townhomes,Fire Station 12,Riverside Retail Center',
    '7e Change History lists the records that have a detected change or a publisher event, in the engine\'s order', items.length);
  const men = items[0];
  ok(/<h4 class="da-rv-h4">Official record<\/h4><p class="da-rv-p">Issued · Sep 24, 2026<\/p>/.test(men) && /<h4 class="da-rv-h4">HomeSignal detected<\/h4>/.test(men), '7f a record with both has two separate, labelled lanes: Official record, and HomeSignal detected');
  ok(textOf(men).includes('Status changed · detected Sep 27, 2026') && textOf(men).includes('Publisher stage: Pending → Advertised') && textOf(men).includes('Status: Proposed → Approved'),
    '7g the detected change states from and to, in plain field names, in the order the ledger gave them', textOf(men));
  const fst = items[1];
  ok(!/Official record/.test(fst) && /First detected by HomeSignal · detected Sep 26, 2026/.test(textOf(fst)) && /Status: not stated → Proposed/.test(textOf(fst)), '7h a record with only a detected change has only that lane, and an unstated prior value reads "not stated"');
  ok(!/HomeSignal detected/.test(items[2]) && /Official record/.test(items[2]), '7i a record with only a publisher event has only the Official record lane');
  const h7j = sec(view(await wire({ rows: [row('q1', 0.4, FAM_A)], projects: [proj('q1', FAM_A, { status: 'Approved', date_kind: 'issued', submitted_at: '2025-02-01' })] })), 'history');
  ok(h7j && !/da-rv-hist/.test(h7j.html) && textOf(h7j.html) === 'Change History Change history begins once HomeSignal has observed these records at least twice.',
    '7j with neither, Change History says when it will start (no ledger observation yet), and lists nothing', h7j && textOf(h7j.html));
  const ready = await wire({ rows: [row('q1', 0.4, FAM_A)], projects: [proj('q1', FAM_A, { status: 'Approved', date_kind: 'issued', submitted_at: '2025-02-01' })], ledger: [{ identity_key: 'q1', registry_id: FAM_A, comparable: true, change_ready: true, observation_count: 2, first_observed_at: '2026-09-20T19:00:00Z', last_observed_at: '2026-09-28T19:30:00Z' }] });
  ok(textOf(sec(view(ready), 'history').html) === 'Change History HomeSignal\u2019s change history for these records starts on Sep 20, 2026. Since then it has recorded no status change for the projects in this report.' && ready.report.coverage.change_ready === true,
    '7j2 once HomeSignal has observed them twice, it says when its history starts and that it recorded no status change since (the ledger\'s own readiness)');
  const unk = clone(W);
  unk.report.projects.find((p) => p.project_id === 'k-first').homesignal_detected_changes[0].event_type = 'brand_new_type';
  unk.report.projects.find((p) => p.project_id === 'k-first').homesignal_detected_changes[0].changes[0].field = 'some_new_field';
  const hu = textOf(view(unk));
  ok(!/brand_new_type|some_new_field/.test(hu) && /Change detected/.test(hu) && /Some new field/.test(hu), '7k an event type outside the ledger\'s vocabulary is never printed raw; an unknown field is shown as plain words');
  ok(/Search radius 0\.5 miles · ZIP 97477/.test(textOf(html)) && /Generated Sep 29, 2026/.test(textOf(html)) && /Recent means the last 90 days before Sep 29, 2026\./.test(textOf(html)),
    '7l the header and the evidence section state the radius, the ZIP, the as-of day and what "recent" means, from the report\'s own fields');
  ok(textOf(html).startsWith('HOMESIGNAL DEVELOPMENT ACTIVITY 742 Evergreen Terrace'), '7m the eyebrow is HOMESIGNAL DEVELOPMENT ACTIVITY (ruling R6), then the property');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 8. a response that is not a report ------------------------------------------------------------------------------------------------------------------
try {
  const junk = [undefined, null, 5, 'x', [], {}, { status: 'OK' }, { status: 'OK', report: {} }, { status: 'OK', report: { projects: [], sections: null } }, { status: 'ADDRESS_NOT_RESOLVED', report: null, stored: false },
    { status: 'OUTSIDE_COVERAGE', zip: '99999', report: null, stored: false }, { status: 'error' }];
  let threw = false, outs = [];
  try { outs = junk.map((j) => V.html(j, { subject: ADDRESS })); } catch (e) { threw = String(e); }
  ok(!threw && outs.length === junk.length && outs.every((o) => o === ''), '8a a response that carries no report renders as an empty string and never throws (the caller owns those messages)', threw || outs);
  ok(junk.every((j) => V.renderable(j) === false) && V.renderable(W) === true, '8b renderable() says so, and is true for a real report');
  const sparse = { status: 'OK', report: { as_of: '2026-09-29', projects: [{ project_id: 'a' }, null, 7, { project_id: 5 }], sections: { what_changed_recently: ['a'], recent_official_activity: 'a', by_lifecycle: { approved: ['a'], proposed: null } } } };
  let t2 = false, hs = '';
  try { hs = V.html(sparse, { showLifecycle: true }); } catch (e) { t2 = String(e); }
  ok(!t2 && /Unnamed record/.test(hs) && /Lifecycle unknown/.test(hs) && !/<a\b/.test(hs) && keysOf(hs) === 'filters,records,history,evidence' && rowsOf(hs).length === 1,
    '8c a sparse or malformed report (an older one, with only by_lifecycle) still renders what it can: an unnamed record in Approved, an unknown lifecycle, no link, no claim', t2 || keysOf(hs));
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 9. the words are the plan's, quoted from the plan ------------------------------------------------------------------------------------------------------
try {
  const plan = readFileSync(join(root, 'docs/development-activity-plan-2026-09-30.md'), 'utf8');
  const quote = (needle) => { const l = plan.split('\n').find((x) => x.includes(needle)); return l ? l.replace(/^>\s*/, '').replace(/\*\*/g, '').trim() : null; };
  ok(V.DISCLOSURE === quote('HomeSignal summarizes selected official public records'), '9a the standard disclosure is the plan\'s sentence, word for word (plan line 1763)', quote('HomeSignal summarizes selected official public records'));
  ok(V.SCOPE_LINE === quote('Planned, approved, permitted and changing development found in'), '9b the scope line is the plan\'s (line 1261)');
  ok(V.SCOPE_NOTE === quote('This report focuses on development activity and change.'), '9c the supporting scope note is the plan\'s (line 1265)');
  ok(V.EYEBROW === 'HOMESIGNAL DEVELOPMENT ACTIVITY' && V.EYEBROW === M.PRODUCT_NAME, '9d the eyebrow equals the engine\'s product name (ruling R6)');
  ok(JSON.stringify(Object.values(V.TITLES)) === JSON.stringify(['Nearby Development', 'Type and stage', 'Development Activity Map', 'Approved / Coming', 'Proposed / Under Review', 'Permitted / Under Construction', 'Operating / Built', 'Stage not stated', 'Change History', 'Official evidence & coverage', 'Report actions']),
    '9e the section titles (the final layout pass, 2026-10-09, replaced the per-stage card sections, What Changed, Recent Official Activity and Things to Review with one table)', Object.values(V.TITLES));
  const p100526 = readFileSync(join(root, 'docs/development-activity-plan-100526.md'), 'utf8');
  ok(['DEVELOPMENT ACTIVITY MAP', 'APPROVED / COMING', 'PROPOSED / UNDER REVIEW', 'PERMITTED / UNDER CONSTRUCTION', 'CHANGE HISTORY'].every((t) => p100526.includes(t))
    && ['map', 'approved', 'proposed', 'permitted', 'history'].every((k) => p100526.includes(V.TITLES[k].toUpperCase())), '9f each of those titles is written, in capitals, in the 100526 plan');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 10. the briefing --------------------------------------------------------------------------------------------------------------------------------
try {
  const items = (h) => [...(/data-da-briefing>([\s\S]*?)<\/ul>/.exec(h) || [, ''])[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1]));
  const b = items(html);
  ok(/^As of Sep 29, 2026, 8 official records within 0\.5 miles of this property: /.test(b[0]) && /2 approved \/ coming/.test(b[0]) && /1 operating \/ built/.test(b[0]) && /Types: 3 Residential, 2 Commercial/.test(b[0]), '10a the first line: how many records, the stages and the principal Types', b[0]);
  ok(b.some((l) => /^2 records show a recent change in HomeSignal’s history/.test(l)), '10b the number of recently detected changes', b);
  ok(b.some((l) => /1 record carries an official date more than a year old/.test(l)), '10c the stale-record limitation is in the briefing', b);
  ok(b.length <= 6, '10d the briefing is short (' + b.length + ' lines)');
  const bc = items(htmlCold);
  ok(!bc.some((l) => /recent change in HomeSignal/.test(l)) && bc.some((l) => /none recorded yet/.test(l)), '10e with no ledger it says no change is recorded YET (not that nothing changed)', bc);
  const quiet = await wire({ rows: [row('q1', 0.4, FAM_A)], projects: [proj('q1', FAM_A, { status: 'Approved', date_kind: 'issued', submitted_at: '2026-08-01' })], ledger: [{ identity_key: 'q1', registry_id: FAM_A, comparable: true, change_ready: true, observation_count: 2, first_observed_at: '2026-09-20T00:00:00Z', last_observed_at: '2026-09-28T00:00:00Z', content_hash: 'h' }], events: [], health: [] });
  const bq = items(view(quiet));
  ok(quiet.report.coverage.change_ready === true ? bq.some((l) => /Recent changes: none recorded for this record, which remain on file/.test(l)) : true, '10f a ledger that can measure says "none recorded", about the records on file', bq);
  ok(!/\bzero\b|^0\b/.test(b[0]) && !/class="da-rv-metric"|da-rv-hero/.test(html), '10g there is no oversized zero or hero number: counts live in the briefing text');
  ok(items(htmlNone).length === 0 && !/data-da-briefing/.test(htmlNone), '10h an empty report has no briefing; its outcome block says why (zero records is not "no changes")');
  const caution = (/data-da-caution>([\s\S]*?)<\/p>/.exec(html) || [, ''])[1];
  ok(/not a prediction/.test(decode(caution)), '10i one plain caution follows the briefing');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 11. the header and the address -----------------------------------------------------------------------------------------------------------------
try {
  ok(V.displayAddress('20 N MAIN ST, BRIGHAM CITY, UT 84302') === '20 N Main St, Brigham City, UT 84302' && V.displayAddress('20 n main st, brigham city, ut 84302') === '20 N Main St, Brigham City, UT 84302', '11a an all-capitals or all-lowercase address is re-cased for display (state kept as capitals)');
  ok(V.displayAddress('1 McDonald Dr, Provo, UT 84601') === '1 McDonald Dr, Provo, UT 84601', '11b an address that already has mixed case is NEVER altered');
  ok(V.displayAddress('') === '' || false, '11c an empty address is not invented');
  const hb = V.html(W, { subject: ADDRESS, brokerage: 'Summit Realty', agent: 'Jordan Lee' });
  ok(/Summit Realty · Jordan Lee/.test(textOf(hb)) && /Generated Sep 29, 2026/.test(textOf(hb)) && /Search radius 0\.5 miles · ZIP 97477/.test(textOf(hb)), '11d the header carries brokerage, agent, the generation date and the search radius');
  ok(!/Summit/.test(textOf(html)) && !/da-rv-who/.test(html) && !/da-rv-who/.test(V.html(W, { subject: ADDRESS, brokerage: '  ' })), '11e brokerage and agent are shown only when supplied (nothing invented)');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 12. print, size, and the one shared renderer --------------------------------------------------------------------------------------------------
try {
  const P = V.CSS.slice(V.CSS.indexOf('@media print'));
  ok(/@page\{margin:/.test(P) && /counter\(page\)/.test(P) && /counter\(pages\)/.test(P), '12a print: a real page margin and HomeSignal\'s own footer with "Page N of M"');
  ok(/\.da-rv-table tr\{break-inside:avoid/.test(P.replace(/[,\s]+/g, (x) => (x.includes(',') ? ',' : ' ')).replace(/\.da-rv-evrec,[^{]*\{/, (m) => m)) || /\.da-rv-table tr\{break-inside:avoid/.test(P) || /da-rv-table tr\{break-inside:avoid/.test(P), '12b print: a table row is never split across pages');
  ok(/\.da-rv-h2\{break-after:avoid/.test(P) || /\.da-rv-brieflab,\.da-rv-h2\{break-after:avoid/.test(P), '12c print: a heading is kept with what follows it');
  ok(/thead\{display:table-header-group\}/.test(P), '12d print: the table header repeats on each page');
  ok(/\.da-rv-actions[^{]*\{display:none/.test(P) && /da-rv-sec--filters/.test(P), '12e print: the buttons and the filters are not printed');
  ok(/\.da-rv-detail>\.da-rv-sum\{display:none\}\.da-rv-detail::details-content\{content-visibility:visible;display:block\}/.test(P), '12e2 print: the collapsed evidence block is printed open (the whole report is printed)');
  ok(/html,body\{background:#fff!important\}/.test(P), '12f print: the page background is white (no grey block on a short last page)');
  ok(/Headers and footers/.test(V.PDF_HINT), '12g the Download PDF hint tells the person which browser setting to switch off');
  // one renderer: every page that shows a report loads this file and the layout lives nowhere else
  const pages = ['development-activity-reports.html', 'development-activity-review.html', 'shared-report.html'];
  ok(pages.every((f) => /lib\/da-report-view\.js\?v=[0-9a-f]{8}/.test(readFileSync(join(root, f), 'utf8'))), '12h the reports page, the founder review page and the shared-report page all load the one renderer');
  ok(!/da-rv-table|Quality-of-Life Impact/.test(pages.map((f) => readFileSync(join(root, f), 'utf8')).join('')), '12i none of them carries its own copy of the table');
  // many records: every one is a row, the same one table
  const many = { rows: [], projects: [], ledger: [], events: [], health: [] };
  for (let i = 0; i < 40; i++) { many.rows.push(row('m' + i, 0.05 + i * 0.011, i % 2 ? FAM_A : FAM_B)); many.projects.push(proj('m' + i, i % 2 ? FAM_A : FAM_B, { name: 'Project ' + i, status: ['Approved', 'Proposed', 'Under Construction'][i % 3], date_kind: 'filed', submitted_at: '2026-0' + (1 + (i % 8)) + '-10' })); }
  const hm = view(await wire(many));
  ok(rowsOf(hm).length === 40 && (hm.match(/<table\b/g) || []).length === 1 && evOf(hm).length === 40, '12j a 40-record report: one table with 40 rows and 40 evidence entries', rowsOf(hm).length);
  // saved reports: rendering is a pure function of the stored response. No network, no state, no credit.
  const guard = { window: {}, fetch: () => { throw new Error('the view must not fetch'); }, XMLHttpRequest: function () { throw new Error('the view must not use XHR'); } };
  runInNewContext(readFileSync(join(root, 'lib/da-report-view.js'), 'utf8'), guard);
  const stored = JSON.parse(JSON.stringify(W));
  ok(guard.window.HS.daReportView.html(stored, { subject: ADDRESS }) === html && JSON.stringify(stored) === JSON.stringify(W), '12k a saved report renders to the same markup from its stored response alone: no fetch, no regeneration, nothing written');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

// ---- 13. missing fields -----------------------------------------------------------------------------------------------------------------------------
try {
  const bare = clone(W);
  const p = bare.report.projects.find((q) => q.project_id === 'k-approved');
  p.type = null; p.publisher_stage = null; p.source = null; p.name = '';
  let hb = '', thrown = false;
  try { hb = V.html(bare, { subject: ADDRESS }); } catch (e) { thrown = true; }
  ok(!thrown && rowsOf(hb).length === 8, '13a a record with no Type, publisher stage, source link or name still renders as a row');
  const r0 = rowsOf(hb).find((r) => /Unnamed record/.test(r.name));
  ok(r0 && !/<a\b/.test(r0.cells[0]) && !/Agency stage/.test(r0.cells[1]) && !/da-rv-sub--type/.test(r0.cells[0]), '13b with nothing to link there is no link, no Agency stage, and no invented Type', r0 && r0.cells[0]);
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }


// ---- 14. the map, the chips, the lifecycle shapes and the small controls (kept from the 100526 layout, re-pinned for the one-table layout) -----------------
try {
  const PERMIT = { rows: [row('u1', 0.12, FAM_A), row('u2', 0.18, FAM_A, { marker_lat: 44.04612 - 0.18 / 69.05 }), row('u3', 0.32, FAM_B), row('u4', 0.45, FAM_B), row('u5', 0.05, FAM_A)],
    projects: [proj('u1', FAM_A, { name: 'SR-13 (Main St) & 100 North', type: 'Utility', status: 'Approved', stage: 'Under Construction', date_kind: 'filed', submitted_at: '2024-08-26' }),
      proj('u2', FAM_A, { name: 'SR-13 (Main St) & 100 South', type: 'Utility', status: 'Approved', stage: 'Under Construction', date_kind: 'filed', submitted_at: '2024-08-26' }),
      proj('u3', FAM_B, { name: 'Townhome plat', type: 'Residential', status: 'Approved', stage: 'Recorded', date_kind: 'filed', submitted_at: '2024-01-01' }),
      proj('u4', FAM_B, { name: 'Rezone request', type: 'Commercial', status: 'Proposed', stage: null, date_kind: 'filed', submitted_at: '2024-01-01' }),
      proj('u5', FAM_A, { name: 'Closed-out paving', type: 'Utility', status: 'Operating', stage: 'Close Out', date_kind: 'filed', submitted_at: '2023-01-26' })],
    ledger: [], events: [], health: [] };
  const WP = await wire(PERMIT);
  const hp = V.html(WP, { subject: '20 N Main St, Brigham City, UT 84302' });
  const mp = sec(hp, 'map').html;
  const marks = [...mp.matchAll(/<g class="da-rv-mk da-rv-mk--(\w+)" data-da-type="(\w+)" data-da-stage="(\w+)" transform="translate\(([\d.]+) ([\d.]+)\)"><title>([^<]*)<\/title>[\s\S]*?<text[^>]*>(\d+)<\/text><\/g>/g)]
    .map((m) => ({ k: m[1], x: Number(m[4]), y: Number(m[5]), title: decode(m[6]), n: m[7] }));
  ok(marks.length === 4 && marks.map((m) => m.n).join() === '1,2,3,4', '14a the map marks every staged record with a number, in the order of the table', marks.map((m) => m.n + ':' + m.title));
  const byN = Object.fromEntries(marks.map((m) => [m.title.replace(/^\d+: /, '').split(' · ')[0], m]));
  ok(byN['SR-13 (Main St) & 100 North'].y < 180 && byN['SR-13 (Main St) & 100 South'].y > 180 && Math.abs(byN['SR-13 (Main St) & 100 North'].y - (180 - 0.12 / 0.5 * 150)) < 1,
    '14b north is up and distance is to scale: 0.12 mi north sits 36 of 150 units above the property, and the southern record sits below it', byN['SR-13 (Main St) & 100 North']);
  const tableNums = rowsOf(hp).map((r) => r.name + '=' + ((/Map (\d+)/.exec(r.cells[0]) || [])[1] || '')).filter((x) => !x.endsWith('='));
  ok(tableNums.length === 4 && tableNums.every((c) => { const [t, n] = c.split('='); return byN[t] && byN[t].n === n; }), '14c each table row\'s "Map n" is the number of its marker', tableNums);
  ok(/Only tracked development activity is shown\./.test(mp) && /The numbers match the Map column in the table\./.test(mp) && /<circle cx="180" cy="180" r="150" class="da-rv-ring"\/>/.test(mp) && /0\.5 mi<\/text>/.test(mp), '14d the map says what it is, draws the 0.5-mile radius, and says its numbers match the table');
  ok(!/https?:|tile|basemap|<image\b|xlink/i.test(mp), '14e no street map, tile or external image on the map');
  ok(marks.filter((m) => m.k === 'permitted').length === 2 && /<rect/.test(/da-rv-mk--permitted[\s\S]*?<\/g>/.exec(mp)[0]) && !/<rect/.test(/da-rv-mk--approved[\s\S]*?<\/g>/.exec(mp)[0]), '14f a permitted record is a square on the map and an approved one is not');
  const noDir = clone(WP); noDir.render.bearings_deg = {};
  ok(!sec(V.html(noDir, {}), 'map') && rowsOf(V.html(noDir, {})).length >= 4, '14g with no directions in the response the map is left out (never drawn from a guess) and the table still lists every record');
  ok(['N', 'E', 'S', 'W'].every((l) => new RegExp('class="da-rv-ringlab">' + l + '</text>').test(mp)), '14h the map carries all four compass letters');
  // chips: counts are the rows each chip leaves; All is pressed
  const chips = [...sec(hp, 'filters').html.matchAll(/data-da-filter="(\w+)" data-da-value="(\w+)" aria-pressed="(\w+)">([^<]*?) <span class="da-rv-chipn">(\d+)<\/span>/g)].map((m) => m[1] + ':' + m[2] + ':' + m[3] + ':' + decode(m[4]) + ':' + m[5]);
  ok(chips.join('|') === 'type:all:true:All:4|type:residential:false:Residential:1|type:commercial:false:Commercial:1|type:infrastructure:false:Roads & infrastructure:2|stage:all:true:All:4|stage:approved:false:Approved / Coming:1|stage:proposed:false:Proposed / Under Review:1|stage:permitted:false:Permitted / Under Construction:2',
    '14i the chips: All is pressed on both rows, each Type and Stage chip counts the records it leaves (the quiet closed-out record is not in the report, so there is no Operating chip)', chips);
  const stageN = Object.fromEntries(chips.filter((c) => c.startsWith('stage:')).map((c) => { const f = c.split(':'); return [f[1], Number(f[4])]; }));
  const rowsByStage = (k) => rowsOf(hp).filter((r) => new RegExp('data-da-stage="' + k + '"').test(r.attrs)).length;
  ok(['approved', 'proposed', 'permitted'].every((k) => stageN[k] === rowsByStage(k)) && stageN.all === rowsOf(hp).length, '14j each Stage chip count equals the number of table rows with that stage', [stageN, rowsOf(hp).length]);
  const typeN = Object.fromEntries(chips.filter((c) => c.startsWith('type:')).map((c) => { const f = c.split(':'); return [f[1], Number(f[4])]; }));
  ok(Object.keys(typeN).filter((k) => k !== 'all').every((k) => typeN[k] === rowsOf(hp).filter((r) => new RegExp('data-da-type="' + k + '"').test(r.attrs)).length) && typeN.all === 4, '14k each Type chip count equals the number of rows of that Type');
  ok(/The filters change what is shown in the table and on the map\. They do not change the report\./.test(textOf(sec(hp, 'filters').html)), '14l the filters say they change what is shown, never the report');
  // lifecycle shapes (Change History badges): four keys, four drawings, proposed is hollow and dashed
  const shapes = {};
  for (const m of html.matchAll(/data-lifecycle="(\w+)"><svg class="da-rv-shape"[^>]*>(.*?)<\/svg>/g)) (shapes[m[1]] = shapes[m[1]] || new Set()).add(m[2]);
  const one = Object.values(shapes).map((x) => [...x]);
  ok(Object.keys(shapes).sort().join() === 'approved,operating,proposed,unknown' && one.every((x) => x.length === 1) && new Set(one.map((x) => x[0])).size === 4, '14m the four lifecycle shapes on the page are four different drawings, one per key', Object.keys(shapes));
  ok(/stroke-dasharray/.test([...shapes.proposed][0]) && /fill="none"/.test([...shapes.proposed][0]) && !/fill="none"/.test([...shapes.approved][0]), '14n Proposed is a dashed hollow outline and Approved is solid');
  const histLabel = (t) => decode((new RegExp('<h3 class="da-rv-title">' + t + '</h3><span class="da-rv-life[^>]*><svg[^>]*>.*?</svg><span class="da-rv-lifetext">([^<]*)</span>').exec(sec(html, 'history').html) || [, ''])[1]);
  ok(histLabel('Menchaca Apartments') === 'Approved' && histLabel('Lakeline Medical Office') === 'Proposed' && !/coming/i.test(histLabel('Lakeline Medical Office')), '14o Change History states the engine\'s own lifecycle label: Proposed is never called "coming"');
  // the evidence entry's dates
  const evMen = evOf(html).find((e) => e.name === 'Menchaca Apartments').html;
  ok(/HomeSignal detected:<\/span> Status changed · Sep 27, 2026/.test(evMen) && !/HomeSignal detected:<\/span>[^<]*Sep 24, 2026/.test(evMen), '14p the detected-change date is the date HomeSignal detected it (not the publisher\'s event date)');
  const lifeEv = evOf(htmlLife).find((e) => e.name === 'Lakeline Medical Office').html;
  ok(/HomeSignal lifecycle:<\/span> Proposed/.test(lifeEv) && /Ledger first read:<\/span> [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(lifeEv) && !/Ledger first read:<\/span> Mar 1, 2026/.test(lifeEv), '14q the internal view\'s ledger first-read day is the ledger\'s own, not the publisher\'s filing date', textOf(lifeEv));
  // the action bar: only with records; its switched-off buttons say "Available soon"
  ok(!/Report actions/.test(htmlNone) && /Available soon/.test(html) && !/Coming soon/.test(html), '14r an empty report has no action bar, and the switched-off actions say "Available soon"');
  ok(!/>Compare property/.test(htmlNone), '14s no actions on an empty report');
} catch (e) { ok(false, 'a block threw: ' + String((e && e.message) || e) + ' @' + ((e.stack||'').match(/test.da-report-view.test.mjs:(\d+)/)||[])[1]); }

ok(threw === 0, 'Z the view did not throw on any response in any check above (a throw is returned as a marker, so a check that expects an absence cannot pass on it)', threw);

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
