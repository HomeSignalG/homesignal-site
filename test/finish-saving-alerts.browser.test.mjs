// "Finish saving your alerts": app-only picks that no subscription backs. Signed in on a FAKE
// Supabase and a test user; no production data. Nothing is written until the resident clicks.
// Run: node test/finish-saving-alerts.browser.test.mjs   (needs playwright)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(await readFile(p)); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const T = 'County Commission & county business';
const FUTURE = new Date(Date.now() + 5 * 864e5).toISOString();
const comm = (id, name, level, zips, parent, topics) => ({ id, name, level, zip_codes: zips, parent_id: parent || null, government_topics: topics || [] });
// window.__cfg = { communities, meetings, subs, prefs, props, signupError }
const FAKE = `
(function(){
  var F = window.__fake = window.__fake || { log: [], session: null, signup: null };
  var C = window.__cfg;
  function builder(table) {
    var q = { table: table, filters: [], op: 'select', row: null };
    var b = {};
    ['select','order','limit','range','neq','gte','lte','lt','gt','is','or','not','single','maybeSingle','ilike','like','filter','textSearch']
      .forEach(function(m){ b[m] = function(){ return b; }; });
    b.eq = function(c, v){ q.filters.push(['eq', c, v]); return b; };
    b.in = function(c, v){ q.filters.push(['in', c, v]); return b; };
    b.contains = function(c, v){ q.filters.push(['contains', c, v]); return b; };
    b.match = function(o){ Object.keys(o).forEach(function(k){ q.filters.push(['eq', k, o[k]]); }); return b; };
    b.insert = function(row){ q.op = 'insert'; q.row = row; return b; };
    b.upsert = function(row){ q.op = 'upsert'; q.row = row; return b; };
    b.update = function(row){ q.op = 'update'; q.row = row; return b; };
    b.delete = function(){ q.op = 'delete'; return b; };
    b.then = function(res, rej){
      F.log.push({ kind: q.op, table: table, row: q.row });
      var f = q.filters, out = [];
      if (q.op === 'select') {
        if (table === 'communities') {
          var cz = f.filter(function(x){ return x[0]==='contains'; })[0];
          var idf = f.filter(function(x){ return x[0]==='eq' && x[1]==='id'; })[0];
          out = cz ? C.communities.filter(function(c){ return cz[2].every(function(z){ return c.zip_codes.indexOf(z) > -1; }); })
                   : C.communities.filter(function(c){ return idf && c.id === idf[2]; });
        } else if (table === 'meetings') {
          var inf = f.filter(function(x){ return x[0]==='in'; })[0];
          out = C.meetings.filter(function(m){ return !inf || inf[2].indexOf(m.community_id) > -1; })
            .sort(function(a, z){ return a.meeting_date < z.meeting_date ? 1 : -1; }).slice(0, 1);
        } else if (table === 'my_alert_subscriptions') out = C.subs;
        else if (table === 'app_topic_prefs') out = C.prefs;
        else if (table === 'app_properties') out = C.props;
        else if (table === 'app_community_meta') out = [{ zip: '00000', name: 'X', state: 'XX', data_quality: 'pass' }];
      }
      return Promise.resolve({ data: out, error: null }).then(res, rej);
    };
    return b;
  }
  window.supabase = { createClient: function(){ return {
    from: function(t){ return builder(t); },
    rpc: function(name, args){
      F.log.push({ kind: 'rpc', name: name, args: args });
      if (name === 'signup_complete') {
        if (C.signupError) return Promise.resolve({ data: null, error: { message: 'boom' } });
        F.signup = args; return Promise.resolve({ data: 'u-row', error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    functions: { invoke: function(){ return Promise.resolve({ data: null, error: null }); } },
    auth: {
      getSession: function(){ return Promise.resolve({ data: { session: F.session } }); },
      getUser: function(){ return Promise.resolve({ data: { user: F.session && F.session.user } }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
      signInWithOtp: function(){ return Promise.resolve({ data: {}, error: null }); },
      verifyOtp: function(){ return Promise.resolve({ data: {}, error: null }); },
      signOut: function(){ F.session = null; return Promise.resolve({ error: null }); }
    }
  }; } };
})();`;

const browser = await chromium.launch();
// A community with no meeting feed yet (stored meetings: none) and one with delivered meetings.
const NOFEED = [comm('z3', 'Middletown (52638)', 'zip', ['52638'], 'c3'), comm('c3', 'Des Moines County', 'county', [], null, [T])];
const FEED = [comm('z1', 'Bend (97702)', 'zip', ['97702'], 'c1'), comm('c1', 'Deschutes County', 'county', ['97701'], null, [T])];
const prefsOnly = { prefs: [{ category: 'gov', topics: [T], share_consent: false }, { category: 'meetings', topics: [T], share_consent: false }] };
const props = zip => [{ id: 'p1', user_id: 'test-user-1', zip, address: '1 Test St', sample: false }];

async function run(label, zip, cfg, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  const full = Object.assign({ communities: [], meetings: [], subs: [], prefs: [], props: [] }, cfg);
  await page.addInitScript(({ cfg }) => {
    window.__cfg = cfg;
    window.__fake = { log: [], signup: null, session: { access_token: 't', user: { id: 'test-user-1', email: 'staging-test@example.com' } } };
  }, { cfg: full });
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('@supabase/supabase-js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE });
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript', body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: url.includes('/rest/v1/') ? '[]' : '{}' });
  });
  await page.goto(base + '/alerts.html?zip=' + zip, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HS && HS.openTopics && document.querySelector('.tcat'), null, { timeout: 30000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => { const o = document.getElementById('onboardingOverlay'); if (o) o.remove(); document.body.classList.remove('onboarding-lock'); });
  console.log('--- ' + label);
  await fn(page);
  ok(errs.length === 0, label + ': no page errors', errs);
  await ctx.close();
}
const logOf = page => page.evaluate(() => window.__fake.log);
const writes = log => log.filter(e => e.kind === 'rpc' ? e.name === 'signup_complete' || e.name === 'clear_alert_selection' : ['insert', 'upsert', 'update', 'delete'].includes(e.kind));
const txt = (page, sel) => page.locator(sel).first().textContent();

// A. App-only picks on a saved ZIP, no subscription: prompt, pre-ticked, nothing written.
await run('A app-only picks', '52638', Object.assign({ communities: NOFEED, props: props('52638') }, prefsOnly), async page => {
  ok(await page.locator('#finishAlerts').isVisible(), 'A1 "Finish saving your alerts" is shown');
  ok(/Finish saving your alerts/.test(await txt(page, '#finishAlerts')), 'A1b it says so');
  const boxes = await page.locator('#finishList input').evaluateAll(a => a.map(i => i.checked));
  ok(boxes.length === 2 && boxes.every(Boolean), 'A2 both picks are pre-ticked', boxes);
  ok(/not yet active/.test(await txt(page, '#cc-gov')) && !/followed/.test(await txt(page, '#cc-gov')), 'A3 Government Notices reads "not yet active", never "followed"', await txt(page, '#cc-gov'));
  ok(/not yet active/.test(await txt(page, '#cc-meetings')), 'A3b so does Upcoming Meetings', await txt(page, '#cc-meetings'));
  ok(/0 topics followed/.test(await txt(page, '#cc-news')), 'A3c Local News (no picks) is unchanged');
  ok(writes(await logOf(page)).length === 0, 'A4 NOTHING is written before the click', writes(await logOf(page)));
});

// B. Already subscribed on that community: no prompt.
const SUB = { community_id: 'c3', zip_code: '52638', stream: 'notices', topic: T, origin: 'explicit', sort_order: 1 };
await run('B existing subscription', '52638', Object.assign({ communities: NOFEED, props: props('52638'), subs: [SUB] }, prefsOnly), async page => {
  ok(await page.locator('#finishAlerts').count() === 0, 'B1 no prompt for a resident who already has a subscription on that community');
  ok(/1 topic followed/.test(await txt(page, '#cc-gov')), 'B2 their real subscription still reads "followed"', await txt(page, '#cc-gov'));
  ok(writes(await logOf(page)).length === 0, 'B3 nothing written');
});

// B2. A follow-floor row is a follow, not a subscription: the prompt still appears.
await run('B2 follow row only', '52638', Object.assign({ communities: NOFEED, props: props('52638'), subs: [Object.assign({}, SUB, { origin: 'follow_floor' })] }, prefsOnly), async page => {
  ok(await page.locator('#finishAlerts').isVisible(), 'B2a a follow-floor row is not a subscription, so the prompt shows');
});

// C. ZIP is not one of their saved places: no prompt.
await run('C not a saved place', '52638', Object.assign({ communities: NOFEED, props: props('97702') }, prefsOnly), async page => {
  ok(await page.locator('#finishAlerts').count() === 0, 'C1 no prompt for a ZIP that is not one of their saved places');
});

// D. Failed write: error shown, never "Saved", app_topic_prefs untouched, still not yet active.
await run('D failed write', '52638', Object.assign({ communities: NOFEED, props: props('52638'), signupError: true }, prefsOnly), async page => {
  await page.click('#finishGo');
  await page.waitForTimeout(900);
  const log = await logOf(page);
  ok(!log.some(e => e.kind === 'upsert'), 'D1 app_topic_prefs is NOT written after a failed subscription write');
  ok(/Couldn't save your alerts/.test(await txt(page, '#finishErr')), 'D2 the failure is shown', await txt(page, '#finishErr'));
  ok(!/Saved/.test(await txt(page, '#finishAlerts')), 'D3 it never says "Saved"');
  ok(/not yet active/.test(await txt(page, '#cc-gov')), 'D4 the picks stay "not yet active"', await txt(page, '#cc-gov'));
  ok(await page.locator('#finishGo').isEnabled(), 'D5 the button works again for a retry');
});

// E. Success, community with no feed: subscription first, then app_topic_prefs, careful wording.
await run('E finish, no feed', '52638', Object.assign({ communities: NOFEED, props: props('52638') }, prefsOnly), async page => {
  await page.click('#finishGo');
  await page.waitForSelector('#finishAlerts:has-text("Saved.")', { timeout: 5000 });
  const log = await logOf(page);
  const iSig = log.findIndex(e => e.kind === 'rpc' && e.name === 'signup_complete');
  const iPref = log.findIndex(e => e.kind === 'upsert' && e.table === 'app_topic_prefs');
  ok(iSig > -1 && iPref > iSig, 'E1 signup_complete first, app_topic_prefs after', { iSig, iPref });
  const a = await page.evaluate(() => window.__fake.signup);
  ok(a && a.p_community_id === 'c3' && a.p_zip_code === '52638' && a.p_subscriptions.some(s => s.topic === T) && a.p_email === 'staging-test@example.com', 'E2 the normal signup_complete call, on that community', a);
  ok((await txt(page, '#finishAlerts')).trim() === 'Saved. Alerts start only if verified coverage is added.', 'E3 wording for a community with no feed', await txt(page, '#finishAlerts'));
  ok(!log.some(e => e.kind === 'delete' || e.kind === 'update'), 'E4 no row deleted or updated');
});

// F. Success where meetings are delivered: ordinary wording.
await run('F finish, feed exists', '97702', Object.assign({ communities: FEED, meetings: [{ community_id: 'c1', meeting_date: FUTURE }], props: props('97702') }, prefsOnly), async page => {
  await page.click('#finishGo');
  await page.waitForSelector('#finishAlerts:has-text("Saved.")', { timeout: 5000 });
  ok(/You will be alerted about 2 topics/.test(await txt(page, '#finishAlerts')), 'F1 a community with delivered meetings says it will alert', await txt(page, '#finishAlerts'));
});

// G. Unticking a topic leaves it out; nothing ticked asks for one.
await run('G subset', '52638', Object.assign({ communities: NOFEED, props: props('52638') }, prefsOnly), async page => {
  await page.locator('#finishList input[data-cat="meetings"]').uncheck();
  await page.click('#finishGo');
  await page.waitForSelector('#finishAlerts:has-text("Saved.")', { timeout: 5000 });
  const a = await page.evaluate(() => window.__fake.signup);
  ok(a && a.p_topics.meetings.length === 0 && a.p_topics.notices.length === 1, 'G1 only the ticked topic is saved', a && a.p_topics);
});

// H. Decline: no write, gone, and not asked again after a reload.
await run('H decline', '52638', Object.assign({ communities: NOFEED, props: props('52638') }, prefsOnly), async page => {
  await page.click('#finishNo');
  ok(await page.locator('#finishAlerts').count() === 0, 'H1 the prompt goes away');
  ok(writes(await logOf(page)).length === 0, 'H2 declining writes nothing');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HS && document.querySelector('.tcat'), null, { timeout: 30000 });
  await page.waitForTimeout(900);
  ok(await page.locator('#finishAlerts').count() === 0, 'H3 not asked again on the next visit');
  ok(/not yet active/.test(await txt(page, '#cc-gov')), 'H4 the picks still read "not yet active", never "followed"', await txt(page, '#cc-gov'));
});

await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
