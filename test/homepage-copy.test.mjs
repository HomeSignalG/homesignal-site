// Pins the homepage copy (index.html template; no JS/CSS/meta). Run: node test/homepage-copy.test.mjs
//
// The copy is the founder's Revised Index Design (Final Claude-Ready, 2026-09-30), Appendix A,
// verbatim. It replaced the Phase 5 copy this file used to pin. The Phase 5 bans stay: the
// retired claims (impact scoring, unqualified promises) must not come back with the new layout.
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tpl = (html.match(/<template id="hs-content">([\s\S]*?)<\/template>/)?.[1] || '').replace(/<!--[\s\S]*?-->/g, '');
// Visible text with entities decoded, so a pin reads the words a visitor reads.
const text = tpl.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const ban = (s, name) => ok(!text.includes(s), 'banned copy removed: ' + name);
const req = (s, name) => ok(text.includes(s), 'required copy present: ' + name);

// Retired claims (impact scoring / unqualified promises) — Phase 5, still banned
ban('what it means, and what you can do about it.', 'hero H1 old promise stack');
ban('impact your quality of life and home value', 'hero sub impact claim');
ban('participate in the trajectory of projects', 'hero sub trajectory claim');
ban('with the ones that actually affect you', 'trio See it personalization claim');
ban('plain language and scored', 'trio Understand it scoring claim');
ban('Open your community in a few seconds', 'bottom CTA old timing claim');

// Blocks the Revised Index Design removed (§17)
ban("This is what you'll see", 'the story-preview block');
ban('What it means', 'the three-card block (What it means)');
ban('What you can do', 'the three-card block (What you can do)');
ban('already following an area', 'the "Free — already following" line');
ban('Neutral · Sourced · Non-partisan', 'the dark trust panel');
ban('Find my community', 'the old hero and bottom CTA buttons');

// The approved copy (Appendix A), verbatim
req('See what’s changing around a property.', 'hero H1');
req('Track changes that impact your quality of life. Receive alerts on changes impacting traffic, noise, and air, water, and soil pollution.', 'hero subhead 1');
req('HomeSignal connects these impacts to proposed developments, construction, infrastructure projects, and local government decisions, helping you understand what’s coming and how it could affect where you live.', 'hero subhead 2');
ban('Development. Government decisions. Public meetings. Local activity.', 'the old hero subhead');
ok(/placeholder="Enter an address or ZIP code"/.test(tpl), 'required copy present: search placeholder');
ok(/>Search<\/button>/.test(tpl), 'required copy present: Search button');
req('No account required.', 'helper');
req('For real estate professionals', 'Enterprise eyebrow (uppercased by CSS)');
req('Development Activity reports for agents & brokerages.', 'Enterprise heading');
req('Know what’s changing around a property before your client does.', 'Enterprise body');
req('Explore Enterprise →', 'Enterprise CTA');
req('See an example: 78657 · Horseshoe Bay, Texas', 'sample heading');
req('Explore this ZIP →', 'sample CTA');
req('Recent development records in 78657', 'records heading');
req('See all development →', 'see-all link');
req('Development Proposed, approved and operating projects on the map.', 'feature: Development');
req('Government Permits, zoning and public notices.', 'feature: Government');
req('Meetings City council, planning and other upcoming meetings.', 'feature: Meetings');
req('Local news Development, local issues and community updates.', 'feature: Local news');
req('How HomeSignal works', 'how-it-works heading');
req('Search an address or ZIP Find a property or explore a ZIP.', 'step 1');
req('See what’s changing See development on the map, plus government activity, meetings and local updates.', 'step 2');
req('Follow what matters Save places and get updates over time.', 'step 3');
req('Built from public records. Every item links to its source.', 'trust line');
ok((text.match(/Explore Enterprise/g) || []).length === 1, 'the Enterprise message appears once: no bottom banner');

// The live-result copy lives in the script, word for word
const script = html.replace(/[\s\S]*<\/template>/, '');
// A search now hands off to Map 1, so the homepage carries no live-result copy of its own.
ok(!script.includes("Open full development map") && !script.includes('Development within 2 miles of this address.'), 'no live-result copy on the homepage: Map 1 owns it');
ok(script.includes("'No local permit/planning records to list here.'"), 'complete-and-empty list copy');
ok(script.includes("'Recent development list unavailable right now.'"), 'unavailable list copy');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll homepage-copy assertions passed.');
