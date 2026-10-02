// THE PRIVATE REVIEW PAGE (development-activity-review.html) — source-level contract, build step 4 of
// docs/development-activity-build-steps-100526.md.
//
// The page is admin-only and CI has no allow-listed account, so a live check cannot reach it (scripts/lib/surface-banner.mjs lists it
// as unverified live, like gov-archive.html). What CAN be checked is the set of properties that must never regress silently:
//   1. it stays internal: noindex, robots-disallowed, out of the app shell, staged on purpose;
//   2. it holds no privileged key: the one key in it is the public anon key, and the function gets the signed-in user's own token;
//   3. it calls one function and decides nothing: no table, RPC or storage read; no radius; no Type, stage or rights rule;
//   4. it saves nothing: no browser storage, and no write anywhere;
//   5. sign-in never creates an account (the allowlist is by email, and only existing accounts can be on it);
//   7. (build step 5d) "Start a brokerage trial": the page asks the trial function to create a trial and shows the owner link it
//      returns, once; it builds no link itself, keeps it in no storage, clears it on sign-out, and its words match the function's checks.
// test/development-activity-review.browser.test.mjs drives the page itself; test/single-customer-generation-path.test.mjs (P4, P5)
// keeps it the ONLY shipped page that may call the report engine.
// Run: node test/development-activity-review.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const page = read('development-activity-review.html');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const code = scripts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');

// ---- 1. internal ------------------------------------------------------------------------------------------------------------------------
ok(/<meta name="robots" content="noindex, nofollow">/.test(page), '1a noindex, nofollow');
ok(/^Disallow: \/development-activity-review\.html$/m.test(read('robots.txt')), '1b disallowed in robots.txt');
ok(!/development-activity-review/.test(read('partials/shell.html')) && !/development-activity-review/.test(read('shell.js')), '1c not in the resident app shell or its navigation');
ok(/'development-activity-review\.html',/.test(read('scripts/stage_site.py')), '1d staged on purpose (named in the artifact contract, not shipped by accident)');
ok(!/development-activity-review/.test(read('sitemap.xml')) && !/development-activity-review/.test(read('scripts/gen_sitemap.py')), '1e not in the sitemap or its generator');

// ---- 2. keys -------------------------------------------------------------------------------------------------------------------------------
const jwts = [...page.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)].map((m) => JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')));
ok(jwts.length === 1 && jwts[0].role === 'anon' && jwts[0].ref === 'qwnnmljucajnexpxdgxr', '2a the one key on the page is the public anon key of this project', jwts.map((j) => j.role));
ok(!/service_role|SERVICE_ROLE|sb_secret_/.test(page), '2b no service-role or secret key');
ok(/'Authorization': 'Bearer ' \+ session\.access_token/.test(code), '2c the function is called with the signed-in user\'s own token (the anon key alone is refused by the function\'s gate)');
ok(/shouldCreateUser:\s*false/.test(code) && !/shouldCreateUser:\s*true/.test(code), '2d sign-in never creates an account');

// ---- 3. one function, no decisions -------------------------------------------------------------------------------------------------------
const urls = [...code.matchAll(/https:\/\/[^'"\s)]+/g)].map((m) => m[0]);
ok(JSON.stringify(urls) === JSON.stringify(['https://qwnnmljucajnexpxdgxr.supabase.co']) && /var FN = SB_URL \+ '\/functions\/v1\/get-development-activity-report';/.test(code)
   && /var TRIAL_FN = SB_URL \+ '\/functions\/v1\/development-activity-trial';/.test(code) && (code.match(/\/functions\/v1\//g) || []).length === 2,
  '3a the only endpoints it names are the report function and (build step 5d) the trial function, on this project', urls);
ok(!/\.from\(|\.rpc\(|\.storage\b|\.functions\.invoke\(/.test(code), '3b no table, RPC, storage or other function read: the report function is the only data path');
ok(/body: JSON\.stringify\(\{ address: address, view: view \}\)/.test(code) && !/radius/i.test(code), '3c it sends only the address and the view; it never sets a radius (a report is always 0.5 mile, ruling 7)');
ok(!/canonicalLifecycle|classifyProjectType|STAGE_EVIDENCE|presentationStage|report-rights|\.cleared\b|\.rights\b|\.stage\.key|\.lifecycle\.key/.test(code), '3d no lifecycle, Type, stage or rights rule on the page');
ok(/V\.mount\(\$\('report'\), body, opts\)/.test(code) && /<script src="lib\/da-report-view\.js\?v=[0-9a-f]{8}"><\/script>/.test(page), '3e the report is drawn by the shared view (lib/da-report-view.js), loaded with its content key');
const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(page)[1];
ok(/connect-src 'self' https:\/\/qwnnmljucajnexpxdgxr\.supabase\.co wss:\/\/qwnnmljucajnexpxdgxr\.supabase\.co;/.test(csp) && /script-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net;/.test(csp),
  '3f the page may connect only to itself and this Supabase project', csp);

// ---- 4. nothing saved ------------------------------------------------------------------------------------------------------------------------
ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code), '4a no browser storage: the address and the report live only in the open page');
ok(/stored: false|nothing is saved|nothing is stored/i.test(page), '4b the page says nothing is saved');

// ---- 5. plain words for every non-report answer ------------------------------------------------------------------------------------------------
for (const [what, re] of [['not an admin (403)', /httpStatus === 403/], ['sign-in needed (401)', /httpStatus === 401/], ['address not found', /ADDRESS_NOT_RESOLVED/],
  ['ZIP not covered', /OUTSIDE_COVERAGE/], ['records unavailable', /data_unavailable/], ['geocoder down', /geocoder_unavailable/]]) {
  ok(re.test(code), '5 the page has a plain-words answer for: ' + what);
}
ok(!/say\([^)]*(body\.error|body\.status|body\.detail)/.test(code), '5b no raw error code is ever printed to the operator');

// ---- 6. the credit line: the function's rule, put into words, and nothing decided here (founder ruling R5) ----------------------------------
const credit = (code.match(/function creditLine\(body\)\{[\s\S]*?\n  \}/) || [''])[0];
ok(credit.length > 100 && /var c = body && body\.credit;/.test(credit) && /if \(c\.uses_report === true\)/.test(credit) && (code.match(/uses_report/g) || []).length === 1,
  '6a whether a report would use a free report is read from the function\'s own answer (body.credit.uses_report), once');
ok(!/\.projects|\.activity|\.outcome|\.coverage|storable|storage_blockers/.test(credit) && /c\.reason === 'NO_DATA_INGESTED'/.test(credit), '6b the credit line looks at nothing else: no project count, outcome, coverage or storage decision is made on the page');
ok(/creditnote/.test(page) && /\$\('creditnote'\)\.hidden = !cl;/.test(code) && /\$\('creditnote'\)\.hidden = true;/.test(code), '6c it is cleared before each report and shown only when there is a line to show');

// ---- 7. a brokerage's trial (build step 5d): the function creates it; the page shows its answer once -----------------------------------------
const H = await import('../supabase/functions/development-activity-trial/handler.ts');
const create = (code.match(/async function createTrial\(\)\{[\s\S]*?\n  \}/) || [''])[0];
ok(create.length > 500 && /await fetch\(TRIAL_FN, \{/.test(create) && /'Authorization': 'Bearer ' \+ session\.access_token/.test(create) && (code.match(/fetch\(TRIAL_FN/g) || []).length === 1,
  '7a the trial function is called from one place, with the signed-in admin\'s own token');
ok(/var payload = \{ action: 'create', brokerage_name: name \};/.test(create) && /if \(seats !== null\) payload\.seat_limit = seats;/.test(create)
   && /if \(days !== null\) payload\.trial_days = days;/.test(create) && (create.match(/payload\.[a-z_]+ =/g) || []).length === 2,
  '7b it sends the action, the name, and the seat limit and length only when they were typed (blank means none)');
ok(/var link = body && typeof body\.invite_link === 'string' \? body\.invite_link : '';/.test(create) && /\$\('tlink'\)\.value = link;/.test(create)
   && !/'#invite='|development-activity-reports/.test(page),
  '7c the link shown is the function\'s own answer: the page builds no invite link and does not name the customer page');
const onSess = (code.match(/function onSession\(s\)\{[\s\S]*?\n  \}/) || [''])[0];
const iElse = onSess.indexOf('} else {'), iClear = onSess.indexOf("$('tresult').hidden = true; $('tlink').value = ''; $('tnote').textContent = '';");
ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code) && iElse > 0 && iClear > iElse,
  '7d the link is kept in no browser storage, and is cleared when the admin signs out');
const tm = (code.match(/function trialMessage\(httpStatus, body\)\{[\s\S]*?\n  \}/) || [''])[0];
ok(new RegExp('up to ' + H.NAME_MAX + ' characters').test(tm) && new RegExp('from 0 to ' + H.SEATS_MAX).test(tm) && new RegExp('from 1 to ' + H.DAYS_MAX).test(tm)
   && new RegExp('id="tname" maxlength="' + H.NAME_MAX + '"').test(page) && new RegExp('id="tseats" min="0" max="' + H.SEATS_MAX + '"').test(page)
   && new RegExp('id="tdays" min="1" max="' + H.DAYS_MAX + '"').test(page),
  '7e the page\'s words and its boxes\' limits match the function\'s own checks (the function decides; the page only says it)');
ok(/httpStatus === 401/.test(tm) && /httpStatus === 403/.test(tm) && /httpStatus === 422\) return 'The database refused to create this trial\. Nothing was created\.'/.test(tm)
   && /could not confirm whether the trial was created/.test(code) && /tsay\(trialMessage\(httpStatus, body\) \|\| UNKNOWN, true\)/.test(create) && /tsay\(UNKNOWN, true\);/.test(create),
  '7f a refusal says nothing was created; a lost or unknown answer says the trial may or may not exist (never that it failed)');
ok(/if \(creating\) return;/.test(create) && /creating = true; \$\('tgo'\)\.disabled = true;/.test(create), '7g a second press while a request is in flight does nothing');
ok(!/\b20\b/.test(create) && !/\b14\b/.test(create), '7h the page states no report count and no invite lifetime of its own (the database holds both)');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
