// THE CLIENT'S PAGE (shared-report.html) - source-level contract, Development Activity build step 8. Offline.
//   1. reached only from a link an agent made: noindex, disallowed, staged on purpose, in no navigation, no sitemap, linked from no page;
//   2. one public key, one endpoint, one request, a POST whose body carries the token and nothing else;
//   3. the token: read from the URL fragment, removed from the address bar, kept for this tab only, never written into the page;
//   4. the content security policy lets the page reach this project's function and nothing else;
//   5. the report is drawn by the shared view with the agent's actions left out; the page sends and shows no label, no agent;
//   6. one message for every link that opens nothing; a failure is said in words and can be retried;
//   7. the PDF is the browser's print window, and the print stylesheet leaves only the report on the paper.
// test/shared-report-page.browser.test.mjs runs the same page in Chromium against the real view-shared-report handler.
// Run: node test/shared-report-page.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const PAGE = 'shared-report.html';
const page = read(PAGE);
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const code = scripts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
const fn = (name) => (code.match(new RegExp('(?:async )?function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}')) || [''])[0];

// ---- 1. reached only from a link an agent made ----------------------------------------------------------------------------------------------------------
ok(/<meta name="robots" content="noindex, nofollow">/.test(page), '1a noindex, nofollow');
ok(/^Disallow: \/shared-report\.html$/m.test(read('robots.txt')), '1b disallowed in robots.txt');
ok(!/shared-report/.test(read('partials/shell.html')) && !/shared-report/.test(read('shell.js')), '1c not in the resident app shell or its navigation');
ok(/'shared-report\.html',/.test(read('scripts/stage_site.py')), '1d staged on purpose (named in the artifact contract, not shipped by accident)');
ok(!/shared-report/.test(read('sitemap.xml')) && !/shared-report/.test(read('scripts/gen_sitemap.py')), '1e not in the sitemap or its generator');
{
  const linkers = [];
  const walk = (d) => {
    for (const e of readdirSync(join(root, d))) {
      if (['node_modules', '.git', 'docs', 'test', 'community'].includes(e)) continue;
      const p = d === '.' ? e : d + '/' + e;
      const st = statSync(join(root, p));
      if (st.isDirectory()) walk(p);
      else if (/\.(html|js|mjs)$/.test(e) && p !== PAGE && /shared-report\.html/.test(read(p))) linkers.push(p);
    }
  };
  walk('.');
  // The agent's own page is the one file that names it: it checks the SHAPE of the link the server handed back before showing it.
  // It never builds the link and never points an anchor or a navigation at the client page.
  const agent = read('development-activity-reports.html');
  ok(JSON.stringify(linkers) === JSON.stringify(['development-activity-reports.html']), '1f only the agent\'s own page names it, and no other public page or script does: a client reaches it only from a link an agent made (the link is built by the server, supabase/functions/_shared/share-reads.ts)', linkers);
  ok(!/href="[^"]*shared-report\.html/.test(agent) && !/(location|window\.open|\.href\s*=)[^;\n]*shared-report/.test(agent)
     && /var SHARE_LINK = \/\^https:\\\/\\\/homesignal\\\.net\\\/shared-report\\\.html#share=\[A-Za-z0-9_-\]\{43\}\$\/;/.test(agent),
    '1f2 the agent\'s page only VALIDATES the shape of the link the server returned: it builds no link and points no anchor or navigation at the client page');
}
ok(/<meta name="referrer" content="no-referrer">/.test(page), '1g it sends no referrer');
ok(/<title>HomeSignal — Development Activity report<\/title>/.test(page), '1h the title names no address (it would name the PDF file and sit in browser history)');

// ---- 2. one key, one endpoint, one request ---------------------------------------------------------------------------------------------------------------
const jwts = [...page.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)].map((m) => JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')));
ok(jwts.length === 1 && jwts[0].role === 'anon' && jwts[0].ref === 'qwnnmljucajnexpxdgxr', '2a the one key on the page is the public anon key of this project', jwts.map((j) => j.role));
ok(!/service_role|SERVICE_ROLE|sb_secret_/.test(page) && !/supabase-js|createClient|\.auth\b|getSession|\bsession\b/i.test(code), '2b no service-role key, no supabase client and no session: a client has no account');
const urls = [...new Set([...code.matchAll(/https:\/\/[^'"\s)]+/g)].map((m) => m[0]))];
ok(JSON.stringify(urls) === JSON.stringify(['https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/view-shared-report']), '2c the only address the page names is the view-shared-report function on this project', urls);
ok((code.match(/\bfetch\(/g) || []).length === 1 && /method: 'POST'/.test(code) && /body: JSON\.stringify\(\{ token: token \}\)/.test(code), '2d one request, a POST, whose body is the token and nothing else');
ok(/referrerPolicy: 'no-referrer'/.test(code) && /cache: 'no-store'/.test(code), '2e the request sends no referrer and is never cached');
ok(!/\?[^'"\s]*token|token=|\+ token/.test(code.replace(/\{ token: token \}/g, '')), '2f the token is never put into a URL or a query string');

// ---- 3. the token ------------------------------------------------------------------------------------------------------------------------------------------
ok(/var FRAGMENT = \/\^#share=\(\[A-Za-z0-9_-\]\{43\}\)\$\/;/.test(code) && /var TOKEN = \/\^\[A-Za-z0-9_-\]\{43\}\$\/;/.test(code), '3a the token is read from the URL FRAGMENT (which no server receives), and only a 43-character base64url one');
ok(/history\.replaceState\(null, '', location\.pathname \+ location\.search\)/.test(fn('readToken')) && fn('readToken').indexOf('stash(m[1])') < fn('readToken').indexOf('replaceState'), '3b it is removed from the address bar the moment it is read');
{
  const stores = [...code.matchAll(/\b(sessionStorage|localStorage)\b/g)].map((m) => m[1]);
  ok(stores.length > 0 && stores.every((s) => s === 'sessionStorage') && (code.match(/STASH/g) || []).length >= 3 && /var STASH = 'hs-da-share';/.test(code), '3c the token is kept for this tab only (sessionStorage, one key), so a reload works; localStorage is never used', stores);
}
ok(!/(textContent|innerHTML|\.value|setAttribute\([^)]*)\s*=?\s*[^;\n]*\btoken\b/.test(code.replace(/function notice[\s\S]*?\n  \}/, '').replace(/body: JSON\.stringify\(\{ token: token \}\)/, '')), '3d the token is never written into the page');
ok(!/document\.cookie|navigator\.sendBeacon|XMLHttpRequest|WebSocket|postMessage/.test(code), '3e the page uses no cookie and sends the token by no other route');

// ---- 4. the content security policy -------------------------------------------------------------------------------------------------------------------------
const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(page)[1];
ok(/default-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && /form-action 'none'/.test(csp), '4a default-src self, no objects, no base override, no form can post anywhere', csp);
ok(/connect-src 'self' https:\/\/qwnnmljucajnexpxdgxr\.supabase\.co(;|$)/.test(csp) && !/jsdelivr|unpkg|cdnjs|\*/.test(csp), '4b it may reach this project and nothing else, and loads no script from a CDN (there is no sign-in library here)', csp);
ok(!/<script[^>]+src="https?:/.test(page) && !/<link[^>]+href="https?:/.test(page), '4c nothing is loaded from another site');

// ---- 5. the view, and what the page shows ---------------------------------------------------------------------------------------------------------------------
const sh = fn('show');
ok(/<script src="lib\/project-type\.js\?v=[0-9a-f]{8}"><\/script>\s*<script src="lib\/da-report-view\.js\?v=[0-9a-f]{8}"><\/script>/.test(page), '5a the report is drawn by the shared view (lib/da-report-view.js), loaded with its content key after the Type authority');
{
  const mount = (sh.match(/V\.mount\(\$\('report'\), body, \{[\s\S]*?\n    \}\);/) || [''])[0];
  ok(mount.length > 100 && /subject: typeof body\.address === 'string' \? body\.address : ''/.test(mount) && /brokerage: typeof body\.brokerage === 'string' \? body\.brokerage : ''/.test(mount)
     && /hide: \['compare', 'watch', 'share', 'pdf'\]/.test(mount) && !/label|agent|live/.test(mount),
    '5b it hands the view the address and the brokerage\'s name, hides all four of the agent\'s report actions, and passes no label, no agent and nothing live');
}
ok(!/client_label|\.label\b|\.agent\b|share_id|\.header\b/.test(code), '5c the page reads no label, no agent, no header and no share id from the answer');
ok(!/canonicalLifecycle|classifyProjectType|STAGE_EVIDENCE|presentationStage|report-rights|\.cleared\b|\.rights\b|\.stage\.key|\.lifecycle\.key|creditDecision|uses_report/.test(code), '5d no lifecycle, Type, stage, rights or credit rule on the page');
ok(/res\.status === 200 && body && body\.status === 'OK'/.test(code) && /res\.status === 404\) \{ dead\(\); return; \}/.test(code), '5e the page acts on the answer\'s status only: 200 is a report, 404 is a link that opens nothing, anything else is "could not be loaded"');

// ---- 6. one message for a dead link -----------------------------------------------------------------------------------------------------------------------------
const dead = fn('dead'), unavailable = fn('unavailable'), missing = fn('missing');
ok(dead.length > 100 && /This link doesn[’']t open a report/.test(dead) && /withdrawn/.test(dead) && /expired/.test(dead) && /Ask the person who sent it to you for a new link/.test(dead) && !/body|error|status ===/.test(dead) && !/\], true\)/.test(dead),
  '6a a link that opens nothing gets one message that says it may be withdrawn OR expired and who to ask - and the function reads nothing from the answer, so it cannot say which');
ok((code.match(/\bdead\(\)/g) || []).length === 2, '6b and only one place calls it (a 404)');
ok(/Nothing is wrong with your link/.test(unavailable) && /canRetry|true\)/.test(unavailable) && /Try again in a minute/.test(unavailable) && /function notice\(title, lines, canRetry\)/.test(code) && /b\.textContent = 'Try again'/.test(code),
  '6c a failure says the link is not at fault and offers Try again');
ok(/Open the link you were sent/.test(missing) && /if \(!token\) \{ missing\(\); return; \}/.test(code), '6d a visit with no usable token in it asks for the link, and calls nothing');

// ---- 7. the PDF and the paper -------------------------------------------------------------------------------------------------------------------------------------
ok(/\$\('pdf'\)\.addEventListener\('click', function\(\)\{ window\.print\(\); \}\)/.test(code) && !/jspdf|html2canvas|toBlob|createObjectURL|pdf-lib/i.test(page), '7a Download PDF is the browser\'s own print window and nothing else');
ok(/@media print\{[\s\S]*?header\.top,#status,#private,\.notice,noscript\{display:none!important\}/.test(page), '7b the print stylesheet leaves the header, the status line, the privacy note and the notices off the paper');
ok(/id="pdf" hidden/.test(page) && /\$\('pdf'\)\.hidden = false/.test(sh), '7c the button appears only when there is a report to print');
ok(/<noscript>/.test(page) && /<html lang="en">/.test(page) && /name="viewport" content="width=device-width,initial-scale=1"/.test(page) && /id="status" role="status" aria-live="polite"/.test(page), '7d a page without JavaScript says so, the status line is announced, and the page scales to a phone');

// ---- 8. the buyer invitation (one aside, last on the page, one link to the public site) ------------------------------------------------------------------------
{
  const inv = (page.match(/<aside id="invite"[\s\S]*?<\/aside>/g) || []);
  ok(inv.length === 1, '8a exactly one invitation in the page', inv.length);
  const a = inv[0] || '';
  ok(/<h2>Follow quality-of-life intelligence for this property\.<\/h2>/.test(a) && /<p>HomeSignal helps you discover proposed development, construction, infrastructure projects, and other changes around the places you care about\.<\/p>/.test(a) && />Explore HomeSignal &rarr;<\/a>/.test(a), '8b the approved wording, whole');
  ok((a.match(/<a /g) || []).length === 1 && /<a href="https:\/\/homesignal\.net\/" rel="noopener">/.test(a), '8c one link, to the public home page on the production domain');
  ok(page.indexOf('id="private"') < page.indexOf('id="invite"') && page.indexOf('id="invite"') > page.indexOf('id="report"') && page.indexOf('</main>') > page.indexOf('id="invite"') && !/<(?:main|div|p)[^>]*id="[^"]*"[^>]*>[^<]*<\/(?:main)>\s*<main/.test(page), '8d it comes after the report, its id and the privacy note');
  ok(/id="invite" class="invite" hidden/.test(page) && /\$\('invite'\)\.hidden = false/.test(sh) && /\$\('invite'\)\.hidden = true/.test(fn('start')), '8e it shows only with a report and is hidden again when a link opens nothing');
  ok(!/(?:#private,|,#private)[^{]*\.invite|\.invite\{[^}]*display:none/.test(page), '8f the print stylesheet keeps it, so a saved PDF carries the clickable link');
  ok(!/<form|<input/.test(a), '8g it asks for nothing: no form, no sign-in');
}

// ---- audit fix 8 (2026-10-07): a stalled connection ends in the "could not load" message ------------------------------------------------
ok(/new AbortController\(\)/.test(code) && /signal: ctl \? ctl\.signal : undefined/.test(code) && /setTimeout\(function\(\)\{ ctl\.abort\(\); \}, 20000\)/.test(code) && (code.match(/clearTimeout\(timer\)/g) || []).length === 2,
  'T1 the report request is aborted after 20 seconds and the timer is cleared on both the failure and the answer');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
