// Company Identity Resolution — the render contract for resolved corporate roles.
//
// The rules under test are the ones that keep a plausible guess off the card:
//   • a role appears only when a source STATES it (never read off a facility's name);
//   • Property Owner / Developer / Applicant / Operator stay distinct roles;
//   • a Parent Company name renders only for verification === 'verified';
//   • "Neuralink" and "Neuralink Corporation" are different companies;
//   • an as-filed party superseded by a resolved role is not printed twice.
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

// The two live Del Valle shapes, copied from public.v_app_project_identity.
const GARFIELD = {
  id: 'facility-110070182593',
  name: 'TXI - GARFIELD SAND & GRAVEL',
  identity: [
    {
      role: 'Operator', name: 'Martin Marietta Materials Southwest, LLC',
      legal_name: 'Martin Marietta Materials Southwest, LLC',
      entity_type: 'limited liability company', jurisdiction: 'DE',
      verification: 'VERIFIED', evidence_date: '2023-04-13',
      source: 'TCEQ Central Registry — regulated entity RN106540172, customer CN606114726',
      url: 'https://data.texas.gov/resource/msah-s2rv.json?ref_num_txt=RN106540172',
      parent: {
        verification: 'verified', name: 'Martin Marietta Materials, Inc.',
        source: 'SEC Exhibit 21.01 to the FY2025 Form 10-K, filed 2026-02-19',
        url: 'https://www.sec.gov/Archives/edgar/data/916076/000119312526059193/mlm-ex21_01.htm',
        attribution: 'parent_company'
      }
    },
    {
      role: 'Operator', name: 'TXI Operations, LP', legal_name: 'TXI Operations, LP',
      verification: 'VERIFIED', evidence_date: '2012-10-30',
      source: 'TCEQ Central Registry — regulated entity RN106540172, customer CN600125157',
      url: 'https://data.texas.gov/resource/msah-s2rv.json?ref_num_txt=RN106540172',
      parent: { verification: 'unverified_candidate' }
    }
  ]
};

const ATX1 = {
  id: 'proj-atx1',
  name: 'ATX1 New Construction',
  identity: [{
    role: 'Property Owner', name: 'Neuralink', verification: 'HIGH_CONFIDENCE',
    source: 'TDLR TABS project TABS2024022676 — OWNER block',
    url: 'https://www.tdlr.texas.gov/TABS/Projects/TABS2024022676',
    parent: { verification: 'unverified_candidate' }
  }],
  parties: [
    { role: 'Owner', name: 'Neuralink', phone: '(813) 758-6679', address: '2200 Caldwell Lane, Del Valle, Texas 78617' },
    { role: 'Contact', name: 'Scott Padilla' },
    { role: 'Filed By', name: 'Brian Conklin' },
    { role: 'Design Firm', name: 'Studio8 Architects', address: '1608 West 5th Street Suite 100, Austin, Texas 78703' }
  ]
};

test('identity() keeps only the four resolved roles, most recent evidence first', () => {
  const rows = P.identity(GARFIELD);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.name),
    ['Martin Marietta Materials Southwest, LLC', 'TXI Operations, LP']);
  // length, not deepEqual: an array built inside the vm sandbox has that realm's
  // Array.prototype, which deepStrictEqual treats as a different type.
  assert.equal(P.identity({ identity: [{ role: 'Design Firm', name: 'X' }] }).length, 0);
  assert.equal(P.identity({}).length, 0);
});

test('identity() orders Property Owner before Operator', () => {
  const mixed = { identity: [
    { role: 'Operator', name: 'B' },
    { role: 'Property Owner', name: 'A' }
  ] };
  assert.deepEqual(P.identity(mixed).map(r => r.role), ['Property Owner', 'Operator']);
});

test('a verified parent renders its name; an unverified one never does', () => {
  const [mlm, txi] = P.identity(GARFIELD);
  assert.equal(P.parent(mlm).verified, true);
  assert.equal(P.parent(mlm).name, 'Martin Marietta Materials, Inc.');
  assert.equal(P.parent(txi).verified, false);
  assert.equal(P.parent(txi).name, undefined);

  const html = P.groupsHTML(GARFIELD);
  assert.match(html, /Martin Marietta Materials, Inc\./);
  // The unverified one prints no parent line at all now (UX pass) — its open question
  // lives in Sources & verification instead.
  assert.equal((html.match(/Parent company/g) || []).length, 1);
});

test('an unverified-candidate parent NEVER leaks a candidate name into the markup', () => {
  // The database CHECK keeps parent_name null for a candidate; this is the render-side
  // second gate, for a hand-built or future object that carries one anyway.
  const leaky = { role: 'Operator', name: 'Child Co',
    parent: { verification: 'unverified_candidate', name: 'Guessed Parent Inc.' } };
  assert.equal(P.parent(leaky).verified, false);
  assert.doesNotMatch(P.entityHTML(leaky), /Guessed Parent Inc\./);
});

test('a person or vendor role is not asked the parent question at all', () => {
  assert.equal(P.parent({ role: 'Contact', name: 'Scott Padilla' }), null);
  assert.equal(P.parent({ role: 'Filed By', name: 'Brian Conklin' }), null);
  assert.equal(P.parent({ role: 'Design Firm', name: 'Studio8 Architects' }), null);
  assert.doesNotMatch(P.entityHTML({ role: 'Contact', name: 'Scott Padilla' }), /Parent company/);
});

test('every identity role IS parent-eligible', () => {
  for (const r of P.IDENTITY_ROLES) assert.equal(P.parentEligible(r), true, r);
});

test('filed() drops the as-filed Owner the identity layer superseded, keeps the rest', () => {
  const filed = P.filed(ATX1);
  assert.deepEqual(filed.map(p => p.role), ['Contact', 'Filed By', 'Design Firm']);
  // and with no identity resolved, nothing is dropped
  const bare = { parties: ATX1.parties };
  assert.equal(P.filed(bare).length, 4);
});

test('name normalization folds case and punctuation only — suffixes stay significant', () => {
  // Same company, different casing on the filing: superseded.
  const cased = { identity: [{ role: 'Property Owner', name: 'RIVER BOTTOMS RANCH LLC' }],
                  parties: [{ role: 'Owner', name: 'River Bottoms Ranch LLC' }] };
  assert.equal(P.filed(cased).length, 0);
  // Suffix difference: a DIFFERENT company, so the filed row survives.
  const suffix = { identity: [{ role: 'Property Owner', name: 'Neuralink Corporation' }],
                   parties: [{ role: 'Owner', name: 'Neuralink' }] };
  assert.equal(P.filed(suffix).length, 1);
  assert.equal(P.filed(suffix)[0].name, 'Neuralink');
});

test('internal states map to consumer words: Verified / Reported / Not yet verified', () => {
  assert.equal(P.consumerLabel('VERIFIED'), 'Verified');
  assert.equal(P.consumerLabel('HIGH_CONFIDENCE'), 'Reported');
  assert.equal(P.consumerLabel('UNRESOLVED'), 'Not yet verified');
  assert.equal(P.consumerLabel(undefined), '');
  const atx = P.groupsHTML(ATX1);
  assert.match(atx, /Reported in a state licensing filing \(TDLR\)/);
  assert.doesNotMatch(atx, /✓ Verified/);
  assert.match(P.groupsHTML(GARFIELD), /✓ Verified/);
});

test('no internal enum, key or endpoint reaches anything the reader SEES', () => {
  const entries = P.evidenceEntries(P.identity(GARFIELD).concat(P.identity(ATX1)));
  // Everything visible: the card, plus every disclosure field EXCEPT `url` — the source
  // link is allowed to be a machine URL, it is just never the label a person reads.
  const visible = P.groupsHTML(GARFIELD) + P.groupsHTML(ATX1) + JSON.stringify(
    entries.map(e => ({ r: e.role, e: e.entity, s: e.status, o: e.org, d: e.document, n: e.note })));
  for (const leak of ['HIGH_CONFIDENCE', 'UNRESOLVED', 'VERIFIED', 'unverified_candidate',
                      'not_yet_asked', 'company_key', 'app_company_key', 'high confidence',
                      'msah-s2rv', 'data.texas.gov', 'efservice', 'property_company_roles']) {
    assert.ok(visible.indexOf(leak) === -1, 'leaked internal token: ' + leak);
  }
  assert.doesNotMatch(visible, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    'no record UUID is shown');
  // the link itself survives, in the one field meant for it
  assert.ok(entries.some(e => /^https:\/\//.test(e.url)), 'source links are preserved');
});

test('a Reported row names a recognizable agency, not an endpoint', () => {
  assert.equal(P.sourceOrg({ source: 'TCEQ Central Registry — RN106540172' }).short, 'TCEQ');
  assert.equal(P.sourceOrg({ source: 'TDLR TABS project TABS2024022676 — OWNER block' }).short, 'TDLR');
  assert.equal(P.sourceOrg({ source: 'SEC Exhibit 21.01 to the FY2025 Form 10-K' }).short, 'SEC');
  assert.equal(P.sourceOrg({ source: 'something unmapped' }).short, '');
  assert.equal(P.evidenceLine({ verification: 'HIGH_CONFIDENCE', source: 'something unmapped' }),
    'Reported in an official filing');
});

test('roles group once, with singular and plural labels', () => {
  const g = P.groups(GARFIELD);
  assert.equal(g.length, 1, 'both operators sit under ONE role group');
  assert.equal(g[0].label, 'Operators');
  assert.equal(g[0].rows.length, 2);
  assert.equal(P.groups(ATX1)[0].label, 'Property owner');
  // and each entity keeps its own block — neither is collapsed or overwritten
  const html = P.groupsHTML(GARFIELD);
  assert.match(html, /Martin Marietta Materials Southwest, LLC/);
  assert.match(html, /TXI Operations, LP/);
  assert.equal((html.match(/class="pent"/g) || []).length, 2);
  assert.equal((html.match(/class="prole"/g) || []).length, 1);
});

test('a record with no party information says so once, not once per role', () => {
  const html = P.groupsHTML({ id: 'x', name: 'GARFIELD ESTATES' });
  assert.match(html, /not yet available/i);
  assert.equal((html.match(/class="prow"/g) || []).length, 0);
  for (const role of ['Property owner', 'Developer', 'Applicant', 'Operator']) {
    assert.ok(html.indexOf(role) === -1, 'no empty row for ' + role);
  }
});

test('a role no source names is never rendered as an empty row', () => {
  const only = P.groupsHTML(ATX1);
  assert.match(only, /Property owner/);
  for (const missing of ['Developer', 'Applicant', 'Operator']) {
    assert.ok(only.indexOf(missing) === -1, missing + ' has no row');
  }
});

test('the disclosure keeps the evidence, the dates and the link', () => {
  const e = P.evidenceEntries(P.identity(GARFIELD));
  const op = e.find(x => x.entity === 'Martin Marietta Materials Southwest, LLC' && x.role === 'Operator');
  assert.equal(op.status, 'Verified');
  assert.equal(op.org, 'Texas Commission on Environmental Quality (TCEQ)');
  assert.match(op.document, /RN106540172/);
  assert.match(op.url, /^https:\/\//);
  assert.equal(op.filed, '2023-04-13');
  const par = e.find(x => /^Parent company of/.test(x.role) && x.status === 'Verified');
  assert.equal(par.entity, 'Martin Marietta Materials, Inc.');
  assert.match(par.note, /not ownership of the property/);
  assert.match(P.REPORTED_EXPLAINER, /^Reported —/);
});

test('an as-filed party with no verification renders no badge', () => {
  assert.doesNotMatch(P.entityHTML({ role: 'Design Firm', name: 'Studio8 Architects' }), /class="pver/);
});

test('the legal name is printed only when it differs from the name as filed', () => {
  const html = P.groupsHTML(GARFIELD);
  // legal_name equals name on both rows, so it must not be duplicated
  assert.equal((html.match(/TXI Operations, LP/g) || []).length, 1);
  const diff = P.entityHTML({ role: 'Operator', name: 'Acme', legal_name: 'Acme Holdings, LLC' });
  assert.match(diff, /Acme Holdings, LLC/);
});

test('the disclosure covers every resolved role, and as-filed parties add none', () => {
  const rows = P.evidenceEntries(P.identity(GARFIELD));
  assert.equal(rows.filter(r => r.role === 'Operator').length, 2);
  assert.equal(rows.filter(r => /^Parent company of/.test(r.role) && r.status === 'Verified').length, 1);
  assert.equal(rows.filter(r => /^Parent company of/.test(r.role) && r.status === 'Not yet verified').length, 1);
  // legacy as-filed parties carry no source of their own, so they add no entry
  assert.equal(P.evidenceEntries(ATX1.parties).length, 0);
});

test('a record with no resolved identity renders no identity rows at all', () => {
  const bare = { id: 'x', name: 'GARFIELD ESTATES' };
  assert.equal(P.identity(bare).length, 0);
  assert.equal(P.groups(bare).length, 0);
  assert.equal(P.evidenceEntries(P.identity(bare)).length, 0);
});

test('a government body is not asked the parent question', () => {
  const city = { role: 'Operator', name: 'City of Austin', entity_type: 'municipality',
                 verification: 'HIGH_CONFIDENCE' };
  assert.equal(P.parent(city), null);
  assert.doesNotMatch(P.entityHTML(city), /Parent company/);
  // a private company in the same role still gets the question
  assert.equal(P.parent({ role: 'Operator', name: 'Cinco J., Inc.' }).verified, false);
});

test('both maps.html detail renderers build the roles section from the SAME helper', () => {
  // The facility panel is a separate renderer, and it originally had no roles section at
  // all — which hid the strongest result in the pilot (an EPA facility whose operator is a
  // verified Martin Marietta subsidiary). One builder, used twice, is what keeps the
  // development card and the facility card from disagreeing about who a record belongs to.
  const src = readFileSync(new URL('../maps.html', import.meta.url), 'utf8');
  const body = src.replace(/^\s*\/\/.*$/gm, '');            // ignore explanatory comments
  const def = (body.match(/function whoSection\s*\(/g) || []).length;
  assert.equal(def, 1, 'exactly one whoSection builder');
  const detail = body.slice(body.indexOf('function renderDetail'));
  const fac = body.slice(body.indexOf('function renderFacilityDetail'),
                         body.indexOf('function applyDeepId'));
  assert.match(detail, /whoSection\(/, 'development detail uses the shared builder');
  assert.match(fac, /whoSection\(/, 'facility detail uses the shared builder');
  // and neither hand-rolls the party markup any more
  assert.doesNotMatch(fac, /HS\.parties\.(groupsHTML|entityHTML)/);
});

// ── consumer presentation (UX pass) ─────────────────────────────────────────
test('a parent never replaces the direct company, and sits under the right one', () => {
  // Two operators, only one with a verified parent. The parent must attach to THAT one.
  const html = P.groupsHTML(GARFIELD);
  const mlm = html.indexOf('Martin Marietta Materials Southwest, LLC');
  const par = html.indexOf('Martin Marietta Materials, Inc.');
  const txi = html.indexOf('TXI Operations, LP');
  assert.ok(mlm < par, 'the subsidiary renders before its parent');
  assert.ok(par < txi, 'the parent sits inside the first operator block, not after both');
  // and it is nested in that entity's own block
  const firstBlock = html.slice(mlm, txi);
  assert.match(firstBlock, /Parent company: <b>Martin Marietta Materials, Inc\.<\/b>/);
});

test('the section heading is about the property, and evidence words are plain', () => {
  const html = P.groupsHTML(GARFIELD) + P.groupsHTML(ATX1);
  assert.match(html, /Confirmed in state environmental records \(TCEQ\)/);
  assert.match(html, /Reported in a state licensing filing \(TDLR\)/);
  // the words a reader must never see
  assert.doesNotMatch(html, /match confidence|verification enum|company key/i);
});

test('singular and plural role labels', () => {
  assert.equal(P.roleLabel('Operator', 1), 'Operator');
  assert.equal(P.roleLabel('Operator', 2), 'Operators');
  assert.equal(P.roleLabel('Property Owner', 1), 'Property owner');
  assert.equal(P.roleLabel('Property Owner', 3), 'Property owners');
  assert.equal(P.roleLabel('Design Firm', 2), 'Design firms');
  assert.equal(P.roleLabel('Filed By', 2), 'Filed by');      // no "Filed Bys"
});

test('two owners in the same role render independently, neither overwritten', () => {
  const two = { identity: [
    { role: 'Property Owner', name: 'First Owner LLC', verification: 'VERIFIED',
      source: 'Travis County deed record', url: 'https://example.gov/1' },
    { role: 'Property Owner', name: 'Second Owner LLC', verification: 'HIGH_CONFIDENCE',
      source: 'TDLR TABS owner block', url: 'https://example.gov/2' }
  ] };
  const g = P.groups(two);
  assert.equal(g.length, 1);
  assert.equal(g[0].label, 'Property owners');
  const html = P.groupsHTML(two);
  assert.match(html, /First Owner LLC/);
  assert.match(html, /Second Owner LLC/);
  assert.equal((html.match(/class="pent"/g) || []).length, 2);
  // each keeps its OWN evidence state — the stronger one does not cover for the weaker
  assert.match(html, /Confirmed in Travis County property records/);
  assert.match(html, /Reported in a state licensing filing \(TDLR\)/);
});

test('the empty state does not claim a search concluded there is no owner', () => {
  const msg = P.EMPTY_MESSAGE;
  assert.match(msg, /not yet available/i);
  for (const wrong of ['no owner', 'none', 'no company', 'does not have']) {
    assert.ok(msg.toLowerCase().indexOf(wrong) === -1, 'must not assert absence: ' + wrong);
  }
});

test('the disclosure explains Reported in plain, neutral words', () => {
  assert.match(HS.parties.REPORTED_EXPLAINER, /named in an official filing/);
  assert.match(HS.parties.REPORTED_EXPLAINER, /not been independently confirmed/);
});

test('maps.html renders the section from the shared contract only', () => {
  const src = readFileSync(new URL('../maps.html', import.meta.url), 'utf8');
  const body = src.replace(/^\s*\/\/.*$/gm, '');
  // no hand-rolled status words in the page — they all come from consumerLabel()
  assert.doesNotMatch(body, /HIGH_CONFIDENCE|UNRESOLVED/);
  assert.match(body, /HS\.parties\.groupsHTML\(/);
  assert.match(body, /HS\.parties\.evidenceEntries\(/);
});
