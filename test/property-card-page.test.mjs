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
need(!/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/(maplibre|leaflet|chart)/i.test(card),
  'the card page pulls a map or chart library — the donut is inline SVG by CSP rule');

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
need(declared.length >= 12, `HS.card.SECTIONS holds ${declared.length} sections — expected at least 12`);
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
// Every track-record metric goes through it. trackMetrics starts all three values at the
// em-dash and only ever overwrites one via metricText, so there is no assignment that could
// place a raw number in a metric slot.
const tm = (card.match(/function trackMetrics\(id, state, recs\) \{[\s\S]*?\n  \}/) || [''])[0];
need(tm.length > 200, 'trackMetrics could not be located to audit');
need(/vals = labels\.map\(function \(\) \{ return C\.NO_VALUE; \}\)/.test(tm),
  'trackMetrics does not start every metric at the absent marker');
// Arity comes from the source, not from a hardcoded three. The approved design gives SEC and
// State/Local two columns; padding them to three invents a gap those sources do not have.
need(/sec:\s*\['Enforcement matters', 'Penalties'\]/.test(card)
  && /state_local:\s*\['Records', 'Penalties'\]/.test(card),
  'per-source metric arity does not match the approved design (SEC and State/Local have two)');
need(/osha:\s*\['Inspections', 'Violations', 'Penalties'\]/.test(card),
  'OSHA does not carry its own metric set from the design');
need(/labels\.map\(function \(\) \{ return C\.metricText\(state, 0\); \}\)/.test(tm),
  'the checked-empty path pads to a fixed three instead of the source\u2019s own arity');
[...tm.matchAll(/vals\[\d\] = ([^;]+);/g)].forEach((m) => {
  need(/C\.metricText\(/.test(m[1]) || /C\.NO_VALUE/.test(m[1]) || /Number\(vals\[/.test(m[1]),
    `trackMetrics assigns a metric without the metricText gate: vals[..] = ${m[1].trim()}`);
});
need(/C\.isCountable\(state\) && id === 'epa_echo'/.test(tm),
  'trackMetrics computes ECHO counts without first checking the state is countable — it would '
  + 'count for a source that was never queried');
// A measured zero MUST still render as 0, or the card lies in the other direction.
need(/state === 'checked_empty'[\s\S]{0,220}C\.metricText\(state, 0\)/.test(tm),
  'a checked-but-empty source does not render its real, measured 0');
// Each source labels what IT counts: a state registry's programme enrolments must never be
// displayed under "Enforcement actions".
need(/var TRACK_METRICS = \{/.test(card), 'track-record metric labels are not per-source');
// The enrolment problem is now solved more strongly than by relabelling. The cached TCEQ payload
// holds Central Registry PROGRAM ENROLMENTS, and an enrolment is neither a violation nor an
// enforcement action — so trackMetrics has NO state_env branch at all and writes no metric for it,
// rather than writing a count under a softer label. Assert the absence, since that is the guarantee.
need(!/id === 'state_env'/.test(tm),
  'trackMetrics writes a metric for the state registry — its cached payload is programme '
  + 'enrolments, which under any enforcement label reads as an accusation the record does not make');
need(/ENROLMENTS/.test(card) || /enrolment/i.test(tm),
  'nothing records WHY the state registry writes no metric, so a future edit will add one back');

// ── 6b. one state machine, many approved labels ───────────────────────────────
// The design says the same state five different ways. Each module may RELABEL a state; none may
// invent one, or the five vocabularies become five state machines that disagree at the edges.
need(/C\.badgeHTML\(opts\.state, \{ module: id, short: true \}\)/.test(card),
  'section badges do not relabel per module, so the design\u2019s own wording cannot appear');
need(/const MODULE_LABELS = \{/.test(lib), 'per-module labels are not declared in the shared lib');
need(/card\.moduleLabel = function/.test(lib), 'there is no single relabelling entry point');
for (const [mod, label] of [['regulatory-records', 'Data available'],
  ['facility-connections', 'Connections found'], ['sustainability', 'Pilot only']]) {
  need(new RegExp("'" + mod + "'[\\s\\S]{0,400}?" + label).test(lib),
    `the design's "${label}" wording is missing for ${mod}`);
}
// A relabel must not become a new state: every label maps onto a declared state key.
{
  const block = (lib.match(/const MODULE_LABELS = \{[\s\S]*?\n  \};/) || [''])[0];
  for (const m of block.matchAll(/(\w+):\s*'[^']+'/g)) {
    const key = m[1];
    if (['regulatory-records', 'facility-connections', 'sustainability', 'entity-track-record'].includes(key)) continue;
    need(!!HS.card.STATES[key], `MODULE_LABELS relabels "${key}", which is not a declared state`);
  }
}
// The two regulatory counts are the ones most tempting to interpolate raw.
need(/row2\('Facilities with a compliance summary', C\.metricText\(/.test(card),
  'the compliance-summary count is not routed through metricText');
need(/row2\('State registry programs on record', C\.metricText\(/.test(card),
  'the state-programs count is not routed through metricText');
// A hardcoded zero anywhere in a rendered string is the shape of the bug: search for one.
need(!/>0</.test(card.replace(/<circle[^>]*>/g, '')), 'the card page renders a literal 0 into markup');

// Sources & Verification is the PROVENANCE module and must never collapse two states into one
// badge. With { short: true }, `verified` and `checked_empty` both render "Checked", so a source
// that returned records looked identical to one that returned nothing.
need(/var body = '<div class="pcrows">' \+ sources\.map\(function \(s\) \{[\s\S]{0,200}?C\.badgeHTML\(s\.state\)/.test(card),
  'the sources list uses short badge labels, which renders verified and checked-empty identically');
need(HS.card.STATES.verified.short === HS.card.STATES.checked_empty.short,
  'this guard assumes the two SHORT labels collide — if they no longer do, relax it');
need(HS.card.STATES.verified.label !== HS.card.STATES.checked_empty.label,
  'the FULL labels must stay distinct, or nothing can tell the two states apart');

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
need(/Counted by source, unweighted/.test(card),
  'the completeness section does not say it is unweighted');
need(!/percent complete|% complete|completeness score/i.test(card),
  'the card presents completeness as a score — it is a count of sources by research state');

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log('property-card page contract: slide-in links out at the top, panel folds to a quick '
  + 'view with nothing removed, all ' + declared.length + ' declared sections render under their '
  + 'declared tabs, every count is gated by metricText, and owner-of-record never borrows a filed owner.');
