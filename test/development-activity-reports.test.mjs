// THE CUSTOMER PAGE (development-activity-reports.html) — source-level contract, build step 5c of
// docs/development-activity-build-steps-100526.md.
//
// The page is for invited trial members, and CI has no invited account, so a live check cannot reach it (scripts/lib/surface-banner.mjs
// lists it as unverified live). What CAN be checked is the set of properties that must never regress silently:
//   1. it is reached only by invite until launch: noindex, robots-disallowed, out of the app shell and the sitemap, staged on purpose;
//   2. it holds no privileged key; both functions get the signed-in person's own token; sign-in may create an account (an invited
//      person usually has none), which grants nothing by itself;
//   3. it calls two functions and decides nothing: the report function (customer view only, never a radius) and the trial function;
//   4. the invite token comes from the URL FRAGMENT only, is removed from the address bar, and is the only thing kept in the browser
//      (per tab, until it has been used); the address and the report are never stored;
//   5. a report request carries a key made once, reused only to retry the same address after a lost answer, so a retry can never use
//      a second free report; an admin's request carries none;
//   6. plain words for every answer, and the charge line is the report function's decision put into words;
//   7. build step 5e: the "Invite an agent" card is offered only to an OWNER of an ACTIVE trial, as the trial function named them; the
//      link is made by the trial function (never on the page), checked for the one invite-link form, shown in a read-only box with
//      the HomeSignal-written note, never stored, and forgotten on sign-out, on a change of person, and whenever the card hides.
// test/development-activity-reports.browser.test.mjs drives the page itself; test/single-customer-generation-path.test.mjs (P4, P6)
// keeps it one of exactly two shipped pages that may call the report engine.
// Run: node test/development-activity-reports.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const PAGE = 'development-activity-reports.html';
const page = read(PAGE);
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const code = scripts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
const fn = (name) => (code.match(new RegExp('(?:async )?function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}')) || [''])[0];

// ---- 1. reached only by invite until launch ------------------------------------------------------------------------------------------------
ok(/<meta name="robots" content="noindex, nofollow">/.test(page), '1a noindex, nofollow');
ok(/^Disallow: \/development-activity-reports\.html$/m.test(read('robots.txt')), '1b disallowed in robots.txt');
ok(!/development-activity-reports/.test(read('partials/shell.html')) && !/development-activity-reports/.test(read('shell.js')), '1c not in the resident app shell or its navigation');
ok(/'development-activity-reports\.html',/.test(read('scripts/stage_site.py')), '1d staged on purpose (named in the artifact contract, not shipped by accident)');
ok(!/development-activity-reports/.test(read('sitemap.xml')) && !/development-activity-reports/.test(read('scripts/gen_sitemap.py')), '1e not in the sitemap or its generator');
ok(!/development-activity-reports/.test(read('development-activity.html')), '1f the public landing page does not link it yet (its buttons go live at launch, build step 13)');
ok(/<meta name="referrer" content="no-referrer">/.test(page), '1g it sends no referrer');

// ---- 2. keys and sign-in ----------------------------------------------------------------------------------------------------------------------
const jwts = [...page.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)].map((m) => JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')));
ok(jwts.length === 1 && jwts[0].role === 'anon' && jwts[0].ref === 'qwnnmljucajnexpxdgxr', '2a the one key on the page is the public anon key of this project', jwts.map((j) => j.role));
ok(!/service_role|SERVICE_ROLE|sb_secret_/.test(page), '2b no service-role or secret key');
ok((code.match(/'Authorization': 'Bearer ' \+ session\.access_token/g) || []).length === 1 && /async function post\(url, payload\)/.test(code),
  '2c every call goes through one helper, with the signed-in person\'s own token (the anon key alone is refused by both functions)');
ok(/shouldCreateUser:\s*true/.test(code) && !/shouldCreateUser:\s*false/.test(code), '2d sign-in can create an account: an invited person usually has none, and an account alone grants nothing');

// ---- 3. two functions, no decisions -----------------------------------------------------------------------------------------------------------
const urls = [...new Set([...code.matchAll(/https:\/\/[^'"\s)]+/g)].map((m) => m[0]))];
ok(JSON.stringify(urls) === JSON.stringify(['https://qwnnmljucajnexpxdgxr.supabase.co'])
   && /var REPORT_FN = SB_URL \+ '\/functions\/v1\/get-development-activity-report';/.test(code) && /var TRIAL_FN = SB_URL \+ '\/functions\/v1\/development-activity-trial';/.test(code)
   && /var SHARE_FN = SB_URL \+ '\/functions\/v1\/manage-shared-report';/.test(code) && /var WATCH_FN = SB_URL \+ '\/functions\/v1\/manage-property-watch';/.test(code)
   && /var BILLING_FN = SB_URL \+ '\/functions\/v1\/manage-billing';/.test(code)
   && (code.match(/\/functions\/v1\//g) || []).length === 5,
  '3a the only endpoints it names are the report function, the trial function, (build step 8) the agent\'s share-link function, (build step 9) the agent\'s Watch function and (build step 11) the Billing function, all on this project', urls);
ok(!/\.from\(|\.rpc\(|\.storage\b|\.functions\.invoke\(/.test(code), '3b no table, RPC, storage or other function read');
ok(/var payload = \{ address: address, view: 'customer' \};/.test(code) && !/'internal'/.test(code) && !/radius/i.test(code),
  '3c a report asks for the customer view only, and never sets a radius (a report is always 0.5 mile, ruling 7)');
ok(!/canonicalLifecycle|classifyProjectType|STAGE_EVIDENCE|presentationStage|report-rights|\.cleared\b|\.rights\b|\.stage\.key|\.lifecycle\.key|creditDecision|uses_report/.test(code),
  '3d no lifecycle, Type, stage, rights or credit rule on the page');
ok(/V\.mount\(\$\('report'\), body, \{ subject: address, label: field\('label'\), brokerage: hd\.brokerage, agent: hd\.agent, live: shareable \? \['share', 'watch', 'pdf', 'compare'\] : \['pdf'\] \}\)/.test(code) && /<script src="lib\/da-report-view\.js\?v=[0-9a-f]{8}"><\/script>/.test(page),
  '3e the report is drawn by the shared view (lib/da-report-view.js), loaded with its content key');
const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(page)[1];
ok(/connect-src 'self' https:\/\/qwnnmljucajnexpxdgxr\.supabase\.co wss:\/\/qwnnmljucajnexpxdgxr\.supabase\.co;/.test(csp) && /script-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net;/.test(csp),
  '3f the page may connect only to itself and this Supabase project', csp);
const showTrial = fn('showTrial');
const canMake = fn('canMake');
ok(/\$\('go'\)\.disabled = busy \|\| !canMake\(\);/.test(showTrial) && /!canMake\(\)/.test(fn('run'))
   && /if \(access === 'admin'\) return true;/.test(canMake) && /if \(access !== 'trial' && access !== 'complete'\) return false;/.test(canMake)
   && /return isPaid\(\) \? plan\.credits_remaining > 0 : access === 'trial';/.test(canMake),
  '3g it offers "Make report" only to the callers the report function serves: an admin, a member with free reports left, or (build step 11) a member whose plan is paid with reports left this month, as the trial and Billing functions named them');

// ---- 4. the invite, and what the browser keeps ------------------------------------------------------------------------------------------------
const readInvite = fn('readInvite');
ok(/location\.hash/.test(readInvite) && (code.match(/location\.search/g) || []).length === 1 && !/searchParams/.test(code),
  '4a the invite is read from the URL fragment, which the browser never sends to a server; never from the query string');
ok(/history\.replaceState\(null, '', location\.pathname \+ location\.search\)/.test(readInvite), '4b and removed from the address bar as soon as it is read');
ok(/var INVITE = \/\^hse1_\[0-9a-f\]\{64\}\$\/;/.test(code) && /INVITE\.test\(fromHash\)/.test(readInvite) && /INVITE\.test\(kept\)/.test(readInvite),
  '4c only a well-formed invite token is kept or sent');
ok(!/localStorage|indexedDB|document\.cookie/.test(code) && (code.match(/sessionStorage\./g) || []).length === 3 && /var STASH = 'hs-da-invite';/.test(code),
  '4d the only browser storage is the per-tab invite slot (set, cleared, read back once): no address, no report, nothing that outlives the tab');
const loadTrial = fn('loadTrial');
ok(/if \(r\.status === 0 \|\| r\.status >= 500\) \{ trialUnreadable\(\); return; \}/.test(loadTrial) && /invite = null; store\(null\);/.test(loadTrial)
   && loadTrial.indexOf('invite = null; store(null);') > loadTrial.indexOf('r.status >= 500'),
  '4e the invite is forgotten once the trial function has answered it, and kept only when no answer came (so a reload can try again)');

// ---- 5. a report request's key ------------------------------------------------------------------------------------------------------------
const run = fn('run');
ok(/if \(!attempt \|\| attempt\.address !== address\) attempt = \{ key: newKey\(\), address: address \};/.test(run)
   && /if \(access !== 'admin'\) payload\.idempotency_key = attempt\.key;/.test(run),
  '5a a member report (a free one or one of the paid month\'s) carries a key made once per address; an admin report carries none (the report function refuses one)');
ok(run.indexOf("if (r.status === 0)") > 0 && run.indexOf('attempt = null;') > run.indexOf("if (r.status === 0)"),
  '5b the key is dropped only once the server has answered: after a lost answer, the same address is retried with the same key');
ok(/b\[6\] = \(b\[6\] & 0x0f\) \| 0x40; b\[8\] = \(b\[8\] & 0x3f\) \| 0x80;/.test(fn('newKey')) && /crypto\.randomUUID/.test(fn('newKey')),
  '5c the key is a random version-4 UUID (the shape the report function accepts), never derived from the address');

// ---- 6. plain words -------------------------------------------------------------------------------------------------------------------------
const msg = fn('messageFor');
for (const [what, re] of [['sign-in needed (401)', /httpStatus === 401/], ['trial used up', /evaluation_complete/], ['not entitled (403)', /httpStatus === 403\)/],
  ['address not found', /ADDRESS_NOT_RESOLVED/], ['ZIP not covered', /OUTSIDE_COVERAGE/], ['records unavailable', /data_unavailable/], ['geocoder down', /geocoder_unavailable/]]) {
  ok(re.test(msg), '6 the page has a plain-words answer for: ' + what);
}
ok(!/say\([^)]*(body\.error|body\.status|body\.detail)/.test(code), '6b no raw error code is ever printed');
const charge = fn('chargeLine');
ok(/body\.replayed === true/.test(charge) && /body\.charged === true/.test(charge) && /c\.reason === 'NO_DATA_INGESTED'/.test(charge) && !/uses_report/.test(charge),
  '6c the charge line puts the report function\'s answer (charged, replayed, the credit reason) into words and decides nothing');
ok(/does not use one/.test(showTrial) && /No data ingested/.test(showTrial), '6d the trial panel says that a "No data ingested" report does not use a free report (founder ruling R5)');

// ---- 7. an owner invites an agent (build step 5e) ---------------------------------------------------------------------------------------------
ok(/<section class="card" id="team" aria-labelledby="team-title" hidden>/.test(page) && /<input type="text" id="invite-link" readonly>/.test(page),
  '7a the invite card is hidden until the trial function names an owner, and the link sits in a read-only box');
ok(/showTeam\(a === 'trial' && role === 'owner'\);/.test(showTrial) && (code.match(/showTeam\(true\)/g) || []).length === 0,
  '7b the card shows only for an OWNER of an ACTIVE trial (access "trial"), as the trial function named them; nothing else turns it on');
ok((code.match(/role = (?:r|s|st)\.body\.role;/g) || []).length === 3 && !/role = '(?:owner|agent)'/.test(code) && !/role = body/.test(code),
  '7c the page takes the role only from the trial function\'s status or join answer, never sets it itself');
const mint = fn('mintInvite');
ok(/await post\(TRIAL_FN, \{ action: 'invite' \}\)/.test(mint) && (code.match(/action: 'invite'/g) || []).length === 1,
  '7d the link is made by the trial function, through the one helper, with nothing but the action (the server knows who is asking)');
ok(/\/\^https:\\\/\\\/homesignal\\\.net\\\/development-activity-reports\\\.html#invite=hse1_\[0-9a-f\]\{64\}\$\/\.test\(link\)/.test(mint),
  '7e only a link of the one invite-link form is shown (the customer page with the token in its fragment)');
ok(/\$\('invite-link'\)\.value = link;/.test(mint) && !/innerHTML|insertAdjacentHTML|outerHTML/.test(code),
  '7f the link is set as a value and every message as text: nothing from an answer is parsed as HTML');
const team = fn('showTeam');
ok(/if \(!on\) \{ \$\('minted'\)\.hidden = true; \$\('invite-link'\)\.value = '';/.test(team) && /\$\('team'\)\.hidden = !on;/.test(team),
  '7g hiding the card also forgets the link it showed');
const onSess = fn('onSession');
ok(/access = null; role = null; attempt = null; showTeam\(false\);/.test(onSess) && /role = null; showTeam\(false\); showSaved\(false\);[^\n]*\n[^\n]*\n\s*loadTrial\(\)/.test(onSess)
   && /access = null; role = null; showTeam\(false\);/.test(fn('trialUnreadable')),
  '7h signing out, a different person signing in, and an unreadable trial each forget the role and the link');
ok(/var forUser = session\.user \? session\.user\.id : null;/.test(mint) && /if \(!session \|\| !session\.user \|\| session\.user\.id !== forUser\) \{ showTeam\(false\); return; \}/.test(mint)
   && mint.indexOf('session.user.id !== forUser') < mint.indexOf("$('invite-link').value = link;"),
  '7i a link that arrives after its person signed out, or after someone else signed in, is never shown');
const im = fn('inviteMessage');
for (const [what, re] of [['sign-in needed (401)', /httpStatus === 401/], ['not an owner', /not_owner/], ['no trial (403)', /httpStatus === 403\)/],
  ['trial not active (409)', /httpStatus === 409/], ['no answer or a server fault', /httpStatus === 0 \|\| httpStatus >= 500/]]) {
  ok(re.test(im), '7j the invite card has a plain-words answer for: ' + what);
}
ok(!/teamSay\([^)]*(body\.error|body\.status|body\.detail)/.test(code), '7k no raw error code is ever printed on the invite card');
ok(/shown only this once|only this once/.test(mint) && /one agent/.test(mint) && /limit on agents/.test(mint),
  '7l the note says the link is for one agent, may be stopped by a full seat limit, and is shown only once');

// 8. build step 6: saved reports
const rs = fn('refreshSaved'), os = fn('openSaved');
ok(rs.length > 200 && os.length > 200, '8a refreshSaved and openSaved are found (positive control)', [rs.length, os.length]);
ok(/var forUser = session\.user\.id;/.test(rs) && rs.indexOf('session.user.id !== forUser') > rs.indexOf("post(REPORT_FN, { action: 'list' })") && rs.indexOf('session.user.id !== forUser') < rs.indexOf("$('saved-list')"),
  '8b a list that arrives after its person signed out, or after someone else signed in, is never shown');
ok(/if \(opening \|\| busy \|\| !session \|\| !session\.user\) return;/.test(os), '8c a saved report is not opened while one is being opened or a new report is being made');
ok(os.indexOf('session.user.id !== forUser') > os.indexOf("post(REPORT_FN, { action: 'open'") && os.indexOf('session.user.id !== forUser') < os.indexOf('V.mount'),
  '8d an opened report that arrives after its person signed out, or after someone else signed in, is never shown');

// 9. build step 8: sharing a saved report with a client, and the PDF
const mk = fn('makeShare'), rf = fn('refreshShares'), wd = fn('withdrawShare'), hs = fn('hideShare');
ok(mk.length > 400 && rf.length > 400 && wd.length > 200 && hs.length > 100, '9a makeShare, refreshShares, withdrawShare and hideShare are found (positive control)', [mk.length, rf.length, wd.length, hs.length]);
const sharePosts = [...code.matchAll(/post\(SHARE_FN, (\{[^}]*\})\)/g)].map((m) => m[1].replace(/\s+/g, ' '));
ok(JSON.stringify(sharePosts.sort()) === JSON.stringify(["{ action: 'create', report_id: forReport }", "{ action: 'list', report_id: forReport }", "{ action: 'revoke', share_id: shareId }"]),
  '9b the share function is asked three things and each carries ONLY its id: no address, no client label, no expiry, no token', sharePosts);
ok(/SHARE_LINK\.test\(link\)/.test(mk) && /typeof body\.link === 'string' \? body\.link : ''/.test(mk) && !/#share=['"]\s*\+|\+\s*['"]#share=/.test(code) && (code.match(/#share=/g) || []).length === 1,
  '9c the page shows a link only when the server made it and it has the one expected form (the page builds none of it: the form appears once, in the check)');
ok(!/(sessionStorage|localStorage)[^\n]*(share|SHARE)|(share|SHARE)[^\n]*(sessionStorage|localStorage)/.test(code), '9d no part of a share link is kept in browser storage');
ok(/\$\('share-link'\)\.value = ''/.test(hs) && /\$\('share-list'\)\.textContent = ''/.test(hs) && /shareFor = null/.test(hs), '9e hiding the card forgets the link, the list and the report it was for');
ok(code.split('hideShare();').length - 1 >= 5, '9f the card is hidden whenever a new report starts, a saved report is opened, or the person signs out or changes (five places call it)');
ok(/session\.user\.id !== forUser \|\| shareFor !== forReport/.test(mk) && /session\.user\.id !== forUser \|\| shareFor !== forReport/.test(rf) && /session\.user\.id !== forUser \|\| shareFor !== forReport/.test(wd),
  '9g an answer that arrives after the person or the report changed is never shown (create, list and withdraw each check)');
ok(/<section class="card" id="share"[^>]*\shidden>/.test(page) && /var shareable = body\.stored === true && typeof body\.report_id === 'string'/.test(code),
  '9h the card is hidden until a report that was SAVED is on screen: an unsaved report has no permanent id to share');
ok(/function printReport\(\)\{ window\.print\(\); \}/.test(code) && !/jspdf|html2canvas|toBlob|createObjectURL|pdf-lib|\.pdf\b/i.test(page.replace(/Download PDF|Save as PDF|\bPDF\b/g, '')),
  '9i "Download PDF" is the browser\'s own print window and nothing else: no PDF library, no canvas, no file made');
ok(/@media print\{[\s\S]*?header\.top,\.card,#status,#creditnote,\.auth-overlay\{display:none!important\}/.test(page), '9j the print stylesheet leaves the header, every card, the status lines and the sign-in off the paper');
ok(/not your name, not your client label/.test(page) && /6 months/.test(page) && /street address/.test(page), '9k the card tells the agent what the client will and will not see, and how long the link lasts (founder, 2026-10-03)');
ok(!/shared-report/.test(read('development-activity.html')) && !/shared-report/.test(read('partials/shell.html')) && !/shared-report/.test(read('shell.js')), '9l no public page links the client\'s page: a client reaches it only from a link an agent made');

// ---- 10. a card the script hides is NOT DRAWN (Manual Test Part B, 2026-10-04) ------------------------------------------------------------
// The page hides cards with the `hidden` attribute, and the browser's own rule for it loses to any page rule that sets a display. Eight of the page's cards and
// panels have one (display:grid by id), so without the page's own [hidden] rule a signed-out visitor was shown Billing, "Invite an agent" and "Saved reports", an agent was
// shown the owner's invite card, and a report that was not saved showed the "Share this report with your client" box. Every check before this one read the attribute, never
// what is drawn. The browser suite now reads what is drawn (2g-2j); this is the required, offline half: the rule must exist, in the CSS and not only in a comment, and it must be
// able to win (!important).
const css = (page.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1].replace(/\/\*[\s\S]*?\*\//g, '');
const idDisplay = [...css.matchAll(/(^|\})\s*(#[a-z0-9-]+)\{[^}]*\bdisplay:\s*(grid|flex|block)\b/g)].map((m) => m[2]);
ok(idDisplay.length >= 8 && ['#billing', '#team', '#saved', '#share', '#watch', '#compare', '#profile', '#minted'].every((id) => idDisplay.includes(id)),
  '10a the reason for the rule exists in this page: the hidden cards each carry a display of their own (control: the rule is not guarding nothing)', idDisplay);
ok((css.match(/(^|\})\s*\[hidden\]\{display:none!important\}/g) || []).length === 1, '10b the page has its own [hidden]{display:none!important} rule, once, in the CSS (a comment does not count)');
ok(css.search(/(^|\})\s*\[hidden\]\{display:none!important\}/) < css.search(/(^|\})\s*#[a-z0-9-]+\{[^}]*\bdisplay:\s*(grid|flex|block)\b/),
  '10c and it comes before the first rule that sets a display, so nobody reads it as an afterthought that a later rule could be thought to override');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
