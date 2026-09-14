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

// =====================================================================================
console.log('\n--- §11 FIX 8G explicit monitored-ZIP attribution ---------------------------');
// =====================================================================================
// "Affects 2 of your places" was AMBIGUOUS across the one distinction that matters, and the
// ambiguity was live on production: a record related to ONE monitored ZIP read identically
// to a record reaching TWO. Attribution is now derived from the record's own canonical ZIPs
// intersected with the resident's monitored ZIPs — never from places.length, never from an
// address, never from the viewed place.

const G_PROPS = [{ id: 'p1', address: '13133 Coomes Dr', city: 'Del Valle', state: 'TX', zip: '78617' }];
const G_ZIPS = [
  { zip: '78617', name: 'Del Valle (78617)', state: 'TX' },
  { zip: '78657', name: 'Horseshoe Bay (78657)', state: 'TX' },
  { zip: '75009', name: 'Celina (75009)', state: 'TX' }
];
const G_META = {
  '78617': { zip: '78617', name: 'Del Valle (78617)', county: 'Travis', state: 'TX' },
  '78657': { zip: '78657', name: 'Horseshoe Bay (78657)', county: 'Llano', state: 'TX' },
  '75009': { zip: '75009', name: 'Celina (75009)', county: 'Collin', state: 'TX' }
};
const gPlaces = A.canonicalPlaces({ properties: G_PROPS, followedZips: G_ZIPS });
const gZips = A.queryZips(gPlaces, A.MAX_QUERY_ZIPS);
const gMap = A.buildZipLabelMap(gZips, G_META, gPlaces);
const WIDE = { maxLabels: A.ATTRIBUTION_MAX_LABELS_WIDE };
const NARROW = { maxLabels: A.ATTRIBUTION_MAX_LABELS_NARROW };
const attr = (item, opts) => A.monitoredZipAttribution(item, gZips, gMap, opts || WIDE);
const gBase = { source_ref: 'https://gov/a', title: 'Notice of public hearing',
  occurred_at: '2026-09-10', category: 'Government & civic' };

// §2D LABEL NORMALIZATION. Measured over all 12,722 app_community_meta rows: 12,703 names
// end with " (<their own ZIP>)" and the parenthesised ZIP matches on all 12,703 (0 mismatch);
// the 19 exceptions are the Box Elder / Utah County pilot ZIPs, bare place names. Without the
// strip, 99.85% of ZIPs would print the ZIP twice in two notations.
ok(gMap['75009'] === 'Celina · ZIP 75009', '11a the own-ZIP parenthetical is stripped once', gMap['75009']);
ok(!/\(75009\)/.test(gMap['75009']), '11b ...so the ZIP is never printed twice', gMap['75009']);
ok(A.buildZipLabelMap(['84301'], { '84301': { name: 'Bear River City' } }, [])['84301']
  === 'Bear River City · ZIP 84301', '11c a name with NO parenthetical is left alone');
ok(A.stripOwnZipSuffix('Somewhere (99999)', '78617') === 'Somewhere (99999)',
  '11d a parenthetical that is NOT this row\'s ZIP is NOT stripped — normalization, not a guess');
// §4 precedence: server first, store second, ZIP third.
ok(A.buildZipLabelMap(['78617'], { '78617': { name: 'Server Name (78617)' } },
  [{ kind: 'zip', zip: '78617', label: 'Store Name' }])['78617'] === 'Server Name · ZIP 78617',
  '11e app_community_meta.name WINS over local storage');
ok(A.buildZipLabelMap(['78617'], {}, [{ kind: 'zip', zip: '78617', label: 'Store Name' }])['78617']
  === 'Store Name · ZIP 78617', '11f ...and the store name is used when the server has none');
ok(A.buildZipLabelMap(['78617'], {}, [{ kind: 'zip', zip: '78617', label: 'ZIP 78617' }])['78617']
  === 'ZIP 78617', '11g canonicalPlaces\' own "ZIP <zip>" default is an ABSENCE, never a name');

// ---- A. ZIP-ONLY TRUTHFULNESS -------------------------------------------------------
// 1 + 2: ONE monitored ZIP that ALSO contains a saved address is still ONE relationship.
const a1 = A.dedupeChanges([Object.assign({ id: 'c1', zip: '78617',
  places: A.placesForZip(gPlaces, '78617') }, gBase)])[0];
ok(a1.places.length === 2, '11h (control) the ZIP+address overlap really is 2 Places', a1.places.length);
ok(attr(a1).summaryText === 'Del Valle · ZIP 78617',
  '11i A1/A2 a ZIP-level record names its ONE monitored ZIP, overlap or not', attr(a1).summaryText);
ok(attr(a1).affectedMonitoredZips.length === 1,
  '11j ...and reports ONE affected monitored ZIP, not two', attr(a1).affectedMonitoredZips);
// 3: a resident who saved ONLY an address in that ZIP still gets ZIP context, not the street.
const addrOnly = A.canonicalPlaces({ properties: G_PROPS, followedZips: [] });
const a3 = A.monitoredZipAttribution({ zip: '78617' }, A.queryZips(addrOnly),
  A.buildZipLabelMap(A.queryZips(addrOnly), G_META, addrOnly), WIDE);
ok(a3.summaryText === 'Del Valle · ZIP 78617',
  '11k A3 address-only membership still yields ZIP context', a3.summaryText);
// 4: no saved street address appears anywhere in attribution output.
const everyText = [attr(a1), a3, attr({ zip: '75009' })]
  .map((r) => JSON.stringify(r)).join(' ');
ok(!/Coomes/i.test(everyText), '11l A4 no saved street address appears in attribution', everyText.slice(0, 160));

// ---- B. MULTIPLE-ZIP ATTRIBUTION ----------------------------------------------------
// 5: two monitored ZIPs -> both labels, deterministic order.
const b2 = A.dedupeChanges([
  Object.assign({ id: 'c2a', zip: '78657', places: A.placesForZip(gPlaces, '78657') }, gBase),
  Object.assign({ id: 'c2b', zip: '75009', places: A.placesForZip(gPlaces, '75009') }, gBase)
])[0];
ok(b2.sourceZips.length === 2, '11m dedupeChanges accumulates BOTH source ZIPs', b2.sourceZips);
ok(attr(b2).summaryText === 'Celina · ZIP 75009 · Horseshoe Bay · ZIP 78657',
  '11n B5 both labels render, sorted by locality then ZIP', attr(b2).summaryText);
// 6 + 7: three ZIPs -> wide 2 + "+1 more monitored ZIP"; narrow 1 + "+2 more monitored ZIPs".
const b3 = A.dedupeChanges([
  Object.assign({ id: 'c3a', zip: '78617', places: A.placesForZip(gPlaces, '78617') }, gBase),
  Object.assign({ id: 'c3b', zip: '78657', places: A.placesForZip(gPlaces, '78657') }, gBase),
  Object.assign({ id: 'c3c', zip: '75009', places: A.placesForZip(gPlaces, '75009') }, gBase)
])[0];
ok(attr(b3, WIDE).summaryText === 'Celina · ZIP 75009 · Del Valle · ZIP 78617 · +1 more monitored ZIP',
  '11o B6 wide: two labels + singular overflow', attr(b3, WIDE).summaryText);
ok(attr(b3, NARROW).summaryText === 'Celina · ZIP 75009 · +2 more monitored ZIPs',
  '11p B6 narrow: one label + plural overflow', attr(b3, NARROW).summaryText);
ok(attr(b3, WIDE).overflowCount === 1 && attr(b3, NARROW).overflowCount === 2,
  '11q B7 overflow counts are the remainder, not the total');
ok(/\+1 more monitored ZIP$/.test(attr(b3, WIDE).summaryText)
  && /\+2 more monitored ZIPs$/.test(attr(b3, NARROW).summaryText),
  '11r B7 singular/plural overflow grammar');
// 8 + 9: a county record touching ZIPs the resident does NOT monitor names only the overlap.
const county = { id: 'cty', zip: '78617',
  sourceZips: ['78617', '73301', '78702', '78610', '75009'] };
ok(attr(county, WIDE).affectedMonitoredZips.join(',') === '75009,78617',
  '11s B8 only the intersection with monitored ZIPs is attributed', attr(county, WIDE).affectedMonitoredZips);
ok(!/73301|78702|78610/.test(attr(county, WIDE).summaryText),
  '11t B9 a source ZIP outside the monitored set never renders', attr(county, WIDE).summaryText);
// 10: repeated ZIPs in a meeting's zips[] cannot become duplicate labels.
const dupMtg = A.officialDateItems({ todayYmd: '2026-09-13', changes: [],
  meetings: [{ id: 'm1', title: 'Commissioners Court', meeting_date: '2026-09-20T06:00:00+00:00',
    zips: ['78617', '78617', '78617'], source_url: 'https://gov/m1' }] })[0];
ok(dupMtg.sourceZips.length === 1, '11u B10 repeated meeting ZIPs dedupe before labelling', dupMtg.sourceZips);
ok(attr(dupMtg, WIDE).summaryText === 'Del Valle · ZIP 78617',
  '11v ...so one ZIP yields one label', attr(dupMtg, WIDE).summaryText);

// ---- C. DEDUPLICATION / ORDER -------------------------------------------------------
// 11: the complete canonical source ZIP set survives even when labels are capped.
ok(attr(b3, NARROW).affectedMonitoredZips.length === 3,
  '11w C11 all three ZIPs are preserved though only one label is visible',
  attr(b3, NARROW).affectedMonitoredZips);
// 12: ZIP/address overlap does not inflate the attribution count.
ok(attr(a1).affectedMonitoredZips.length === 1 && a1.placeCount === 2,
  '11x C12 placeCount 2 but attribution 1 — the count no longer drives geography');
// 13: identity is UNCHANGED — same source_ref, different date, still two records.
const distinct = A.dedupeChanges([
  Object.assign({ id: 'd1', zip: '78617', places: [] }, gBase),
  Object.assign({ id: 'd2', zip: '78617', places: [] }, gBase, { occurred_at: '2026-08-01' })
]);
ok(distinct.length === 2, '11y C13 same source_ref on a different date stays DISTINCT', distinct.length);
// 14: order is stable regardless of the order the sources responded in.
const rev = A.dedupeChanges([
  Object.assign({ id: 'c3c', zip: '75009', places: [] }, gBase),
  Object.assign({ id: 'c3b', zip: '78657', places: [] }, gBase),
  Object.assign({ id: 'c3a', zip: '78617', places: [] }, gBase)
])[0];
ok(attr(rev, WIDE).summaryText === attr(b3, WIDE).summaryText,
  '11z C14 label order is identical when the response order is reversed', attr(rev, WIDE).summaryText);
// ⚠️ 11z alone does NOT isolate the attribution sort: dedupeChanges already normalizes row
// order through compareForDedupe, so both inputs reach attribution identically. Feed the ZIP
// list DIRECTLY, in three different arrival orders, to pin the sort itself.
const orders = [['78617', '78657', '75009'], ['75009', '78617', '78657'], ['78657', '75009', '78617']]
  .map((z) => attr({ id: 'o', sourceZips: z }, WIDE).affectedMonitoredZips.join(','));
ok(orders[0] === '75009,78617,78657' && orders[1] === orders[0] && orders[2] === orders[0],
  '11z2 C14 the ORDER is sorted by locality label then ZIP, whatever order the ZIPs arrive in', orders);
// §5 explicitly forbids follow-creation order, which is the ONLY order the repo actually has
// (canonicalPlaces preserves input order; the ZIP input is the hs:myCommunities array).
ok(orders[0] !== gZips.join(','),
  '11z3 ...and it is NOT the resident\'s follow order', { sorted: orders[0], followOrder: gZips.join(',') });

// ---- D. FALLBACK LADDER (active: 1 -> 2 -> 4 -> 5; rung 3 is unreachable) ------------
// 17: no locality name -> "ZIP <zip>".
const noName = A.monitoredZipAttribution({ zip: '78617' }, ['78617'],
  A.buildZipLabelMap(['78617'], {}, []), WIDE);
ok(noName.summaryText === 'ZIP 78617' && noName.fallbackKind === 'zip_only',
  '11aa D17 rung 2 — no locality name renders "ZIP 78617"', noName);
ok(attr(a1).fallbackKind === 'canonical_monitored_zip', '11ab rung 1 is the labelled case');
// 18: authoritative reach but NO displayable ZIP -> the approved truthful fallback.
const unl = attr({ id: 'x', sourceZips: [] }, WIDE);
ok(unl.fallbackKind === 'relevant_unlabelled' && unl.summaryText === A.ATTRIBUTION_UNLABELLED,
  '11ac D18 rung 4 — "Relevant to a monitored ZIP" when no ZIP is displayable', unl);
// ...and a record whose ZIPs are ALL outside the monitored set is OMITTED, never claimed.
const outside = attr({ id: 'y', sourceZips: ['73301', '78702'] }, WIDE);
ok(outside.fallbackKind === 'none' && outside.summaryText === '',
  '11ad D18 rung 5 — ZIPs entirely outside the monitored set omit attribution', outside);
// 19: the ambiguous string is gone from BOTH sections, and from the view-model.
ok(!/Affects \d| of your places|Affects ' \+/.test(dash),
  '11ae D19 no "Affects N of your places" remains in dashboard.html',
  (dash.match(/.{0,60}of your places.{0,60}/) || [])[0]);
ok(!/placeCtx|datePlaceCtx|labelForZip/.test(dash),
  '11af D19 both page-local attribution rules are gone (§10 view-model direction)',
  (dash.match(/.{0,40}(placeCtx|datePlaceCtx|labelForZip).{0,40}/) || [])[0]);
ok(!/of your places/.test(strip(aggSrc)), '11ag ...and the view-model never emits it either');
// Rung 3 must not exist as dead logic, copy or comment implying it can fire.
ok(!/source_locality|source geography|rung ?3/i.test(strip(aggSrc).replace(/Rung 3[^\n]*UNREACHABLE[\s\S]*?forbids\./, '')),
  '11ah rung 3 ships no conditional, copy or state — it is unreachable and absent');
// 20 + 22: the responsive cap is the approved one, and overflow is inert text.
ok(A.ATTRIBUTION_MAX_LABELS_WIDE === 2 && A.ATTRIBUTION_MAX_LABELS_NARROW === 1,
  '11ai D20 the approved label cap is 2 wide / 1 narrow');
ok(/\.mzip-narrow\{display:none\}/.test(dashRaw) && /@media\(max-width:900px\)[\s\S]{0,240}\.mzip-wide\{display:none\}/.test(dashRaw),
  '11aj D20 the 900px breakpoint — an EXISTING one — swaps the variants, CSS only');
ok(!/offsetWidth|scrollWidth|getBoundingClientRect|measureText/.test(dash),
  '11ak D20 no runtime text measurement is introduced');
ok(!/class="mzip[^"]*"[^>]*href|<a[^>]*class="mzip/.test(dash),
  '11al D22 the overflow summary is plain, non-interactive text — no link, popover or modal');
// 23: it is visible semantic text, not a tooltip/aria-only affordance.
ok(!/title="[^"]*more monitored ZIP|aria-label="[^"]*more monitored ZIP/.test(dash),
  '11am D23 the summary is not hidden behind a tooltip or aria-only content');

// ---- E. REGRESSION ------------------------------------------------------------------
ok(A.premiumLeadContext().source === 'Dashboard Quality-of-Life'
  && A.premiumLeadContext().zip === undefined && A.premiumLeadContext().address === undefined,
  '11an E26 Premium lead context is unchanged: source only, no zip, no address',
  A.premiumLeadContext());
ok(A.queryZips(gPlaces, A.MAX_QUERY_ZIPS).join(',') === '78617,78657,75009',
  '11ao E25 All My Places scope and query set are unchanged', gZips);
ok(!/from\(|\.select\(|supabase|sb\(\)/.test(strip(aggSrc)),
  '11ap E28 the view-model issues NO query — no per-row or per-ZIP label lookup exists');
ok(/A\.buildZipLabelMap\(zips, meta, places\)/.test(dash),
  '11aq E28 ...and the page builds the label map ONCE from the already-loaded meta read');

console.log(fails ? '\n' + fails + ' assertion(s) failed' : '\nAll Fix 8 All My Places assertions passed.');
process.exit(fails ? 1 : 0);
