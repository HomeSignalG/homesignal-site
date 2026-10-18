// THE SHARED LAYOUT SYSTEM (layout.css): three width tiers, one gutter, one container — pinned.
// Run: node test/layout-system.test.mjs
//
// Before 2026-10-18 the site decided its page width in seven places that disagreed (header 1240/32, .page 1180/34, home 1176/32,
// reports workspace 1800/24, review + shared report 1120/16, map 1120/24, Enterprise landing 980), so the logo never lined up with
// the content below it and the same product read as three unrelated layouts. layout.css is now the ONLY place that decides a page
// width, a side gutter, or how the header and the content align. This suite keeps it that way.
// (The rendered alignment at 390/768/1024/1440/1920 is test/layout-system.browser.test.mjs.)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('   detail: ' + JSON.stringify(detail).slice(0, 400)); } };
const squash = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');

const css = squash(read('layout.css'));
ok(css.includes('--hs-w-reading:1180px;'), '1a the reading tier is 1180px');
ok(css.includes('--hs-w-workspace:1440px;'), '1b the workspace tier is 1440px');
ok(css.includes('--hs-gutter:clamp(16px,4vw,40px);'), '1c the side gutter is clamp(16px, 4vw, 40px)');
ok(/body\[data-layout="full"\]\{--hs-max:none\}/.test(css), '1d the full-bleed tier is unrestricted (max none)');
ok(/body\[data-layout="workspace"\]\{--hs-max:calc\(var\(--hs-w-workspace\)\+2\*var\(--hs-gutter\)\)\}/.test(css), '1e the workspace tier adds the gutter on top of 1440, so the CONTENT is 1440 wide');
ok(/\.hs-container\{[^}]*max-width:var\(--hs-max\)[^}]*padding-inline:var\(--hs-gutter\)/.test(css), '1f .hs-container reads the tier and the gutter and nothing else');

// 2. every page that has a width links the layout BEFORE anything that could override it
const pages = readdirSync(root).filter((f) => f.endsWith('.html'));
const linksApp = pages.filter((f) => /href="app\.css\?v=/.test(read(f)));
const missing = linksApp.filter((f) => !/href="layout\.css\?v=[0-9a-f]{8}"/.test(read(f)));
ok(linksApp.length >= 15 && missing.length === 0, `2a all ${linksApp.length} app.css pages link layout.css`, missing);
const order = linksApp.filter((f) => { const h = read(f); return h.indexOf('layout.css') > h.indexOf('app.css'); });
ok(order.length === 0, '2b layout.css is linked before app.css on every page (app.css and page styles can then use, and win over, the tokens)', order);
for (const f of ['development-activity-reports.html', 'development-activity-review.html', 'shared-report.html', 'acquisition.html', 'gov-archive.html'])
  ok(/href="layout\.css\?v=[0-9a-f]{8}"/.test(read(f)) && !/href="app\.css/.test(read(f)), `2c ${f} is a standalone page that shares the layout tokens (and still does not load app.css)`);
ok(/href="\/layout\.css\?v=[0-9a-f]{8}"/.test(read('scripts/gen_zip_pages.py')), '2d the generated /community/<zip>/ documents link layout.css');
ok(/'layout\.css'/.test(read('scripts/stage_site.py')), '2e layout.css is in the Pages artifact allowlist');

// 3. the shared chrome reads the container, not its own width
ok(/class="hs-header__inner hs-container"/.test(read('partials/shell.html')), '3a the site header row is an .hs-container, so the logo sits on the content edge');
const app = read('app.css');
const rule = (sel) => { const m = app.match(new RegExp('(?:^|\\n)\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : ''; };
for (const sel of ['.page', '.hs-header__inner', '.home-index']) {
  const r = rule(sel);
  ok(r !== '' && !/max-width:\s*\d/.test(r) && !/padding[^;]*\b(24|32|34)px/.test(r), `3b app.css ${sel} carries no hard-coded outer width or side padding`, r);
}
ok(/\.page\{[^}]*padding:28px var\(--hs-gutter\) 60px[^}]*max-width:var\(--hs-max\)/.test(app.replace(/\s+/g, ' ')), '3c .page is the tier width with the gutter');
ok(!/\.hs-footer\{[^}]*padding:[^;}]*32px/.test(app), '3d the footer uses the gutter too');

// 4. no page invents its own OUTER width again
const outer = [];
// 404.html is the one deliberate exclusion: a fully self-contained error page with its own nav and footer, served at ANY path (so it cannot
// link a relative stylesheet) and noindex. It is not a page a resident navigates between.
for (const f of pages.filter((p) => p !== '404.html')) {
  const h = read(f);
  for (const m of h.matchAll(/(?:^|[\n}])\s*((?:header(?:\.[a-z]+)?\s+)?\.(?:wrap|in|page|da)|main|footer)\s*\{([^}]*)\}/g)) {
    const w = /max-width:\s*(\d{3,4})px/.exec(m[2]);
    if (w && +w[1] >= 900) outer.push(f + ': ' + m[1].trim() + ' max-width ' + w[1] + 'px');
  }
}
ok(outer.length === 0, '4a no page or inline style sets its own outer max-width of 900px or more (use .hs-container + data-layout)', outer);
// Tier choice per page
const body = (f) => (read(f).match(/<body[^>]*>/) || [''])[0];
ok(/data-layout="workspace"/.test(body('development-activity-reports.html')), '5a the Development Activity Reports workspace is the workspace tier');
ok(/data-layout="full"/.test(body('homesignalmap.html')), '5b Map 1 is the full-bleed tier');
ok(!/data-layout/.test(body('about.html')) && !/data-layout/.test(body('development-activity.html')), '5c prose and landing pages take the default reading tier');
ok(/class="in hs-container"/.test(read('development-activity-reports.html')) && /<main class="wrap hs-container">/.test(read('development-activity-reports.html')),
  '5d the workspace page\'s site bar, title row and main are all containers of the same tier (logo, title and cards share one left edge)');

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL PASS');
process.exit(fails ? 1 : 0);
