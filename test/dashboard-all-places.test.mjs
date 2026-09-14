// FIX 8 — the ALL MY PLACES Dashboard contract.
//
// WHY THIS FILE EXISTS. Every defect this page can have is a SILENT one. A record attributed
// to the wrong place still renders. Two distinct filings merged into one row still renders.
// A meeting stamped with a clock time the source never stated still renders — and looks more
// useful than the truth. A failed source rendered as "nothing is happening" is the most
// convincing of all. None of them throw, so none of them are caught by anything except an
// assertion written against the shipped code.
//
// So this suite drives lib/dashboard-aggregate.js DIRECTLY in Node — the real module the
// browser loads, not a reimplementation — and greps dashboard.html only where the fact being
// pinned is a composition fact that lives in the page.
//
// Run: node test/dashboard-all-places.test.mjs
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
// Comment-stripped: several checks below name the very string they forbid, and a `//` line
// or an HTML comment explaining an absence must never be able to satisfy a check for it.
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
const dash = strip(read('dashboard.html'));
const aggSrc = read('lib/dashboard-aggregate.js');

// =====================================================================================
console.log('\n--- §1 SCOPE: membership is canonical My Places, and nothing else ---------');
// =====================================================================================

const PROPS = [
  { id: 'p1', address: '13133 Coomes Dr', city: 'Del Valle', state: 'TX', zip: '78617' },
  { id: 'p2', address: '96 Island Dr', city: 'Horseshoe Bay', state: 'TX', zip: '78657' }
];
const ZIPS = [
  { zip: '78617', name: 'Del Valle', state: 'TX' },
  { zip: '78657', name: 'Horseshoe Bay', state: 'TX' },
  { zip: '78701', name: 'Austin', state: 'TX' }
];

const places = A.canonicalPlaces({ properties: PROPS, followedZips: ZIPS });
ok(places.length === 5, '1a canonicalPlaces returns every Address AND every followed ZIP', places.length);
ok(places.filter((p) => p.kind === 'address').length === 2, '1b both Addresses are Places');
ok(places.filter((p) => p.kind === 'zip').length === 3, '1c all three ZIP Codes are Places');

// ACCEPTANCE 2-5: the viewed place cannot reach this function — it takes no such argument and
// the module names none of those identifiers. That is a STRUCTURAL proof, which is stronger
// than a behavioural one here: a behavioural test could only show that a global this code does
// not read did not change the answer.
for (const forbidden of ['viewZip', 'myZip', 'HS.state.zip', 'state.zip', 'sessionStorage',
                         'location.search', 'DEFAULT_ZIP', 'activeProperty'])
  ok(!strip(aggSrc).includes(forbidden),
    '1d the view-model never references ' + forbidden,
    (strip(aggSrc).match(new RegExp('.{0,50}' + forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.{0,50}')) || [])[0]);
ok(!/HS\.ensureViewedZip\(/.test(dash), '1e dashboard.html does not call ensureViewedZip');
ok(!/S\.zip|HS\.state\.zip/.test(dash), '1f dashboard.html reads no viewed ZIP',
  (dash.match(/.{0,50}(S\.zip|HS\.state\.zip).{0,50}/) || [])[0]);

// ACCEPTANCE 6: the FIRST app_follows row must not decide anything. Three followed ZIPs go in;
// three come out, in the order given, with none privileged.
ok(places.filter((p) => p.kind === 'zip').map((p) => p.zip).join(',') === '78617,78657,78701',
  '1g every followed ZIP is a Place — the first row is not special');

// ACCEPTANCE 7: changing the viewed place elsewhere changes nothing here. Same membership,
// same answer, regardless of what any other surface is pointed at.
const again = A.canonicalPlaces({ properties: PROPS, followedZips: ZIPS });
ok(JSON.stringify(places) === JSON.stringify(again),
  '1h membership is a pure function of the two canonical stores');

// ACCEPTANCE 8-9: multi-ZIP, and ZIP+address, aggregate into one bounded query set. An Address
// inside a followed ZIP must not make that ZIP queried twice.
const qz = A.queryZips(places);
ok(qz.length === 3 && qz.join(',') === '78617,78657,78701',
  '1i queryZips dedupes an Address that sits inside a followed ZIP', qz);
ok(A.queryZips(A.canonicalPlaces({ properties: [PROPS[0]], followedZips: [] })).join(',') === '78617',
  '1j an Address with no ZIP follow still produces a briefing scope');

// A sample/demo persona is NEVER a Place (config.js:14-20).
const withSample = A.canonicalPlaces({
  properties: PROPS.concat([{ id: 'p9', address: '4400 Wildhorse Trail', zip: '78617', sample: true }]),
  followedZips: []
});
ok(withSample.length === 2 && !withSample.some((p) => p.label.includes('Wildhorse')),
  '1k the seeded demo home never enters Dashboard membership');

// The query set is BOUNDED. The cap is disclosed by the page, never silently truncating.
const many = A.canonicalPlaces({ properties: [], followedZips: Array.from({ length: 40 },
  (_, i) => ({ zip: String(90001 + i), name: 'Z' + i })) });
ok(A.queryZips(many, A.MAX_QUERY_ZIPS).length === A.MAX_QUERY_ZIPS,
  '1l queryZips honours MAX_QUERY_ZIPS (' + A.MAX_QUERY_ZIPS + ')');
ok(/Showing updates across your first/.test(dash),
  '1m ...and the page SAYS so when the cap bites, rather than truncating in silence');

// The per-ZIP development fan-out is bounded too, and the bound must be a SMALL FINITE
// number that the page actually applies. Asserting only that the constant is exported
// would pass with it set to 100000 — which is Promise.all(N) wearing a pool's name, the
// exact shape the pool exists to prevent. So both halves are pinned: the value, and the
// fact that `pool` is the thing receiving it.
ok(Number.isInteger(A.QUERY_CONCURRENCY) && A.QUERY_CONCURRENCY >= 1 && A.QUERY_CONCURRENCY <= 8,
  '1n QUERY_CONCURRENCY is a small finite bound', A.QUERY_CONCURRENCY);
ok(Number.isInteger(A.MAX_QUERY_ZIPS) && A.MAX_QUERY_ZIPS >= 1 && A.MAX_QUERY_ZIPS <= 50,
  '1n2 MAX_QUERY_ZIPS is a small finite bound', A.MAX_QUERY_ZIPS);
ok(/pool\(zips,\s*A\.QUERY_CONCURRENCY\s*,/.test(dash),
  '1n3 ...and the page fans out through pool() with that bound, never Promise.all');
ok(!/Promise\.all\(\s*zips/.test(dash),
  '1n4 the page never fans out one request per ZIP unbounded');

// A followed entry with NO ZIP is not a Place. app_follows/localStorage rows can arrive
// malformed, and a Place with a null zip would be counted in the header, queried as the
// string "null", and attributed records that belong to no place of the resident's.
const badFollows = A.canonicalPlaces({
  properties: [],
  followedZips: [{ name: 'No zip at all' }, { zip: null, name: 'Explicit null' }, { zip: '78617', name: 'Del Valle' }]
});
ok(badFollows.length === 1 && badFollows[0].zip === '78617',
  '1o a followed entry with no ZIP is never a Place', JSON.stringify(badFollows));

// =====================================================================================
console.log('\n--- §2 DEDUPLICATION: collapse repeats, never merge distinct records ------');
// =====================================================================================

const base = { source_ref: 'https://x/notice/1', title: 'Rezoning hearing', occurred_at: '2026-09-10',
               category: 'Government & civic' };
const pA = { id: 'zip:78617', label: 'Del Valle' };
const pB = { id: 'zip:78657', label: 'Horseshoe Bay' };

// ACCEPTANCE 10: the key is the full composite.
ok(A.changeKey(base).split('\u001f').length === 4,
  '2a changeKey is (source_ref, title, occurred_at, category) — four parts');
ok(A.changeKey(base) !== A.changeKey(Object.assign({}, base, { category: 'Planning & zoning' })),
  '2b category is IN the key');

// ACCEPTANCE 14: one record reaching two monitored places renders ONCE, and says so.
const merged = A.dedupeChanges([
  Object.assign({ id: 'c1', zip: '78617', places: [pA] }, base),
  Object.assign({ id: 'c2', zip: '78657', places: [pB] }, base)
]);
ok(merged.length === 1, '2c the same record materialized in two ZIPs collapses to one row');
ok(merged[0].placeCount === 2, '2d ...and reports that it affects 2 of the resident\'s places');

// ACCEPTANCE 11-13, 15: the three ways a shared field must NOT cause a merge.
const notMerged = (mutation, why) => {
  const out = A.dedupeChanges([
    Object.assign({ id: 'c1', zip: '78617', places: [pA] }, base),
    Object.assign({ id: 'c2', zip: '78617', places: [pA] }, base, mutation)
  ]);
  ok(out.length === 2, why, out.map((r) => r.id));
};
notMerged({ title: 'Rezoning hearing (continued)' },
  '2e same source_ref, DIFFERENT title stays two records');
notMerged({ occurred_at: '2026-09-11' },
  '2f same source_ref, DIFFERENT date stays two records (a re-issued notice is a real filing)');
notMerged({ category: 'Planning & zoning' },
  '2g same source_ref, DIFFERENT category stays two records');
notMerged({ source_ref: 'https://x/notice/2' },
  '2h same title and date, DIFFERENT source_ref stays two records');

// ⛔ The failure mode that would look like a feature: keying on source_ref alone. Measured on
// production 2026-09-13, that over-merges 2,572 groups — 674 refs carry more than one distinct
// title, 1,837 more than one date. This proves the shipped key is not that.
const refOnly = A.dedupeChanges([
  Object.assign({ id: 'c1', zip: '78617', places: [pA] }, base),
  Object.assign({ id: 'c2', zip: '78617', places: [pA] }, base, { title: 'Something else entirely' })
]);
ok(refOnly.length === 2, '2i deduping on source_ref ALONE is not what ships');

// ACCEPTANCE 16-17: PROVENANCE. The surviving row's id and zip travel together, and the
// winner is chosen by a total order — never by which response arrived first.
const provenance = A.dedupeChanges([
  Object.assign({ id: 'cB', zip: '78657', places: [pB] }, base),
  Object.assign({ id: 'cA', zip: '78617', places: [pA] }, base)
]);
const reversed = A.dedupeChanges([
  Object.assign({ id: 'cA', zip: '78617', places: [pA] }, base),
  Object.assign({ id: 'cB', zip: '78657', places: [pB] }, base)
]);
ok(provenance[0].id === reversed[0].id && provenance[0].zip === reversed[0].zip,
  '2j the surviving row is deterministic regardless of input order',
  [provenance[0].id, reversed[0].id]);
ok(provenance[0].zip === '78617' && provenance[0].id === 'cA',
  '2k ...and its id and zip are the PAIR from one source row, never mixed', provenance[0]);

// Recency wins over everything: newest first.
const ordered = A.dedupeChanges([
  { id: 'old', zip: '78617', places: [pA], source_ref: 'a', title: 'A', occurred_at: '2026-01-01', category: 'Government & civic' },
  { id: 'new', zip: '78617', places: [pA], source_ref: 'b', title: 'B', occurred_at: '2026-09-01', category: 'Government & civic' }
]);
ok(ordered[0].id === 'new', '2l output is newest-first');

// =====================================================================================
console.log('\n--- §3 TYPE LABELS: only categories production actually has ---------------');
// =====================================================================================

ok(A.typeLabelForChange('Government & civic') === 'Government Notice', '3a Government & civic -> Government Notice');
ok(A.typeLabelForChange('Planning & zoning') === 'Government Notice',
  '3b Planning & zoning -> Government Notice (sampled rows are NOTICES about planning, not permit filings)');
ok(A.typeLabelForChange('Local News') === 'Local News', '3c Local News -> Local News');
// ⛔ There is no Infrastructure category in app_changes (measured: exactly three categories).
// The approved mock shows an Infrastructure row; no data backs it, so it must never render.
ok(A.typeLabelForChange('Infrastructure') === null, '3d there is no "Infrastructure" category to label');
ok(!/Infrastructure/.test(dash.replace(/civic activity across the places you monitor/, '')),
  '3e no Infrastructure type pill is rendered on the page',
  (dash.match(/.{0,60}Infrastructure.{0,60}/) || [])[0]);
ok(A.typeLabelForChange('') === null && A.typeLabelForChange(undefined) === null,
  '3f an unknown/absent category yields no label — the row is dropped, never guessed');

// =====================================================================================
console.log('\n--- §4 MEETING TIME: only a time the source actually stated ---------------');
// =====================================================================================

// ACCEPTANCE 38-41. Measured 2026-09-13: 2,480 of 2,574 upcoming meetings sit at exactly
// 06:00:00Z or 07:00:00Z — midnight MDT / MST-PDT — with meeting_time NULL on every one.
ok(A.meetingTimeDisplay({ meeting_date: '2026-09-14T06:00:00+00:00', meeting_time: null }) === null,
  '4a a midnight-in-local-zone meeting_date yields NO clock time');
ok(A.meetingTimeDisplay({ meeting_date: '2026-09-14T01:30:00+00:00', meeting_time: null }) === null,
  '4b ...and neither does a non-midnight one — meeting_date is never a time source');
ok(A.meetingTimeDisplay({ meeting_date: '2026-09-14T15:00:00+00:00', meeting_time: '9:00 AM' }) === '9:00 AM',
  '4c a STATED meeting_time renders, verbatim');
ok(A.meetingTimeDisplay({ meeting_time: '   ' }) === null, '4d a blank stated time is absent, not empty-string');
ok(!/America\/Chicago|toLocaleTimeString|timeZone/.test(dash + strip(aggSrc)),
  '4e no timezone is assumed anywhere on the Dashboard path',
  ((dash + aggSrc).match(/.{0,50}(America\/Chicago|toLocaleTimeString).{0,50}/) || [])[0]);
// ACCEPTANCE 45: no relative urgency label on a meeting.
for (const label of ['Days Left', 'Closing Soon', 'Tomorrow', 'This evening', 'days left'])
  ok(!dash.includes(label), '4f no relative urgency label "' + label + '" renders');

// =====================================================================================
console.log('\n--- §5 OFFICIAL DATES: future-dated, unexpired, no invented participation -');
// =====================================================================================

const TODAY = '2026-09-13';
const dates = A.officialDateItems({
  todayYmd: TODAY,
  meetings: [
    { id: 'm1', zip: '78617', places: [pA], title: 'Commissioners Court', meeting_date: '2026-09-18T06:00:00+00:00', meeting_time: null, source_url: 'https://x/m1' },
    { id: 'm0', zip: '78617', places: [pA], title: 'Past meeting', meeting_date: '2026-09-01T06:00:00+00:00', meeting_time: null, source_url: 'https://x/m0' }
  ],
  changes: [
    { id: 'c1', zip: '78617', places: [pA], title: 'Comment period', window_closes_at: '2026-09-16' },
    { id: 'c0', zip: '78617', places: [pA], title: 'Expired comment period', window_closes_at: '2026-09-01' },
    { id: 'c2', zip: '78617', places: [pA], title: 'No window', window_closes_at: null }
  ]
});
ok(dates.length === 2, '5a only the future meeting and the OPEN window survive', dates.map((d) => d.id));
ok(!dates.some((d) => d.id === 'm0'), '5b completed meetings are excluded');
ok(!dates.some((d) => d.id === 'c0'), '5c expired deadlines are excluded');
ok(!dates.some((d) => d.id === 'c2'), '5d a record with no comment window is not an official date');
ok(dates[0].id === 'c1' && dates[1].id === 'm1', '5e the list is chronological', dates.map((d) => d.dateYmd));
ok(dates.find((d) => d.id === 'm1').time === null,
  '5f the surviving meeting carries NO time — its source stated none');
// Boundary: a window closing TODAY is still open.
ok(A.isOpenCommentWindow({ window_closes_at: TODAY }, TODAY), '5g a window closing today is still open');
ok(!A.isOpenCommentWindow({ window_closes_at: '2026-09-12' }, TODAY), '5h yesterday is closed');

// ACCEPTANCE 44: no participation instruction exists in production (alerts.comment_deadline is
// null on all 44,626 rows; meetings.comment_period_open false on all 2,574 upcoming), so no
// participation CTA may be generated.
for (const cta of ['How to participate', 'Submit a comment', 'Comment now', 'Take action',
                   'Influence this', 'Make your voice heard'])
  ok(!dash.includes(cta), '5i no invented participation CTA: "' + cta + '"');
ok(/Review official notice/.test(dash),
  '5j an open window links to the OFFICIAL NOTICE, which is where real instructions live');

// =====================================================================================
console.log('\n--- §5b CALENDAR DATES: a date-only value is not an instant ---------------');
// =====================================================================================

// MEASURED: new Date('2026-09-16') parses as UTC midnight, so toLocaleDateString() renders
// "Sep 15" anywhere west of UTC — which is essentially every HomeSignal resident, and on a
// comment deadline it understates the time they have left to act. Every date this page shows
// is a Postgres `date`, so it is formatted from its PARTS and never becomes a Date.
const TZS = ['America/Los_Angeles', 'America/Chicago', 'UTC', 'Pacific/Auckland'];
const prevTZ = process.env.TZ;
for (const tz of TZS) {
  process.env.TZ = tz;
  ok(A.fmtCalendarDate('2026-09-16') === 'Sep 16',
    '5b-' + tz + ' a calendar date renders as itself, not shifted by the viewer\'s zone',
    A.fmtCalendarDate('2026-09-16'));
}
process.env.TZ = prevTZ;
ok(A.fmtCalendarDate('2026-01-01') === 'Jan 1' && A.fmtCalendarDate('2026-12-31') === 'Dec 31',
  '5b-edges year boundaries render correctly');
ok(A.fmtCalendarDate(null) === '' && A.fmtCalendarDate('') === '' && A.fmtCalendarDate('nonsense') === '',
  '5b-absent an absent or unparseable date renders as nothing, never as a guess');
// The page must not reach for the shared formatter on a calendar date.
ok(!/HS\.fmtDate\((it|d)\./.test(dash),
  '5b-page the Dashboard formats calendar dates through fmtCalendarDate, not HS.fmtDate',
  (dash.match(/.{0,40}HS\.fmtDate\(.{0,40}/) || [])[0]);

// =====================================================================================
console.log('\n--- §6 SOURCE AVAILABILITY: a failed read is never an absence -------------');
// =====================================================================================

const failed = A.sourceAvailability({ changes: false, development: true, meetings: true, places: true });
ok(failed.changes === 'failed' && failed.anyFailed === true, '6a a failed source is recorded as failed');
ok(A.sourceAvailability({}).changes === 'unknown', '6b an unreported source is unknown, not ok');
ok(A.sourceAvailability({ changes: false, development: false, meetings: false }).allFailed === true,
  '6c a total outage is distinguishable from a quiet week');
ok(/could not read updates/.test(dash) && /not an absence of activity/.test(dash),
  '6d the page SAYS a read failed rather than claiming nothing is happening');
ok(/No new government notices/.test(dash),
  '6e ...and the genuinely-empty state is a separate, honest sentence');
ok(/No upcoming official dates are available right now/.test(dash),
  '6f the approved no-dates copy is used verbatim');
// ACCEPTANCE 53: never a false zero while membership is still unknown.
ok(/countBox\.hidden = false/.test(dash) && /id="dashCount" hidden/.test(read('dashboard.html')),
  '6g the monitored-place count is HIDDEN until membership is known — never a placeholder 0');

// =====================================================================================
console.log('\n--- §7 LEGACY ?zip= : stripped before any CTA can read it -----------------');
// =====================================================================================

ok(A.searchWithoutZip('?zip=78617') === '', '7a a lone zip parameter is removed entirely');
ok(A.searchWithoutZip('?zip=78617&demo=1') === '?demo=1', '7b other parameters survive');
ok(A.searchWithoutZip('?demo=1&zip=78617') === '?demo=1', '7c ...in any position');
ok(A.searchWithoutZip('?demo=1') === null, '7d no zip parameter -> null, so no pointless history write');
ok(A.searchWithoutZip('') === null, '7e an empty query string is left alone');
// ⚠️ THE COMPOSITION IS THE LOAD-BEARING PIN, not the presence of the helper. A mutation that
// replaced the call with `var cleaned = null;` survived an earlier version of this check: every
// helper assertion above stayed green while the page stopped stripping anything. Assert that the
// page feeds location.search INTO the shipped helper and writes the result back through history.
ok(/A\.searchWithoutZip\(location\.search\)/.test(dash),
  '7f the page actually passes location.search to the shipped helper');
ok(/history\.replaceState\(history\.state, '', location\.pathname \+ cleaned/.test(dash),
  '7g ...and writes the cleaned URL back, so zipFromLocation finds no ZIP');
ok(dash.indexOf('searchWithoutZip') < dash.indexOf('openPremiumModal'),
  '7h ...before the Premium CTA is wired, so the fallback can never see a stale parameter');

// =====================================================================================
console.log('\n--- §8 ROUTING: every CTA carries the RECORD\'s own zip --------------------');
// =====================================================================================

ok(/pageHref\('development\.html', \{ zip: it\.zip, id: it\.id \}\)/.test(dash),
  '8a Development routes with the record\'s own zip + id');
ok(/pageHref\('alerts\.html', \{ zip: it\.zip, id: it\.id \}\)/.test(dash),
  '8b Government Notice routes with the record\'s own zip + id');
ok(/it\.source_ref \|\| null/.test(dash), '8c Local News links to the publisher\'s own article URL');
ok(/pageHref\('alerts\.html', \{ zip: d\.zip, id: d\.id, band: 'open' \}\)/.test(dash),
  '8d an open comment window routes to the focused notice');
ok(/Review development/.test(dash) && /View notice/.test(dash)
  && /Read article/.test(dash) && /View meeting/.test(dash),
  '8e all four record-level CTA labels are the approved ones');
// ACCEPTANCE 26: no aggregate destination exists, so no aggregate CTA may render.
ok(!/View all/.test(dash), '8f no aggregate "View all" CTA renders in this release',
  (dash.match(/.{0,60}View all.{0,60}/) || [])[0]);

// =====================================================================================
console.log('\n--- §9 "Recent" is only claimed if it is defined ---------------------------');
// =====================================================================================

// ACCEPTANCE 19: no durable seen-state or "recent" semantic is implemented, so the approved
// fallback subtitle is the one that ships.
ok(/Relevant updates across all your monitored places/.test(dash),
  '9a the subtitle is the RELEVANT form, not the unearned "Recent" one');
ok(!/Recent updates across all your monitored places/.test(dash),
  '9b ...and the "Recent" form is absent, because no audited definition backs it');
ok(!/\bNEW\b|badge-new|isNew\(/.test(dash), '9c no fabricated "new" count or badge renders');

// =====================================================================================
console.log('\n--- §10 FIX 8I the header is the SHARED page-header system ------------------');
// =====================================================================================
// The Dashboard was the one page not using app.css's .ph .eyebrow / .ph h1 — it rendered
// "Dashboard" as the large black h1 and demoted the resident's question to grey body copy.
// These are composition facts that live in the page, so they are grepped, not driven.
//
// ⚠️ `dash` is COMMENT-STRIPPED (see strip() above) and that is load-bearing here: the
// markup comment added with this change explains the absence of a "Dashboard" h1 by naming
// it, and an HTML comment must never be able to satisfy — or fail — a check about markup.

const dashRaw = read('dashboard.html');
ok(/<div class="eyebrow">Dashboard<\/div>/.test(dash),
  '10a DASHBOARD renders through the shared .ph .eyebrow, exactly as Alerts writes "Alerts"');
ok(/<h1 id="dashSub"><\/h1>/.test(dash),
  '10b ...and #dashSub is the primary <h1>, so the resident QUESTION is the headline');
ok(!/<h1[^>]*>Dashboard<\/h1>/.test(dash),
  '10c ...and no <h1> reads "Dashboard" — the large black treatment is gone',
  (dash.match(/<h1[^>]*>Dashboard<\/h1>/) || [])[0]);
ok(!/<p id="dashSub"/.test(dash),
  '10d ...and the question is no longer a <p>');

// REUSE, NOT A NEAR-MATCH. The whole point of Fix 8I is that app.css already ships this
// component; a local font-size/colour/letter-spacing here would be a second implementation
// that silently drifts from Alerts and Development the next time app.css moves.
const dashCss = (dashRaw.match(/<style[\s\S]*?<\/style>/g) || []).join('\n');
ok(!/\.eyebrow\s*\{/.test(dashCss) && !/h1\s*\{/.test(dashCss) && !/\.ph\s+h1/.test(dashCss),
  '10e dashboard.html declares NO local eyebrow/h1 typography — app.css .ph is reused');
ok(!/<h1[^>]*style=/.test(dash),
  '10f ...and the h1 carries no inline style, so .ph h1 governs its margin rhythm',
  (dash.match(/<h1[^>]*style=[^>]*>/) || [])[0]);

// The right-hand summary is preserved verbatim — Fix 8I changes the left column only.
ok(/id="dashCountN"/.test(dash) && /id="dashCountLbl"/.test(dash)
  && /Tracking development, government notices, meetings, and local news/.test(dash),
  '10g the monitored-place count and its supporting copy are untouched');

// GRAMMAR. Singular drops the numeral; "your 1 monitored place" is the shape a naive
// count-plus-plural expression produces and it reads as a system report, not a sentence.
ok(/What’s changing across your monitored place\?/.test(dash),
  '10h N = 1 reads "your monitored place" — no numeral');
ok(/What’s changing across your ' \+ placeCount \+ ' monitored places\?/.test(dash),
  '10i N > 1 carries the count and the plural');
ok(/What’s changing across the places you monitor\?/.test(dash),
  '10j N = 0 keeps its existing honest copy');
ok(!/' monitored place' \+ \(placeCount === 1 \? '' : 's'\)/.test(dash),
  '10k ...and the old count-plus-plural expression, which produced "your 1 monitored place", is gone');

// The removals Fix 8 made stay removed — a header change must not be a door back in.
for (const gone of ['dashStrip', 'dashMapLink', 'Welcome back', 'Good morning'])
  ok(!new RegExp(gone).test(dash), '10l no ' + gone + ' returns with the header change');

console.log(fails ? '\n' + fails + ' assertion(s) failed' : '\nAll Fix 8 All My Places assertions passed.');
process.exit(fails ? 1 : 0);
