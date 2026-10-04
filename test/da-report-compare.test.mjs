// THE SIDE-BY-SIDE COMPARISON — behaviour (Development Activity build step 10 of docs/development-activity-build-steps-100526.md).
//
// lib/da-report-compare.js sets two to five SAVED reports side by side. This file proves it against the engine's TRUE output: every response
// below comes from the real request handler (test/lib/da-report-view-world.mjs → get-development-activity-report/handler.ts → assemble()), and the
// comparison is loaded the way the page loads it (a script that attaches to window.HS, after the report view).
//
// What is proven:
//   * "same report rules" is true by construction, and shown: every number in a column equals the number THAT report prints for itself (the
//     "On the record within 0.5 miles" line, the Type chips, the What Changed and Recent Official Activity counts). The test parses the report's own
//     rendered HTML and compares it with the comparison's cell; it does not restate a rule.
//   * a column never reads as a zero when the report cannot say: "No data ingested" is said in every count cell (and by the engine's own words under
//     the table), and a zero count of HomeSignal-detected changes before HomeSignal has observed the records long enough is "Not yet measured";
//   * it ranks nothing: columns keep the order they are given, no cell is marked, nothing is totalled, and no word of ranking or scoring appears;
//   * it refuses what cannot be compared (fewer than 2 or more than 5 reports, one report twice, an unreadable report, reports made over different
//     distances) and says why in fixed words; it fails closed when the report view is not loaded;
//   * the address and the client label appear as text in one place and in no attribute, and anything hostile in them is escaped;
//   * it does not compare distances (a saved report keeps none) and says so; it changes nothing it is given.
// Run: node test/da-report-compare.test.mjs
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RICH, COLD, RIGHTS_SHIPPED, wire, clone } from './lib/da-report-view-world.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

// ---- both modules, loaded as a page loads them -------------------------------------------------------------------------------------
const src = (f) => readFileSync(join(root, f), 'utf8');
const sandbox = { window: {} };
runInNewContext(src('lib/da-report-view.js'), sandbox);
runInNewContext(src('lib/da-report-compare.js'), sandbox);
const V = sandbox.window.HS.daReportView, C = sandbox.window.HS.daReportCompare;
const alone = { window: {} };                       // the comparison with NO view loaded
runInNewContext(src('lib/da-report-compare.js'), alone);

// ---- the fixtures: real engine responses, saved-report shape (a reopened report carries no `render`) --------------------------------------
const reopened = (r) => { const c = clone(r); delete c.render; c.reopened = true; return c; };
const W = reopened(await wire(RICH));                              // records, change history proven (the ledger has observed them twice)
const WCOLD = reopened(await wire(COLD));                          // records, but no ledger: HomeSignal has not yet observed them long enough
const WNONE = reopened(await wire(RICH, { rights: RIGHTS_SHIPPED })); // nothing cleared: zero records, outcome "No data ingested"
const WZERO = clone(WNONE); WZERO.report.activity = { outcome: 'NO_DEVELOPMENT_ACTIVITY', label: 'No development activity', rule_version: 'activity-outcome-1' }; // the engine's other outcome, set by hand: it never emits it today
const WUNSTATED = clone(WNONE); delete WUNSTATED.report.activity;                // an older report with no records and no outcome
const WREADY = clone(WCOLD); WREADY.report.coverage.change_ready = true;         // observed long enough, and still no change
const WLEGACY = clone(W); delete WLEGACY.report.sections.by_stage;               // a report from before the Permitted stage existed
const entry = (number, response, extra = {}) => ({ number, address: '742 Evergreen Terrace, Springfield, OR 97477', label: '', generated_at: '2026-09-29T12:00:00Z', response, ...extra });
const E3 = [entry(3, W, { address: '3 Rich Rd' }), entry(2, WCOLD, { address: '2 Cold Ct', label: 'Smith buyers' }), entry(1, WNONE, { address: '1 None Ave' })];

// ---- reading the output (HTML we generate: one table, simple rows) ---------------------------------------------------------------------------
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const textOf = (h) => decode(h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const rowsOf = (h) => [...h.matchAll(/<tr><th scope="row" class="da-cmp-rowh">([\s\S]*?)<\/th>([\s\S]*?)<\/tr>/g)].map((m) => ({
  label: decode(m[1]), cells: [...m[2].matchAll(/<td>[\s\S]*?<span class="da-cmp-v">([\s\S]*?)<\/span><\/td>/g)].map((c) => textOf(c[1])) }));
const rowOf = (h, label) => (rowsOf(h).find((r) => r.label === label) || { cells: [] }).cells;
const groupsOf = (h) => [...h.matchAll(/<tr class="da-cmp-grp"><th scope="colgroup" colspan="(\d+)">([\s\S]*?)<\/th><\/tr>/g)].map((m) => decode(m[2]));
const cmp = (entries) => { try { return C.html(entries); } catch (e) { return '[[threw: ' + String((e && e.message) || e) + ']]'; } };
const html3 = cmp(E3);

// ---- 0. the fixtures ARE the engine's output, and the comparison loads ------------------------------------------------------------------------------
{
  ok(W.status === 'OK' && W.report.projects.length === 8 && !('render' in W) && W.reopened === true, '0a the first fixture is the engine\'s report as a REOPENED saved report: 8 records, no render');
  ok(WNONE.report.projects.length === 0 && WNONE.report.activity && WNONE.report.activity.outcome === 'NO_DATA_INGESTED', '0b the shipped rights file gives an empty report whose engine outcome is "No data ingested"');
  ok(WCOLD.report.coverage && WCOLD.report.coverage.change_ready !== true && W.report.coverage.change_ready === true, '0c the cold report has not been observed long enough (change_ready is not true); the rich one has');
  ok(typeof C.build === 'function' && typeof C.html === 'function' && typeof C.mount === 'function' && C.MIN === 2 && C.MAX === 5, '0d the module exposes build, html, mount, and a limit of 2 to 5');
  ok(html3.startsWith('<article class="da-cmp"'), '0e three real reports compare without throwing', html3.slice(0, 60));
}

// ---- 1. what it refuses, in fixed words ----------------------------------------------------------------------------------------------------------
{
  const why = (entries) => { const b = C.build(entries); return b.ok ? 'OK' : b.reason; };
  ok(why([entry(1, W)]) === 'count' && why([]) === 'count' && why(null) === 'count' && why('x') === 'count', '1a fewer than two reports (one, none, null, a string) is refused: count');
  ok(why([1, 2, 3, 4, 5, 6].map((i) => entry(i, W))) === 'count' && why([1, 2, 3, 4, 5].map((i) => entry(i, W))) === 'OK', '1b six reports are refused and five are not: the limit is exactly 2 to 5');
  ok(why([entry(1, W), entry(2, W)]) === 'OK' && why([entry(1, W), entry(1, WCOLD)]) === 'duplicate', '1c two reports are enough, and the same report number twice is refused: duplicate');
  ok(why([entry(1, W), { ...entry(2, W), number: 0 }]) === 'unreadable' && why([entry(1, W), { ...entry(2, W), number: 1.5 }]) === 'unreadable'
    && why([entry(1, W), { ...entry(2, W), number: '2' }]) === 'unreadable' && why([entry(1, W), null]) === 'unreadable' && why([entry(1, W), 'x']) === 'unreadable',
    '1d an entry with no usable report number, or that is not an entry, is refused: unreadable');
  ok(why([entry(1, W), entry(2, { status: 'ADDRESS_NOT_RESOLVED', report: null })]) === 'unreadable' && why([entry(1, W), entry(2, { status: 'OK', report: { projects: [] } })]) === 'unreadable'
    && why([entry(1, W), entry(2, undefined)]) === 'unreadable', '1e a response with no report in it (not found, outside coverage, malformed) is refused: unreadable');
  const r1 = clone(W); r1.report.radius_mi = 1;
  const r0 = clone(W); delete r0.report.radius_mi;
  ok(why([entry(1, W), entry(2, r1)]) === 'radius' && why([entry(1, r0), entry(2, r0)]) === 'radius' && why([entry(1, W), entry(2, r0)]) === 'radius',
    '1f reports made over different distances (0.5 and 1 mile) are refused, and so is a report that does not say its distance: radius');
  ok(alone.window.HS.daReportCompare.build(E3).ok === false && alone.window.HS.daReportCompare.build(E3).reason === 'view' && alone.window.HS.daReportCompare.html(E3) === '',
    '1g with the report view not loaded it fails closed: reason view, and no markup');
  ok(['count', 'unreadable', 'radius', 'duplicate', 'view'].every((r) => typeof C.message(r) === 'string' && C.message(r).length > 20) && C.message('nonsense') === C.message('unreadable'),
    '1h every refusal has plain words, and an unknown reason falls back to the unreadable one');
  ok(C.html([entry(1, W)]) === '' && C.html(null) === '' && C.html([entry(1, W), entry(1, W)]) === '', '1i a refused comparison draws nothing');
}

// ---- 2. THE SAME NUMBERS AS THE REPORT: each cell equals what that report prints for itself -------------------------------------------------------------
{
  const own = (response) => V.html(response, { subject: 'x' });
  const stageLine = (h) => { const m = /On the record within 0\.5 miles: (\d+) permitted \/ under construction · (\d+) approved \/ coming · (\d+) proposed \/ under review\./.exec(textOf(h)); return m ? [m[1], m[2], m[3]] : null; };
  const sectionHtml = (h, key) => { const m = new RegExp('<section class="da-rv-sec da-rv-sec--' + key + '[^"]*"[^>]*>([\\s\\S]*?)</section>').exec(h); return m ? m[1] : ''; };
  const metricSum = (h) => [...h.matchAll(/<div class="da-rv-metric"><b>(\d+)<\/b>/g)].reduce((a, m) => a + Number(m[1]), 0);
  const chips = (h) => Object.fromEntries([...h.matchAll(/data-da-filter="type" data-da-value="(\w+)" aria-pressed="false">([^<]*?) <span class="da-rv-chipn">(\d+)<\/span>/g)].map((m) => [decode(m[2]), m[3]]));
  const two = cmp([entry(2, W), entry(1, WCOLD)]);
  [[W, 0], [WCOLD, 1]].forEach(([resp, col]) => {
    const h = own(resp), line = stageLine(h);
    ok(line !== null, '2a the report prints its own stage line ("On the record within 0.5 miles: ...") — column ' + (col + 1), textOf(h).slice(0, 200));
    ok(rowOf(two, 'Permitted / Under Construction')[col] === line[0] && rowOf(two, 'Approved / Coming')[col] === line[1] && rowOf(two, 'Proposed / Under Review')[col] === line[2],
      '2b the three stage cells equal the report\'s own stage line ' + JSON.stringify(line) + ' (column ' + (col + 1) + ')', [rowOf(two, 'Permitted / Under Construction')[col], rowOf(two, 'Approved / Coming')[col], rowOf(two, 'Proposed / Under Review')[col]]);
    const ch = chips(h), typeRows = rowsOf(two).filter((r) => ch[r.label] !== undefined);
    ok(Object.keys(ch).length > 0 && Object.keys(ch).filter((l) => ch[l] !== '0').every((l) => (rowOf(two, l)[col] || '') === ch[l]), '2c every Type with a record on the report is the same count in the comparison as on the report\'s own Type chip (column ' + (col + 1) + ')', [ch, typeRows]);
    const changedOwn = metricSum(sectionHtml(h, 'changed')), activityOwn = metricSum(sectionHtml(h, 'activity'));
    const changedCmp = rowOf(two, 'Records with a change HomeSignal detected')[col];
    ok(String(activityOwn) === rowOf(two, 'Records with a recent official event')[col], '2d the recent-official-event count equals the report\'s own Recent Official Activity total (' + activityOwn + ', column ' + (col + 1) + ')');
    ok(resp === W ? changedCmp === String(changedOwn) : (changedOwn === 0 && changedCmp === 'Not yet measured'), '2e the detected-change count equals the report\'s What Changed total where there is one (' + changedOwn + '), and is not shown as a zero where the report has no history yet (column ' + (col + 1) + ')', changedCmp);
  });
  // the report's own lists, through the shared read()
  const m = V.read(W);
  ok(rowOf(two, 'Approved / Coming')[0] === String(m.staged.approved.length) && rowOf(two, 'Proposed / Under Review')[0] === String(m.staged.proposed.length)
    && rowOf(two, 'Records with a change HomeSignal detected')[0] === String(m.changed.length), '2f the cells are the lengths of the view\'s own lists (read()), not a second derivation');
  ok(rowOf(two, 'Residential')[0] === '3' && rowOf(two, 'Commercial')[0] === '2' && rowOf(two, 'Roads & infrastructure')[0] === '1', '2g anchor: the rich fixture is 3 residential, 2 commercial, 1 roads & infrastructure', rowsOf(two).map((r) => r.label + '=' + r.cells[0]));
  // the labels of the three stages are the view's own titles
  ok(['Permitted / Under Construction', 'Approved / Coming', 'Proposed / Under Review'].every((l) => rowsOf(two).some((r) => r.label === l)) && V.TITLES.approved === 'Approved / Coming', '2h the stage rows carry the view\'s own titles');
}

// ---- 3. a column never reads as a zero when the report cannot say ----------------------------------------------------------------------------------------
{
  const COUNT_ROWS = ['Records with a change HomeSignal detected', 'Records with a recent official event', 'Permitted / Under Construction', 'Approved / Coming', 'Proposed / Under Review'];
  const mixed = cmp([entry(2, W), entry(1, WNONE)]);
  ok(COUNT_ROWS.every((l) => rowOf(mixed, l)[1] === 'No data ingested') && rowOf(mixed, 'Residential')[1] === 'No data ingested', '3a a report whose engine outcome is "No data ingested" says so in EVERY count cell, and shows no 0', COUNT_ROWS.map((l) => rowOf(mixed, l)[1]));
  const col1 = rowsOf(mixed).map((r) => r.cells[1]);
  ok(!col1.some((c) => /^0$/.test(c)), '3b ... and no cell in that column is a bare 0');
  ok(textOf(mixed).includes('HomeSignal cannot yet confirm it receives official development records for this address') && textOf(mixed).includes('It is not a finding that there is no development.'), '3c the engine\'s own words for that outcome appear under the table, so the column is explained');
  ok(rowOf(mixed, 'Most recent official record')[1] === 'No data ingested' && rowOf(mixed, 'Most recent change HomeSignal detected')[1] === 'No data ingested', '3d the timeline rows say it too');
  const zero = cmp([entry(2, W), entry(1, WZERO)]);
  ok(COUNT_ROWS.slice(1).every((l) => rowOf(zero, l)[1] === '0') && rowOf(zero, 'Residential')[1] === '0',
    '3e a report the ENGINE calls "No development activity" shows measured zeros for the official-event and stage counts', COUNT_ROWS.map((l) => rowOf(zero, l)[1]));
  ok(rowOf(zero, 'Records with a change HomeSignal detected')[1] === 'Not yet measured', '3e2 ... but its change count still waits for the engine\'s readiness flag: no history yet is not "nothing changed"', rowOf(zero, 'Records with a change HomeSignal detected'));
  ok(textOf(zero).includes('No development activity.') && /within 0\.5 miles of this property/.test(textOf(zero)), '3f ... and the engine\'s words for that outcome appear under the table, with the distance');
  const unstated = cmp([entry(2, W), entry(1, WUNSTATED)]);
  ok(COUNT_ROWS.every((l) => rowOf(unstated, l)[1] === 'Not stated') && textOf(unstated).includes('This report has no records, and it states no reason.'), '3g an empty report with no outcome is "Not stated" and never a zero: the comparison infers nothing the engine did not say');
  const cold = cmp([entry(2, W), entry(1, WCOLD)]);
  ok(rowOf(cold, 'Records with a change HomeSignal detected').join('|') === '2|Not yet measured' && rowOf(cold, 'Most recent change HomeSignal detected')[1] === 'Not yet measured',
    '3h a report HomeSignal has not observed long enough does not show "0 changes": it says Not yet measured', rowOf(cold, 'Records with a change HomeSignal detected'));
  ok(textOf(cold).includes(V.CHANGE_NOT_READY) && V.CHANGE_NOT_READY === 'Change history begins once HomeSignal has observed these records at least twice.', '3i ... and the view\'s own sentence for it appears under the table');
  const ready = cmp([entry(2, W), entry(1, WREADY)]);
  ok(rowOf(ready, 'Records with a change HomeSignal detected')[1] === '0' && rowOf(ready, 'Most recent change HomeSignal detected')[1] === 'None in this report' && !textOf(ready).includes(V.CHANGE_NOT_READY),
    '3j once the engine says change history is ready, no change IS a measured 0 and no note is added');
  ok(rowOf(cmp([entry(2, W), entry(1, WCOLD)]), 'Records with a recent official event')[1] === '5', '3k a publisher\'s own events are counted even where HomeSignal has no history (they are the publisher\'s, not HomeSignal\'s)');
  const leg = cmp([entry(2, W), entry(1, WLEGACY)]);
  ok(rowOf(leg, 'Permitted / Under Construction')[1] === 'Not in this report\'s version' && rowOf(leg, 'Residential')[1] === 'Not in this report\'s version' && rowOf(leg, 'Approved / Coming')[1] !== 'Not in this report\'s version',
    '3l a report from before the Permitted stage existed says so for Permitted and for the Type breakdown, and still compares the stages it has', rowOf(leg, 'Permitted / Under Construction'));
}

// ---- 4. it ranks nothing ------------------------------------------------------------------------------------------------------------------------------
{
  const order = (h) => [...h.matchAll(/<th scope="col">Report (\d+)<\/th>/g)].map((m) => m[1]).join(',');
  ok(order(html3) === '3,2,1', '4a the columns are in the order they were given (3, 2, 1), not sorted by number or by anything in them', order(html3));
  ok(order(cmp([...E3].reverse())) === '1,2,3' && order(cmp([E3[1], E3[0], E3[2]])) === '2,3,1', '4b given another order, the columns follow it');
  const legendOrder = (h) => [...h.matchAll(/<span class="da-cmp-n">Report (\d+)<\/span>/g)].map((m) => m[1]).join(',');
  ok(legendOrder(html3) === '3,2,1', '4c the list of reports compared is in the same order');
  const banned = /\b(best|worst|better|worse|top|bottom|winner|rank(ed|ing)?|score[ds]?|rating|rated|recommend(ed|s|ation)?|grade|favou?rite|safest|riskiest|total|sum|average|overall)\b/i;
  const stripped = textOf(html3).replace(C.NOT_A_SCORE, '');
  ok(!banned.test(stripped) && banned.test(C.NOT_A_SCORE) && stripped.length > 1000, '4d no word of ranking, scoring, recommending or totalling appears outside the one fixed sentence that says HomeSignal does none of it', stripped.match(banned));
  ok(!/\bdata-|aria-sort|aria-current|<mark|<strong|<b>.*(highest|lowest)|class="[^"]*\b(best|worst|high|low|max|min|top)\b/i.test(html3.replace(/<b>[^<]*<\/b>/g, '')), '4e nothing is marked, sorted or highlighted: no data- attribute, no aria-sort, no mark, no best/worst class');
  ok(C.NOT_A_SCORE === 'This sets facts from official records side by side. It is not a score or a recommendation, and HomeSignal does not rank properties.' && textOf(html3).includes(C.NOT_A_SCORE), '4f the page says in one fixed sentence that it is not a score or a recommendation');
  // the rows are the plan's factual items, nothing else
  ok(groupsOf(html3).join(' | ') === 'What changed | By stage | By type | Timeline | Coverage and freshness', '4g the groups are the plan\'s factual items: recent changes, stages, Types, timeline, coverage and freshness', groupsOf(html3));
  ok(rowsOf(html3).map((r) => r.label).join(' | ') === 'Records with a change HomeSignal detected | Records with a recent official event | Permitted / Under Construction | Approved / Coming | Proposed / Under Review | Residential | Commercial | Roads & infrastructure | Most recent change HomeSignal detected | Most recent official record | Report as of | What "recent" means | Limits the report states',
    '4h the rows, in order', rowsOf(html3).map((r) => r.label));
}

// ---- 5. the address and the label: text in one place, never in an attribute, escaped ---------------------------------------------------------------------------
{
  const A = 'ADDR-MARKER-77 <img src=x onerror=alert(1)> & "q"', L = 'LABEL-MARKER-88 <script>alert(2)</script>';
  const h = cmp([entry(5, W, { address: A, label: L }), entry(4, WNONE, { address: '' })]);
  const tags = [...h.matchAll(/<[^>]+>/g)].map((m) => m[0]).join('\n');
  ok((h.match(/ADDR-MARKER-77/g) || []).length === 1 && (h.match(/LABEL-MARKER-88/g) || []).length === 1, '5a the address and the label each appear exactly once in the markup');
  ok(!/ADDR-MARKER-77|LABEL-MARKER-88/.test(tags) && !/<img|<script|onerror=/i.test(h.replace(/&lt;[\s\S]*?&gt;/g, '')), '5b neither appears inside any tag or attribute, and the hostile markup in them is escaped, not live');
  ok(h.includes('&lt;img src=x onerror=alert(1)&gt;') && h.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), '5c the hostile text is shown as text');
  ok(/<li><span class="da-cmp-n">Report 4<\/span> <span class="da-cmp-addr">Address unavailable<\/span>/.test(h), '5d a report whose address is no longer kept shows the view\'s "Address unavailable"');
  ok(![...h.matchAll(/<th scope="col">([^<]*)<\/th>/g)].some((m) => /ADDR-MARKER|Evergreen/.test(m[1])), '5e the column headings say only "Report N", never the address');
  ok(!/href=|src=|<a |<img|<script|<iframe|<link|<form|<input/i.test(html3), '5f the comparison links to nothing and loads nothing: no href, src, image, script, frame or form');
  const WLIM = clone(W); WLIM.report.coverage.limitations = [{ text: '<i>LIM-HOSTILE</i> & more' }];
  const hl = cmp([entry(2, WLIM), entry(1, WCOLD)]);
  ok(hl.includes('&lt;i&gt;LIM-HOSTILE&lt;/i&gt; &amp; more') && !/<i>/.test(hl), '5g a limitation the engine states is shown as escaped text, never as markup');
}

// ---- 6. no distance, and the page says why --------------------------------------------------------------------------------------------------------------
{
  ok(!/\bmi\b(?!les)|\bmiles away|Under 0\.1 mi/.test(textOf(html3).replace(/within 0\.5 miles/gi, '')) && !/distance/i.test(rowsOf(html3).map((r) => r.label).join(' ')), '6a no row compares distance, and no distance figure appears');
  ok(textOf(html3).includes(C.DISTANCE_NOTE) && C.DISTANCE_NOTE === 'Distances are not compared. A saved report does not keep how far each record is from the property.', '6b the page says distances are not compared and why');
  // even a response that DOES carry render (a freshly made report) is compared on what it stores: render is never read
  const live = clone(W); live.render = { distances_mi: Object.fromEntries(live.report.projects.map((p) => [p.project_id, 0.2])), bearings_deg: {} };
  ok(cmp([entry(2, live), entry(1, WCOLD)]) === cmp([entry(2, W), entry(1, WCOLD)]), '6c a response that carries render gives exactly the same comparison as one that does not: distances are never read');
}

// ---- 7. it changes nothing it is given, and is deterministic ---------------------------------------------------------------------------------------------
{
  const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
  const frozen = deepFreeze(clone(E3));
  let out = '';
  try { out = C.html(frozen); } catch (e) { out = 'threw ' + e.message; }
  ok(out === html3, '7a it builds from deep-frozen input (a mutation of the input would throw) and gives the same markup');
  ok(C.html(E3) === C.html(E3) && JSON.stringify(C.build(E3)) === JSON.stringify(C.build(E3)), '7b the same entries give the same comparison twice');
  ok(JSON.stringify(E3) === JSON.stringify(clone(E3)) && E3[0].response.report.projects.length === 8, '7c the entries are unchanged after use');
}

// ---- 8. the reading aids: the list of reports, the dates, the coverage rows ------------------------------------------------------------------------------------
{
  ok(/<li><span class="da-cmp-n">Report 2<\/span> <span class="da-cmp-addr">2 Cold Ct<\/span> <span class="da-cmp-lab">Smith buyers<\/span> <span class="da-cmp-made">Made Sep 29, 2026<\/span><\/li>/.test(html3), '8a the list says each report\'s number, address, the agent\'s label and the day it was made');
  ok(rowOf(html3, 'Report as of').join('|') === 'Sep 29, 2026|Sep 29, 2026|Sep 29, 2026' && rowOf(html3, 'What "recent" means').every((c) => c === 'The last 90 days'), '8b each report says the day it is as of and what "recent" meant for it');
  const WNOAS = clone(W); delete WNOAS.report.as_of; delete WNOAS.report.recent_days;
  const noas = cmp([entry(2, WNOAS), entry(1, W)]);
  ok(rowOf(noas, 'Report as of').join('|') === 'Not stated|Sep 29, 2026' && rowOf(noas, 'What "recent" means').join('|') === 'Not stated|The last 90 days', '8b2 a report that does not state its day or its window says "Not stated", never a blank or a guess');
  const lims = rowOf(html3, 'Limits the report states');
  ok(lims[0] === 'None stated' && /No official development source for this area is included in this report/.test(lims[2]), '8c each report\'s own limitation text is shown verbatim, and "None stated" where it has none', lims);
  ok(rowOf(html3, 'Most recent official record')[0].startsWith('Roads & infrastructure — Highway 99 Widening') && rowOf(html3, 'Most recent change HomeSignal detected')[0].startsWith('Menchaca Apartments · Status changed, detected Sep 27, 2026'),
    '8d the timeline rows describe the engine\'s first record the way the report does', [rowOf(html3, 'Most recent official record')[0], rowOf(html3, 'Most recent change HomeSignal detected')[0]]);
  ok(textOf(html3).includes(V.DISCLOSURE) && textOf(html3).includes('Counted as official records: a record is a source record, not a proven separate project.'), '8e the standard disclosure and the unit of counting are on every comparison');
  ok(/<caption class="da-cmp-vh">Compare properties: 3 reports side by side<\/caption>/.test(html3) && /<th scope="col"><span class="da-cmp-vh">Fact<\/span><\/th>/.test(html3), '8f the table has a caption and a heading for its first column, for a screen reader');
  ok(rowsOf(html3).every((r) => r.cells.length === 3) && (html3.match(/<td><span class="da-cmp-r">Report \d<\/span>/g) || []).length === 13 * 3, '8g every row has one cell per report, each starting with its report number (what a phone shows when the table stacks)');
}

// ---- 9. mount ----------------------------------------------------------------------------------------------------------------------------------------------
{
  const mkDoc = () => { const styles = []; const doc = { head: { appendChild: (e) => styles.push(e) }, getElementById: (id) => styles.find((s) => s.id === id) || null, createElement: () => ({ id: '', textContent: '' }) }; return { doc, styles }; };
  const { doc, styles } = mkDoc();
  const el = { ownerDocument: doc, innerHTML: 'old' };
  const b = C.mount(el, E3);
  ok(b.ok === true && el.innerHTML === html3 && styles.length === 1 && styles[0].id === 'da-cmp-style' && styles[0].textContent === C.CSS, '9a mount writes the comparison once and adds its stylesheet to the document');
  C.mount(el, E3);
  ok(styles.length === 1, '9b mounting again adds no second stylesheet');
  const r = C.mount(el, [entry(1, W)]);
  ok(r.ok === false && r.reason === 'count' && el.innerHTML === '', '9c a refused comparison clears what was there and returns the reason, so a stale comparison is never left on screen');
  ok(C.mount(null, E3).ok === false, '9d mounting into nothing is a quiet failure');
  ok(/@media\(max-width:700px\)/.test(C.CSS) && /\.da-cmp-r\{display:none/.test(C.CSS) && /@media print/.test(C.CSS), '9e the stylesheet stacks the table on a phone and shows each cell\'s report number there');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
