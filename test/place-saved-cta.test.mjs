// SAVE/FOLLOW PLACE ≠ EMAIL ALERTS CONFIGURED.
// Pins post-save identity, Alerts routing, and the card copy contract.
// Run: node test/place-saved-cta.test.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {
  placeSavedLabel,
  alertsHrefForSavedPlace,
  navHref
} = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// --- identity (do not hard-code Celina/75009 as the only path; prove the formula) ---
ok(placeSavedLabel({ zip: '75009', name: 'Celina' }) === 'Celina (75009)',
  'ZIP + name without the ZIP in the name → "Name (ZIP)"');
ok(placeSavedLabel({ zip: '75009', name: 'Celina (75009)' }) === 'Celina (75009)',
  'name that already carries the ZIP is not doubled');
ok(placeSavedLabel({ zip: '78617', name: 'Del Valle' }) === 'Del Valle (78617)',
  'seed ZIP uses the followed community name + ZIP');
ok(placeSavedLabel({ zip: '78617', name: 'Del Valle (78617)' }) === 'Del Valle (78617)',
  'Del Valle seed-style name is not doubled');
ok(placeSavedLabel({ zip: '78617', address: '2200 CALDWELL LN, DEL VALLE, TX 78617' })
    === '2200 CALDWELL LN, DEL VALLE, TX 78617',
  'address identity wins over ZIP/name');
ok(placeSavedLabel({ zip: '78617' }) === '78617',
  'ZIP-only falls back to the ZIP');

ok(alertsHrefForSavedPlace({ zip: '75009' }) === 'alerts.html?zip=75009',
  'ZIP save CTA uses canonical navHref alerts.html?zip=');
ok(alertsHrefForSavedPlace({ zip: '78617', address: '2200 CALDWELL LN, DEL VALLE, TX 78617' })
    === 'alerts.html?zip=78617',
  'address save CTA still carries ZIP via navHref (activeProp is the address identity)');
ok(alertsHrefForSavedPlace({ zip: 'abc' }) === 'alerts.html',
  'non-ZIP does not invent a query');
ok(alertsHrefForSavedPlace({ zip: '75009' }, navHref) === navHref('alerts.html', '75009'),
  'CTA href is navHref, not a second place-identity scheme');
ok(!/place=/.test(alertsHrefForSavedPlace({ zip: '75009', placeId: 'abc' })),
  'does not invent a place= query (maps-only param)');

// --- shell.js production path ---
const shell = read('shell.js');
const showFn = (shell.match(/HS\.showAreaOptin = function[\s\S]*?(?=\n  HS\.enableAreaEmail)/) || [''])[0];
ok(showFn.length > 0, 'showAreaOptin is locatable in shell.js');
ok(/saved to My Places/.test(showFn), 'card title states saved to My Places');
ok(/Want email alerts\?/.test(showFn), 'invitation is the approved "Want email alerts?" line');
ok(/id="optinAlertsCta"/.test(showFn), 'CTA has id=optinAlertsCta');
ok(/Choose your alert topics →/.test(showFn), 'CTA text is exactly the approved copy');
ok(/alertsHrefForSavedPlace/.test(showFn), 'CTA href comes from alertsHrefForSavedPlace');
ok(!/enableAreaEmail/.test(showFn), 'card does not call enableAreaEmail');
ok(!/optinYes/.test(showFn), 'card has no Email-me button');
ok(!/Emailing you/.test(showFn), 'card never claims "Emailing you…"');
ok(!/Now following development/.test(showFn), 'card never claims following development & hearings as email');
ok(!/Email me these alerts/.test(showFn), 'card does not offer the old opt-in control');

ok(/HS\.announcePlaceSaved = function/.test(shell), 'announcePlaceSaved exists');
ok(/toggleFollowCommunityBtn[\s\S]{0,500}announcePlaceSaved/.test(shell),
  'ZIP follow button announces independently of the digest-floor RPC');
ok(/findCommunity[\s\S]{0,700}announcePlaceSaved/.test(shell),
  'ZIP lookup announces independently of the digest-floor RPC');
ok(/saveHome[\s\S]{0,1200}announcePlaceSaved/.test(shell),
  'address save announces independently of the digest-floor RPC');
ok(/announcePlaceSaved\(\{[\s\S]{0,200}kind: 'address'/.test(shell),
  'address save carries kind:address + the confirmed address string');

ok(/ensureAreaSubscribed\(zip, false, true\)/.test(shell),
  'in-place ZIP follow passes suppressUi so the RPC cannot paint the old email card');
ok(/ensureAreaSubscribed\(z, true, true\)/.test(shell),
  'ZIP lookup passes suppressUi');
ok(/ensureAreaSubscribed\(m\.zip, true, true\)/.test(shell),
  'address save passes suppressUi on the digest-floor call');

ok(/LS\.set\('activeProp', r\.data\.id\)/.test(shell)
    && /announcePlaceSaved\(\{[\s\S]*?placeId: r\.data\.id/.test(shell),
  'address save sets activeProp before announcing (Alerts reads HS.state.activeProperty)');

// follow writes My Places, not topic prefs / consent
const followFn = (shell.match(/HS\.followCommunity = function[\s\S]*?\n  HS\.unfollowCommunity/) || [''])[0];
ok(followFn.length > 0, 'followCommunity is locatable');
ok(/myCommunities/.test(followFn), 'ZIP follow writes myCommunities (My Places)');
ok(!/topicPrefs/.test(followFn) && !/enable_area_email_alerts/.test(followFn)
    && !/signup_complete/.test(followFn) && !/marketing_consent/.test(followFn),
  'followCommunity does not write alert prefs, consent, or signup_complete');

const saveHomeFn = (shell.match(/HS\.saveHome = async function[\s\S]*?\n  HS\.removeAddress/) || [''])[0];
ok(saveHomeFn.length > 0, 'saveHome is locatable');
ok(/app_properties/.test(saveHomeFn), 'address save writes app_properties');
ok(!/enable_area_email_alerts/.test(saveHomeFn) && !/signup_complete/.test(saveHomeFn)
    && !/topicPrefs/.test(saveHomeFn),
  'saveHome does not write alert prefs, consent, or signup_complete');

// digest floor stays inert for email (ON CONFLICT DO NOTHING, consent default false)
const followSql = read('docs/reconnect-subscriptions.sql');
ok(/insert into public\.users \(email, zip_code, community_id\)/.test(followSql),
  'subscribe_area_defaults identity insert does not set marketing_consent');
ok(/on conflict[\s\S]{0,80}do nothing/i.test(followSql),
  'digest-floor subscriptions are ON CONFLICT DO NOTHING (never replace existing prefs)');

if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nAll place-saved-cta assertions passed.');
