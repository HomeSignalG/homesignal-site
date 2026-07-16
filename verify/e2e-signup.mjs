// Live signup E2E — the PR #253 acceptance flow, run in a TRULY FRESH browser
// context (no cookies, no localStorage, no leftover session): tagged URL →
// OTP sign-in → ZIP onboarding → strict-opt-in topic pick → Save →
// signup_complete RPC confirmed on the wire.
//
// Runs on a GitHub runner (the build sandbox has no egress to homesignal.net —
// same standing answer as verify-communities). The OTP is fetched via the
// GoTrue admin generate_link API (service role, runner-only secret) because CI
// has no inbox; the browser still performs the real signInWithOtp + verifyOtp
// calls — only the code's delivery is out-of-band. The service key and the OTP
// are never printed.
//
// Env: SUPABASE_SERVICE_ROLE_KEY (required), E2E_EMAIL, E2E_ZIP, E2E_SITE.
import { chromium } from 'playwright';
import fs from 'node:fs';

const SITE = (process.env.E2E_SITE || 'https://homesignal.net').replace(/\/$/, '');
const SB_URL = 'https://qwnnmljucajnexpxdgxr.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ZIP = process.env.E2E_ZIP || '84302';
const EMAIL = (process.env.E2E_EMAIL || '').trim() ||
  `sdsutca+e2e-run${process.env.GITHUB_RUN_ID || Date.now()}@proton.me`;
const CAMPAIGN = 'e2e-fresh-session';
const OUT = 'e2e-out';
fs.mkdirSync(OUT, { recursive: true });

if (!KEY) { console.error('FAIL: SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }

const summary = { email: EMAIL, zip: ZIP, site: SITE, steps: [], console_errors: [], rpc: null };
const ok = (name, detail) => { summary.steps.push({ name, ok: true, detail }); console.log(`OK  ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => summary.console_errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') summary.console_errors.push(m.text()); });
// Capture the signup_complete RPC result off the wire — the write is the deliverable.
page.on('response', async (r) => {
  if (r.url().includes('/rest/v1/rpc/signup_complete')) {
    let body = ''; try { body = await r.text(); } catch (e) {}
    summary.rpc = { status: r.status(), body: body.slice(0, 500) };
  }
});

async function fail(name, detail) {
  summary.steps.push({ name, ok: false, detail });
  console.error(`FAIL ${name} — ${detail}`);
  try { await page.screenshot({ path: `${OUT}/FAIL-${name.replace(/\W+/g, '-')}.png`, fullPage: true }); } catch (e) {}
  fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
  await browser.close();
  process.exit(1);
}
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });

try {
  // 0. Deploy check: the live shell must carry the #253 wiring before we test it.
  const shell = await (await fetch(`${SITE}/shell.js`)).text();
  if (!shell.includes('signup_complete')) await fail('deploy-check', 'live shell.js has no signup_complete — #253 not deployed?');
  ok('deploy-check', 'live shell.js carries signup_complete');

  // 1. Fresh-context landing on the tagged URL (the Bluesky-style first touch).
  await page.goto(`${SITE}/alerts.html?utm_source=bluesky&utm_campaign=${CAMPAIGN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#hs-signin', { state: 'attached', timeout: 20000 });
  const refRaw = await page.evaluate(() => localStorage.getItem('hs:referral'));
  const ref = refRaw ? JSON.parse(refRaw) : null;
  if (!ref || ref.source !== 'bluesky' || ref.campaign !== CAMPAIGN)
    await fail('referral-capture', `hs:referral = ${refRaw}`);
  ok('referral-capture', `first touch ${ref.source}/${ref.campaign}`);
  await shot('01-landing');

  // 2. Sign in — real signInWithOtp from the page.
  await page.waitForSelector('#hs-signin', { state: 'visible', timeout: 20000 });
  await page.click('#hs-signin');
  await page.waitForSelector('#authEmail', { state: 'visible', timeout: 10000 });
  await page.fill('#authEmail', EMAIL);
  await page.click('#authSubmitBtn');
  await page.waitForSelector('#authCode', { state: 'visible', timeout: 25000 })
    .catch(async () => fail('otp-send', 'code field never appeared — signInWithOtp errored: ' + await page.locator('#authMsg').textContent()));
  ok('otp-send', 'signInWithOtp accepted; code emailed');
  await shot('02-code-requested');

  // 3. Fetch a valid OTP out-of-band (admin generate_link → email_otp; newest
  // token wins). The browser still does the real verifyOtp.
  await page.waitForTimeout(1500);
  const gl = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL })
  });
  const glj = await gl.json().catch(() => ({}));
  const otp = glj.email_otp || (glj.properties && glj.properties.email_otp);
  if (!gl.ok || !otp) await fail('otp-fetch', `generate_link HTTP ${gl.status} (no email_otp)`);
  ok('otp-fetch', 'admin OTP obtained (not logged)');

  await page.fill('#authCode', otp);
  await page.click('#authSubmitBtn');
  await page.waitForSelector('#authDone', { state: 'visible', timeout: 20000 })
    .catch(async () => fail('otp-verify', 'verifyOtp failed: ' + await page.locator('#authMsg').textContent()));
  ok('otp-verify', 'session established');
  await shot('03-signed-in');

  // 4. New-account onboarding: the ZIP modal opens; a covered ZIP navigates to
  // its community page and saves hs:myZip.
  await page.waitForSelector('#locZip', { state: 'visible', timeout: 15000 });
  await page.fill('#locZip', ZIP);
  await Promise.all([
    page.waitForURL('**/community.html*', { timeout: 30000 }),
    page.click('#locForm .mbtn')
  ]).catch(async () => fail('zip-onboarding', `never navigated to community.html?zip=${ZIP}`));
  ok('zip-onboarding', `covered ZIP ${ZIP} saved as my area`);
  await shot('04-community');

  // 5. Alerts page, signed in, pick a government topic. Strict opt-in must hold.
  await page.goto(`${SITE}/alerts.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HS && HS.state && HS.state.session, null, { timeout: 20000 })
    .catch(async () => fail('session-persist', 'session did not survive navigation'));
  await page.click(`button[onclick="HS.openTopics('gov')"]`);
  await page.waitForFunction(() => document.querySelectorAll('#tmGrid .tchip').length > 0, null, { timeout: 20000 });
  const labels = await page.$$eval('#tmGrid .tchip span:last-child', els => els.map(e => e.textContent));
  const preChecked = await page.$$eval('#tmGrid .tchip.on', els => els.length);
  if (preChecked !== 0) await fail('strict-opt-in', `${preChecked} topics pre-checked for a brand-new user`);
  ok('strict-opt-in', `0 of ${labels.length} pre-checked; labels: ${labels.join(' | ')}`);
  await shot('05-topics-open');

  const pick = labels.includes('Stratos data center project') ? 'Stratos data center project' : labels[0];
  await page.click(`#tmGrid .tchip:has(span:text-is("${pick}"))`);
  summary.picked_topic = pick;
  ok('topic-pick', pick);

  // 6. Save — must end in "Alerts saved", never the fail-loud message.
  await page.click('#tmForm .mbtn');
  await page.waitForSelector('#tmDone', { state: 'visible', timeout: 25000 })
    .catch(async () => fail('save', 'never reached Alerts saved — modal says: ' + await page.locator('#tmCount').textContent()));
  if (!summary.rpc || summary.rpc.status !== 200)
    await fail('rpc', `signup_complete on the wire: ${JSON.stringify(summary.rpc)}`);
  ok('save', `"Alerts saved" shown; signup_complete HTTP 200 → user ${summary.rpc.body}`);
  await shot('06-saved');

  fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
  console.log('\nE2E PASS');
  console.log(JSON.stringify({ email: EMAIL, zip: ZIP, picked: pick, rpc_status: summary.rpc.status, console_errors: summary.console_errors }, null, 2));
  await browser.close();
} catch (e) {
  await fail('unexpected', e.message || String(e));
}
