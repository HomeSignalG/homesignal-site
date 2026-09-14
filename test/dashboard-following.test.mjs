// FIX 8J — the Dashboard FOLLOWING contract.
//
// WHY THIS FILE EXISTS. Following is a confirmation surface: it tells a resident that the
// projects they chose to monitor are known to us. Every way it can go wrong is silent.
//   * A followed project that stops resolving could simply vanish from the list, telling the
//     resident they never followed it. app_follows.target_id is a TEXT soft reference with no
//     foreign key, and 1 of the 3 live project follows in production does not resolve today.
//   * A failed read returns an empty array from HS.data.projectsByIds (a PostgREST rejection
//     resolves with data:null, which that helper maps to []), so "we could not read" and "you
//     follow nothing" are the same value. Rendering that as an empty section is the false
//     empty the Dashboard's own view-model exists to prevent.
//   * A card could imply currency — "updated", "new", "active" — from fields that cannot
//     support it, or an impact label the Dashboard has already ruled has no authoritative
//     plane, and would look MORE useful for being wrong.
//   * A followed project could leak onto an unauthenticated page from localStorage residue
//     left by a session that expired rather than signed out.
// None of these throw. So this suite drives lib/dashboard-aggregate.js DIRECTLY in Node — the
// real module the browser loads — and greps dashboard.html only for composition facts that
// live in the page.
//
// Run: node test/dashboard-following.test.mjs
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
// Comment-stripped: several checks below name the very string they forbid, and a `//` line or
// an HTML comment explaining an absence must never be able to satisfy a check for it.
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
const dash = strip(read('dashboard.html'));
const props = strip(read('properties.html'));
const aggSrc = read('lib/dashboard-aggregate.js');

// Two real production rows, verbatim from app_projects (2026-09-14), plus the real dangling
// follow id. Fixtures invented from scratch would not have produced the unresolved case.
const PEARCE = { id: '4cb51a6a-14ac-4850-aef9-aaced70977f9', name: 'Pearce Lane', zip: '78617', status: 'Proposed', type: 'Commercial' };
const BRIGHT = { id: '0a0f93ea-b606-4eb2-866c-30fb0f60595c', name: 'HOUSE BRIGHTLAND HOMES LTD', zip: '75033', status: 'Approved', type: 'Residential' };
const DANGLING = '7b774208-6c33-488a-bfdf-571426ecefbb';

// =====================================================================================
console.log('\n--- §1 A FOLLOW IS NOT A PLACE -------------------------------------------');
// =====================================================================================
// properties.html states that followed projects do not count in Places Monitored. Folding
// them into the Dashboard header would make the two surfaces disagree about the same number.
const canonSpan = aggSrc.slice(aggSrc.indexOf('function canonicalPlaces'), aggSrc.indexOf('function queryZips'))
  .replace(/^\s*\/\/.*$/gm, '');
ok(!/project/i.test(canonSpan), 'canonicalPlaces still has no followed-project branch');
const canonCall = (dash.match(/canonicalPlaces\(\{[\s\S]*?\}\)/) || [''])[0];
ok(canonCall !== '' && !/project/i.test(canonCall),
  'the Dashboard builds membership from Addresses + ZIP Codes only', canonCall);
ok(/placeCount = places\.length/.test(dash),
  'the monitored-place count is the length of canonical places');
// The section must not feed any content read either — queryZips drives every ZIP-scoped fetch.
ok(!/queryZips\([^)]*follow/i.test(dash),
  'followed projects never widen the ZIP set the Dashboard reads content for');

// =====================================================================================
console.log('\n--- §2 UNRESOLVED IS RENDERED, NEVER DROPPED -----------------------------');
// =====================================================================================
const mixed = A.followingCards({ ids: [PEARCE.id, DANGLING, BRIGHT.id], rows: [PEARCE, BRIGHT] });
ok(mixed.cards.length === 3, 'a follow whose record does not resolve still produces a card', mixed.cards.length);
ok(mixed.total === 3, 'the count states follows, not resolved rows', mixed.total);
// A regression that DROPS unresolved rows leaves holes here. Guarded so it prints four named
// failures instead of a TypeError: a crash aborts the run and hides every later section, and
// then reports zero FAIL lines — which reads exactly like a mutation the suite survived.
ok(mixed.cards.every((c) => c && typeof c === 'object'),
  'every follow yields a card object, never a hole in the list', mixed.cards);
const dangCard = mixed.cards[1] || {};
ok(dangCard.id === DANGLING && dangCard.unresolved === true,
  'the unresolved card keeps its follow id and is marked unresolved', dangCard);
ok(dangCard.title === 'Followed project' && dangCard.context === null && dangCard.zip === null,
  'the unresolved card invents no title, status or place', dangCard);
// Order is the follow-list order: an unresolved row must not be shuffled to the end, or the
// resident cannot tell which of their follows it is by position.
ok(mixed.cards.map((c) => c.id).join(',') === [PEARCE.id, DANGLING, BRIGHT.id].join(','),
  'card order is the follow-list order, unresolved rows in place');

// THE FAILED-READ CASE. projectsByIds returns [] for a rejected request, so this is what a
// total read failure looks like from here. Every follow must still be accounted for.
const allFailed = A.followingCards({ ids: [PEARCE.id, BRIGHT.id], rows: [] });
ok(allFailed.cards.length === 2 && allFailed.total === 2 && allFailed.cards.every((c) => c.unresolved),
  'a failed read renders every follow as unresolved — never as an empty section', allFailed);
ok(dash.indexOf('We could not load this project’s details.') !== -1,
  'the page states that details could not be loaded, and does not claim the project is gone');

// =====================================================================================
console.log('\n--- §3 NO CLAIM THE DATA CANNOT SUPPORT ----------------------------------');
// =====================================================================================
const one = A.followingCards({ ids: [PEARCE.id], rows: [PEARCE] });
const card = one.cards[0];
ok(card.title === 'Pearce Lane', 'the title is the record name, verbatim', card.title);
ok(card.context === 'Proposed', 'the sub-line is the record status, verbatim', card.context);
ok(card.place === 'ZIP 78617', 'the place is the record own ZIP', card.place);
// Only these keys exist. A new one is a new claim and has to be argued for, not inherited.
ok(Object.keys(card).sort().join(',') === 'context,id,place,title,unresolved,zip',
  'a card carries no field beyond the six proven ones', Object.keys(card).sort());

// Status is preferred, type is the fallback, and absent stays absent.
ok(A.followingCards({ ids: ['x'], rows: [{ id: 'x', name: 'N', type: 'Residential' }] }).cards[0].context === 'Residential',
  'type is used only when the record states no status');
ok(A.followingCards({ ids: ['x'], rows: [{ id: 'x', name: 'N' }] }).cards[0].context === null,
  'a record stating neither status nor type gets no sub-line — never a default');
ok(A.followingCards({ ids: ['x'], rows: [{ id: 'x', name: 'N', zip: 'not-a-zip' }] }).cards[0].place === null,
  'a malformed zip yields no place line rather than a rendered bad value');

// last_seen_at is a per-ZIP REFRESH stamp (measured: min == max across every row in a ZIP),
// app_projects has no lifecycle column, and there is no project-level change plane. So none of
// this vocabulary can be derived from anything the record holds.
const rowWithExtras = { id: 'x', name: 'N', status: 'Approved', zip: '78617',
  last_seen_at: '2026-09-13T00:00:00Z', impact_score: 91, submitted_at: '2026-01-01' };
const extras = A.followingCards({ ids: ['x'], rows: [rowWithExtras] }).cards[0];
ok(extras.last_seen_at === undefined && extras.impact_score === undefined && extras.submitted_at === undefined,
  'freshness, impact and filing date do not reach the card even when the row carries them', extras);
// SCOPED TO THE FOLLOWING REGION, not the whole page: the Premium card legitimately renders
// "Quality-of-Life Impact · Premium", so a page-wide search would either pass vacuously or
// fail on unrelated copy. The region is the section's markup plus its render code.
const followMarkup = (read('dashboard.html')
  .match(/<div class="block" id="dashFollowing"[\s\S]*?<div class="block">\s*<div class="bt-row"><h2>Stay Informed/) || [''])[0];
const followJs = dash.slice(dash.indexOf('if (followingEl) {'),
  dash.indexOf('Add an address or a ZIP code and this briefing fills in'));
const followRegion = (followMarkup + followJs).toLowerCase();
// POSITIVE CONTROL. A region that failed to match is empty, and every absence below would
// then be true of nothing — success-shaped output attesting to nothing at all.
ok(followMarkup !== '' && followJs !== '' && followRegion.indexOf('projects you chose to monitor') !== -1
   && followRegion.indexOf('followingcards') !== -1,
  'the scanned Following region is real — markup and render code both found',
  { markup: followMarkup.length, js: followJs.length });
for (const banned of ['updated', 'recently changed', 'needs your attention', 'high impact',
                      'medium impact', 'low impact', 'quality-of-life', 'impact_score',
                      'you will be notified', 'alert active', 'notifications enabled',
                      'watchlist', 'last_seen', 'urgent', 'important project'])
  ok(followRegion.indexOf(banned) < 0,
    'the Following section does not render "' + banned + '"');

// A follow writes app_follows and nothing else. The section must not imply otherwise, and the
// existing project-follow copy already makes the same promise on the My Places card.
ok(/does not turn on email alerts/i.test(dash),
  'the empty state repeats that following does not turn on email alerts');
ok(!/user_subscriptions|pipeline_type|digest/.test(dash),
  'the Dashboard Following section touches no subscription or digest concept');

// =====================================================================================
console.log('\n--- §4 BOUNDED: ONE EXTRA READ, A CAPPED LIST, A TRUE COUNT --------------');
// =====================================================================================
ok(A.MAX_FOLLOWING_IDS === 50 && A.MAX_FOLLOWING_CARDS === 4,
  'the id cap and the card cap are pinned', [A.MAX_FOLLOWING_IDS, A.MAX_FOLLOWING_CARDS]);

// projectsByIds is one of the un-paginated readers and PostgREST silently caps those at 1,000
// rows. The id cap is what keeps that unreachable; it is not cosmetic.
const many = Array.from({ length: 120 }, (_, i) => 'id-' + i);
ok(A.followingQueryIds(many).length === 50, 'the id list handed to the batched read is capped at 50');
ok(A.followingQueryIds(many)[0] === 'id-0', 'the cap keeps the first ids, not an arbitrary slice');
ok(A.followingQueryIds(['a', 'a', 'b', null, '', 'b']).join(',') === 'a,b',
  'ids are deduped and blanks dropped before the read');

const big = A.followingCards({ ids: many, rows: [] });
ok(big.cards.length === 4, 'at most four cards render in the rail', big.cards.length);
ok(big.total === 120 && big.overflow === 116,
  'the overflow count is true against every follow, not against the capped read', big);
ok(A.followingCards({ ids: [], rows: [] }).total === 0
   && A.followingCards({ ids: [], rows: [] }).cards.length === 0,
  'zero follows produce zero cards');
ok(A.followingCards({}).cards.length === 0, 'a missing input is an empty section, not a throw');

// The page must skip the read entirely at zero follows — an empty .in() is a wasted request.
ok(/if \(followQuery\.length\)[\s\S]{0,200}projectsByIds/.test(dash),
  'the batched read is skipped when nothing is followed');
// Exactly one additional round trip, and it is the batched one. Counted as INVOCATIONS:
// the call site also tests `HS.data.projectsByIds` for presence, so counting bare mentions
// reports two reads where there is one.
ok((dash.match(/projectsByIds\(/g) || []).length === 1,
  'Following costs exactly one extra read', (dash.match(/projectsByIds\(/g) || []).length);
ok(!/forEach[\s\S]{0,120}projectsByIds|map\([\s\S]{0,120}projectsByIds/.test(dash),
  'the batched read is never issued per card');

// =====================================================================================
console.log('\n--- §5 THE SESSION GATE, AND WHERE IT SITS -------------------------------');
// =====================================================================================
// shell.js seeds state.follows from localStorage at module scope whatever the session state,
// and clearAccountLocalState() fires only on an explicit sign-out or an account-id change —
// never on a session that merely expired. app_projects is anon-readable, so without this gate
// a shared browser resolves the previous resident's followed project titles on a page that
// has no auth gate.
ok(/followingEl && !\(S\.session && !S\.session\.demo\)/.test(dash),
  'the section requires a real, non-demo session');
ok(/followingEl\.remove\(\)/.test(dash),
  'the section is REMOVED, not hidden — a hidden h2 still answers querySelectorAll');
// Placement is the load-bearing half: the gate must precede every await, or a read that
// throws leaves the node in the page.
const gateAt = dash.indexOf('followingEl.remove()');
const firstAwait = dash.indexOf('await ');
ok(gateAt > 0 && firstAwait > 0 && gateAt < firstAwait,
  'the gate runs before the first await, so a failure cannot leave the section behind',
  { gateAt, firstAwait });
ok(/id="dashFollowing"[^>]*\bhidden\b/.test(read('dashboard.html')),
  'the block ships hidden, so a page whose script never runs reveals nothing');

// A resident can follow a project while monitoring no Places at all. The section reports
// follows, not membership, so it must render before the zero-places early return.
// Anchored on the zero-places branch's own rendered COPY, not on its comment: `strip` removes
// `//` lines, so a comment anchor would read -1 and the ordering check would pass vacuously.
const followAt = dash.indexOf('A.followingCards(');
const zeroReturn = dash.indexOf('Add an address or a ZIP code and this briefing fills in');
ok(followAt > 0 && zeroReturn > 0 && followAt < zeroReturn,
  'Following renders before the zero-places return', { followAt, zeroReturn });

// =====================================================================================
console.log('\n--- §6 ROUTING TO THE EXISTING SURFACES ----------------------------------');
// =====================================================================================
// No new destination. development.html already resolves a followed project from another ZIP
// by id (it falls back to projectsByIds and otherwise renders missingRecord), and My Places
// is the one management surface.
ok(/pageHref\('development\.html', \{ id: c\.id, zip: c\.zip \}\)/.test(dash),
  'a card routes to the existing Development dossier by canonical id');
ok(!/following[\s\S]{0,400}(homesignalmap|alerts\.html|property\.html)/i.test(dash.slice(dash.indexOf('A.followingCards('), dash.indexOf('A.followingCards(') + 1400)),
  'Following invents no new destination');
ok(/id="dashManageFollowing" *>Manage/.test(read('dashboard.html'))
   || /properties\.html\?view=projects/.test(read('dashboard.html')),
  'management routes to the existing My Places page');

// The deep link is whitelisted against the views the page already declares, and anything else
// falls back to 'all' — which is what every pre-existing link to this page resolves to.
ok(/VIEWS *= *\['all', *'addresses', *'zips', *'projects'\]/.test(props),
  'My Places whitelists the view parameter against its own four views');
ok(/VIEWS\.indexOf\(q\) *!== *-1 *\? *q *: *'all'/.test(props),
  'an unknown or absent view falls back to all, so no existing entry point changes');
for (const v of ['data-view="all"', 'data-view="addresses"', 'data-view="zips"', 'data-view="projects"'])
  ok(props.indexOf(v) !== -1, 'My Places still declares ' + v);

console.log(fails ? '\n' + fails + ' failed' : '\nAll Fix 8J Following assertions passed.');
process.exit(fails ? 1 : 0);
