// THE SIDE-BY-SIDE COMPARISON — structural pins (Development Activity build step 10 of docs/development-activity-build-steps-100526.md).
// Each pin defends an invariant a behavioural test cannot see, because breaking it changes no output today: the comparison is pure, it reads a
// CLOSED set of response keys, it holds no Type, lifecycle, stage, change or rights rule of its own (it reads the report view's), it ranks
// nothing, it writes the address in one place and never into an attribute, and the page that uses it adds no function, no endpoint and no
// write. Reads source text only. A pin that names a string it forbids reads the module with its COMMENTS STRIPPED (the header comment of
// lib/da-report-compare.js quotes what the code must not contain), and each such region carries a positive control.
// Run: node test/da-report-compare-structure.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
/** Code with // and block comments removed. A `//` after `:` or a quote is not a comment (URLs, strings). */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const MOD = 'lib/da-report-compare.js', PAGE = 'development-activity-reports.html';
const SRC = read(MOD), C = code(SRC);
const PAGE_SRC = read(PAGE);

// ---- 0. the stripper itself, and the module it reads --------------------------------------------------------------------------------
{
  ok(code("a // gone\nb /* gone */ c 'x://y' d") === "a \nb  c 'x://y' d", '0a (control) the comment stripper removes comments and keeps a URL inside a string');
  ok(SRC.length > 8000 && C.length > 6000 && C.length < SRC.length, '0b the module was read and its comments were stripped (' + SRC.length + ' -> ' + C.length + ' bytes)');
  ok(/WHAT IT NEVER DOES/.test(SRC) && !/WHAT IT NEVER DOES/.test(C), '0c (control) the header comment is gone from the code region, so a pin may name a forbidden word without tripping on the comment');
  ok(/^\(function \(root\) \{/m.test(C) && /\}\)\(typeof window !== 'undefined' \? window : globalThis\);\s*$/.test(C) && /HS\.daReportCompare = \{/.test(C), '0d it is one self-contained function that attaches HS.daReportCompare to window and nothing else');
}

// ---- 1. pure: no network, no storage, no location, no clock, no dynamic code -------------------------------------------------------------
{
  const IMPURE = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'location', 'history.pushState',
    'navigator', 'window.open', 'import(', 'require(', 'importScripts', '.rpc(', 'functions.invoke', 'hsClient', 'HS.data', 'HS.sb', 'eval(', 'new Function', 'insertAdjacentHTML', 'document.write', 'addEventListener', 'setTimeout', 'setInterval'];
  const hits = IMPURE.filter((t) => C.includes(t));
  ok(hits.length === 0, '1a the module makes no network call, reads no storage or location, listens to no event and runs no dynamic code', hits);
  ok(IMPURE.filter((t) => ('x' + IMPURE.join(' ') + 'y').includes(t)).length === IMPURE.length, '1a (control) the scan list matches itself, so an empty result is not a blind one');
  ok(!/\b(Date|Intl|Math\.random|performance)\b|toLocale/.test(C), '1b it reads no clock and no locale: the same input gives the same output anywhere');
  ok(!/\bimport\b|\bexport\b|\brequire\b/.test(C), '1c it imports nothing: it needs only `window`, and the report view when it is called');
  ok(!/\.sort\(|\.reverse\(|\.splice\(|Math\.(max|min)\b/.test(C) && /\.forEach\(/.test(C) && /\.map\(/.test(C), '1d it sorts, reverses and reorders nothing and takes no maximum or minimum (a comparison that sorts is a comparison that ranks), and it does map and iterate (control)');
  ok((C.match(/innerHTML/g) || []).length === 1 && /el\.innerHTML = b\.ok \? html\(entries\) : '';/.test(C), '1e the only markup write is mount() setting innerHTML to its own html() output, once (or to nothing)');
  ok(!/setAttribute|removeAttribute|classList|style\./.test(C), '1f it changes no attribute and no style on any element: it writes one block of markup');
  ok(!/url\(|@import/.test(C) && !/['"]https?:/.test(C), '1g the stylesheet and the markup fetch nothing, and no http URL is written into the module');
  ok(!/\bdata-|\bhref\b|\bsrc=|<a |<img|<script|<iframe|<form|<input|<button/.test(C), '1h the markup it writes has no data- attribute, no link, no image, no script, no frame, no form and no control: nothing in it can be clicked or sent');
}

// ---- 2. it reads a CLOSED set of response keys, and none of the internal ones -------------------------------------------------------------
{
  const snake = [...new Set([...C.matchAll(/\.([a-z]+_[a-z_]+)\b/g)].map((m) => m[1]))].sort();
  ok(JSON.stringify(snake) === JSON.stringify(['as_of', 'generated_at', 'radius_mi', 'recent_days']), '2a the snake_case keys it reads are exactly these four (a new one must be added here on purpose)', snake);
  ok(!/\breport\.(sections|projects|by_stage|by_lifecycle|what_changed_recently|recent_official_activity|homesignal_detected_changes|publisher_event|publisher_status|coverage|activity|stage|lifecycle|type|rights|source|registry)\b/.test(C)
    && (C.match(/\bresponse\b/g) || []).length === 1 && /V\.read\(e\.response\)/.test(C) && (C.match(/\bm\.report\./g) || []).length === 3,
    '2b it never reads the report\'s own lists, records, coverage or outcome: the response goes to the view\'s read() once, and the report is touched in three places only (its distance, its day and its window)');
  const INTERNAL = ['report_private_context', 'report_snapshot', 'private_context', 'snapshot', 'report_id', 'content_hash', 'storage_blockers', 'storable', 'source_family', 'rights', 'rule_version', 'identity_key', 'source_key', 'registry_id', 'feature_id', 'lat', 'lng', 'latitude', 'longitude', 'distance', 'bearing', 'render'];
  // the only two sentences that say "distance": the refusal for reports made over different distances, and the note that distances are not compared
  const noWords = C.replace(/radius: '[^']*',/, '').replace(/var DISTANCE_NOTE = '[^']*';/, '');
  ok(/same distance/.test(C) && /Distances are not compared/.test(C) && !/distance/.test(noWords), '2c0 (control) "distance" appears in two fixed sentences and nowhere else');
  const named = INTERNAL.filter((t) => new RegExp('\\b' + t + '\\b').test(noWords));
  ok(named.length === 0, '2c it names no internal key, no coordinate, no distance and no render: nothing private or measured from the property can reach it', named);
  ok(/typeof e\.number !== 'number'/.test(C) && /e\.address/.test(C) && /e\.label/.test(C) && /e\.generated_at/.test(C) && /e\.response/.test(C), '2d (control) it reads exactly the five fields an entry carries: number, address, label, generated_at and response');
}

// ---- 3. ONE CANONICAL PATH: it reads the report view's functions and holds no rule of its own -----------------------------------------------
{
  const NEEDED = ['V.read(', 'V.typeCounts(', 'V.outcomeText(', 'V.describe(', 'V.limitationsOf', 'V.changeReady(', 'V.TITLES', 'V.TYPE_ORDER', 'V.OUTCOMES', 'V.CHANGE_NOT_READY', 'V.DISCLOSURE', 'V.util.esc', 'V.util.day', 'V.util.NO_ADDRESS'];
  const missing = NEEDED.filter((t) => !C.includes(t));
  ok(missing.length === 0, '3a every count, label and sentence comes through the view (read, typeCounts, outcomeText, describe, limitationsOf, changeReady, its titles and wording)', missing);
  const AUTH = ['classifyProjectType', 'canonicalLifecycle', 'canonicalProjectType', 'lifecycleKey', 'LIFECYCLE_LABELS', 'TYPE_EXACT', 'isActiveUndecided', 'CATEGORY_REGISTRY', 'TYPE_FILTER_KEYS', 'projectType', 'HS.projectType'];
  ok(AUTH.every((t) => !C.includes(t)), '3b it does not call or copy the Type or lifecycle authority: it asks the view, which asks it', AUTH.filter((t) => C.includes(t)));
  ok(!/['"](approved|proposed|permitted|operating|decided|on file|built|active)['"]/i.test(C.replace(/\[\s*'permitted',\s*'approved',\s*'proposed'\s*\]/, '')) || /\['permitted', 'approved', 'proposed'\]/.test(C),
    '3c the only stage words it holds are the three keys it asks the view\'s lists for, in the plan\'s order');
  ok(!/'No data ingested'|'No development activity'|NO_DATA_INGESTED['"]?\s*[:=]\s*[^=]/.test(C.replace(/o\.key === 'NO_DEVELOPMENT_ACTIVITY'|o\.key === 'NO_DATA_INGESTED'|V\.OUTCOMES\.NO_DATA_INGESTED\.title/g, '')),
    '3d it never writes an outcome\'s wording itself: only the engine\'s own title, taken from the view, and only its code is compared');
  ok((C.match(/o\.key === 'NO_DEVELOPMENT_ACTIVITY'/g) || []).length === 1 && (C.match(/o\.key === 'NO_DATA_INGESTED'/g) || []).length === 1 && /var o = V\.outcomeText\(m\.report\), state;/.test(C),
    '3e the outcome is read in ONE place (build), from the view, and decides only what a count cell says');
  ok(/if \(m\.some\) state = 'records';/.test(C) && /else state = 'unstated';/.test(C), '3f a report with no records and no recognised outcome is "unstated": the comparison infers nothing');
  ok(!/\bTotal\b|\bsum\b|\breduce\(|\+= |\+\+|\bavg\b|average/.test(C.replace(/i\+\+/g, '').replace(/\+= 1/g, '')) , '3g it adds nothing up across reports or rows: no reduce, no running total');
}

// ---- 4. the address and the label are written in ONE place, as text -------------------------------------------------------------------------
{
  ok((C.match(/c\.address/g) || []).length === 1 && (C.match(/c\.label/g) || []).length === 2 && /function legend\(V, cols\)/.test(C), '4a the address is written once and the label once (and checked once), both inside legend()');
  const leg = (C.match(/function legend\(V, cols\) \{[\s\S]*?\n  \}/) || [''])[0];
  ok(leg.length > 200 && /c\.address/.test(leg) && /c\.label/.test(leg) && /V\.util\.esc\(c\.address \|\| V\.util\.NO_ADDRESS\)/.test(leg) && /V\.util\.esc\(c\.label\)/.test(leg), '4b they are written escaped, as the text of a span, and "Address unavailable" stands in for a purged address');
  ok(!/\bid=|class="[^"]*'\s*\+\s*(c\.|e\.)|title=|alt=|aria-label="'\s*\+\s*(c\.|e\.)/.test(C), '4c no entry field is ever concatenated into an id, a class, a title, an alt or an aria-label');
  ok(/th scope="col">Report ' \+ c\.number/.test(C) && !/th scope="col">' \+ V\.util\.esc\(c\.address/.test(C), '4d the column headings are "Report N" and never the address');
}

// ---- 5. THE PAGE: it adds no function, no endpoint and no write -------------------------------------------------------------------------------
{
  const PC = code(PAGE_SRC.slice(PAGE_SRC.indexOf('<script>', PAGE_SRC.indexOf('da-report-compare.js')))); // the page's own script, comments stripped
  ok(PC.length > 5000, '5a (control) the page\'s script was read (' + PC.length + ' bytes)');
  const fnUrls = [...PC.matchAll(/var ([A-Z_]+_FN) = SB_URL \+ '\/functions\/v1\/([a-z-]+)'/g)].map((m) => m[1] + '=' + m[2]);
  ok(fnUrls.join(',') === 'REPORT_FN=get-development-activity-report,TRIAL_FN=development-activity-trial,SHARE_FN=manage-shared-report,WATCH_FN=manage-property-watch,BILLING_FN=manage-billing', '5b the page calls exactly the four functions it called before comparing, plus (build step 11) the Billing function: comparing adds no function and no endpoint', fnUrls);
  const run = (PC.match(/async function runCompare\(\)\s*\{[\s\S]*?\n  \}\n/) || [''])[0];
  ok(run.length > 800 && /post\(REPORT_FN, \{ action: 'open', report_id: c\.report_id \}\)/.test(run), '5c comparing opens each chosen saved report with the report function\'s `open` action and a report id: the same call that reopens a saved report');
  ok((run.match(/post\(/g) || []).length === 1 && !/WATCH_FN|SHARE_FN|TRIAL_FN|idempotency_key|address:|label:|view:|newKey|attempt/.test(run.replace(/address: typeof body\.address/, '').replace(/label: typeof body\.client_label/, '')),
    '5d it makes no report, uses no free report and writes nothing: one call shape, no key, no address in a request, no other function');
  ok(/compareRows\.filter\(function\(r\)\{ return ids\.indexOf\(r\.report_id\) >= 0; \}\)/.test(run) && !/\.sort\(|\.reverse\(/.test(run), '5e the reports go to the comparison in the saved list\'s order, never the order they were ticked, and nothing is sorted');
  ok(/if \(!session \|\| !session\.user \|\| session\.user\.id !== forUser\) return;/.test(run) && /comparing = false;/.test(run), '5f an answer that arrives after the person signed out or changed is dropped, and the in-flight flag is cleared first');
  ok(/if \(r\.status === 401\) \{ session = null; openAuth\(\);/.test(run) && /body\.reopened !== true \|\| !V\.renderable\(body\)/.test(run), '5g a refused sign-in asks to sign in again, and an answer that is not a reopened, renderable report is not compared');
  const hide = (PC.match(/function hideCompare\(\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
  ok(hide.length > 150 && /compareRows = \[\]/.test(hide) && /\$\('compare'\)\.hidden = true/.test(hide) && /\$\('compare-list'\)\.textContent = ''/.test(hide) && /\$\('compare-result'\)\.textContent = ''/.test(hide), '5h hideCompare forgets the list and the comparison and hides the card');
  ok(/hidden>\s*<h2 id="compare-title"/.test(PAGE_SRC.replace(/\s+/g, ' ').replace(/ >/g, '>')) || /id="compare" aria-labelledby="compare-title" hidden>/.test(PAGE_SRC), '5i the card is hidden until there is a signed-in member with a saved-report list');
  const showSaved = (PC.match(/function showSaved\(on\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
  ok(/hideCompare\(\)/.test(showSaved), '5j leaving the saved list (sign-out, another person) clears the comparison with it, so one person\'s reports are never left for the next');
  ok(/paintCompare\(null\)/.test(PC) && /paintCompare\(offered\)/.test(PC), '5k a saved list that cannot be read says so on the card, and a read one fills it');
  ok((PC.match(/'share', 'watch', 'pdf', 'compare'/g) || []).length === 2, '5l the report\'s own "Compare property" button is live exactly where Share and Watch are: on a report that was saved');
  ok(/act === 'compare' && !\$\('compare'\)\.hidden\) chooseForCompare\(shareFor\)/.test(PC), '5m that button adds the report on screen to the choice and moves to the card; it compares nothing by itself');
  ok(/c\.disabled = !c\.checked && n >= max;/.test(PC) && /\$\('compare-go'\)\.disabled = comparing \|\| n < min \|\| n > max;/.test(PC), '5n at most five can be ticked and the button needs two to five');
  const printRule = /@media print\{[\s\S]*?\.card[^{]*\{display:none!important/.test(PAGE_SRC);
  ok(printRule && /<section class="card" id="compare"/.test(PAGE_SRC), '5o the comparison is inside a card, and cards are left off the printed page (printing the comparison is not part of this step)');
  ok(PAGE_SRC.indexOf('lib/da-report-view.js?v=') > 0 && PAGE_SRC.indexOf('lib/da-report-view.js?v=') < PAGE_SRC.indexOf('lib/da-report-compare.js?v='), '5p the page loads the report view first, then the comparison');
  ok(/<script src="lib\/da-report-compare\.js\?v=[0-9a-f]{8}"><\/script>/.test(PAGE_SRC), '5q the comparison is loaded with a content key (the cache-key test pins the value)');
}

// ---- 6. nothing server-side changed for this step, and nothing else loads the comparison ---------------------------------------------------------
{
  const SKIP = new Set(['node_modules', '.git', '.claude', 'dist']);
  const TEXT = /\.(html|js|mjs|ts|py|yml|yaml|json|md|toml|sql|txt|xml)$/;
  const hits = [];
  const walk = (d) => {
    for (const e of readdirSync(join(root, d))) {
      if (SKIP.has(e)) continue;
      const p = d === '.' ? e : d + '/' + e;
      const st = statSync(join(root, p));
      if (st.isDirectory()) walk(p);
      else if (TEXT.test(e) && st.size < 3e6 && /da-report-compare|daReportCompare/.test(read(p))) hits.push(p);
    }
  };
  walk('.');
  const ALLOWED = new Set([MOD, PAGE, 'test/da-report-compare.test.mjs', 'test/da-report-compare-structure.test.mjs', 'test/development-activity-reports.browser.test.mjs', 'test/da_report_compare_mutants.py',
    'test/lib-cache-keys.test.mjs', 'test/da-report-view-structure.test.mjs', 'docs/development-activity-compare-2026-10-03.md', 'docs/development-activity-build-steps-100526.md', '.github/workflows/da-report-mutants.yml']);
  const stray = hits.filter((f) => !ALLOWED.has(f));
  ok(hits.includes(MOD) && hits.includes(PAGE), '6a (control) the walk sees the module and its one page (' + hits.length + ' files name the comparison)');
  ok(stray.length === 0, '6b nothing names the comparison except its module, its one page, its tests, its record and the keys and workflows that watch it', stray);
  ok(!hits.some((f) => f.startsWith('supabase/') || /\.sql$/.test(f) || /\.toml$/.test(f)), '6c no edge function, no SQL and no function setting mentions it: this step changes nothing server-side');
  const loaders = readdirSync(root).filter((f) => f.endsWith('.html') && /da-report-compare/.test(read(f)));
  ok(loaders.join() === PAGE, '6d exactly one page loads the comparison: the agent\'s customer page', loaders);
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
