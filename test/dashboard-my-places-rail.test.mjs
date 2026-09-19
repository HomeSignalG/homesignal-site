// UNIFIED MY PLACES RAIL — one card, three typed groups, and the invariants that make the
// merge safe. Run: node test/dashboard-my-places-rail.test.mjs
//
// WHY THIS FILE EXISTS. The Dashboard's two rail cards ("My Places" and "Projects") are now
// ONE card carrying Property Addresses, ZIP Codes and Developments. Every defect that merge
// could introduce is SILENT:
//   * a Development leaking into canonicalPlaces or queryZips, which would change the
//     monitored-place count in the header AND the ZIP fan-out every content read uses;
//   * a group count taken from the VISIBLE rows instead of the collection, so a capped or
//     failed group quietly under-reports what the resident saved;
//   * an overflow link that promises rows it cannot show, or one rendered when nothing is
//     hidden at all;
//   * an unresolved follow either vanishing (count and rows disagree) or keeping a link to
//     a dossier that does not exist;
//   * "Developments · 0" asserted for an account the page could not read.
// None of those throw. So the rules live in lib/dashboard-aggregate.js as pure functions and
// this file drives that SHIPPED code directly, plus a comment-stripped read of the markup.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const A = require('../lib/dashboard-aggregate.js');

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 240) : ''));
  if (!c) fails++;
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(join(root, f), 'utf8');
// Every presentation assertion runs on a comment-stripped copy: a comment explaining why a
// string is absent must never satisfy a check that it is absent.
const strip = (x) => x
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const dashRaw = read('dashboard.html');
const dash = strip(dashRaw);
const agg = strip(read('lib/dashboard-aggregate.js'));

// POSITIVE CONTROL. Every absence below is read off these files; a mis-resolved path would
// make all of them vacuously true — success-shaped output attesting to nothing.
ok(dashRaw.length > 10000 && /id="dashPlaces"/.test(dash) && typeof A.placeGroups === 'function',
  'the files under test are real and the shipped view-model loaded',
  { bytes: dashRaw.length, hasPlaceGroups: typeof A.placeGroups });

const addr = (id, zip) => ({ kind: 'address', id: 'address:' + id, placeId: id, zip: zip, label: id, sub: null });
const zipp = (z) => ({ kind: 'zip', id: 'zip:' + z, placeId: z, zip: z, label: 'ZIP ' + z, sub: z });

// =====================================================================================
console.log('\n--- §1 MEMBERSHIP IS UNTOUCHED — the whole point of the merge -------------');
// =====================================================================================
// A Development is not a Place. If this ever stops being true the header count, the ZIP
// fan-out, the per-record attribution and Fix 8K's completeness label all change together.
const mixedPlaces = [addr('a1', '78617'), addr('a2', '78657'), zipp('78617'), zipp('75009')];
ok(A.canonicalPlaces({ properties: [{ id: 'p1', address: 'A', zip: '78617' }], followedZips: [{ zip: '75009' }] })
    .every((p) => p.kind === 'address' || p.kind === 'zip'),
  '1a canonicalPlaces yields only address and zip kinds — never a development');
ok(!/development|project/i.test(
     agg.slice(agg.indexOf('function canonicalPlaces'), agg.indexOf('function queryZips'))),
  '1b canonicalPlaces names no development/project concept at all');
ok(!/development|project/i.test(
     agg.slice(agg.indexOf('function queryZips'), agg.indexOf('function placesForZip'))),
  '1c queryZips names no development/project concept at all');
// The rail groups are a VIEW over the same array — they must not be able to feed it back.
ok(A.queryZips(mixedPlaces).join(',') === '78617,78657,75009',
  '1d queryZips still derives ZIPs from places only, deduped', A.queryZips(mixedPlaces));
ok(/A\.developmentsGroup\(/.test(dash) && !/canonicalPlaces\([\s\S]{0,200}following/.test(dash),
  '1e the page builds the Developments group separately from membership');

// =====================================================================================
console.log('\n--- §2 GROUP COUNTS ARE THE COLLECTION, NOT THE VISIBLE SLICE -------------');
// =====================================================================================
const five = [addr('a1', '1'), addr('a2', '2'), addr('a3', '3'), addr('a4', '4'), addr('a5', '5')];
const g5 = A.placeGroups(five)[0];
ok(g5.count === 5, '2a count is the whole collection', g5.count);
ok(g5.visible.length === 3, '2b at most three rows preview', g5.visible.length);
ok(g5.overflow === 2 && g5.hasOverflow === true, '2c overflow is what is NOT shown', g5);
ok(A.RAIL_PREVIEW_LIMIT === 3, '2d the preview limit is three', A.RAIL_PREVIEW_LIMIT);
// Exactly at the limit: nothing hidden, so no control. An overflow link that promises
// nothing is the defect this guards against.
const g3 = A.placeGroups([addr('a1', '1'), addr('a2', '2'), addr('a3', '3')])[0];
ok(g3.count === 3 && g3.overflow === 0 && g3.hasOverflow === false,
  '2e a group of exactly three hides nothing and renders no overflow control', g3);

// THE COUNT SURVIVES A FAILED READ. projectsByIds swallows a rejection into [], so counting
// returned rows would report a total read failure as "you follow nothing".
const failedRead = A.followingCards({ ids: ['x', 'y', 'z', 'w'], rows: [], cap: A.RAIL_PREVIEW_LIMIT });
const devFailed = A.developmentsGroup(failedRead);
ok(devFailed.count === 4, '2f a failed Development read still reports the true count', devFailed.count);
ok(devFailed.visible.length === 3 && devFailed.visible.every((c) => c.unresolved),
  '2g ...and renders unresolved rows rather than an empty group', devFailed.visible.length);
ok(devFailed.overflow === 1 && devFailed.hasOverflow === true,
  '2h ...with a truthful overflow remainder', devFailed);

// =====================================================================================
console.log('\n--- §3 OVERFLOW ROUTES TO THE EXISTING FILTERED VIEWS ---------------------');
// =====================================================================================
const [gAddr, gZip] = A.placeGroups(five);
ok(gAddr.href === 'properties.html?view=addresses', '3a Addresses overflow route', gAddr.href);
ok(gZip.href === 'properties.html?view=zips', '3b ZIP Codes overflow route', gZip.href);
ok(A.developmentsGroup(failedRead).href === 'properties.html?view=projects',
  '3c Developments overflow keeps the INTERNAL ?view=projects route');
ok(gAddr.overflowLabel === 'View all 5 Addresses →',
  '3d the overflow label names the complete count, not the hidden remainder', gAddr.overflowLabel);
// An anchor, never Fix 8K's in-place button: this one navigates, and two controls that look
// alike but behave differently is the comprehension failure.
ok(/class="railmore" href=/.test(dash), '3e the overflow control is an anchor');
ok(!/railmore[^>]*aria-expanded/.test(dash), '3f ...carrying no aria-expanded');
ok(/\.railmore:focus-visible\{[^}]*outline/.test(dashRaw),
  '3g ...with its own focus-visible ring, since it is a new navigable target');

// =====================================================================================
console.log('\n--- §4 UNRESOLVED DEVELOPMENTS — visible, counted, and NOT a destination --');
// =====================================================================================
const oneBad = A.followingCards({ ids: ['good', 'bad'], rows: [{ id: 'good', name: 'Pearce Lane', zip: '78617' }], cap: 3 });
ok(oneBad.total === 2 && oneBad.cards.length === 2, '4a both follows are accounted for', oneBad.total);
ok(oneBad.cards[1].unresolved === true && oneBad.cards[1].zip === null,
  '4b the unresolved one is flagged and invents no ZIP', oneBad.cards[1]);
ok(oneBad.cards[1].title === 'Followed development',
  '4c ...and is named in resident-facing terms', oneBad.cards[1].title);
// ⚠️ THESE TWO WERE NOT LOAD-BEARING AND A MUTATION PROVED IT. The first version asserted
// only that the string `placerow--unresolved` APPEARED somewhere after the branch opened, so
// adding `href="development.html"` to that very element left both assertions green — the exact
// defect the route guard exists to forbid. A pin must read the STATEMENT it is about, not a
// substring near it. The branch body is extracted and the negatives are asserted against it,
// with 4d0 as the positive control so an extraction that silently returned '' could not make
// every negative pass over nothing.
const unresolvedBranch = (dash.match(/if \(c\.unresolved\) \{([\s\S]*?)\n\s*\}/) || ['', ''])[1];
ok(unresolvedBranch.indexOf('placerow--unresolved') !== -1,
  '4d0 CONTROL: the unresolved branch was actually extracted', unresolvedBranch.slice(0, 120));
ok(/return '<div class="placerow placerow--unresolved"/.test(unresolvedBranch)
   && !/<a\b/.test(unresolvedBranch) && !/href/.test(unresolvedBranch),
  '4d an unresolved row renders as a div and carries no href — it is not a destination',
  unresolvedBranch.trim());
ok(/<\/div>'/.test(unresolvedBranch) && !/class="pc"/.test(unresolvedBranch),
  '4e ...closes as a div and shows no chevron', unresolvedBranch.trim());
ok(/We could not load this development’s details\./.test(dash),
  '4f ...and says so honestly');
// Several unresolved follows behave identically — no collapsing into one vague line, because
// the resident cannot tell which of their follows is affected from a summary.
const manyBad = A.followingCards({ ids: ['b1', 'b2', 'b3'], rows: [], cap: 3 });
ok(manyBad.cards.length === 3 && manyBad.cards.every((c) => c.unresolved),
  '4g several unresolved follows each keep their own row', manyBad.cards.length);

// =====================================================================================
console.log('\n--- §5 PARTIAL FAILURE AND THE SESSION GATE -------------------------------');
// =====================================================================================
// Places are hydrated at boot and need no network read, so a Development failure cannot
// suppress them. Asserted structurally: the place render happens before, and independently
// of, the follow read.
ok(dash.indexOf('A.placeGroups(places)') < dash.indexOf('await HS.data.projectsByIds'),
  '5a Property Addresses and ZIP Codes render before the Development read is awaited');
ok(/catch \(e\) \{[\s\S]{0,120}followRows = \[\]/.test(dash),
  '5b a failed Development read is caught and degrades to an empty row set');
// ZERO developments hides the group rather than asserting a zero.
const devZero = A.developmentsGroup(A.followingCards({ ids: [], rows: [], cap: 3 }));
ok(devZero.count === 0, '5c zero follows is a zero count in the view-model', devZero.count);
ok(/if \(!devGroup\.count\) \{[\s\S]{0,200}followingEl\.hidden = true/.test(dash),
  '5d ...and the page HIDES the group rather than rendering "Developments · 0"');
ok(/followingEl\.remove\(\)/.test(dash),
  '5e without a real session the group node is REMOVED, not zeroed');
// Empty PLACE groups keep their heading and say what is missing — a true statement about
// that type, not a defect, and the same rule My Places' own per-view empty states follow.
ok(/No addresses yet\./.test(dash) && /No ZIP codes yet\./.test(dash),
  '5f an empty place group renders an honest one-liner');

// =====================================================================================
console.log('\n--- §6 ONE CARD, ONE MANAGE LINK, h2 + h3 ---------------------------------');
// =====================================================================================
ok((dash.match(/Manage &rarr;/g) || []).length === 1, '6a exactly one Manage link');
ok(/<h2>My Places<\/h2><a href="properties\.html" id="dashManagePlaces">/.test(dash),
  '6b ...on the unified card, routed to the canonical My Places page');
ok(/<h3 class="railgh">/.test(dash), '6c group headings are h3');
ok(!/<h2>Projects<\/h2>/.test(dash), '6d no second card heading survives');
// The count rides inside the heading text so a screen reader hears it with the group. The
// shape changed from "Label &middot; N" to "Label (N)" when the headings gained icons; what
// is pinned is the INVARIANT, not the punctuation — g.label and g.count must both sit inside
// the one <h3>, with no markup between them that could split them into two announcements.
const h3Body = (dash.match(/railgh">([\s\S]{0,260}?)<\/h3>/) || [])[1] || '';
ok(/HS\.esc\(g\.label\)/.test(h3Body) && /g\.count/.test(h3Body),
  '6e the count is inside the group heading, not an orphan beside it', h3Body.slice(0, 160));
// The glyph must be DECORATIVE: it repeats nothing the label does not already say, so a
// screen reader that announced it would read the group name twice.
ok(/class="railic" aria-hidden="true"/.test(dash),
  '6e2 the heading glyph is aria-hidden — the words carry the meaning, never the icon');
ok(!/<h3[^>]*><a |<a[^>]*><h3/.test(dash), '6f group headings are not links');
// Type is communicated in TEXT, never by colour alone.
ok(/ptag-kind">' \+ \(p\.kind === 'address' \? 'Address' : 'ZIP Code'\)/.test(dash),
  '6g every place row states its type in text');

// =====================================================================================
console.log('\n--- §7 NO COMBINED TOTAL, NO INVENTED ACTIONS -----------------------------');
// =====================================================================================
for (const banned of ['Saved Items', 'Monitored Items', 'Saved items', 'Monitored items'])
  ok(!dash.includes(banned), '7a no combined total reading "' + banned + '"');
ok(!/Add to My Places<|Find a Development|Add a Development/.test(dash),
  '7b no generic add and no invented Development discovery action');
ok(/id="dashAddAddress"/.test(dash) && /id="dashAddZip"/.test(dash),
  '7c the two existing add actions survive, in the zero-places state');
// Scoped to expressions that ADD two group counts. A bare /placeCount \+ / would match the
// heading sentence ('...your ' + placeCount + ' monitored places?'), which is a string join,
// not a total — the false positive this narrower pin exists to avoid.
ok(!/devGroup\.count\s*\+|\+\s*devGroup\.count|following\.total\s*\+|\+\s*following\.total/.test(dash),
  '7d no expression adds the Developments count to anything');
ok(/var placeCount = places\.length;/.test(dash),
  '7e the header count is the place collection length, nothing added to it');

// =====================================================================================
console.log('\n--- §8 DEVELOPMENT UPDATES · PREMIUM — dormant, and provably so -----------');
// =====================================================================================
const P = A.PREMIUM_DEV_UPDATES;
ok(P.availability === 'Coming soon', '8a availability is exactly "Coming soon"', P.availability);
ok(P.body === 'We’re building a way to follow one development’s own official record over '
  + 'time—the filings, hearings, and decisions that belong to it.',
  '8b the body is the approved future-tense sentence', P.body);
ok(P.today === 'Today, saving a Development to My Places lets you reopen it. It does not send alerts.',
  '8c the present-tense sentence states only what is true today', P.today);
ok(P.cta === 'Get Premium access →', '8d the CTA is the approved string', P.cta);
// THE PROHIBITED CLAIMS. Each describes a capability that does not exist: there is no join
// from a followed development to an official-record stream, no status-change event type, and
// app_projects carries no case or permit identifier column.
for (const banned of ['Get verified updates', 'Development status changes',
                      'New applications, cases, and permits', 'Upcoming meetings and official decisions',
                      'verified Development Updates', 'status changes'])
  ok(!dash.includes(banned), '8e the card claims no "' + banned + '"');
ok(/id="dashDevUpdatesPremium"/.test(dash) && /class="p2"/.test(dash),
  '8f the card uses the shared striped Premium component');
ok(!/dashDevUpdates\w*\s*\{|\.devupdates-card/.test(dashRaw),
  '8g ...and declares no Dashboard-local Premium CSS');

// =====================================================================================
console.log('\n--- §9 PREMIUM ACQUISITION — shared modal, source and nothing else --------');
// =====================================================================================
const ctx = A.devUpdatesLeadContext();
ok(ctx.source === 'Development Updates', '9a the source is exactly the approved literal', ctx);
ok(!('zip' in ctx), '9b the context has NO zip key — no field for a place to arrive in');
ok(!('address' in ctx), '9c ...and no address key');
ok(!('id' in ctx) && !('developmentId' in ctx), '9d ...and no development id');
ok(Object.keys(ctx).length === 1, '9e the context is a source and nothing else', Object.keys(ctx));
ok(/dashDevUpdatesCta[\s\S]{0,200}HS\.openPremiumModal\(A\.devUpdatesLeadContext\(\)\)/.test(dash),
  '9f the CTA calls the SHARED opener with that context');
ok(!/id="[a-zA-Z]*[Pp]remium[A-Za-z]*Modal"/.test(dash),
  '9g the Dashboard declares no modal of its own');
// SOURCE VOCABULARY PIN. Every openPremiumModal call site in the app must pass one of the
// approved feature-level literals. Legacy URL-shaped rows already stored in the database are
// NOT in scope here — this pins what the app SENDS from now on, not what it has received.
const APPROVED_SOURCES = ['ZIP Community Profile', 'Property Insights',
                          'Dashboard Quality-of-Life', 'Development Updates'];
// Both shapes: an inline `{source:'…'}` at the CTA, and a named constant the lead context
// returns. Missing the second would have scanned three files and found one call site.
const sourceScan = [read('lib/dashboard-aggregate.js'), read('lib/community-page.js'),
                    read('property.html')].join('\n');
const sourceLiterals = [...sourceScan.matchAll(/source:\s*\\?'([^'\\]+)\\?'/g)].map((m) => m[1])
  .concat([...sourceScan.matchAll(/PREMIUM[A-Z_]*_SOURCE\s*=\s*'([^']+)'/g)].map((m) => m[1]))
  .concat([...sourceScan.matchAll(/PREMIUM_LEAD_SOURCE\s*=\s*'([^']+)'/g)].map((m) => m[1]));
ok(sourceLiterals.length >= 3, '9h the vocabulary scan found real call sites', sourceLiterals);
ok(sourceLiterals.every((s) => APPROVED_SOURCES.includes(s)),
  '9i every Premium source literal is an approved feature name', sourceLiterals);
// Saving a development must never touch the email path.
ok(!/ensureAreaSubscribed|subscribe_area_defaults|signup_complete|user_subscriptions/.test(dash),
  '9j the Dashboard reaches no subscription or digest path at all');

console.log('\n' + (fails ? fails + ' FAILED' : 'All checks passed'));
process.exit(fails ? 1 : 0);
