// MY PLACES RAIL — THE THREE GROUP BOUNDARIES ARE ONE BOUNDARY.
// Run: node test/dashboard-rail-section-separation.browser.test.mjs
//
// WHY THIS FILE EXISTS. The rail renders three typed groups inside one card — Property
// Addresses, ZIP Codes, Developments — separated by a hairline rule and 14px+12px of space.
// That separator was declared once, as `.railgroup + .railgroup`, an ADJACENT-SIBLING
// selector. The three groups do NOT share a parent: #dashPlaces holds the two Place groups,
// while Developments lives in #dashFollowing, which Fix 8J hides or removes outright on an
// unreadable session and therefore cannot be folded into the same container. `+` cannot
// cross that boundary, so the third group had NEVER received the separator the other two do.
//
// Measured on main before the fix, at 1440x900 and 390x844 alike: the Addresses -> ZIP Codes
// boundary painted 27px with a 1px rule, and the ZIP Codes -> Developments boundary painted
// 0px with none. A founder reading the live Dashboard reported the consequence rather than
// the cause: DEVELOPMENTS read as a continuation of the ZIP list.
//
// WHY THIS CANNOT BE A MARKUP TEST. Both numbers are correct CSS in isolation; nothing is
// missing from the markup and no rule is malformed. The defect exists only in the COMPUTED
// result of a selector that does not match, which is visible only once a browser has applied
// the cascade to the real DOM. The three groups are also built by three different code paths
// (placeGroups, the empty-state branch, developmentsGroup), so only a rendered page shows
// them as a resident sees them.
//
// WHY THE ASSERTION IS A COMPARISON AND NOT A NUMBER. Pinning "27px" would freeze a value the
// design is free to change and would go stale the first time the rail is restyled. The
// contract is that the LAST boundary matches the FIRST one — three groups, one visual rule —
// so the control travels with the design. The control is measured on the same page, in the
// same paint, as the subject.
//
// NO NETWORK. The supabase-js CDN request is fulfilled locally with a stub; everything else
// is aborted. A route that escaped would make this suite pass or fail on someone else's uptime.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP dashboard-rail-section-separation.browser.test.mjs — playwright not installed');
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

// A chainable no-op client reporting a REAL (demo:false) session, so Fix 8J does not remove
// the Developments carrier. Reads resolve empty — the followed developments render as
// unresolved cards, which is irrelevant here: this suite measures the BOUNDARY above the
// group, not the rows inside it, and the group's heading renders either way.
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
          user: { id: 'rail-sep-test-user', email: 'sep@example.com' } } } });
      },
      signOut: function () { return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    }
  };
} };`;

// Read the two boundaries in one paint. `gap` is the distance from a group's painted bottom
// to the next group's heading top, so it captures margin, padding and rule together — the
// thing an eye actually measures — rather than trusting any one declaration.
const READ = () => {
  const heads = [...document.querySelectorAll('h3.railgh')];
  // Matched on CONTAINS, not startsWith: the headings carry a leading decorative glyph, and
  // pinning the first character would tie this suite to the icon rather than the group.
  const find = (t) => heads.find((h) => h.innerText.trim().toUpperCase().includes(t));
  const addrH = find('ADDRESSES'), zipH = find('ZIP CODES'), devH = find('DEVELOPMENTS');
  const grp = (h) => (h ? h.closest('.railgroup') : null);
  const bot = (el) => (el ? Math.round(el.getBoundingClientRect().bottom) : null);
  const top = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
  const carrier = document.getElementById('dashFollowing');
  const cs = carrier ? getComputedStyle(carrier) : null;
  return {
    headings: heads.map((h) => h.innerText.trim()),
    devVisible: !!(devH && (devH.offsetWidth || devH.offsetHeight || devH.getClientRects().length)),
    controlGap: (grp(addrH) && zipH) ? top(zipH) - bot(grp(addrH)) : null,
    subjectGap: (grp(zipH) && devH) ? top(devH) - bot(grp(zipH)) : null,
    carrierBorderTop: cs ? cs.borderTopWidth : null,
    carrierDisplay: cs ? cs.display : null,
    // --- hierarchy: the heading measured against the rows it introduces, in one paint ---
    hier: (function () {
      const h = heads[0], t = document.querySelector('.placerow .pl'),
            m = document.querySelector('.placerow .ps'), row = document.querySelector('.placerow'),
            grp = heads[1] ? heads[1].closest('.railgroup') : null;
      if (!h || !t || !row || !grp) return null;
      const H = getComputedStyle(h), T = getComputedStyle(t), R = getComputedStyle(row),
            G = getComputedStyle(grp), M = m ? getComputedStyle(m) : null;
      return {
        headSize: parseFloat(H.fontSize), headWeight: parseInt(H.fontWeight, 10),
        headColor: H.color, headTransform: H.textTransform, headLetterSpacing: H.letterSpacing,
        titleSize: parseFloat(T.fontSize), titleWeight: parseInt(T.fontWeight, 10),
        titleColor: T.color, metaSize: M ? parseFloat(M.fontSize) : null,
        rowDivider: R.borderBottomColor, sectionSep: G.borderTopColor,
        // The heading's chip, and the DEVELOPMENT tag in What's Changing it is meant to
        // match. Read together so the comparison is one paint, never two runs.
        chipBg: H.backgroundColor, chipRadius: H.borderRadius, chipDisplay: H.display,
        // Prefer a REAL painted tag; if this fixture's What's Changing is empty, measure what
        // the shipped stylesheet paints for that class by probing it directly. A comparison
        // that SKIPS whenever the fixture has no changes is not a comparison — it would go
        // quiet exactly when someone re-tints one of the two and not the other.
        refChip: (function () {
          let d = document.querySelector('.ctype.dev'), probe = null;
          if (!d) {
            probe = document.createElement('span');
            probe.className = 'ctype dev';
            probe.style.position = 'absolute';
            probe.style.left = '-9999px';
            probe.textContent = 'DEVELOPMENT';
            document.body.appendChild(probe);
            d = probe;
          }
          const C = getComputedStyle(d);
          const out = { bg: C.backgroundColor, color: C.color, probed: !!probe };
          if (probe) probe.remove();
          return out;
        })(),
        metaColor: M ? M.color : null,
        glyphHidden: !!h.querySelector('.railic[aria-hidden="true"]'),
        // What a screen reader is left with once the decorative glyph is dropped.
        spoken: (function () {
          const c = h.cloneNode(true);
          c.querySelectorAll('[aria-hidden="true"]').forEach((e) => e.remove());
          return c.textContent.replace(/\s+/g, ' ').trim();
        })()
      };
    })(),
    // Every group must stay inside the ONE My Places card — the separator must never be
    // mistaken for a card break. Re-asserted here because this change touches the carrier.
    allInOneCard: (function () {
      const card = document.getElementById('dashPlaces')
        ? document.getElementById('dashPlaces').closest('.block') : null;
      return !!card && heads.length === 3 && heads.every((h) => card.contains(h));
    })(),
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth
  };
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
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

// FIXTURE. Four ZIPs, because RAIL_PREVIEW_LIMIT is 3 and four is the smallest number that
// renders the "View all 4 ZIP Codes →" overflow link — the very element Developments was
// painting against. Two follows, so the Developments group renders at all. hs:accountUid
// matches the stub session id, or ensureAccountScope() wipes the fixture on first boot.
const seed = (follows) => `
  try {
    localStorage.setItem('hs:accountUid', JSON.stringify('rail-sep-test-user'));
    localStorage.setItem('hs:myCommunities', JSON.stringify([
      { zip: '78617', name: 'Del Valle', state: 'TX' },
      { zip: '78657', name: 'Horseshoe Bay', state: 'TX' },
      { zip: '75009', name: 'Celina', state: 'TX' },
      { zip: '80202', name: 'Denver', state: 'CO' }
    ]));
    localStorage.setItem('hs:follows', JSON.stringify(${JSON.stringify(follows)}));
  } catch (e) {}`;

const load = async (follows) => {
  await ctx.clearCookies();
  await page.addInitScript(seed(follows));
  await page.goto(base + '/dashboard.html', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.HS && window.HS.ready, { timeout: 30000 });
  await page.waitForSelector('#dashPlaces', { timeout: 30000 });
  await page.waitForTimeout(400);
  return page.evaluate(READ);
};

// ---- §1 Every supported viewport. A rail that only holds at 1440 is not a rail contract. --
for (const [label, w, h] of [['desktop', 1440, 900], ['laptop-1024', 1024, 768],
                             ['tablet-899', 899, 768], ['mobile', 390, 844]]) {
  console.log('\n--- ' + label + ' ' + w + '×' + h + ' ------------------------------------------');
  await page.setViewportSize({ width: w, height: h });
  const r = await load(['project:p-1', 'project:p-2']);

  // PRECONDITION. Without all three groups painted the comparisons below are vacuous —
  // two nulls would compare equal and report a pass over a rail that rendered nothing.
  ok(r.headings.length === 3, label + ' · all three typed groups render', r.headings);
  ok(r.devVisible, label + ' · the Developments heading is actually painted', r);
  ok(r.controlGap != null && r.controlGap > 0,
    label + ' · CONTROL: the Addresses → ZIP Codes boundary is a real gap', r.controlGap);

  // THE DEFECT ITSELF. 0 was the measured value on main, at every viewport.
  ok(r.subjectGap != null && r.subjectGap > 0,
    label + ' · the ZIP Codes → Developments boundary is not flush', r.subjectGap);

  // THE CONTRACT. Three groups, one boundary — measured against the control in the same paint.
  ok(r.subjectGap === r.controlGap,
    label + ' · the last boundary matches the first', { subject: r.subjectGap, control: r.controlGap });

  ok(r.carrierBorderTop === '1px',
    label + ' · the Developments carrier paints the hairline rule', r.carrierBorderTop);
  ok(r.allInOneCard, label + ' · all three groups stay inside the ONE My Places card', r);
  ok(r.scrollW <= r.clientW + 1, label + ' · no horizontal page scroll', r);
}

// ---- §3 THE HEADING OUTRANKS THE ROWS IT INTRODUCES ---------------------------------------
// The defect this guards is an INVERTED hierarchy, not merely a small font. Measured on
// production before the fix: headings painted 10.5px/700 in --ink-3 (#83918a) while the record
// titles beneath them painted 13.3px/600 in --ink (#16211c) — a section header smaller AND
// paler than its own contents, in the same tiny letter-spaced all-caps this card uses for
// METADATA. That is why the three groups had to be re-read to be told apart.
//
// Asserted as a RELATIONSHIP to the row titles measured in the same paint, never as literal
// pixel values, so a future restyle of the card cannot make this suite stale — only an
// inversion can fail it.
console.log('\n--- §3 heading vs. the rows it introduces --------------------------------------');
await page.setViewportSize({ width: 1440, height: 900 });
const hv = await load(['project:p-1', 'project:p-2']);
const H = hv.hier;
ok(!!H, '§3 precondition: a heading and a record row are both painted', H);
if (H) {
  ok(H.headSize > H.titleSize,
    '§3a the heading is LARGER than the record titles under it', { head: H.headSize, title: H.titleSize });
  ok(H.headWeight >= H.titleWeight,
    '§3b ...and no lighter in weight', { head: H.headWeight, title: H.titleWeight });
  // FOUNDER CALL: the heading is the same tinted chip the DEVELOPMENT tag carries in What's
  // Changing. So the invariant is no longer "same ink as the record titles" — it is that the
  // heading is NOT the muted metadata grey, and that it uses the REFERENCE tag's own tokens
  // rather than a second green mixed by hand. Asserted against the live .ctype.dev in the
  // same paint, so the two can never drift apart silently.
  ok(H.headColor !== H.metaColor,
    '§3c the heading is not the muted metadata grey', { head: H.headColor, meta: H.metaColor });
  ok(H.chipBg !== 'rgba(0, 0, 0, 0)' && H.chipBg !== 'transparent',
    '§3c2 ...it carries a filled chip rather than bare text', H.chipBg);
  if (H.refChip) {
    ok(H.chipBg === H.refChip.bg,
      '§3c3 ...on the SAME tint as the DEVELOPMENT tag in What\'s Changing',
      { heading: H.chipBg, reference: H.refChip.bg });
    ok(H.headColor === H.refChip.color,
      '§3c4 ...in the SAME green ink as that tag', { heading: H.headColor, reference: H.refChip.color });
  } else {
    ok(false, '§3c3/§3c4 could not read the reference tag at all', H.refChip);
  }
  // It must HUG its label. A full-width bar reads as a section banner and starts competing
  // with the card title, which is not what the reference tag does.
  ok(H.chipDisplay === 'inline-block' || H.chipDisplay === 'inline-flex',
    '§3c5 ...and hugs its label rather than spanning the card', H.chipDisplay);
  ok(H.headTransform !== 'uppercase',
    '§3d ...and is not the all-caps treatment this card reserves for metadata', H.headTransform);
  ok(H.metaSize === null || H.metaSize < H.titleSize,
    '§3e secondary metadata stays subordinate to the record title',
    { meta: H.metaSize, title: H.titleSize });
  // The whole point of requirement 7: a boundary between TYPES must not look like a boundary
  // between two rows of one type. Before the fix both were var(--line-2), byte-identical.
  ok(H.sectionSep !== H.rowDivider,
    '§3f the SECTION separator is a different colour from the ROW divider',
    { section: H.sectionSep, row: H.rowDivider });
  ok(H.glyphHidden, '§3g the heading glyph is decorative (aria-hidden)', H.glyphHidden);
  ok(/^Addresses \(\d+\)$/.test(H.spoken),
    '§3h ...so the heading still SPEAKS its name and count with the icon removed', H.spoken);
}

// ---- §4 A TYPED GROUP WITH ZERO MEMBERS STILL NAMES ITSELF --------------------------------
// An empty Addresses group beside a populated ZIP Codes one is a true statement about that
// type, not a defect — and its heading must carry the same treatment, or the card gains a
// fourth visual rank nobody designed.
console.log('\n--- §4 the empty typed group ---------------------------------------------------');
const empty = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h3.railgh')]
    .find((x) => /ADDRESSES/.test(x.innerText.toUpperCase()));
  const g = h ? h.closest('.railgroup') : null;
  return { heading: h ? h.innerText.trim() : null,
           note: g ? !!g.querySelector('.railempty') : null,
           size: h ? parseFloat(getComputedStyle(h).fontSize) : null };
});
ok(/\(0\)$/.test(empty.heading || ''), '§4a the empty group still states a count of zero', empty);
ok(empty.note === true, '§4b ...and renders its honest empty note rather than vanishing', empty);
ok(empty.size === (H ? H.headSize : null),
  '§4c ...at the same heading rank as a populated group', empty.size);

// ---- §2 THE OVER-FLAGGING DIRECTION -------------------------------------------------------
// A separator declared on the CARRIER rather than on a group could leave a rule hanging under
// the rail when the group it introduces is hidden — a divider that divides nothing, which is
// the same comprehension defect from the other side. At zero follows Fix 8J hides the carrier,
// and a hidden carrier must paint nothing at all.
console.log('\n--- zero follows: the carrier is hidden and leaves no rule behind ----------------');
await page.setViewportSize({ width: 1440, height: 900 });
const z = await load([]);
ok(z.headings.length === 2, 'zero follows · only the two Place groups render', z.headings);
ok(z.carrierDisplay === 'none', 'zero follows · the Developments carrier paints nothing', z.carrierDisplay);
ok(z.controlGap != null && z.controlGap > 0,
  'zero follows · CONTROL: the Addresses → ZIP Codes boundary is unaffected', z.controlGap);

ok(pageErrors.length === 0, 'no uncaught page errors', pageErrors);

await browser.close();
server.close();
console.log('\n' + (fails ? 'FAILED: ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
