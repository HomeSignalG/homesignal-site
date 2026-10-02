// THE DEVELOPMENT ACTIVITY REPORT VIEW — structural pins (Development Activity plan, Order I, step 1).
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
  ok(/innerHTML = html\(response, opts\)/.test(C) && (C.match(/innerHTML/g) || []).length === 1, '1e the only DOM write is mount() setting innerHTML to its own html() output, once');
  ok(!/url\(|@import/.test(C) && !/['"]https?:/.test(C), '1f the stylesheet and the markup fetch nothing, and no http URL is written into the module (only the pattern that validates one)');
}

// ---- 2. it reads a CLOSED set of response keys, and none of the internal ones -------------------------------------------------------------
{
  const snake = [...new Set([...C.matchAll(/\.([a-z]+_[a-z_]+)\b/g)].map((m) => m[1]))].sort();
  const EXPECT = ['as_of', 'by_lifecycle', 'detected_at', 'distances_mi', 'event_type', 'homesignal_detected_changes', 'project_id', 'publisher_event', 'publisher_status', 'radius_mi',
    'recent_days', 'recent_official_activity', 'what_changed_recently'];
  ok(JSON.stringify(snake) === JSON.stringify(EXPECT), '2a the snake_case response keys it reads are exactly these thirteen (a new one must be added here on purpose)', snake);
  const INTERNAL = ['report_private_context', 'report_snapshot', 'private_context', 'snapshot', 'report_id', 'content_hash', 'storage_blockers', 'storable', 'source_family', 'source_families_in_report',
    'registry_id', 'change_ready', 'homesignal_observation', 'observation_count', 'first_observed_at', 'last_observed_at', 'assessment_basis', 'coverage_state', 'INTERNAL_VIEW',
    'CONTAINS_UNCLEARED', 'HOLD', 'CLEARED', 'rights', 'matched_address', 'latitude', 'longitude', 'normalized_address', 'property_key', 'label_in_body', 'audit_ref', 'cleared_on'];
  const named = INTERNAL.filter((t) => new RegExp('(^|[^A-Za-z_])' + t + '($|[^A-Za-z_])').test(C));
  ok(named.length === 0, '2b the code names no private-context or snapshot symbol, and none of the internal keys the engine carries (storage_blockers, rights, registry ids, change_ready, hashes, report ids)', named);
  ok(INTERNAL.every((t) => new RegExp('(^|[^A-Za-z_])' + t + '($|[^A-Za-z_])').test(' ' + INTERNAL.join(' ') + ' ')), '2b (control) the matcher finds each of those names when it is present');
  ok(!/\.(stored|stage|source_key|record_kind|submitted_at|date_kind|type_raw|developer|size|investment|address|feature_id)\b/.test(C), '2c it reads none of the record fields it does not show (stage, developer, size, investment, address, dates, raw type, ids)');
  ok((C.match(/\.status\b/g) || []).length === 1 && /response\.status === 'OK'/.test(C), '2d it reads the response\'s own status once, to decide whether a report is there, and nothing else called status');
  ok((C.match(/publisher_status/g) || []).length === 1 && /var status = txt\(p\.publisher_status\);/.test(C) && /line\('Publisher status', status\)/.test(C), '2e the publisher\'s status word is read once, and only to be printed under its own label');
  ok(!/\.type\.key|typeKey/.test(C) && /p\.type\.label/.test(C) && /p\.lifecycle\.key/.test(C) && /p\.lifecycle\.label/.test(C), '2f it reads Type only as the engine\'s label and lifecycle only as the engine\'s key and label');
}

// ---- 3. no Type rule, no lifecycle rule, no change rule, no rights rule -----------------------------------------------------------------
{
  const AUTH = ['CATEGORY_REGISTRY', 'classifyProjectType', 'canonicalLifecycle', 'canonicalProjectType', 'lifecycleKey', 'LIFECYCLE_LABELS', 'LIFECYCLE_KEYS', 'statusKey', 'TYPE_EXACT', 'HS.projectType', 'isActiveUndecided', 'browsingBucket'];
  ok(AUTH.every((t) => !C.includes(t)), '3a the module does not call, import or copy the Type or lifecycle authority (lib/project-type.js)', AUTH.filter((t) => C.includes(t)));
  ok(!/['"](decided|on file|built|active)['"]/i.test(C), '3b no publisher status word is mapped to anything: the code carries no status vocabulary at all');
  ok(/var SHAPES = \{\s*approved:[\s\S]*proposed:[\s\S]*operating:[\s\S]*unknown:[\s\S]*\};/.test(C) && /['"](decided|on file|built|active)['"]/i.test("x 'Decided' y"),
    '3b (control) the only lifecycle words in the code are the four keys of the shape table, and the status-word scan can see a status word');
  ok(!/isChangeReady|selectDetectedChanges|materialEvents|RECENT_DAYS|EVENT_KINDS|recentPublisherEvent|dayOf|addDays|windowStart/.test(C) && !/(86400|24 \* 60|\b90\b|\b365\b)/.test(C),
    '3c the module owns no change rule and no window: it does not decide what changed or what is recent (and carries no day-count of its own)');
  ok(!/validateRights|report-rights|cleared\b|attribution\s*[:=]\s*['"]/.test(C) && !/rights/i.test(C), '3d it owns no rights rule: it cannot say whether a source may appear, and invents no attribution');
  ok(!/\b(rank|ranked|ranking|score|priority|sortBy|nearest|closest)\b/i.test(C), '3e it ranks nothing (the plan names no ranking, and Things to Review has no rule)');
  ok(!/Things to Review|Permitted \/ Under Construction|What Exists Today|Development Activity Map|Compare|\bWatch\b|\bShare\b|\bPDF\b|Download/.test(C), '3f it has no copy for the sections the plan lists but the engine cannot supply: Things to Review, Permitted / Under Construction, the map, the action bar');
  ok(!/\bno (recent |new |official )*(development )?activity|nothing (found|nearby|to report)|no development (was )?found/i.test(C), '3g it has no wording that claims there was no activity (plan hard rule 66)');
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
  ok(optReads.length > 0 && optReads.every((k) => k === 'subject'), '4g opts is read for the address only: there is no other caller-supplied input', optReads);
  ok(!/\bid="|setAttribute|dataset|data-(?!lifecycle)/.test(C), '4h the markup writes no id, no setAttribute and no data-* other than the whitelisted lifecycle key');
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
  ok(!C.includes('Permitted / Under Construction'), '5d the third landing label is NOT carried: R2 has no such lifecycle key and no source rule exists for it');
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
  const ALLOWED = new Set([MOD, 'test/da-report-view.test.mjs', 'test/da-report-view-structure.test.mjs', 'test/da-report-view.browser.test.mjs', 'test/da_report_view_mutants.py', 'test/lib/da-report-view-world.mjs',
    'docs/development-activity-report-view-2026-10-02.md', 'docs/development-activity-status-2026-09-30.md']);
  const stray = hits.filter((f) => !ALLOWED.has(f));
  ok(hits.includes(MOD) && hits.includes('test/da-report-view.test.mjs'), '6a (control) the walk sees the module and its own tests (' + hits.length + ' files name it)');
  ok(stray.length === 0, '6b NO page, lib, script, workflow or edge function names the view: it has no caller', stray);
  const pages = readdirSync(root).filter((f) => f.endsWith('.html')).concat(readdirSync(join(root, 'partials')).map((f) => 'partials/' + f));
  ok(pages.length > 10 && pages.every((p) => !/da-report-view/.test(read(p))) && !/da-report-view/.test(read('scripts/gen_zip_pages.py')) && !/da-report-view/.test(read('shell.js')),
    '6c no page, partial, the ZIP-page generator or shell.js loads it (' + pages.length + ' pages scanned), so it needs no ?v= cache key until one does');
  const keys = read('test/lib-cache-keys.test.mjs');
  ok(!/da-report-view/.test(keys), '6d it is not in lib-cache-keys CONTENT_KEYED, which requires a loading page (§1a): the first page that loads it adds it there in the same change');
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

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
