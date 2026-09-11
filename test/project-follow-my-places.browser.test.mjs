// FIX 1 browser proof — project follow copy, persist/reload, unfollow, My Places.
// Seed mode (?data=seed). Auth is the existing requireAuth('follow') gate; this
// suite injects a non-demo session so the click can proceed without OTP.
// Run: node test/project-follow-my-places.browser.test.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP project-follow-my-places.browser.test.mjs — playwright not installed');
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
const PID = 'proj-datacenter';

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext();
const page = await context.newPage();

async function waitReady() {
  await page.waitForFunction(() => window.HS && window.HS.ready);
  await page.evaluate(() => window.HS.ready);
}

async function authAsUser() {
  await page.evaluate(() => {
    window.HS.state.session = { user: { id: 'fix1-test-user' }, demo: false };
    window.HS.requireAuth = function () { return true; };
  });
}

async function followKeys() {
  return page.evaluate(() => {
    const raw = localStorage.getItem('hs:follows');
    let parsed = [];
    try { parsed = raw ? JSON.parse(raw) : []; } catch (e) { parsed = []; }
    return {
      raw: parsed,
      following: !!(window.HS.isFollowing && window.HS.isFollowing('project', 'proj-datacenter')),
      ids: window.HS.followedProjectIds ? window.HS.followedProjectIds() : []
    };
  });
}

async function projectBtn() {
  return page.locator('.doact button', { hasText: /My Places to follow|Following in My Places/ });
}

// ── unfollowed ────────────────────────────────────────────────────────────────
await page.goto(base + '/development.html?data=seed&zip=78617&id=' + PID);
await waitReady();
await authAsUser();
await page.waitForSelector('.doact');
const unfollowed = await (await projectBtn()).innerText();
ok(unfollowed.trim() === ADD, 'unfollowed project shows Add to My Places to follow', unfollowed);

// ── follow ────────────────────────────────────────────────────────────────────
await (await projectBtn()).click();
const followedLabel = await (await projectBtn()).innerText();
ok(followedLabel.trim() === ON, 'after click, button reads ✓ Following in My Places', followedLabel);
const afterFollow = await followKeys();
ok(afterFollow.following === true, 'isFollowing(project, id) is true after click');
ok(afterFollow.ids.filter(id => id === PID).length === 1, 'exactly one project id in followedProjectIds', afterFollow.ids);
ok(afterFollow.raw.filter(k => k === 'project:' + PID).length === 1, 'exactly one project: key in localStorage', afterFollow.raw);

// ── reload restores ───────────────────────────────────────────────────────────
await page.reload();
await waitReady();
await authAsUser();
await page.waitForSelector('.doact');
const afterReload = await (await projectBtn()).innerText();
ok(afterReload.trim() === ON, 'reload restores ✓ Following in My Places', afterReload);
const reloadKeys = await followKeys();
ok(reloadKeys.following === true, 'persisted follow still present after reload');

// ── My Places lists the followed project ──────────────────────────────────────
await page.goto(base + '/properties.html?data=seed');
await waitReady();
await authAsUser();
await page.waitForSelector('#propGrid');
const allHtml = await page.locator('#propGrid').innerHTML();
ok(/SH-130 Data Center Campus/.test(allHtml) && /data-kind="project"/.test(allHtml),
  'All view lists the followed project by name', allHtml.slice(0, 400));
await page.click('#plViews [data-view="projects"]');
const projHtml = await page.locator('#propGrid').innerHTML();
ok(/SH-130 Data Center Campus/.test(projHtml) && /data-kind="project"/.test(projHtml),
  'Projects view lists the followed project');
ok(/Location not listed on this project record/.test(projHtml),
  'seed project without a street address says location is not listed');
ok((await page.locator('button', { hasText: '+ Add Project' }).count()) === 0,
  'My Places has no + Add Project writer');
const placesTile = await page.locator('#propStrip').innerText();
ok(!/SH-130/.test(placesTile),
  'Places strip does not advertise the followed project as a Place');

// ZIP / property / Notify regressions (copy still on those pages)
await page.goto(base + '/property.html?data=seed&id=p1');
await waitReady();
const propBody = await page.content();
ok(/Watch this property/.test(propBody), 'property page still says Watch this property');

await page.goto(base + '/community.html?data=seed&zip=78617');
await waitReady();
const zipCopy = await page.evaluate(() => document.body.innerText);
ok(/Follow this zip code|Following/.test(zipCopy) || /＋ Follow this zip code/.test(await page.content()),
  'ZIP follow control is still the zip-code contract');

// ── unfollow from the project page ────────────────────────────────────────────
await page.goto(base + '/development.html?data=seed&zip=78617&id=' + PID);
await waitReady();
await authAsUser();
await page.waitForSelector('.doact');
ok((await (await projectBtn()).innerText()).trim() === ON, 'still followed before unfollow');
await (await projectBtn()).click();
ok((await (await projectBtn()).innerText()).trim() === ADD, 'unfollow returns Add to My Places to follow');
const afterUnfollow = await followKeys();
ok(afterUnfollow.following === false, 'isFollowing is false after unfollow');
ok(!afterUnfollow.ids.includes(PID), 'followedProjectIds no longer contains the project');

await page.reload();
await waitReady();
await authAsUser();
await page.waitForSelector('.doact');
ok((await (await projectBtn()).innerText()).trim() === ADD, 'reload does not restore a deleted follow');
ok((await followKeys()).following === false, 'deleted follow stays gone after reload');

await page.goto(base + '/properties.html?data=seed');
await waitReady();
await page.waitForSelector('#propGrid');
await page.click('#plViews [data-view="projects"]');
const emptyProjects = await page.locator('#propGrid').innerText();
ok(/No projects followed yet/.test(emptyProjects),
  'Projects view is empty after unfollow', emptyProjects.slice(0, 200));

await browser.close();
server.close();
console.log(fails ? '\nFAILED ' + fails : '\nAll project-follow browser checks passed');
process.exit(fails ? 1 : 0);
