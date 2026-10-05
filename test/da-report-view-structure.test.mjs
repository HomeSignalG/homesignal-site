// THE DEVELOPMENT ACTIVITY REPORT VIEW — structural pins (Development Activity plan, Order I; the full layout is step 3 of
// docs/development-activity-build-steps-100526.md).
// Each pin defends an invariant a behavioural test cannot see, because breaking it changes no output today: the view is pure, it reads
// a CLOSED set of response keys, it holds no Type, lifecycle, change, rights or ranking rule, it names nothing private, and it has no
// caller. Reads source text only. A pin that names a string it forbids reads the module with its COMMENTS STRIPPED (the header
// comment of lib/da-report-view.js quotes what the code must not contain), and each such region carries a positive control.
// Run: node test/da-report-view-structure.test.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
/** Code with // and block comments removed. A `//` after `:` or a quote is not a comment (URLs, strings). */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const MOD = 'lib/da-report-view.js';
const SRC = read(MOD);
const C = code(SRC);

// ---- 0. the stripper itself, and the module it reads --------------------------------------------------------------------------------
{
  ok(code("a // gone\nb /* gone */ c 'x://y' d") === "a \nb  c 'x://y' d", '0a (control) the comment stripper removes comments and keeps a URL inside a string');
  ok(SRC.length > 10000 && C.length > 8000 && C.length < SRC.length, '0b the module was read and its comments were stripped (' + SRC.length + ' -> ' + C.length + ' bytes)');
  ok(/WHAT IT NEVER SHOWS/.test(SRC) && !/WHAT IT NEVER SHOWS/.test(C), '0c (control) the header comment is gone from the code region, so a pin may name a forbidden string without tripping on the comment');
  ok(/^\(function \(root\) \{/m.test(C) && /\}\)\(typeof window !== 'undefined' \? window : globalThis\);\s*$/.test(C) && /HS\.daReportView = \{/.test(C), '0d it is one self-contained function that attaches HS.daReportView to window, and nothing else');
}

// ---- 1. pure: no network, no storage, no location, no clock, no dynamic code -------------------------------------------------------------
{
  const IMPURE = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'location', 'history.pushState',
    'navigator', 'window.open', 'import(', 'require(', 'importScripts', '.rpc(', 'functions.invoke', 'hsClient', 'HS.data', 'HS.sb', 'eval(', 'new Function', 'insertAdjacentHTML', 'document.write'];
  const hits = IMPURE.filter((t) => C.includes(t));
  ok(hits.length === 0, '1a the module makes no network call, reads no storage or location, and runs no dynamic code', hits);
  ok(IMPURE.filter((t) => ('x' + IMPURE.join(' ') + 'y').includes(t)).length === IMPURE.length, '1a (control) the scan list matches itself, so an empty result is not a blind one');
  ok(!/\b(Date|Intl|Math\.random|performance)\b|toLocale/.test(C), '1b it reads no clock and no locale: the same input gives the same output anywhere');
  ok(!/\bimport\b|\bexport\b|\brequire\b/.test(C), '1c it imports nothing: it needs only `window`');
  ok(!/\.sort\(|\.reverse\(|\.splice\(/.test(C) && /\.filter\(/.test(C) && /\.map\(/.test(C), '1d it sorts and reorders nothing (a view that sorts is a view that ranks), and it does filter and map (control)');
  ok(/innerHTML = html\(response, opts\)/.test(C) && (C.match(/innerHTML/g) || []).length === 1, '1e the only markup write is mount() setting innerHTML to its own html() output, once');
  const enh = (C.match(/function enhance\(el\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  const attrWrites = [...C.matchAll(/(setAttribute|removeAttribute)\('([^']+)'/g)].map((m) => m[2]);
  ok(enh.length > 200 && attrWrites.length === 9 && attrWrites.every((a) => a === 'hidden' || a === 'aria-pressed') && [...C.matchAll(/setAttribute|removeAttribute/g)].length === 9
    && attrWrites.every((a, i) => enh.includes(a)), '1e2 the filters (enhance) change only two attributes, hidden and aria-pressed, and nothing else on the page', attrWrites);
  ok(!/url\(|@import/.test(C) && !/['"]https?:/.test(C), '1f the stylesheet and the markup fetch nothing, and no http URL is written into the module (only the pattern that validates one)');
}

// ---- 2. it reads a CLOSED set of response keys, and none of the internal ones -------------------------------------------------------------
{
  const snake = [...new Set([...C.matchAll(/\.([a-z]+_[a-z_]+)\b/g)].map((m) => m[1]))].sort();
  const EXPECT = ['as_of', 'bearings_deg', 'by_lifecycle', 'by_stage', 'change_ready', 'detected_at', 'distances_mi', 'event_type', 'first_observed_at', 'homesignal_detected_changes', 'homesignal_observation', 'project_id',
    'publisher_event', 'publisher_stage', 'publisher_status', 'radius_mi', 'recent_days', 'recent_official_activity', 'what_changed_recently'];
  ok(JSON.stringify(snake) === JSON.stringify(EXPECT), '2a the snake_case response keys it reads are exactly these nineteen (a new one must be added here on purpose)', snake);
  // The ledger's first observation is NOT printed as "First detected" (for a baseline read it is a refresh sweep's time before the ledger existed).
  // The per-record observation is read in ONE function, changeBasis, only to say WHEN the history behind a "no status change" sentence starts and how
  // many records it covers; the engine's coverage flag is read once, in changeReady; and noChangeMessage joins them.
  const basis = (C.match(/function changeBasis\(report\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  const ledger = (C.match(/function ledgerFirstRead\(p\) \{[^\n]*\}\n/) || [''])[0];
  const inFns = (re) => (basis.match(re) || []).length + (ledger.match(re) || []).length;
  ok(basis.length > 200 && ledger.length > 50 && !/firstDetected/.test(C) && (C.match(/homesignal_observation/g) || []).length === inFns(/homesignal_observation/g)
    && (C.match(/first_observed_at/g) || []).length === inFns(/first_observed_at/g) && /day\(o\.first_observed_at\)/.test(basis),
    '2a2 the ledger\'s first observation is read in two functions only: changeBasis() (the Change History sentence) and ledgerFirstRead() (the internal page\'s line); no "First detected" line reads it');
  ok((C.match(/ledgerFirstRead\(/g) || []).length === 3 && /\(showLifecycle && ledgerFirstRead\(p\) \? line\('Ledger first read', ledgerFirstRead\(p\)\) : ''\)/.test(C),
    '2a2b ledgerFirstRead() is called only behind showLifecycle (its definition plus one guarded line), so the customer view cannot print it');
  ok(/function changeReady\(report\) \{[\s\S]*?return cov\.change_ready === true;/.test(C) && (C.match(/cov\.change_ready/g) || []).length === 1
    && (basis.match(/\.change_ready/g) || []).length === 1 && (C.match(/change_ready/g) || []).length === 2
    && /var b = changeReady\(report\) \? changeBasis\(report\) : null;/.test(C) && /if \(!b\) return CHANGE_NOT_READY;/.test(C),
    '2a3 the ledger\'s readiness is read once per level (the engine\'s flag in changeReady, each record\'s in changeBasis), and noChangeMessage claims nothing unless both agree');
  const INTERNAL = ['report_private_context', 'report_snapshot', 'private_context', 'snapshot', 'report_id', 'content_hash', 'storage_blockers', 'storable', 'source_family', 'source_families_in_report',
    'registry_id', 'observation_count', 'last_observed_at', 'assessment_basis', 'coverage_state', 'INTERNAL_VIEW',
    'CONTAINS_UNCLEARED', 'HOLD', 'CLEARED', 'rights', 'matched_address', 'latitude', 'longitude', 'normalized_address', 'property_key', 'label_in_body', 'audit_ref', 'cleared_on'];
  const named = INTERNAL.filter((t) => new RegExp('(^|[^A-Za-z_])' + t + '($|[^A-Za-z_])').test(C));
  ok(named.length === 0, '2b the code names no private-context or snapshot symbol, and none of the internal keys the engine carries (storage_blockers, rights, registry ids, change_ready, hashes, report ids)', named);
  ok(INTERNAL.every((t) => new RegExp('(^|[^A-Za-z_])' + t + '($|[^A-Za-z_])').test(' ' + INTERNAL.join(' ') + ' ')), '2b (control) the matcher finds each of those names when it is present');
  ok(!/\.(stored|source_key|record_kind|submitted_at|date_kind|type_raw|developer|size|investment|address|feature_id)\b/.test(C), '2c it reads none of the record fields it does not show (developer, size, investment, address, dates, raw type, ids)');
  ok([...C.matchAll(/p\.stage\b/g)].length >= 3 && [...C.matchAll(/p\.stage\.(\w+)/g)].every((m) => ['key', 'label', 'evidence'].includes(m[1])), '2c2 it reads the engine\'s stage object only for its key, label and evidence');
  ok((C.match(/\.status\b/g) || []).length === 1 && /response\.status === 'OK'/.test(C), '2d it reads the response\'s own status once, to decide whether a report is there, and nothing else called status');
  ok((C.match(/publisher_status/g) || []).length === 2 && (C.match(/var status = txt\(p\.publisher_status\)/g) || []).length === 2 && (C.match(/line\('Official agency status', status\)/g) || []).length === 2,
    '2e the agency\'s status word is read in the two card builders, and only to be printed under its own label');
  ok((C.match(/\.type\.key/g) || []).length === 1 && /function typeKeyOf\(p\) \{ var k = isObj\(p\.type\) \? p\.type\.key : ''/.test(C) && [...C.matchAll(/typeKeyOf\(/g)].length === 5
    && /p\.type\.label/.test(C) && /p\.lifecycle\.key/.test(C) && /p\.lifecycle\.label/.test(C),
    '2f it reads Type as the engine\'s label, and its key in ONE function (typeKeyOf) used only to match a record to a Type filter (the card, the filter chip count, the map marker and the table row); lifecycle only as the engine\'s key and label');
}

// ---- 3. no Type rule, no lifecycle rule, no change rule, no rights rule -----------------------------------------------------------------
{
  const AUTH = ['classifyProjectType', 'canonicalLifecycle', 'canonicalProjectType', 'lifecycleKey', 'LIFECYCLE_LABELS', 'LIFECYCLE_KEYS', 'statusKey', 'TYPE_EXACT', 'isActiveUndecided', 'browsingBucket', 'TYPE_FILTER_KEYS'];
  ok(AUTH.every((t) => !C.includes(t)), '3a the module does not call or copy the Type or lifecycle authority (lib/project-type.js)', AUTH.filter((t) => C.includes(t)));
  // build step 10 moved the registry read out of filtersSection into typeLabelFor(), so the Type filter AND the side-by-side comparison
  // (through HS.daReportView.typeCounts) take a Type's label from ONE function. Still one place, still labels only.
  const regUses = [...C.matchAll(/CATEGORY_REGISTRY/g)].length, reg = (C.match(/function typeLabelFor\(k, seen\) \{[\s\S]*?\n  \}/) || [''])[0];
  ok(regUses === 2 && reg.length > 100 && (reg.match(/CATEGORY_REGISTRY/g) || []).length === 2 && /reg\[k\]\.isFacility \? txt\(reg\[k\]\.label\)/.test(reg) && !/classify|canonical/.test(reg),
    '3a2 the Type authority\'s registry is read in ONE place, typeLabelFor (the Type filter and the comparison both use it), for its labels only (and a regulated facility is never offered as a Type, ruling 1)');
  const filt = (C.match(/function filtersSection\(current, stageFor\) \{[\s\S]*?\n  \}/) || [''])[0];
  ok(filt.length > 300 && !/CATEGORY_REGISTRY/.test(filt) && /typeLabelFor\(k, seen\)/.test(filt), '3a3 (control) the Type filter reaches the registry only through typeLabelFor, so there is no second read to drift');
  ok(!/['"](decided|on file|built|active)['"]/i.test(C), '3b no publisher status word is mapped to anything: the code carries no status vocabulary at all');
  ok(/var SHAPES = \{\s*approved:[\s\S]*proposed:[\s\S]*operating:[\s\S]*unknown:[\s\S]*\};/.test(C) && /['"](decided|on file|built|active)['"]/i.test("x 'Decided' y"),
    '3b (control) the only lifecycle words in the code are the four keys of the shape table, and the status-word scan can see a status word');
  ok(!/isChangeReady|selectDetectedChanges|materialEvents|RECENT_DAYS|EVENT_KINDS|recentPublisherEvent|dayOf|addDays|windowStart/.test(C) && !/(86400|24 \* 60|\b90\b|\b365\b)/.test(C),
    '3c the module owns no change rule and no window: it does not decide what changed or what is recent (and carries no day-count of its own)');
  ok(!/validateRights|report-rights|cleared\b|attribution\s*[:=]\s*['"]/.test(C) && !/rights/i.test(C), '3d it owns no rights rule: it cannot say whether a source may appear, and invents no attribution');
  ok(!/\b(rank|ranked|ranking|score|priority|sortBy|closest)\b/i.test(C) && !/\.sort\(/.test(C) && /response\.render\.review/.test(C) && (C.match(/nearest/gi) || []).length === 1 && /m\.review\[0\]/.test(C), '3e it ranks nothing: Things to Review is the engine\'s own list (render.review), shown in the engine\'s order; the word "nearest" appears only to introduce that list\'s first record in the briefing (read from m.review[0], never sorted here)');
  ok(/Things to Review With Your Client/.test(C) && /Permitted \/ Under Construction/.test(C) && /Development Activity Map/.test(C) && /'Compare property', 'Watch property', 'Share report', 'Download PDF'/.test(C) && !/What Exists Today/.test(C),
    '3f the 100526 sections are written (Things to Review, Permitted / Under Construction, the map, the action bar) and What Exists Today is not (ruling 3)');
  ok((C.match(/aria-disabled="true"/g) || []).length === 1 && !/addEventListener\('click'[\s\S]{0,200}da-rv-act/.test(C), '3f2 the action bar\'s buttons are switched off, and nothing listens to them');
  // Founder ruling R5 (2026-10-02): "No development activity" is a real answer when the ENGINE can prove it. The view may write those words
  // exactly once, as the title it shows for the engine's own NO_DEVELOPMENT_ACTIVITY outcome; any other absence wording is still refused.
  const ABS = /\bno (recent |new |official )*(development )?activity|nothing (found|nearby|to report)|no development (was )?found/gi;
  const absHits = [...C.matchAll(ABS)].map((m) => m[0]);
  ok(absHits.length === 1 && /NO_DEVELOPMENT_ACTIVITY: \{\n\s*title: 'No development activity',/.test(C),
    '3g the only wording that says there was no activity is the title for the engine\'s own "No development activity" outcome (plan hard rule 66; ruling R5)', absHits);
  // build step 10 moved the read of the engine's outcome code into outcomeKeyOf(), so the report and the comparison read it from one function
  const okf = (C.match(/function outcomeKeyOf\(report\) \{[\s\S]*?\n  \}/) || [''])[0];
  ok((C.match(/report\.activity/g) || []).length === 2 && okf.length > 100 && (okf.match(/report\.activity/g) || []).length === 2
    && /return a && typeof a\.outcome === 'string' && has\(OUTCOMES, a\.outcome\) \? a\.outcome : '';/.test(okf)
    && (C.match(/outcomeKeyOf\(report\)/g) || []).length === 2 && /var o = outcomeText\(report\);\s*if \(!o \|\| report\.projects\.length !== 0\) return '';/.test(C) && !/a\.label|activity\.label|\.rule_version/.test(C),
    '3g2 the outcome is read in ONE function (outcomeKeyOf), from the engine\'s code only (never its label), and the report shows it only when it carries no projects');
  ok(!/projects\.length === 0 \?|NO_DATA_INGESTED['"]?\s*[:=]\s*report|outcome\s*=\s*['"]/.test(C), '3g3 the view never assigns an outcome itself');
  ok(!/\.coverage_state\b|\.stored\b|LIMITED_COVERAGE|REPORT_READY|CHANGE_READY/.test(C), '3h it never reads or prints the coverage state: the report speaks through the engine\'s limitation text');
}

// ---- 4. escaping, links, and the address ---------------------------------------------------------------------------------------------------
{
  const escBody = (C.match(/function esc\(v\) \{[\s\S]*?\n  \}/) || [''])[0];
  ok(['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'].every((e) => escBody.includes(e)) && /replace\(\/&\/g/.test(escBody), '4a esc() replaces all five of & < > " \'');
  ok((C.match(/href="/g) || []).length === 1 && /href="' \+ esc\(href\) \+ '"/.test(C) && /var href = safeHref\(s\.url\)/.test(C), '4b there is exactly ONE href in the module, written from esc(safeHref(source.url)) and from nothing else');
  ok(C.includes('var HTTP_URL = /^https?:\\/\\/[^\\s"\'<>`\\\\]+$/i;') && /function safeHref\(u\) \{[\s\S]*?HTTP_URL\.test\(s\)/.test(C), '4c the one URL validator accepts http and https only, with no whitespace, quote, angle bracket or backslash');
  ok((C.match(/target="_blank"/g) || []).length === 1 && (C.match(/rel="noopener noreferrer"/g) || []).length === 1, '4d every link that opens a new tab says noopener noreferrer (one link, one rel)');
  // the address
  const head = (C.match(/function header\(report, opts\) \{[\s\S]*?\n  \}/) || [''])[0];
  ok(head.startsWith('function header(report, opts) {') && /esc\(subject \|\| NO_ADDRESS\)/.test(head), '4e (control) the header region was sliced correctly and writes the address through esc()');
  const subjectUses = [...C.matchAll(/\bsubject\b/g)].length, inHeader = [...head.matchAll(/\bsubject\b/g)].length;
  ok(subjectUses > 0 && subjectUses === inHeader, '4f the caller\'s address is read in ONE function, header(), and nowhere else', { subjectUses, inHeader });
  const optReads = [...C.matchAll(/opts\.(\w+)/g)].map((m) => m[1]);
  // build step 8 adds two options, read in actionsBar() only: `live` (which of the four report actions are real buttons) and `hide` (which are left out)
  const bar = (C.match(/function actionsBar\(opts\) \{[\s\S]*?\n  \}/) || [''])[0];
  ok(optReads.length > 0 && optReads.every((k) => ['subject', 'label', 'brokerage', 'agent', 'live', 'hide', 'showLifecycle'].includes(k)) && ['label', 'brokerage', 'agent'].every((k) => head.includes('opts.' + k))
     && bar.startsWith('function actionsBar(opts) {') && (C.match(/opts\.live/g) || []).length === 1 && (C.match(/opts\.hide/g) || []).length === 1 && bar.includes('opts.live') && bar.includes('opts.hide')
     && !head.includes('opts.live') && !head.includes('opts.hide')
     && (C.match(/opts\.showLifecycle/g) || []).length === 1 && /opts\.showLifecycle === true/.test(C) && !head.includes('opts.showLifecycle') && !bar.includes('opts.showLifecycle'),
    '4g opts carries the address, the client label, the brokerage and the agent, read in header() only; and, from build step 8, the live and hidden report actions, read in actionsBar() only', optReads);
  const dataNames = [...new Set([...C.matchAll(/data-([a-z-]+)=/g)].map((m) => m[1]))].sort();
  ok(!/\bid="|dataset/.test(C) && JSON.stringify(dataNames) === JSON.stringify(['da-action', 'da-filter', 'da-stage', 'da-type', 'da-value', 'lifecycle', 'stage']),
    '4h the markup writes no id (two reports may share a page) and only these data-* names: the lifecycle, the stage, the filter keys and (build step 8) the action a live button stands for', dataNames);
  ok(/data-lifecycle="' \+ k \+ '"/.test(C) && /var k = lifeKey\(p\);/.test(C) && /has\(SHAPES, k\)/.test(C), '4i the one data-* value, and the one class suffix, come from a key that must be one of the four in the shape table');
}

// ---- 5. the words: stage labels equal the landing page's pinned labels ------------------------------------------------------------------------
{
  const landing = read('development-activity.html'), landingTest = read('test/development-activity-landing.test.mjs');
  const labels = [...landing.matchAll(/\{ key: '(approved|proposed|permitted)',\s+label: '([^']+)' \}/g)].map((m) => m[2]);
  ok(labels.join(' | ') === 'Approved / Coming | Proposed / Under Review | Permitted / Under Construction', '5a (control) the landing page\'s three stage labels were found', labels);
  ok(landingTest.includes("['Approved / Coming', 'Proposed / Under Review', 'Permitted / Under Construction'].every(") , '5b and the landing page test still pins exactly those three');
  ok(C.includes("approved: 'Approved / Coming'") && C.includes("proposed: 'Proposed / Under Review'") && labels[0] === 'Approved / Coming' && labels[1] === 'Proposed / Under Review',
    '5c the view\'s two stage labels equal the landing page\'s (so a label change must be made in both places on purpose)');
  ok(C.includes("permitted: 'Permitted / Under Construction'") && labels[2] === 'Permitted / Under Construction' && /var STAGES = \['approved', 'proposed', 'permitted'\];/.test(C),
    '5d the third landing label is carried as a Stage (a presentation of publisher evidence, decided by the engine), never as a lifecycle key (R2)');
  ok(C.includes("var EYEBROW = 'HOMESIGNAL DEVELOPMENT ACTIVITY';"), '5e the eyebrow is the ruled one (R6)');
  ok(/word-for-word|plan lines/.test(SRC) && /1763/.test(SRC), '5f the disclosure is attributed to its plan line in the module, and test/da-report-view.test.mjs 9a checks it against the plan');
}

// ---- 6. it has no caller, and nothing was changed to give it one -----------------------------------------------------------------------------
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
      else if (TEXT.test(e) && st.size < 3e6 && /da-report-view|daReportView/.test(read(p))) hits.push(p);
    }
  };
  walk('.');
  const REVIEW_PAGE = 'development-activity-review.html', CUSTOMER_PAGE = 'development-activity-reports.html', CLIENT_PAGE = 'shared-report.html';
  const ALLOWED = new Set([MOD, 'test/da-report-view.test.mjs', 'test/da-report-view-structure.test.mjs', 'test/da-report-view.browser.test.mjs', 'test/da_report_view_mutants.py', 'test/lib/da-report-view-world.mjs',
    'docs/development-activity-report-view-2026-10-02.md', 'docs/development-activity-status-2026-09-30.md', 'docs/development-activity-build-steps-100526.md',
    // build step 4: its one caller, the admin-only review page, and that page's tests; lib-cache-keys keys the file now a page loads it
    REVIEW_PAGE, 'test/development-activity-review.test.mjs', 'test/development-activity-review.browser.test.mjs', 'test/lib-cache-keys.test.mjs',
    // build step 5c: the customer page for invited trial members, and its tests
    CUSTOMER_PAGE, 'test/development-activity-reports.test.mjs', 'test/development-activity-reports.browser.test.mjs',
    // build step 8: the client's page for a private share link, its tests, and the structural test of the whole share unit
    CLIENT_PAGE, 'test/shared-report-page.test.mjs', 'test/shared-report-page.browser.test.mjs', 'test/report-share-delivery-structure.test.mjs',
    // build step 10: the side-by-side comparison READS the view's functions (read, typeCounts, outcomeText, describe...) so its counts are the report's own;
    // it is a module, not a page, and the customer page loads it beside the view. Its tests, its mutation harness and its record are listed with it.
    'lib/da-report-compare.js', 'test/da-report-compare.test.mjs', 'test/da-report-compare-structure.test.mjs',
    'test/da_report_compare_mutants.py', 'docs/development-activity-compare-2026-10-03.md']);
  const stray = hits.filter((f) => !ALLOWED.has(f));
  ok(hits.includes(MOD) && hits.includes('test/da-report-view.test.mjs'), '6a (control) the walk sees the module and its own tests (' + hits.length + ' files name it)');
  ok(stray.length === 0, '6b no page, lib, script, workflow or edge function names the view except its three callers (the private review page, build step 4; the customer page, 5c; the client\'s page for a share link, 8) and the side-by-side comparison module that reads its functions (build step 10)', stray);
  const pages = readdirSync(root).filter((f) => f.endsWith('.html')).concat(readdirSync(join(root, 'partials')).map((f) => 'partials/' + f));
  const loaders = pages.filter((p) => /da-report-view/.test(read(p)));
  ok(pages.length > 10 && loaders.sort().join() === [CLIENT_PAGE, CUSTOMER_PAGE, REVIEW_PAGE].sort().join() && !/da-report-view/.test(read('scripts/gen_zip_pages.py')) && !/da-report-view/.test(read('shell.js')),
    '6c exactly three pages load it, the private review page, the customer page and the client\'s share-link page; no other page, partial, the ZIP-page generator or shell.js (' + pages.length + ' pages scanned)', loaders);
  const keys = read('test/lib-cache-keys.test.mjs');
  ok(/'lib\/da-report-view\.js'\]/.test(keys) || /'lib\/da-report-view\.js',/.test(keys), '6d now that a page loads it, it is in lib-cache-keys CONTENT_KEYED, so its tag must carry its content hash (§1)');
  ok([REVIEW_PAGE, CUSTOMER_PAGE, CLIENT_PAGE].every((pg) => /<meta name="robots" content="noindex, nofollow">/.test(read(pg)) && new RegExp('^Disallow: /' + pg.replace('.', '\\.') + '$', 'm').test(read('robots.txt'))),
    '6d2 all three callers are noindex and disallowed in robots.txt (test/single-customer-generation-path.test.mjs P5 and P6 pin the rest)');
  const fnTree = [];
  const walkFn = (d) => { for (const e of readdirSync(join(root, d))) { const p = d + '/' + e; if (statSync(join(root, p)).isDirectory()) walkFn(p); else fnTree.push(p); } };
  walkFn('supabase/functions');
  ok(fnTree.length > 30 && fnTree.every((f) => !/da-report-view|daReportView/.test(read(f))), '6e the engine is untouched by it: nothing under supabase/functions names the view (' + fnTree.length + ' files)');
  ok(existsSync(join(root, 'docs/development-activity-report-view-2026-10-02.md')), '6f the design doc exists');
}

// ---- 7. how it is proven ------------------------------------------------------------------------------------------------------------------------
{
  const PLAYWRIGHT = /(?:from|import\(|require\()\s*['"]playwright['"]/;
  ok(!PLAYWRIGHT.test(read('test/da-report-view.test.mjs')) && !PLAYWRIGHT.test(read('test/da-report-view-structure.test.mjs')), '7a the behaviour and structural suites need no browser: they run in the required --offline CI job');
  ok(PLAYWRIGHT.test(read('test/da-report-view.browser.test.mjs')), '7b the browser suite imports playwright, so scripts/run-unit-tests.mjs runs it in the --browser job');
  ok(/get-development-activity-report\/handler\.ts/.test(read('test/lib/da-report-view-world.mjs')) && /H\.makeHandler\(deps\)/.test(read('test/lib/da-report-view-world.mjs')) && /M\.assemble\(/.test(read('test/da-report-view.test.mjs')),
    '7c the suites build their responses with the real handler (test/lib/da-report-view-world.mjs) and the behaviour suite checks them against the real assemble()');
  const mut = read('test/da_report_view_mutants.py');
  const names = [...mut.matchAll(/^m\('([a-z_0-9]+)'/gm)].map((m) => m[1]);
  ok(names.length >= 40, '7d the mutation harness carries its prohibited mutations (' + names.length + ')');
  ok(['swap_two_sections', 'change_hero_from_publisher_date', 'render_source_family', 'render_storage_blockers', 'render_hold', 'proposed_labelled_coming', 'lifecycle_text_dropped', 'escaping_removed',
    'javascript_url_accepted', 'distance_without_render', 'adds_a_fetch', 'address_in_href'].every((x) => names.includes(x)), '7e and every mutation the audit named is in it');
}

ok(/\.da-rv-table thead th\{overflow-wrap:normal;word-break:normal;hyphens:none;white-space:nowrap\}/.test(SRC), '5a a table column heading is never broken inside a word (the page-wide overflow-wrap:anywhere let a narrow print table squeeze "DISTANCE" into "DISTAN / CE" once a Direction column was added)');
console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
