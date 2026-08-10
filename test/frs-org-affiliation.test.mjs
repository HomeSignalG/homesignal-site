// EPA FRS organization affiliations — the render contract for a COMPLEMENTARY source.
//
// FRS publishes owner/operator/parent affiliations for a facility, but it identifies the
// organization by NAME, so it can corroborate a stronger source and it can fill a gap —
// it can never outrank the identifier-backed TCEQ chain or an authoritative filing, and it
// can never make a corporate parent verified. The rules under test:
//
//   • an FRS affiliation is Reported, never Verified;
//   • FRS OWNER is the FACILITY's owner, never a claim about the real-estate parcel;
//   • a stronger source wins the card, and FRS never overwrites it;
//   • an agreeing FRS row does not print the same company twice;
//   • a conflicting FRS row is kept for internal review and stays OFF the card;
//   • FORMER roles render in their own history section, never as current;
//   • no END_DATE is not evidence that a relationship is current;
//   • a parent CANDIDATE inherits nothing and renders no parent line;
//   • facilities at one address stay separate — the FRS registry id is the anchor;
//   • suffix differences (LLC vs LTD) are different companies;
//   • no internal enum reaches the markup.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {}, document: undefined };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../lib/templates.js', import.meta.url), 'utf8'), ctx);
const HS = ctx.window.HS;
const P = HS.parties;

import { FRS_URL, BFI, GARFIELD, CEMEX, SARWWTP, FORMER, frsRow } from './fixtures/frs-78617.mjs';

const textOf = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// ── 1. BFI operator imported as Reported ───────────────────────────────────────────────
test('FRS operator renders as Reported, never Verified', () => {
  const rows = P.frsCurrent(BFI).filter(p => p.role === 'Operator');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'BFI WASTE SYSTEMS OF TEXAS LP');
  assert.equal(P.consumerLabel(rows[0].verification), 'Reported');
  const html = P.groupsHTML(BFI);
  assert.match(html, /BFI WASTE SYSTEMS OF TEXAS LP/);
  assert.match(html, /Reported in EPA facility records/);
  // The Verified tick is reserved for the identifier-backed and filing tiers.
  assert.ok(!/BFI WASTE SYSTEMS OF TEXAS LP<\/b> <span class="pver verified">/.test(html),
    'an FRS affiliation must not carry the Verified badge');
});

// ── 2. BFI owner imported without claiming parcel ownership ────────────────────────────
test('FRS OWNER is the facility owner, not a claim about the real-estate parcel', () => {
  const owners = P.frsCurrent(BFI).filter(p => p.role === 'Facility Owner');
  assert.equal(owners.length, 1);
  assert.equal(owners[0].name, 'BROWNING-FERRIS INDUSTRIES INC');
  // The role word is the distinction. "Property Owner" is the parcel; "Facility Owner" is
  // the regulated operation standing on it, and FRS only ever states the latter.
  assert.ok(P.frsCurrent(BFI).every(p => p.role !== 'Property Owner'),
    'an FRS affiliation must never be labelled Property Owner');
  const labels = P.groups(BFI).map(g => g.label);
  assert.ok(labels.includes('Facility owner'), labels.join(' / '));
  assert.ok(!labels.includes('Property owner'), labels.join(' / '));
});

// ── 3. BFI parent remains unresolved ───────────────────────────────────────────────────
test('an FRS affiliation cannot establish a corporate parent', () => {
  // Republic Services acquired Browning-Ferris; FRS does not say so, so nothing says so.
  assert.equal(P.frsParentCandidates(BFI).length, 0);
  const html = P.groupsHTML(BFI);
  assert.ok(!/Parent company:/.test(html), 'no parent line may be rendered for BFI');
  assert.ok(!/Republic/i.test(html), 'a parent must never be inferred from an acquisition we know of');
  // And nothing in the FRS rows can flip a parent to verified.
  P.frsCurrent(BFI).forEach(p => {
    const par = P.parent(p);
    assert.ok(!par || par.verified === false, 'FRS may never yield a verified parent');
  });
});

// ── 4. Garfield's TCEQ operator is not overwritten ─────────────────────────────────────
test('the identifier-backed operator survives the FRS pass unchanged', () => {
  const ops = P.identity(GARFIELD).filter(p => p.role === 'Operator');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].name, 'Martin Marietta Materials Southwest, LLC');
  assert.equal(P.consumerLabel(ops[0].verification), 'Verified');
  const html = P.groupsHTML(GARFIELD);
  assert.match(html, /Martin Marietta Materials Southwest, LLC/);
  assert.match(html, /Parent company: <b>Martin Marietta Materials, Inc\.<\/b>/);
  assert.ok(!/EPA facility records/.test(html), 'no FRS wording belongs on a card with no FRS rows');
});

// ── 5. An FRS zero is an ordinary outcome ──────────────────────────────────────────────
test('a facility with no FRS organization rows renders normally', () => {
  assert.equal(P.frsCurrent(GARFIELD).length, 0);
  assert.equal(P.frsHistory(GARFIELD).length, 0);
  assert.equal(P.historyHTML(GARFIELD), '', 'no history section when there is no history');
  assert.equal(P.frsEvidenceEntries(GARFIELD).length, 0);
  // Absent key, not empty object — the reader path must survive both.
  const bare = { id: 'x', identity: GARFIELD.identity };
  assert.equal(P.frsCurrent(bare).length, 0);
  assert.equal(P.historyHTML(bare), '');
  assert.match(P.groupsHTML(bare), /Martin Marietta Materials Southwest, LLC/);
});

// ── 6. Same-address facilities do not merge ────────────────────────────────────────────
test('FRS rows follow the registry id, so same-address facilities stay separate', () => {
  const g = P.groupsHTML(GARFIELD), c = P.groupsHTML(CEMEX);
  assert.ok(!/CEMEX/i.test(g), 'CEMEX must not appear on the Garfield card');
  assert.ok(!/Martin Marietta/i.test(c), 'the Garfield operator must not appear on the CEMEX card');
  // The anchor is the record's own payload — there is no address-keyed lookup to collide.
  assert.equal(P.frsCurrent(CEMEX)[0].registry_id, '110034344494');
  assert.notEqual(CEMEX.registry_id, GARFIELD.registry_id);
});

// ── 7. Corporate suffixes are not normalized away ──────────────────────────────────────
test('LLC and LTD are different companies and both render', () => {
  const item = {
    id: 'suffix', identity: [],
    frs: {
      current: [
        frsRow({ name: 'ACME MATERIALS SOUTHWEST, LLC', role: 'Operator',
          affiliation_type: 'OPERATOR', program: 'RCRAINFO', program_id: 'A1',
          registry_id: '110000000002', source: 'EPA Facility Registry Service — OPERATOR affiliation reported by RCRAINFO', url: FRS_URL + '110000000002' }),
        frsRow({ name: 'ACME MATERIALS SOUTHWEST, LTD', role: 'Operator',
          affiliation_type: 'OPERATOR', program: 'NPDES', program_id: 'A2',
          registry_id: '110000000002', source: 'EPA Facility Registry Service — OPERATOR affiliation reported by NPDES', url: FRS_URL + '110000000002' })
      ], history: [], parent_candidates: []
    }
  };
  const html = P.groupsHTML(item);
  assert.match(html, /ACME MATERIALS SOUTHWEST, LLC/);
  assert.match(html, /ACME MATERIALS SOUTHWEST, LTD/);
  const groups = P.groups(item);
  assert.equal(groups.length, 1, 'one role');
  assert.equal(groups[0].rows.length, 2, 'two distinct companies under it');
  assert.equal(groups[0].label, 'Operators');
});

// ── 8. A parent candidate inherits nothing ─────────────────────────────────────────────
test('an FRS parent candidate renders no parent line and inherits nothing', () => {
  assert.equal(P.frsParentCandidates(SARWWTP).length, 1);
  const html = P.groupsHTML(SARWWTP);
  assert.ok(!/AUSTIN ENERGY CORP/.test(html), 'a parent candidate is not a card entity');
  assert.ok(!/Parent company: <b>/.test(html), 'a candidate never renders as a verified parent');
  // It IS disclosed — as a lead, with the words that say so.
  const ev = P.frsEvidenceEntries(SARWWTP);
  const cand = ev.find(e => e.entity === 'AUSTIN ENERGY CORP');
  assert.ok(cand, 'the candidate must be visible in the disclosure');
  assert.equal(cand.status, 'Reported');
  assert.match(cand.note, /a lead, not a verified corporate parent/);
  assert.match(cand.note, /nothing about this company is inherited from it/);
});

// ── 9. A former operator is never a current operator ───────────────────────────────────
test('FORMER roles render only in the history section', () => {
  assert.equal(P.frsCurrent(FORMER).length, 0);
  assert.equal(P.frsHistory(FORMER).length, 1);
  const current = P.groupsHTML(FORMER);
  assert.ok(!/OLDCO/.test(current), 'a former operator must not appear under current roles');
  assert.match(current, /not yet available/, 'with no current party the honest empty line stands');
  const hist = P.historyHTML(FORMER);
  assert.match(hist, /Ownership &amp; operator history/);
  assert.match(hist, /OLDCO OPERATING LLC/);
  assert.match(hist, /Operator \(former\)/);
});

// ── 10. A missing END_DATE does not imply "current" ────────────────────────────────────
test('no end date is never rendered as ongoing', () => {
  // ~1.3% of Texas FRS organization rows carry an END_DATE, so a blank one carries no
  // information at all. The wording may say "from"; it may never say "since" or "present".
  assert.equal(P.frsPeriod({ start_date: '01-JAN-99', end_date: null }), 'recorded from 01-JAN-99');
  assert.equal(P.frsPeriod({ start_date: null, end_date: null }), '');
  assert.equal(P.frsPeriod({ start_date: '01-JAN-19', end_date: '31-DEC-22' }), '01-JAN-19 to 31-DEC-22');
  const hist = P.historyHTML(FORMER);          // the fixture's former row HAS no end date
  assert.match(hist, /recorded from 01-JAN-99/);
  assert.ok(!/\bsince\b|\bpresent\b|\bongoing\b|\bstill\b/i.test(textOf(hist).replace(
    'These are not current roles, and an entry without an end date is not evidence that it still applies.', '')),
    'history wording must not imply the relationship continues');
  assert.match(hist, /an entry without an end date is not evidence that it still applies/);
});

// ── 11. The stronger source wins presentation priority ─────────────────────────────────
test('the identifier-backed company is presented first and FRS follows', () => {
  const groups = P.groups(SARWWTP);
  const ops = groups.find(g => g.role === 'Operator');
  assert.ok(ops, 'the operator group exists');
  assert.equal(ops.rows[0].name, 'City of Austin', 'the TCEQ-resolved operator leads');
  // Both tiers happen to read "Reported" here — the arbitration is on the EVIDENCE TIER
  // (authoritative_filing over frs_affiliation), never on the consumer word.
  assert.equal(ops.rows[0].evidence_tier, 'authoritative_filing');
  // The FRS owner is additive — a role TCEQ did not resolve — so it appears as its own group.
  const owner = groups.find(g => g.role === 'Facility Owner');
  assert.ok(owner, 'the FRS-only role still renders');
  assert.equal(owner.rows[0].name, 'AUSTIN ENERGY');
  assert.equal(P.consumerLabel(owner.rows[0].verification), 'Reported');
  assert.ok(groups.indexOf(ops) < groups.indexOf(owner), 'resolved roles are ordered ahead of FRS-only ones');
});

// ── 12. Agreement does not duplicate an entity ─────────────────────────────────────────
test('an FRS row that agrees with a stronger source is shown once', () => {
  const ops = P.groups(SARWWTP).find(g => g.role === 'Operator');
  assert.equal(ops.rows.length, 1, 'City of Austin appears once, not twice');
  const html = P.groupsHTML(SARWWTP);
  assert.equal((html.match(/City of Austin|CITY OF AUSTIN/g) || []).length, 1);
  // The corroboration is not thrown away — it is disclosed as a second source.
  const agree = P.frsEvidenceEntries(SARWWTP).find(e => /also reported by/.test(e.role));
  assert.ok(agree, 'the agreeing row must still be cited');
  assert.equal(agree.entity, 'CITY OF AUSTIN');
  assert.match(agree.note, /A second source names the same company for this role/);
});

// ── 13. Conflicting evidence is preserved, not displayed ───────────────────────────────
test('a conflicting FRS row is kept for review and stays off the card', () => {
  const conflicts = P.frsSuppressed(SARWWTP, 'conflict');
  assert.equal(conflicts.length, 1, 'the conflict is retained in the payload');
  assert.equal(conflicts[0].name, 'TIC - THE INDUSTRIAL COMPANY');
  const html = P.groupsHTML(SARWWTP);
  assert.ok(!/INDUSTRIAL COMPANY/.test(html), 'a construction contractor must not be shown as the operator');
  const ev = P.frsEvidenceEntries(SARWWTP);
  assert.ok(!ev.some(e => /INDUSTRIAL COMPANY/.test(e.entity)),
    'an unresolved contradiction is not put to the reader');
});

// ── 14. No internal enum reaches the consumer surface ──────────────────────────────────
test('no raw evidence enum, tier or key leaks into the rendered card', () => {
  const surfaces = [
    P.groupsHTML(BFI), P.groupsHTML(SARWWTP), P.groupsHTML(CEMEX),
    P.historyHTML(FORMER),
    JSON.stringify(P.frsEvidenceEntries(BFI).map(e => [e.role, e.entity, e.status, e.note]))
  ].join('\n');
  [
    'HIGH_CONFIDENCE', 'UNRESOLVED', 'VERIFIED', 'frs_affiliation', 'identifier_backed',
    'authoritative_filing', 'candidate', 'EPA_FRS', 'suppressed_reason', 'registry_id',
    'PARENT OWNER', 'OWNER/OPERATOR', 'evidence_tier'
  ].forEach(tok => assert.ok(!surfaces.includes(tok), 'leaked internal token: ' + tok));
  // The badge word a reader sees is "Reported", and the source is named in plain English.
  assert.match(P.groupsHTML(BFI), /Reported in EPA facility records/);
  assert.ok(!/\bFRS\b/.test(textOf(P.groupsHTML(BFI))), 'the acronym FRS is not consumer language');
});

// ── The disclosure keeps FULL provenance, which is where the enums belong ──────────────
test('the Sources disclosure carries the full FRS provenance chain', () => {
  const ev = P.frsEvidenceEntries(BFI);
  assert.equal(ev.length, 2);
  const op = ev.find(e => e.entity === 'BFI WASTE SYSTEMS OF TEXAS LP');
  assert.equal(op.org, 'U.S. Environmental Protection Agency — Facility Registry Service (FRS)');
  assert.match(op.document, /FRS registry 110005052085/);
  assert.match(op.document, /affiliation: OPERATOR/);
  assert.match(op.document, /reported by RCRAINFO TXD052648169/);
  assert.match(op.document, /interest: UNSPECIFIED UNIVERSE/);
  assert.match(op.document, /recorded from 23-OCT-06/);
  assert.match(op.document, /TX_ORGANIZATION_FILE\.CSV/);
  assert.equal(op.url, FRS_URL + '110005052085');
  assert.equal(op.status, 'Reported');
});
