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
//   document.querySelector('.nav a[data-nav="' + nav + '"]').classList.add('on');
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
// PHASE 8 (A-019 / A-020 / A-021): the sidebar is now FOUR containers. Three tokens no
// longer have a sidebar entry, and none of the three PAGES was deleted — that distinction
// is what this map records.
const HIDDEN_SECTIONS = {
  reports: 'reports.html is the public-beta Property Reports in-progress page (2026-09-11), opened by '
         + 'property.html\'s "Generate property report"; it has no sidebar entry. The report CAPABILITY '
         + 'list is still A-009 on the Dashboard, which this page does not replace',
  today:   'A-020: today.html is a redirect stub to dashboard.html; its four areas live on A-003/A-004/A-005 and A-022',
  comm:    'A-021: community.html is the PUBLIC ZIP surface, not a fifth logged-in container — it highlights nothing'
};

// ── the sidebar, as shipped ──────────────────────────────────────────────────────────────
const shellHtml = read('partials/shell.html');
const navBlock = (shellHtml.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
ok(navBlock.length > 0, 'the shared sidebar block is present in partials/shell.html');

const NAV = [];
const linkRe = /<a\s+href="([^"]+)"[^>]*data-nav="([^"]*)"/g;
let m;
while ((m = linkRe.exec(navBlock))) NAV.push({ href: m[1], token: m[2] });
ok(NAV.length === 4, 'A-021 the sidebar is EXACTLY FOUR containers', NAV);
ok(NAV.map((n) => n.token).join('|') === 'dash|alerts|dev|props',
  'A-021 ...in order: Dashboard, Alerts, Development, My Places', NAV.map((n) => n.token));
ok(NAV.map((n) => n.href).join('|') === 'dashboard.html|alerts.html|development.html|properties.html',
  'A-021 ...pointing at the four container pages', NAV.map((n) => n.href));

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
// A-021 note: homesignalmap.html and community.html USED to be sidebar destinations and
// are no longer, so they stopped arriving through NAV — they must be listed explicitly or
// their identity goes unchecked, which is exactly the silence this file exists to end.
for (const f of ['property.html', 'homesignalmap.html', 'community.html',
                 'reports.html', 'today.html', 'about.html', 'contact.html',
                 'how-it-works.html', 'privacy.html']) {
  if (existsSync(join(root, f))) pages.push(f);
}
const declared = [];
for (const f of [...new Set(pages)]) {
  const mm = read(f).match(PAGE_RE);
  if (mm && mm[1]) declared.push({ file: f, token: mm[1] });
}
ok(declared.length >= 5, 'the app pages declare a navigation identity', declared.length);

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
// ⚠️ THE PIN BELOW IS THE EXACT INVERSE OF THE 2026-09-04 DEFECT, AND THAT IS DELIBERATE.
// That defect was homesignalmap.html declaring "dev" WHILE a Maps sidebar entry existed:
// the token pointed at a section the page was not, and Maps could never light up. A-021
// removed the Maps entry, so Map 1 now genuinely LIVES UNDER Development — claiming "dev"
// IS the fold, and visiting Map 1 correctly lights Development. The defect and the fix
// look identical in one line of HTML and are opposites in context; the rest of this file
// is what supplies the context. Do NOT re-add a Maps sidebar entry to make this green.
ok(tokenOf('homesignalmap.html') === 'dev',
  'A-021 MAP 1 (homesignalmap.html) now lives UNDER Development', tokenOf('homesignalmap.html'));
ok(tokenOf('development.html') === 'dev',
  'A-021 ...alongside development.html, which is the same section', tokenOf('development.html'));
ok(tokenOf('alerts.html') === 'alerts', 'alerts.html IS the Alerts section', tokenOf('alerts.html'));
ok(tokenForHref['homesignalmap.html'] === undefined,
  'A-021 there is NO Maps sidebar entry any more', tokenForHref['homesignalmap.html']);

// The fold is about the SIDEBAR, never about the page. Map 1 must still exist and must
// still be a ZIP-scoped nav target, or the wrong thing was folded.
ok(existsSync(join(root, 'homesignalmap.html')), 'A-021 Map 1 STILL EXISTS as a page');
const shellJsSrc = read('shell.js');
ok(/HS\.MAP_PAGES = \['homesignalmap\.html'\];/.test(shellJsSrc),
  'A-021 Map 1 is still in MAP_PAGES');
ok(/HS\.ZIP_NAV_PAGES = \['dashboard\.html', 'alerts\.html', 'development\.html', 'homesignalmap\.html', 'community\.html'\];/.test(shellJsSrc),
  'A-021 ZIP_NAV_PAGES dropped ONLY today.html — homesignalmap.html and community.html stay');
ok(read('lib/view-zip.js').includes("var ZIP_NAV_PAGES = ['dashboard.html', 'alerts.html', 'development.html', 'homesignalmap.html', 'community.html'];"),
  'A-021 ...and lib/view-zip.js carries the byte-identical literal');

// Zero map entries in the sidebar now, and the retired second map is still not there.
const mapEntries = NAV.filter((n) => /map/i.test(n.href));
ok(mapEntries.length === 0, 'A-021 no map entry in the sidebar — Maps was folded', mapEntries);
ok(!/href="maps\.html"/.test(navBlock), 'the retired second map is not in the sidebar');
ok(!/href="today\.html"/.test(navBlock), 'A-020 Today is not in the sidebar');
ok(!/href="community\.html"/.test(navBlock), 'A-021 Zip Code Activity is not in the sidebar');

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
// community.html keeps its own identity and is NOT a fifth container.
ok(tokenOf('community.html') === 'comm',
  'A-021 community.html still declares "comm" — the public ZIP highlights nothing', tokenOf('community.html'));
ok(/data-nav="comm"/.test(read('scripts/gen_zip_pages.py')),
  'A-021 ...and the generator SOURCE still stamps data-nav="comm" on every generated document');
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
ok(/<template id="hs-content">/.test(reportsSrc) && /<body data-nav="reports">/.test(reportsSrc),
  'reports.html is a real page on the shared shell (#hs-content + its nav identity)');
ok(!/location\.replace/.test(reportsSrc),
  'reports.html no longer redirects — a resident who clicks the CTA lands here');

// The honest state itself. Both sentences, verbatim: this copy IS the deliverable, so a
// silent reword is a product change and must fail here.
ok(/<h1>Property reports are in progress<\/h1>/.test(reportsSrc),
  'reports.html says "Property reports are in progress"');
ok(/We're working on this feature now\. Check back soon\./.test(reportsSrc),
  'reports.html says "We\'re working on this feature now. Check back soon."');

// The CTA reaches it, keeps its label, and carries the ORIGINATING Address.
ok(/Generate property report/.test(propSrc),
  'property.html still offers "Generate property report" — the label did not change');
ok(/location\.href=\\'reports\.html\?id=' \+ encodeURIComponent\(p\.id\)/.test(propSrc),
  'property.html routes that CTA to reports.html carrying THIS Address\'s id',
  (propSrc.match(/.{0,60}reports\.html.{0,40}/) || [])[0]);

// And the return path lands on that same Address, by the app's existing ?id= route.
ok(/'property\.html\?id=' \+ encodeURIComponent\(from\.id\)/.test(reportsSrc),
  'reports.html returns to property.html?id=<the id it was handed>');
ok(/Back to property/.test(reportsSrc),
  'reports.html offers a "Back to property" action');
// THE ASSERTION THAT MAKES THE RETURN TRUSTWORTHY. property.html resolves its Address with
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
ok(!/text\/csv|\.pdf|jsPDF|download|supabase\.from\(|\.insert\(|paywall|premium/i.test(reportsLogic),
  'reports.html generates nothing — no PDF, CSV, download, write or gate was invented',
  (reportsLogic.match(/.{0,40}(text\/csv|\.pdf|jsPDF|download|paywall|premium).{0,40}/i) || [])[0]);

// ── the consumer must still exist, or this whole contract is decoration ──────────────────
const shellJs = read('shell.js');
ok(/document\.body\.dataset\.nav/.test(shellJs),
  'shell.js still reads the page\'s declared identity');
ok(/\.nav a\[data-nav="'\s*\+\s*nav\s*\+\s*'"\]/.test(shellJs) && /classList\.add\('on'\)/.test(shellJs),
  'shell.js still lights exactly the one sidebar link that matches it');

console.log(fails ? '\n' + fails + ' nav-identity assertion(s) FAILED.' : '\nAll nav-identity assertions passed.');
process.exit(fails ? 1 : 0);
