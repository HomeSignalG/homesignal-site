// NAVIGATION IDENTITY — a page must tell the shared chrome which product page it is.
//
// THE DEFECT THIS EXISTS TO PREVENT (founder-observed on production, 2026-09-04):
// homesignalmap.html — the primary map — declared <body data-nav="dev">, so the sidebar
// highlighted "Development & Impact" while the resident was on Maps, and the Maps item
// could never light up on any page of the site. Clicking Maps from Alerts therefore looked
// like it had bounced the user back to Development, even though the URL had reached Map 1.
//
// It shipped because the retirement of the second map (maps.html, which owned the "maps"
// token) repointed the sidebar's Maps entry at homesignalmap.html without moving the token,
// and NOTHING in the repo asserted rendered navigation state — a grep for `data-nav` across
// test/ matched zero files. This is that missing assertion.
//
// The mechanism it protects, in shell.js::injectShell:
//   const nav = document.body.dataset.nav;
//   document.querySelector('.hs-nav a[data-nav="' + nav + '"]').classList.add('on');
// The sidebar became a horizontal header on 2026-09-30 (founder, Revised Index Design); the
// mechanism is the same: one token in, one lit link out.
// One token in, one highlighted link out. So a page's token IS its navigation identity.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

// A section whose sidebar entry is deliberately not rendered today. A page may still
// declare its token; anything NOT listed here must match a live nav entry, so a typo
// ("mapz") can never pass as a valid identity.
// NAVIGATION PLAN v3 (founder, 2026-09-30): the sidebar is THREE items, Explore | My Places
// | Enterprise, and every shell page declares one of those three or none at all. That
// reverses A-021's four containers. The old hidden tokens are gone with it: reports.html
// now sits under My Places ("props") and community.html under Explore ("explore"), so no
// page declares a section that is deliberately missing from the menu. The map stays, empty,
// so a future hidden section still has to be named here, with its reason, to pass.
const HIDDEN_SECTIONS = {};

// ── the sidebar, as shipped ──────────────────────────────────────────────────────────────
const shellHtml = read('partials/shell.html');
const navBlock = (shellHtml.match(/<nav class="hs-nav"[\s\S]*?<\/nav>/) || [''])[0];
ok(navBlock.length > 0, 'the shared header nav block is present in partials/shell.html');

const NAV = [];
const linkRe = /<a\s+href="([^"]+)"[^>]*data-nav="([^"]*)"/g;
let m;
while ((m = linkRe.exec(navBlock))) NAV.push({ href: m[1], token: m[2] });
ok(NAV.length === 3, 'v3 the primary nav is EXACTLY THREE items', NAV);
ok(NAV.map((n) => n.token).join('|') === 'explore|props|enterprise',
  'v3 ...in order: Explore, My Places, Enterprise', NAV.map((n) => n.token));
ok(NAV.map((n) => n.href).join('|') === 'index.html|properties.html|development-activity.html',
  'v3 ...pointing at index.html, properties.html and development-activity.html', NAV.map((n) => n.href));
ok(/<a class="hs-brand" href="index\.html">/.test(shellHtml),
  'v3 the HomeSignal logo opens Explore (index.html)');

const tokenForHref = Object.create(null);
NAV.forEach((n) => { tokenForHref[n.href] = n.token; });
const liveTokens = new Set(NAV.map((n) => n.token));

ok(NAV.every((n) => existsSync(join(root, n.href.split('?')[0]))),
  'every sidebar entry points at a page that exists',
  NAV.filter((n) => !existsSync(join(root, n.href.split('?')[0]))).map((n) => n.href));

ok(liveTokens.size === NAV.length,
  'no two sidebar entries share a navigation token (two links would light up together)',
  NAV.map((n) => n.token));

// ── every page's declared identity ───────────────────────────────────────────────────────
const PAGE_RE = /<body[^>]*\sdata-nav="([^"]*)"/;
const pages = [];
for (const n of NAV) pages.push(n.href.split('?')[0]);
// plus every other root page that declares an identity (detail pages, hidden sections)
// Pages that USED to be sidebar destinations stop arriving through NAV when they leave the
// menu (A-021 lost homesignalmap.html and community.html this way; v3 loses dashboard.html,
// alerts.html and development.html), so every shell page is listed explicitly or its
// identity goes unchecked, which is exactly the silence this file exists to end.
for (const f of ['index.html', 'dashboard.html', 'alerts.html', 'development.html',
                 'development-activity.html', 'property.html', 'homesignalmap.html',
                 'community.html', 'reports.html', 'today.html', 'about.html', 'contact.html',
                 'how-it-works.html', 'privacy.html']) {
  if (existsSync(join(root, f))) pages.push(f);
}
const declared = [];
for (const f of [...new Set(pages)]) {
  const mm = read(f).match(PAGE_RE);
  if (mm && mm[1]) declared.push({ file: f, token: mm[1] });
}
ok(declared.length >= 5, 'the app pages declare a navigation identity', declared.length);
// Every primary item's own page must declare that item's token. Without this, forgetting
// index.html's token would pass silently: `declared` only records pages that HAVE one.
const undeclaredTargets = NAV.filter((n) => !declared.some((d) => d.file === n.href.split('?')[0]))
  .map((n) => n.href);
ok(undeclaredTargets.length === 0,
  'v3 every primary item\'s page declares an identity at all', undeclaredTargets);

// THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT: a page that IS a sidebar destination
// must claim that entry's own token. homesignalmap.html claiming "dev" fails right here.
const targetMismatches = declared
  .filter((d) => tokenForHref[d.file] != null && tokenForHref[d.file] !== d.token)
  .map((d) => d.file + ' declares "' + d.token + '" but its sidebar entry is "' + tokenForHref[d.file] + '"');
ok(targetMismatches.length === 0,
  'every page reachable from the sidebar declares ITS OWN entry\'s identity', targetMismatches);

// A page that is not itself a sidebar destination (a detail page) may sit under a section,
// but only under one that exists — otherwise it silently highlights nothing.
const orphanTokens = declared
  .filter((d) => tokenForHref[d.file] == null)
  .filter((d) => !liveTokens.has(d.token) && !HIDDEN_SECTIONS[d.token])
  .map((d) => d.file + ' -> "' + d.token + '"');
ok(orphanTokens.length === 0,
  'a page that is not a sidebar destination still declares a section that exists', orphanTokens);

// Named pins, so a rename is loud rather than quietly re-shuffling what lights up.
const tokenOf = (f) => (declared.find((d) => d.file === f) || {}).token;
// THE v3 ACTIVE-NAV MATRIX (founder navigation plan v3, §6). The token names the SECTION a
// page belongs to, never the page that linked to it: Map 1 reached from My Places still
// lights Explore. Do NOT re-add a Maps, Development, Dashboard or Alerts entry to make an
// old pin green.
// The Revised Index Design (founder, 2026-09-30, audited against a later main than v3) moved
// property.html and reports.html into the Explore group: "active state on index/community/
// property/homesignalmap/development/reports = Explore; properties/dashboard/alerts = My Places".
for (const f of ['index.html', 'community.html', 'homesignalmap.html', 'development.html', 'property.html', 'reports.html'])
  ok(tokenOf(f) === 'explore', f + ' is an Explore page', tokenOf(f));
for (const f of ['properties.html', 'dashboard.html', 'alerts.html'])
  ok(tokenOf(f) === 'props', 'v3 ' + f + ' sits under My Places', tokenOf(f));
ok(tokenOf('development-activity.html') === 'enterprise',
  'v3 development-activity.html lights Enterprise', tokenOf('development-activity.html'));
for (const f of ['about.html', 'how-it-works.html', 'contact.html', 'privacy.html'])
  ok(tokenOf(f) === undefined, 'v3 ' + f + ' is a support page and lights no primary item', tokenOf(f));
ok(tokenForHref['homesignalmap.html'] === undefined,
  'there is NO Maps sidebar entry', tokenForHref['homesignalmap.html']);
for (const gone of ['dashboard.html', 'alerts.html', 'development.html'])
  ok(tokenForHref[gone] === undefined, 'v3 ' + gone + ' left the primary menu (the page stays)', tokenForHref[gone]);

// The fold is about the SIDEBAR, never about the page. Map 1 must still exist and must
// still be a ZIP-scoped nav target, or the wrong thing was folded.
ok(existsSync(join(root, 'homesignalmap.html')), 'A-021 Map 1 STILL EXISTS as a page');
const shellJsSrc = read('shell.js');
ok(/HS\.MAP_PAGES = \['homesignalmap\.html'\];/.test(shellJsSrc),
  'A-021 Map 1 is still in MAP_PAGES');
// FIX 8 D1 (founder): dashboard.html LEFT ZIP_NAV_PAGES. The Dashboard is an account-wide
// ALL MY PLACES briefing, so sidebar nav must not stamp one currently-viewed ZIP on it —
// the same reason properties.html has always been excluded. today.html stays out (A-021),
// and homesignalmap.html + community.html stay in.
ok(new RegExp('HS\\.ZIP_NAV_PAGES = ' + "['alerts.html', 'development.html', 'homesignalmap.html', 'community.html']" + ';'.replace('X','')).test(shellJsSrc) ||
   shellJsSrc.includes("HS.ZIP_NAV_PAGES = ['alerts.html', 'development.html', 'homesignalmap.html', 'community.html']" + ';'),
  'Fix 8 D1 ZIP_NAV_PAGES is the four ZIP-scoped tools — dashboard.html is OUT');
ok(read('lib/view-zip.js').includes("var ZIP_NAV_PAGES = ['alerts.html', 'development.html', 'homesignalmap.html', 'community.html']" + ';'),
  'Fix 8 D1 ...and lib/view-zip.js carries the byte-identical literal');
ok(!/HS\.ZIP_NAV_PAGES = \[[^\]]*'dashboard\.html'/.test(shellJsSrc)
   && !/var ZIP_NAV_PAGES = \[[^\]]*'dashboard\.html'/.test(read('lib/view-zip.js')),
  'Fix 8 D1 dashboard.html cannot creep back into either ZIP_NAV_PAGES literal');

// v3: no primary item is a ZIP-scoped tool. That is intentional, and it is what makes
// paintNavHrefs' sidebar loop stamp nothing now: ZIP context reaches the tools through the
// bell and the in-page data-znav links instead. A ZIP_NAV_PAGES target re-entering the menu
// would start carrying ?zip= again, so it has to arrive deliberately, through this pin.
const zipNavPages = ['alerts.html', 'development.html', 'homesignalmap.html', 'community.html'];
ok(NAV.every((n) => !zipNavPages.includes(n.href.split('?')[0])),
  'v3 no primary item is a ZIP_NAV_PAGES target, so none of the three carries ?zip=',
  NAV.map((n) => n.href));

// Zero map entries in the sidebar now, and the retired second map is still not there.
const mapEntries = NAV.filter((n) => /map/i.test(n.href));
ok(mapEntries.length === 0, 'A-021 no map entry in the sidebar — Maps was folded', mapEntries);
ok(!/href="maps\.html"/.test(navBlock), 'the retired second map is not in the sidebar');
ok(!/href="today\.html"/.test(navBlock), 'A-020 Today is not in the sidebar');
// The Explore DROPDOWN (founder, 2026-10-02) lists the ZIP page as "Activity", the map as
// "Development Map" and the development list as "Quality of Life Impact". They are
// sub-entries with no data-nav, so they never light a section and never count as primary
// items; read the header nav without the dropdown for the primary-item checks.
const exploreSub = (navBlock.match(/<div class="hs-navsub" id="hs-explore-sub">[\s\S]*?<\/div>/) || [''])[0];
// The Enterprise dropdown (founder, 2026-10-05) is how an agent gets back to the reports page,
// which no other page linked. Same shape as Explore's: sub-entries with no data-nav.
const enterpriseSub = (navBlock.match(/<div class="hs-navsub" id="hs-enterprise-sub">[\s\S]*?<\/div>/) || [''])[0];
const entLinks = [...enterpriseSub.matchAll(/<a href="([^"]+)"\s+data-sub="([a-z]+)">([^<]+)<\/a>/g)].map((m) => m[1] + '|' + m[2] + '|' + m[3]);
ok(JSON.stringify(entLinks) === JSON.stringify([
  'development-activity.html|overview|Enterprise overview',
  'development-activity-reports.html|reports|My reports']),
  'the Enterprise dropdown is exactly Enterprise overview, My reports, in that order', entLinks);
ok(!/data-nav=/.test(enterpriseSub), 'the Enterprise dropdown entries light no primary item');
ok(/<a href="development-activity\.html" data-nav="enterprise">Enterprise<\/a>\s*<button[^>]*id="hs-enterprise-toggle"/.test(navBlock),
  'Enterprise itself still opens development-activity.html, with its chevron beside it');
const navPrimary = navBlock.replace(exploreSub, '').replace(enterpriseSub, '');
ok(!/href="community\.html"/.test(navPrimary), 'A-021 Zip Code Activity is not a primary nav item');
const subLinks = [...exploreSub.matchAll(/<a href="([^"]+)"\s+data-sub="([a-z]+)">([^<]+)<\/a>/g)].map((m) => m[1] + '|' + m[2] + '|' + m[3]);
ok(JSON.stringify(subLinks) === JSON.stringify([
  'development.html|qol|Quality of Life Impact',
  'homesignalmap.html|map|Development Map',
  'community.html|activity|Activity']),
  'the Explore dropdown is exactly Quality of Life Impact, Development Map, Activity, in that order', subLinks);
ok(!/data-nav=/.test(exploreSub), '...and none of the three carries a data-nav, so none lights a section');
const zipNavLiteral = (shellJsSrc.match(/HS\.ZIP_NAV_PAGES = \[([^\]]*)\]/) || [, ''])[1];
ok(subLinks.length === 3 && subLinks.every((l) => zipNavLiteral.indexOf("'" + l.split('|')[0] + "'") >= 0),
  '...and all three are ZIP_NAV_PAGES targets, so paintNavHrefs stamps the viewed ZIP on them');
for (const [f, tok] of [['development.html', 'qol'], ['homesignalmap.html', 'map'], ['community.html', 'activity']])
  ok(new RegExp('<body data-nav="explore" data-explore="' + tok + '">').test(read(f)),
    f + ' names its dropdown entry with data-explore="' + tok + '"');
ok(/data-explore="activity"/.test(read('scripts/gen_zip_pages.py')),
  'the generated /community/<zip>/ documents name the Activity entry too');

// The retired pages are redirect stubs, not deletions.
// ⚠️ reports.html LEFT THIS LIST on 2026-09-11, by explicit authorization naming A-019. It
// is a real page again — see the Property Reports block below, which pins the contract it
// left this one for. today.html is untouched and still a stub.
for (const [f, target] of [['today.html', '/dashboard.html']]) {
  const src = read(f);
  ok(/window\.location\.replace\('\/dashboard\.html'/.test(src),
    'A-019/A-020 ' + f + ' is a redirect stub to ' + target, src.slice(0, 80));
  ok(!/<template id="hs-content">/.test(src),
    'A-019/A-020 ...with no #hs-content — it is not a second page', f);
  ok(/var q = window\.location\.search \|\| '';/.test(src),
    'A-019/A-020 ...carrying the query string, same convention as maps.html', f);
}
// community.html is an Explore page, and so is every generated /community/<zip>/ document,
// which loads the same shell. The generator's other families carry no shell and keep
// their own tokens.
ok(tokenOf('community.html') === 'explore',
  'v3 community.html declares "explore" — the public ZIP lights Explore', tokenOf('community.html'));
const genSrc = read('scripts/gen_zip_pages.py');
ok(/<body data-nav="explore" data-zip=/.test(genSrc) && !/data-nav="comm"/.test(genSrc),
  'v3 ...and the generator SOURCE stamps data-nav="explore" on every generated ZIP document');
// ── PUBLIC-BETA PROPERTY REPORTS ─────────────────────────────────────────────────────────
// The Address dossier's "Generate property report" opens an honest in-progress page that
// can return the resident to the EXACT Address they came from. Pinned here because this
// file already owns the reports.html contract; what changed is which contract.
//
// A-009 IS UNCHANGED AND STAYS PINNED: the Dashboard carries the report capability list and
// routes NOBODY through this page. That half of A-019 was not reversed, so the assertion
// that protected it stays — now matching reports.html ANYWHERE in dashboard.html, not only
// as a bare quoted literal. The old regex required a quote immediately after ".html", so
// `location.href='reports.html?id='+…` slipped straight past it: a guard with a hole is how
// the thing it guards comes back wearing a query string.
//
// ⚠️ AND SCOPED TO CODE, NOT PROSE. Widening the match without stripping comments made this
// pin fail on dashboard.html's own sentence ABOUT reports.html, and three pins below fail on
// the comments that explain what they forbid — a pin that names the string it forbids cannot
// also search the whole file for it. Same stripper as test/final-matrix.test.mjs, byte for
// byte, and the block-comment arm still must not fire inside a URL's "//".
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1');

ok(!/reports\.html/.test(strip(read('dashboard.html'))),
  'A-009/A-019 dashboard.html still routes nobody through reports.html',
  (strip(read('dashboard.html')).match(/.{0,40}reports\.html.{0,40}/) || [])[0]);

const reportsSrc = read('reports.html');
const propSrc    = read('property.html');
const reportsCode = strip(reportsSrc);   // the pins about what the page DOES read this one

// It is a real page on the shared shell, not a stub and not a bespoke error screen.
ok(/<template id="hs-content">/.test(reportsSrc) && /<body data-nav="explore">/.test(reportsSrc),
  'reports.html is a real page on the shared shell (#hs-content), in the Explore group');
ok(!/location\.replace/.test(reportsSrc),
  'reports.html no longer redirects — a resident who clicks the CTA lands here');

// The frozen Premium Property Reports treatment. Silent reword is a product change.
ok(/PROPERTY REPORTS · PREMIUM/.test(reportsSrc),
  'reports.html is labelled PROPERTY REPORTS · PREMIUM');
ok(/<h1>Property reports are coming soon<\/h1>/.test(reportsSrc),
  'reports.html says "Property reports are coming soon"');
ok(/Get a detailed report for this property, including property intelligence and nearby changes that may affect the property\./.test(reportsSrc),
  'reports.html carries the frozen Premium explainer, verbatim');
ok(/Get Premium access →/.test(reportsSrc),
  'reports.html CTA is exactly "Get Premium access →"');
ok(/HS\.openModal\('premiumModal'\)/.test(reportsSrc),
  'reports.html reuses HS.openModal(\'premiumModal\') — the Community Profile entry point');
ok(!/premiumEmail|premiumForm|submitWaitlist|persistEmail|hs_premium_waitlist_join/.test(reportsCode),
  'reports.html does not duplicate the waitlist form or persistence path');

// The CTA reaches it, keeps its label, and carries the ORIGINATING Address.
ok(/id="propReportBtn"/.test(propSrc) && /Generate property report/.test(propSrc),
  'property.html still offers "Generate property report" — the label did not change');
ok(/location\.href=\\'reports\.html\?id=' \+ encodeURIComponent\(p\.id\)/.test(propSrc),
  'property.html routes that CTA to reports.html carrying THIS Address\'s id',
  (propSrc.match(/.{0,60}reports\.html.{0,40}/) || [])[0]);

// And the return path lands on that same Address, by the app's existing ?id= route.
ok(/'property\.html\?id=' \+ encodeURIComponent\(from\.id\)/.test(reportsSrc),
  'reports.html returns to property.html?id=<the id it was handed>');
ok(/Back to property/.test(reportsSrc),
  'reports.html offers a "Back to property" action');
// THE ASSERTION THAT MAKES THE RETURN TRUSTWORTHY. property.html used to resolve with
// `find(...) || S.activeProperty`; inheriting that fallback here would send a resident with
// a stale id back to SOME OTHER Address and call it theirs. The action must be gated on the
// id resolving, and must not fall back.
ok(/HS\.state && HS\.state\.properties/.test(reportsCode)
   && /if \(from && slot\)/.test(reportsCode)
   && !/activeProperty/.test(reportsCode),
  'reports.html shows that action only when the id resolves to a real saved Address — and never falls back to another one');

// The flag the browser suite waits on before asserting the ABSENCE of that action. If it
// stops being set on both outcomes, that suite silently starts measuring nothing.
ok(/window\.__HS_REPORTS_READY = true;/.test(reportsCode),
  'reports.html signals when it has DECIDED, so an absent back action is measurable');

// THE RETIRED PROTOTYPE MUST NOT COME BACK WITH IT. This page is the in-progress state; it
// is not an opening to restore the four report rows, the flagship preview document or the
// share affordance for a report that was never generated. (test/final-matrix.test.mjs
// LEFTOVER 8 pins the preview document's own strings; these are the CTAs.)
for (const gone of ['Share this report', 'Community Snapshot', 'Impact Analysis', 'Weekly Briefing'])
  ok(!reportsCode.includes(gone),
    'the retired Reports prototype stays retired — reports.html has no "' + gone + '"');

// Nothing is generated here: the page must not grow an export, a write or a paywall.
// Scoped to the page's OWN markup and logic: a <script src> to a shared-shell module is
// not something this page does, and matching one would make the pin fire on a filename.
// (lib/premium-waitlist.js loads on all 13 shell pages because the Premium modal lives in
// partials/shell.html; dropping it here would silently break capture on this page alone.)
// The repo has paid for this shape before — a pin that names the string it forbids must be
// scoped to the statement it is about, or it stops guarding by becoming noise.
const reportsLogic = reportsCode.replace(/<script\s+src="[^"]*"\s*><\/script>/g, '');
ok(!/text\/csv|\.pdf|jsPDF|download|supabase\.from\(|\.insert\(|paywall/i.test(reportsLogic),
  'reports.html generates nothing — no PDF, CSV, download, write or paywall was invented',
  (reportsLogic.match(/.{0,40}(text\/csv|\.pdf|jsPDF|download|paywall).{0,40}/i) || [])[0]);
ok(!/myZip|viewZip|DEFAULT_ZIP|activeProperty/.test(reportsLogic),
  'reports.html does not pull identity or ZIP from unrelated account/viewed/default state');

// ── the consumer must still exist, or this whole contract is decoration ──────────────────
const shellJs = read('shell.js');
ok(/document\.body\.dataset\.nav/.test(shellJs),
  'shell.js still reads the page\'s declared identity');
ok(/\.hs-nav a\[data-nav="'\s*\+\s*nav\s*\+\s*'"\]/.test(shellJs) && /classList\.add\('on'\)/.test(shellJs)
   && /setAttribute\('aria-current', 'page'\)/.test(shellJs),
  'shell.js still lights exactly the one nav link that matches it, and marks it aria-current="page"');

console.log(fails ? '\n' + fails + ' nav-identity assertion(s) FAILED.' : '\nAll nav-identity assertions passed.');
process.exit(fails ? 1 : 0);
