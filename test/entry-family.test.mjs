// SEO plan step 14: an address lookup or alert sign-up is recorded with the page type
// the visit entered through. Pins the pure helpers in lib/data.js, the call sites, the
// retired events.js writer and the SQL of record. Run: node test/entry-family.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

global.window = { HS_CONFIG: { DATA_SOURCE: 'supabase' }, HS: {} };
require('../lib/data.js');
const HS = global.window.HS;

// 1. Page type from the path, using the URL shapes gen_zip_pages.py writes.
const fam = [
  ['/community/01002/', 'zip'], ['/community/01002', 'zip'],
  ['/city/tx/austin/', 'city'],
  ['/project/austin-site-plan-cases/sp-2024-0123c-1a2b3c4d/', 'project'],
  ['/guides/what-is-being-built-near-me/', 'guide'],
  ['/', 'home'], ['/index.html', 'home'],
  ['/homesignalmap.html', 'map'],
  ['/alerts.html', 'other'], ['/community/0100/', 'other'], ['/city/austin/', 'other'],
  ['', 'home'], [null, 'home']
];
for (const [p, want] of fam) ok(HS.pageFamily(p) === want, 'pageFamily(' + JSON.stringify(p) + ') = ' + want);
ok(fam.every(([, w]) => HS.PAGE_FAMILIES.includes(w)), 'every family returned is in PAGE_FAMILIES');

// 2. Entry: a script-free page in the referrer wins; otherwise the current page.
const H = 'homesignal.net';
let e = HS.entryFrom('/homesignalmap.html', 'https://homesignal.net/project/x/y-1a2b3c4d/', H);
ok(e.family === 'project' && e.path === '/project/x/y-1a2b3c4d/', 'project page -> map: entry is the project page');
e = HS.entryFrom('/homesignalmap.html', 'https://homesignal.net/city/tx/austin/', H);
ok(e.family === 'city', 'city page -> map: entry is the city page');
e = HS.entryFrom('/homesignalmap.html', 'https://homesignal.net/guides/what-is-being-built-near-me/', H);
ok(e.family === 'guide', 'guide page -> map: entry is the guide');
e = HS.entryFrom('/community/01002/', 'https://www.google.com/', H);
ok(e.family === 'zip' && e.path === '/community/01002/', 'Google -> ZIP page: entry is the ZIP page');
e = HS.entryFrom('/homesignalmap.html', 'https://homesignal.net/community/01002/', H);
ok(e.family === 'map', 'scripted ZIP page -> map: the ZIP page recorded itself, so the referrer is not used');
e = HS.entryFrom('/homesignalmap.html', 'https://evil.example/project/x/y/', H);
ok(e.family === 'map', 'an off-site referrer shaped like a project URL is not an entry');
e = HS.entryFrom('/homesignalmap.html', 'not a url', H);
ok(e.family === 'map', 'an unparseable referrer falls back to the current page');
e = HS.entryFrom('/homesignalmap.html', 'https://homesignal.net/project/x/y/?addr=1+Main+St', H);
ok(!/addr|Main/.test(e.path), 'the entry path carries no query string');
ok(HS.entryFrom('/' + 'a'.repeat(400), '', H).path.length === 200, 'entry path is capped at 200');

// 3. The row carries no address, email or account field, and validates what it stores.
const row = HS.eventRow('property_lookup', { zip_code: '78617' },
  { sessionId: 's1', pageUrl: 'https://homesignal.net/homesignalmap.html', entry: { family: 'project', path: '/project/a/b/' }, zip: '01002' });
ok(row.entry_family === 'project' && row.entry_path === '/project/a/b/', 'row carries the entry');
ok(row.zip_code === '78617', 'an explicit ZIP beats the viewed ZIP');
ok(Object.keys(row).sort().join(',') ===
   'alert_id,community_id,entry_family,entry_path,event_type,page_url,pipeline_type,session_id,topic,zip_code',
   'row has exactly the known columns (no email, address or user id)');
ok(HS.eventRow('x', {}, { entry: { family: 'nope', path: '/' } }).entry_family === null, 'an unknown family is dropped, not stored');
ok(HS.eventRow('x', { zip_code: '12' }, {}).zip_code === null, 'a malformed ZIP is dropped');
ok(HS.eventRow('x'.repeat(100)).event_type.length === 64, 'event type capped at 64');

// 4. logEvent writes one row in live mode, nothing in seed mode, and never throws.
const store = (m) => ({ getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } });
global.location = { origin: 'https://homesignal.net', hostname: 'homesignal.net', pathname: '/homesignalmap.html', search: '?addr=1+Main+St' };
global.sessionStorage = store({ 'hs:entry': JSON.stringify({ family: 'city', path: '/city/tx/austin/' }) });
global.localStorage = store({});
const inserts = [];
// HS.sb() caches the first client it builds, so the failure switch lives inside it.
let clientBoom = false;
global.window.supabase = { createClient: () => ({ from: (t) => {
  if (clientBoom) throw new Error('boom');
  return { insert: (rows) => { inserts.push([t, rows[0]]); return Promise.resolve(); } };
} }) };
HS.logEvent('property_lookup', { zip_code: '78704' });
ok(inserts.length === 1 && inserts[0][0] === 'events', 'live mode: one insert into events (positive control)');
const r0 = inserts[0] ? inserts[0][1] : {};
ok(r0.entry_family === 'city' && r0.entry_path === '/city/tx/austin/' && r0.zip_code === '78704',
   'live mode: the row carries the stored entry and the ZIP');
ok(r0.page_url === 'https://homesignal.net/homesignalmap.html', 'page_url drops the query string (no address is stored)');
ok(/^s[a-z0-9]+$/.test(r0.session_id || ''), 'an anonymous session id is set');
// The browser tests serve the site from 127.0.0.1 against the production database.
for (const h of ['127.0.0.1', 'localhost', 'homesignal.github.io', '']) {
  global.location.hostname = h;
  HS.logEvent('property_lookup', {});
}
global.location.hostname = 'homesignal.net';
ok(inserts.length === 1, 'a page served from anywhere but homesignal.net writes nothing (test runs stay out of the numbers)');
HS.logEvent('property_lookup', {});
ok(inserts.length === 2, 'control: homesignal.net still writes');
inserts.pop();
global.window.HS_CONFIG.DATA_SOURCE = 'seed';
let threw = false;
try { HS.logEvent('property_lookup', {}); } catch (err) { threw = true; }
ok(!threw && inserts.length === 1, 'seed mode: logEvent writes nothing and does not throw');
global.window.HS_CONFIG.DATA_SOURCE = 'supabase';
clientBoom = true;
threw = false;
try { HS.logEvent('property_lookup', {}); } catch (err) { threw = true; }
ok(!threw, 'a client error never reaches the page');
clientBoom = false;
ok(global.window.hsLogEvent === HS.logEvent, 'window.hsLogEvent is HS.logEvent (one writer)');

// 5. Call sites and wiring.
const shell = read('shell.js');
const map = read('homesignalmap.html');
ok(/captureReferral\(\);[^\n]*\n\s*captureEntry\(\);/.test(shell), 'boot records the entry right after the referral');
ok(/SS\.set\('entry',\s*JSON\.stringify\(HS\.entryFrom\(location\.pathname, document\.referrer, location\.host\)\)\)/.test(shell),
   'captureEntry uses HS.entryFrom, once per tab session');
for (const t of ['alert_signup_area', 'alert_signup_maps', 'alert_signup_topics'])
  ok(shell.includes("\n    logEvent('" + t + "'"), 'shell logs ' + t + ' through its guarded helper');
// lib/data.js has no cache key, so shell.js may meet an older copy without these helpers.
ok(/function logEvent\(type, payload\) \{\s*try \{ if \(typeof HS\.logEvent === 'function'\)/.test(shell),
   'shell.js calls HS.logEvent only if it exists, inside try');
ok(/if \(typeof HS\.entryFrom !== 'function'\) return;/.test(shell), 'captureEntry skips when HS.entryFrom is missing');
ok(!/\bHS\.logEvent\('alert_signup/.test(shell), 'no sign-up calls HS.logEvent directly');
ok(/window\.HS && HS\.logEvent && /.test(map), 'the map checks HS.logEvent exists before calling it');
ok(shell.indexOf("logEvent('alert_signup_topics'") > shell.indexOf('await persistSignup();'),
   'the topics sign-up is logged only after the save succeeded');
ok(shell.indexOf("logEvent('alert_signup_maps'") > shell.indexOf('if (!st.subscribed) throw'),
   'the maps sign-up is logged only after the read-back confirms it');
ok(/HS\.logEvent\("property_lookup"/.test(map) && /__HS_LOOKUP_LOGGED !== address/.test(map),
   'the map logs a lookup once per new address');
ok(map.indexOf('HS.logEvent("property_lookup"') > map.indexOf("We couldn't find that address"),
   'a lookup is logged only after the geocoder found the address');

// 6. events.js defines no writer of its own.
const ev = read('events.js');
ok(!/\.from\(\s*['"]events['"]\s*\)/.test(ev) && !/hsClient/.test(ev.replace(/\/\*[\s\S]*?\*\//g, '')),
   'events.js does not write to events itself');

// 7. SQL of record.
const sql = read('docs/events-entry-family.sql');
ok(/add column if not exists entry_family text/.test(sql) && /add column if not exists entry_path\s+text/.test(sql), 'SQL adds both columns');
const sqlFams = (sql.match(/entry_family in \(([^)]*)\)/) || [])[1] || '';
ok(sqlFams.replace(/[\s']/g, '') === HS.PAGE_FAMILIES.join(','), 'SQL CHECK lists exactly HS.PAGE_FAMILIES');
ok(/revoke all on function public\.hs_seo_family_conversions\(integer\) from anon, authenticated;/.test(sql),
   'report function is revoked from anon and authenticated by name');
ok(/order by coalesce\(e\.entry_family, '\(not recorded\)'\) collate "C";/.test(sql) && !/order by \d+ collate/.test(sql.replace(/--[^\n]*/g, '')),
   'the report sorts by the column with a pinned collation, not by a position number');
ok(/has_table_privilege\('anon', 'public\.events', 'select'\)/.test(sql), 'SQL refuses to commit if anon could read events');

if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all entry-family checks passed');
