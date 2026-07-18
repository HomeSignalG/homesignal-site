// Pins Phase 5 homepage copy — honest, source-backed wording only (index.html
// template; no JS/CSS/meta). Run: node test/homepage-copy.test.mjs
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tpl = html.match(/<template id="hs-content">([\s\S]*?)<\/template>/)?.[1] || '';

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const ban = (s, name) => ok(!tpl.includes(s), 'banned copy removed: ' + name);
const req = (s, name) => ok(tpl.includes(s), 'required copy present: ' + name);

// Retired claims (impact scoring / unqualified promises)
ban('what it means, and what you can do about it.', 'hero H1 old promise stack');
ban('impact your quality of life and home value', 'hero sub impact claim');
ban('participate in the trajectory of projects', 'hero sub trajectory claim');
ban('with the ones that actually affect you', 'trio See it personalization claim');
ban('plain language and scored', 'trio Understand it scoring claim');
ban('Open your community in a few seconds', 'bottom CTA old timing claim');

// Approved honest copy
req('from public records you can verify', 'hero H1');
req('each item linked to its official source', 'hero sub');
req('Coverage depth varies by area', 'hero sub coverage caveat');
req('official record links on every item', 'trio See it');
req("what isn't published yet", 'trio Understand it honesty');
req('traced to a public record', 'preview sub');
req('Enter your ZIP to open the map', 'bottom CTA');
req('Record depth varies by county', 'bottom CTA coverage caveat');

// Phase 5 guardrail: no script edits in this phase
ok(!html.includes('maps.html?zip='), 'homepage routing unchanged (still community.html in script)');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll homepage-copy assertions passed.');
