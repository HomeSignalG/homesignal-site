// Static pins for the INLINE "Follow this property" (the browser test proves the behaviour; these keep the shape from drifting).
// Run: node test/shared-report-follow-inline.test.mjs
import { readFileSync } from 'node:fs';
const r = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const page = r('shared-report.html'), frame = r('follow-embed.html'), shell = r('shell.js'), stage = r('scripts/stage_site.py'), robots = r('robots.txt');
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const code = page.slice(page.indexOf('<script>', page.indexOf('project-type.js')));

ok(!/<iframe/i.test(page.slice(0, page.indexOf('<script>', page.indexOf('project-type.js')))), '1 the report markup carries no frame: it is created only by the click');
ok((code.match(/createElement\('iframe'\)/g) || []).length === 1 && /function followOpen[\s\S]*createElement\('iframe'\)/.test(code), '2 exactly one place makes the frame, inside the click handler path');
ok(/e\.origin !== location\.origin/.test(code) && /e\.source !== followFrame\.contentWindow/.test(code), '3 the page believes only its own frame on its own origin');
ok(/src = 'follow-embed\.html#address=' \+ encodeURIComponent\(followAddr\)/.test(code) && !/[?]address=/.test(code), '4 the address goes in the frame URL fragment only');
ok(!/createClient|supabase-js|\.rpc\(|app_properties|app_follows|localStorage/i.test(code.replace(/https:\/\/qwnnmljucajnexpxdgxr\.supabase\.co\/functions\/v1\/view-shared-report/g, '')), '5 the report page still has no follow or sign-in code of its own');
ok(!/brokerage|client_label|agent_/i.test(frame.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '6 the follow frame never reads brokerage, agent or client data');
ok(/name="robots" content="noindex, nofollow"/.test(frame) && /class="hs-embed hs-follow"/.test(frame) && /Disallow: \/follow-embed\.html/.test(robots) && /'follow-embed\.html'/.test(stage), '7 the frame page is noindex, an embed, disallowed in robots.txt and in the staged artifact');
ok(/HS\.startFollowEmbed\(address,/.test(frame) && /HS\.startFollowEmbed = function/.test(shell), '8 the frame runs the shell\'s own flow (openHome -> saveHome), not a copy of it');
ok(!/\.insert\(|app_properties|\.rpc\(/.test(frame), '9 the frame writes nothing itself: the one writer stays savePlaceRow');
ok(/if \(HS\.followEmbed\) \{[\s\S]*?onSaved[\s\S]*?return;\s*\}\s*HS\.announcePlaceSaved/.test(shell) && /!HS\.followEmbed\) \{\s*HS\.startOnboarding/.test(shell), '10 inline follow skips the place card, the reload and onboarding, and nothing else');
ok(/aria-live="polite"/.test(page) && /textContent = 'Following this property\./.test(code), '11 the finished state is announced');
console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
