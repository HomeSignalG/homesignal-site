#!/usr/bin/env node
/**
 * ORDER H (first step), 2026-10-01 — no shipped page can generate a report outside the canonical gated path.
 *
 * Plan: docs/development-activity-plan-2026-09-30.md, Order H (lines 2398-2402), "One canonical generation
 * path" (lines 1976-1987), Hard Rule 24 (line 2548): one customer-facing commercial generation path, no
 * browser-direct quota bypass. Decision and receipt: docs/order-h-retire-legacy-generator-2026-10-01.md.
 *
 * WHAT THIS PINS
 *   The legacy NYC page (`future-surroundings-report.html`) builds a report entirely in the visitor's browser
 *   against data.cityofnewyork.us, so no HomeSignal server sees the request and no server-side quota can apply
 *   to it. It is retired FROM THE ARTIFACT (scripts/stage_site.py), not deleted (ruling R6). This suite keeps it,
 *   and any renamed copy of it, from coming back.
 *
 * HOW: it runs the REAL producer (`scripts/stage_site.py --out <tmp>`, the command pages.yml runs) and scans the
 * files the producer actually wrote, BY CONTENT. A check on file names would pass a renamed copy of the page; a
 * check on content does not.
 *
 *   P1  the instrument ran: the producer succeeded, the artifact holds many pages and files, the scan read them.
 *   P2  the legacy page is retired and not deleted: not staged; still in the repository with its libraries (R6);
 *       robots.txt still Disallows it; nothing staged names it except robots.txt.
 *   P3  no staged file loads or names the browser-direct engine, except the three legacy libraries themselves.
 *   P4  no staged file names get-future-surroundings-report or follow-development-report, and exactly ONE staged file names
 *       get-development-activity-report: the private review page (build step 4 of docs/development-activity-build-steps-100526.md).
 *       It is admitted only while it stays an operator tool, and P5 checks that on every run. It does not cover Map 1 address
 *       mode (get-address-report, verify_jwt=false), the audit's founder decision 2.
 *   P5  the one admitted page is internal: noindex, robots-disallowed, named by no other staged file, and the function it calls
 *       still refuses anyone who is not a signed-in admin (authorizeAdmin runs before anything the caller typed is read).
 *   P6  (build step 5c, 2026-10-02) the CUSTOMER page, development-activity-reports.html, is admitted for the report engine and
 *       the trial function (development-activity-trial). It is noindex, robots-disallowed, named by no other staged file until
 *       launch (build step 13), asks only for the customer view, and reads its invite token from the URL fragment only. Who may
 *       make a report is still the report function's gate (an admin, or a member of an active trial); being able to load the
 *       page grants nothing.
 *       (build step 5d, 2026-10-02) the review page is admitted for the trial function too, for one action: an admin creating a
 *       brokerage's trial. P5i/P5j keep that action admin-only in the function, and the page asking for nothing else.
 *
 * WHEN THE CUSTOMER SURFACE ARRIVES (Orders K, L, I): P4 is the pin that must then change, DELIBERATELY, in the
 * same change that puts the entitlement check in supabase/functions/_shared/admin-gate.ts. Until then the only
 * shipped page that may call get-development-activity-report is the admin review page, and none may call
 * follow-development-report or get-future-surroundings-report. (Changed deliberately for build step 4, 2026-10-02:
 * the function's gate is unchanged, so the page gives no one who is not an admin a way to make a report. Changed
 * deliberately again for build step 5c, 2026-10-02: the customer page is the entitlement-gated surface this paragraph
 * anticipated; the gate it relies on is authorizeReportCaller, in admin-gate.ts.)
 *
 * STATED LIMIT of P4: it finds the ordinary spelling of a slug. A page that builds the name by concatenation is
 * not caught. The authority for who may call a function is the gate in admin-gate.ts (the anon key is refused),
 * not this scan; this scan is the tripwire for the ordinary shape.
 *
 * Every pin carries a positive control (the same detector must match real text it is meant to find) so a regex
 * that stops matching fails the suite instead of reading as clean. The mutations are in
 * test/single_customer_generation_path_mutants.py (manual loop, measured on exit code).
 *
 * Run: node test/single-customer-generation-path.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = REPO;
const STAGER = path.join(REPO, 'scripts', 'stage_site.py');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && detail !== undefined ? '\n           detail: ' + JSON.stringify(detail).slice(0, 400) : ''));
  if (!c) fails++;
};
const readRepo = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const LEGACY_PAGE = 'future-surroundings-report.html';
// The three libraries the legacy page loads. They ship (the lib/ tree ships whole) and are not edited (R6).
// They are the ONLY staged files allowed to name the browser-direct engine, and each must still match the
// P3 patterns (the positive control).
const LEGACY_LIBS = ['lib/nyc-v1-report.js', 'lib/nyc-v1-soda.js', 'lib/fsr-scale.js'];

// P3 — the browser-direct engine, by content.
const ENGINE = [
  ['the City of New York open-data host', /data\.cityofnewyork\.us/i],
  ['the NYC V1 libraries by file name', /nyc-v1-(?:soda|report)/],
  ['the NYC V1 browser globals', /\bHSNycV1(?:Soda)?\b/]
];
// P4 — the three functions named by Order H (NOT get-address-report: Map 1 address mode is a consumer surface outside this pin).
const SLUGS = ['get-future-surroundings-report', 'get-development-activity-report', 'follow-development-report', 'development-activity-trial'];
const slugRe = (s) => new RegExp(s);

const TEXT = /\.(?:html|js|mjs|json|css|xml|txt|svg)$/i;

// ---- stage the real artifact ---------------------------------------------------------------------------------
const out = mkdtempSync(path.join(tmpdir(), 'order-h-artifact-'));
let producerError = null;
try {
  execFileSync('python3', [STAGER, '--src', SRC, '--out', out], { stdio: 'pipe' });
} catch (e) {
  // A producer that REFUSES must surface as a named failure, not as an exception that aborts the run before
  // any later check prints. A crash and a clean pass are both "no FAIL lines"; only one of them is evidence.
  producerError = (e.stderr?.toString() || e.message || '').trim().split('\n').pop();
}
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(path.relative(out, p).split(path.sep).join('/'));
  }
})(out);
files.sort();
const content = new Map();
for (const f of files) if (TEXT.test(f)) content.set(f, readFileSync(path.join(out, f), 'utf8'));
const pages = files.filter((f) => f.endsWith('.html'));
const listOnly = execFileSync('python3', [STAGER, '--src', SRC, '--list-only'], { encoding: 'utf8' })
  .split('\n').map((l) => l.trim()).filter(Boolean);
rmSync(out, { recursive: true, force: true });

console.log('ORDER H — one customer-facing generation path (the staged artifact, scanned by content)\n');

// ---- P1: the instrument ran -------------------------------------------------------------------------------------
ok(producerError === null, 'P1a the real producer ran and exited 0', producerError);
ok(pages.length >= 20, `P1b the artifact holds at least 20 pages, so a scan over it is not vacuous (${pages.length} pages)`, pages.length);
ok(files.length >= 40, `P1c the artifact holds at least 40 files (${files.length} files)`, files.length);
ok(pages.includes('development-activity.html') && pages.includes('index.html'),
  'P1d control: development-activity.html (the Enterprise landing page) and index.html are staged, so page membership is really being measured');
const empty = [...content].filter(([, body]) => body.length === 0).map(([f]) => f);
ok(content.size >= 40 && empty.length === 0,
  `P1e every text file was read with a non-zero size (${content.size} read, ${empty.length} empty)`, empty);
ok(JSON.stringify([...files].sort()) === JSON.stringify([...listOnly].sort()),
  'P1f the staged tree equals what --list-only reports, so the two ways of asking agree', { staged: files.length, listed: listOnly.length });

// ---- P2: retired, not deleted -----------------------------------------------------------------------------------
ok(!files.includes(LEGACY_PAGE), `P2a ${LEGACY_PAGE} is NOT in the staged artifact`);
ok(existsSync(path.join(REPO, LEGACY_PAGE)) && readRepo(LEGACY_PAGE).includes('HSNycV1Soda.loadReport'),
  'P2b R6: the page is still in the repository and is still the browser-direct generator (retired from serving, not deleted or edited)');
ok(LEGACY_LIBS.every((l) => existsSync(path.join(REPO, l))), 'P2c R6: the three legacy libraries are still in the repository');
const robots = content.get('robots.txt') || '';
ok(robots.includes('Disallow: /' + LEGACY_PAGE), 'P2d the staged robots.txt still Disallows the retired URL');
const naming = /future-surroundings-report/;
const namedBy = [...content].filter(([, body]) => naming.test(body)).map(([f]) => f).filter((f) => f !== 'robots.txt');
ok(namedBy.length === 0, 'P2e no staged file other than robots.txt names the retired page (so its 404 is not a resident-visible dead link)', namedBy);
ok(naming.test(readRepo(LEGACY_PAGE)) && naming.test(readRepo('robots.txt')),
  'P2f control: the same detector matches the page\'s own self-links and the robots.txt line, so the empty result above is a real absence');

// ---- P3: the browser-direct engine, by content -------------------------------------------------------------------
for (const [label, re] of ENGINE) {
  const hits = [...content].filter(([f, body]) => !LEGACY_LIBS.includes(f) && re.test(body)).map(([f]) => f);
  ok(hits.length === 0, `P3 no staged file outside the three legacy libraries names ${label}`, hits);
}
ok(LEGACY_LIBS.every((l) => content.has(l)), 'P3c control: all three legacy libraries are staged (the lib/ tree ships whole), so the exemption is real');
ok(LEGACY_LIBS.every((l) => ENGINE.some(([, re]) => re.test(content.get(l) || ''))),
  'P3d control: every exempt library matches at least one P3 pattern, so a regex that stopped matching would fail here and not read as clean');
ok(ENGINE.every(([, re]) => re.test(readRepo(LEGACY_PAGE))),
  'P3e control: all three P3 patterns match the legacy page itself, the thing a renamed copy would resemble');
const htmlWithHost = pages.filter((p) => ENGINE[0][1].test(content.get(p) || ''));
ok(htmlWithHost.length === 0, 'P3f no staged page carries the City host (its CSP connect-src or anywhere else)', htmlWithHost);

// ---- P4: who may call the report engine: the admin review page, and the customer page for invited trial members -----
// ALLOWED[slug] is the complete list of staged files that may name it. Build step 4 admitted the private review page for the report
// engine; P5 below keeps that page an operator tool. Build step 5c admits the customer page for the report engine and the trial
// function, and nothing else; P6 below keeps it reachable only by invite until launch (build step 13). Build step 5d admits the review
// page for the trial function, to create a trial; P5i/P5j below keep that an admin's act.
const REVIEW_PAGE = 'development-activity-review.html';
const CUSTOMER_PAGE = 'development-activity-reports.html';
const ALLOWED = {
  'get-future-surroundings-report': [],
  'get-development-activity-report': [CUSTOMER_PAGE, REVIEW_PAGE].sort(),
  'follow-development-report': [],
  'development-activity-trial': [CUSTOMER_PAGE, REVIEW_PAGE].sort(),
};
for (const s of SLUGS) {
  const hits = [...content].filter(([, body]) => slugRe(s).test(body)).map(([f]) => f).sort();
  ok(JSON.stringify(hits) === JSON.stringify(ALLOWED[s]),
    ALLOWED[s].length ? `P4 the only staged file naming ${s} is ${ALLOWED[s].join(', ')}` : `P4 no staged file names ${s}`, hits);
}
const cfg = readRepo('supabase/config.toml');
ok(SLUGS.every((s) => slugRe(s).test(cfg)),
  'P4d control: the same four patterns match supabase/config.toml, so the zeros above are not an empty search');

// ---- P5: the one admitted page stays an operator tool ---------------------------------------------------------------
const review = content.get(REVIEW_PAGE) || '';
ok(review.length > 0, 'P5a control: the review page is staged and was read, so the checks below are about the shipped file');
ok(/<meta name="robots" content="noindex, nofollow">/.test(review), 'P5b the review page is noindex, nofollow');
ok(new RegExp('^Disallow: /' + REVIEW_PAGE.replace('.', '\\.') + '$', 'm').test(robots), 'P5c the staged robots.txt Disallows the review page');
const linking = [...content].filter(([f, body]) => f !== REVIEW_PAGE && f !== 'robots.txt' && body.includes(REVIEW_PAGE)).map(([f]) => f);
ok(linking.length === 0, 'P5d no other staged file names the review page: no link, no navigation, no sitemap entry', linking);
ok(robots.includes(REVIEW_PAGE) && readRepo('scripts/stage_site.py').includes("'" + REVIEW_PAGE + "'"), 'P5e control: the same detector finds the page name where it really is (robots.txt and the stager\'s list), so the empty result above is a real absence');
const handler = readRepo('supabase/functions/get-development-activity-report/handler.ts');
const gate = readRepo('supabase/functions/_shared/admin-gate.ts');
// build step 5b: the report gate admits an admin or an ACTIVE trial member (public.evaluation_usage); everyone else is refused first
const iGate = handler.indexOf('await authorizeReportCaller(req, deps)'), iBody = handler.indexOf('await readBounded(req)');
ok(iGate > 0 && iBody > iGate, 'P5f the function still runs its gate before it reads anything the caller sent', { iGate, iBody });
ok(/if \(!who\.admin\) return reply\(req, \{ error: 'forbidden' \}, 403\)/.test(gate) && /if \(!token\) return reply\(req, \{ error: 'unauthorized' \}, 401\)/.test(gate)
   && /if \(!trial\) return reply\(req, \{ error: 'forbidden' \}, 403\)/.test(gate) && /if \(standing !== 'active' && standing !== 'complete'\) return reply\(req, \{ error: 'forbidden' \}, 403\)/.test(gate)
   && /if \(t\.status === 'active' && !t\.expired\) return 'active';/.test(gate),
  'P5g the gate still refuses a caller with no token (401), and a signed-in caller who is neither an admin nor a member of an active, unexpired trial (403)');
ok(!/service_role|SERVICE_ROLE/.test(review), 'P5h the review page carries no service-role key; it uses the public browser key and the signed-in user\'s own token');
// build step 5d: the review page asks the trial function for one thing, an admin creating a trial; the function refuses anyone else first
ok((review.match(/action: '[a-z]+'/g) || []).join() === "action: 'create'" && !/location\.hash/.test(review),
  'P5i the review page asks the trial function only to create a trial: it never joins one, reads one, or reads an invite from its own address');
const trialSrc = readRepo('supabase/functions/development-activity-trial/handler.ts');
const iCreate = trialSrc.indexOf("if (action === 'create') {"), iAdmin = trialSrc.indexOf("if (!who.admin) return reply(req, { error: 'forbidden' }, 403);", iCreate),
  iFields = trialSrc.indexOf('trialRequest(body', iCreate), iMake = trialSrc.indexOf('deps.createTrial(', iCreate);
ok(iCreate > 0 && iAdmin > iCreate && iFields > iAdmin && iMake > iFields && (trialSrc.match(/deps\.createTrial\(/g) || []).length === 1,
  'P5j in the trial function, creating a trial refuses anyone who is not an admin before a field is read, and is the only call that creates one', { iCreate, iAdmin, iFields, iMake });

// ---- P6: the customer page (build step 5c) is reached only by invite until launch, and asks only for the customer view ----------
const cust = content.get(CUSTOMER_PAGE) || '';
ok(cust.length > 0, 'P6a control: the customer page is staged and was read, so the checks below are about the shipped file');
ok(/<meta name="robots" content="noindex, nofollow">/.test(cust) && /<meta name="referrer" content="no-referrer">/.test(cust),
  'P6b the customer page is noindex, nofollow, and sends no referrer');
ok(new RegExp('^Disallow: /' + CUSTOMER_PAGE.replace('.', '\\.') + '$', 'm').test(robots), 'P6c the staged robots.txt Disallows the customer page');
const linkingCust = [...content].filter(([f, body]) => f !== CUSTOMER_PAGE && f !== 'robots.txt' && body.includes(CUSTOMER_PAGE)).map(([f]) => f);
// Founder, 2026-10-05: the header's Enterprise dropdown carries "My reports" so an agent can get back. That is the shell's one link.
ok(JSON.stringify(linkingCust) === JSON.stringify(['partials/shell.html']),
  'P6d the only staged file naming the customer page is the shell\'s "My reports" entry; the landing page links it at launch (build step 13)', linkingCust);
ok(robots.includes(CUSTOMER_PAGE) && readRepo('scripts/stage_site.py').includes("'" + CUSTOMER_PAGE + "'"), 'P6e control: the same detector finds the page name where it really is');
ok(!/service_role|SERVICE_ROLE/.test(cust) && /view: 'customer'/.test(cust) && !/'internal'/.test(cust),
  'P6f the customer page carries no service-role key and only ever asks for the customer view');
ok(/location\.hash/.test(cust) && !/searchParams|URLSearchParams/.test(cust) && (cust.match(/location\.search/g) || []).length === 1
   && /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/.test(cust),
  'P6g the invite token is read from the URL fragment only (never sent to a server) and removed from the address bar');
const trialHandler = readRepo('supabase/functions/development-activity-trial/handler.ts');
const tGate = trialHandler.indexOf('await authorizeSignedIn(req, deps)'), tBody = trialHandler.indexOf('await readBounded(req)');
ok(tGate > 0 && tBody > tGate && /if \(!who\.user\.id\) return reply\(req, \{ error: 'forbidden' \}, 403\);\n  return \{ userId: who\.user\.id, admin: who\.admin \};/.test(gate),
  'P6h the trial function runs its gate (a signed-in user with an id) before it reads anything the caller sent', { tGate, tBody });

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
