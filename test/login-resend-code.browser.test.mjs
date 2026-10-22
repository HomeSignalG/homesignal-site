// "Didn't get it? … resend the code" on EVERY login popup, driven in a real browser.
//
// Founder, 2026-10-22: a code that never arrives left the resident with one way out, "Use a
// different email", which starts over. Each sign-in now offers a resend once the code step is
// showing. The resend is the same signInWithOtp call to the same email with the same options
// as the first send, so it never creates or changes anything the first send did not.
// Supabase refuses a second email to one address inside 60 s, so the link waits 60 s.
//
// Five sign-ins: the shared shell one (every public page) and the four standalone pages that
// carry their own copy. The Supabase client is a fake that records every OTP call.
// Run: node test/login-resend-code.browser.test.mjs   (needs playwright; CI's browser job)
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
  try {
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// A minimal fake supabase-js v2: every query resolves empty, the OTP calls are recorded.
const FAKE_SUPABASE = `
(function(){
  var F = window.__fake = { otp: [] };
  function builder(){
    var b = {};
    ['select','eq','order','limit','range','in','neq','gte','lte','lt','gt','is','or','not','single','maybeSingle',
     'ilike','like','filter','textSearch','contains','match','insert','upsert','update','delete']
      .forEach(function(m){ b[m] = function(){ return b; }; });
    b.then = function(res, rej){ return Promise.resolve({ data: [], error: null }).then(res, rej); };
    return b;
  }
  var client = {
    from: builder,
    rpc: function(){ return Promise.resolve({ data: [], error: null }); },
    functions: { invoke: function(){ return Promise.resolve({ data: null, error: null }); } },
    auth: {
      getSession: function(){ return Promise.resolve({ data: { session: null } }); },
      getUser: function(){ return Promise.resolve({ data: { user: null } }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
      signInWithOtp: function(o){ F.otp.push(o); return Promise.resolve({ data: {}, error: null }); },
      verifyOtp: function(){ return Promise.resolve({ data: {}, error: { message: 'no' } }); },
      signOut: function(){ return Promise.resolve({ error: null }); }
    }
  };
  window.supabase = { createClient: function(){ return client; } };
})();`;

const routeHandler = async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  const J = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('@supabase/supabase-js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SUPABASE });
  if (url.includes('cdn.jsdelivr.net') || url.includes('unpkg.com')) return route.fulfill({ status: 200,
    contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript', body: '' });
  return J([]);
};

const EMAIL = 'resident@example.com';
const browser = await chromium.launch();

// Each sign-in, described by its own element ids and how it opens.
const CASES = [
  { name: 'shell (every public page)', path: '/alerts.html?zip=97702', ready: () => !!(window.HS && HS.openAuth && document.getElementById('authEmail')),
    open: () => HS.openAuth(), email: '#authEmail', submit: '#authSubmitBtn', code: '#authCode',
    wrap: '#authResendWrap', link: '#authResendLink', back: '#authBackWrap a', msg: '#authMsg', createUser: true },
  ...[['acquisition.html', true], ['gov-archive.html', true], ['development-activity-reports.html', true],
      ['development-activity-review.html', false]].map(([f, createUser]) => ({
    name: f, path: '/' + f, ready: () => !!document.getElementById('auth-overlay'),
    open: () => { document.getElementById('auth-overlay').style.display = 'flex'; },
    email: '#auth-email', submit: '#auth-submit', code: '#auth-code',
    wrap: '#auth-resend-wrap', link: '#auth-resend-link', back: '#auth-back-link', msg: '#auth-msg', createUser
  }))
];

for (const c of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await page.clock.install();
  await page.route('**/*', routeHandler);
  await page.goto(base + c.path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(c.ready, null, { timeout: 30000 });
  await page.evaluate(c.open);
  const t = (s) => c.name + ': ' + s;

  ok(!(await page.locator(c.wrap).isVisible()), t('the resend line is hidden on the email step'));
  await page.fill(c.email, EMAIL);
  await page.click(c.submit);
  await page.waitForFunction((sel) => { const e = document.querySelector(sel); return e && e.offsetParent !== null; }, c.code, { timeout: 5000 }).catch(() => {});
  ok(await page.locator(c.code).isVisible(), t('the code step shows'));
  ok(await page.locator(c.wrap).isVisible(), t('"Didn\'t get it? … resend the code" shows with the code box'));
  ok(/Didn't get it\?/.test(await page.locator(c.wrap).textContent()), t('it says "Didn\'t get it?"'));
  ok((await page.locator(c.link).getAttribute('aria-disabled')) === 'true', t('the link waits right after a send'));
  ok(/\(60s\)/.test(await page.locator(c.link).textContent()), t('it shows the 60 s wait'), await page.locator(c.link).textContent());

  // Clicking during the wait sends nothing.
  await page.evaluate((sel) => document.querySelector(sel).click(), c.link);
  await page.clock.runFor(100);
  ok((await page.evaluate(() => window.__fake.otp.length)) === 1, t('a click during the wait sends nothing'));

  await page.clock.runFor(61000);
  ok((await page.locator(c.link).getAttribute('aria-disabled')) === 'false', t('after 60 s the link is ready'));
  ok((await page.locator(c.link).textContent()).trim() === 'resend the code', t('and reads "resend the code"'));

  await page.fill(c.code, '1234');
  await page.click(c.link);
  await page.clock.runFor(100);
  const otp = await page.evaluate(() => window.__fake.otp);
  ok(otp.length === 2, t('the click sends one more code'), otp);
  ok(otp[1] && otp[1].email === EMAIL, t('to the same email'), otp[1]);
  ok(otp[1] && otp[1].options && otp[1].options.shouldCreateUser === c.createUser,
     t('with the same options as the first send'), [otp[0] && otp[0].options, otp[1] && otp[1].options]);
  ok((await page.inputValue(c.code)) === '', t('the old code is cleared'));
  ok((await page.locator(c.msg).textContent()).includes('We sent a new code to ' + EMAIL), t('it says a new code was sent'),
     await page.locator(c.msg).textContent());
  ok((await page.locator(c.link).getAttribute('aria-disabled')) === 'true', t('and the wait starts again'));

  // "Use a different email" goes back to the email step and hides the resend line.
  await page.click(c.back);
  await page.clock.runFor(100);
  ok(!(await page.locator(c.wrap).isVisible()), t('"Use a different email" hides the resend line'));
  ok(errs.length === 0, t('no page errors'), errs);
  await ctx.close();
}

await browser.close();
server.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
