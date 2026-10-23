// First-party acquisition attribution — the BROWSER half (lib/data.js HS.attr, shell.js, development-activity-reports.html,
// acquisition.html). The database half is proven by test/acquisition_attribution_pg/e2e.sql (rolled back on the live schema).
// Run: node test/acquisition-attribution.test.mjs
//
// What this pins:
//   * the browser REPORTS what it saw (utm, referring HOST, landing PATH) and never decides a channel
//   * a visitor id is minted once; the first touch is kept until the database accepts it, then cleared
//   * a browser that already held our storage is flagged "prior" (its true first touch is unknown)
//   * embeds, automation and foreign hosts record nothing
//   * a session id renews after 30 minutes idle
//   * events carry only random ids + host; no query string, address or email
//   * the standalone report page is untouched (reports are attributed by the database at read time); the dashboard shows what was not collected
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ---- a tiny browser -------------------------------------------------------------------------------------------------------
function makeBrowser({ host = 'homesignal.net',  // the SOURCE host list; the Pages build rewrites it to the active domain (scripts/brand_stage.py)
   pathname = '/', search = '', referrer = '', embed = false, webdriver = false, store = {} } = {}) {
  const ls = { ...store };
  const calls = [];
  const client = {
    rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ error: null }); },
    from() { return { insert(row) { calls.push({ name: 'events.insert', args: row }); return Promise.resolve({ error: null }); } }; }
  };
  const win = {
    HS_CONFIG: { DATA_SOURCE: 'supabase', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k' },
    HS: {}, supabase: { createClient: () => client }, crypto: { randomUUID: () => '11111111-1111-4111-8111-' + String(++win._n).padStart(12, '0') }, _n: 0
  };
  win.window = win;
  const g = global;
  g.window = win;
  g.location = { hostname: host, host, pathname, search, origin: 'https://' + host };
  g.document = { referrer, documentElement: { classList: { contains: (c) => embed && c === 'hs-embed' } } };
  Object.defineProperty(g, 'navigator', { value: { webdriver }, configurable: true, writable: true });
  g.localStorage = { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.URL = URL; g.URLSearchParams = URLSearchParams;
  // fresh module instance each time
  delete require.cache[require.resolve('../lib/data.js')];
  require('../lib/data.js');
  return { HS: win.HS, ls, calls, client };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// 1. first visit from Bluesky with UTMs: reports raw facts, mints a visitor id, sends once, then clears the pending touch ---------
{
  const b = makeBrowser({ pathname: '/community/98402/', search: '?utm_source=bluesky&utm_medium=social&utm_campaign=pierce-zip&addr=12+Main+St', referrer: 'https://bsky.app/profile/x' });
  b.HS.attr.capture(); b.HS.attr.send(); await tick();
  const c = b.calls.find((x) => x.name === 'record_first_touch');
  ok(!!c, 'a first visit calls record_first_touch');
  ok(c.args.p_utm_source === 'bluesky' && c.args.p_utm_campaign === 'pierce-zip' && c.args.p_utm_medium === 'social', 'utm values are passed as seen');
  ok(c.args.p_ref_host === 'bsky.app', 'the referrer is reduced to its HOST');
  ok(c.args.p_landing_path === '/community/98402/' && !/addr|Main/.test(JSON.stringify(c.args)), 'landing is the PATH only: no query string, no address');
  ok(c.args.p_zip === '98402', 'the landing ZIP comes from the path');
  ok(c.args.p_prior_browser === false, 'a fresh browser is not flagged prior');
  ok(!('channel' in c.args) && !Object.keys(c.args).some((k) => /chan/i.test(k)), 'the browser sends NO channel: the database classifies');
  ok(!b.ls.hs_vpend, 'the pending touch is cleared after the database accepted it');
  b.HS.attr.send(); await tick();
  ok(b.calls.filter((x) => x.name === 'record_first_touch').length === 1, 'it is sent once, not on every page');
}

// 2. a failed call keeps the ORIGINAL touch for the next page load ---------------------------------------------------------------
{
  const b = makeBrowser({ search: '?utm_source=saleshandy&utm_medium=email&utm_campaign=oct-1', referrer: '' });
  b.client.rpc = (name, args) => { b.calls.push({ name, args }); return Promise.resolve({ error: { message: 'down' } }); };
  b.HS.attr.capture(); b.HS.attr.send(); await tick();
  ok(!!b.ls.hs_vpend, 'a failed send leaves the first touch pending');
  const keep = JSON.parse(b.ls.hs_vpend);
  ok(keep.s === 'saleshandy' && keep.c === 'oct-1', 'the pending touch is the original utm, not a later page');
  const b2 = makeBrowser({ pathname: '/about.html', search: '', referrer: '', store: b.ls });
  b2.HS.attr.capture(); b2.HS.attr.send(); await tick();
  const c = b2.calls.find((x) => x.name === 'record_first_touch');
  ok(c && c.args.p_utm_source === 'saleshandy' && c.args.p_landing_path === '/', 'the retry sends the ORIGINAL first touch');
}

// 3. a browser that held our storage before this tracking is flagged prior --------------------------------------------------------
{
  const b = makeBrowser({ store: { hs_sid: 's-old' } });
  b.HS.attr.capture(); b.HS.attr.send(); await tick();
  ok(b.calls.find((x) => x.name === 'record_first_touch').args.p_prior_browser === true, 'an existing browser is flagged prior (true first touch unknown)');
}

// 4. nothing is recorded for embeds, automation or a foreign host -------------------------------------------------------------------
for (const [name, opts] of [['an embedded iframe', { embed: true }], ['an automated browser', { webdriver: true }], ['a foreign host', { host: 'example.com' }]]) {
  const b = makeBrowser(opts);
  b.HS.attr.capture(); b.HS.attr.send(); await tick();
  ok(b.calls.length === 0 && !b.ls.hs_vid, name + ' records nothing and mints no id');
}

// 5. own-site referrer is not a source; the home page with no referrer sends no ref host ------------------------------------------------
{
  const b = makeBrowser({ referrer: 'https://homesignal.net/about.html' });
  b.HS.attr.capture(); b.HS.attr.send(); await tick();
  ok(b.calls.find((x) => x.name === 'record_first_touch').args.p_ref_host === null, 'a same-site referrer is not sent as a source');
}

// 6. sessions: same id inside 30 minutes, a new one after -----------------------------------------------------------------------------
{
  const b = makeBrowser({});
  b.HS.attr.capture();
  const s1 = b.HS.attr.visitSessionId(), s2 = b.HS.attr.visitSessionId();
  ok(s1 && s1 === s2, 'a session id is stable while active');
  const st = JSON.parse(b.ls.hs_vs); st.t -= 31 * 60 * 1000; b.ls.hs_vs = JSON.stringify(st);
  ok(b.HS.attr.visitSessionId() !== s1, 'a session id renews after 31 minutes idle');
  ok(b.HS.attr.visitSessionId().length <= 40, 'a session id fits the database column');
}

// 7. event rows carry random ids and host only; invalid values are dropped ------------------------------------------------------------
{
  const b = makeBrowser({});
  const r = b.HS.eventRow('page_view', {}, { sessionId: 's', pageUrl: 'https://jodytracks.com/', visitorId: '11111111-1111-4111-8111-000000000001', visitSessionId: 'v' + 'a'.repeat(60), host: 'jodytracks.com' });
  ok(r.visitor_id === '11111111-1111-4111-8111-000000000001' && r.visit_session_id.length === 40 && r.host === 'jodytracks.com', 'the row carries visitor, session and host');
  ok(b.HS.eventRow('x', {}, { visitorId: 'not-a-uuid' }).visitor_id === null, 'a malformed visitor id is dropped');
  ok(Object.keys(r).sort().join(',') ===
     'alert_id,community_id,entry_family,entry_path,event_type,host,page_url,pipeline_type,session_id,topic,visit_session_id,visitor_id,zip_code',
     'the row has exactly the known columns (no email, address, user id or query)');
}

// 8. a page_view is logged through the same writer and carries the ids -----------------------------------------------------------------
{
  const b = makeBrowser({});
  b.HS.attr.capture();
  b.HS.logEvent('page_view', {}); await tick();
  const ins = b.calls.find((x) => x.name === 'events.insert');
  const row = ins && (Array.isArray(ins.args) ? ins.args[0] : ins.args);
  ok(row && row.event_type === 'page_view' && row.visitor_id === b.ls.hs_vid && /^v[0-9a-f]{24}$/.test(row.visit_session_id), 'logEvent("page_view") carries the visitor and visit-session ids');
  ok(row && row.host === 'homesignal.net' && row.page_url === 'https://homesignal.net/', 'the page url is origin + path only');
}

// 9. claim is a thin call; the database decides --------------------------------------------------------------------------
{
  const b = makeBrowser({});
  b.HS.attr.capture();
  b.HS.attr.claim(b.client, 'user-1'); await tick();
  ok(b.calls.some((x) => x.name === 'claim_first_touch' && x.args.p_visitor_id === b.ls.hs_vid), 'sign-in calls claim_first_touch with the visitor id');
  ok(b.ls.hs_vc === 'user-1', 'a successful claim is remembered for that account');
  const n = b.calls.length; b.HS.attr.claim(b.client, 'user-1'); await tick();
  ok(b.calls.length === n, 'a claimed account is not claimed again on every page');
}

// 10. wiring: shell.js, the standalone report page, the dashboard ---------------------------------------------------------------------
const shell = read('shell.js'), da = read('development-activity-reports.html'), acq = read('acquisition.html'), data = read('lib/data.js');
ok(/HS\.attr\.capture\(\);\s*HS\.attr\.send\(\)/.test(shell) && shell.indexOf('HS.attr.capture()') < shell.indexOf('recordPageView();'), 'shell.js captures the first touch before any page view is recorded');
ok(/function recordPageView\(\)\s*\{\s*if \(IS_EMBED\) return;\s*logEvent\('page_view', \{\}\);/.test(shell), 'a page view is logged once per load and never for an embed');
ok(shell.split('recordPageView();').length - 1 === 2, 'both boot exits (coverage panel and normal page) record the page view');
ok(/HS\.attr\.claim\(HS\.sb\(\), state\.session\.user/.test(shell), 'a signed-in session is claimed');
ok(!/attribute_report|hs_vid|localStorage|\.rpc\(/.test(da), 'the report page is UNCHANGED: no extra RPC and no extra storage (its isolation tests 3b/4d stay as they were)');
ok(!/classif|channel\s*=/.test(data.slice(data.indexOf('HS.attr = (function'), data.indexOf('HS.logEvent = function'))), 'lib/data.js contains no channel decision');
ok(/hs_acq_channel_report/.test(acq) && /Not collected \(before tracking\)/.test(acq) && /No source recorded/.test(acq), 'the dashboard shows what was not collected');
ok(/include internal \/ test/.test(acq) && /Pierce County, WA ZIPs/.test(acq) && /America\/Los_Angeles/.test(acq), 'the dashboard offers the internal toggle, the Pierce ZIP set and Los Angeles time');
ok(/NOT been evaluated/.test(acq), 'the dashboard says county overlap has not been evaluated');
ok(!/googletagmanager|google-analytics|gtag\(|plausible\.io|posthog|mixpanel|clarity\.ms/i.test(data + shell + da), 'no third-party tracking service was added');

// 11. SQL of record: additive, gated, and nothing writes an address or email -------------------------------------------------------------------
const sqlRaw = read('docs/acquisition-attribution.sql');
const sql = sqlRaw.replace(/--[^\n]*/g, '');   // code only: the header comments describe the retired objects and a later DROP
ok(!/drop table|truncate|delete from public\.(events|acquisition_touch|users)/i.test(sql), 'the migration deletes no data');
ok(/revoke all on public\.analytics_exclusion from public, anon, authenticated/.test(sql) && /revoke all on public\.zip_set from public, anon, authenticated/.test(sql) && /enable row level security/.test(sql), 'the new tables grant nothing to browsers and have row level security on');
ok(!/\bcreate table[^;]*\breport_attribution\b/i.test(sql) && !/function public\.attribute_report/.test(sql), 'the retired report_attribution / attribute_report are not part of the definition of record');
ok(/to anon, authenticated;\s*\n\s*\n-+ 2\./.test(sql) || (sql.match(/to anon, authenticated;/g) || []).length === 1, 'exactly one function is executable by anon (record_first_touch)');
ok(/split_part\(split_part\(coalesce\(p_landing_path, ''\), '\?', 1\), '#', 1\)/.test(sql), 'the database strips any query or fragment from a landing path');
ok(/America\/Los_Angeles/.test(sql) && /timestamptz/.test(sql), 'reporting is in Los Angeles time; storage stays timestamptz');
ok(!/insert into public\.acquisition_touch[^;]*from public\.users/is.test(sql), 'no attribution is back-filled from existing users');

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL PASS');
process.exit(fails ? 1 : 0);
