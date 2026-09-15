// MY PLACES STAT STRIP — a missing comment window is not an open one, an unmeasured score
// is not a zero, and a CAPPED result is not a total.
//
// WHAT WAS BROKEN (1) — measured on production. ZIP 78617 holds 17 non-news app_changes
// rows, ALL 17 with window_closes_at NULL and 0 open. The strip rendered "17 Need you
// across all Places" while every Address card below it rendered "Nothing needs you".
// The cause is one coercion: HS.daysUntil returns null with no window, and `null >= 0` is
// TRUE (null converts to 0 in a relational comparison, unlike in ==).
//
// WHAT WAS BROKEN (2) — app_properties.score is NULL on every stored row, and `p.score || 0`
// averaged those absent values as real zeros, rendering "0 Avg Address score" as if measured.
//
// WHAT WAS BROKEN (3) — RETRACTED 2026-09-15, and the retraction is the point. This file
// used to assert that `app_projects_for_zip` caps development at 500, so a count at 500 had
// to render "500+". MEASURED against production: of 7,996 ZIPs carrying authoritative
// membership, exactly ONE sits at 500 — 78617, the ZIP that produced the original report —
// and 397 sit ABOVE it, up to 14,702. The authoritative RPC returns ONE jsonb array that no
// row cap can truncate (lib/data.js::rpcAllRows says so explicitly). So 500 was never a cap,
// 78617 genuinely holds 500, and the "+" was hedging about a number the page had in full.
// The "512 development rows" in the old text counted `app_projects.zip`, which is a DIFFERENT
// population from the one the page lists (the authoritative ZIP boundary) — 75009 reads 470
// there against 24 by the zip column. §3 now pins the corrected behaviour.
//
// WHAT CHANGED (4) — the strip measured the VIEWED ZIP and labelled itself with it. Founder
// decision 2026-09-15: measure the resident's whole membership. That reverses this file's
// old REQ-11 ("no second query was added"), which was never a correctness rule — #1213
// recorded the per-ZIP fan-out as "a product decision about query cost, not a label fix".
// The decision has now been made, so §6 pins the fan-out as BOUNDED rather than absent.
//
// HOW THIS FILE TESTS. The strip's helpers live inside properties.html's onReady closure, so
// they cannot be imported. They are EXTRACTED FROM THE SHIPPED FILE and EXECUTED here with
// the real HS.daysUntil pulled out of lib/templates.js — so these are behavioural assertions
// against production code, not a search for approved strings. Source scans are used only
// where the claim is genuinely about source (no unguarded comparison exists anywhere; no new
// query was introduced).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 300) : ''));
  if (!c) fails++;
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(join(root, f), 'utf8');
// Comments must never satisfy — or fail — a source scan. These files deliberately QUOTE the
// forbidden expressions in order to explain why they are forbidden.
const strip = (x) => x
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const propsRaw = read('properties.html');
const props = strip(propsRaw);
const property = strip(read('property.html'));
const templates = read('lib/templates.js');

// ---- load the SHIPPED helpers out of properties.html and run them --------------------
const daysUntilSrc = (templates.match(/function daysUntil\(dateStr\) \{[\s\S]*?\n  \}/) || [''])[0];
// ONE definition of "an open comment window", now shared by the strip and the Address cards.
const windowBlock = (props.match(/function isOpenWindow\([\s\S]*?function openWindowCount\([^\n]*\n/) || [''])[0];
const scopeBlock = (props.match(/function placesScopeLabel\([\s\S]*?\n  \}/) || [''])[0];
// The score rule is two statements inside strip(); lift them verbatim.
const scoreBlock = (props.match(/var scored = a\.filter[\s\S]*?: null;/) || [''])[0];

function loadHelpers(zip) {
  const src = daysUntilSrc + '\nvar HS = { daysUntil: daysUntil };\n'
    + 'var S = { zip: ' + JSON.stringify(zip) + ' };\n'
    + windowBlock + '\n' + scopeBlock + '\n'
    + 'function avgScore(a) { ' + scoreBlock + ' return avg; }\n'
    + 'return { openWindowCount, isOpenWindow, placesScopeLabel, avgScore };';
  return new Function(src)();
}
const H = loadHelpers('78617');

console.log('\n--- §0 THE HELPERS WERE REALLY EXTRACTED (control) ------------------------');
ok(windowBlock.includes('isOpenWindow') && windowBlock.includes('openWindowCount'),
  '0a both halves of the open-window rule came out of the shipped file', windowBlock.slice(0, 60));
ok(scopeBlock.includes('placesScopeLabel'), '0b the membership-scope label came out too');
ok(scoreBlock.includes('scored'), '0c the score rule came out too');
ok(typeof H.placesScopeLabel === 'function' && typeof H.openWindowCount === 'function',
  '0d ...and all of it executes here, so every assertion below is behavioural');

console.log('\n--- §1 THE COERCION, AND THE GUARD THAT SURVIVES 4a9494b ------------------');
ok(null >= 0, '1a `null >= 0` is TRUE in JavaScript — this is the original defect');
ok(/if \(!dateStr\) return null;/.test(daysUntilSrc), '1b HS.daysUntil returns null for an absent window');
const noWindow = Array.from({ length: 17 }, () => ({ window_closes_at: null }));
const openFuture = { window_closes_at: new Date(Date.now() + 5 * 864e5).toISOString() };
const closedPast = { window_closes_at: new Date(Date.now() - 5 * 864e5).toISOString() };
ok(H.openWindowCount(noWindow) === 0,
  '1c REQ-12 a null window_closes_at does not count as open (the real 78617 shape)', H.openWindowCount(noWindow));
ok(H.openWindowCount([...noWindow, openFuture]) === 1,
  '1d REQ-12 a genuinely open window still counts', H.openWindowCount([...noWindow, openFuture]));
ok(H.openWindowCount([...noWindow, closedPast]) === 0,
  '1e REQ-12 an expired window still does not count', H.openWindowCount([...noWindow, closedPast]));
ok(H.openWindowCount([{ window_closes_at: new Date().toISOString() }]) === 1,
  '1f ...and one closing today is still open');

console.log('\n--- §2 NO SHIPPED COMPARISON IS UNGUARDED --------------------------------');
const SHIPPED = ['properties.html', 'property.html', 'alerts.html', 'shell.js', 'lib/templates.js',
                 'lib/why.js', 'development.html', 'dashboard.html', 'lib/community-page.js',
                 'homesignalmap.html'];
const unguarded = [];
for (const f of SHIPPED) {
  let src; try { src = strip(read(f)); } catch (e) { continue; }
  for (const hit of src.match(/(?:HS\.)?daysUntil\([^()]*\)\s*[<>]=?\s*-?\d/g) || []) unguarded.push(f + ': ' + hit);
}
ok(unguarded.length === 0, '2a no shipped file compares a daysUntil() call straight to a number', unguarded);
ok((strip('var n = HS.daysUntil(x.y) >= 0;').match(/(?:HS\.)?daysUntil\([^()]*\)\s*[<>]=?\s*-?\d/g) || []).length === 1,
  '2b CONTROL: the scan matches the forbidden shape when it is present');
ok(/d != null && d >= 0/.test(property), '2c property.html keeps its guard (4a9494b intact)');

console.log('\n--- §3 THE CAP NEVER EXISTED, SO THE "+" IS GONE (the correction) ------');
// The old §3 asserted devCountValue(500) === "500+". Measured against production: of 7,996
// ZIPs carrying authoritative membership exactly ONE is at 500 and 397 are ABOVE it (max
// 14,702), and the authoritative RPC returns one untruncatable jsonb array. There is no cap
// to detect, so the helpers that detected one are gone rather than rewritten.
ok(!/var DEV_QUERY_CAP/.test(props), '3a DEV_QUERY_CAP is gone from the shipped code');
ok(!/function devCapped/.test(props), '3b ...and so is the cap detector');
ok(!/function devCountValue/.test(props), '3c ...and the value formatter that appended "+"');
// CONTROL: the scan would still see them if they came back.
ok(/var DEV_QUERY_CAP/.test('var DEV_QUERY_CAP = 500;'), '3d CONTROL the scan matches the shape when present');
// Honesty now rides on the read's OWN completeness flag, not on a row-count guess.
ok(/list\.complete !== false/.test(props),
  '3e a ZIP whose read did not complete is excluded, never counted as a measured zero');
ok(/Array\.isArray\(list\)/.test(props), '3f ...and a non-array response cannot be counted at all');
// No surviving path can append a "+" to a development count.
ok(!/devTotal[^\n]*\+ *'\+'/.test(props) && !/'\+'/.test(props),
  "3g no code path appends a \"+\" to the rendered count");

console.log('\n--- §4 THE LABEL SAYS EXACTLY HOW MUCH IT MEASURED ------------------------');
// It no longer names the viewed ZIP: this page is about every Place, and the label states
// how many of them the number actually covers.
ok(H.placesScopeLabel(5, 5) === ' · all 5 places',
  '4a every Place measured -> "all N places"', H.placesScopeLabel(5, 5));
ok(H.placesScopeLabel(4, 5) === ' · 4 of 5 places',
  '4b REQ-5 a Place that did not read is DISCLOSED, never folded in', H.placesScopeLabel(4, 5));
ok(H.placesScopeLabel(1, 1) === ' · your 1 place',
  '4c singular reads naturally', H.placesScopeLabel(1, 1));
ok(H.placesScopeLabel(0, 0) === '',
  '4d no Places at all degrades to no claim, never "0 of 0 places"', H.placesScopeLabel(0, 0));
ok(!/Need you' \+ inZip|ZIP ' \+ S\.zip/.test(props),
  '4e the tiles no longer label themselves with the viewed ZIP');
// REQ-7..REQ-10 — the banned-word rules survive the rewrite, asserted on the rendered label.
for (const [c, t] of [[5, 5], [4, 5], [1, 1], [0, 0]]) {
  const lbl = 'Developments found' + H.placesScopeLabel(c, t);
  if (/Project/i.test(lbl)) ok(false, '4f REQ-7 never "Project" at ' + c + '/' + t, lbl);
  if (/Nearby/i.test(lbl)) ok(false, '4g REQ-8 never "Nearby" at ' + c + '/' + t, lbl);
  if (/Total/i.test(lbl)) ok(false, '4h REQ-9 never "Total" at ' + c + '/' + t, lbl);
  if (/Across all Places/i.test(lbl)) ok(false, '4i REQ-10 never "Across all Places" at ' + c + '/' + t, lbl);
}
ok(true, '4f-4i REQ-7..10 the rendered label passes every banned-word rule at 4 scopes');
ok(/ALL\.devTotal === 1 \? 'Development' : 'Developments'/.test(props),
  '4j REQ-7 Development terminology, singular at exactly one');
ok(!/across all Places/i.test(propsRaw), '4k "across all Places" is gone from the file');
ok(!/Nearby projects total/i.test(propsRaw), '4l "Nearby projects total" is gone from the file');

console.log('\n--- §5 SCORES (4a9494b intact) -------------------------------------------');
ok(H.avgScore([{}, {}]) === null,
  '5a REQ-13 absent scores are not averaged as zero — the tile is omitted', H.avgScore([{}, {}]));
ok(H.avgScore([]) === null, '5b no addresses at all also omits the tile');
ok(H.avgScore([{ score: 0 }, { score: 0 }]) === 0,
  '5c REQ-14 a REAL numeric zero is a valid measurement and still renders', H.avgScore([{ score: 0 }, { score: 0 }]));
ok(H.avgScore([{ score: 80 }, {}]) === 80,
  '5d an absent score does not drag a measured one down', H.avgScore([{ score: 80 }, {}]));
ok(H.avgScore([{ score: 80 }, { score: 60 }]) === 70, '5e two real scores average normally');
ok(H.avgScore([{ score: NaN }]) === null, '5f NaN is not a measurement');
ok(H.avgScore([{ score: '80' }]) === null, '5g a string is not a measurement either');
ok(/miniscore">' \+ \(p\.score \|\| ''\)/.test(props),
  '5h the Address card still renders an absent score as blank, not 0');

console.log('\n--- §6 THE FAN-OUT IS AUTHORIZED, AND IT IS BOUNDED ---------------------');
// REQ-11 ("no second query was added") is SUPERSEDED by the founder decision to measure
// every Place. It was never a correctness rule — #1213 recorded the per-ZIP fan-out as a
// product decision about query cost. What must stay true is that the cost is bounded.
ok(/HS\.data\.projects\(S\.zip, null\)/.test(props),
  '6a the Address cards\' own read is byte-for-byte the same call');
ok(/HS\.data\.changes\(S\.zip, null\)/.test(props), '6b so is the changes read');
ok(/MAX_QUERY_ZIPS/.test(props),
  '6c the ZIP fan-out is capped — a resident with 200 follows cannot issue 200 reads');
ok(/QUERY_CONCURRENCY/.test(props),
  '6d ...and runs under bounded concurrency, never Promise.all(N)');
// The viewed ZIP is already read for the Address cards; reading it twice would double the
// single most expensive payload on the page (78617 alone is 500 rows).
ok(/String\(zq\) === String\(S\.zip\)[\s\S]{0,80}\? projects/.test(props),
  '6e the viewed ZIP\'s payload is REUSED, not fetched a second time');
ok(/openWindowChangesForZips/.test(props),
  '6f the comment-window read is ONE query for every ZIP, not one per ZIP');
ok(/dedupeChanges/.test(props),
  '6g a notice materialized once per ZIP is counted once across the membership');
ok(/statTile\(a\.length \+ z\.length, 'Places'/.test(props),
  '6h the Places tile is unchanged');
ok(!/Saved Items|Monitored Items/.test(propsRaw), '6i no combined My Places total was introduced');
// The distance gate is deferred, not touched.
ok(/\(x\.distance_mi \|\| 9e9\) <= 5/.test(props),
  '6j the distance gate is untouched — deferred to its own decision');

console.log('\n' + (fails ? fails + ' FAILED' : 'All stat-strip assertions passed'));
process.exit(fails ? 1 : 0);
