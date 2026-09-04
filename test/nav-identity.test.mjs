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
const HIDDEN_SECTIONS = {
  reports: 'the Reports entry is commented out of partials/shell.html for the public beta'
};

// ── the sidebar, as shipped ──────────────────────────────────────────────────────────────
const shellHtml = read('partials/shell.html');
const navBlock = (shellHtml.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
ok(navBlock.length > 0, 'the shared sidebar block is present in partials/shell.html');

const NAV = [];
const linkRe = /<a\s+href="([^"]+)"[^>]*data-nav="([^"]*)"/g;
let m;
while ((m = linkRe.exec(navBlock))) NAV.push({ href: m[1], token: m[2] });
ok(NAV.length >= 6, 'the sidebar exposes its entries as href + data-nav pairs', NAV.length);

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
for (const f of ['property.html', 'reports.html', 'about.html', 'contact.html',
                 'how-it-works.html', 'privacy.html']) {
  if (existsSync(join(root, f))) pages.push(f);
}
const declared = [];
for (const f of [...new Set(pages)]) {
  const mm = read(f).match(PAGE_RE);
  if (mm && mm[1]) declared.push({ file: f, token: mm[1] });
}
ok(declared.length >= 7, 'the app pages declare a navigation identity', declared.length);

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
ok(tokenOf('homesignalmap.html') === 'maps',
  'MAP 1 (homesignalmap.html) IS the Maps section', tokenOf('homesignalmap.html'));
ok(tokenOf('development.html') === 'dev',
  'development.html IS the Development & Impact section', tokenOf('development.html'));
ok(tokenOf('alerts.html') === 'alerts', 'alerts.html IS the Alerts section', tokenOf('alerts.html'));
ok(tokenForHref['homesignalmap.html'] === 'maps',
  'the sidebar\'s Maps entry points at the primary map', tokenForHref['homesignalmap.html']);

// Map 2 stays retired: the sidebar must offer exactly one map, and it must be Map 1.
const mapEntries = NAV.filter((n) => /map/i.test(n.href));
ok(mapEntries.length === 1 && mapEntries[0].href === 'homesignalmap.html',
  'exactly one map entry in the sidebar, and it is Map 1', mapEntries);
ok(!/href="maps\.html"/.test(navBlock), 'the retired second map is not in the sidebar');

// ── the consumer must still exist, or this whole contract is decoration ──────────────────
const shellJs = read('shell.js');
ok(/document\.body\.dataset\.nav/.test(shellJs),
  'shell.js still reads the page\'s declared identity');
ok(/\.nav a\[data-nav="'\s*\+\s*nav\s*\+\s*'"\]/.test(shellJs) && /classList\.add\('on'\)/.test(shellJs),
  'shell.js still lights exactly the one sidebar link that matches it');

console.log(fails ? '\n' + fails + ' nav-identity assertion(s) FAILED.' : '\nAll nav-identity assertions passed.');
process.exit(fails ? 1 : 0);
