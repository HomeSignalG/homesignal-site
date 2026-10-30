// Browser proof: the development page's follow button says "Following" only after the
// database confirms the write. Drives the real development.html + shell.js with a fake
// Supabase client whose answer the test controls (pending / { error } / { error: 23505 } / ok).
// Run: node test/follow-confirmed-write.browser.test.mjs
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP follow-confirmed-write.browser.test.mjs — playwright not installed');
  process.exit(0);
}

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

const ADD = 'Add to My Places to follow';
const ON = '✓ Following in My Places';
const SAVE_ERR = 'Couldn’t save to My Places. Try again.';
const PID = 'proj-datacenter';

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage();

await page.goto(base + '/development.html?data=seed&zip=78617&id=' + PID);
await page.waitForFunction(() => window.HS && window.HS.ready);
await page.evaluate(() => window.HS.ready);
await page.waitForSelector('.doact');

// A signed-in, non-demo session on the live data path, with a fake client the test steers.
await page.evaluate(() => {
  window.HS.state.session = { user: { id: 'confirm-test-user' }, demo: false };
  window.HS.requireAuth = function () { return true; };
  window.HS_CONFIG.DATA_SOURCE = 'supabase';
  window.__writes = [];
  window.__answer = null;           // null = pending until __release() is called
  window.__release = null;
  const answer = (op, row) => {
    window.__writes.push({ op, row });
    if (window.__answer) return Promise.resolve(window.__answer);
    return new Promise(r => { window.__release = r; });
  };
  const client = { from: () => ({
    insert: (row) => answer('insert', row),
    delete: () => ({ match: (row) => answer('delete', row) })
  }) };
  window.HS.sb = () => client;
});

const btn = page.locator('.doact button', { hasText: /My Places to follow|Following in My Places|Saving…|Removing…/ });
const msg = page.locator('.doact .hs-follow-msg');
const label = async () => (await btn.innerText()).trim();

ok(await label() === ADD, '0a starts unfollowed', await label());
ok(/does not turn on email alerts/.test(await page.locator('.doact').innerText()), '0b the button says saving does not turn on email alerts');
ok((await msg.getAttribute('role')) === 'status' && (await msg.getAttribute('aria-live')) === 'polite', '0c an accessible status line sits after the button');

// ── 1. pending: no "Following" before the database answers ─────────────────────
await btn.click();
await page.waitForFunction(() => typeof window.__release === 'function');
ok(await label() === 'Saving…', '1a button reads Saving… while the write is pending', await label());
ok(await btn.isDisabled(), '1b button is disabled while saving');
ok(!/Following/.test(await label()), '1c no Following text before confirmation');
ok(await page.evaluate(() => !window.HS.isFollowing('project', 'proj-datacenter')), '1d not marked followed before confirmation');

// ── 2. the database refuses: previous state, visible message, still usable ─────
await page.evaluate(() => window.__release({ data: null, error: { code: '42501', message: 'permission denied for table app_follows' } }));
await page.waitForFunction(() => !document.querySelector('.doact button[aria-busy="true"]'));
ok(await label() === ADD, '2a a refused write restores Add to My Places to follow', await label());
ok((await msg.innerText()).trim() === SAVE_ERR, '2b the error is shown next to the button', await msg.innerText());
ok(!(await btn.isDisabled()), '2c the button is usable for retry');
ok(await page.evaluate(() => !JSON.parse(localStorage.getItem('hs:follows') || '[]').includes('project:proj-datacenter')),
  '2d nothing saved to localStorage on failure');

// ── 3. retry succeeds ─────────────────────────────────────────────────────────
await page.evaluate(() => { window.__answer = { data: null, error: null }; });
await btn.click();
await page.waitForFunction(() => !document.querySelector('.doact button[aria-busy="true"]'));
ok(await label() === ON, '3a retry confirms and reads ✓ Following in My Places', await label());
ok((await msg.innerText()).trim() === '', '3b the error message is cleared');
ok(await page.evaluate(() => window.HS.isFollowing('project', 'proj-datacenter')), '3c followed after confirmation');

// ── 4. unfollow refused, then confirmed ───────────────────────────────────────
await page.evaluate(() => { window.__answer = { data: null, error: { code: '500', message: 'boom' } }; });
await btn.click();
await page.waitForFunction(() => !document.querySelector('.doact button[aria-busy="true"]'));
ok(await label() === ON, '4a a refused delete keeps Following', await label());
ok(/Couldn’t remove from My Places/.test(await msg.innerText()), '4b remove error shown');
await page.evaluate(() => { window.__answer = { data: null, error: null }; });
await btn.click();
await page.waitForFunction(() => !document.querySelector('.doact button[aria-busy="true"]'));
ok(await label() === ADD, '4c confirmed delete unfollows', await label());

// ── 5. duplicate key = already saved ──────────────────────────────────────────
await page.evaluate(() => { window.__answer = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }; });
await btn.click();
await page.waitForFunction(() => !document.querySelector('.doact button[aria-busy="true"]'));
ok(await label() === ON, '5 a 23505 duplicate reads as Following (the row is already saved)', await label());
const writes = await page.evaluate(() => window.__writes.map(w => w.op + ':' + w.row.target_type + ':' + w.row.target_id));
ok(writes.length === 5 && writes.every(w => /:project:proj-datacenter$/.test(w)), '5b every write targets this project on app_follows', writes);

await browser.close();
server.close();
console.log(fails ? '\nFAILED ' + fails : '\nAll follow confirmed-write browser checks passed');
process.exit(fails ? 1 : 0);
