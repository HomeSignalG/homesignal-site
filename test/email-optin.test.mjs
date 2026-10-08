// GUARD the consent contract: following an area must NOT set marketing_consent.
// Email consent is an Alerts-page action (signup_complete / enable_area_email_alerts),
// never the Save/Follow card. Asserts the pure RPC-arg shapes plus the SQL + shell.js
// source contracts. Run: node test/email-optin.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ---- Pure RPC-arg builders: FOLLOW carries no consent; OPT-IN carries consent ----
global.window = { HS_CONFIG: { DATA_SOURCE: 'supabase' }, HS: {} };
require('../lib/data.js');
const HS = global.window.HS;

const followArgs = HS.followRpcArgs('a@b.com', 'cid', '78617',
  [{ pipeline_type: 'government_notice', topic: 'Planning, zoning & development' }]);
const followKeys = Object.keys(followArgs).join(',');
ok(!/consent|marketing/i.test(followKeys),
   'followRpcArgs carries NO consent/marketing field (following ≠ email consent): ' + followKeys);
ok('p_subscriptions' in followArgs && !('p_topics' in followArgs),
   'followRpcArgs is the app-subscription shape (p_subscriptions, no consent payload)');

const optinArgs = HS.optinRpcArgs('a@b.com', 'cid', '78617', { notices: ['Planning, zoning & development'] }, 'v1', 'copy');
ok(optinArgs.p_marketing_consent_copy === 'copy' && optinArgs.p_consent_version === 'v1',
   'optinRpcArgs carries marketing_consent_copy + consent_version (the audit trail)');
ok('p_topics' in optinArgs,
   'optinRpcArgs carries the topics to populate users.topics (what digest reads)');

// ---- SQL contract: only the opt-in RPC writes marketing_consent=true ----
const followSql = read('docs/reconnect-subscriptions.sql');
const optinSql  = read('docs/email-optin-consent.sql');

// The follow RPC's users INSERT is the 3-column identity insert and never sets consent.
ok(/insert into public\.users \(email, zip_code, community_id\)/.test(followSql),
   'subscribe_area_defaults inserts ONLY (email, zip_code, community_id) — marketing_consent defaults false');
ok(!/marketing_consent\s*=\s*true/.test(followSql),
   'the follow SQL never sets marketing_consent = true');

ok(/create or replace function public\.enable_area_email_alerts/.test(optinSql),
   'the opt-in RPC enable_area_email_alerts exists');
ok(/marketing_consent\s*=\s*true/.test(optinSql),
   'ONLY the opt-in RPC sets marketing_consent = true');
ok(/marketing_consent_copy/.test(optinSql) && /consent_version/.test(optinSql),
   'the opt-in RPC records marketing_consent_copy + consent_version (audit trail kept)');
// Additive, not delete-to-match (never clobbers a multi-topic subscriber).
ok(/jsonb_agg\(distinct/.test(optinSql) && !/delete from public\.user_subscriptions/i.test(optinSql),
   'the opt-in RPC merges topics additively and never deletes existing subscriptions');

// ---- shell.js wiring: follow calls the follow RPC; only the affirmative calls the opt-in RPC ----
const shell = read('shell.js');
ok(/ensureAreaSubscribed[\s\S]*?rpc\('subscribe_area_defaults',[\s\S]*?HS\.followRpcArgs/.test(shell),
   'ensureAreaSubscribed (the follow) calls subscribe_area_defaults via followRpcArgs');
ok(!/ensureAreaSubscribed[\s\S]{0,900}enable_area_email_alerts/.test(shell),
   'ensureAreaSubscribed does NOT call enable_area_email_alerts (no auto-consent on follow)');
ok(/HS\.enableAreaEmail[\s\S]*?rpc\('enable_area_email_alerts',[\s\S]*?HS\.optinRpcArgs/.test(shell),
   'HS.enableAreaEmail remains the enable_area_email_alerts caller (not the save card)');
const showFn = (shell.match(/HS\.showAreaOptin = function[\s\S]*?\n  \};/) || [''])[0];
ok(showFn.length > 0, 'showAreaOptin function body is locatable');
ok(!/enableAreaEmail/.test(showFn),
   'the post-save card does NOT call enableAreaEmail (Save/Follow ≠ email alerts)');
ok(!/optinYes/.test(showFn) && !/Email me these alerts/.test(showFn),
   'the post-save card has no "Email me these alerts" control');
ok(!/Emailing you/.test(showFn) && !/Now following development/.test(showFn),
   'the post-save card never claims email alerts were activated');
ok(/id="optinAlertsCta"/.test(showFn) && /Choose your alert topics →/.test(showFn),
   'the post-save card offers the approved Alerts CTA');
ok(/Want email alerts\?/.test(showFn) && /saved to My Places/.test(showFn),
   'the post-save card states My Places save + a separate email-alerts invitation');

if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nAll email-opt-in consent-contract assertions passed.');
