// DEVELOPMENT ACTIVITY LANDING PAGE — structural pins (offline, no browser).
// Run: node test/development-activity-landing.test.mjs
//
// What this guards, in the order the founder's brief states it:
//   1. THE SHELL IS THE SHARED SHELL. The page is a <template id="hs-content"> plus the exact
//      script/CSS/CSP set every other public page carries. It brings no navigation, logo,
//      Sign In, footer or stylesheet of its own, so the "byte-identical menu" rule cannot be
//      broken from this file.
//   2. THE COPY AND PRICE ARE THE 100126 PLAN'S, verbatim, and the plan's prohibitions hold: no
//      What Exists Today, no radius choices, no photographs, no forbidden map names, no
//      prediction language, no extra pricing mechanisms.
//   3. NO SECOND VISUAL LANGUAGE. Every colour literal in the page already exists in app.css and
//      every var(--token) it names is defined there.
//   4. NOTHING PROMISES WHAT DOES NOT EXIST. The free-evaluation and $79 checkout buttons are
//      inert until entitlement and checkout ship (plan sections 18 and 25). The page IS deployed
//      (founder, 2026-09-29) but DARK: noindex, linked from nowhere, not in the sitemap. Those
//      facts are tied together: the page may be discoverable (indexed, linked or in the sitemap)
//      only once the buttons are live, so launching out of order fails this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const PAGE = 'development-activity.html';
const src = read(PAGE);
const contact = read('contact.html');
const css = read('app.css');
const noComments = src.replace(/<!--[\s\S]*?-->/g, '');
const markup = noComments.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
const text = markup.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

console.log('--- 1. the shared shell, unchanged ---');
ok(/<template id="hs-content">/.test(src) && /<\/template>/.test(src), 'content lives in <template id="hs-content"> like every shell page');
ok(/<body data-nav="">/.test(src), 'declares no navigation identity (no sidebar entry exists for it, none is invented)');
const scripts = (h) => (h.match(/<script[^>]*\ssrc="[^"]+"/g) || []).map((s) => s.match(/src="([^"]+)"/)[1]);
ok(JSON.stringify(scripts(src)) === JSON.stringify(scripts(contact)),
  'loads exactly the same script set, in the same order, with the same cache keys as contact.html', { page: scripts(src), contact: scripts(contact) });
const meta = (h, re) => (h.match(re) || [''])[0];
ok(meta(src, /<meta http-equiv="Content-Security-Policy"[^>]*>/) === meta(contact, /<meta http-equiv="Content-Security-Policy"[^>]*>/),
  'carries the byte-identical Content-Security-Policy');
ok(meta(src, /<link rel="stylesheet"[^>]*>/) === meta(contact, /<link rel="stylesheet"[^>]*>/), 'links the same app.css version');
ok((src.match(/<link rel="stylesheet"/g) || []).length === 1, 'links exactly one stylesheet (app.css); everything else is scoped inline');
ok(!/<nav\b|<aside\b|<header\b|<footer\b/i.test(markup), 'no nav, aside, header or footer element: the shell owns all chrome');
const classTokens = [...markup.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
const CHROME = ['logo', 'side', 'nav', 'sidefoot', 'upsell', 'top', 'menubtn', 'sharebtn', 'app', 'main', 'loc', 'topadds', 'avatar', 'ib', 'sidebackdrop'];
ok(classTokens.length > 20 && !classTokens.some((c) => CHROME.includes(c)), 'reuses no shell-chrome class name for its own markup', classTokens.filter((c) => CHROME.includes(c)));
ok(!/id="hs-(side|top|nav|slot|signin|avatar)"/.test(markup), 'redefines none of the shell ids');
ok(!/Sign in|Sign up|Go Premium/i.test(text), 'renders no sign-in or premium control of its own');
ok(!/<img\b|<picture\b|<video\b|background-image|url\(/i.test(noComments), 'no image, photograph or background-image anywhere (plan sections 7, 13, 24)');
const cssBlock = (noComments.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
const classSelectors = [...cssBlock.matchAll(/(?:^|[\s,}])\.([a-zA-Z][\w-]*)/gm)].map((m) => m[1]);
const unscoped = [...new Set(classSelectors)].filter((c) => !/^da(-|$)/.test(c) && !css.includes('.' + c));
ok(unscoped.length === 0, 'every class the inline CSS restyles is either page-prefixed (da-) or unstyled elsewhere', unscoped);
ok(!/(^|\n)\s*(html|body|\.page|\.block|\.mbtn|\.wchip|\.field|\.btn)\s*[{,]/.test(cssBlock),
  'the inline CSS does not redefine a shared selector (html, body, .page, .block, .mbtn, .wchip, .field, .btn)');

console.log('--- 2. the approved 100126 copy and price ---');
const COPY = [
  'HomeSignal Development Activity',
  'Know what’s changing around a property before your client does.',
  'HomeSignal shows development that is proposed, approved, permitted and under construction around a property—organized from covered official sources into one client-ready Development Activity report.',
  'Start with 20 free reports', 'See a sample report →', 'Check coverage →',
  'No credit card required · For real-estate agents and brokerages',
  'Scan by Type. Understand the Stage.',
  'HomeSignal’s Development Activity product is built across a national network of 12,722 canonical ZIP codes. Source depth and report readiness vary by property.',
  'Check Development Activity coverage', 'Enter property address or ZIP', 'Check coverage',
  'Your MLS tells you about the property.', 'HomeSignal tells you what’s changing around it.',
  'That’s the gap HomeSignal Development Activity is built to fill.',
  'See development before it becomes obvious',
  'Not another neighborhood report',
  'This report focuses on development activity and change. It is not an inventory of existing schools, parks, businesses, buildings or neighborhood amenities.',
  'Built for the client conversation', 'For buyers', 'For listings', 'For agents',
  'Don’t just tell your client. Show them the record.',
  'Clear enough for your client. Sourced enough for you.',
  'Simple, transparent pricing', 'Start Free', '20 Development Activity reports free', 'No credit card required.',
  'Individual accounts receive 20 individual evaluation reports. Brokerage evaluation accounts share 20 reports across their invited evaluation users.',
  'New Member Price', '$79', '/month', '100 new Development Activity reports each month',
  'Reopen existing reports without using another report.', 'Share existing reports with clients.',
  'Download or print existing reports.', 'Cancel anytime.', 'Join for $79/month',
  'Need access for a brokerage, team, or organization?', 'Contact us for Enterprise Pricing →',
  'Enterprise Pricing is for organizations requiring arrangements beyond the standard self-service account.',
  'You know what’s there.', 'HomeSignal shows you what’s changing.',
  'Start with 20 Development Activity reports free. No credit card required.',
  'Development activity within 0.5 miles of this property', 'Only tracked development/project activity is shown.',
  'Development Activity Map', 'Recent Official Activity'
];
const plain = text.replace(/\s*\/\s*month/, '/month');
const missing = COPY.filter((c) => !text.includes(c) && !plain.includes(c));
ok(missing.length === 0, 'every approved sentence, heading, CTA and price string is present verbatim', missing);
const H1 = (markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/g) || []);
ok(H1.length === 1, 'exactly one h1', H1.length);
ok(/<a class="da-link" href="contact\.html"[^>]*>Contact us for Enterprise Pricing →<\/a>/.test(src), 'the Enterprise Pricing CTA is a real link to the existing contact page');

console.log('--- 2b. the prohibitions ---');
const FORBIDDEN = [
  ['What Exists Today', /what exists today/i],
  ['a "What Changed" claim (change-readiness is not proven; the sample uses Recent Official Activity)', /what changed/i],
  ['Neighborhood Map', /neighbou?rhood map/i],
  ['Nearby Places', /nearby places/i],
  ['What’s Around This Property', /what[’']s around this property/i],
  ['Surroundings Map', /surroundings map/i],
  ['a radius choice (1, 2 or 5 mile)', /(?<![\d.])(1|2|5)[ -]?(mi|mile|miles)\b/i],
  ['an input/select radius control', /<select\b|type="range"|name="radius"|id="radius/i],
  ['prediction language', /apprecia|property value|home value|traffic|desirab|school quality|impact score|will (increase|decrease|rise|fall)/i],
  ['"permanent" pricing language', /permanent|standard price|list price/i],
  ['extra pricing mechanisms', /\boverage\b|token pack|per[- ]report|per[- ]seat|seat charge|pro plan|team plan|starter/i],
  ['"real-time"/"continuous" freshness claims', /real[- ]?time|continuous(ly)?/i],
  ['a "Regulatory" Development Type', /regulat/i],
  ['"supported ZIP" phrasing', /supported ZIP/i]
];
FORBIDDEN.forEach(([label, re]) => ok(!re.test(text), 'the page does not contain ' + label, (text.match(re) || [])[0]));
ok((noComments.match(/12,722/g) || []).length >= 2 && !/12,722\s+supported/i.test(noComments), '12,722 is always the product NETWORK of canonical ZIPs, never "supported"');

console.log('--- 3. no second visual language ---');
const hexes = [...new Set(noComments.match(/#[0-9a-fA-F]{3,6}\b/g) || [])].filter((h) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h));
const newColours = hexes.filter((h) => !css.toLowerCase().includes(h.toLowerCase()));
ok(hexes.length > 0 && newColours.length === 0, 'every colour literal already exists in app.css', newColours);
const tokensUsed = [...new Set([...noComments.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))];
const tokensMissing = tokensUsed.filter((t) => !new RegExp(t + '\\s*:').test(css));
ok(tokensUsed.length > 5 && tokensMissing.length === 0, 'every var(--token) it uses is defined in app.css', tokensMissing);
ok(!/font-family\s*:\s*(?!inherit|var\()/.test(cssBlock), 'declares no font of its own (inherits the HomeSignal stack)');
ok(!/@import|@font-face/.test(cssBlock), 'loads no web font or external stylesheet');

console.log('--- 4. nothing promises what does not exist ---');
const stage = read('scripts/stage_site.py');
const sitemap = read('scripts/gen_sitemap.py');
const shipped = stage.includes("'" + PAGE + "'");
const inSitemap = sitemap.includes('/' + PAGE);
const noindex = /<meta name="robots" content="noindex, nofollow">/.test(src);
const cta = [...markup.matchAll(/<button[^>]*data-cta="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map((m) => ({ cta: m[1], label: m[2], tag: m[0] }));
ok(cta.length === 4 && cta.filter((c) => c.cta === 'start-free').length === 3 && cta.filter((c) => c.cta === 'join').length === 1,
  'the hero, pricing and closing "Start with 20 free reports" plus the "Join for $79/month" button are all present', cta.map((c) => c.cta));
ok(cta.every((c) => /aria-disabled="true"/.test(c.tag) && !/\shref=|onclick=|type="submit"/.test(c.tag)),
  'each commerce button is inert (aria-disabled, no href, no handler): the 20-report entitlement and the $79 checkout do not exist yet', cta.map((c) => c.tag));
const scriptCode = (noComments.match(/<script>[\s\S]*?<\/script>/g) || []).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(!/href="[^"]*(checkout|lemonsqueezy|stripe|billing|subscribe)/i.test(markup) && !/lemonsqueezy|stripe|checkout/i.test(scriptCode),
  'the page links to no checkout or payment processor and its code calls none');
ok(!/HS\.requireAuth|HS\.openAuth|signin=1/.test(noComments), 'the inert buttons are not wired to sign-in, which would imply an entitlement that is not there');
const inert = cta.some((c) => /aria-disabled="true"/.test(c.tag));
const otherSources = ['index.html', 'about.html', 'contact.html', 'how-it-works.html', 'privacy.html', 'terms.html', 'dashboard.html', 'alerts.html',
  'development.html', 'properties.html', 'property.html', 'reports.html', 'community.html', 'homesignalmap.html', 'partials/shell.html', 'shell.js',
  'sitemap.xml', 'scripts/gen_zip_pages.py', 'lib/community-page.js'];
const linkedFrom = otherSources.filter((f) => { try { return read(f).includes(PAGE); } catch (e) { return false; } });
ok(shipped, 'DEPLOYED (founder, 2026-09-29): the page is in the scripts/stage_site.py allowlist, so it publishes');
ok(noindex, 'the page is noindex (dark: reachable by URL, not discoverable by search)');
ok(!(inert && !noindex), 'TRIPWIRE: a page with inert commerce buttons must stay noindex');
ok(!(inSitemap && (noindex || inert)), 'TRIPWIRE: the page enters the sitemap only when it is indexable and its commerce buttons are live', { inSitemap, noindex, inert });
ok(!(inert && linkedFrom.length), 'TRIPWIRE: nothing in the site links to the page while its commerce buttons are inert', linkedFrom);
ok(!inSitemap && linkedFrom.length === 0, 'DEPLOYED DARK: not in the sitemap and linked from no shipped page or script', { inSitemap, linkedFrom });
ok(!/HS\.data\.(projects|facilities)|from\('app_projects'\)|rpc\(/.test(noComments), 'the sample reads no production project data: it is labelled illustrative and shows no real record');
ok(/Sample Development Activity report\. The property, projects, distances and dates below are illustrative entries, not records for a real address\./.test(text), 'the sample is labelled illustrative in plain words');

console.log('--- 5. Type and Stage are two fields, and the coverage check reuses existing authorities ---');
const script = (noComments.match(/<script>\s*\/\*\s*Development Activity landing page[\s\S]*?<\/script>/) || [''])[0];
ok(script.length > 1000, 'the page script was found');
ok(/HS\.data\.isCovered\(/.test(script), 'coverage check uses HS.data.isCovered, the existing authority the shell uses for "Add a zip code"');
ok(/functions\.invoke\('geocode-address'/.test(script), 'an address is resolved through the existing geocode-address edge function');
ok(!/12722|zipList|const ZIPS|ZIPS\s*=/.test(script), 'no hard-coded ZIP list: coverage is read, not restated');
ok(!/REPORT-READY|CHANGE-READY|LIMITED COVERAGE/.test(script.replace(/does not determine report-ready or change-ready status/, '')),
  'the check never assigns Report-Ready / Change-Ready / Limited Coverage (that preflight does not exist yet)');
const TYPE_LABELS = ['Residential', 'Commercial', 'Industrial', 'Data Center', 'Roads & Infrastructure', 'Civic & Public'];
ok(TYPE_LABELS.every((l) => script.includes("label: '" + l + "'")), 'the Type filter carries the six canonical Types, in the approved order');
ok(/key: 'other', label: 'Other Project'/.test(script) && /count\(function \(i\) \{ return i\.type === 'other'; \}\)/.test(script),
  'Other Project is the fallback Type and only renders when an entry carries it');
ok(['Approved / Coming', 'Proposed / Under Review', 'Permitted / Under Construction'].every((l) => script.includes("label: '" + l + "'")), 'the three approved Stage sections');
ok(!/lifecycle|LIFECYCLE|under_construction|permitted:|'operating'|'unknown'/.test(script.replace(/stage: 'permitted'/g, '').replace(/key: 'permitted'/g, '')
   .replace(/Stage labels are display\s+groupings only and create no lifecycle value/, '')),
  'Stage is a display grouping only: no lifecycle key is created (founder ruling R2)');
ok(/type: '[a-z]+',\s+stage: '[a-z]+'/.test(script) && (script.match(/stage: '/g) || []).length >= 9, 'every sample entry carries Type and Stage as separate fields');

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL PASS');
process.exit(fails ? 1 : 0);
