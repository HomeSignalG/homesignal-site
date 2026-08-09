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

  const html = P.rowsHTML(P.identity(GARFIELD));
  assert.match(html, /Martin Marietta Materials, Inc\./);
  assert.match(html, /Not yet verified/);
});

test('an unverified-candidate parent NEVER leaks a candidate name into the markup', () => {
  // The database CHECK keeps parent_name null for a candidate; this is the render-side
  // second gate, for a hand-built or future object that carries one anyway.
  const leaky = { role: 'Operator', name: 'Child Co',
    parent: { verification: 'unverified_candidate', name: 'Guessed Parent Inc.' } };
  assert.equal(P.parent(leaky).verified, false);
  assert.doesNotMatch(P.rowsHTML([leaky]), /Guessed Parent Inc\./);
});

test('a person or vendor role is not asked the parent question at all', () => {
  assert.equal(P.parent({ role: 'Contact', name: 'Scott Padilla' }), null);
  assert.equal(P.parent({ role: 'Filed By', name: 'Brian Conklin' }), null);
  assert.equal(P.parent({ role: 'Design Firm', name: 'Studio8 Architects' }), null);
  assert.doesNotMatch(P.rowsHTML([{ role: 'Contact', name: 'Scott Padilla' }]), /Parent company/);
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

test('verification is shown in words, and only VERIFIED gets the verified class', () => {
  assert.equal(P.verificationWord('VERIFIED'), 'Verified');
  assert.equal(P.verificationWord('HIGH_CONFIDENCE'), 'High confidence');
  assert.equal(P.verificationWord('UNRESOLVED'), 'Unresolved');
  assert.equal(P.verificationWord(undefined), '');
  const html = P.rowsHTML(P.identity(ATX1));
  assert.match(html, /High confidence/);
  assert.doesNotMatch(html, /vverified/);
  assert.match(P.rowsHTML(P.identity(GARFIELD)), /vverified/);
});

test('an as-filed party with no verification renders no badge', () => {
  assert.doesNotMatch(P.rowsHTML([{ role: 'Design Firm', name: 'Studio8 Architects' }]), /class="pver/);
});

test('the legal name is printed only when it differs from the name as filed', () => {
  const html = P.rowsHTML(P.identity(GARFIELD));
  // legal_name equals name on both rows, so it must not be duplicated
  assert.equal((html.match(/TXI Operations, LP/g) || []).length, 1);
  const diff = P.rowsHTML([{ role: 'Operator', name: 'Acme', legal_name: 'Acme Holdings, LLC' }]);
  assert.match(diff, /Acme Holdings, LLC/);
});

test('evidenceRows cites each resolved role and each verified parent, and nothing else', () => {
  const rows = P.evidenceRows(P.identity(GARFIELD));
  const labels = rows.map(r => r.label);
  assert.ok(labels.includes('Operator — Martin Marietta Materials Southwest, LLC'));
  assert.ok(labels.includes('Operator — TXI Operations, LP'));
  assert.ok(labels.includes('Parent of Martin Marietta Materials Southwest, LLC'));
  assert.equal(labels.filter(l => /^Parent of/.test(l)).length, 1);   // the candidate cites nothing
  assert.match(rows[0].value, /TCEQ Central Registry/);
  assert.match(rows[0].value, /\(Verified\)/);
  // legacy as-filed parties carry no source, so they add no evidence row
  assert.equal(P.evidenceRows(ATX1.parties).length, 0);
});

test('a record with no resolved identity renders no identity rows at all', () => {
  const bare = { id: 'x', name: 'GARFIELD ESTATES' };
  assert.equal(P.identity(bare).length, 0);
  assert.equal(P.rowsHTML(P.identity(bare)), '');
  assert.equal(P.evidenceRows(P.identity(bare)).length, 0);
});

test('a government body is not asked the parent question', () => {
  const city = { role: 'Operator', name: 'City of Austin', entity_type: 'municipality',
                 verification: 'HIGH_CONFIDENCE' };
  assert.equal(P.parent(city), null);
  assert.doesNotMatch(P.rowsHTML([city]), /Parent company/);
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
  assert.doesNotMatch(fac, /HS\.parties\.rowsHTML/);
  assert.doesNotMatch(detail.slice(0, detail.indexOf('function whoSection') + 1 || undefined), /class="plist"/);
});
