// THE REVISED HOMEPAGE AND THE HORIZONTAL HEADER — structural pins (offline, no browser).
// Run: node test/home-index.test.mjs
//
// The founder's Revised Index Design (Final Claude-Ready, 2026-09-30). What this file guards,
// each item the kind of thing a later session could undo in good faith:
//   1. ONE MAP. The homepage map is Map 1 itself in an iframe (homesignalmap.html?embed=1),
//      never an image, and index.html carries no map, marker, filter or classifier code.
//   2. The sample is the dedicated preview shape, lazy, out of the tab order, pointer-locked,
//      and never given a fixed height; preview=1 is layout-only and scoped to .hs-embed.hs-preview.
//   3. A search hands off to the Development Map (founder, 2026-10-04): a ZIP goes to
//      homesignalmap.html?zip=, an address is handed over once in sessionStorage and never put
//      in a URL. No follow / save / subscribe, no history change, no HS.data.isCovered gate.
//   4. ONE ADDRESS RESOLVER: shell.js calls geocode-address exactly once, inside
//      HS.resolveAddress, and HS.findHome and saveOnboardingAddress use it. (The homepage no
//      longer geocodes: Map 1's own address search does.)
//   5. The shared header is Explore | My Places | Enterprise | Share | Sign in-or-account; the
//      old sidebar and top-bar utilities are gone from the chrome while their functions stay;
//      ONE shared footer; both hidden in Map 1's embed mode.
//   6. Type and lifecycle labels come from lib/project-type.js, loaded before the page script.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 400)); }
};
const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const stripJsComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1');

const idx = read('index.html');
const idxNoComments = stripHtmlComments(idx);
const tpl = (idxNoComments.match(/<template id="hs-content">([\s\S]*?)<\/template>/) || ['', ''])[1];
const pageScript = stripJsComments((idx.match(/<script>\s*\(function \(\) \{[\s\S]*?<\/script>/) || [''])[0]);
const shellHtml = read('partials/shell.html');
const shellNoComments = stripHtmlComments(shellHtml);
const shellJs = read('shell.js');
const shellCode = stripJsComments(shellJs);
const css = read('app.css');
const map1 = read('homesignalmap.html');

console.log('--- 1. one map, and it is Map 1 ---');
const iframes = tpl.match(/<iframe[\s\S]*?<\/iframe>/g) || [];
ok(iframes.length === 1, 'the homepage has exactly one iframe', iframes.length);
const frame = iframes[0] || '';
ok(/src="homesignalmap\.html\?embed=1&amp;preview=1&amp;zip=78657"/.test(frame), 'its initial src is exactly homesignalmap.html?embed=1&preview=1&zip=78657');
ok(/title="Sample HomeSignal development map"/.test(frame) && /loading="lazy"/.test(frame) && /tabindex="-1"/.test(frame),
  'title, loading="lazy" and tabindex="-1" are as specified');
ok(!/\sheight=|style="[^"]*height/.test(frame), 'the sample iframe carries no fixed height');
ok(/class="home-index__map-preview is-sample"/.test(tpl), 'its wrapper starts in the sample state');
ok(/\.home-index__map-preview\.is-sample iframe\{pointer-events:none\}/.test(css), 'the sample wrapper turns pointer interaction off');
const imgs = tpl.match(/<img\b[^>]*>/g) || [];
ok(imgs.length === 1 && /src="assets\/home-development-activity-report-preview\.webp"/.test(imgs[0]),
  'the only image is the approved report preview', imgs);
ok(/alt="Sample HomeSignal Development Activity report pages"/.test(imgs[0] || '') && /width="1448"/.test(imgs[0] || '')
   && /height="1086"/.test(imgs[0] || '') && /decoding="async"/.test(imgs[0] || ''),
  'the report image has the specified alt, width, height and decoding');
ok(/\.webp/.test(read('scripts/stage_site.py')), 'the production artifact ships .webp assets');
ok(!/\.(png|webp|jpe?g)/i.test(pageScript), 'the page script references no image (no map screenshot)');
ok(!/leaflet|maplibre|L\.map\(|new THREE|classifyProjectType|resolveMarker|setCategoryFilter|mapkey|STATUS_TIERS/i.test(pageScript),
  'index.html runs no map, marker, filter or classifier code of its own');
ok(!/leaflet|maplibre|three\.js/i.test(idxNoComments.replace(/[\s\S]*<\/template>/, '').match(/<script src="[^"]+"/g)?.join(' ') || ''),
  'index.html loads no map library');

console.log('--- 2. preview=1 is layout only, scoped, and auto-sized by the host ---');
ok(/if \(q\.get\("embed"\) === "1"\) \{[\s\S]{0,300}if \(q\.get\("preview"\) === "1"\) document\.documentElement\.classList\.add\("hs-preview"\);/.test(map1),
  'Map 1 sets hs-preview only inside the embed=1 branch');
const previewRules = (map1.match(/\/\* =+ PREVIEW \(\?embed=1&preview=1\)[\s\S]*?(?=\n\n|<\/style>)/) || [''])[0];
const selectors = (previewRules.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{/g) || []).map((x) => x.replace('{', '').trim());
ok(selectors.length >= 5 && selectors.every((sel) => sel.split(',').every((part) => /^\.hs-embed\.hs-preview\b/.test(part.trim()))),
  'every preview rule is scoped to .hs-embed.hs-preview', selectors);
ok(!/display:none/.test(previewRules.replace(/\/\*[\s\S]*?\*\//g, '')), 'the preview hides nothing');
ok(/\.hs-embed\.hs-preview \.maprow\{max-height:none;overflow:visible\}/.test(map1), 'the filter panel has no internal scroll in the preview');
ok(/\.hs-embed\.hs-preview \.map-frame\{height:var\(--hs-preview-map-h,430px\)/.test(map1), 'the preview canvas height is the host-set variable, default 430px');
ok(/return w >= 1024 \? 430 : \(w >= 768 \? 400 : 340\);/.test(pageScript), 'the host sets the canvas to 430 / 400 / 340 px by its own breakpoint');
ok(/sampleObserver = new RO\(/.test(pageScript) && /sampleObserver\.observe\(d\.documentElement\)/.test(pageScript),
  'one ResizeObserver watches the preview document');
ok(/f\.style\.height = Math\.ceil\(d\.documentElement\.scrollHeight\) \+ 'px';/.test(pageScript), 'the iframe height is the preview document\'s scrollHeight');
ok(/\.home-index__map-frame\{display:block;width:100%;border:0;height:760px\}/.test(css)
   && /@media \(max-width:1023px\)\{[\s\S]*?\.home-index__map-frame\{height:700px\}/.test(css)
   && /@media \(max-width:767px\)\{[\s\S]*?\.home-index__map-frame\{height:660px\}/.test(css),
  'the live map is 760 / 700 / 660 px by breakpoint');

console.log('--- 3. a search hands off to the Development Map (founder, 2026-10-04) ---');
ok(!/lib\/landing\.js/.test(idx) && !/HS\.landingFor/.test(idxNoComments), 'index.html no longer loads lib/landing.js or calls HS.landingFor');
// The ONLY navigations the page script makes are to Map 1, and only from the submit handler.
const navs = pageScript.match(/location\.(replace|assign)\([^)]*\)|location\.href\s*=[^;]*/g) || [];
ok(navs.length === 2 && navs.every((n) => /homesignalmap\.html/.test(n)), 'the page script navigates only to homesignalmap.html', navs.join(' | '));
ok(/location\.assign\('homesignalmap\.html\?zip=' \+ q\)/.test(pageScript), 'a 5-digit ZIP goes to homesignalmap.html?zip=<zip>');
ok(/location\.assign\('homesignalmap\.html'\)/.test(pageScript) && /sessionStorage\.setItem\(HANDOFF_KEY, q\)/.test(pageScript),
  'an address goes to homesignalmap.html with the text handed over once in sessionStorage');
const urls = (pageScript.match(/'homesignalmap\.html[^']*'/g) || []).join(' ');
ok(!/addr|address|lat=|lng=/i.test(urls), 'no address or coordinate is ever placed in a URL', urls);
ok(/HANDOFF_KEY = 'hs\.homeSearchAddress'/.test(pageScript) && /sessionStorage\.getItem\("hs\.homeSearchAddress"\)/.test(read('homesignalmap.html'))
   && /sessionStorage\.removeItem\("hs\.homeSearchAddress"\)/.test(read('homesignalmap.html')),
  'Map 1 reads the same key and removes it in the same step');
ok(!/history\.(pushState|replaceState)|location\.hash\s*=/.test(pageScript), 'no search touches browser history');
ok(!/HS\.data\.isCovered|HS\.findCommunity|HS\.openLoc|openModal|followCommunity|ensureAreaSubscribed|app_follows|app_properties|\.insert\(|saveHome|LS\.set|localStorage/.test(pageScript),
  'no search follows, saves, subscribes, opens the coverage form or writes persistent storage');
const controls = (tpl.match(/<(a|button)\b[\s\S]*?<\/\1>/g) || []).join(' ');
ok(controls.length > 200 && !/Follow|Get alerts|alerts\.html/i.test(controls), 'no Follow or Get alerts control on the homepage');
ok(!/HS\.resolveAddress|functions\.invoke|goLive|searchZip|searchAddress/.test(pageScript), 'the homepage no longer geocodes or renders results itself; Map 1 does');
ok(/HS\.data\.projects\(zip, null\)/.test(pageScript) && /projects\.complete !== true/.test(pageScript)
   && /projects\.slice\(0, 3\)/.test(pageScript), 'the sample list is HS.data.projects(zip, null), first three, only when complete');
ok(/scroll-margin-top:88px/.test(css), '#homeExploreResults keeps clear of the sticky header');

console.log('--- 4. one address resolver ---');
const invokes = shellJs.match(/functions\.invoke\('geocode-address'/g) || [];
ok(invokes.length === 1, 'shell.js calls geocode-address exactly once', invokes.length);
const resolver = (shellJs.match(/HS\.resolveAddress = async function \(address\) \{[\s\S]*?\n  \};/) || [''])[0];
ok(/functions\.invoke\('geocode-address'/.test(resolver), '...inside HS.resolveAddress');
ok(shellJs.includes(`unavailable: "The address service couldn't be reached — please try again in a minute."`)
   && shellJs.includes(`no_match: "We couldn't confirm that address against U.S. Census records — try a different spelling, or add the city or ZIP."`)
   && shellJs.includes(`invalid_coords: "We couldn't confirm a valid location for that address — try again or enter your ZIP code instead."`),
  'the three failure messages are the spec\'s, verbatim');
ok(/return \{\s*ok: true,\s*match: \{\s*matchedAddress: [^,]+, lat: m\.lat, lng: m\.lng, zip: zip,\s*city: [^,]+, state: [^}]+\}/.test(resolver),
  'success returns { ok: true, match: { matchedAddress, lat, lng, zip, city, state } }');
const findHome = (shellJs.match(/HS\.findHome = async function \(\) \{[\s\S]*?\n  \};/) || [''])[0];
const onb = (shellJs.match(/async function saveOnboardingAddress\(addr\) \{[\s\S]*?\n  \}\n/) || [''])[0];
ok(/await HS\.resolveAddress\(q\)/.test(findHome), 'HS.findHome uses it');
ok(/await HS\.resolveAddress\(addr\)/.test(onb), 'saveOnboardingAddress uses it');

console.log('--- 5. the shared header and footer ---');
const header = (shellNoComments.match(/<header class="hs-header" id="hs-top">[\s\S]*?<\/header>/) || [''])[0];
ok(header.length > 0, 'the shared header is present');
const navLinks = [...(header.match(/<nav class="hs-nav"[\s\S]*?<\/nav>/) || [''])[0].matchAll(/<a href="([^"]+)" data-nav="([^"]+)">([^<]+)<\/a>/g)]
  .map((m) => m[3] + '=' + m[1]);
ok(JSON.stringify(navLinks) === JSON.stringify(['Explore=index.html', 'My Places=properties.html', 'Enterprise=development-activity.html']),
  'the primary nav is exactly Explore, My Places, Enterprise', navLinks);
ok(/<a class="hs-brand" href="index\.html">/.test(header), 'the logo returns to index.html');
ok(/id="hs-share" onclick="HS\.openModal\('shareModal'\)">Share</.test(header), 'Share opens the existing share modal');
ok(/id="hs-signin"[^>]*onclick="HS\.openAuth\(\)">Sign in</.test(header) && /id="hs-avatar"[^>]*onclick="HS\.onAvatar\(\)"/.test(header),
  'Sign in uses the existing auth; the avatar keeps its existing behaviour');
ok(/id="hs-menubtn" aria-label="Menu" aria-expanded="false" aria-controls="hs-nav"/.test(header), 'one Menu button controls the nav');
ok((shellNoComments.match(/<nav class="hs-nav"/g) || []).length === 1, 'one nav element serves both widths (no second copy of the links)');
ok(!/Dashboard|Alerts|Development<|About|Sign up|search/i.test(header.replace(/HomeSignal/g, '')), 'no Dashboard, Alerts, Development, About, search or Sign up item in the header');
ok(!/id="hs-side"|class="side"|id="locLabel"|id="hsAddAddress"|id="hsAddZip"|aria-label="Notifications"|class="upsell"|id="sidebackdrop"/.test(shellNoComments),
  'the sidebar, Viewing chip, Place adds, bell and upsell are gone from the chrome');
ok(/HS\.openSwitcher = function/.test(shellJs) && /HS\.addHome = function/.test(shellJs) && /HS\.openLoc = function/.test(shellJs)
   && /HS\.setViewLabel = function/.test(shellJs) && /HS\.viewingLabel = function/.test(shellJs) && /id="switcherModal"/.test(shellHtml)
   && /id="premiumModal"/.test(shellHtml),
  'their functions, the place-context state and their modals are kept');
const footers = shellNoComments.match(/<footer class="hs-footer" id="hs-footer">[\s\S]*?<\/footer>/g) || [];
ok(footers.length === 1, 'ONE shared footer', footers.length);
const footLinks = [...(footers[0] || '').matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => m[2] + '=' + m[1]);
ok(JSON.stringify(footLinks) === JSON.stringify(['How It Works=how-it-works.html', 'About=about.html', 'Contact=contact.html', 'Privacy=privacy.html', 'Terms of Service=terms.html', 'Refund Policy=refund-policy.html']),
  'the footer is How It Works, About, Contact, Privacy, Terms of Service, Refund Policy', footLinks);
ok(shellNoComments.indexOf('id="hs-slot"') < shellNoComments.indexOf('id="hs-footer"'), 'the footer renders below #hs-slot');
ok(/\.hs-embed \.hs-header,\.hs-embed \.hs-footer\{display:none !important\}/.test(css), 'header and footer are hidden in Map 1\'s embed mode');
ok(!/<footer\b/.test(tpl), 'the homepage has no footer of its own');
ok(/\.hs-header\{position:sticky;top:0;z-index:50;height:72px;background:#fff;border-bottom:1px solid var\(--line\)\}/.test(css),
  'the header is 72px, white, sticky, z-index 50, with a 1px bottom border');
ok(/\.hs-header__menu\{display:none;width:44px;height:44px/.test(css) && /@media \(max-width:1023px\)\{[\s\S]*?\.hs-header__menu\{display:inline-flex\}/.test(css),
  'the 44×44 Menu button appears at 1023px and narrower');
ok(/if \(e\.key !== 'Escape'/.test(shellCode) && /!head\.contains\(e\.target\)\) closeMenu\(\)/.test(shellCode)
   && /\.hs-nav a'\)\.forEach\(a => a\.addEventListener\('click', closeMenu\)\)/.test(shellCode),
  'the menu closes on Escape, an outside click, and a nav click');
ok(/const IS_EMBED = document\.documentElement\.classList\.contains\('hs-embed'\);/.test(shellJs)
   && /if \(z && !IS_EMBED\) SS\.set\('viewZip', z\);/.test(shellJs) && /if \(!IS_EMBED\) SS\.set\('viewZip', z\);/.test(shellJs)
   && /if \(!IS_EMBED && HS\.needsOnboarding/.test(shellJs),
  'an embedded map never writes the tab\'s viewed ZIP and never opens onboarding');

console.log('--- 6. canonical Type and lifecycle ---');
const srcs = (idxNoComments.match(/<script src="[^"]+"/g) || []).map((s) => s.slice(13, -1));
const pt = srcs.findIndex((s) => s.startsWith('lib/project-type.js'));
const key = createHash('sha256').update(readFileSync(join(root, 'lib/project-type.js'))).digest('hex').slice(0, 8);
ok(pt >= 0 && srcs[pt] === 'lib/project-type.js?v=' + key, 'index.html loads lib/project-type.js at its current content key', srcs[pt]);
ok(idxNoComments.indexOf('lib/project-type.js') < idxNoComments.lastIndexOf('<script>'), '...before the page script');
ok(/HS\.canonicalProjectType\(p\)/.test(pageScript) && /HS\.canonicalLifecycle\(p\)/.test(pageScript), 'cards use HS.canonicalProjectType and HS.canonicalLifecycle');
ok(!/'Proposed'|'Approved'|'Operating|'Lifecycle unknown'|'Residential'|'Commercial'|'Industrial'/.test(pageScript), 'the page script names no Type or lifecycle label of its own');

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL PASS');
process.exit(fails ? 1 : 0);
