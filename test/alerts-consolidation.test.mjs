// ALERTS CONSOLIDATION — the A-014 / A-015 contract.
//
// WHY THIS FILE EXISTS. A-014 says Alerts is ALREADY the one alerts container and its
// behavior is to be PRESERVED, and A-015 says no export/report affordance belongs on it.
// A contract whose only requirement is "change nothing" is the easiest kind to erode:
// nothing fails when a tab label is shortened, a scope sentence is dropped, a classifier
// is "simplified", or an Export button is added as an obvious convenience. This file is
// the thing that fails.
//
// It deliberately does NOT restate test/alerts-filter.test.mjs (tab keys, long labels,
// the sort select, resolveTab/applyFocus, TAB_EMPTY). It pins what that file does not:
// the per-tab county-scope disclosure, the never-invent-a-county fallback, the
// two-section Local News structure, the classifier set, the FM-054 my-alerts forward,
// and the A-015 negatives.
//
// Every check runs on a COMMENT-STRIPPED copy. Three separate assertions in this repo
// have already gone green off a code comment that mentioned the very string it forbids;
// a comment explaining why something is absent must not be able to satisfy a check that
// it is absent.
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
  + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 200) : '')); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const alerts = strip(read('alerts.html'));
const myAlerts = strip(read('my-alerts.html'));
const dash = strip(read('dashboard.html'));

// ---- A-014: ONE alerts container, and the legacy route still reaches it (FM-054) ----
ok(/url=alerts\.html/.test(myAlerts), 'FM-054 my-alerts.html still meta-refreshes to alerts.html');
ok(/location\.replace\(\s*'alerts\.html'\s*\+\s*location\.search\s*\)/.test(myAlerts),
  'FM-054 my-alerts.html forwards location.search, so a deep link survives the redirect');
ok(/href="alerts\.html"/.test(dash), 'A-014 Dashboard still links out to alerts.html rather than owning a second feed');

// ---- A-014: the tab labels are the PAGE's words, pinned on the BUTTON ----
// MEASURED, and it is why this block exists: shortening the first tab to "Gov" leaves
// test/alerts-filter.test.mjs GREEN, because its /Government Notices/ substring test is
// satisfied by the topic-card <h4> further up the page. The workbook's shorthand
// ("Gov / Meetings / News") is a column heading, not UI copy — so the button itself is
// pinned here, in order, or the rename lands undetected.
{
  const seg = (alerts.match(/<div class="seg" id="alFilter">([\s\S]*?)<\/div>/) || [])[1] || '';
  const btns = [...seg.matchAll(/<button[^>]*data-tab="([a-z]+)"[^>]*>([^<]*)<\/button>/g)]
    .map(m => m[1] + '=' + m[2].trim());
  ok(btns.join('|') === 'gov=Government Notices|meetings=Upcoming Meetings|news=Local News',
    'A-014 the #alFilter buttons carry the full labels, in order', btns);
}

// ---- A-014: the per-tab county-scope disclosure, on ALL THREE tabs ----
// Disclosing on one tab only would make the ABSENCE of a line on the others read as
// "those are ZIP-local" — a new false signal in place of an old one.
ok(/TAB_SCOPE_SUB/.test(alerts), 'A-014 the per-tab subhead map exists');
for (const [tab, sentence] of [
  ['gov',      "'Government notices from across ' + countyLabel() + ' — not limited to this ZIP.'"],
  ['meetings', "'Public meetings from across ' + countyLabel() + ' — not limited to this ZIP.'"],
  ['news',     "'Local news from across ' + countyLabel() + ' — not limited to this ZIP.'"]
]) ok(alerts.includes(sentence), 'A-014 the ' + tab + ' tab keeps its county-scope sentence', sentence);
ok(/document\.getElementById\('alSub'\)/.test(alerts) && /TAB_SCOPE_SUB\[state\.tab\]/.test(alerts),
  'A-014 the subhead is rewritten per tab at render time, not left as the generic line');

// ---- A-014: never invent a county ----
ok(/return n \? n \+ ' County' : 'your county';/.test(alerts),
  'A-014 countyLabel() falls back to "your county" — a ZIP whose chain root is not a county is never given a made-up name');

// ---- A-014: two-section Local News, ordering NOT filtering ----
ok(/function newsSectionsHTML/.test(alerts), 'A-014 Local News keeps its own two-section renderer');
ok(/zip_targeted === true/.test(alerts), 'A-014 section 1 is evidence-backed on app_changes.zip_targeted');
ok(/'News naming ' \+ townLabel\(\)/.test(alerts), 'A-014 the named section heading states what the content IS');
ok(/'Other news from ' \+ countyLabel\(\)/.test(alerts), 'A-014 the other-county section is labelled and disclosed');
// The evidence split must stay an ORDERING. If either half stops rendering, the page has
// started hiding records that the materializer already put on it.
ok(/sectionHTML\('Local News', other, mode, scopeNote\('Local News'\)\)/.test(alerts),
  'A-014 with no ZIP-evidenced item the page still renders every other-county item (rung 2)');
ok(/if \(!other\.length\) return sectionHTML\('News naming ' \+ townLabel\(\), named, mode, ''\);/.test(alerts),
  'A-014 with only ZIP-evidenced items the named heading is kept (rung 3)');

// ---- A-014: the classifier set is intact ----
for (const fn of ['isMeetingMirror', 'isNewsItem', 'isGovNotice', 'meetingAsChange',
                  'dedupeMeetings', 'buildMeetingsPool'])
  ok(new RegExp('function ' + fn + '\\s*\\(').test(alerts), 'A-014 classifier ' + fn + ' is preserved');
ok(/gov: all\.filter\(isGovNotice\)/.test(alerts) && /news: news,/.test(alerts)
   && /meetings: buildMeetingsPool\(\)/.test(alerts),
  'A-014 the three pools are still built from the three classifiers');

// ---- A-014: the strip, the band and the quiet branch ----
ok(/id="alStrip"/.test(alerts) && /Your value outlook, next 12 mo/.test(alerts),
  'A-014 the Alerts strip keeps its value-outlook tile');
ok(/Need you soon — windows closing/.test(alerts) && /Needs you soon/.test(alerts),
  'A-014 the window-closing band is preserved');
ok(/Good to know · lower relevance to you/.test(alerts),
  'A-014 the quiet branch is preserved (quiet=true is vacuous in production today — that is a reason to keep the branch, not to delete it)');

// ---- A-015 (negative): Alerts is not a reporting surface ----
// reports.html owns Intelligence Reports; Alerts must not grow a second export path.
for (const bad of [/\bexport\b/i, /\bdownload\b/i, /\.csv\b/i, /\bcsv\b/i, /\bpdf\b/i, /\bxlsx\b/i, /\bprint\(/i])
  ok(!bad.test(alerts), 'A-015 alerts.html has no ' + bad.source + ' affordance',
    (alerts.match(bad) || [])[0]);

// ---- A-014 (negative): no per-item triage state ----
// Alerts ranks and discloses; it does not ask the reader to file things. state.dismissed
// exists in shell.js and is deliberately unwired — this pin is what keeps it that way
// from the Alerts side.
for (const bad of [/\bdismiss/i, /\bsnooze/i, /\bunread\b/i, /mark as read/i, /data-act="read"/i])
  ok(!bad.test(alerts), 'A-014 alerts.html has no ' + bad.source + ' triage control',
    (alerts.match(bad) || [])[0]);

console.log(fails ? '\nFAILED ' + fails : '\nAll alerts-consolidation checks passed');
process.exit(fails ? 1 : 0);
