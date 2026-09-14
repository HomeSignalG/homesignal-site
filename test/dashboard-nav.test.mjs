// Dashboard navigation — pageHref helpers + dashboard.html link contracts.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {
  pageHref,
  itemNavHref,
  meetingNavHref
} = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

ok(pageHref('development.html', { zip: '78617', sort: 'distance' }) === 'development.html?zip=78617&sort=distance',
  'pageHref carries zip + sort');
ok(pageHref('alerts.html', { zip: '78617', band: 'open' }) === 'alerts.html?zip=78617&band=open',
  'pageHref carries band=open for action windows');
ok(pageHref('community.html', { zip: '78617', focus: 'score' }) === 'community.html?zip=78617&focus=score',
  'pageHref carries focus=score for ZIP Score');
ok(pageHref('maps.html', { zip: '78617', place: 'prop-1' }) === 'maps.html?zip=78617&place=prop-1',
  'pageHref carries saved place id');

const proj = { id: 'proj-datacenter', type: 'Data center' };
ok(itemNavHref(proj, '78617') === 'development.html?zip=78617&id=proj-datacenter',
  'itemNavHref routes projects to development detail');

const alert = { id: 'chg-water', window_closes_at: '2099-01-01T00:00:00Z' };
ok(itemNavHref(alert, '78617').indexOf('band=open') > 0,
  'itemNavHref routes open-window alerts with band=open');

const mtg = { id: 'mtg-commissioners', related_project_id: 'proj-datacenter' };
ok(meetingNavHref(mtg, '78617', new Set(['proj-datacenter'])) === 'development.html?zip=78617&id=proj-datacenter',
  'meetingNavHref routes linked project meetings to development detail');

const mtgChg = { id: 'mtg-dvisd', related_project_id: 'chg-dvisd' };
ok(meetingNavHref(mtgChg, '78617').indexOf('alerts.html?zip=78617&id=chg-dvisd') === 0,
  'meetingNavHref routes change-linked meetings to alerts id');

const mtgBare = { id: 'mtg-x' };
ok(meetingNavHref(mtgBare, '78617') === 'alerts.html?zip=78617&category=Government+%26+civic',
  'meetingNavHref without related id uses civic category only');

const dashRaw = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
// ASSERT ON A COMMENT-STRIPPED COPY. These two checks name the very strings they forbid,
// so a `//` line that mentions "ZIP Score" in order to explain its removal would satisfy
// them from prose alone — which is exactly what happened when A-001 first landed: the
// tile was gone and the assertion still went green off a code comment. Same technique the
// generator gates already use.
// HTML comments are stripped as well as `//` lines: the Fix 8 page explains in an HTML
// comment WHY no Quality-of-Life claim renders, and that prose must not be able to satisfy
// a presence check for the very section it is describing.
const dash = dashRaw.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');

// ============================================================================
// FIX 8 — the ALL MY PLACES contract replaces A-001 .. A-009.
//
// WHY THESE ASSERTIONS CHANGED. A-001's Portfolio Strip, A-004 "Needs Your Attention",
// A-005 "Your Briefing", A-006 "Recent Changes", A-007 "Worth Watching", A-008
// "Development Overview" (and its #dashMap preview) and A-009 "Intelligence Reports" were
// the module set of the SINGLE-ZIP Dashboard. Fix 8 (founder-approved) replaced that page
// with an account-wide briefing whose §4 main/rail order is fixed and whose map is removed
// by name. Every pin below is a POSITIVE assertion of the new contract — coverage is
// replaced, not dropped.
// ============================================================================

// ---- the page no longer reads the VIEWED place at all --------------------------------
// This is the whole point of Fix 8 and the one thing that would be silent if it regressed:
// membership comes from canonical My Places, so a viewed-ZIP read is a defect, not a detail.
ok(!/HS\.ensureViewedZip\(/.test(dash),
  'Fix 8 dashboard.html does not call ensureViewedZip — it is not a ZIP-scoped page');
ok(!/S\.zip|HS\.state\.zip|myZip|sessionViewZip/.test(dash),
  'Fix 8 dashboard.html reads no viewed-place state',
  (dash.match(/.{0,50}(S\.zip|HS\.state\.zip|myZip).{0,50}/) || [])[0]);
ok(/HS\.dashAgg/.test(dash) && /canonicalPlaces\(/.test(dash),
  'Fix 8 scope comes from the dashboard-aggregate view-model');
ok(/HS\.followedCommunities/.test(dash) && /S\.properties/.test(dash),
  'Fix 8 membership is the two canonical My Places stores');
ok(!/app_follows/.test(dash),
  'Fix 8 Dashboard never reaches into app_follows rows directly — membership is the hydrated list');

// ---- §4 main-column and rail sections, in the approved order -------------------------
for (const h of ['What&rsquo;s Changing?', 'Official Dates to Know', 'My Places', 'Stay Informed'])
  ok(dash.includes('>' + h + '<'), 'Fix 8 Dashboard renders the "' + h.replace('&rsquo;', "'") + '" section');
// "Projects" left this list because it is no longer a SECTION. Followed developments are a
// typed GROUP inside My Places, headed by an h3 the view-model builds — so the section
// roster shrank by one while the thing it held did not move off the page.
ok(!dash.includes('>Projects<'),
  'Fix 8 "Projects" is no longer a rail section heading');
const iChanging = dash.indexOf('What&rsquo;s Changing?');
const iQol = dash.indexOf('Quality-of-Life Impact');
const iDates = dash.indexOf('Official Dates to Know');
ok(iChanging > 0 && iQol > iChanging && iDates > iQol,
  'Fix 8 main column order is What’s Changing -> Quality-of-Life Premium -> Official Dates',
  { iChanging, iQol, iDates });
ok(dash.indexOf('>My Places<') < dash.indexOf('>Stay Informed<'),
  'Fix 8 right rail order is My Places -> Stay Informed');

// ---- the superseded single-ZIP module set is gone ------------------------------------
for (const gone of ['Needs Your Attention', 'Your Briefing', 'Recent Changes', 'Worth Watching',
                    'Development Overview', 'Intelligence Reports'])
  ok(!dash.includes('>' + gone + '<'), 'Fix 8 the single-ZIP module "' + gone + '" is gone');
ok(!/id="dashStrip"|statTileLink/.test(dash), 'Fix 8 the Portfolio Strip is gone (no KPI tile row)');
ok(!/id="dashMap"|HS\.buildLive/.test(dash), 'Fix 8 no default Dashboard map');
ok(!/reports\.html/.test(dash),
  'Fix 8 Dashboard still routes nobody through the retired reports.html stub');

// ---- §4 forbids greeting copy BY NAME ------------------------------------------------
for (const greet of ['Welcome back', 'Good morning', 'Good afternoon', 'Hello '])
  ok(!dash.includes(greet), 'Fix 8 Dashboard renders no "' + greet.trim() + '" greeting');

// ---- no Quality-of-Life CLAIM may render (Phase 1: no authoritative impact plane) -----
ok(!/High Impact|Medium Impact|Low Impact|impactRating|impact_score|impact_dimensions/.test(dash),
  'Fix 8 no QoL/impact label, rating or score anywhere on Dashboard',
  (dash.match(/.{0,40}(High Impact|impactRating|impact_score).{0,40}/) || [])[0]);

// ---- no AGGREGATE DESTINATION — there is still no All My Places page to send them to ---
// FIX 8K RESTATED THIS PIN. The ban was on a DESTINATION, and that still holds. But
// "View all" is now approved COPY for an in-place expander ("View all N changes →") built on
// a <button>, so a substring ban would state something false AND still miss a real link: the
// label is created in lib/dashboard-aggregate.js, which this file did not read. The smallest
// necessary read is added here so the guard looks where the control is actually made.
// Deliberately duplicated from test/dashboard-all-places.test.mjs §8 rather than shared —
// extracting a helper would add a third file beyond this correction's approved scope.
const aggSrc = fs.readFileSync(new URL('../lib/dashboard-aggregate.js', import.meta.url), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '');
const AGG_LINK_TOKEN = /<a\b|href|pageHref\(|location\.(?:href|assign)|window\.open/;
const aggregateDestinations = [];
{
  const surface = dash + '\n' + aggSrc;
  // Both approved expansion labels as they appear in SOURCE: `'View all ' + total +
  // ' changes'` and `'View ' + hidden + ' more changes'` (#1209 added the second).
  const re = /View all|more changes/g;
  let m;
  while ((m = re.exec(surface)) !== null) {
    const win = surface.slice(Math.max(0, m.index - 200), m.index + 200);
    if (AGG_LINK_TOKEN.test(win)) aggregateDestinations.push(win.replace(/\s+/g, ' ').trim());
  }
}
ok(aggregateDestinations.length === 0,
  'Fix 8 no aggregate destination renders — BOTH Fix 8K expansion labels are in-place button text, never a link',
  aggregateDestinations[0]);
// "Not a link" is also satisfied by no control existing at all, so the approved shape is
// pinned positively alongside it.
ok(/toggleBtn = document\.createElement\('button'\);/.test(dash)
  && /toggleBtn\.type = 'button';/.test(dash)
  && !/toggleBtn\.href/.test(dash),
  'Fix 8K the approved expander is a <button type="button"> with no href');
ok(/'View all ' \+ total \+ ' changes/.test(aggSrc)
  && /'View ' \+ hidden \+ ' more changes/.test(aggSrc),
  'Fix 8K both approved expansion labels are built as plain strings, not routes');

// ---- the two rail CTAs route to the EXISTING surfaces ---------------------------------
ok(/href="properties\.html"/.test(dash) && /Manage &rarr;/.test(dash),
  'Fix 8 My Places "Manage" routes to the existing My Places page');
ok(/href="alerts\.html"/.test(dash) && /Manage your alerts &rarr;/.test(dash),
  'Fix 8 Stay Informed routes to the existing Alerts management');

// ---- Places are Addresses + ZIP Codes; followed projects are NOT a Place -------------
// ⚠️ SCOPED (Fix 8J), same reason as the twin pin in project-follow-my-places.test.mjs: this
// banned the identifiers file-wide, which is wider than the rule it states. The Dashboard now
// has a Following section that legitimately reads followed projects; what must stay true is
// that they are not COUNTED as Places. Asserted on the count's own inputs instead.
const canonCall = (dash.match(/canonicalPlaces\(\{[\s\S]*?\}\)/) || [''])[0];
ok(canonCall !== '' && !/project/i.test(canonCall) && /placeCount = places\.length/.test(dash),
  'Fix 8 Dashboard does not count followed projects as monitored places', canonCall);
// The followed-development group now lives INSIDE the My Places card — one container for
// the three types the resident saved — and is still never a navigation destination of its
// own. The id stays dashFollowing: identifiers are not copy. What must remain true is the
// containment: the group renders between the place groups and the end of that card, and
// the Premium card that follows is a separate sibling, not a nested member of it.
const iCardStart = dash.indexOf('id="dashManagePlaces"');
const iDevGroup = dash.indexOf('id="dashFollowing"');
const iPremiumCard = dash.indexOf('id="dashDevUpdatesPremium"');
ok(iCardStart > 0 && iDevGroup > iCardStart && iPremiumCard > iDevGroup
   && iPremiumCard < dash.indexOf('>Stay Informed<'),
  'Fix 8J the Developments group sits inside My Places, with Premium after it',
  { iCardStart, iDevGroup, iPremiumCard });
ok(!/<a [^>]*data-nav="following"/.test(dash), 'Fix 8J Following adds no navigation destination');
ok(!/onclick="HS\.addHome\(\)"/.test(dash), 'dashboard add-place uses listener not inline onclick');

const shell = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
ok(/HS\.pageHref/.test(shell), 'shell.js exposes pageHref');
ok(!/setTimeout\s*\(\s*applyFocus/.test(fs.readFileSync(new URL('../alerts.html', import.meta.url), 'utf8')),
  'alerts applyFocus runs synchronously after render');
ok(!/setTimeout\s*\(\s*function\s*\(\)\s*\{[^}]*zip-score-strip/s.test(fs.readFileSync(new URL('../community.html', import.meta.url), 'utf8')),
  'community focus=score scroll is immediate');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll dashboard-nav assertions passed.');
