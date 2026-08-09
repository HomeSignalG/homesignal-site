// Pins the ROLE contract behind the Maps "Who's behind it" block (2026-08-09).
//
// The defect this exists to prevent: one column (`developer`) rendered under one label
// ("Developer / applicant") while holding whatever the connector happened to supply —
// for a TDLR TABS filing that is the OWNER, and for an EPA facility it is the SOURCE
// STRING. Calling an owner an applicant is a factual claim the record does not make.
//
// The rule these assertions enforce: a role word is only ever the SOURCE's own role
// word, and a role with no evidence is absent — never borrowed from a neighbouring one.
// Run: node --test test/party-roles.test.mjs
import test from 'node:test';
import assert from 'node:assert';

global.window = { HS: {} };
await import('../lib/templates.js');   // esc / fmtDate / daysUntil
await import('../lib/why.js');
const HS = global.window.HS;

// A verbatim production row: app_projects for TABS2024022676, ZIP 78617, after the
// app_refresh_zip fix. `parties` is exactly what public.app_site_parties() emitted.
const tabsRow = {
  id: 'd29aaf06', type: 'industrial', name: 'ATX1 New Construction',
  status: 'Active', stage: 'Review Complete',
  developer: 'Neuralink',              // the legacy single column, still populated
  lat: 30.21513, lng: -97.5391859,
  source_ref: 'https://www.tdlr.texas.gov/TABS/Projects/TABS2024022676',
  parties: [
    { role: 'Owner', name: 'Neuralink', phone: '(813) 758-6679', address: '2200 Caldwell Lane, Del Valle, Texas 78617' },
    { role: 'Contact', name: 'Scott Padilla' },
    { role: 'Filed By', name: 'Brian Conklin' },
    { role: 'Design Firm', name: 'Studio8 Architects', phone: '(845) 239-1687', address: '1608 West 5th Street Suite 100, Austin, Texas 78703' }
  ]
};

test('parties are named with the source\'s own role word, never a substituted one', () => {
  const know = HS.whyDerive(tabsRow, {}).know.join(' | ');

  // The filing says OWNER. It must read Owner.
  assert.match(know, /Owner on file: Neuralink/, 'TDLR OWNER renders as Owner');
  assert.doesNotMatch(know, /Applicant on file/,
    'an owner is never relabelled applicant when parties are present');
  assert.doesNotMatch(know, /Developer on file/,
    'a developer is never asserted from an owner');

  // Every role the record states, and only those.
  assert.match(know, /Contact on file: Scott Padilla/);
  assert.match(know, /Filed By on file: Brian Conklin/);
  assert.match(know, /Design Firm on file: Studio8 Architects/);

  // Roles the schema supports but no wired source states must never appear.
  for (const absent of ['Operator', 'Parent Company', 'Tenant']) {
    assert.doesNotMatch(know, new RegExp(absent + ' on file'),
      absent + ' has no evidence in any source and must not be emitted');
  }
});

test('a record with no parties falls back to the legacy single field, unchanged', () => {
  const legacy = Object.assign({}, tabsRow, { parties: undefined });
  const know = HS.whyDerive(legacy, {}).know.join(' | ');
  // Rows materialised before `parties` existed keep their historical wording rather
  // than silently gaining a role the old column never distinguished.
  assert.match(know, /Applicant on file: Neuralink/);
  assert.doesNotMatch(know, /Owner on file/);
});

test('an empty or malformed parties array fabricates nothing', () => {
  for (const bad of [[], null, 'Neuralink', [{ name: 'No role' }], [{ role: 'Owner' }]]) {
    const row = Object.assign({}, tabsRow, { parties: bad, developer: undefined });
    const know = HS.whyDerive(row, {}).know.join(' | ');
    // Only the PARTY lines are under test here — "Status on file" / "Stage on file"
    // are record facts and must survive.
    assert.doesNotMatch(know, /(Owner|Contact|Filed By|Design Firm|Applicant|Developer) on file: /,
      'no party line from ' + JSON.stringify(bad) + ' — a half-formed entry is not evidence');
  }
});
