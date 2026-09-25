// "What is changing in my zip code?" — Map 1's email sign-up for the Bluesky MAPS posts
// about ONE ZIP (founder, 2026-09-25). Pins the contract end to end on the site side:
//   §1 the RPC arguments (pure, driven): the ZIP community, one maps topic, alert consent
//      ONLY, the first-touch referral;
//   §2 the ZIP community lookup (driven through the SHIPPED lib/data.js on a stub client):
//      a city or county that merely contains the ZIP is refused;
//   §3 shell.js: one path — resume-after-sign-in, the follow writer, the one additive
//      consent writer, the canonical read-back — and nothing written on the county;
//   §4 the sign-in resume can never fire on a later, unrelated sign-in;
//   §5 Map 1: the founder's label word for word, ZIP mode only, inside the hero the
//      Place-page embed hides, and the consent line rendered from the recorded string;
//   §6 the SQL of record (a12), read as EXECUTABLE statements, never as prose.
// Run: node test/maps-zip-email.test.mjs
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const TOPIC = 'What is changing in my zip code?';

// ---------------------------------------------------------------- §1 + §2 driven
const COMMUNITIES = [
  { id: 'county-deschutes', name: 'Deschutes County', level: 'county', zip_codes: ['97701', '97702'] },
  { id: 'zip-97702', name: 'Bend (97702)', level: 'zip', zip_codes: ['97702'] },
  // A ZIP held only by a city and a county: there is no ZIP-level row for it.
  { id: 'city-brigham', name: 'Brigham City', level: 'city', zip_codes: ['84302'] },
  { id: 'county-boxelder', name: 'Box Elder County', level: 'county', zip_codes: ['84302'] }
];
const reads = [];
const stubClient = {
  from(table) {
    const q = { table, filters: [] };
    const b = {
      select() { return b; },
      contains(col, arr) {
        q.filters.push(['contains', col, arr]); reads.push(q);
        const data = table === 'communities'
          ? COMMUNITIES.filter(c => arr.every(z => (c[col] || []).includes(z))) : [];
        return Promise.resolve({ data, error: null });
      }
    };
    return b;
  }
};
global.window = {
  HS_CONFIG: { DATA_SOURCE: 'supabase', SUPABASE_URL: 'https://stub', SUPABASE_ANON_KEY: 'stub' },
  HS: {},
  supabase: { createClient: () => stubClient }
};
require('../lib/data.js');
const HS = global.window.HS;

ok(HS.MAPS_EMAIL_STREAM === 'maps', "§1 the stream is 'maps'");
ok(HS.MAPS_EMAIL_TOPIC === TOPIC, "§1 the one topic is the founder's wording, word for word");
const args = HS.mapsOptinRpcArgs('a@b.com', 'zip-97702', '97702', '2026-09-25', 'the copy',
  { source: 'bluesky', campaign: 'maps' });
ok(JSON.stringify(args.p_topics) === JSON.stringify({ maps: [TOPIC] }),
  '§1 the selection is exactly {"maps":["What is changing in my zip code?"]}');
ok(args.p_community_id === 'zip-97702' && args.p_zip_code === '97702',
  '§1 the selection is filed on the ZIP community it was given');
ok(args.p_marketing_consent === false,
  '§1 alert consent ONLY — p_marketing_consent is false (founder contract F)');
ok(args.p_marketing_consent_copy === 'the copy' && args.p_consent_version === '2026-09-25',
  '§1 the consent copy + version travel for the audit trail');
ok(args.p_referral_source === 'bluesky' && args.p_referral_campaign === 'maps',
  '§1 the Bluesky first touch travels with the sign-up');
const noRef = HS.mapsOptinRpcArgs('a@b.com', 'z', '97702', 'v', 'c', null);
ok(noRef.p_referral_source === null && noRef.p_referral_campaign === null,
  '§1 no referral on file sends nulls, never "undefined"');
ok(!('p_subscriptions' in args), '§1 the legacy second representation is not sent');

const zc = await HS.data.zipCommunity('97702');
ok(zc && zc.id === 'zip-97702', '§2 97702 resolves to its OWN ZIP-level community, not the county');
ok((await HS.data.zipCommunity('84302')) === null,
  '§2 a ZIP held only by a city/county has no ZIP community — refused (null), never the county');
ok((await HS.data.zipCommunity('9770')) === null && (await HS.data.zipCommunity('')) === null,
  '§2 a malformed ZIP is refused without a read');
ok(reads.every(q => q.table === 'communities'), '§2 the lookup reads communities only');

// ---------------------------------------------------------------- §3 shell.js
const shell = read('shell.js');
const block = (shell.match(/"What is changing in my zip code\?" \(Map 1\)[\s\S]*?HS\.mapsZipEmailSignup = function[\s\S]*?\n  \};/) || [''])[0];
ok(block.length > 500, '§3 the Map 1 sign-up block is locatable in shell.js (positive control)');
const write = (block.match(/async function mapsZipEmailWrite[\s\S]*?\n  \}/) || [''])[0];
ok(write.length > 200, '§3 mapsZipEmailWrite is locatable (positive control)');
ok(/await persistCommunityFollow\(zip\)/.test(write),
  '§3 the ZIP is saved to My Places by persistCommunityFollow (the follow writer onboarding uses)');
ok(/rpc\('enable_area_email_alerts',\s*\n?\s*HS\.mapsOptinRpcArgs\(/.test(write),
  '§3 the selection is written by enable_area_email_alerts via HS.mapsOptinRpcArgs');
ok(write.indexOf('persistCommunityFollow') < write.indexOf("rpc('enable_area_email_alerts'"),
  '§3 the follow is saved BEFORE the selection (so onboarding never traps a new resident)');
ok(/await HS\.mapsZipEmailState\(zip\)[\s\S]{0,80}if \(!st\.subscribed\)/.test(write),
  '§3 success is READ BACK from the canonical state, never assumed');
ok(!/subscribe_area_defaults|ensureAreaSubscribed|signup_complete/.test(write),
  '§3 nothing is written on the county identity (no floor, no reconcile-to-exact signup)');
const stateFn = (block.match(/HS\.mapsZipEmailState = async function[\s\S]*?\n  \};/) || [''])[0];
ok(/from\('my_alert_subscriptions'\)/.test(stateFn),
  '§3 the button state reads my_alert_subscriptions (UI = DELIVERY)');
ok(/\.eq\('community_id', zc\.id\)/.test(stateFn) && /\.eq\('stream', HS\.MAPS_EMAIL_STREAM\)/.test(stateFn),
  '§3 scoped by the ZIP community id and the maps stream');
ok(!/zip_code/.test(stateFn), '§3 never scoped by users.zip_code equality');
ok(/subscribed === true/.test(stateFn), "§3 only the view's own `subscribed` answer counts as on");
ok(/if \(!HS\.requireAuth\('maps-zip-email', run\)\) return 'auth';/.test(block),
  '§3 signed out, the sign-up hands itself to the sign-in as the action to resume');
const copies = shell.match(/We'll email you when HomeSignal posts about what's changing in this ZIP code\./g) || [];
ok(copies.length === 1, '§3 the consent sentence exists ONCE in shell.js (shown string = recorded string)');
ok(/HS\.MAPS_CONSENT_COPY = MAPS_CONSENT_COPY;/.test(block) &&
   /MAPS_CONSENT_VERSION, MAPS_CONSENT_COPY, HS\.referral\(\)/.test(write),
  '§3 the page reads HS.MAPS_CONSENT_COPY and the RPC records that same constant');

// ---------------------------------------------------------------- §4 resume safety
const openAuth = (shell.match(/HS\.openAuth = function \(afterAuth\) \{[\s\S]*?\n  \};/) || [''])[0];
ok(/_afterAuth = typeof afterAuth === 'function' \? afterAuth : null;/.test(openAuth),
  '§4 every open of the sign-in REPLACES the pending action (an avatar sign-in clears it)');
ok(/HS\.authReset = function \(\) \{ HS\.openAuth\(_afterAuth\); \};/.test(shell),
  '§4 "use a different email" keeps the pending action (same sign-in, restarted)');
const verify = (shell.match(/verifyOtp\([\s\S]*?\}, 700\);/) || [''])[0];
ok(verify.length > 200, '§4 the verify branch is locatable (positive control)');
ok(/const resume = _afterAuth; _afterAuth = null;/.test(verify),
  '§4 the pending action is consumed exactly once');
ok(verify.indexOf('await resume()') > -1 && verify.indexOf('await resume()') < verify.indexOf('setTimeout('),
  '§4 the resume runs BEFORE the onboarding check (its follow counts as the location)');
ok(/needsOnboarding\(\)\) \{\s*HS\.startOnboarding\(\);\s*\} else if \(resume\) \{/.test(verify),
  '§4 with a resumed action the page stays put (?zip= and utm_* intact); onboarding still wins');
ok(/requireAuth = function \(thenLabel, afterAuth\)[\s\S]{0,300}HS\.openAuth\(afterAuth\);/.test(shell),
  '§4 requireAuth passes the action through to the sign-in');

// ---------------------------------------------------------------- §5 Map 1
const page = read('homesignalmap.html');
const head = (page.match(/<div class="head">[\s\S]*?<div class="status" id="status">/) || [''])[0];
ok(head.length > 0, '§5 the Map 1 hero (.head) is locatable (positive control)');
ok(/<button type="button" class="zip-email-btn" id="zipEmailBtn">What is changing in my zip code\?<\/button>/.test(head),
  "§5 the button reads the founder's wording, word for word, and lives inside .head");
ok(/\.hs-embed \.wrap>\.head,/.test(page),
  '§5 .head is on the embed hide list, so the button never appears inside a Place-page map');
ok(/\.zip-email\{display:none;/.test(page) && /body\.zipmode \.zip-email\{display:block\}/.test(page),
  '§5 the control shows in ZIP mode only');
const loadZip = (page.match(/function loadZip\(zip\)\{[\s\S]*?paintZipEmail\(zip\);/) || [''])[0];
ok(loadZip.length > 0 && loadZip.indexOf('classList.add("zipmode")') > -1,
  '§5 loadZip paints the control when it enters ZIP mode');
const paint = (page.match(/function paintZipEmail\(zip\)\{[\s\S]*?\n  \}/) || [''])[0];
ok(/note\.textContent = HS\.MAPS_CONSENT_COPY/.test(paint),
  '§5 the consent line is HS.MAPS_CONSENT_COPY, not a second copy of the words');
ok(!/We'll email you when HomeSignal posts/.test(page),
  '§5 the page carries no second copy of the consent sentence');
ok(/HS\.mapsZipEmailSignup\(z, function\(err\)/.test(paint) && /HS\.mapsZipEmailState\(zip\)/.test(paint),
  '§5 the page only paints: sign-up and state come from shell.js');
ok(/err && err\.friendly\) \? err\.message : "Couldn't sign you up/.test(paint),
  '§5 a raw database error is never shown to a resident verbatim');

// ---------------------------------------------------------------- §6 the SQL of record
const sqlCode = (s) => (s || '').replace(/--[^\n]*/g, '');
const a12 = sqlCode(read('docs/alert-subscription-canonical-a12.sql'));
ok(/add constraint alert_topic_catalog_stream_ck\s*\n\s*check \(stream = any \(array\[[^\]]*'maps'\]\)\)/.test(a12)
   && /add constraint user_subscriptions_stream_ck\s*\n\s*check \(stream = any \(array\[[^\]]*'maps'\]\)\)/.test(a12),
  "§6 'maps' is added to BOTH halves of the stream vocabulary (widen both together)");
ok(a12.includes(`values ('maps', '${TOPIC}', true)`),
  '§6 the catalog topic is the same string the site sends (one topic, no drift)');
ok(/create trigger user_subscriptions_maps_zip_scoped/.test(a12) && /c\.level = 'zip'/.test(a12),
  '§6 a maps selection on a non-ZIP community is refused in the database');
const fn = (a12.match(/create or replace function public\.enable_area_email_alerts\([\s\S]*?\$function\$;/) || [''])[0];
ok(fn.length > 0, '§6 the extended consent writer is locatable (positive control)');
ok(/p_marketing_consent boolean default true/.test(fn),
  '§6 p_marketing_consent defaults to TRUE, so every existing caller is unchanged');
ok(/coalesce\(public\.users\.marketing_consent, false\) or v_marketing/.test(fn),
  '§6 a false tap never revokes marketing consent already given');
ok(!/delete from public\.user_subscriptions/i.test(fn),
  '§6 the writer stays ADDITIVE — it never deletes a selection');
ok(/drop function if exists public\.enable_area_email_alerts\(text, uuid, text, jsonb, text, text\);/.test(a12),
  '§6 the old six-argument overload is dropped (no ambiguous PostgREST call)');

// The same topic is the first line of every ordinary MAPS post, in the sibling repo.
const ingest = process.env.INGEST_ROOT || join(root, '..', 'homesignal-ingest');
const compose = join(ingest, 'bluesky', 'lib', 'compose-maps.mjs');
if (existsSync(compose)) {
  ok(readFileSync(compose, 'utf8').includes(`'${TOPIC}'`),
    '§6 the topic is the MAPS post header the composer writes (compose-maps.mjs)');
} else {
  console.log('SKIP — compose-maps.mjs not on disk (sibling repo absent); header parity is '
    + 'pinned in homesignal-ingest tests/test_maps_email_stream.py, where both files live');
}

if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nAll "What is changing in my zip code?" sign-up assertions passed.');
