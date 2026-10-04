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
{
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
}

// ---- 1. section order: the 100526 plan's (ruling 3) ----------------------------------------------------------------------------------------------
{
  const FULL = 'changed,activity,filters,review,map,approved,proposed,permitted,history,evidence';
  ok(keysOf(html) === FULL, '1a every section has data: What Changed, Recent Official Activity, Type and stage, Things to Review, the map, the three stages, Change History, Evidence', keysOf(html));
  ok(sections(html).map((s) => s.label).join(' | ') === 'What Changed Around This Property | Recent Official Activity | Type and stage | Things to Review With Your Client | Development Activity Map | Approved / Coming | Proposed / Under Review | Permitted / Under Construction | Change History | Official evidence & coverage',
    '1b the section titles are the plan\'s (ruling 3 and the visual layout contract)', sections(html).map((s) => s.label));
  ok(keysOf(htmlNone) === 'outcome,evidence', '1c an empty report renders only its outcome and Official evidence & coverage', keysOf(htmlNone));
  ok(keysOf(htmlCold) === 'activity,filters,review,map,approved,proposed,permitted,history,evidence', '1d the cold start (no ledger): Recent Official Activity leads, and there is no What Changed section', keysOf(htmlCold));
  const quiet = { rows: [row('q1', 0.4, FAM_A)], projects: [proj('q1', FAM_A, { status: 'Approved', date_kind: 'issued', submitted_at: '2025-02-01', name: 'Quiet Approved Plat' })], ledger: [], events: [], health: [] };
  const hq = view(await wire(quiet));
  ok(keysOf(hq) === 'activity,filters,review,map,approved,proposed,permitted,history,evidence' && /da-rv-hero/.test(sec(hq, 'activity').cls) && metricsOf(sec(hq, 'activity')).join() === 'Records with official activity in the last 90 days=0',
    '1e only an approved record with no recent event: the hero is a measured zero over this report\'s records, then the full layout', keysOf(hq));
  const prop = { rows: [row('p1', 0.4, FAM_B)], projects: [proj('p1', FAM_B, { status: 'Proposed', date_kind: 'scheduled', submitted_at: '2027-02-01', name: 'Planned Retail' })], ledger: [], events: [], health: [] };
  const hp = view(await wire(prop));
  ok(keysOf(hp) === keysOf(hq) && cardsOf(sec(hp, 'proposed').html).length === 1 && cardsOf(sec(hp, 'approved').html).length === 0 && /No projects at this stage in this report\./.test(sec(hp, 'approved').html),
    '1f only a proposed record: it is in Proposed / Under Review, and an empty stage section says so about this report only', keysOf(hp));
  const all = textOf(html) + ' ' + textOf(htmlCold) + ' ' + textOf(htmlNone);
  ok(/What Exists Today/i.test('What Exists Today'), '1g (control) the pattern below can see the words it forbids');
  ok(!/What Exists Today|Exists Today|Nearby Places|Neighborhood Map|Surroundings Map/i.test(all), '1g no What Exists Today and no inventory-style map label anywhere (ruling 3)');
  ok(/Things to Review With Your Client/.test(all) && /Permitted \/ Under Construction/.test(all) && /Development Activity Map/.test(all) && /Compare property/.test(html),
    '1g2 the sections the 100526 plan adds are present: Things to Review, Permitted / Under Construction, the map and the action bar');
  const idx = (t) => html.indexOf('aria-label="' + t + '"');
  const order = ['What Changed Around This Property', 'Recent Official Activity', 'Type and stage', 'Things to Review With Your Client', 'Development Activity Map', 'Approved / Coming', 'Proposed / Under Review',
    'Permitted / Under Construction', 'Change History', 'Official evidence &amp; coverage', 'Report actions'];
  ok(order.every((t, i) => idx(t) > 0 && (i === 0 || idx(t) > idx(order[i - 1]))), '1h the same order, read straight off the markup positions, ending with the action bar', order.map(idx));
  ok(html.startsWith('<article class="da-rv') && html.indexOf('<header') < html.indexOf('<section'), '1i the property / address header comes before every section');
}

// ---- 2. the hero is a change claim ONLY where the ledger proved one ---------------------------------------------------------------------------
{
  const hero = sec(html, 'changed');
  ok(/da-rv-hero/.test(hero.cls) && !/da-rv-hero/.test(sec(html, 'activity').cls), '2a with a detected change, What Changed Recently is the hero and Recent Official Activity is not');
  ok(metricsOf(hero).join() === 'Status changed=1,First detected by HomeSignal=1', '2b the hero counts official records by the ledger\'s own event type (each record once, by its newest event)', metricsOf(hero));
  ok(/Counted as official records\./.test(hero.html) && !/\bprojects?\b/i.test(textOf(hero.html)) && !/\bprojects?\b/i.test(textOf(sec(html, 'activity').html)),
    '2c the unit is "official records"; the word "projects" does not appear in either summary (a source record is not a proven real-world project)');
  const rec = textOf(hero.html.match(/<p class="da-rv-recent">([\s\S]*?)<\/p>/)[1]);
  ok(rec === 'Most recent: Residential — Menchaca Apartments · 0.2 mi · Status changed, detected Sep 27, 2026 · Official record: Issued · Sep 24, 2026',
    '2d the "Most recent" line: Type, name, distance from this response, the change and its detected date, then the publisher event under its own label', rec);
  ok(sec(htmlCold, 'activity') && /da-rv-hero/.test(sec(htmlCold, 'activity').cls) && !sec(htmlCold, 'changed'), '2e with no ledger the hero is Recent Official Activity');
  ok(metricsOf(sec(htmlCold, 'activity')).join() === 'Issued=2,Completed=1,Decided=1,Filed=1', '2f the cold-start counts, by the publisher\'s own event label, in the engine\'s order (newest first)', metricsOf(sec(htmlCold, 'activity')));
  ok(!/What Changed|HomeSignal detected|detected by HomeSignal|Status changed|First detected/.test(textOf(htmlCold)), '2g with no ledger the page carries NO change claim anywhere: a recent publisher date is not a HomeSignal change');
  ok(/What Changed|HomeSignal detected/.test(textOf(html)), '2g (control) the same scan does see a change claim on the page that has detected changes');
  // A response that LISTS a record as changed but carries no detected change for it must not produce the hero
  const lie = clone(WCOLD);
  lie.report.sections.what_changed_recently = ['k-proposed', 'k-decided'];
  const hl = view(lie);
  ok(hl.startsWith('<article') && !sec(hl, 'changed') && !/What Changed Recently/.test(hl), '2h a record named in what_changed_recently WITHOUT a detected change does not make a change hero (and the view still renders the report)');
  const strip = clone(W);
  strip.report.projects.forEach((p) => { delete p.homesignal_detected_changes; });
  ok(!sec(view(strip), 'changed'), '2i and a report whose projects carry no detected changes has no change hero, whatever the section list says');
  ok(/Official record:<\/span> Issued · Sep 24, 2026/.test(sec(html, 'approved').html) && /HomeSignal detected:<\/span> Status changed · Sep 27, 2026/.test(sec(html, 'approved').html),
    '2j on a card the publisher event and the HomeSignal-detected change sit under SEPARATE labels');
  // a record with two detected changes is counted once, by its NEWEST, and its card names that one; the history lists both, newest first
  const two = clone(W);
  two.report.projects.find((p) => p.project_id === 'k-approved').homesignal_detected_changes.push({ event_type: 'first_detected', detected_at: '2026-09-20T08:00:00Z', publisher_event: null, changes: [] });
  const h2 = view(two);
  ok(metricsOf(sec(h2, 'changed')).join() === 'Status changed=1,First detected by HomeSignal=1', '2k a record with two detected changes is counted ONCE, under its newest', metricsOf(sec(h2, 'changed')));
  ok(/HomeSignal detected:<\/span> Status changed \u00b7 Sep 27, 2026/.test(sec(h2, 'approved').html) && !/HomeSignal detected:<\/span>[^<]*Sep 20, 2026/.test(sec(h2, 'approved').html), '2k its card names the newest change only');
  const t2 = textOf(sec(h2, 'history').html);
  ok(t2.indexOf('Status changed \u00b7 detected Sep 27, 2026') > -1 && t2.indexOf('Status changed \u00b7 detected Sep 27, 2026') < t2.indexOf('First detected by HomeSignal \u00b7 detected Sep 20, 2026'), '2k and Change History lists both, in the engine\'s order (newest first)');
}

// ---- 3. lifecycle: text plus a shape on every card; Proposed is never "coming" ---------------------------------------------------------------------
{
  const all = [...cardsOf(html), ...cardsOf(htmlCold), ...cardsOf(htmlInt)];
  ok(all.length >= 20, '3a there are cards to check (positive control: ' + all.length + ')');
  ok(all.every((c) => /<span class="da-rv-lifetext">[^<]+<\/span>/.test(c) && /<svg class="da-rv-shape"/.test(c)), '3b EVERY card carries a lifecycle text label AND a shape');
  const byTitle = Object.fromEntries(cardsOf(htmlLife).map((c) => [cardTitle(c), c]));
  // a stage card states the lifecycle on its own labelled line (when the caller asks for it); a summary row carries it on the badge
  const life = (t) => { const c = byTitle[t]; const m = /HomeSignal lifecycle:<\/span> ([^<]+)<\/p>/.exec(c) || /<span class="da-rv-lifetext">([^<]+)<\/span>/.exec(c); return decode(m[1]); };
  ok(life('Menchaca Apartments') === 'Approved' && life('Riverside Retail Center') === 'Proposed' && life('Oak Grove Townhomes') === 'Proposed'
    && life('Highway 99 Widening') === 'Operating / built' && life('Fire Station 12') === 'Lifecycle unknown', '3c the label is the engine\'s own lifecycle label, verbatim, for all four lifecycles');
  // the HomeSignal Type chip is the engine's own Type label, on every card, and absent where the engine sent no Type
  const typeByName = Object.fromEntries(W.report.projects.map((p) => [p.name, p.type]));
  const chipOf = (c) => { const m = /<span class="da-rv-tag da-rv-type">([^<]*)<\/span>/.exec(c); return m ? decode(m[1]) : null; };
  const cards = cardsOf(html);
  ok(cards.length === 8 && cards.every((c) => chipOf(c) === (typeByName[cardTitle(c)] ? typeByName[cardTitle(c)].label : null)) && cards.filter((c) => chipOf(c)).length >= 6,
    '3c2 every card shows the engine\'s own Type label as its chip (and the labels are real: ' + [...new Set(cards.map(chipOf))].join(', ') + ')');
  const noType = clone(W);
  noType.report.projects.find((p) => p.project_id === 'k-approved').type = null;
  ok(chipOf(cardsOf(view(noType)).find((c) => cardTitle(c) === 'Menchaca Apartments')) === null && /Most recent: Menchaca Apartments/.test(textOf(view(noType))), '3c3 a record the engine gave no Type shows no chip, and no invented "Other project"');
  const shapeOf = (t) => /<svg class="da-rv-shape"[^>]*>(.*?)<\/svg>/.exec(byTitle[t])[1];
  const shapes = new Set([shapeOf('Menchaca Apartments'), shapeOf('Riverside Retail Center'), shapeOf('Highway 99 Widening'), shapeOf('Fire Station 12')]);
  ok(shapes.size === 4, '3d the four lifecycles are four DIFFERENT shapes (not a colour change on one shape)');
  ok(/stroke-dasharray/.test(shapeOf('Riverside Retail Center')) && /fill="none"/.test(shapeOf('Riverside Retail Center')) && !/fill="none"/.test(shapeOf('Menchaca Apartments')),
    '3e Proposed is a dashed hollow outline and Approved is solid: a Proposed item does not look as certain as an Approved one');
  const prop = sec(html, 'proposed').html;
  ok(!/coming/i.test(prop) && !/Approved \/ Coming/.test(prop), '3f nothing in the Proposed section says "coming" or "Approved / Coming"');
  ok(/coming/i.test(textOf(html)) && !/coming/i.test(textOf(html).replace(/Approved \/ Coming/gi, '')), '3g "coming" appears nowhere except in the stage name Approved / Coming (and it does appear there: control)', textOf(html).replace(/Approved \/ Coming/gi, '').match(/.{20}coming.{20}/i));
  ok(cardsOf(sec(html, 'proposed').html).map(cardTitle).join() === 'Oak Grove Townhomes,Lakeline Medical Office,Riverside Retail Center,Planned Bridge Replacement',
    '3h Decided is in the Proposed section as the engine put it (lifecycle proposed), and the cards follow the engine\'s order');
  ok(/Publisher status:<\/span> Decided/.test(byTitle['Oak Grove Townhomes']), '3i the publisher\'s own word "Decided" is shown verbatim beside the lifecycle');
  ok(/Publisher status:<\/span> On file/.test(byTitle['Fire Station 12']), '3j an unknown-lifecycle record shows "Lifecycle unknown" and the publisher\'s own status, never a guessed stage');
  ok(!cardsOf(sec(html, 'approved').html).some((c) => /Highway 99|Fire Station/.test(c)) && !cardsOf(sec(html, 'proposed').html).some((c) => /Highway 99|Fire Station/.test(c)),
    '3k operating and unknown records are in NO stage section (the default for open decision 3)');
  ok(/Highway 99 Widening/.test(sec(html, 'activity').html) && /Fire Station 12/.test(sec(html, 'activity').html), '3l they are named in Recent Official Activity instead, where their recent event is');
  ok(!/Quiet Operating Plant/.test(html) && /Quiet Operating Plant/.test(JSON.stringify(RICH.projects)), '3m an operating record with no event is not on the page (the engine keeps it out; R3), and it was in the input (control)');
  {
    // The quiet UNKNOWN record (found by the independent review): an unknown-lifecycle record with no recent event and no detected change is INCLUDED by
    // the engine and drawn nowhere by this step. That is a recorded decision (open decision 3 in the design doc), not an accident, so it is pinned here
    // in both halves: the engine has it, the view omits it, and the page makes no claim that there was nothing to show.
    const WQ = await wire({ ...RICH, rows: [row('k-unk-quiet', 0.4, FAM_B)], projects: [proj('k-unk-quiet', FAM_B, { name: 'Quiet Unknown Record', type: 'Civic/Public', status: 'On file', date_kind: 'scheduled', submitted_at: '2027-01-01' })], ledger: [], events: [] });
    const hq = view(WQ);
    ok(WQ.status === 'OK' && WQ.coverage_state === 'REPORT_READY' && WQ.report.projects.some((p) => p.name === 'Quiet Unknown Record') && WQ.report.sections.by_lifecycle.unknown.length === 1,
      '3p-engine the engine INCLUDES a quiet unknown-lifecycle record (REPORT_READY, listed in projects and in by_lifecycle.unknown): this is what the view is judged against');
    ok(!/Quiet Unknown Record/.test(hq) && keysOf(hq) === 'activity,approved,proposed,permitted,history,evidence',
      '3p-view a quiet unknown record is drawn in no stage section (100526: an unknown lifecycle is never forced into Proposed or Approved); the layout around it renders', keysOf(hq));
    ok(!/no development activity|nothing to show|no records (found|nearby)|no projects (found|nearby|near|around|within)/i.test(textOf(hq)),
      '3p-claim and the page makes no area-wide absence claim over it: an empty stage says "No projects at this stage in this report", about the report only');
  }
  // the view follows the engine's key, not the publisher's word
  const doctored = clone(W);
  doctored.report.projects.find((p) => p.project_id === 'k-approved').lifecycle = { key: 'unknown', label: 'Lifecycle unknown' };
  const dc = Object.fromEntries(cardsOf(viewLife(doctored)).map((c) => [cardTitle(c), c]));
  ok(/HomeSignal lifecycle:<\/span> Lifecycle unknown/.test(dc['Menchaca Apartments']) && /Publisher status:<\/span> Approved/.test(dc['Menchaca Apartments']), '3n a card shows the lifecycle the engine sent even when the publisher status says otherwise: the view re-derives nothing');
  const odd = clone(W);
  odd.report.projects.find((p) => p.project_id === 'k-approved').lifecycle = { key: 'weird" onmouseover="x', label: '' };
  const oh = viewLife(odd);
  ok(!/onmouseover/.test(oh) && /HomeSignal lifecycle:<\/span> Lifecycle unknown/.test(oh), '3o an unrecognised lifecycle key is shown as unknown and never reaches a class or attribute');
}

// ---- 4. nothing internal reaches the page ----------------------------------------------------------------------------------------------------------
{
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
  ok(htmlInt.includes('Menchaca Apartments') && cardsOf(htmlInt).length >= 8, '4d the internal-view response renders its records like any other, with no internal label (the caller owns any "internal" framing)');
  const risky = /project|source|family|registry|hold|clear|hash|blocker/i;
  ok(attrs(html).every(([k, v]) => !risky.test(k + ' ' + v) || k === 'href'),
    '4e no attribute name or value carries an id, a family, a registry value or a rights word (links excepted)', attrs(html).filter(([k, v]) => risky.test(k + ' ' + v) && k !== 'href').slice(0, 5));
  ok(attrs(html).length > 40, '4e (control) there were attributes to scan (' + attrs(html).length + ')');
  const ALLOWED_ATTRS = new Set(['class', 'aria-label', 'aria-hidden', 'data-lifecycle', 'href', 'target', 'rel', 'viewBox', 'width', 'height', 'focusable', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'cx', 'cy', 'r', 'x', 'y', 'rx', 'd',
    // the 100526 layout: stage badges, the filters, the map, the action bar
    'data-stage', 'data-da-type', 'data-da-stage', 'data-da-filter', 'data-da-value', 'aria-pressed', 'type', 'role', 'scope', 'transform', 'text-anchor', 'dy', 'aria-disabled', 'hidden']);
  const seen = new Set(Object.values(outputs).flatMap((o) => attrs(o).map(([k]) => k)));
  ok([...seen].every((k) => ALLOWED_ATTRS.has(k)) && seen.has('data-lifecycle') && seen.has('href'), '4e2 the only attribute NAMES that ever appear are the closed set of presentation ones: no id, no data-id, no title, no style, no other data-*', [...seen].filter((k) => !ALLOWED_ATTRS.has(k)));
  ok(!/<(script|iframe|object|embed|form|input|img|select|textarea)\b/i.test(html) && !/\son[a-z]+=/i.test(html), '4f the output has no script, frame, form, input or event-handler attribute');
  const buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1]);
  ok(buttons.length > 0 && buttons.every((b) => /\stype="button"/.test(b)), '4f2 its only controls are type="button" buttons (the filters and the action bar), so nothing submits anywhere', buttons.length);
}

// ---- 5. coverage: the engine's own words, never "no activity" ------------------------------------------------------------------------------------
{
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
    ok(!DIST.test(textOf(h)) && cardsOf(h).length >= 8, '5j ' + name + ': no distance anywhere, and the cards still render');
  }
  ok(/Under 0\.1 mi/.test(textOf(view({ ...clone(W), render: { distances_mi: { 'k-approved': 0.04 } } }))), '5k a distance under a tenth of a mile is shown as such, not as 0.0');
  const wh = await wire({ ...RICH, health: [{ registry_id: FAM_A, fetch_failures_24h: 2, blocked_24h: 0, truncated_24h: 0 }] });
  ok(wh.report.coverage.limitations.some((l) => l.code === 'SOURCE_NOT_FULLY_READ') && /<li>One or more official sources for this area could not be fully read recently\.<\/li>/.test(view(wh)),
    '5l a source that could not be fully read is disclosed in the engine\'s words');
}

// ---- 6. escaping, links, and the address ----------------------------------------------------------------------------------------------------
{
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
    && hi.includes('<span class="da-rv-tag da-rv-type">&lt;b&gt;Residential&lt;/b&gt;</span>') && hi.includes('&lt;svg onload=alert(1)&gt;') && hi.includes('742 &quot;Evergreen&quot; &lt;b&gt;Terrace&lt;/b&gt;'), '6b and the text is there, escaped, not dropped');
  ok(attrs(hi).length > 40 && attrs(hi).every(([k]) => !/^on/i.test(k)), '6c no attribute named on* exists in the output');
  const hero = clone(W); hero.report.projects.find((p) => p.project_id === 'k-op').name = evil;
  const hh = view(hero);
  ok(!/<script/.test(hh) && /<h3 class="da-rv-title">&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h3>/.test(sec(hh, 'activity').html),
    '6c2 a hostile name on a record the hero lists outside the stage sections (an operating record with a recent event) is escaped too');
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
  ok(real.length === nLinks && inTable > 0 && real.length === 11 + inTable && real.every((m) => /^https?:\/\//.test(m[1])), '6f every link on a normal report is http(s), opens in a new tab, with noopener noreferrer (8 cards and 3 review items: 11, plus one per table row that has a link: ' + inTable + ')', [real.length, inTable]);
  ok(/Official source <span aria-hidden="true">→<\/span><span class="da-rv-sr"> for Menchaca Apartments \(opens in a new tab\)<\/span>/.test(html), '6g a link\'s accessible name carries the record it belongs to');
  const subj = '742 Evergreen Terrace, Springfield, OR 97477';
  const hs = V.html(W, { subject: subj });
  ok(hs.split(subj).length - 1 === 1 && /<p class="da-rv-addr">742 Evergreen Terrace, Springfield, OR 97477<\/p>/.test(hs), '6h the caller\'s address appears exactly once, as the header text');
  ok(attrs(hs).every(([, v]) => !/742|Evergreen|Springfield|97477/i.test(v)) && !/href="[^"]*(742|Evergreen)/i.test(hs), '6i it appears in no attribute value of any kind: not an href, data-*, id, class or aria-label, and in no URL');
  const addrXss = V.html(W, { subject: '"><script>alert(1)</script>' });
  ok(!/<script/.test(addrXss) && addrXss.includes('&quot;&gt;&lt;script&gt;'), '6j a hostile address string is escaped');
  ok(/<p class="da-rv-addr">Address unavailable<\/p>/.test(V.html(W)) && /Address unavailable/.test(V.html(W, { subject: '   ' })) && /Address unavailable/.test(V.html(W, { subject: 42 })), '6k no address supplied (a purged report): the header says "Address unavailable" and shows nothing else');
  const attr = Object.fromEntries(cardsOf(html).map((c) => [cardTitle(c), /<p class="da-rv-attr">([^<]*)<\/p>/.exec(c)?.[1] ?? null]));
  ok(attr['Menchaca Apartments'] === 'Data: WSDOT' && attr['Riverside Retail Center'] === null, '6l a cleared source\'s attribution is shown with its record, and a record with none shows none', attr);
}

// ---- 7. it shows what the engine gave, in the order it gave it, and changes nothing --------------------------------------------------------------------
{
  const before = JSON.stringify(W);
  const a = view(W), b = view(W);
  ok(JSON.stringify(W) === before && a === b, '7a the view does not mutate the response and gives the same output twice');
  const rev = clone(W);
  rev.report.sections.recent_official_activity = rev.report.sections.recent_official_activity.slice().reverse();
  rev.report.sections.by_stage.proposed = rev.report.sections.by_stage.proposed.slice().reverse();
  const hr = view(rev);
  ok(cardsOf(sec(hr, 'proposed').html).map(cardTitle).join() === 'Planned Bridge Replacement,Riverside Retail Center,Lakeline Medical Office,Oak Grove Townhomes', '7b the view sorts nothing: a reversed engine list is a reversed section');
  const recentLine = (sct) => textOf(/<p class="da-rv-recent">([\s\S]*?)<\/p>/.exec(sct.html)[1]);
  ok(/^Most recent: .*Highway 99 Widening/.test(recentLine(sec(html, 'activity'))) && /^Most recent: .*Riverside Retail Center/.test(recentLine(sec(hr, 'activity'))),
    '7c and the "Most recent" line follows the engine\'s first entry, not its own ranking (normal: the engine\'s first is Highway 99; reversed: Riverside)', [recentLine(sec(html, 'activity')), recentLine(sec(hr, 'activity'))]);
  const ghost = clone(W);
  ghost.report.sections.by_stage.approved.push('no-such-project', 'k-approved');
  ok(cardsOf(sec(view(ghost), 'approved').html).length === 2, '7d an id the report does not carry is skipped, and a repeated id is shown once');
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
  ok(textOf(sec(view(ready), 'history').html) === 'Change History HomeSignal recorded no status change for the projects in this report in the last 90 days.' && ready.report.coverage.change_ready === true,
    '7j2 once HomeSignal has observed them twice, it says it recorded no status change in the window (the ledger\'s own readiness)');
  const unk = clone(W);
  unk.report.projects.find((p) => p.project_id === 'k-first').homesignal_detected_changes[0].event_type = 'brand_new_type';
  unk.report.projects.find((p) => p.project_id === 'k-first').homesignal_detected_changes[0].changes[0].field = 'some_new_field';
  const hu = textOf(view(unk));
  ok(!/brand_new_type|some_new_field/.test(hu) && /Change detected/.test(hu) && /Some new field/.test(hu), '7k an event type outside the ledger\'s vocabulary is never printed raw; an unknown field is shown as plain words');
  ok(/Within 0\.5 miles · ZIP 97477 · As of Sep 29, 2026/.test(textOf(html)) && /Recent means the last 90 days before Sep 29, 2026\./.test(textOf(html)),
    '7l the header and the evidence section state the radius, the ZIP, the as-of day and what "recent" means, from the report\'s own fields');
  ok(textOf(html).startsWith('HOMESIGNAL DEVELOPMENT ACTIVITY 742 Evergreen Terrace'), '7m the eyebrow is HOMESIGNAL DEVELOPMENT ACTIVITY (ruling R6), then the property');
}

// ---- 8. a response that is not a report ------------------------------------------------------------------------------------------------------------------
{
  const junk = [undefined, null, 5, 'x', [], {}, { status: 'OK' }, { status: 'OK', report: {} }, { status: 'OK', report: { projects: [], sections: null } }, { status: 'ADDRESS_NOT_RESOLVED', report: null, stored: false },
    { status: 'OUTSIDE_COVERAGE', zip: '99999', report: null, stored: false }, { status: 'error' }];
  let threw = false, outs = [];
  try { outs = junk.map((j) => V.html(j, { subject: ADDRESS })); } catch (e) { threw = String(e); }
  ok(!threw && outs.length === junk.length && outs.every((o) => o === ''), '8a a response that carries no report renders as an empty string and never throws (the caller owns those messages)', threw || outs);
  ok(junk.every((j) => V.renderable(j) === false) && V.renderable(W) === true, '8b renderable() says so, and is true for a real report');
  const sparse = { status: 'OK', report: { as_of: '2026-09-29', projects: [{ project_id: 'a' }, null, 7, { project_id: 5 }], sections: { what_changed_recently: ['a'], recent_official_activity: 'a', by_lifecycle: { approved: ['a'], proposed: null } } } };
  let t2 = false, hs = '';
  try { hs = V.html(sparse, { showLifecycle: true }); } catch (e) { t2 = String(e); }
  ok(!t2 && /Unnamed record/.test(hs) && /Lifecycle unknown/.test(hs) && !/<a\b/.test(hs) && keysOf(hs) === 'activity,filters,approved,proposed,permitted,history,evidence' && cardsOf(sec(hs, 'approved').html).length === 1,
    '8c a sparse or malformed report (an older one, with only by_lifecycle) still renders what it can: an unnamed record in Approved, an unknown lifecycle, no link, no claim', t2 || keysOf(hs));
}

// ---- 9. the words are the plan's, quoted from the plan ------------------------------------------------------------------------------------------------------
{
  const plan = readFileSync(join(root, 'docs/development-activity-plan-2026-09-30.md'), 'utf8');
  const quote = (needle) => { const l = plan.split('\n').find((x) => x.includes(needle)); return l ? l.replace(/^>\s*/, '').replace(/\*\*/g, '').trim() : null; };
  ok(V.DISCLOSURE === quote('HomeSignal summarizes selected official public records'), '9a the standard disclosure is the plan\'s sentence, word for word (plan line 1763)', quote('HomeSignal summarizes selected official public records'));
  ok(V.SCOPE_LINE === quote('Planned, approved, permitted and changing development found in'), '9b the scope line is the plan\'s (line 1261)');
  ok(V.SCOPE_NOTE === quote('This report focuses on development activity and change.'), '9c the supporting scope note is the plan\'s (line 1265)');
  ok(V.EYEBROW === 'HOMESIGNAL DEVELOPMENT ACTIVITY' && V.EYEBROW === M.PRODUCT_NAME, '9d the eyebrow equals the engine\'s product name (ruling R6)');
  ok(JSON.stringify(Object.values(V.TITLES)) === JSON.stringify(['What Changed Around This Property', 'Recent Official Activity', 'Type and stage', 'Things to Review With Your Client', 'Development Activity Map',
    'Approved / Coming', 'Proposed / Under Review', 'Permitted / Under Construction', 'Change History', 'Official evidence & coverage', 'Report actions']), '9e the section titles, in the 100526 plan\'s order');
  const p100526 = readFileSync(join(root, 'docs/development-activity-plan-100526.md'), 'utf8');
  ok(['WHAT CHANGED AROUND THIS PROPERTY', 'THINGS TO REVIEW WITH YOUR CLIENT', 'DEVELOPMENT ACTIVITY MAP', 'APPROVED / COMING', 'PROPOSED / UNDER REVIEW', 'PERMITTED / UNDER CONSTRUCTION', 'CHANGE HISTORY'].every((t) => p100526.includes(t))
    && ['changed', 'review', 'map', 'approved', 'proposed', 'permitted', 'history'].every((k) => p100526.includes(V.TITLES[k].toUpperCase())), '9f each of those titles is written, in capitals, in the 100526 plan');
}

// ---- 10. the 100526 layout: Permitted / Under Construction, the filters, Things to Review, the map, the header and the action bar ------------------
{
  // the 84302 shape, read from production 2026-10-02: UDOT Main Street projects whose own stage says "Under Construction"
  const PERMIT = { rows: [row('u1', 0.12, FAM_A), row('u2', 0.18, FAM_A, { marker_lat: 44.04612 - 0.18 / 69.05 }), row('u3', 0.32, FAM_B), row('u4', 0.45, FAM_B), row('u5', 0.05, FAM_A)],
    projects: [proj('u1', FAM_A, { name: 'SR-13 (Main St) & 100 North', type: 'Utility', status: 'Approved', stage: 'Under Construction', date_kind: 'filed', submitted_at: '2024-08-26' }),
      proj('u2', FAM_A, { name: 'SR-13 (Main St) & 100 South', type: 'Utility', status: 'Approved', stage: 'Under Construction', date_kind: 'filed', submitted_at: '2024-08-26' }),
      proj('u3', FAM_B, { name: 'Townhome plat', type: 'Residential', status: 'Approved', stage: 'Recorded', date_kind: 'filed', submitted_at: '2024-01-01' }),
      proj('u4', FAM_B, { name: 'Rezone request', type: 'Commercial', status: 'Proposed', stage: null, date_kind: 'filed', submitted_at: '2024-01-01' }),
      proj('u5', FAM_A, { name: 'Closed-out paving', type: 'Utility', status: 'Operating', stage: 'Close Out', date_kind: 'filed', submitted_at: '2023-01-26' })],
    ledger: [], events: [], health: [] };
  const WP = await wire(PERMIT);
  const hp = V.html(WP, { subject: '20 N Main St, Brigham City, UT 84302', label: 'Smith buyers', brokerage: 'ABC Realty', agent: 'Pat Agent' });
  ok(JSON.stringify(WP.report.sections.by_stage) === JSON.stringify({ approved: ['u3'], proposed: ['u4'], permitted: ['u1', 'u2'] }), '10a (engine) the two Under Construction records are Permitted; the plat is Approved; the closed-out record is in no stage', WP.report.sections.by_stage);
  const pc = cardsOf(sec(hp, 'permitted').html);
  ok(pc.length === 2 && pc.every((c) => /data-stage="permitted"/.test(c) && /Permitted \/ Under Construction<\/span>/.test(c) && !/HomeSignal lifecycle/.test(c) && /Publisher stage:<\/span> Under Construction/.test(c)
    && /Why it is in this section:<\/span> The publisher&#39;s stage says under construction\./.test(c)),
    '10b a Permitted card shows the stage first (text and shape), the publisher\'s own stage and why it is in the section, and NO "HomeSignal lifecycle" line in the customer view (it reads as a contradiction beside "Under Construction")');
  const hpL = V.html(WP, { subject: '20 N Main St, Brigham City, UT 84302', showLifecycle: true });
  const pcL = cardsOf(sec(hpL, 'permitted').html);
  ok(pcL.length === 2 && pcL.every((c) => /HomeSignal lifecycle:<\/span> Approved/.test(c) && /Publisher stage:<\/span> Under Construction/.test(c)) && !/HomeSignal lifecycle/.test(hp) && /HomeSignal lifecycle/.test(hpL),
    '10b2 (control) the internal view (opts.showLifecycle) still shows the canonical lifecycle, still Approved, beside the publisher\'s stage; the engine\'s value is unchanged and only the customer view leaves the line out');
  ok(!/Closed-out paving/.test(hp), '10c the closed-out record (operating, no recent event) is on no part of the page (ruling 3: no standing inventory)');
  const shapeOfStage = (k) => (new RegExp('data-stage="' + k + '"><svg class="da-rv-shape"[^>]*>(.*?)</svg>').exec(hp) || [, ''])[1];
  ok(/<rect/.test(shapeOfStage('permitted')) && /<circle[^>]*fill="currentColor"/.test(shapeOfStage('approved')) && /stroke-dasharray/.test(shapeOfStage('proposed')),
    '10d the three stages are three shapes: a solid square, a solid circle and a dashed hollow circle');

  // the filters
  const f = sec(hp, 'filters').html;
  const chips = [...f.matchAll(/<button type="button" class="da-rv-chip" data-da-filter="(\w+)" data-da-value="(\w+)" aria-pressed="(true|false)">([^<]*)(?: <span class="da-rv-chipn">(\d+)<\/span>)?<\/button>/g)]
    .map((m) => m[1] + ':' + m[2] + ':' + m[3] + ':' + decode(m[4]).trim() + ':' + m[5]);
  ok(chips.join('|') === 'type:all:true:All:4|type:residential:false:Residential:1|type:commercial:false:Commercial:1|type:infrastructure:false:Roads & infrastructure:2|stage:all:true:All:4|stage:approved:false:Approved / Coming:1|stage:proposed:false:Proposed / Under Review:1|stage:permitted:false:Permitted / Under Construction:2',
    '10e without the Type authority loaded, Type chips are the types this report has (in the plan\'s order, with the engine\'s labels); Stage chips are always the three, with counts; All is pressed', chips);
  const sbx = { window: {} };
  runInNewContext(readFileSync(join(root, 'lib/project-type.js'), 'utf8'), sbx);
  runInNewContext(readFileSync(join(root, 'lib/da-report-view.js'), 'utf8'), sbx);
  const hpr = sbx.window.HS.daReportView.html(WP, { subject: 'x y' });
  const typeChips = [...sec(hpr, 'filters').html.matchAll(/data-da-filter="type" data-da-value="(\w+)"[^>]*>([^<]*)/g)].map((m) => m[1] + '=' + decode(m[2]).trim());
  ok(typeChips.join('|') === 'all=All|residential=Residential|commercial=Commercial|industrial=Industrial|datacenter=Data center|infrastructure=Roads & infrastructure|civic=Civic & public',
    '10f with lib/project-type.js loaded, the Type chips are the plan\'s six in its order, labelled by the canonical Type authority (no "Regulated facility", no "Other project" when there is none)', typeChips);
  ok(!/facility|Regulated/i.test(sec(hpr, 'filters').html) && !/regulat/i.test(chips.join()), '10g Regulatory is never a Type or Stage filter (ruling 1)');
  const cardData = [...hp.matchAll(/<article class="da-rv-card" data-da-type="(\w+)" data-da-stage="(\w+)">/g)].map((m) => m[1] + '/' + m[2]);
  ok(cardData.sort().join() === 'commercial/proposed,infrastructure/permitted,infrastructure/permitted,residential/approved', '10h every stage card carries the Type and Stage the filters match on, taken from the engine', cardData);

  // Things to Review
  const rv = sec(hp, 'review').html;
  const items = rv.split('<li class="da-rv-rev">').slice(1);
  ok(items.length === 3 && WP.render.review.join() === 'u1,u2,u3' && items.map((i) => decode(/<h3 class="da-rv-title">([^<]*)<\/h3>/.exec(i)[1])).join('|') === 'SR-13 (Main St) & 100 North|SR-13 (Main St) & 100 South|Townhome plat',
    '10i Things to Review lists the engine\'s three, in its order (nearest first); the view ranks nothing', WP.render.review);
  ok(textOf(items[0]).startsWith('0.1 mi · Roads & infrastructure · PERMITTED / UNDER CONSTRUCTION SR-13 (Main St) & 100 North Publisher stage: Under Construction. Review: Verify the official schedule and project details at the source.')
    && /Review:<\/span> Verify the published project details and the official construction timing\./.test(items[2]), '10j each item: distance, Type and stage, the publisher\'s own words, a review line in the plan\'s wording, and the official source', textOf(items[0]));
  ok(/not a prediction of any effect on the property/.test(rv) && !/(value|traffic|noise|appreciat|desirab|impact on)/i.test(textOf(rv)), '10k "Review" is said to be a prompt to read the record, never a predicted effect (no value, traffic or desirability claim)');
  const noRev = clone(WP); delete noRev.render.review;
  ok(!sec(V.html(noRev, {}), 'review'), '10l a response with no review list (a reopened report has no distances) shows no Things to Review rather than guessing an order');

  // the map
  const mp = sec(hp, 'map').html;
  const marks = [...mp.matchAll(/<g class="da-rv-mk da-rv-mk--(\w+)" data-da-type="(\w+)" data-da-stage="(\w+)" transform="translate\(([\d.]+) ([\d.]+)\)"><title>([^<]*)<\/title>[\s\S]*?<text[^>]*>(\d+)<\/text><\/g>/g)]
    .map((m) => ({ k: m[1], x: Number(m[4]), y: Number(m[5]), title: decode(m[6]), n: m[7] }));
  ok(marks.length === 4 && marks.map((m) => m.n).join() === '1,2,3,4', '10m the map marks every staged project with a number, in the order of the cards below', marks.map((m) => m.n + ':' + m.title));
  const byTitleN = Object.fromEntries(marks.map((m) => [m.title.replace(/^\d+: /, '').split(' · ')[0], m]));
  ok(byTitleN['SR-13 (Main St) & 100 North'].y < 180 && byTitleN['SR-13 (Main St) & 100 South'].y > 180 && Math.abs(byTitleN['SR-13 (Main St) & 100 North'].y - (180 - 0.12 / 0.5 * 150)) < 1,
    '10n north is up and distance is to scale: 0.12 mi north sits 36 of 150 units above the property, and the southern record sits below it', byTitleN['SR-13 (Main St) & 100 North']);
  const cardNums = [...hp.matchAll(/<h3 class="da-rv-title">([^<]*)<\/h3><div class="da-rv-tags">[\s\S]*?<span class="da-rv-tag da-rv-num">Map (\d+)<\/span>/g)].map((m) => decode(m[1]) + '=' + m[2]);
  ok(cardNums.length === 4 && cardNums.every((c) => { const [t, n] = c.split('='); return byTitleN[t] && byTitleN[t].n === n; }), '10o each card\'s "Map n" is the number of its marker', cardNums);
  ok(/Only tracked development activity is shown\./.test(mp) && /Distance is to scale; direction is approximate/.test(mp) && /<circle cx="180" cy="180" r="150" class="da-rv-ring"\/>/.test(mp) && /0\.5 mi<\/text>/.test(mp),
    '10p the map says what it is (tracked development only), draws the 0.5-mile report radius, and says what is to scale');
  ok(!/https?:|tile|basemap|<image\b|xlink/i.test(mp), '10q no street map, tile or external image: nothing on the map needs a provider that is not cleared');
  const noDir = clone(WP); noDir.render.bearings_deg = {};
  ok(!sec(V.html(noDir, {}), 'map') && cardsOf(V.html(noDir, {})).length >= 4, '10r with no directions in the response, the map is left out (never drawn from a guess) and the cards still render');

  // header and action bar
  const hd = /<header class="da-rv-head">([\s\S]*?)<\/header>/.exec(hp)[1];
  ok(/<p class="da-rv-who">ABC Realty · Pat Agent<\/p>/.test(hd) && /<p class="da-rv-label">Smith buyers<\/p>/.test(hd) && /<p class="da-rv-gen">Generated Sep 29, 2026<\/p>/.test(hd),
    '10s the header carries the brokerage and agent, the client label and the generated date, when the caller supplies them');
  ok(!/da-rv-who|da-rv-label/.test(V.html(WP, { subject: 'x y' })) && /<p class="da-rv-gen">/.test(V.html(WP, { subject: 'x y' })), '10t and invents none of them when it does not');
  ok(V.html(WP, { subject: 'a b', brokerage: '<b>ABC</b>', label: '"><script>' }).includes('&lt;b&gt;ABC&lt;/b&gt;') && !V.html(WP, { subject: 'a b', label: '"><script>' }).includes('<script>'), '10u brokerage, agent and label are escaped like everything else');
  const acts = [...hp.matchAll(/<button type="button" class="da-rv-act" aria-disabled="true">([^<]*)<\/button>/g)].map((m) => m[1]);
  ok(acts.join('|') === 'Compare property|Watch property|Share report|Download PDF' && /Available soon/.test(hp) && hp.lastIndexOf('da-rv-actions') > hp.lastIndexOf('da-rv-sec--evidence'),
    '10v the action bar is last, its four actions are switched off, and it says they are not available yet', acts);
  ok(!/da-rv-actions|da-rv-act\b/.test(htmlNone) && !/da-rv-actions/.test(view(WNONE, '')), '10v2 a report with no records has no action bar: there is nothing to compare, watch, share or print');

  // what the hero and the filters say
  ok(/<p class="da-rv-onrecord">On the record within 0\.5 miles: 2 permitted \/ under construction · 1 approved \/ coming · 1 proposed \/ under review\.<\/p>/.test(hp),
    '10w the hero\'s summary line counts each stage section exactly (2 permitted, 1 approved, 1 proposed)');
  ok(/The filters change what is shown on the map and in the three stage sections\. They do not change the report\./.test(sec(hp, 'filters').html), '10x the filters say they change what is shown, never the report');

  // map shapes match the stage shapes
  const markShape = (k) => (new RegExp('<g class="da-rv-mk da-rv-mk--' + k + '"[^>]*>(?:<title>[^<]*</title>)?(<(?:rect|circle)[^>]*>)').exec(mp) || [, ''])[1];
  ok(/^<rect /.test(markShape('permitted')) && /^<circle /.test(markShape('approved')) && /^<circle [^>]*stroke-dasharray/.test(markShape('proposed')) && !/stroke-dasharray/.test(markShape('approved')),
    '10y on the map a permitted project is a square, an approved one a solid circle and a proposed one a dashed circle, as in the legend and on the cards', [markShape('permitted'), markShape('approved'), markShape('proposed')]);

  // the view shows each record where the ENGINE put it, once, and only where the record's own stage agrees
  const moved = clone(WP);
  moved.report.sections.by_stage.approved = []; moved.report.sections.by_stage.permitted = ['u1', 'u2', 'u3'];
  const hm = V.html(moved, {});
  ok(cardsOf(sec(hm, 'permitted').html).length === 2 && !/Townhome plat/.test(sec(hm, 'permitted').html),
    '10z a record listed in a stage section its own stage contradicts is not shown there (the engine\'s list and the record must agree)');
  const legacy = clone(WP);
  delete legacy.report.sections.by_stage; legacy.report.sections.by_lifecycle.proposed = ['u3'].concat(legacy.report.sections.by_lifecycle.proposed);
  const hl2 = V.html(legacy, {});
  ok(legacy.report.sections.by_lifecycle.approved.includes('u3') && cardsOf(sec(hl2, 'approved').html + sec(hl2, 'proposed').html).filter((c) => cardTitle(c) === 'Townhome plat').length === 1 && !sec(hl2, 'permitted').html.includes('da-rv-card'),
    '10aa an older response (no by_stage) that names a record in two lifecycle lists still shows it once, and Permitted / Under Construction stays empty');
  const unstagedReview = clone(W); unstagedReview.render.review = ['k-op'].concat(W.render.review);
  ok(!/Highway 99 Widening/.test(sec(view(unstagedReview), 'review').html) && sec(view(unstagedReview), 'review').html.split('<li class="da-rv-rev">').length - 1 === W.render.review.length,
    '10ab Things to Review shows only records that sit in a stage section, even if a response lists another');

  // a lifecycle shape is the same everywhere for one key and different between keys (hero rows and Change History use it)
  const lifeShapes = {};
  for (const m of html.matchAll(/data-lifecycle="(\w+)"><svg class="da-rv-shape"[^>]*>(.*?)<\/svg>/g)) (lifeShapes[m[1]] = lifeShapes[m[1]] || new Set()).add(m[2]);
  const one = Object.values(lifeShapes).map((s) => [...s]);
  ok(Object.keys(lifeShapes).sort().join() === 'approved,operating,proposed,unknown' && one.every((s) => s.length === 1) && new Set(one.map((s) => s[0])).size === 4,
    '10ac the four lifecycle shapes on the page are four different drawings, one per key, so they read in greyscale', Object.keys(lifeShapes));
}

// ---- 11. the realtor wording pass (founder-approved 2026-10-04): the client briefing, the quiet hero, the verify lines, the lifecycle line -------------
{
  const mk = (id, d, fam, o) => [row(id, d, fam), proj(id, fam, Object.assign({ type: 'Utility', status: 'Approved', stage: 'Under Construction', date_kind: 'filed', submitted_at: '2024-08-26' }, o))];
  const three = [mk('b1', 0.12, FAM_A, { name: 'SR-13 (Main St) & 100 North' }), mk('b2', 0.18, FAM_A, { name: 'SR-13 (Main St) & 100 South' }), mk('b3', 0.32, FAM_B, { name: 'SR-13 (Main St) & 200 South' })];
  const WB = await wire({ rows: three.map((x) => x[0]), projects: three.map((x) => x[1]), ledger: [], events: [], health: [] });
  const hb = V.html(WB, { subject: '20 N Main St, Brigham City, UT 84302', label: 'Smith buyers', brokerage: 'ABC Realty', agent: 'Pat Agent' });
  const brief = (h) => { const m = /<p class="da-rv-brief" data-da-briefing>([^<]*)<\/p>/.exec(h); return m ? decode(m[1]) : null; };
  const asOf = V.util.day(WB.report.as_of);
  ok(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(asOf), '11a (control) the report carries an as-of day to quote: ' + asOf);
  const TAIL = ' Check the published schedule and project details at the official source before a listing, showing or offer.';
  ok(brief(hb) === 'As of ' + asOf + ', HomeSignal\'s covered official sources list 3 official records within 0.5 miles of this property: 3 permitted / under construction. No approved / coming or proposed / under review records are listed in this report. The first item under “Things to Review With Your Client” is about 0.1 miles away.' + TAIL,
    '11b the Brigham City shape: the briefing says how many, in which stages, that this REPORT lists nothing future-stage (not that the area has none), how far the first review item is, and one neutral check-the-source line', brief(hb));
  ok(hb.indexOf('</header>') > -1 && hb.indexOf('</header>') < hb.indexOf('data-da-briefing') && hb.indexOf('data-da-briefing') < hb.indexOf('<section'), '11c the briefing is a paragraph directly under the header and before the first section; it is not a section, so the plan\'s section order is untouched');
  ok(sections(hb).every((x) => !/briefing/i.test(x.label)) && keysOf(hb) === 'activity,filters,review,map,approved,proposed,permitted,history,evidence', '11d it adds no heading and no section key');
  const b = brief(hb);
  ok(!/SR-13|Main St|20 N|Brigham|84302|Smith|ABC Realty|Pat Agent/.test(b) && !/(value|traffic|noise|appreciat|desirab|impact|disrupt|nearest|closest)/i.test(b) && /coming/i.test(b.replace(/approved \/ coming/gi, '')) === false,
    '11e it names no address, project, label, brokerage or agent, makes no claim about value, traffic or effect, and keeps "coming" to the stage name', b);
  const counts = ['permitted', 'approved', 'proposed'].map((k) => cardsOf(sec(hb, k).html).length);
  ok(counts.join() === '3,0,0' && /: 3 permitted \/ under construction\./.test(b), '11f its counts are the counts of the cards in the stage sections below (one read(), no second count)', counts);
  // singular, mixed, no distance, no records
  const one = await wire({ rows: [three[0][0]], projects: [three[0][1]], ledger: [], events: [], health: [] });
  ok(/list 1 official record within 0\.5 miles of this property: 1 permitted \/ under construction\./.test(brief(V.html(one, {}))), '11g one record: "1 official record", not "1 official records"', brief(V.html(one, {})));
  const mixed = V.html(await wire({ rows: [row('m1', 0.12, FAM_A), row('m2', 0.4, FAM_A), row('m3', 0.2, FAM_B), row('m4', 0.3, FAM_B)], projects: [
    proj('m1', FAM_A, { name: 'A', type: 'Utility', status: 'Approved', stage: 'Under Construction', date_kind: 'filed', submitted_at: '2024-08-26' }),
    proj('m2', FAM_A, { name: 'B', type: 'Utility', status: 'Approved', stage: 'Under Construction', date_kind: 'filed', submitted_at: '2024-08-26' }),
    proj('m3', FAM_B, { name: 'C', type: 'Residential', status: 'Approved', stage: 'Recorded', date_kind: 'filed', submitted_at: '2024-01-01' }),
    proj('m4', FAM_B, { name: 'D', type: 'Commercial', status: 'Proposed', stage: null, date_kind: 'filed', submitted_at: '2024-01-01' })], ledger: [], events: [], health: [] }), {});
  ok(/list 4 official records within 0\.5 miles of this property: 2 permitted \/ under construction · 1 approved \/ coming · 1 proposed \/ under review\./.test(brief(mixed)) && !/No approved/.test(brief(mixed)),
    '11h a mixed report lists each stage that has records, in the section order, and does NOT say nothing is future-stage', brief(mixed));
  const noRender = clone(WB); delete noRender.render;
  ok(brief(V.html(noRender, {})) !== null && !/first item under/.test(brief(V.html(noRender, {}))) && /Check the published schedule/.test(brief(V.html(noRender, {}))), '11i a reopened or shared report carries no distances: the distance sentence is left out, never guessed', brief(V.html(noRender, {})));
  ok(brief(htmlNone) === null && brief(V.html({ status: 'OK', report: { as_of: '2026-09-29', projects: [], sections: {} } }, {})) === null, '11j a report with no records has no briefing (its outcome says what it can)');
  ok(brief(html) !== null && /list \d+ official records? within 0\.5 miles/.test(brief(html)), '11k the rich report has one too (positive control that the briefing is built for more than the Brigham shape)', brief(html));

  // the quiet hero: a zero over official ACTIVITY, then the records that remain on file
  const quiet3 = V.html(await wire({ rows: [row('q1', 0.4, FAM_A), row('q2', 0.3, FAM_A), row('q3', 0.2, FAM_A)], projects: ['q1', 'q2', 'q3'].map((id) => proj(id, FAM_A, { name: id, type: 'Utility', status: 'Approved', stage: 'Under Construction', date_kind: 'filed', submitted_at: '2024-01-01' })), ledger: [], events: [], health: [] }), {});
  const qh = sec(quiet3, 'activity');
  ok(metricsOf(qh).join() === 'Records with official activity in the last 90 days=0' && /The 3 official records in this report remain on file\./.test(textOf(qh.html)) && !/newly|New official records/i.test(textOf(qh.html)),
    '11l the quiet hero reads "0 records with official activity in the last 90 days" and "The 3 official records in this report remain on file." and never "new" or "newly identified" (the engine\'s window is a dated official event or a detected change)', textOf(qh.html));
  const q1 = sec(V.html(one, {}), 'activity');
  ok(/The official record in this report remains on file\./.test(textOf(q1.html)), '11m one record: "The official record in this report remains on file."', textOf(q1.html));

  // when the stage sections do not show every record in the report, the hero falls back to the neutral line rather than state a count
  const partial = clone(await wire({ rows: [row('q1', 0.4, FAM_A)], projects: [proj('q1', FAM_A, { name: 'q1', type: 'Utility', status: 'Approved', stage: 'Under Construction', date_kind: 'filed', submitted_at: '2024-01-01' })], ledger: [], events: [], health: [] }));
  partial.report.projects.push(Object.assign({}, partial.report.projects[0], { project_id: 'ghost', name: 'Unstaged record' }));
  ok(/Among the official records in this report\./.test(textOf(sec(V.html(partial, {}), 'activity').html)) && !/remain on file|remains on file/.test(textOf(sec(V.html(partial, {}), 'activity').html)),
    '11m2 if the report holds a record no stage section shows, the hero does not state an "on file" count that the page does not match', textOf(sec(V.html(partial, {}), 'activity').html));

  // the verify lines, by stage, and the unchanged disclaimer
  const rvm = sec(mixed, 'review').html;
  ok(/Review:<\/span> Verify the official schedule and project details at the source\./.test(rvm) && /Review:<\/span> Verify the published project details and the official construction timing\./.test(rvm) && /Review:<\/span> Verify the application status and the agency&#39;s schedule\./.test(rvm)
    && /not a prediction of any effect on the property/.test(rvm) && !/(value|traffic|noise|appreciat|desirab|impact|disrupt)/i.test(textOf(rvm)),
    '11n each stage has its own verify line (permitted, approved, proposed), the "not a prediction" note stays, and nothing claims an effect or a condition the report cannot know', textOf(rvm));

  // the lifecycle line is a customer-view omission only
  ok(!/HomeSignal lifecycle/.test(hb) && !/HomeSignal lifecycle/.test(mixed) && /HomeSignal lifecycle/.test(htmlLife) && V.html(WB, { showLifecycle: 'yes' }).indexOf('HomeSignal lifecycle') === -1 && V.html(WB, { showLifecycle: true }).indexOf('HomeSignal lifecycle') > -1,
    '11o the lifecycle line is left out by default and shown only for opts.showLifecycle === true (a truthy string is not enough), so a customer page cannot show it by passing something loose');
}

// ---- 12. the comparison table (step 15): rows above the cards, which stay below in an expandable detail --------------------------------------------
{
  const tableOf = (h) => (/<table[\s\S]*?<\/table>/.exec(h) || [''])[0];
  const rowsOf = (tb) => [...tb.matchAll(/<tr role="row" data-da-type="(\w+)" data-da-stage="(\w+)">([\s\S]*?)<\/tr>/g)].map((m) => ({ type: m[1], stage: m[2], html: m[3], title: decode((/<th scope="row"[^>]*>([^<]*)<\/th>/.exec(m[3]) || [0, ''])[1]) }));
  const heads = (tb) => [...tb.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => decode(m[1]));
  for (const k of ['approved', 'proposed']) {
    const s = sec(html, k), tb = tableOf(s.html), rows = rowsOf(tb), cards = cardsOf(s.html);
    ok(tb !== '' && rows.length === cards.length && rows.length > 0 && rows.every((r) => r.stage === k) && rows.map((r) => r.title).join('|') === cards.map(cardTitle).join('|'),
      '12a (' + k + ') the stage section opens with a table of exactly the records its cards show, in the same order, each row carrying the Type and Stage the filters match on', [rows.length, cards.length]);
    ok(s.html.indexOf('<table') < s.html.indexOf('<details') && /<details class="da-rv-detail"><summary class="da-rv-sum">Full official detail<\/summary><div class="da-rv-cards">/.test(s.html) && s.html.indexOf('<details') < s.html.indexOf('<article'),
      '12b (' + k + ') the table comes first and every card sits inside the one "Full official detail" detail below it');
  }
  const none = sec(html, 'permitted');
  ok(!/<table|<details/.test(none.html) && /No projects at this stage in this report\./.test(none.html), '12c an empty stage has no table and no detail, only its honest empty line');
  const ph = heads(tableOf(sec(html, 'proposed').html));
  ok(ph.join('|') === 'Map|Record|Distance|Type|Official source', '12d the columns, in order, for records that state a distance, a Type and a link but no publisher stage: Map, Record, Distance, Type, Official source', ph);
  const stagedW = await wire({ rows: [row('s1', 0.12, FAM_A)], projects: [proj('s1', FAM_A, { name: 'Staged', type: 'Utility', status: 'Approved', stage: 'Under Construction', date_kind: 'filed', submitted_at: '2024-08-26' })], ledger: [], events: [], health: [] });
  ok(heads(tableOf(sec(V.html(stagedW, {}), 'permitted').html)).join('|') === 'Map|Record|Distance|Type|Publisher stage|Official source' && /Under Construction/.test(textOf(tableOf(sec(V.html(stagedW, {}), 'permitted').html))),
    '12d2 a record that states a publisher stage adds the Publisher stage column, in the publisher\'s own words');
  // an absent field stays absent: a column no record has a value for is not drawn, and a cell is never a placeholder
  const bare = clone(W); delete bare.render; bare.report.projects.forEach((p) => { p.source = { url: '', attribution: '' }; p.publisher_stage = null; });
  const hb2 = V.html(bare, {});
  const bh = heads(tableOf(sec(hb2, 'proposed').html));
  ok(bh.join('|') === 'Map|Record|Type', '12e with no distances, no stage words and no links the table is Map, Record, Type only (no empty columns, no "not stated" cells)', bh);
  ok(!/not stated|N\/A|&mdash;|—/.test(tableOf(sec(hb2, 'proposed').html)), '12f no placeholder text in any cell');
  // every value in a cell is escaped, and the link is the one validated link
  const hostileT = clone(W); hostileT.report.projects.find((p) => p.project_id === 'k-proposed').name = '<script>alert(1)</script>';
  const ht = V.html(hostileT, {});
  ok(!/<script/.test(ht) && /<th scope="row"[^>]*>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/th>/.test(tableOf(sec(ht, 'proposed').html)), '12g a hostile record name is escaped in its table row');
  const rowLinks = [...tableOf(sec(html, 'proposed').html).matchAll(/<a class="da-rv-link" href="([^"]*)" target="_blank" rel="noopener noreferrer">Official source /g)].map((m) => m[1]);
  ok(rowLinks.length === 4 && rowLinks.every((u) => /^https:\/\/example\.gov\/records\//.test(u)), '12h each row\'s official link is the record\'s own http(s) link, opening in a new tab with noopener noreferrer', rowLinks);
  ok(!/lifecycle|storage|HOLD|registry|family/i.test(textOf(tableOf(sec(html, 'proposed').html))), '12i the table carries no lifecycle line and nothing internal');
  const first = rowsOf(tableOf(sec(html, 'proposed').html))[0];
  ok(/<svg class="da-rv-shape"/.test(first.html) && />\d+<\/span>/.test(first.html), '12j a row opens with the marker\'s own shape and map number, the same number the map and the card carry', first.html.slice(0, 160));
  // the numbers match the map markers and the cards
  const nums = [...tableOf(sec(html, 'proposed').html).matchAll(/da-rv-td--num"><svg[^>]*>.*?<\/svg><span>(\d+)<\/span>/g)].map((m) => m[1]);
  const cardNums = cardsOf(sec(html, 'proposed').html).map((c) => (/Map (\d+)/.exec(c) || [0, ''])[1]);
  ok(nums.length === 4 && nums.join() === cardNums.join(), '12k the map numbers in the rows are the numbers on the cards', [nums, cardNums]);
}

ok(threw === 0, 'Z the view did not throw on any response in any check above (a throw is returned as a marker, so a check that expects an absence cannot pass on it)', threw);

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
