// national-6 (2026-11-02): UNIVERSAL DEVELOPMENT ACTIVITY REPORT CORRECTIONS. The founder's acceptance tests, run on the real records near 3101 Western
// Ave, Seattle (test/fixtures/report-quality/seattle-3101-western-2026-11-02.json, a read-only production capture) and on controls in OTHER agencies'
// wording, so the rules are shown to be universal rather than fitted to the sample:
//   A. relevance: routine work and records that establish nothing leave the report; meaningful changes stay; the rule is not a keyword match
//   B. filtering happens before every output: sections, counts, map numbers, history, alerts (the Watch reads assemble().intelligence.projects)
//   C. lifecycle presentation: issued is not started, completed is not operating, a stage the agency did not publish is not asserted, past temporary activity
//      is not upcoming
//   D. record counts are not project counts; maps, tables and counts reconcile
//   E. quality-of-life notes are record-specific; titles are concise and never cut mid-word; agency and Jody categories are told apart; freshness; branding
// Run: node test/report-quality-national6.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import('../supabase/functions/_shared/national-report.ts');
globalThis.window = globalThis;
await import('../lib/project-type.js');
await import('../lib/da-report-view.js');
const V = globalThis.HS.daReportView;
let fails = 0, total = 0;
const ok = (c, name, detail) => { total++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 700)); } };
const read = (f) => readFileSync(join(root, f), 'utf8');
const fx = JSON.parse(read('test/fixtures/report-quality/seattle-3101-western-2026-11-02.json'));
const attribution = JSON.parse(read('supabase/functions/_shared/source-attribution.json'));
const NOW = new Date('2026-11-02T18:00:00Z');
const SUBJECT = { address: '3101 Western Ave, Seattle, WA 98121', matched_address: null, lat: fx._meta.subject_point[0], lng: fx._meta.subject_point[1], zip: '98121' };
const assembleWith = (projects, extra = {}) => M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'customer', zip_supported: true, attribution,
  rows: fx.rows, projects, ledger: fx.ledger, events: fx.events, health: fx.health, ...extra });
const a = assembleWith(fx.projects);
const rep = a.intelligence;
const response = { status: 'OK', coverage_state: a.coverage_state, report: rep, render: a.renderOnly };
const html = V.html(response, { subject: SUBJECT.address });
const byKey = (suffix) => fx.projects.find((p) => p.source_key.endsWith(suffix));
const shown = (suffix) => rep.projects.some((p) => p.project_id.endsWith(suffix));
const rel = (name, type_raw = null, typeKey = null, registry_id = null) => M.relevance({ name, type_raw, registry_id }, typeKey);

// ---- 0. the generated residential authority is the canonical file byte for byte -----------------------------------------------------------------
{
  let okGen = true; try { execFileSync(process.execPath, [join(root, 'scripts/gen-residential-qualify-module.mjs'), '--check'], { stdio: 'pipe' }); } catch { okGen = false; }
  ok(okGen, '0a supabase/functions/_shared/residential-qualify.generated.js is lib/residential-qualify.js under its header (no second copy of the residential rules)');
  ok(M.REPORT_VERSION === 'development-activity-national-6' && rep.relevance_rule_version === M.RELEVANCE_RULE_VERSION, '0b the report says which version and which relevance rule built it');
}

// ---- A. relevance: the founder's acceptance cases ---------------------------------------------------------------------------------------------------
{
  // a condominium kitchen remodel (7139171-CN) and a routine office tenant improvement (7161235-BK) are excluded everywhere
  ok(!shown('7139171-CN') && !html.includes('kitchen remodel'), 'A1 a condominium kitchen remodel is excluded from the report and the page');
  ok(!shown('7161235-BK') && !shown('7140619-BK') && !html.includes('PSOMAS') && !html.includes('SAGE BIONETWORKS'), 'A2 routine office tenant improvements with no documented use change are excluded');
  // office to restaurant
  ok(shown('7030407-CN') && rep.projects.find((p) => p.project_id.endsWith('7030407-CN')).relevance.basis === 'change_of_use'
    && rep.projects.find((p) => p.project_id.endsWith('7030407-CN')).relevance.use === 'restaurant', 'A3 an office-to-restaurant conversion stays, as a documented change of use to restaurant');
  // nightclub tenant improvement: evaluated for the use, not excluded by the words "tenant improvements"
  const nc = M.relevance(byKey('7157197-CN'), 'commercial');
  ok(nc.include && nc.basis === 'nightlife_use' && /does not say whether this use is new/.test(html), 'A4 a nightclub tenant improvement is judged on its use (kept, with a note that the record does not say the use is new)', nc);
  ok(!rel('Construct tenant improvements for existing nightclub (Neumos) per plan').include, 'A4b control: the same work on an EXISTING nightclub is routine');
  // building-wide balcony repairs
  const bal = M.relevance(byKey('7124514-CN'), 'residential');
  ok(bal.include && bal.basis === 'exterior_building_wide' && shown('7124514-CN'), 'A5 extensive building-wide balcony repairs (floors 2-12, 55 balconies) stay, as building-wide exterior work', bal);
  ok(!rel('Construct repairs to balcony at unit 302 per plan').include && !rel('Repair balcony railing').include, 'A5b control: one unit\'s balcony repair is not building-wide (not included)');
  // keywords alone decide nothing
  ok(!rel('Remodel').include && rel('Remodel').reason === 'not_established' && !rel('Repair').include && rel('Repair').reason === 'not_established'
    && rel('Alteration').reason === 'not_established', 'A6 a bare "remodel", "repair" or "alteration" establishes nothing either way (not routine by keyword, not included)');
  ok(rel('Substantial alterations and repairs to existing office building, change of use to apartments').basis === 'change_of_use'
    && rel('Interior demolition for tenant improvement').include === false, 'A7 significance outranks a routine word; interior demolition is not demolition');
  // other agencies' wording (universal, not fitted to Seattle)
  const cases = [
    ['NEW SINGLE FAMILY RESIDENCE W/ ATTACHED GARAGE', 'Residential', 'residential', true],
    ['Demolition of single family dwelling', null, 'residential', true],
    ['Rezoning from SF-3 to MF-4', 'Zoning/Rezoning', 'residential', true],
    ['Residential Air Conditioning 4169 LOVELESS DR', 'Single Family Detached', 'residential', false],
    ['Alteration/Tenant Finish 2001 N Colorado BLVD', 'Alteration/Tenant Finish', 'commercial', false],
    ['1,2,3 Family - Other Roof, Siding, Windows, Doors', '1,2,3 Family - Other', 'residential', false],
    ['Grading permit for new subdivision', null, 'residential', true],
    ['US-89 widening, 400 S to 600 S', null, 'infrastructure', true],
    ['Residential 7470 LEE BUCK RD SE 28479', 'Residential', 'residential', false],
  ];
  const wrong = cases.filter(([n, tr, k, want]) => rel(n, tr, k).include !== want);
  ok(wrong.length === 0, 'A8 other agencies\' wording: new homes, demolitions, rezonings, grading and road work stay; HVAC, tenant finish, re-roof and address-only records do not', wrong);
  ok(rel('Residential 7470 LEE BUCK RD SE 28479', 'Residential', 'residential').reason === 'not_established', 'A8b an address-only record is NOT called routine: its relevance is not established (left out and flagged for review)');
  // the canonical residential rule is consumed, not restated: a bounded development-class source (founder 2026-09-06) is included through it
  ok(rel('Brodie Oaks Redevelopment', 'Residential', 'residential', 'austin-subdivision-cases').basis === 'residential_development', 'A9 the residential authority\'s answer (here a founder-approved development-class source) is used, never re-decided');
  const fn = M.relevance.toString();
  ok(!/seattle|98121|western|bumbershoot|psomas|data\.seattle/i.test(fn), 'A10 the rule names no place, source or record from the sample', fn.match(/seattle|98121|western/i));
}

// ---- B. filtering before every output --------------------------------------------------------------------------------------------------------------
{
  const ids = new Set(rep.projects.map((p) => p.project_id));
  const inSections = [...Object.values(rep.sections.by_stage).flat(), ...Object.values(rep.sections.by_lifecycle).flat(), ...rep.sections.what_changed_recently, ...rep.sections.recent_official_activity];
  ok(inSections.every((id) => ids.has(id)), 'B1 every section lists only included records');
  const review = rep.relevance_review;
  ok(review.length > 0 && review.every((r) => !ids.has(r.project_id) && (r.reason === 'routine_work' || r.reason === 'not_established') && r.rule_version === M.RELEVANCE_RULE_VERSION),
    'B2 excluded records are kept for traceability in relevance_review, with their reason, and are in no customer list', review.length);
  ok(Object.keys(a.renderOnly.distances_mi).every((id) => ids.has(id)) && Object.keys(a.renderOnly.bearings_deg).every((id) => ids.has(id)), 'B3 distances and map directions exist only for included records');
  // an excluded record's ADMINISTRATIVE status change generates no alert: the Watch's "nearby" list is assemble().intelligence.projects
  const kitchen = fx.projects.find((p) => p.source_key.endsWith('7139171-CN'));
  const statusEv = { identity_key: kitchen.source_key, event_type: 'status_changed', material: true, observed_at: '2026-11-01T00:00:00Z', prev_facts: { stage: 'Issued' }, new_facts: { stage: 'Withdrawn' }, changed_fields: ['stage'], publisher_event_type: null, publisher_event_date: null };
  const withEv = assembleWith(fx.projects, { events: fx.events.concat([statusEv]) });
  ok(!withEv.intelligence.projects.some((p) => p.project_id === kitchen.source_key) && !withEv.intelligence.sections.what_changed_recently.includes(kitchen.source_key),
    'B4 an excluded record\'s status change reaches no section and no Watch alert (the Watch reads the included projects only)');
  // a later documented substantive scope change is reassessed on the next assembly
  const rescoped = fx.projects.map((p) => p.source_key === kitchen.source_key ? { ...p, name: 'Multifamily Change of use from condominium unit to restaurant per plan' } : p);
  ok(assembleWith(rescoped).intelligence.projects.some((p) => p.project_id === kitchen.source_key), 'B5 when the record\'s own words later document a substantive change, the next assembly includes it');
  // the view never shows an older report's routine work
  const old = JSON.parse(JSON.stringify(response));
  old.report.projects.push({ project_id: 'OLD-MINOR', name: 'Construct bathroom remodel in unit 2 STFI', scope: { key: 'minor_work', evidence: 'stfi' }, stage: { key: 'approved' }, lifecycle: { key: 'approved', label: 'Approved' }, source: { url: 'https://example.gov/r/1' } });
  old.report.sections.by_stage.approved.push('OLD-MINOR');
  const ho = V.html(old, {});
  ok(!ho.includes('bathroom remodel') && !/Minor Building Work/.test(ho) && V.read(old).total === V.read(response).total, 'B6 an older saved report\'s minor work is in no section, count or map, and there is no Minor Building Work section');
}

// ---- C. lifecycle presentation ---------------------------------------------------------------------------------------------------------------------
{
  const issued = rep.projects.filter((p) => p.stage && p.stage.key === 'permitted');
  ok(issued.length > 0 && issued.every((p) => p.stage.label === 'Permit issued') && M.stageLabel('permitted', { kind: 'under_construction' }) === 'Under construction',
    'C1 an issued permit is labelled "Permit issued", never "Under construction"; only the agency\'s own word for work under way says so');
  ok(/An issued permit does not confirm that construction has started\./.test(html) && !/Permitted \/ Under Construction/.test(html), 'C2 the page says an issued permit does not confirm construction started, and no record reads "Permitted / Under Construction"');
  ok(/Completed \(agency record\)/.test(html) && /does not confirm a building is occupied or a business is open/.test(html) && !/Operating now|Operating \/ Built/.test(html),
    'C3 a completed agency record is "Completed (agency record)", with the note that it does not mean a business is open');
  ok(!/Approved \/ Coming/.test(html) && M.STAGE_LABELS.approved === 'Approved', 'C4 "Approved / Coming" (a prediction) is gone');
  // a stage the agency did not publish (the SEPA register's connector constant) is not asserted
  const sepa = { ...fx.projects.find((p) => p.registry_id === 'wa-ecology-sepa-register'), name: 'Construct new 7-story mixed use building', source_key: 'socrata:data.wa.gov:mmcb-z6jf:TEST1' };
  const rowsS = fx.rows.concat([{ ...fx.rows[0], source_key: sepa.source_key, distance_mi: 0.2 }]);
  const s1 = M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'customer', zip_supported: true, attribution, rows: rowsS, projects: [sepa], ledger: [], events: [], health: [] }).intelligence.projects[0];
  ok(s1 && s1.stage === null && s1.publisher_stage_unpublished === true, 'C5 a record whose source publishes no status is given no stage (the lifecycle came from the connector\'s constant)', s1 && s1.stage);
  // past temporary activity is not presented as upcoming
  const bumb = rep.projects.find((p) => p.project_id.endsWith('7160067-CN'));
  ok(bumb && bumb.stage === null && bumb.relevance.basis === 'temporary_event' && /may already have taken place/.test(html), 'C6 a temporary event with an open status is given no stage and the page says it may already have taken place');
  const ended = M.activityWindow({ start_date: '2026-08-29', end_date: '2026-08-31' }, '2026-11-02');
  ok(ended && ended.ended === true && M.activityWindow({ end_date: '2027-01-01' }, '2026-11-02').ended === false && M.activityWindow({}, '2026-11-02') === null,
    'C7 activity dates the source stated: an end before today is ended; none stated is null');
}

// ---- D. counts, map and table reconcile; records are not projects -------------------------------------------------------------------------------
{
  const m = V.read(response);
  const rows = (html.match(/<tr role="row" data-da-type/g) || []).length;
  const marks = (html.match(/<g class="da-rv-mk /g) || []).length;
  const offmap = (html.match(/data-da-offmap/g) || []).length;
  ok(rows === rep.projects.length && m.total === rep.projects.length, 'D1 one table row per included record', { rows, n: rep.projects.length });
  ok(marks === m.numbered.length && marks + offmap === rows, 'D2 every row is either drawn on the map with a number or says why it is not', { marks, offmap, rows });
  const nums = [...html.matchAll(/class="da-rv-mnum"[^>]*>(\d+)</g)].map((x) => Number(x[1]));
  ok(nums.length === marks && nums.every((n, i) => n === i + 1), 'D3 map numbers run 1..N with no gaps after filtering');
  const brief = (html.match(/data-da-briefing>([\s\S]*?)<\/ul>/) || ['', ''])[1];
  ok(new RegExp(rep.projects.length + ' official records within 0\\.5 miles').test(brief) && /counts of records, not of separate developments/.test(brief), 'D4 the briefing count is the included record count and says records are not developments');
  const counts = [...brief.matchAll(/(\d+) (?:with a permit issued|under construction|approved|proposed \/ under review|decided \(denied or withdrawn\)|with the agency record completed|with no stage stated)/g)].reduce((s, x) => s + Number(x[1]), 0);
  ok(counts === rep.projects.length, 'D5 the stage counts in the briefing add up to the total', { counts, n: rep.projects.length });
  ok(/Also at this address in this report/.test(html) && /may or may not be one development/.test(html), 'D6 records at one address are cross-referenced and never called one development');
  const legend = (html.match(/<ul class="da-rv-legend">([\s\S]*?)<\/ul>/) || ['', ''])[1];
  ok(!/>Approved</.test(legend) && /Proposed \/ Under review/.test(legend), 'D7 the map legend lists only the stages drawn');
}

// ---- E. record-specific notes, titles, categories, freshness, branding -------------------------------------------------------------------------
{
  const qol = [...html.matchAll(/data-da-qol="[^"]+"><span class="da-rv-lab">Quality-of-Life Impact: <\/span>([^<]*)</g)].map((x) => x[1]);
  ok(qol.length === rep.projects.length && qol.every((t) => /^The record (documents|is)/.test(t)), 'E1 every quality-of-life note starts from what the record documents', qol.filter((t) => !/^The record/.test(t)));
  ok(!qol.some((t) => /view|neighborhood activity|added neighborhood/i.test(t)) && !/Not site-verified; no effect is established/.test(html), 'E2 no generic view or neighborhood-activity warning is attached to every record');
  const titles = [...html.matchAll(/<span class="da-rv-name">([^<]*)</g)].map((x) => x[1]);
  // a title cut with an ellipsis ends where a whole word of the record's own text ends (the next character in the full text is not a letter or digit)
  const full = fx.projects.map((p) => String(p.name).replace(/\s+/g, ' '));
  const cut = titles.map((t) => t.replace(/ \(record [^)]+\)$/, '')).filter((t) => t.endsWith('…')).map((t) => t.slice(0, -1).replace(/&amp;/g, '&'));
  const midWord = cut.filter((pre) => { const f = full.find((n) => n.includes(pre)); if (!f) return true; const nx = f[f.indexOf(pre) + pre.length]; return nx !== undefined && /[A-Za-z0-9]/.test(nx); });
  ok(cut.length > 0 && midWord.length === 0 && titles.every((t) => t.length <= 110), 'E3 concise titles are at most ~90 characters and a cut title ends at a whole word', midWord);
  ok(titles.every((t) => !/^(Commercial|Multifamily|Single Family\/Duplex) /.test(t)), 'E4 a title does not repeat the agency\'s class word, which has its own line');
  ok(/Jody type: Residential · Agency category: Multifamily/.test(html), 'E5 the agency\'s category and Jody\'s type are labelled separately');
  ok(/Agency record number:<\/span> 7086944-DM/.test(html) && /Seattle Department of Construction &amp; Inspections/.test(html), 'E6 each record names its agency and record number');
  ok(/Report generated Nov 2, 2026\. Jody last read the official records in this report between Oct 31, 2026 and Nov 1, 2026/.test(html), 'E7 generation time and source freshness are stated separately');
  ok(html.includes('Jody focuses on documented nearby changes relevant to everyday living. Routine interior remodels, individual-unit repairs, and minor maintenance are excluded unless their documented scope identifies a meaningful neighborhood-facing change.'),
    'E8 the coverage note, word for word');
  ok(/Some official records near this property do not describe their work/.test(html) && rep.coverage.undescribed_records === true, 'E9 records whose work is not described are disclosed without a count');
  ok(/https:\/\/jodytracks\.com/.test(html) && !/HomeSignal/.test(html.replace(/<style[\s\S]*?<\/style>/g, '')), 'E10 the report carries https://jodytracks.com and no HomeSignal branding');
  ok(/Most significant nearby changes/.test(html) && /data-da-overview/.test(html), 'E11 the report opens with the most significant documented changes');
  ok(/\.da-rv-frow,\.da-rv-sec--filters \.da-rv-quiet\{display:none!important\}/.test(V.CSS) && /\.da-rv-fnow\{font-size:11\.5px/.test(V.CSS), 'E12 print drops the filter chips and on-screen instructions but keeps the line saying what is shown');
  ok(a.storage_blockers.length === 0, 'E13 the body holds nothing private (boundary check passes)', a.storage_blockers);
}

console.log('\n' + (total - fails) + '/' + total + ' passed');
if (fails) process.exit(1);
