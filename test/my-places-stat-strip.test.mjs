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
// WHAT WAS BROKEN (3) — app_projects_for_zip caps development results at 500 and
// lib/data.js::rpcAllRows reports `complete: true` for any array, so a truncated read is
// indistinguishable from a whole one. ZIP 78617 holds 512 development rows; the RPC returned
// 500; the tile presented 500 as the ZIP's set.
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
const capBlock = (props.match(/var DEV_QUERY_CAP[\s\S]*?\n  \}\n\n  function strip/) || [''])[0]
  .replace(/\n  function strip$/, '');
const windowBlock = (props.match(/function openWindowCount\([\s\S]*?\n  \}/) || [''])[0];
// The score rule is two statements inside strip(); lift them verbatim.
const scoreBlock = (props.match(/var scored = a\.filter[\s\S]*?: null;/) || [''])[0];

function loadHelpers(zip) {
  const src = daysUntilSrc + '\nvar HS = { daysUntil: daysUntil };\n'
    + 'var S = { zip: ' + JSON.stringify(zip) + ' };\n'
    + capBlock + '\n' + windowBlock + '\n'
    + 'function avgScore(a) { ' + scoreBlock + ' return avg; }\n'
    + 'return { DEV_QUERY_CAP, devCapped, devCountValue, devCountLabel, openWindowCount, avgScore };';
  return new Function(src)();
}
const H = loadHelpers('78617');
const HNoZip = loadHelpers(null);

console.log('\n--- §0 THE HELPERS WERE REALLY EXTRACTED (control) ------------------------');
ok(capBlock.includes('DEV_QUERY_CAP') && capBlock.includes('devCountLabel'),
  '0a the cap block came out of the shipped file', capBlock.slice(0, 60));
ok(windowBlock.includes('openWindowCount'), '0b the window helper came out too');
ok(scoreBlock.includes('scored'), '0c the score rule came out too');
ok(typeof H.devCountValue === 'function' && typeof H.openWindowCount === 'function',
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

console.log('\n--- §3 A CAPPED RESULT IS NOT A TOTAL (the correction) --------------------');
const list = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
const CAP = H.DEV_QUERY_CAP;
ok(CAP === 500, '3a the detected cap is the RPC\'s 500', CAP);
// REQ-1 / REQ-2 / REQ-3 — below the cap the exact returned count is provable, so it is shown.
ok(H.devCountValue(list(0)) === 0 && !String(H.devCountValue(list(0))).includes('+'),
  '3b REQ-1 zero renders a plain 0, never "0+"', H.devCountValue(list(0)));
ok(H.devCountValue(list(1)) === 1, '3c REQ-2 one renders a plain 1', H.devCountValue(list(1)));
ok(H.devCountValue(list(CAP - 1)) === CAP - 1,
  '3d REQ-3 immediately below the cap renders the exact count', H.devCountValue(list(CAP - 1)));
// REQ-4 — at the cap the total is unprovable, so the value says "at least".
ok(H.devCountValue(list(CAP)) === '500+',
  '3e REQ-4 at the cap the value is 500+', H.devCountValue(list(CAP)));
ok(H.devCapped(list(CAP)) === true && H.devCapped(list(CAP - 1)) === false,
  '3f cap detection flips exactly at the boundary and nowhere else');
// The "+" is derived from what came back, not from the constant — so a moved server cap
// still reports what was actually received rather than a stale 500.
ok(H.devCountValue(list(CAP + 12)) === '512+',
  '3g the + is derived from the RETURNED count, not hardcoded', H.devCountValue(list(CAP + 12)));

console.log('\n--- §4 THE LABEL SAYS ONLY WHAT IT MEASURED ------------------------------');
const L = (n) => H.devCountLabel(list(n));
ok(L(2) === 'Developments found · ZIP 78617', '4a REQ-6 the label names the viewed ZIP', L(2));
ok(L(1) === 'Development found · ZIP 78617', '4b singular at exactly one', L(1));
ok(L(0) === 'Developments found · ZIP 78617', '4c plural at zero', L(0));
ok(L(CAP) === 'Developments found · ZIP 78617',
  '4d REQ-5 the capped label makes no exact-total claim — it is the same honest label', L(CAP));
ok(HNoZip.devCountLabel(list(2)) === 'Developments found',
  '4e no viewed ZIP degrades gracefully, never "ZIP null"', HNoZip.devCountLabel(list(2)));
// REQ-7..REQ-10 — asserted on the RENDERED label across every count, not on file text.
for (const n of [0, 1, 2, CAP - 1, CAP, CAP + 1]) {
  const t = L(n);
  if (!/Development/.test(t)) ok(false, '4f REQ-7 Development terminology at n=' + n, t);
  if (/Project/i.test(t)) ok(false, '4g REQ-7 never "Project" at n=' + n, t);
  if (/Nearby/i.test(t)) ok(false, '4h REQ-8 never "Nearby" at n=' + n, t);
  if (/Total/i.test(t)) ok(false, '4i REQ-9 never "Total" at n=' + n, t);
  if (/Across all Places/i.test(t)) ok(false, '4j REQ-10 never "Across all Places" at n=' + n, t);
  if (/All Developments|Exactly 500|500 Developments in this ZIP/i.test(t))
    ok(false, '4k no banned completeness phrasing at n=' + n, t);
}
ok(true, '4f-4k REQ-7..10 the rendered label passes every banned-word rule at 6 counts');
// The old strings are gone from the file entirely, comments included.
ok(!/across all Places/i.test(propsRaw), '4l "across all Places" is gone from the file');
ok(!/Nearby projects total/i.test(propsRaw), '4m "Nearby projects total" is gone from the file');

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

console.log('\n--- §6 NOTHING ABOUT THE QUERY CHANGED (REQ-11) --------------------------');
ok(/HS\.data\.projects\(S\.zip, null\)/.test(props),
  '6a the projects read is byte-for-byte the same call');
ok(/HS\.data\.changes\(S\.zip, null\)/.test(props), '6b so is the changes read');
ok((props.match(/HS\.data\.projects\(/g) || []).length === 1,
  '6c exactly one projects call — no second/count query was added');
ok(!/rpcAllRows|\.rpc\(|\.limit\(|app_projects_for_zip/.test(props),
  '6d the page still issues no RPC, no limit and no direct table read of its own');
ok(/statTile\(a\.length \+ z\.length, 'Places'/.test(props),
  '6e the Places tile is unchanged and remains the only all-places count');
ok(!/Saved Items|Monitored Items/.test(propsRaw), '6f no combined My Places total was introduced');
// The distance gate is deferred, not touched.
ok(/\(x\.distance_mi \|\| 9e9\) <= 5/.test(props),
  '6g the distance gate is untouched — deferred to its own decision');

console.log('\n' + (fails ? fails + ' FAILED' : 'All stat-strip assertions passed'));
process.exit(fails ? 1 : 0);
