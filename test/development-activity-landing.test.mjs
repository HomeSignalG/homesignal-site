// DEVELOPMENT ACTIVITY LANDING PAGE — structural pins (offline, no browser).
// Run: node test/development-activity-landing.test.mjs
//
// What this guards, in the order the founder's brief states it:
//   1. THE SHELL IS THE SHARED SHELL. The page is a <template id="hs-content"> plus the exact
//      script/CSS/CSP set every other public page carries. It brings no navigation, logo,
//      Sign In, footer or stylesheet of its own, so the "byte-identical menu" rule cannot be
//      broken from this file.
//   2. THE COPY IS THE 100726 REVISION PLAN'S (it supersedes the 100126 copy), and the $79 is the existing price, verbatim, and the plan's prohibitions hold: no
//      What Exists Today, no radius choices, no photographs, no forbidden map names, no
//      prediction language, no extra pricing mechanisms.
//   3. NO SECOND VISUAL LANGUAGE. Every colour literal in the page already exists in app.css and
//      every var(--token) it names is defined there.
//   4. NOTHING PROMISES WHAT DOES NOT EXIST. The free-evaluation and $79 checkout buttons are
//      inert until entitlement and checkout ship (plan sections 18 and 25). The page IS deployed
//      (founder, 2026-09-29). The founder's navigation plan v3 (2026-09-30) made it VISIBLE as
//      the shell's "Enterprise" item and nothing more: it is linked exactly once, from
//      partials/shell.html, and nothing else links it. The founder then ruled (2026-10-02,
//      "list it sooner, without checkout") that the page is INDEXED and in the SITEMAP now,
//      with its inert buttons HIDDEN (each inside a <div data-commerce hidden>) and the
//      Enterprise contact link as its working action (now "Contact HomeSignal →" in the Brokerage / Enterprise tier). So the rule this file
//      enforces is: an inert button may never be VISIBLE on an indexable or listed page.
//      Un-hiding a button before it works, while the page is indexed, fails this file.
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
ok(/<body data-nav="enterprise"( data-enterprise="overview")?>/.test(src), 'v3 declares the Enterprise identity, so its sidebar item lights here');
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

console.log('--- 2. the 100726 revision copy and the existing price ---');
const COPY = [
  'HomeSignal Development Activity',
  'See what’s being proposed, approved, and built around a property — before it surprises your client.',
  'HomeSignal gives real-estate professionals a sourced view of Development Activity around a property, organized by Type and Stage.',
  'You know what’s there. HomeSignal shows you what’s changing.',
  'Start free — 10 reports', 'View a sample report →',
  'Every project is organized by Type and Stage so you can quickly see what it is and where it stands.',
  'Walk into the conversation knowing more.',
  'Before a buyer tour', 'See nearby Development Activity the client may ask about before arriving at the property.',
  'Before a listing presentation', 'Know what is proposed, approved, or actively changing nearby before prospective buyers raise the question.',
  'When a client asks, “What are they building over there?”', 'Show the project, Type, Stage, distance, and source instead of relying on rumor.',
  'Don’t give your client a rumor. Show them the record.',
  'HomeSignal summarizes selected official public records from its covered sources and may not include every project or change.',
  'Clear enough for your client. Sourced enough for you.',
  'Not school scores, restaurant lists, or generic neighborhood data. HomeSignal focuses on development activity that can change what surrounds the property.',
  'Check Development Activity coverage', 'Enter property address or ZIP', 'Check coverage',
  'HomeSignal’s Development Activity product is built across a national network of 12,722 canonical ZIP codes. Source depth and report readiness vary by property.',
  'Simple, transparent pricing', 'Free', '10 Development Activity reports free', 'No credit card required.',
  'Individual accounts receive 10 individual evaluation reports. Brokerage evaluation accounts share 10 reports across their invited evaluation users.',
  'Professional', '$79', '/month', '100 new Development Activity reports each month',
  'Reopen existing reports without using another report.', 'Share existing reports with clients.',
  'Download or print existing reports.', 'Cancel anytime.', 'Join for $79/month',
  'Professional — Individual Agents', 'Start with 10 free reports.', 'Brokerage & Enterprise', 'Custom Pricing', 'HomeSignal offers tailored solutions for real estate brokerages, teams, and enterprise organizations.', 'Contact us to discuss your number of agents, anticipated report volume, and business requirements.', 'Request a Custom Quote',
  'Know what’s changing before your client asks.',
  'Run Development Activity reports for the properties you’re working on now.',
  'Brokerage or enterprise? Contact us',
  'Development activity within 0.5 miles of this property', 'Only tracked development/project activity is shown.',
  'Development Activity Map', 'Recent Official Activity'
];
const plain = text.replace(/\s*\/\s*month/, '/month');
const missing = COPY.filter((c) => !text.includes(c) && !plain.includes(c));
ok(missing.length === 0, 'every approved sentence, heading, CTA and price string is present verbatim', missing);
const H1 = (markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>/g) || []);
ok(H1.length === 1, 'exactly one h1', H1.length);
ok(/<a class="mbtn" href="contact\.html" id="daEnterprise">Request a Custom Quote<\/a>/.test(src) && /<a class="da-link" href="contact\.html" id="daEnterpriseFinal">Contact us<\/a>/.test(src),
  'the Brokerage / Enterprise tier and the closing secondary path are both real links to the existing contact page');

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

console.log('--- 2c. information architecture (100726 revision plan) ---');
// Order is asserted on the rendered markup, not on comments: hero → sample → use cases → trust → coverage → pricing → final.
const at = (re) => { const m = re.exec(markup); return m ? m.index : -1; };
const ORDER = [
  ['hero', /id="hero"/], ['pricing', /id="pricing"/], ['sample', /id="sample"/], ['transaction moments', /Walk into the conversation knowing more\./],
  ['trust', /Don’t give your client a rumor\. Show them the record\./], ['coverage', /id="coverage"/],
  ['final conversion', /Know what’s changing before your client asks\./]
].map(([k, re]) => [k, at(re)]);
ok(ORDER.every(([, i], n) => i > -1 && (n === 0 || i > ORDER[n - 1][1])),
  'hero → pricing → sample → use cases → trust → coverage → final conversion (founder, 2026-10-06: pricing before the sample; coverage still sits after the proof)', ORDER);
ok(at(/id="daReport"/) > -1 && (markup.match(/id="daReport"/g) || []).length === 1, 'exactly one interactive sample report exists (it was moved, not rebuilt)');
// Regression: the sections this revision removed or merged must not quietly return.
const REMOVED = [
  ['the long Type/Stage tutorial section', /See development before it becomes obvious/i],
  ['the duplicated "Scan by Type. Understand the Stage." teaching line', /Scan by Type\. Understand the Stage\./],
  ['the "Type — what kind of development is it?" definition list outside the sample', /<h3[^>]*>\s*Type — what kind/i],
  ['the Stage definition list outside the sample', /<dt>\s*Approved \/ Coming/i],
  ['"Keep Watching" (it implies monitoring that the launch entitlement does not promise)', /keep watching/i],
  ['"Things to Review With Your Client" as a landing-page section', /things to review with your client/i],
  ['the standalone MLS differentiation section', /Your MLS tells you about the property/i],
  ['the standalone "Not another neighborhood report" section', /Not another neighborhood report/i],
  ['the generic persona buckets (For buyers / For listings / For agents)', /For buyers|For listings|For agents/],
  ['the old "Built for the client conversation" heading', /Built for the client conversation/i],
  ['a second Check coverage action beside the one coverage section', /Check coverage →/],
  ['the "New Member Price" label (the offer is Free / Professional / Brokerage-Enterprise)', /New Member Price/],
  ['an invented replacement price, crossed-out price, or urgency', /\$129|normally \$|<s>|<del>|limited time|only \d+ (spots|left)|ends (soon|today)/i]
];
REMOVED.forEach(([label, re]) => ok(!re.test(text), 'the page does not bring back ' + label, (text.match(re) || [])[0]));
ok((text.match(/\$\d+/g) || []).every((p) => p === '$79') && (text.match(/\$\d+/g) || []).length >= 2, 'the only price on the page is the existing $79/month; no replacement price was invented', text.match(/\$\d+/g));
ok(/<h3[^>]*>Before a buyer tour<\/h3>/.test(markup) && /<h3[^>]*>Before a listing presentation<\/h3>/.test(markup), 'use cases are concrete transaction moments');
ok(['Free', 'Professional — Individual Agents', 'Brokerage &amp; Enterprise'].every((b) => new RegExp('<p class="da-band">' + b + '</p>').test(markup)), 'the pricing hierarchy is Free / Professional / Brokerage / Enterprise');
const coverageAt = at(/id="coverage"/), pricingAt = at(/id="pricing"/);
const finalAt = at(/class="da-final"/);
ok((markup.slice(coverageAt, finalAt).match(/id="daCoverBtn"/g) || []).length === 1 && (markup.match(/id="daCoverBtn"/g) || []).length === 1, 'the coverage checker exists once, inside the coverage section');
ok(!/href="#coverage"/.test(markup), 'nothing links to the coverage section from the hero or the close: it is an availability utility, not a call to action');
ok(/href="#sample"/.test(markup) && /id="sample"/.test(markup), 'the hero\'s sample link has a real target');
const bodyWords = text.replace(/\s+/g, ' ').split(' ').length;
console.log('           (visible words on the page: ' + bodyWords + ')');

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
ok(cta.length === 3 && cta.every((c) => c.cta === 'start-free'),
  'the hero, pricing and closing "Start free — 10 reports" buttons are present (Join for $79/month is a link now, checked below)', cta.map((c) => c.cta));
// Founder, 2026-10-06: "Join for $79/month" is a REAL link, not an inert button. It goes to the Reports page's Billing card, where an existing brokerage
// owner signs in and presses Subscribe; the signed checkout is made by manage-billing. It must stay a plain internal link: no processor address, no
// handler, no checkout made from this page.
const joins = [...markup.matchAll(/<a\b[^>]*data-cta="join"[^>]*>([^<]*)<\/a>/g)].map((m) => ({ tag: m[0], label: m[1] }));
ok(joins.length === 1 && joins[0].label === 'Join for $79/month' && /\shref="development-activity-reports\.html#billing"/.test(joins[0].tag) && !/aria-disabled|onclick=/.test(joins[0].tag),
  'Join for $79/month is one live link to the Reports page Billing card (development-activity-reports.html#billing)', joins);
ok(/Individual real estate agents can subscribe\./.test(text) && !/Subscribing is for brokerage owners/.test(text), 'the Join link says plainly that individual agents can subscribe, and no longer says only brokerage owners can');
ok(cta.every((c) => /aria-disabled="true"/.test(c.tag) && !/\shref=|onclick=|type="submit"/.test(c.tag)),
  'each commerce button is inert (aria-disabled, no href, no handler): the 10-report entitlement and the $79 checkout do not exist yet', cta.map((c) => c.tag));
const scriptCode = (noComments.match(/<script>[\s\S]*?<\/script>/g) || []).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const hrefs = [...markup.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]);
ok(!hrefs.some((h) => /checkout|lemonsqueezy|stripe|subscribe/i.test(h)) && hrefs.filter((h) => /billing/i.test(h)).every((h) => h === 'development-activity-reports.html#billing') && !/lemonsqueezy|stripe|checkout/i.test(scriptCode),
  'the page links to no checkout or payment processor (its only billing link is the internal Reports-page Billing card) and its code calls none', hrefs.filter((h) => /checkout|lemonsqueezy|stripe|subscribe|billing/i.test(h)));
ok(!/HS\.requireAuth|HS\.openAuth|signin=1/.test(noComments), 'the inert buttons are not wired to sign-in, which would imply an entitlement that is not there');
const inert = cta.some((c) => /aria-disabled="true"/.test(c.tag));
// sitemap.xml is not a link a visitor follows: it is judged by the sitemap tripwire below.
const otherSources = ['index.html', 'about.html', 'contact.html', 'how-it-works.html', 'privacy.html', 'terms.html', 'dashboard.html', 'alerts.html',
  'development.html', 'properties.html', 'property.html', 'reports.html', 'community.html', 'homesignalmap.html', 'partials/shell.html', 'shell.js',
  'scripts/gen_zip_pages.py', 'lib/community-page.js'];
const linkedFrom = otherSources.filter((f) => { try { return read(f).includes(PAGE); } catch (e) { return false; } });
ok(shipped, 'DEPLOYED (founder, 2026-09-29): the page is in the scripts/stage_site.py allowlist, so it publishes');
// Founder, 2026-10-02: listed now, with the inert buttons hidden. Each commerce button sits,
// with its "Opens at launch." note, inside its own <div data-commerce hidden>, and nothing else does.
const wrappers = [...markup.matchAll(/<div data-commerce( hidden)?>\s*(<button[^>]*data-cta="[^"]+"[^>]*>[^<]*<\/button>)\s*<span class="da-soon">Opens at launch\.<\/span>\s*<\/div>/g)]
  .map((m) => ({ hidden: !!m[1], tag: m[2] }));
// Counted, not matched by tag: three buttons share one tag, so a tag match would let an unhidden
// "Start free — 10 reports" borrow a hidden sibling's wrapper.
const isInert = (tag) => /aria-disabled="true"/.test(tag);
const visibleInert = cta.filter((c) => isInert(c.tag)).length > wrappers.filter((w) => w.hidden && isInert(w.tag)).length;
ok(wrappers.length === 3 && (markup.match(/data-commerce/g) || []).length === 3 && wrappers.every((w) => cta.some((c) => c.tag === w.tag)),
  'each of the three inert Start free buttons sits, with its "Opens at launch." note, in its own <div data-commerce>', wrappers);
ok(wrappers.every((w) => w.hidden) && !visibleInert, 'HIDDEN (founder, 2026-10-02): every inert commerce button is inside a hidden wrapper', wrappers);
ok(/\[hidden\]\{display:none!important\}/.test(cssBlock), 'the page CSS makes [hidden] win over any display rule, so a hidden wrapper cannot reappear');
const indexable = /<meta name="robots" content="index, follow">/.test(src) && !/noindex/i.test(noComments);
ok(indexable && !noindex, 'LISTED (founder, 2026-10-02): the page is index, follow, like about.html and contact.html');
ok(!(visibleInert && !noindex), 'TRIPWIRE: a page that shows an inert commerce button must stay noindex', { visibleInert, noindex });
ok(!(inSitemap && (noindex || visibleInert)), 'TRIPWIRE: the page is in the sitemap only while it is indexable and shows no inert commerce button', { inSitemap, noindex, visibleInert });
const committedMap = read('sitemap.xml');
ok(!committedMap.includes(PAGE) || (inSitemap && indexable && !visibleInert),
  'TRIPWIRE: the committed sitemap.xml lists the page only when the generator does and the page may be listed');
// v3 (founder navigation plan, 2026-09-30): the shell's Enterprise item is the ONE link to this
// page. Any other link while the buttons are inert is a second, unreviewed entry point, and an
// Enterprise item that drifted to another href would silently stop pointing here.
const shellSrc = read('partials/shell.html');
const shellLinks = shellSrc.match(/<a\s+href="development-activity\.html"[^>]*>/g) || [];
// The Revised Index Design (founder, 2026-09-30) adds exactly ONE more reviewed entry point,
// for the state #1555 created (page listed, commerce hidden): the homepage's upper-right
// Enterprise card, whose "Explore Enterprise →" links here. There is no bottom banner, so the
// homepage links the page exactly once. Any further link is still an unreviewed entry point.
ok(JSON.stringify(linkedFrom) === JSON.stringify(['index.html', 'partials/shell.html']),
  'TRIPWIRE: while its commerce buttons are inert, the ONLY things that link the page are the shell\'s Enterprise item and the homepage\'s Enterprise card', linkedFrom);
const homeSrc = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
const homeLinks = homeSrc.match(/<a\b[^>]*href="development-activity\.html"[^>]*>[\s\S]*?<\/a>/g) || [];
ok(homeLinks.length === 1 && /id="homeEnterpriseCta"/.test(homeLinks[0]) && />Explore Enterprise →<\/a>$/.test(homeLinks[0]),
  'the homepage links it exactly once: the Enterprise card\'s "Explore Enterprise →" (no bottom banner)', homeLinks);
// The Enterprise dropdown (founder, 2026-10-05) adds one more link to it, the "Enterprise overview" entry.
const shellPrimary = shellLinks.filter((l) => /data-nav="enterprise"/.test(l));
const shellSub = shellLinks.filter((l) => /data-sub="overview"/.test(l));
ok(shellLinks.length === 2 && shellPrimary.length === 1 && shellSub.length === 1
   && /<a\s+href="development-activity\.html"[^>]*>[\s\S]{0,80}?Enterprise<\/a>/.test(shellSrc),
  'v3 the shell links it twice: the "Enterprise" primary item and the dropdown\'s "Enterprise overview"', shellLinks);
ok(inSitemap, 'LISTED: the page is in the sitemap generator\'s static list (scripts/gen_sitemap.py STATIC)', { inSitemap });
ok(!/data-commerce[^>]*>[\s\S]*?id="daEnterprise"[\s\S]*?<\/div>/.test(markup.replace(/<div data-commerce[^>]*>[\s\S]*?<\/span>\s*<\/div>/g, '')),
  'the working action, Contact HomeSignal, is not inside a commerce wrapper (the browser test checks it is visible)');
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
