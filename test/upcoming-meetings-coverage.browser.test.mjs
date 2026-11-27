// Upcoming Meetings picker: coverage first, honest states, write order. Signed in on a FAKE
// Supabase (no production access, no real rows). Every scenario is a ZIP fixture; nothing in the
// shipped code names a ZIP.
// Run: node test/upcoming-meetings-coverage.browser.test.mjs   (needs playwright)
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
const PAST = new Date(Date.now() - 40 * 864e5).toISOString();

// window.__cfg = { communities: [...], meetings: [{community_id, meeting_date}], signupError }
const FAKE = `
(function(){
  var F = window.__fake = window.__fake || { log: [], session: null, signup: null };
  var C = window.__cfg || { communities: [], meetings: [] };
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
        } else if (table === 'app_community_meta') out = [{ zip: '00000', name: 'X', state: 'XX', data_quality: 'pass' }];
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
const comm = (id, name, level, zips, parent, topics) => ({ id, name, level, zip_codes: zips, parent_id: parent || null, government_topics: topics || [] });

async function run(label, zip, cfg, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await page.addInitScript(({ cfg }) => {
    window.__cfg = cfg;
    window.__fake = { log: [], signup: null, session: { access_token: 't', user: { id: 'test-user-1', email: 'staging-test@example.com' } } };
  }, { cfg });
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('@supabase/supabase-js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE });
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript', body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: url.includes('/rest/v1/') ? '[]' : '{}' });
  });
  await page.goto(base + '/alerts.html?zip=' + zip, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HS && HS.openTopics && document.querySelector('.tcat'), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  // A brand-new test user gets the first-run overlay; it is not what is under test.
  await page.evaluate(() => { const o = document.getElementById('onboardingOverlay'); if (o) o.remove(); document.body.classList.remove('onboarding-lock'); });
  console.log('--- ' + label);
  await fn(page);
  ok(errs.length === 0, label + ': no page errors', errs);
  await ctx.close();
}
const open = async (page, key) => {
  await page.evaluate(k => HS.openTopics(k), key);
  await page.waitForSelector('#topicsModal.show', { timeout: 5000 });
  await page.waitForTimeout(150);
};
const cover = page => page.evaluate(() => { const b = document.getElementById('tmCover'); return b ? { text: b.textContent.trim(), hidden: b.classList.contains('hidden'), state: b.dataset.state } : null; });
const saveBtnVisible = page => page.locator('#tmForm .mbtn').isVisible();
const logOf = page => page.evaluate(() => window.__fake.log);

// A. A ZIP with NO community (52638 as it was before its page was built; any such ZIP behaves the same).
await run('A no community', '52638', { communities: [], meetings: [] }, async page => {
  for (const key of ['meetings', 'gov', 'news']) {
    await open(page, key);
    const c = await cover(page);
    ok(c && !c.hidden && /doesn't cover this ZIP yet/.test(c.text), `A1 ${key}: says HomeSignal doesn't cover this ZIP yet`, c);
    ok(/Request coverage for 52638/.test(c.text), `A2 ${key}: offers the request-coverage link`, c);
    ok(!(await saveBtnVisible(page)), `A3 ${key}: no Save button`);
    ok(!(await page.locator('#tmGrid').isVisible()), `A4 ${key}: no topic chips`);
    const shown = await page.locator('#topicsModal .mbody').innerText();
    ok(!/saved|you.ll be (alerted|notified)/i.test(shown), `A5 ${key}: never says saved or notified`, shown);
    await page.evaluate(() => HS.saveTopics());   // the write itself refuses too
    const log = await logOf(page);
    ok(!log.some(e => e.kind === 'rpc' && e.name === 'signup_complete') && !log.some(e => e.kind === 'upsert'), `A6 ${key}: nothing written even if Save is forced`);
    await page.evaluate(() => HS.closeModal('topicsModal'));
  }
  await open(page, 'meetings');
  await page.click('#tmCoverReq');
  ok(await page.locator('#locRequest').isVisible() && (await page.locator('#reqZipLabel').textContent()) === '52638', 'A7 the link opens the coverage request for this ZIP');
});

// B. Community, a delivered meeting that is still upcoming (real feed, meetings scheduled).
const B = { communities: [comm('z1', 'Bend (97702)', 'zip', ['97702'], 'c1'), comm('c1', 'Deschutes County', 'county', ['97701', '97702'], null, [T])],
            meetings: [{ community_id: 'c1', meeting_date: FUTURE }, { community_id: 'c1', meeting_date: PAST }] };
await run('B upcoming meetings', '97702', B, async page => {
  await open(page, 'meetings');
  const c = await cover(page);
  ok(c.hidden, 'B1 coverage + upcoming meetings: no warning banner', c);
  ok(await saveBtnVisible(page), 'B2 Save is there');
  await page.locator('#tmGrid .tchip', { hasText: T }).click();
  await page.click('#tmForm .mbtn');
  await page.waitForSelector('#tmDone:not(.hidden)', { timeout: 5000 });
  const log = await logOf(page);
  const iSig = log.findIndex(e => e.kind === 'rpc' && e.name === 'signup_complete');
  const iPref = log.findIndex(e => e.kind === 'upsert' && e.table === 'app_topic_prefs');
  ok(iSig > -1 && iPref > iSig, 'B3 user_subscriptions write (signup_complete) comes BEFORE the app_topic_prefs save', { iSig, iPref });
  ok(!log.some(e => e.kind === 'delete' || e.kind === 'update' || (e.kind === 'rpc' && e.name === 'clear_alert_selection')), 'B4 no row is deleted, updated or cleared');
  ok((await page.locator('#tmDoneMsg').textContent()) === 'Saved. You will be alerted about 1 Upcoming Meetings topic.', 'B5 Upcoming Meetings in a community with stored meetings may say it will alert', await page.locator('#tmDoneMsg').textContent());
  // B6. Government Notices and Local News picks NEVER promise delivery, even where meetings are stored.
  for (const [key, chipText] of [['gov', T], ['news', 'Water Quality']]) {
    await page.evaluate(() => HS.closeModal('topicsModal'));
    await open(page, key);
    await page.locator('#tmGrid .tchip', { hasText: chipText }).first().click();
    await page.click('#tmForm .mbtn');
    await page.waitForSelector('#tmDone:not(.hidden)', { timeout: 5000 });
    const m = await page.locator('#tmDoneMsg').textContent();
    ok(!/alerted/i.test(m) && m === 'Saved. Alerts start only if verified coverage is added.', 'B6 ' + key + ' pick never shows "will be alerted"', m);
  }
});

// C. A second community with real feeds, only PAST meetings stored: coverage verified, nothing upcoming.
const Cc = { communities: [comm('z2', 'Brigham (84302)', 'zip', ['84302'], 'c2'), comm('c2', 'Box Elder County', 'county', ['84302'], null, [T])],
             meetings: [{ community_id: 'c2', meeting_date: PAST }] };
await run('C coverage, zero upcoming', '84302', Cc, async page => {
  await open(page, 'meetings');
  const c = await cover(page);
  ok(!c.hidden && /No upcoming meetings/.test(c.text) && !/unavailable/i.test(c.text), 'C1 shows "No upcoming meetings", not "unavailable"', c);
  ok(await saveBtnVisible(page), 'C2 Save is there');
  await page.locator('#tmGrid .tchip', { hasText: T }).click();
  await page.click('#tmForm .mbtn');
  await page.waitForSelector('#tmDone:not(.hidden)', { timeout: 5000 });
  const a = await page.evaluate(() => window.__fake.signup);
  ok(a && a.p_community_id === 'c2' && a.p_zip_code === '84302', 'C3 saved on the county community for that ZIP', a);
});

// D. A community with NO meetings ever stored (52638 after its page was built): unavailable, and it saves.
const D = { communities: [comm('z3', 'Middletown (52638)', 'zip', ['52638'], 'c3'), comm('c3', 'Des Moines County', 'county', [], null, [T])], meetings: [] };
await run('D community, no verified meeting coverage', '52638', D, async page => {
  await open(page, 'meetings');
  const c = await cover(page);
  ok(!c.hidden && /Meeting coverage unavailable/.test(c.text) && /Alerts start only if verified coverage is added/.test(c.text), 'D1 says coverage unavailable, alerts only if coverage is added', c);
  ok(await saveBtnVisible(page), 'D2 Save is there');
  await page.locator('#tmGrid .tchip', { hasText: T }).click();
  await page.click('#tmForm .mbtn');
  await page.waitForSelector('#tmDone:not(.hidden)', { timeout: 5000 });
  const a = await page.evaluate(() => window.__fake.signup);
  ok(a && a.p_community_id === 'c3' && a.p_subscriptions.some(s => s.topic === T), 'D3 the subscription row is written against that community', a);
  ok((await page.locator('#tmDone h4').textContent()) === 'Saved' && (await page.locator('#tmDoneMsg').textContent()) === 'Saved. Alerts start only if verified coverage is added.', 'D4 post-save wording never promises alerts', await page.locator('#tmDoneMsg').textContent());
  // Local News and Government Notices pickers on the same ZIP are unaffected and show no meeting wording.
  await page.evaluate(() => HS.closeModal('topicsModal'));
  await open(page, 'news');
  const n = await cover(page);
  ok(n.hidden && /^$/.test(n.text), 'D5 the Local News picker shows no meeting banner', n);
});

// E. A failed subscription write leaves nothing half-saved.
await run('E write fails', '97702', Object.assign({ signupError: true }, B), async page => {
  await open(page, 'meetings');
  await page.locator('#tmGrid .tchip', { hasText: T }).click();
  await page.click('#tmForm .mbtn');
  await page.waitForTimeout(800);
  const log = await logOf(page);
  ok(!log.some(e => e.kind === 'upsert' && e.table === 'app_topic_prefs'), 'E1 no app_topic_prefs save after a failed subscription write');
  ok(/Couldn't save your alerts/.test(await page.locator('#tmCount').textContent()), 'E2 the picker says it failed');
  ok(await page.locator('#tmDone').isHidden(), 'E3 it never claims "saved"');
  const prefs = await page.evaluate(() => (HS.__prefsProbe ? HS.__prefsProbe() : null));
  ok(prefs === null || !prefs.meetings, 'E4 the in-memory pick is put back');
});

await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
