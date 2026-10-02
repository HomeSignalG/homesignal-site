// THE DEVELOPMENT ACTIVITY REPORT VIEW — behaviour (Development Activity plan, Order I, step 1).
//
// lib/da-report-view.js turns the national engine's response into the customer report. This file proves the VIEW against the engine's
// TRUE output: every response below is produced by the real request handler (supabase/functions/get-development-activity-report/
// handler.ts, driven by test/lib/da-report-view-world.mjs), which runs the real assemble() (_shared/national-report.ts) over rows shaped
// like production's. Nothing about the response shape is hand-made. The view is then loaded the way a page would load it (a script
// that attaches to window.HS).
//
// What is proven: the section order and that only sections with data render; the hero is a change claim only where the ledger proved
// one; lifecycle is text plus a shape on every card; nothing internal reaches the page; a zero-record report never claims there was no
// activity; escaping, link safety, and the address appearing as text only.
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
import { NOW, FAM_A, FAM_B, RIGHTS_SHIPPED, RIGHTS_AB, ADDRESS, row, proj, RICH, COLD, wire, clone } from './lib/da-report-view-world.mjs';
/** The view of a response. A throw is returned as a marker so the check that looked at it fails BY NAME instead of the whole suite crashing. */
let threw = 0;
const view = (r, subject = ADDRESS) => { try { return V.html(r, { subject }); } catch (e) { threw++; return '[[the view threw: ' + String((e && e.message) || e) + ']]'; } };

// ---- reading the output (it is HTML we generate: simple, non-nesting sections) ------------------------------------------------------------
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const textOf = (h) => decode(h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const sections = (h) => [...h.matchAll(/<section class="da-rv-sec da-rv-sec--(\w+)([^"]*)" aria-label="([^"]*)">([\s\S]*?)<\/section>/g)].map((m) => ({ key: m[1], cls: m[2], label: decode(m[3]), html: m[4] }));
const keysOf = (h) => sections(h).map((s) => s.key).join(',');
const cardsOf = (h) => [...h.matchAll(/<article class="da-rv-card">([\s\S]*?)<\/article>/g)].map((m) => m[1]);
const cardTitle = (c) => decode((/<h3 class="da-rv-title">([\s\S]*?)<\/h3>/.exec(c) || [, ''])[1]);
const sec = (h, key) => sections(h).find((s) => s.key === key);
const attrs = (h) => [...h.matchAll(/\s([a-zA-Z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]);
const metricsOf = (s) => [...s.html.matchAll(/<div class="da-rv-metric"><b>(\d+)<\/b><span>([^<]*)<\/span><\/div>/g)].map((m) => decode(m[2]) + '=' + m[1]);
const stripShapes = (h) => h.replace(/<svg class="da-rv-shape"[\s\S]*?<\/svg>/g, '');

const W = await wire(RICH);
const WCOLD = await wire(COLD);
const WNONE = await wire(RICH, { rights: RIGHTS_SHIPPED });
const WINT = await wire(RICH, { view: 'internal', rights: RIGHTS_SHIPPED });
const html = view(W), htmlCold = view(WCOLD), htmlNone = view(WNONE), htmlInt = view(WINT);

// ---- 0. the fixtures ARE the engine's output --------------------------------------------------------------------------------------------
{
  ok(W.status === 'OK' && W.report.product === 'HOMESIGNAL DEVELOPMENT ACTIVITY' && Array.isArray(W.report.projects), '0a the response is the real handler\'s: status OK, the engine\'s product name, a projects array');
  const direct = M.assemble({ now: NOW, view: 'customer', zip_supported: true, radius_mi: 1, rights: RIGHTS_AB,
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

// ---- 1. section order: exactly the plan's, only sections with data --------------------------------------------------------------------------
{
  const PLAN = ['changed', 'activity', 'approved', 'proposed', 'history', 'evidence'];
  ok(keysOf(html) === PLAN.join(), '1a every section has data: the order is What Changed, Recent Official Activity, Approved, Proposed, Change History, Evidence', keysOf(html));
  ok(sections(html).map((s) => s.label).join(' | ') === 'What Changed Recently | Recent Official Activity | Approved / Coming | Proposed / Under Review | Change History | Official evidence & coverage',
    '1b the section titles are the plan\'s (lines 2410-2418)');
  ok(keysOf(htmlNone) === 'evidence', '1c an empty report renders only Official evidence & coverage', keysOf(htmlNone));
  ok(keysOf(htmlCold) === 'activity,approved,proposed,history,evidence', '1d the cold start (no ledger): Recent Official Activity leads, and there is no What Changed section', keysOf(htmlCold));
  const quiet = { rows: [row('q1', 0.4, FAM_A)], projects: [proj('q1', FAM_A, { status: 'Approved', date_kind: 'issued', submitted_at: '2025-02-01', name: 'Quiet Approved Plat' })], ledger: [], events: [], health: [] };
  const hq = view(await wire(quiet));
  ok(keysOf(hq) === 'approved,evidence', '1e only an approved record with no recent event: Approved / Coming then evidence, nothing else', keysOf(hq));
  const prop = { rows: [row('p1', 0.4, FAM_B)], projects: [proj('p1', FAM_B, { status: 'Proposed', date_kind: 'scheduled', submitted_at: '2027-02-01', name: 'Planned Retail' })], ledger: [], events: [], health: [] };
  const hp = view(await wire(prop));
  ok(keysOf(hp) === 'proposed,evidence', '1f only a proposed record with no event: Proposed / Under Review then evidence', keysOf(hp));
  const all = textOf(html) + ' ' + textOf(htmlCold) + ' ' + textOf(htmlNone);
  ok(/Things to Review/i.test('Things to Review With Your Client') && /Compare/i.test('Compare'), '1g (control) the pattern below can see the words it forbids');
  ok(!/Things to Review|Permitted \/ Under Construction|Development Activity Map|What Exists Today|Compare|Watch|\bShare\b|\bPDF\b/i.test(all),
    '1g no Things to Review, no Permitted / Under Construction, no map, no What Exists Today, no action bar: nothing was invented for them');
  const idx = (t) => html.indexOf('aria-label="' + t + '"');
  ok(idx('What Changed Recently') < idx('Recent Official Activity') && idx('Recent Official Activity') < idx('Approved / Coming') && idx('Approved / Coming') < idx('Proposed / Under Review')
    && idx('Proposed / Under Review') < idx('Change History') && idx('Change History') < idx('Official evidence &amp; coverage') && idx('What Changed Recently') > 0, '1h the same order, read straight off the markup positions');
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
  ok(/HomeSignal detected:<\/span> Status changed \u00b7 Sep 27, 2026/.test(sec(h2, 'approved').html) && !/Sep 20, 2026/.test(sec(h2, 'approved').html), '2k its card names the newest change only');
  const t2 = textOf(sec(h2, 'history').html);
  ok(t2.indexOf('Status changed \u00b7 detected Sep 27, 2026') > -1 && t2.indexOf('Status changed \u00b7 detected Sep 27, 2026') < t2.indexOf('First detected by HomeSignal \u00b7 detected Sep 20, 2026'), '2k and Change History lists both, in the engine\'s order (newest first)');
}

// ---- 3. lifecycle: text plus a shape on every card; Proposed is never "coming" ---------------------------------------------------------------------
{
  const all = [...cardsOf(html), ...cardsOf(htmlCold), ...cardsOf(htmlInt)];
  ok(all.length >= 20, '3a there are cards to check (positive control: ' + all.length + ')');
  ok(all.every((c) => /<span class="da-rv-lifetext">[^<]+<\/span>/.test(c) && /<svg class="da-rv-shape"/.test(c)), '3b EVERY card carries a lifecycle text label AND a shape');
  const byTitle = Object.fromEntries(cardsOf(html).map((c) => [cardTitle(c), c]));
  const life = (t) => decode(/<span class="da-rv-lifetext">([^<]+)<\/span>/.exec(byTitle[t])[1]);
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
  ok(/coming/i.test(textOf(html)) && !/coming/i.test(textOf(html).replace(/Approved \/ Coming/g, '')), '3g "coming" appears nowhere except in the Approved / Coming title (and it does appear there: control)', textOf(html).match(/.{20}coming.{20}/i));
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
    ok(!/Quiet Unknown Record/.test(hq) && keysOf(hq) === 'evidence',
      '3p-view step 1 draws a quiet unknown record NOWHERE (only the scope and evidence section renders): a recorded decision, open for the founder (show it, count it, or leave it)', keysOf(hq));
    ok(!/no development activity|nothing to show|no records|no projects/i.test(textOf(hq)),
      '3p-claim and the page makes no absence claim over it: it never says there was no activity or nothing to show');
  }
  // the view follows the engine's key, not the publisher's word
  const doctored = clone(W);
  doctored.report.projects.find((p) => p.project_id === 'k-approved').lifecycle = { key: 'unknown', label: 'Lifecycle unknown' };
  const dc = Object.fromEntries(cardsOf(view(doctored)).map((c) => [cardTitle(c), c]));
  ok(/Lifecycle unknown<\/span>/.test(dc['Menchaca Apartments']) && /Publisher status:<\/span> Approved/.test(dc['Menchaca Apartments']), '3n a card shows the lifecycle the engine sent even when the publisher status says otherwise: the view re-derives nothing');
  const odd = clone(W);
  odd.report.projects.find((p) => p.project_id === 'k-approved').lifecycle = { key: 'weird" onmouseover="x', label: '' };
  const oh = view(odd);
  ok(!/onmouseover/.test(oh) && /da-rv-life--unknown/.test(oh), '3o an unrecognised lifecycle key is drawn as unknown and never reaches a class or attribute');
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
  const ALLOWED_ATTRS = new Set(['class', 'aria-label', 'aria-hidden', 'data-lifecycle', 'href', 'target', 'rel', 'viewBox', 'width', 'height', 'focusable', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'cx', 'cy', 'r', 'x', 'y', 'rx', 'd']);
  const seen = new Set(Object.values(outputs).flatMap((o) => attrs(o).map(([k]) => k)));
  ok([...seen].every((k) => ALLOWED_ATTRS.has(k)) && seen.has('data-lifecycle') && seen.has('href'), '4e2 the only attribute NAMES that ever appear are the closed set of presentation ones: no id, no data-id, no title, no style, no other data-*', [...seen].filter((k) => !ALLOWED_ATTRS.has(k)));
  ok(!/<(script|iframe|object|embed|form|input|button|img)\b/i.test(html) && !/\son[a-z]+=/i.test(html), '4f the output has no script, frame, form, control or event handler');
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
  ok(keysOf(hn) === 'evidence' && !ABSENCE.test(textOf(hn)) && !/<ul class="da-rv-lims">/.test(hn), '5h it renders the scope and disclosure and makes no statement of absence either (the engine cannot support one: its coverage is judged on records returned)');
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
  const links = clone(W);
  const L = (k, u) => { links.report.projects.find((p) => p.project_id === k).source.url = u; };
  L('k-approved', 'javascript:alert(1)'); L('k-first', 'JAVASCRIPT:alert(1)'); L('k-proposed', 'ftp://example.gov/x'); L('k-decided', 'https://example.gov/a b');
  L('k-old-appr', '//example.com/x'); L('k-op', 'data:text/html,<script>alert(1)</script>'); L('k-unk', 'https://evil.example/"onmouseover="alert(1)'); L('k-sched', 'https://example.gov/ok?x=1&y=2');
  const hl = view(links);
  const hrefs = [...hl.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  ok(hrefs.join() === 'https://example.gov/ok?x=1&amp;y=2', '6d of eight source URLs only the real http(s) one is linked (javascript:, JAVASCRIPT:, ftp:, a space, protocol-relative, data:, a quote)', hrefs);
  ok(!/\sonmouseover=/.test(hl), '6e the quote-carrying URL did not become an attribute');
  const real = [...html.matchAll(/<a class="da-rv-link" href="([^"]*)" target="_blank" rel="noopener noreferrer">/g)];
  ok(real.length === 8 && [...html.matchAll(/<a\b/g)].length === 8 && real.every((m) => /^https?:\/\//.test(m[1])), '6f every link on a normal report is http(s), opens in a new tab, with noopener noreferrer (8 of 8)', real.length);
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
  rev.report.sections.by_lifecycle.proposed = rev.report.sections.by_lifecycle.proposed.slice().reverse();
  const hr = view(rev);
  ok(cardsOf(sec(hr, 'proposed').html).map(cardTitle).join() === 'Planned Bridge Replacement,Riverside Retail Center,Lakeline Medical Office,Oak Grove Townhomes', '7b the view sorts nothing: a reversed engine list is a reversed section');
  const recentLine = (sct) => textOf(/<p class="da-rv-recent">([\s\S]*?)<\/p>/.exec(sct.html)[1]);
  ok(/^Most recent: .*Highway 99 Widening/.test(recentLine(sec(html, 'activity'))) && /^Most recent: .*Riverside Retail Center/.test(recentLine(sec(hr, 'activity'))),
    '7c and the "Most recent" line follows the engine\'s first entry, not its own ranking (normal: the engine\'s first is Highway 99; reversed: Riverside)', [recentLine(sec(html, 'activity')), recentLine(sec(hr, 'activity'))]);
  const ghost = clone(W);
  ghost.report.sections.by_lifecycle.approved.push('no-such-project', 'k-approved');
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
  ok(!sec(view(await wire({ rows: [row('q1', 0.4, FAM_A)], projects: [proj('q1', FAM_A, { status: 'Approved', date_kind: 'issued', submitted_at: '2025-02-01' })] })), 'history'), '7j Change History is hidden when there is neither');
  const unk = clone(W);
  unk.report.projects.find((p) => p.project_id === 'k-first').homesignal_detected_changes[0].event_type = 'brand_new_type';
  unk.report.projects.find((p) => p.project_id === 'k-first').homesignal_detected_changes[0].changes[0].field = 'some_new_field';
  const hu = textOf(view(unk));
  ok(!/brand_new_type|some_new_field/.test(hu) && /Change detected/.test(hu) && /Some new field/.test(hu), '7k an event type outside the ledger\'s vocabulary is never printed raw; an unknown field is shown as plain words');
  ok(/Within 1 mile · ZIP 97477 · As of Sep 29, 2026/.test(textOf(html)) && /Recent means the last 90 days before Sep 29, 2026\./.test(textOf(html)),
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
  try { hs = V.html(sparse, {}); } catch (e) { t2 = String(e); }
  ok(!t2 && /Unnamed record/.test(hs) && /Lifecycle unknown/.test(hs) && !/<a\b/.test(hs) && keysOf(hs) === 'approved,evidence', '8c a sparse or malformed report still renders what it can: an unnamed record, an unknown lifecycle, no link, no claim', t2 || keysOf(hs));
}

// ---- 9. the words are the plan's, quoted from the plan ------------------------------------------------------------------------------------------------------
{
  const plan = readFileSync(join(root, 'docs/development-activity-plan-2026-09-30.md'), 'utf8');
  const quote = (needle) => { const l = plan.split('\n').find((x) => x.includes(needle)); return l ? l.replace(/^>\s*/, '').replace(/\*\*/g, '').trim() : null; };
  ok(V.DISCLOSURE === quote('HomeSignal summarizes selected official public records'), '9a the standard disclosure is the plan\'s sentence, word for word (plan line 1763)', quote('HomeSignal summarizes selected official public records'));
  ok(V.SCOPE_LINE === quote('Planned, approved, permitted and changing development found in'), '9b the scope line is the plan\'s (line 1261)');
  ok(V.SCOPE_NOTE === quote('This report focuses on development activity and change.'), '9c the supporting scope note is the plan\'s (line 1265)');
  ok(V.EYEBROW === 'HOMESIGNAL DEVELOPMENT ACTIVITY' && V.EYEBROW === M.PRODUCT_NAME, '9d the eyebrow equals the engine\'s product name (ruling R6)');
  ok(JSON.stringify(Object.values(V.TITLES)) === JSON.stringify(['What Changed Recently', 'Recent Official Activity', 'Approved / Coming', 'Proposed / Under Review', 'Change History', 'Official evidence & coverage']), '9e the six section titles, in the plan\'s order');
}

ok(threw === 0, 'Z the view did not throw on any response in any check above (a throw is returned as a marker, so a check that expects an absence cannot pass on it)', threw);

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
