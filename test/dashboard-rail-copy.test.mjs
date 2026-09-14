// DASHBOARD RAIL COPY — "My Places" and "Projects" are the resident-facing headings.
// Run: node test/dashboard-rail-copy.test.mjs
//
// WHY THIS FILE EXISTS. The right rail called its first card "Your Places" while the
// sidebar, the page it routes to, and every other surface in the app call that collection
// "My Places" (partials/shell.html:14, properties.html). Its second card called itself
// "Following" — a verb for a section whose own supporting line says it holds PROJECTS, and
// whose Manage link lands on a tab already labelled "Projects" (properties.html
// data-view="projects"). Both renames move the Dashboard TOWARD copy that already ships.
//
// THE RENAME IS PRESENTATION ONLY, AND THAT IS THE HALF WORTH GUARDING. The identifiers
// (#dashFollowing, followingCards, followingQueryIds, MAX_FOLLOWING_*) are implementation
// names, not copy, and renaming them would turn a two-line copy change into a refactor
// touching the aggregate view-model, four suites and a route. So this file asserts the two
// headings moved AND that nothing underneath them did: same component markup, same ids,
// same hrefs, same caps, same order, same supporting sentence — plus the neighbouring Fix
// 8G / 8I / 8J / 8K pins, because "copy-only" is a claim about what did NOT change.
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
const PROJECTS_ROW = '<div class="bt-row"><h2>Projects</h2>'
  + '<a href="properties.html?view=projects" id="dashManageFollowing">Manage &rarr;</a></div>';
ok(dash.includes(PLACES_ROW), '1 the places card heading is "My Places"');
ok(dash.includes(PROJECTS_ROW), '3 the followed-project card heading is "Projects"');

// The OLD copy is gone as a HEADING. Scoped to the <h2>, because "your places" survives
// legitimately in body copy ("updates for your places just now") — a file-wide ban would
// fail on sentences this change never touched and was never meant to.
const h2s = [...dash.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].trim());
ok(!h2s.includes('Your Places'), '2 no card heading reads "Your Places"', h2s);
ok(!h2s.includes('Following'), '4 no card heading reads "Following"', h2s);
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
for (const h of ['My Places', 'Projects'])
  ok(h === h.replace(/\b[a-z]/g, (c) => c.toUpperCase()) && h !== h.toUpperCase(),
    '"' + h + '" is Title Case, matching Official Dates to Know / Stay Informed');

// =====================================================================================
console.log('\n--- §2 THE SUPPORTING SENTENCE IS UNTOUCHED -------------------------------');
// =====================================================================================
// It carries the distinction the heading alone cannot: these are projects the resident
// CHOSE to monitor, which is not the same as projects with alerts enabled.
ok((dash.match(/Projects you chose to monitor\./g) || []).length === 1,
  '5 "Projects you chose to monitor." renders exactly once', 
  (dash.match(/Projects you chose to monitor\./g) || []).length);
ok(dash.includes('<p class="dnote" style="margin:0 0 12px">Projects you chose to monitor.</p>'),
  '5 ...in its original markup, directly under the card heading');
ok(dash.includes(PROJECTS_ROW + '\n          <p class="dnote" style="margin:0 0 12px">Projects you chose to monitor.</p>'),
  '5 ...and the heading still immediately precedes it');

// =====================================================================================
console.log('\n--- §3 CARD ORDER AND THE RAIL SHAPE -------------------------------------');
// =====================================================================================
const iPlaces = dash.indexOf('>My Places<');
const iProjects = dash.indexOf('>Projects<');
const iStay = dash.indexOf('>Stay Informed<');
ok(iPlaces > 0 && iProjects > iPlaces && iStay > iProjects,
  '6 rail order is My Places -> Projects -> Stay Informed', { iPlaces, iProjects, iStay });
// The rail is exactly these three cards. A rename that accidentally duplicated a card would
// still satisfy the order check above, so the membership is asserted separately.
const rail = dash.slice(dash.indexOf('<div>', dash.indexOf('Official Dates to Know')));
const railH2 = [...rail.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].trim());
ok(railH2.join(' | ') === 'My Places | Projects | Stay Informed',
  '6 the rail carries exactly three card headings, none duplicated', railH2);

// =====================================================================================
console.log('\n--- §4 NOTHING UNDER THE HEADINGS MOVED ----------------------------------');
// =====================================================================================
// 7. Routes, ids and the component markup.
ok(/<a href="properties\.html" id="dashManagePlaces">Manage &rarr;<\/a>/.test(dash),
  '7 the My Places Manage CTA keeps its id and route');
ok(/<a href="properties\.html\?view=projects" id="dashManageFollowing">Manage &rarr;<\/a>/.test(dash),
  '7 the Projects Manage CTA keeps its id and route');
ok((dash.match(/Manage &rarr;/g) || []).length === 2,
  '7 the "Manage →" copy is unchanged on both cards');
ok(/id="dashPlaces"/.test(dash) && /id="dashFollowing"/.test(dash)
   && /id="dashFollowingBody"/.test(dash),
  '7 no card id was renamed for terminology');
ok(/<div class="block" id="dashFollowing" hidden>/.test(dash),
  '7 the Projects card still ships hidden, for the Fix 8J session gate to reveal');
ok(!/id="dashProjects"|id="dashMyPlaces"|id="dashManageProjects"/.test(dash),
  '7 no second, copy-aligned id was invented alongside the old one');
// No new CSS and no new component: both cards are still the shared .block/.bt-row pair the
// other rail cards use, so the rename could not have needed a style.
ok((dash.match(/<div class="bt-row">/g) || []).length === 5,
  'the rename introduced no new card component — five .bt-row rows, as before',
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
ok(/does not turn on email alerts/.test(dash),
  '10 the empty state still says following does not turn on email alerts');
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
// view-model still caps at 8.
ok(/A\.changesPreview\(deduped, \{ expanded: expanded, countKnown: countKnown \}\)/.test(dash),
  '11 Fix 8K preview is rendered through the view-model, not an inline slice');
ok(/PREVIEW_LIMIT = 8;/.test(agg), '11 Fix 8K preview still caps the visible list at 8 rows');
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
ok(/>My Places</.test(tpl) && />Projects</.test(tpl),
  'the rendered markup carries both new headings');

console.log(fails ? '\n' + fails + ' failed' : '\nAll Dashboard rail copy assertions passed.');
process.exit(fails ? 1 : 0);
