// Saleshandy campaign attribution: the one touch definition (lib/data.js HS.referralLib), the event
// stamp, shell.js capture, the report page's report_created row, and the SQL of record.
// Run: node test/saleshandy-attribution.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

global.window = { HS_CONFIG: { DATA_SOURCE: 'supabase' }, HS: {} };
require('../lib/data.js');
const HS = global.window.HS;
const R = HS.referralLib;
const H = 'jodytracks.com';

// 1. A campaign link produces a tagged touch with lowercase, bounded labels.
let t = R.fromUrl('?utm_source=Saleshandy&utm_medium=Email&utm_campaign=Realtor-Austin-Oct&utm_content=Step1', '', H, '/development-activity.html', 'T');
ok(t && t.tagged === true && t.source === 'saleshandy' && t.medium === 'email' && t.campaign === 'realtor-austin-oct' && t.content === 'step1',
   'utm labels are lowercased and the touch is tagged');
ok(t.landing === '/development-activity.html?utm_source=Saleshandy&utm_medium=Email&utm_campaign=Realtor-Austin-Oct&utm_content=Step1', 'landing keeps the path and query (never sent to the database)');

// 2. Untagged shapes.
ok(R.fromUrl('', '', H, '/') === null, 'no utm and no referrer: no touch');
ok(R.fromUrl('', 'https://jodytracks.com/x', H, '/') === null, 'same-origin navigation is not a touch');
t = R.fromUrl('', 'https://www.google.com/search', H, '/');
ok(t && t.tagged === false && t.source === 'www.google.com' && t.medium === 'referral', 'an off-site referrer is a touch but NOT a campaign touch');

// 3. Anything that could carry a person or break the column is dropped, not stored.
for (const bad of ['jo@x.com', 'a b', 'x'.repeat(81), '<script>', 'café', '']) {
  const w = R.fromUrl('?utm_source=saleshandy&utm_campaign=' + encodeURIComponent(bad), '', H, '/');
  ok(w && w.campaign === null, 'campaign label ' + JSON.stringify(bad.slice(0, 12)) + ' is dropped');
}
ok(R.fromUrl('?utm_source=jo%40x.com', '', H, '/') === null, 'an e-mail-shaped source is not stored (no touch at all)');

// 4. eventFields: a tagged last touch beats the first touch; nothing => no keys.
const first = { source: 'bluesky', medium: 'social', campaign: 'box-elder', tagged: true };
const last = { source: 'saleshandy', medium: 'email', campaign: 'realtor-austin-oct', content: 'step1', tagged: true };
ok(JSON.stringify(R.eventFields(first, last)) === JSON.stringify({ ref_source: 'saleshandy', ref_medium: 'email', ref_campaign: 'realtor-austin-oct', ref_content: 'step1' }), 'last tagged touch wins');
ok(R.eventFields(first, null).ref_source === 'bluesky', 'first touch is used when there is no tagged last touch');
ok(R.eventFields({ source: 'www.google.com', tagged: false }, { source: 'www.google.com', tagged: false }).ref_source === 'www.google.com', 'an organic first touch is still recorded');
ok(Object.keys(R.eventFields(null, null)).length === 0, 'no touch => no ref keys');
ok(Object.keys(R.eventFields({ source: 'jo@x.com' }, null)).length === 0, 'an unsafe stored label never reaches the row');

// 5. The events row: untagged visits write exactly the columns they always did.
const plain = HS.eventRow('property_lookup', { zip_code: '78617' }, { sessionId: 's1' });
ok(Object.keys(plain).sort().join(',') === 'alert_id,community_id,entry_family,entry_path,event_type,page_url,pipeline_type,session_id,topic,zip_code', 'untagged row has the pre-existing column set');
const tagged = HS.eventRow('campaign_landing', {}, { sessionId: 's1', referralFirst: first, referralLast: last });
ok(tagged.ref_campaign === 'realtor-austin-oct' && tagged.ref_source === 'saleshandy', 'tagged row carries the campaign');
ok(!/email|address|user_id|prospect/i.test(Object.keys(tagged).join(',')), 'row has no person or address field');

// 6. shell.js: capture goes through the one definition; first touch once; last tagged refreshed; one landing event per tab session.
const shell = read('shell.js');
const cap = shell.slice(shell.indexOf('function captureReferral()'), shell.indexOf('HS.referral = function'));
ok(/HS\.referralLib\.fromUrl\(/.test(cap), 'captureReferral uses HS.referralLib.fromUrl');
ok(!/utm_source/.test(cap.replace(/\/\/.*$/gm, '')), 'captureReferral holds no second copy of the utm parsing');
ok(/if \(!LS\.get\('referral', null\)\) LS\.set\('referral', t\)/.test(cap), 'first touch is written once');
ok(/if \(t\.tagged\)[\s\S]*LS\.set\('referral_last', t\)/.test(cap), 'last touch is refreshed only by a tagged visit');
ok(/SS\.get\('landing_logged'\) !== key/.test(cap) && /logEvent\('campaign_landing'\)/.test(cap), 'one campaign_landing event per tab session per campaign');
ok(/HS\.onReady\(function \(\) \{ logEvent\('campaign_landing'\)/.test(cap), 'the landing event waits for the data client');
ok(/HS\.referralForConversion = /.test(shell), 'conversion helper exists');
const conv = shell.match(/HS\.referralForConversion\(\)/g) || [];
ok(conv.length >= 3, 'signup, MAPS opt-in and the referral token read the conversion touch (' + conv.length + ' call sites)');

// 7. The report page: one insert-only row, labels only, same host list as lib/data.js.
const page = read('development-activity-reports.html');
const fn = page.slice(page.indexOf('function logReportCreated()'), page.indexOf('var SAVED_RECENT = 6'));
ok(/event_type: 'report_created'/.test(fn), 'logs report_created');
ok(/\/rest\/v1\/events/.test(fn) && /Prefer: 'return=minimal'/.test(fn), 'insert only, nothing read back');
ok(!/address|report_id|user|email|token/i.test(fn.replace(/\/\/.*$/gm, '').replace(/session_id|hs_sid/g, '')), 'the row carries no address, report id, user or e-mail');
ok(/body\.stored === true\) \{[^}]*logReportCreated\(\)/.test(page), 'fires only for a report that was saved');
const dataHosts = read('lib/data.js').match(/HS\.EVENT_HOSTS = (\[[^\]]*\])/)[1];
const pageHosts = page.match(/var EVENT_HOSTS = (\[[^\]]*\])/)[1];
ok(dataHosts === pageHosts, 'report page and lib/data.js record on the same hosts');

// 8. SQL of record.
const sql = read('docs/saleshandy-attribution.sql');
ok(/primary key \(sh_campaign_id, stat_date\)/.test(sql), 'one row per campaign per day (duplicate guard)');
ok(/revoke all on outreach\.saleshandy_campaign[\s\S]*from public, anon, authenticated/.test(sql), 'no browser role can touch the Saleshandy tables');
ok(/grant execute on function public\.hs_saleshandy_metrics\(integer\) to authenticated/.test(sql) && /revoke all on function public\.hs_saleshandy_metrics\(integer\) from public, anon/.test(sql), 'reader: authenticated only, anon revoked');
ok(/dashboard_admins/.test(sql) && /raise exception 'not authorized'/.test(sql), 'reader is allowlist-gated');
const rpc = sql.slice(sql.indexOf('create or replace function public.hs_saleshandy_metrics'), sql.indexOf('$fn$;', sql.indexOf('create or replace function public.hs_saleshandy_metrics')));
ok(!/'email'|'zip|'address|u\.email\s+as/.test(rpc.replace(/auth\.jwt\(\) ->> 'email'/, '').replace(/lower\(u?\.?email\)|lower\(sb\.email\)|lower\(email\)/g, '')), 'the reader returns no e-mail, ZIP or address key');
ok(!/saleshandy_(campaign|sync)\w* *\(.*(email|prospect|first_name|last_name)/i.test(sql.split('-- 3. The gated reader')[0].replace(/--.*$/gm, '')), 'Saleshandy tables hold no prospect personal data');

// The Saleshandy tab counts Saleshandy campaigns only (2026-10-29: the tile read "Registrations 2"
// while both were a Bluesky "maps" test and an admin test; the Saleshandy sequence had 0).
{
  const vm = await import('node:vm');
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(read('lib/acq-saleshandy.js'), ctx);
  const html = ctx.window.HS.acqSaleshandy.render({ window_days: 30, coverage: {}, campaigns: [
    { campaign: 'pierce_agents_oct2026', name: 'New Sequence - Wed 21st Oct', status: 'active', delivered: 49, registrations: 0, visitors: 0 },
    { campaign: 'maps', registrations: 1 },
    { campaign: 'pierce_wa_launch_quality_2026-10-18', registrations: 1, visitors: 3 } ] });
  const tileVal = (label) => (html.match(new RegExp('tile-val">([^<]*)</div><div class="tile-label">' + label)) || [])[1];
  ok(tileVal('Registrations') === '0', 'registrations tile counts Saleshandy campaigns only');
  ok(tileVal('Website visitors') === '0', 'visitors tile counts Saleshandy campaigns only');
  ok(!/<td>maps</.test(html) && /Not counted above \(not Saleshandy\): maps/.test(html), 'other labels are named, not put in the table');
}

if (fails) { console.error('\n' + fails + ' check(s) failed'); process.exit(1); }
console.log('\nall saleshandy-attribution checks passed');
