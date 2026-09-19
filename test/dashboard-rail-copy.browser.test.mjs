// DASHBOARD RAIL COPY — the rendered proof, at every supported viewport.
// Run: node test/dashboard-rail-copy.browser.test.mjs
//
// WHY THIS FILE EXISTS ALONGSIDE test/dashboard-rail-copy.test.mjs. That suite reads the
// markup; this one reads what a browser actually paints. Two things can only be answered
// here. First, the PROJECTS card is invisible to every existing browser suite: Fix 8J
// REMOVES the node outright unless a real, non-demo session is present, so the signed-out
// rail is (correctly) two cards and its new heading has never been rendered in a test. This
// suite injects a session through the same supabase-js seam saved-place-identity uses, so
// the heading is asserted where a resident would see it. Second, a longer word in a
// fixed-width rail is a layout change even when it is "only copy" — "My Places" is longer
// than "Your Places" is not, but "Projects" sits beside a "Manage →" link in a flex row, and
// at 390px that row is the narrowest thing on the page.
//
// NO NETWORK. The supabase-js CDN request is fulfilled locally with a stub; nothing else is
// allowed out. A route that escaped would make this suite pass or fail on someone else's
// uptime.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP dashboard-rail-copy.browser.test.mjs — playwright not installed');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (d !== undefined) console.log('           detail: ' + JSON.stringify(d).slice(0, 300)); }
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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// The seam: a chainable no-op client whose auth reports a REAL (demo:false) session. Reads
// resolve empty, so every card renders its honest empty state — which is all this suite
// needs, and keeps the fixture from becoming a second source of truth about content.
const STUB = `
window.supabase = { createClient: function () {
  function table() {
    var api = {};
    ['select','insert','update','upsert','delete','eq','neq','in','is','or','not','gt','gte',
     'lt','lte','like','ilike','contains','overlaps','order','limit','range','filter']
      .forEach(function (m) { api[m] = function () { return api; }; });
    var settled = { data: [], error: null };
    api.single = function () { return Promise.resolve({ data: null, error: { code: 'PGRST116' } }); };
    api.maybeSingle = function () { return Promise.resolve({ data: null, error: null }); };
    api.then = function (res, rej) { return Promise.resolve(settled).then(res, rej); };
    return api;
  }
  return {
    from: table,
    rpc: function () { return Promise.resolve({ data: null, error: null }); },
    functions: { invoke: function () { return Promise.resolve({ data: null, error: null }); } },
    auth: {
      getSession: function () {
        return Promise.resolve({ data: { session: {
          user: { id: 'rail-copy-test-user', email: 'rail@example.com' } } } });
      },
      signOut: function () { return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    }
  };
} };`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// FIXTURE: four followed ZIPs in this browser's OWN localStorage. Nothing is written to any
// database — HS.followedCommunities() reads `hs:myCommunities`, and the only writer this
// exercises is the stub client's no-op insert. `hs:accountUid` is seeded to the same id the
// stub session reports, because ensureAccountScope() clears every account-scoped key on an
// account-id CHANGE and would otherwise wipe the fixture on first boot.
//
// Four, not three: RAIL_PREVIEW_LIMIT is 3, so four is the smallest number that renders an
// overflow link. Without it the overflow assertions below pass VACUOUSLY over an empty list.
// Property Addresses stays empty on purpose (app_properties reads resolve []), so the same
// page proves both shapes at once — a populated group that hides rows, and a typed group
// that is honestly empty beside it.
await page.addInitScript(() => {
  try {
    localStorage.setItem('hs:accountUid', JSON.stringify('rail-copy-test-user'));
    localStorage.setItem('hs:myCommunities', JSON.stringify([
      { zip: '84302', name: 'Brigham City', state: 'UT' },
      { zip: '84337', name: 'Tremonton', state: 'UT' },
      { zip: '78617', name: 'Del Valle', state: 'TX' },
      { zip: '80202', name: 'Denver', state: 'CO' }
    ]));
  } catch (e) { /* a storage-blocked context fails the fixture assertions loudly, not here */ }
});
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('cdn.jsdelivr.net')) {
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  }
  return route.abort();
});

const READ = () => {
  const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
             r: Math.round(b.right) }; };
  const railEl = document.querySelectorAll('.cols > div')[1];
  const heads = [...railEl.querySelectorAll('h2')];
  return {
    session: !!(window.HS.state.session && !window.HS.state.session.demo),
    rail: heads.map((h) => h.innerText.trim()),
    cards: heads.map((h) => {
      const row = h.parentElement;
      const cta = row.querySelector('a');
      const cs = getComputedStyle(h);
      return {
        text: h.innerText.trim(),
        fontPx: parseFloat(cs.fontSize),
        transform: cs.textTransform,
        visible: !!(h.offsetWidth || h.offsetHeight || h.getClientRects().length),
        h2: box(h), cta: box(cta), row: box(row), block: box(row.parentElement)
      };
    }),
    supporting: (document.body.innerText.match(/Projects you chose to monitor\./g) || []).length,
    oldCopy: /Your Places|\bFollowing\b/.test(document.body.innerText),
    railText: railEl.innerText,
    // The dormant Premium card. It is read through its RENDERED text, not its markup, so a
    // node that exists but paints nothing cannot satisfy it.
    devPremium: (function () {
      const el = document.getElementById('dashDevUpdatesPremium');
      if (!el) return false;
      const b = el.getBoundingClientRect();
      return !!(b.width && b.height)
        && /Development Updates\s*\u00b7\s*Premium/i.test(el.innerText)
        && /Coming soon/.test(el.innerText)
        && /We\u2019re building a way to follow one development\u2019s own official record over time/
             .test(el.innerText);
    })(),
    noAlerts: /Today, saving a Development to My Places lets you reopen it\. It does not send alerts\./
      .test((document.getElementById('dashDevUpdatesPremium') || { innerText: '' }).innerText),
    // The three PROHIBITED bullets, plus any present-tense claim that a Development Updates
    // feed exists today. Read across the WHOLE page: the claim is forbidden wherever it lands,
    // not only inside the card.
    forbiddenClaims: (function () {
      const t = document.body.innerText;
      return [
        'Development status changes',
        'New applications, cases, and permits',
        'Upcoming meetings and official decisions'
      ].filter((s) => t.indexOf(s) !== -1);
    })(),
    // Typed group headings, each carrying its own count.
    groupHeads: [...document.querySelectorAll('h3.railgh')].map((h) => h.innerText.trim()),
    // ...and every one of them inside the ONE My Places card (the .block holding #dashPlaces).
    h3InsideCard: (function () {
      const card = (document.getElementById('dashPlaces') || {}).closest
        ? document.getElementById('dashPlaces').closest('.block') : null;
      const hs = [...document.querySelectorAll('h3.railgh')];
      return !!card && hs.length > 0 && hs.every((h) => card.contains(h));
    })(),
    // A capped preview must not become a scroll box. Count anything inside the card whose
    // content overflows its own painted height or width.
    railScroll: (function () {
      const card = (document.getElementById('dashPlaces') || {}).closest
        ? document.getElementById('dashPlaces').closest('.block') : null;
      if (!card) return -1;
      return [card, ...card.querySelectorAll('*')].filter((e) =>
        e.scrollHeight - e.clientHeight > 1 || e.scrollWidth - e.clientWidth > 1).length;
    })(),
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth
  };
};

// Every supported viewport: a rail that only holds at 1440 is not a rail contract. 899 is
// the pixel below the layout's own breakpoint, i.e. the widest single-column case.
for (const [label, w, h] of [['desktop', 1440, 900], ['laptop-1024', 1024, 768],
                             ['tablet-899', 899, 768], ['mobile', 390, 844]]) {
  console.log('\n--- ' + label + ' ' + w + '×' + h + ' ------------------------------------------------');
  await page.setViewportSize({ width: w, height: h });
  await page.goto(base + '/dashboard.html', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.HS && window.HS.ready, { timeout: 30000 });
  // The My Places card always renders; the Developments GROUP inside it is hidden at zero
  // follows, so waiting on that group would hang forever on a fixture with none.
  await page.waitForSelector('#dashPlaces', { timeout: 30000 });
  const got = await page.evaluate(READ);

  // POSITIVE CONTROL. Without a real session Fix 8J removes the Developments group, and
  // every assertion about it would then be true of nothing.
  ok(got.session, '[' + label + '] a real (non-demo) session is present',
    got.session);

  // §5.1/.3/.6 — the rail is exactly TWO cards now: the unified inventory card and Stay
  // Informed. The Premium card uses the shared .p2 component and carries no h2.
  ok(got.rail.join(' | ') === 'My Places | Stay Informed',
    '[' + label + '] rail renders My Places → Stay Informed', got.rail);
  // §5.2/.4 — and neither old heading is anywhere on the page.
  ok(!got.oldCopy, '[' + label + '] no rendered text reads "Your Places" or "Following"',
    (got.railText.match(/.{0,40}(?:Your Places|Following).{0,40}/) || [])[0]);
  // §5.5 — the old supporting sentence is gone with its card, and the no-alerts disclosure
  // it used to carry now renders permanently on the Premium card instead of only in a
  // zero-state a resident with follows would never see.
  ok(got.supporting === 0, '[' + label + '] "Projects you chose to monitor." no longer renders',
    got.supporting);
  ok(got.devPremium, '[' + label + '] the dormant Development Updates Premium card renders');
  ok(got.noAlerts, '[' + label + '] ...stating that saving a Development sends no alerts');
  // `[]` is TRUTHY, so `!got.forbiddenClaims` would have been false on a CLEAN page — a pin
  // that fails when the rule holds. Count the members instead.
  ok(got.forbiddenClaims.length === 0,
    '[' + label + '] ...and claims no capability that does not exist', got.forbiddenClaims);
  // Typed group headings, each carrying its own count, inside the ONE card.
  ok(got.groupHeads.length >= 2, '[' + label + '] typed group headings render', got.groupHeads);
  // "Label (N)" since the headings gained icons; what is pinned is that EVERY heading ends in
  // its own count, never the punctuation that carries it.
  ok(got.groupHeads.every((t) => /\(\d+\)$/.test(t)),
    '[' + label + '] every group heading carries its own count', got.groupHeads);
  ok(got.h3InsideCard, '[' + label + '] group headings are h3 inside the My Places card');
  ok(got.railScroll === 0, '[' + label + '] the rail card introduces no internal scrolling',
    got.railScroll);

  // §5.12 — readable, unclipped, non-overlapping, no duplicate heading, no overflow.
  const seen = new Set();
  for (const c of got.cards) {
    ok(!seen.has(c.text), '[' + label + '] "' + c.text + '" is not a duplicate card heading');
    seen.add(c.text);
    ok(c.visible && c.h2.w > 0 && c.h2.h > 0 && c.fontPx >= 12,
      '[' + label + '] "' + c.text + '" is rendered and readable (' + c.fontPx + 'px)',
      { visible: c.visible, box: c.h2, fontPx: c.fontPx });
    // Case is what the markup says: .bt-row h2 applies no text-transform.
    ok(c.transform === 'none', '[' + label + '] "' + c.text + '" renders in its markup case', c.transform);
    // Not clipped by its own card, horizontally or vertically.
    ok(c.h2.x >= c.block.x - 1 && c.h2.r <= c.block.x + c.block.w + 1
       && c.h2.y >= c.block.y - 1 && c.h2.y + c.h2.h <= c.block.y + c.block.h + 1,
      '[' + label + '] "' + c.text + '" sits inside its card, unclipped', { h2: c.h2, block: c.block });
    // Not overlapping the "Manage →" link it shares the flex row with.
    if (c.cta)
      ok(c.h2.r <= c.cta.x + 1 || c.cta.r <= c.h2.x + 1
         || c.h2.y + c.h2.h <= c.cta.y + 1 || c.cta.y + c.cta.h <= c.h2.y + 1,
        '[' + label + '] "' + c.text + '" does not overlap its Manage → link', { h2: c.h2, cta: c.cta });
  }
  ok(got.scrollW <= got.clientW, '[' + label + '] no horizontal overflow',
    { scrollW: got.scrollW, clientW: got.clientW });

  // §5.7 — the CTAs still route where they always did.
  const routes = await page.evaluate(() => ({
    places: (document.getElementById('dashManagePlaces') || {}).getAttribute
      ? document.getElementById('dashManagePlaces').getAttribute('href') : null,
    placesText: (document.getElementById('dashManagePlaces') || {}).innerText,
    manageCount: document.querySelectorAll('.bt-row a').length,
    // Overflow controls are ANCHORS, never Fix 8K's in-place button, and each routes to an
    // existing filtered My Places view.
    overflow: [...document.querySelectorAll('a.railmore')].map((a) => a.getAttribute('href')),
    overflowIsButton: !!document.querySelector('button.railmore')
  }));
  ok(routes.places === 'properties.html',
    '[' + label + '] the one Manage CTA keeps its id and route', routes);
  ok(routes.placesText.trim() === 'Manage →',
    '[' + label + '] the Manage → copy is unchanged', routes);
  ok(!routes.overflowIsButton, '[' + label + '] no overflow control is a button');
  // POSITIVE CONTROL for the line below: `every` on an empty list is true, so without this
  // the route assertion would report PASS on a page carrying no overflow control at all.
  ok(routes.overflow.length >= 1,
    '[' + label + '] the seeded 4th ZIP renders an overflow control', routes.overflow);
  ok(routes.overflow.every((h) => /^properties\.html\?view=(addresses|zips|projects)$/.test(h)),
    '[' + label + '] every overflow link routes to an existing filtered view', routes.overflow);

  // §5.8 — Fix 8I: eyebrow + single h1, undisturbed by a rail rename.
  const head = await page.evaluate(() => ({
    eyebrow: (document.querySelector('.dashhead .eyebrow') || {}).innerText,
    h1Count: document.querySelectorAll('h1').length,
    h1Id: (document.querySelector('h1') || {}).id
  }));
  ok(head.eyebrow === 'DASHBOARD' && head.h1Count === 1 && head.h1Id === 'dashSub',
    '[' + label + '] Fix 8I header intact — DASHBOARD eyebrow, one #dashSub h1', head);

  // §5.9 — Fix 8G: no live ZIP attribution claim rendered.
  const attribution = await page.evaluate(() => /Affects \d+ of your places/.test(document.body.innerText));
  ok(!attribution, '[' + label + '] Fix 8G holds — no "Affects N of your places" renders');
}

ok(pageErrors.length === 0, 'no uncaught page errors across all four viewports', pageErrors);

await browser.close();
server.close();
console.log(fails ? '\n' + fails + ' failed' : '\nAll Dashboard rail copy browser assertions passed.');
process.exit(fails ? 1 : 0);
