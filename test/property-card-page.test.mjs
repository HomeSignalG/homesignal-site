// Pins the PROPERTY CARD REDESIGN as it ships: the Maps slide-in must expose a link to the
// full card at the TOP of the panel, and the full card must render every declared section with
// its own research state — with no path on which an unchecked source prints a number.
//
// WHY A SOURCE-LEVEL SUITE. HS.card is unit-tested in test/property-card.test.mjs, but a perfect
// library proves nothing about a page that bypasses it. The specific bypass this file forbids is
// a count interpolated straight into the card's HTML (`+ recs.length +`) instead of routed
// through HS.card.metricText — which is how a "0" would reappear next to a source nobody
// queried. Same shape as test/facilities-unavailable-copy.test.mjs, which pins the ZIP page's
// half of exactly this rule.
//
// Run: node test/property-card-page.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The declared structure is IMPORTED, not re-typed: a test that keeps its own copy of the
// section list stops noticing when the list changes, which is the drift it exists to catch.
global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/property-card.js');
const HS = global.window.HS;

const card = readFileSync(join(root, 'property-card.html'), 'utf8');
const maps = readFileSync(join(root, 'maps.html'), 'utf8');
const lib = readFileSync(join(root, 'lib/property-card.js'), 'utf8');
const data = readFileSync(join(root, 'lib/data.js'), 'utf8');
const failures = [];
const need = (cond, msg) => { if (!cond) failures.push(msg); };

// ── 1. the maps slide-in links OUT to the full card, at the top ──────────────────
need(/<script src="lib\/property-card\.js"><\/script>/.test(maps),
  'maps.html does not load lib/property-card.js, so the panel cannot build the card link');
need(/function cardCTA\(it\)\s*\{[\s\S]{0,400}HS\.card\.ctaHTML\(/.test(maps),
  'maps.html builds no card CTA through the shared HS.card.ctaHTML');
// The link must be the FIRST content in the panel — the founder's spec is "a link at the top of
// the slide-in", and a CTA below eight sections is not at the top.
need(/id="infoBack"[^]*?<\/button>'\s*\n\s*\+ cardCTA\(it\)\s*\n\s*\+ summaryHTML/.test(maps),
  'the project detail does not render cardCTA immediately after the back button (top of panel)');
need(/id="infoBack"[^]*?<\/button>'\s*\n\s*\+ cardCTA\(f\)/.test(maps),
  'the facility detail does not render cardCTA at the top of the panel');
// Both entity types the panel can open must offer the card; a facility is a thing at an
// address too, and its parcel question is the same question.
need((maps.match(/\+ cardCTA\(/g) || []).length >= 2,
  'the card link is wired on fewer than both panel detail views (project + facility)');
need(/\.pccta\{/.test(maps), 'maps.html has no styling for the card link');

// ── 2. the slide-in is a QUICK VIEW — the deep sections collapse ─────────────────
need(/function fold\(title, body\)[\s\S]{0,240}<details class="isec fold">/.test(maps),
  'maps.html has no fold() helper, so the panel cannot compact into a quick view');
['Timeline', 'Potential quality-of-life impacts', 'What we know'].forEach((t) => {
  need(new RegExp("fold\\('" + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'").test(maps)
    || new RegExp('fold\\(\'' + t.replace(/'/g, "\\\\'") + '\'').test(maps),
    `the "${t}" section is not folded — the panel stays page-length instead of a quick view`);
});
// COLLAPSED, NOT DELETED. Folding is a presentation change; removing a section would take a
// fact away from residents who can read it today, and the live verifier's four-question check
// (scripts/verify-maps-live.mjs) reads the same DOM.
need(/HS\.whyQaHTML\(wd\)/.test(maps), 'the four why-this-matters questions were removed from the panel');
need(/HS\.whyKnowHTML\(wd\)/.test(maps) && /HS\.whyUnknownHTML\(wd\)/.test(maps),
  'the know/unknown sections were removed from the panel rather than folded');
need(/See the full project page/.test(maps),
  'the full-project-page button was removed — scripts/verify-maps-live.mjs asserts it on the live page');

// ── 3. the card page exists, is shell-native, and is not indexable ──────────────
need(/<meta name="robots" content="noindex, nofollow">/.test(card),
  'property-card.html must be noindex — it is an app surface, not a crawlable page');
need(/<template id="hs-content">/.test(card), 'property-card.html does not use the app shell template');
need(/<script src="lib\/property-card\.js"><\/script>/.test(card), 'the card page does not load its own backbone');
need(/<script src="shell\.js"><\/script>/.test(card), 'the card page does not load the shared shell');
// CSP: script-src self + jsDelivr only (CLAUDE.md §4). No map libs on this page, so no extra hosts.
const csp = (card.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
need(/script-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net;/.test(csp),
  'the card page CSP does not restrict script-src to self + jsDelivr');
need(/connect-src[^;]*qwnnmljucajnexpxdgxr\.supabase\.co/.test(csp),
  'the card page CSP does not allow the Supabase read it needs');
// CHART libraries stay banned — the donut is hand-rolled inline SVG because the CSP allows
// script-src self + jsDelivr only, and a charting dependency would be both unloadable and a
// second opinion about how coverage is drawn. A MAP library is different: the context rail needs
// real tiles, maps.html already ships maplibre from the same origin, and reusing it is what stops
// this page growing a second way to draw a facility.
need(!/cdn\.jsdelivr\.net\/npm\/(chart|d3|plotly|highcharts|apexcharts)/i.test(card),
  'the card page pulls a charting library — the donut is inline SVG by CSP rule');
need(/donutSVG/.test(lib) && /<svg class="pcdonut"/.test(lib),
  'the completeness ring is no longer hand-rolled inline SVG');
// The rail reuses the map page's marker registry rather than restyling facilities here.
need(/HS\.markerSVG\(/.test(card) && /HS\.markerRegistry\.facilityHex/.test(card),
  'the rail draws its own facility markers instead of reusing lib/map.js — two drawings of one fact');
need(/maps\.html remains the one interactive map surface/.test(card),
  'nothing records that the rail is deliberately read-only');

// ── 4. it reads the real cache, and only through the shared accessors ───────────
need(/propertyReport\(addr\)/.test(data) && /from\('property_reports'\)/.test(data),
  'lib/data.js has no property_reports read for the card');
need(/canonicalAddrFor\(zip, rec\)/.test(data),
  'lib/data.js cannot resolve a clicked record to its canonical address');
need(/HS\.data\.propertyReport\(addr\)/.test(card), 'the card page does not read the property_reports cache');
need(!/from\('property_reports'\)/.test(card),
  'the card page queries Supabase directly instead of going through lib/data.js');
// The key is the ENGINE'S canonical address, the same one homesignalmap.html?addr= uses. A page
// that normalized addresses itself would be a second normalizer, which is how two surfaces
// disagree about which row is "this property".
need(/canonical_addr \|\| rec\.location_addr/.test(lib),
  'HS.card.keyOf does not prefer the engine canonical address');
need(/record_url \|\| s\.url\) === url/.test(data),
  'the address resolve matches on something other than the mandatory record URL');

// ── 5. every declared section is rendered, under its declared tab ───────────────
const declared = HS.card.SECTIONS;
// Eleven, not twelve: Parent Company Track Record became an entity GROUP inside Entity Track
// Record rather than a module of its own (founder, 2026-08-12).
need(declared.length >= 11, `HS.card.SECTIONS holds ${declared.length} sections — expected at least 11`);
declared.forEach((s) => {
  need(new RegExp("sec\\('" + s.id + "'").test(card),
    `section "${s.id}" is declared but never rendered by property-card.html`);
});
// ...and nothing is rendered that is NOT declared: sec() warns and drops an unknown id, so an
// undeclared section would silently vanish rather than fail loudly here.
[...card.matchAll(/sec\('([a-z-]+)'/g)].forEach((m) => {
  need(declared.some((s) => s.id === m[1]),
    `property-card.html renders section "${m[1]}", which is not in HS.card.SECTIONS`);
});
// Every tab in the strip must be reachable: the strip is generated from HS.card.TABS.
need(/C\.TABS\.map\(/.test(card), 'the tab strip is not generated from the declared HS.card.TABS');
// Sections render through sec(), which looks each id up in SECTIONS — so a section cannot
// appear under a title or tab the declared structure (and these tests) do not know about.
need(/function sec\(id, opts, body\)[\s\S]{0,400}C\.SECTIONS\.filter/.test(card),
  'sec() does not resolve its title/tab from HS.card.SECTIONS');
need(/data-sec="' \+ esc\(id\)/.test(card) && /data-tab="' \+ esc\(d\.tab\)/.test(card),
  'sections do not carry data-sec/data-tab, so the tab strip cannot filter them');
need(/id === 'overview' \|\| el\.getAttribute\('data-tab'\) === id/.test(card),
  'Overview does not show every section (it is the digest of the whole card)');
need(/role="tablist"/.test(card) && /role="tab"/.test(card) && /aria-selected/.test(card),
  'the tab strip is not accessible (needs tablist/tab/aria-selected)');

// ── 6. THE GATE, on the page: no count reaches the screen except through metricText ──
need(/C\.metricText\(/.test(card), 'the card page never calls HS.card.metricText — nothing is gated');
{
  const ar = (card.match(/function agencyRows\(entity, byId, recs, allRecords\) \{[\s\S]*?\n  \}/) || [''])[0];
  need(ar.length > 400, 'agencyRows could not be located to audit');
  need(/C\.metricText\(st,/.test(ar), 'agency metrics are not routed through the gate');
  // Every value assigned to a metric must come from metricText or be a currency format applied
  // AFTER it — never a raw number interpolated into the row.
  for (const m of ar.matchAll(/text = ([^;]+);/g)) {
    need(/C\.metricText\(/.test(m[1]) || /Number\(text\)/.test(m[1]),
      `agencyRows assigns a metric outside the gate: ${m[1].trim()}`);
  }
  // A measured empty has REAL zeros, or the badge says "Checked" over a row of em-dashes.
  // A checked-empty source has a real COUNT of zero — and no penalty figure, because with no
  // records there is no record stating one. That split is the archive's own rule
  // (docs/government-source-archive.md, "Do not render $0 for a penalty the record does not state").
  need(/if \(!counts && C\.state\(st\) === 'checked_empty'\) counts = \[0, null\];/.test(ar),
    'a checked-but-empty source does not render its measured zero count');
  need(/var money = \/penalt\|fine\|relief\|disgorge\/i\.test\(label\);/.test(ar),
    'monetary metrics are not distinguished, so an empty source renders $0 in penalties');
  need(/if \(money && \(n === null \|\| n === 0\) && C\.state\(st\) === 'checked_empty'\) n = undefined;/.test(ar),
    'an empty source still renders a $0 penalty — forbidden by the archive contract');
  // A PROPERTY-level check is not an ENTITY-level check. Populating entity rows from the
  // address-level state would attribute research we never performed to each company.
  need(/entity\.track && entity\.track\[a\.id\]/.test(ar),
    'entity agency rows are not driven by entity-level checks');
  need(!/byId\[a\.id\]\.state/.test(ar),
    'a property-level check state leaks into the per-entity rows, attributing a query we ran once '
    + 'for the address to every company named on it');
}

// ── 6a. agencies are DATA, so a new one is an entry and not a redesign ────────
need(/card\.AGENCIES = \[/.test(lib), 'the enforcement sources are not a declared registry');
for (const id of ['sec', 'epa_echo', 'osha', 'fincen', 'doj', 'ofac', 'state_env', 'state_local']) {
  need(HS.card.AGENCIES.some((a) => a.id === id), `agency "${id}" is not declared`);
}
HS.card.AGENCIES.forEach((a) => {
  need(!!a.short && !!a.label, `${a.id} needs a short and a full label`);
  need(Array.isArray(a.metrics) && a.metrics.length >= 2,
    `${a.id} must declare its own metrics — arity and wording differ per agency`);
});
// FinCEN is a SOURCE feeding this module, never a module of its own.
need(!HS.card.SECTIONS.some((s) => /fincen/i.test(s.id) || /fincen/i.test(s.title)),
  'FinCEN has become its own Property Card module — it is a data source, not a module');
// The record contract is source-agnostic and carries what attribution needs.
for (const f of ['source_agency', 'entity_name', 'matched_entity_id', 'entity_role',
  'relationship_to_property', 'action_date', 'penalty_amount', 'source_document_url',
  'verification_status']) {
  need(HS.card.ENFORCEMENT_FIELDS.includes(f), `the enforcement contract is missing "${f}"`);
}

// ── 6b. ONE module, grouped by entity — the parent is a group, not a card ─────
need(!HS.card.SECTIONS.some((s) => s.id === 'parent-track-record'),
  'Parent Company Track Record is still a separate module — it must be an entity group inside '
  + 'Entity Track Record');
need(!/parentTrackHTML/.test(card), 'the standalone parent module renderer still exists');
need(/function entityGroupsOf\(row, byId, recs\)/.test(card), 'there is no entity-group builder');
need(/card\.ENTITY_ROLES = \[/.test(lib), 'the entity roles are not declared');
for (const r of ['project_entity', 'parent', 'related']) {
  need(HS.card.ENTITY_ROLES.some((x) => x.id === r), `entity role "${r}" is not declared`);
}
need(HS.card.entityRole('project_entity').required === true,
  'the project entity group must always render — its lack of records is the answer');
need(HS.card.entityRole('related').gated === true, 'related entities must be gated');
need(/role\.gated[\s\S]{0,260}relationship_verification === 'verified'/.test(card),
  'related entities are shown without a verified relationship to the property');
need(/if \(role\.required\)/.test(card),
  'a group with no entity is rendered for every role, which implies a parent exists');
// ONE renderer for every group, or the layouts diverge on the next edit.
need(/function agencyGridHTML\(rows\)/.test(card), 'there is no shared agency-grid renderer');
need((card.match(/agencyGridHTML\(/g) || []).length >= 2,
  'the agency grid is not shared across entity groups');

// ── 6c. ATTRIBUTION — a record belongs to the entity the source document names ─
need(/card\.recordsFor = function/.test(lib), 'there is no attribution gate');
{
  const parent = { id: 'ent-2', name: 'XYZ Holdings Inc.' };
  const project = { id: 'ent-1', name: 'Greenland Energy LLC' };
  const recs = [
    { source_agency: 'FinCEN', entity_name: 'XYZ Holdings Inc.', matched_entity_id: 'ent-2' },
    { source_agency: 'EPA / ECHO', entity_name: 'Greenland Energy LLC', matched_entity_id: 'ent-1' }
  ];
  need(HS.card.recordsFor(recs, parent).length === 1
    && HS.card.recordsFor(recs, parent)[0].source_agency === 'FinCEN',
    'the parent does not receive its own record');
  need(HS.card.recordsFor(recs, project).length === 1
    && HS.card.recordsFor(recs, project)[0].source_agency === 'EPA / ECHO',
    "the project entity does not receive its own record");
  // THE ONE THAT MATTERS: a parent's enforcement action must never land on the project LLC.
  need(!HS.card.recordsFor(recs, project).some((r) => r.source_agency === 'FinCEN'),
    "the parent's FinCEN action is attributed to the project entity — the exact misreading the "
    + 'entity grouping exists to prevent');
  // A NEAR name match is never accepted: a sibling or similarly-named company is not this one.
  need(HS.card.recordsFor(recs, { name: 'Greenland Energy Holdings LLC' }).length === 0,
    'a similar legal name matched, so one company\u2019s record can land on another');
  need(HS.card.recordsFor(recs, { name: 'greenland energy llc' }).length === 1,
    'an exact name match differing only in case failed');
}
// The required empty state names where we looked, so "nothing found" cannot read as "nothing exists".
need(/No verified enforcement records found in currently connected HomeSignal sources\./
  .test(HS.card.COPY.module.noEnforcement), 'the required empty-state sentence is missing');
need(/C\.COPY\.module\.noEnforcement/.test(card), 'the card does not render the required empty state');
need(/formed/i.test(HS.card.COPY.module.entityFormed),
  'there is no formation-date line, so a company incorporated last quarter reads like a clean '
  + 'thirty-year record');


// ── 7. the honest states the page must be able to express ──────────────────────
need(/renderUnresolved/.test(card) && /isn’t tied to a parcel yet/.test(card),
  'the card cannot say "this record has no resolvable parcel" — it would have to guess one');
need(/gap in the source record, not a finding about the/.test(card),
  'the unresolved state does not distinguish a missing record from a finding');
need(/read failure on our side, not a statement about the property/.test(card),
  'a failed load does not say it is a failure rather than an absence');
need(/Not checked/.test(card), 'the card never renders the "Not checked" answer');

// ── 8. owner of record vs owner as filed stay two separate lines ───────────────
// docs/multi-source-evidence-architecture.md Part 25: the card must be able to say
// "Property owner: X (appraisal district)" and "Project owner as filed: Y (permit)" as two
// correct, non-conflicting lines. Today no assessor adapter exists, so the first line must say
// "Not checked" — and must NOT borrow the filed value to look complete.
need(/row2\('Owner of record', parcel && parcel\.owner_of_record\)/.test(card),
  'owner of record is not read from the parcel record alone');
need(/Owner as filed on a permit/.test(card),
  'the filed owner is not labelled as filed, so it could be read as the owner of record');
// The card must EXPLAIN why the two owner lines can differ, in the founder-approved words —
// asserted against HS.card.COPY rather than a hand-typed copy of it, so approved wording and
// rendered wording cannot drift apart.
need(/C\.COPY\.module\.ownerAsFiledCaveat/.test(card),
  'the ownership module does not render the approved owner-as-filed caveat');
need(/often a different company from whoever owns the land/.test(HS.card.COPY.module.ownerAsFiledCaveat),
  'the approved caveat no longer explains that the two owners can differ');
// The one-sentence rule cost this caveat its "and we never substitute one for the other" clause.
// That guarantee is therefore enforced where it actually binds — in code, asserted above — and
// restated in the receipt, never left to the module's single line to carry alone.
need(/owner of record comes from the county appraisal district/i.test(card)
  || /parcelNotRead/.test(card),
  'nothing on the card says where the owner of record would come from');
need(!/owner_of_record[^\n]*\|\|[^\n]*\bowner\b/.test(card),
  'owner of record falls back to a filing’s owner field — the exact conflation Part 25 forbids');

// ── 9. the footer refuses the "this is a grade" reading ───────────────────────
need(/C\.DISCLAIMER/.test(card), 'the card does not render the shared disclaimer');
// Completeness is a PERCENTAGE (founder, 2026-08-12), shown with its x-of-y. The guard is no
// longer "no number" — it is that the number never appears without its denominator, and that it
// is framed as our research rather than as a verdict on the property.
need(/C\.completenessText\(counts\)/.test(card),
  'the completeness figure is not built through completenessText, which is what pairs it with its basis');
need(/class="pcbasis">' \+ esc\(txt\.basis\)/.test(card),
  'the x-of-y basis line is not rendered beside the percentage');
need(/how much of the record we have read, not a judgement about the/.test(card),
  'the completeness section does not say the percentage is about our research, not the property');
need(/Partly-read sources are listed separately and are not counted as read/.test(card),
  'the section does not disclose that partly-read sources are excluded from the numerator');

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log('property-card page contract: slide-in links out at the top, panel folds to a quick '
  + 'view with nothing removed, all ' + declared.length + ' declared sections render under their '
  + 'declared tabs, every count is gated by metricText, and owner-of-record never borrows a filed owner.');
