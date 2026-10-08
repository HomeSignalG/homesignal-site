// DASHBOARD RAIL COPY — ONE "My Places" card with three typed groups.
// Run: node test/dashboard-rail-copy.test.mjs
//
// WHY THIS FILE EXISTS. The right rail called its first card "Your Places" while the
// sidebar, the page it routes to, and every other surface in the app call that collection
// "My Places" (partials/shell.html:14, properties.html). Its second card called itself
// "Following" — a verb for a section whose own supporting line says it holds PROJECTS, and
// whose Manage link lands on a tab already labelled "Projects" (properties.html
// data-view="projects"). Both renames move the Dashboard TOWARD copy that already ships.
//
// THE CONSOLIDATION IS PRESENTATION ONLY, AND THAT IS THE HALF WORTH GUARDING. The two
// rail cards ("My Places" and "Projects") are now ONE card carrying three typed groups —
// Property Addresses, ZIP Codes, Developments — each with its own dynamic count and its own
// filtered destination. The identifiers (#dashFollowing, followingCards, followingQueryIds,
// MAX_FOLLOWING_*, target_type='project', ?view=projects) are implementation names, not
// copy, and renaming them would turn a presentation change into a refactor touching the
// view-model, four suites, a route and every stored follow. So this file asserts the new
// resident-facing shape AND that nothing underneath it moved — plus the neighbouring Fix
// 8G / 8I / 8J / 8K pins, because "presentation-only" is a claim about what did NOT change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 240) : ''));
  if (!c) fails++;
};
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const dash = read('dashboard.html');
const css = read('app.css');
const agg = read('lib/dashboard-aggregate.js');
// My Places' own page, so the rail's labels can be checked against the control they route to
// rather than against a second copy of the same words written down here.
const props = read('properties.html');

// POSITIVE CONTROL. Every absence below is read off this one file, so a mis-resolved path
// would make all of them vacuously true — success-shaped output attesting to nothing.
ok(dash.length > 10000 && /id="dashPlaces"/.test(dash) && /id="dashFollowing"/.test(dash),
  'the file under test is the real Dashboard', { bytes: dash.length });

// =====================================================================================
console.log('\n--- §1 THE TWO HEADINGS ---------------------------------------------------');
// =====================================================================================
// Asserted on the WHOLE card row, not on the bare word: "Projects" also appears inside the
// supporting sentence and in the Manage href, so `includes('Projects')` would pass on a
// page where the heading never changed at all.
const PLACES_ROW = '<div class="bt-row"><h2>My Places</h2>'
  + '<a href="properties.html" id="dashManagePlaces">Manage &rarr;</a></div>';
ok(dash.includes(PLACES_ROW), '1 the places card heading is "My Places"');
// The three typed groups are h3 INSIDE that card, never sibling h2 — three same-level
// headings under one card title would break the outline a screen reader navigates by.
for (const g of ['Addresses', 'ZIP Codes', 'Developments'])
  ok(new RegExp("label: '" + g + "'").test(agg) || dash.includes(g),
    '1 the typed group "' + g + '" is a resident-facing label');
// The labels are My Places' OWN segmented-control words (properties.html ships buttons
// reading "Addresses" / "ZIP Codes" / "Developments"), so the rail and the page it links to
// name a thing identically rather than the rail inventing a longer synonym for one of them.
ok(/RAIL_PLACE_GROUPS[\s\S]*?label: 'Addresses'[\s\S]*?label: 'ZIP Codes'/.test(agg),
  '1 the two PLACE groups are Addresses then ZIP Codes, in that order');
ok(/data-view="addresses">Addresses</.test(props) && /data-view="zips">ZIP Codes</.test(props)
   && /data-view="projects">Developments</.test(props),
  '1 ...and those are verbatim My Places\' own segmented-control labels');
ok(/RAIL_DEV_LABEL\s*=\s*'Developments'/.test(agg),
  '3 the followed-development group is labelled "Developments" to residents');
// …while the internal route value stays "projects". Display and storage are separate
// vocabularies: renaming the route would break every existing link and follow.
ok(/RAIL_DEV_VIEW\s*=\s*'projects'/.test(agg),
  '3 the Developments group still routes to the existing ?view=projects filter');

// The OLD copy is gone as a HEADING. Scoped to the <h2>, because "your places" survives
// legitimately in body copy ("updates for your places just now") — a file-wide ban would
// fail on sentences this change never touched and was never meant to.
const h2s = [...dash.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].trim());
ok(!h2s.includes('Your Places'), '2 no card heading reads "Your Places"', h2s);
ok(!h2s.includes('Following'), '4 no card heading reads "Following"', h2s);
ok(!h2s.includes('Projects'), '4 no card heading reads "Projects" — it is a typed GROUP now', h2s);
ok(!/>Your Places</.test(dash) && !/>Following</.test(dash),
  '2+4 neither old heading survives anywhere in the shipped markup',
  (dash.match(/.{0,40}>(?:Your Places|Following)<.{0,40}/) || [])[0]);

// Capitalization matches the rail's existing presentation. .bt-row h2 carries NO
// text-transform (unlike .p2h, which is why the Premium card reads back as
// "QUALITY-OF-LIFE IMPACT · PREMIUM"), so the markup's own case is what a resident sees —
// which is what makes Title Case in the markup the correct answer rather than a guess.
const btH2 = (css.match(/\.bt-row h2\{[^}]*\}/) || [''])[0];
ok(btH2 !== '' && !/text-transform/.test(btH2),
  'the rail heading rule applies no text-transform, so markup case IS rendered case', btH2);
for (const h of ['My Places'])
  ok(h === h.replace(/\b[a-z]/g, (c) => c.toUpperCase()) && h !== h.toUpperCase(),
    '"' + h + '" is Title Case, matching Official Dates to Know / Stay Informed');

// =====================================================================================
console.log('\n--- §2 THE NO-ALERTS DISCLOSURE IS NOW PERMANENT --------------------------');
// =====================================================================================
// The old supporting sentence ("Projects you chose to monitor.") is GONE, and so is the
// zero-state that carried the alerts disclaimer — the Developments group is hidden at zero,
// so a resident with no follows sees neither. That would have LOST the disclosure, which is
// the one sentence separating "saved" from "subscribed", so it moved somewhere it always
// renders: the Development Updates Premium card, which is constant and never data-gated.
ok(!/Projects you chose to monitor\./.test(dash),
  '5 the old "Projects you chose to monitor." sub-line is gone with its card');
ok(dash.includes('Today, saving a Development to My Places lets you reopen it. It does not send alerts.'),
  '5 the no-alerts disclosure now renders permanently on the Premium card');
// It must not be data-gated: this is the sentence a resident needs BEFORE they follow
// anything, and the old placement only showed it to residents who had followed nothing.
const devCard = dash.slice(dash.indexOf('id="dashDevUpdatesPremium"'));
ok(devCard.indexOf('It does not send alerts.') > 0
   && devCard.indexOf('It does not send alerts.') < devCard.indexOf('dashDevUpdatesCta'),
  '5 ...inside the constant Premium card, above its CTA');

// =====================================================================================
console.log('\n--- §3 CARD ORDER AND THE RAIL SHAPE -------------------------------------');
// =====================================================================================
const iPlaces = dash.indexOf('>My Places<');
const iPremium = dash.indexOf('id="dashDevUpdatesPremium"');
const iStay = dash.indexOf('>Stay Informed<');
ok(iPlaces > 0 && iPremium > iPlaces && iStay > iPremium,
  '6 rail order is My Places -> Development Updates Premium -> Stay Informed',
  { iPlaces, iPremium, iStay });
// The Premium card sits BELOW the inventory card and is never nested inside it: a roadmap
// statement inside the card listing real saved things would read as one of them.
ok(dash.indexOf('id="dashDevUpdatesPremium"') > dash.indexOf('id="dashFollowingBody"'),
  '6 the Premium card follows the My Places card rather than nesting inside it');
// The rail is exactly two card headings now. A consolidation that accidentally left the old
// card behind would still satisfy the order check above, so membership is asserted separately.
const rail = dash.slice(dash.indexOf('<div>', dash.indexOf('Official Dates to Know')));
const railH2 = [...rail.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].trim());
ok(railH2.join(' | ') === 'My Places | Stay Informed',
  '6 the rail carries exactly two card headings, none duplicated', railH2);

// =====================================================================================
console.log('\n--- §4 NOTHING UNDER THE HEADINGS MOVED ----------------------------------');
// =====================================================================================
// 7. Routes, ids and the component markup.
ok(/<a href="properties\.html" id="dashManagePlaces">Manage &rarr;<\/a>/.test(dash),
  '7 the My Places Manage CTA keeps its id and route');
// ONE Manage link now. The second one is replaced by per-group overflow anchors, which
// render only when a group actually hides rows — a link that promises nothing is the
// defect, and two "Manage →" links on one card were an ambiguous accessible name besides.
ok((dash.match(/Manage &rarr;/g) || []).length === 1,
  '7 exactly one "Manage →" link, on the unified card',
  (dash.match(/Manage &rarr;/g) || []).length);
ok(!/id="dashManageFollowing"/.test(dash),
  '7 the second Manage CTA is gone with the second card');
ok(/railHref\(view\)[\s\S]{0,120}'properties\.html\?view='/.test(agg),
  '7 per-group overflow still routes to the existing filtered My Places views');
ok(/id="dashPlaces"/.test(dash) && /id="dashFollowing"/.test(dash)
   && /id="dashFollowingBody"/.test(dash),
  '7 no card id was renamed for terminology');
ok(/<div id="dashFollowing" hidden>/.test(dash),
  '7 the Developments GROUP still ships hidden, for the Fix 8J session gate to reveal');
ok(!/id="dashProjects"|id="dashMyPlaces"|id="dashManageProjects"/.test(dash),
  '7 no second, copy-aligned id was invented alongside the old one');
// No new CSS and no new component: both cards are still the shared .block/.bt-row pair the
// other rail cards use, so the rename could not have needed a style.
// Four .bt-row rows, not five: What's Changing, Official Dates, My Places, Stay Informed.
// The Projects card's row is gone because the card is gone — the group it held is now an
// h3 inside My Places, and the Premium card uses the shared .p2 component, not .bt-row.
ok((dash.match(/<div class="bt-row">/g) || []).length === 4,
  'the consolidation removed one card row and introduced no new card component',
  (dash.match(/<div class="bt-row">/g) || []).length);
ok(!/class="[^"]*\b(myplaces|projectscard|rail-projects)\b/.test(dash),
  'no new class name was introduced for either card');

// 10. Fix 8J: follow behaviour, the caps and the identifiers are untouched by a copy change.
for (const id of ['followingCards', 'followingQueryIds', 'MAX_FOLLOWING_CARDS', 'MAX_FOLLOWING_IDS'])
  ok(agg.includes(id), '10 the view-model identifier ' + id + ' was not renamed for copy');
ok(/MAX_FOLLOWING_IDS\s*=\s*50/.test(agg) && /MAX_FOLLOWING_CARDS\s*=\s*4/.test(agg),
  '10 the id cap (50) and card cap (4) are unchanged');
ok(/HS\.followedProjectIds/.test(dash) && /A\.followingQueryIds\(/.test(dash)
   && /A\.followingCards\(/.test(dash) && /HS\.data\.projectsByIds/.test(dash),
  '10 the Dashboard still reads followed projects through the same four call sites');
ok(/It does not send alerts\./.test(dash),
  '10 the rail still states, permanently, that saving a Development sends no alerts');
ok(!/user_subscriptions|pipeline_type|digest/.test(dash),
  '10 the Projects card still touches no subscription or digest concept');

// 8. Fix 8I header: the eyebrow/h1 pair the rename must not disturb.
ok(dash.includes('<div class="eyebrow">Dashboard</div>\n          <h1 id="dashSub"></h1>'),
  '8 Fix 8I header is intact — eyebrow "Dashboard" above the empty #dashSub h1');
ok((dash.match(/<h1\b/g) || []).length === 1, '8 still exactly one <h1> in the markup');

// 9. Fix 8G: no live ZIP attribution claim came back.
ok(!/Affects \d| of your places|Affects ' \+/.test(dash),
  '9 Fix 8G holds — no "Affects N of your places" attribution in dashboard.html',
  (dash.match(/.{0,60}of your places.{0,60}/) || [])[0]);
ok(!/of your places/.test(agg.replace(/^\s*\/\/.*$/gm, '')),
  '9 ...and the view-model still never emits it either');

// 11. Fix 8K: the What's Changing preview is the implementation this rename found, untouched.
// THIS PIN WAS WRITTEN AGAINST THE 12-ROW SLICE AND IS NOW WRITTEN AGAINST THE EXPANDER.
// The rename's claim is "nothing under the headings moved", so the pin has to name whatever
// the preview IS at the time — not the shape it happened to have when the claim was first
// made. The cap now lives in the view-model (A.PREVIEW_LIMIT) rather than inline in the
// page, so both halves are asserted: the page renders THROUGH the view-model, and the
// view-model still caps the visible list. The number moved 8 -> 3 (founder, 2026-09-15);
// the rename's claim is unaffected, since it was about the rendering path, not the bound.
ok(/A\.changesPreview\(deduped, \{ expanded: expanded, countKnown: countKnown \}\)/.test(dash),
  '11 Fix 8K preview is rendered through the view-model, not an inline slice');
// ⚠️ `var ` IS LOAD-BEARING IN THIS REGEX, NOT TIDINESS. The bare form `/PREVIEW_LIMIT = 3;/`
// also matches `RAIL_PREVIEW_LIMIT = 3;` — the My Places rail's own, unrelated constant — so
// the pin passed while the What's Changing bound still read 8. Measured: mutating the bound
// back to 8 left this assertion GREEN. A pin that can be satisfied by a different constant
// is not guarding the one it names.
ok(/var PREVIEW_LIMIT = 3;/.test(agg), '11 Fix 8K preview caps the visible list at 3 rows (Fix 23)');
ok(/var RAIL_PREVIEW_LIMIT = 3;/.test(agg),
  '11 ...control: the rail constant that made the loose form pass vacuously still exists');
ok(!/deduped\.slice\(0, 12\)/.test(dash),
  '11 ...and the superseded inline 12-row slice is gone');
ok(/id="dashChangingList"/.test(dash) && /id="dashChangingMore"/.test(dash),
  '11 Fix 8K expander nodes ship with the preview');
ok(/Showing updates across your first ' \+ zips\.length \+ ' places\./.test(dash),
  '11 Fix 8K still discloses the place cap in the same words');
ok(/id="dashChanging"/.test(dash) && /id="dashChangingSub"/.test(dash),
  '11 Fix 8K nodes are unchanged');

// THE SCOPE CLAIM ITSELF, asserted on the RENDERED MARKUP and nothing wider. A file-wide
// ban on the two old strings FAILS on this file today, and correctly so: "Your Places" and
// "Following" both survive as CODE COMMENTS labelling the sections that build these cards
// (dashboard.html:217, :293, :320), alongside the identifiers they name. Those are not copy
// and are deliberately untouched — banning them here would be a rule wider than the one
// this change states, and would push a copy edit into a comment-and-identifier refactor.
const tpl = dash.slice(dash.indexOf('<template id="hs-content">'), dash.indexOf('</template>'))
  .replace(/<!--[\s\S]*?-->/g, '');
ok(tpl.length > 2000 && /id="dashFollowing"/.test(tpl),
  'the rendered-markup slice is real', { bytes: tpl.length });
ok(!/Your Places/.test(tpl) && !/\bFollowing\b/.test(tpl),
  'no resident-facing string in the rendered markup still reads "Your Places" or "Following"',
  (tpl.match(/.{0,50}(?:Your Places|Following).{0,50}/) || [])[0]);
ok(/>My Places</.test(tpl), 'the rendered markup carries the unified card heading');
// The typed group headings are BUILT (h3 with the count inside the heading text), so the
// static template carries the container and the view-model carries the labels. Asserting
// the container here and the labels in §1 is what keeps each check scoped to its own file.
ok(/id="dashPlaces"/.test(tpl) && /id="dashFollowingBody"/.test(tpl),
  'the rendered markup carries both group containers inside the one card');
ok(/id="dashDevUpdatesPremium"/.test(tpl) && /Coming soon/.test(tpl),
  'the rendered markup carries the dormant Premium card');

console.log(fails ? '\n' + fails + ' failed' : '\nAll Dashboard rail copy assertions passed.');
process.exit(fails ? 1 : 0);
