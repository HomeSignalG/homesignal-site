// Company & Developer Track Record — the rules that keep a track record from becoming an
// accusation. Fixtures are the real app_project_track_record() output for ZIP 78617.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {}, document: undefined };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../lib/track-record.js', import.meta.url), 'utf8'), ctx);
const T = ctx.window.HS.track;

// TXI - Garfield Sand & Gravel, as returned live on 2026-08-09.
const GARFIELD = {
  facility: {
    refs: [{ system: 'EPA_FRS', id: '110070182593' }, { system: 'TCEQ_RN', id: 'RN106540172' }],
    events: [],
    checked: [
      { agency: 'TCEQ', dataset: 'Notices of Violation', basis: 'TCEQ regulated-entity number RN106540172', found: 0, url: 'https://data.texas.gov/x' },
      { agency: 'TCEQ', dataset: 'Notices of Enforcement', basis: 'TCEQ regulated-entity number RN106540172', found: 0, url: 'https://data.texas.gov/y' },
      { agency: 'EPA', dataset: 'ECHO all-data facility summary', basis: 'EPA FRS registry id 110070182593', found: 0, url: 'https://echodata.epa.gov/z' }
    ]
  },
  companies: [{
    role: 'Operator', name: 'Martin Marietta Materials Southwest, LLC',
    facilities: { count: 154, open: 153, counties: 40, state: 'TX',
                  basis: 'TCEQ customer number CN606114726', url: 'https://data.texas.gov/cn' },
    record_counts: [
      { type: 'notice_of_violation', count: 12, facilities: 11, oldest: '2021-11-22', newest: '2026-06-24', agency_violation_count: 23, penalties: null },
      { type: 'notice_of_enforcement', count: 10, facilities: 7, oldest: '2014-09-02', newest: '2025-04-24', agency_violation_count: 17, penalties: null },
      { type: 'administrative_order', count: 1, facilities: 0, oldest: '2021-08-24', newest: '2021-08-24', agency_violation_count: null, penalties: 6750 }
    ],
    events: [
      { type: 'notice_of_violation', agency: 'TCEQ', date: '2026-06-24', facility: 'SOME QUARRY',
        facility_ref: 'RN100000001', violation_count: 2, evidence: 'VERIFIED', url: 'https://data.texas.gov/nov' },
      { type: 'administrative_order', agency: 'TCEQ', date: '2021-08-24', program: 'WATER QUALITY',
        penalty: 6750, penalty_note: 'Assessed $6750; deferred $0', evidence: 'HIGH_CONFIDENCE',
        attributed_entity: 'MARTIN MARIETTA MATERIALS SOUTHWEST, LLC',
        note: 'Matched on an EXACT respondent legal name', url: 'https://data.texas.gov/ao' }
    ],
    checked: [],
    parent: {
      name: 'Martin Marietta Materials, Inc.', verified: true,
      facilities: { count: 89, open: 63, counties: 30, state: 'TX',
                    basis: 'TCEQ customer number CN600134696', url: 'https://data.texas.gov/pcn' },
      record_counts: [
        { type: 'notice_of_violation', count: 4, facilities: 4, oldest: '2021-11-22', newest: '2026-06-24', agency_violation_count: 7, penalties: null },
        { type: 'notice_of_enforcement', count: 7, facilities: 5, oldest: '2011-01-27', newest: '2025-03-07', agency_violation_count: 15, penalties: null },
        { type: 'administrative_order', count: 1, facilities: 0, oldest: '2019-07-16', newest: '2019-07-16', agency_violation_count: null, penalties: 875 }
      ],
      events: [{ type: 'administrative_order', agency: 'TCEQ', date: '2019-07-16', program: 'WATER RIGHTS',
                 penalty: 875, evidence: 'HIGH_CONFIDENCE', url: 'https://data.texas.gov/pao' }]
    },
    sustainability: null
  }]
};

// A record with a resolved company but nothing found anywhere.
const EMPTY = {
  facility: { refs: [], events: [], checked: [] },
  companies: [{ role: 'Property Owner', name: 'Neuralink', facilities: {}, record_counts: [],
                events: [], checked: [{ agency: 'TCEQ', dataset: 'Central Registry', basis: 'exact legal name "Neuralink"', found: 0, url: 'https://x' }],
                parent: null, sustainability: null }]
};

test('record classes are never collapsed into one number', () => {
  const lines = T.countLines(GARFIELD.companies[0].record_counts);
  assert.equal(lines.length, 3);
  assert.match(lines[0].text, /^12 notices of violation at 11 facilities, 2021–2026$/);
  assert.match(lines[1].text, /^10 notices of enforcement at 7 facilities, 2014–2025$/);
  assert.match(lines[2].text, /^1 administrative order, 2021 — \$6,750 assessed$/);
  // there is deliberately no total anywhere
  const html = T.detailHTML(GARFIELD);
  assert.doesNotMatch(html, /\b23 violations\b/);
  assert.doesNotMatch(html, /\btotal\b/i);
});

test('singular and plural record labels', () => {
  assert.equal(T.recordLabel('notice_of_violation', 1), 'notice of violation');
  assert.equal(T.recordLabel('notice_of_violation', 3), 'notices of violation');
  assert.equal(T.recordLabel('administrative_order', 1), 'administrative order');
  assert.equal(T.recordLabel('inspection', 2), 'inspections');
});

test('the three levels are labelled and never merged', () => {
  const html = T.detailHTML(GARFIELD);
  const thisFac = html.indexOf('This facility');
  const company = html.indexOf('Operator — Martin Marietta Materials Southwest, LLC');
  const parent = html.indexOf('Parent company — Martin Marietta Materials, Inc.');
  assert.ok(thisFac >= 0 && company > thisFac && parent > company,
    'facility, then company, then parent nested after it');
  // the parent block explicitly disclaims the other two levels
  assert.match(html, /did not happen at the facility above, or at this company's own facilities/);
  // the company's own facility count must not be the parent's
  assert.match(html, /<b>154<\/b> other facilities operated by this company/);
  assert.match(html, /<b>89<\/b> facilities of the parent company/);
});

test('a facility with no records says so, and says what was checked', () => {
  const html = T.detailHTML(GARFIELD);
  assert.match(html, /No records found in the sources checked\./);
  assert.match(html, /Checked: TCEQ Notices of Violation; TCEQ Notices of Enforcement; EPA ECHO/);
  // never the stronger claim
  assert.doesNotMatch(html, /no violations/i);
  assert.doesNotMatch(html, /clean|compliant|good standing/i);
});

test('no grade, no rating, no judgement words anywhere in the output', () => {
  const html = T.detailHTML(GARFIELD) + T.indicatorHTML(GARFIELD)
    + JSON.stringify(T.evidenceEntries(GARFIELD));
  for (const word of ['good', 'bad', 'safe', 'unsafe', 'responsible', 'irresponsible',
                      'clean', 'dirty', 'risk score', 'grade', 'rating', 'poor', 'excellent']) {
    assert.ok(!new RegExp('\\b' + word + '\\b', 'i').test(html), 'judgement word leaked: ' + word);
  }
});

test('dates are always carried, and a range is shown as a range', () => {
  assert.equal(T.span('2014-09-02', '2025-04-24'), '2014–2025');
  assert.equal(T.span('2021-08-24', '2021-08-24'), '2021');
  assert.equal(T.span(null, null), '');
  const html = T.detailHTML(GARFIELD);
  assert.match(html, /2021–2026/);
  assert.match(html, /2014–2025/);
});

test('the availability indicator only claims what exists — and never claims safety', () => {
  const a = T.availability(GARFIELD);
  assert.equal(a.environmental, true);
  assert.equal(a.safety, false, 'OSHA cannot be attributed, so no safety claim is ever made');
  assert.match(T.indicatorHTML(GARFIELD), /Environmental records available/);
  assert.doesNotMatch(T.indicatorHTML(GARFIELD), /Safety records available/);
  // the indicator is a one-line surface claim, not a second heading
  assert.doesNotMatch(T.indicatorHTML(GARFIELD), /Company track record/i);
  // a record with nothing gets no indicator at all, rather than an empty shell
  assert.equal(T.availability(EMPTY).any, false);
  assert.equal(T.indicatorHTML(EMPTY), '');
});

test('a company with nothing found renders the honest empty line, not a blank', () => {
  const html = T.detailHTML(EMPTY);
  assert.match(html, /Property Owner — Neuralink/);
  assert.match(html, /No records found in the sources checked/);
  assert.doesNotMatch(html, /facilities/);
});

test('penalties are only shown where the source reports one', () => {
  const lines = T.countLines(GARFIELD.companies[0].record_counts);
  assert.match(lines[2].text, /\$6,750 assessed/);
  assert.doesNotMatch(lines[0].text, /\$/);      // NOVs carry no penalty field
  assert.equal(T.money(null), '');
  assert.equal(T.money(0), '$0');
});

test('an event keeps the entity the agency recorded it against', () => {
  const ev = T.evidenceEntries(GARFIELD);
  const order = ev.find(e => /administrative order/i.test(e.entity) && /Operator/.test(e.role));
  assert.match(order.note, /recorded by the agency against "MARTIN MARIETTA MATERIALS SOUTHWEST, LLC"/i);
  assert.equal(order.status, 'Reported', 'a name-matched record is not Verified');
  const nov = ev.find(e => /Notice of violation/i.test(e.entity));
  assert.equal(nov.status, 'Verified', 'an identifier-matched record is Verified');
});

test('parent evidence is labelled as the parent, never as the direct company', () => {
  const ev = T.evidenceEntries(GARFIELD);
  const pf = ev.find(e => e.role === 'Parent company — facilities');
  assert.match(pf.note, /not facilities of Martin Marietta Materials Southwest, LLC/);
  const pe = ev.find(e => /^Parent company — Martin Marietta Materials, Inc\./.test(e.role));
  assert.ok(pe, 'parent events carry a parent-labelled role');
});

test('checked-source entries distinguish "looked and found nothing" from "not looked"', () => {
  const ev = T.evidenceEntries(GARFIELD);
  const none = ev.find(e => e.status === 'No records found');
  assert.match(none.note, /absence in this dataset, not a finding of compliance/);
  assert.ok(none.document.length > 0, 'the query basis is preserved so the check is repeatable');
});

test('every material claim carries a source URL', () => {
  for (const e of T.evidenceEntries(GARFIELD)) {
    if (e.status === 'No records found' || /facilities$/.test(e.role) || /^\d+ facilities$/.test(e.status)) continue;
    assert.match(e.url, /^https:\/\//, 'missing source url for ' + e.role);
  }
});

test('the ESG slot exists but renders nothing while it is empty', () => {
  assert.equal(GARFIELD.companies[0].sustainability, null);
  assert.doesNotMatch(T.detailHTML(GARFIELD), /sustainab/i);
});

// ── false-positive regressions (the cases that make name matching unsafe) ───────────────
// Giga Texas Offsite Wastewater Interceptor: the facility NAME contains a famous company,
// and the resolved operator is somebody else entirely. This is the same shape as the
// TXI/Garfield case that proved name-based attribution wrong in the identity pilot.
const GIGA = {
  facility: { refs: [{ system: 'TCEQ_RN', id: 'RN111954798' }], events: [],
              checked: [{ agency: 'TCEQ', dataset: 'Notices of Violation',
                          basis: 'TCEQ regulated-entity number RN111954798', found: 0, url: 'https://x' }] },
  companies: [{ role: 'Operator', name: 'Ward & Burke Tunneling Inc', facilities: {},
                record_counts: [], events: [], checked: [], parent: null, sustainability: null }],
  _facility_name: 'GIGA TEXAS OFFSITE WASTEWATER INTERCEPTOR'
};

test('a company named only in the FACILITY NAME never gets a track record', () => {
  const html = T.detailHTML(GIGA) + JSON.stringify(T.evidenceEntries(GIGA));
  assert.ok(html.indexOf('Tesla') === -1, 'the facility name must not become a company');
  assert.ok(html.indexOf('Giga') === -1);
  assert.match(html, /Ward & Burke Tunneling Inc|Ward &amp; Burke Tunneling Inc/,
    'only the resolved operator appears');
});

test('the renderer can only name companies the identity layer resolved', () => {
  // Nothing in the module derives a company from any other field, so a record whose
  // companies list is empty produces no company section at all.
  const none = { facility: { refs: [], events: [], checked: [] }, companies: [] };
  const html = T.detailHTML(none);
  assert.match(html, /This facility/);
  assert.doesNotMatch(html, /Operator|Developer|Applicant|Property Owner|Parent company/);
});

test('two companies in the same role keep separate track records', () => {
  const two = { facility: { refs: [], events: [], checked: [] }, companies: [
    { role: 'Operator', name: 'Alpha LLC', facilities: { count: 3, counties: 1, state: 'TX' },
      record_counts: [{ type: 'notice_of_violation', count: 1, facilities: 1, oldest: '2020-01-01', newest: '2020-01-01' }],
      events: [], checked: [], parent: null },
    { role: 'Operator', name: 'Beta LP', facilities: { count: 9, counties: 4, state: 'TX' },
      record_counts: [], events: [], checked: [], parent: null }
  ] };
  const html = T.detailHTML(two);
  assert.match(html, /Operator — Alpha LLC/);
  assert.match(html, /Operator — Beta LP/);
  // Beta's empty record is not filled in from Alpha's
  const betaBlock = html.slice(html.indexOf('Operator — Beta LP'));
  assert.match(betaBlock, /No records found in the sources checked/);
  assert.match(betaBlock, /<b>9<\/b> other facilities/);
});

test('"not yet checked" is never rendered as "no records found"', () => {
  // A resolved company nobody queried. Saying "no records found in the sources checked"
  // here would claim a search that never happened.
  const unchecked = { facility: { refs: [], events: [], checked: [] }, companies: [
    { role: 'Operator', name: 'Unqueried LLC', facilities: {}, record_counts: [],
      events: [], checked: [], parent: null }
  ] };
  const html = T.detailHTML(unchecked);
  // BOTH blocks: the facility had no checks recorded either, so neither may claim a search.
  assert.equal((html.match(/Not yet checked in this pilot/g) || []).length, 2);
  assert.doesNotMatch(html, /No records found/);
  // and a company that WAS queried keeps the other wording
  const checked = { facility: { refs: [], events: [], checked: [] }, companies: [
    { role: 'Operator', name: 'Queried LLC', facilities: {}, record_counts: [], events: [],
      checked: [{ agency: 'TCEQ', dataset: 'Central Registry', basis: 'exact legal name', found: 0, url: 'https://x' }],
      parent: null }
  ] };
  const h2 = T.detailHTML(checked);
  const companyBlock = h2.slice(h2.indexOf('Queried LLC'));
  assert.match(companyBlock, /No records found in the sources checked/);
  assert.match(companyBlock, /Checked: TCEQ Central Registry/);
  assert.doesNotMatch(companyBlock, /Not yet checked/);
});
