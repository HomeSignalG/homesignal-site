// CANDIDATE CRAWLER PROOF — runs against the built _site artifact over a local static
// server, so it proves the INITIAL HTTP RESPONSE contract before any deployment exists.
//
// It asserts the two things a post-JS DOM check cannot: that the bytes a crawler receives
// already carry the SEO contract, and that executing JavaScript does not reverse it.
//
// CONTROLS are DERIVED from the build each run (see resolveControls below) and each class is
// asserted NON-EMPTY, so a ZIP crossing Rule F by normal ingestion substitutes and reports
// instead of reddening the build. point_dense stays pinned. The classes are the founder's A–J:
//   A pass_dev_pass  Alerts PASS + development PASS
//   B pass_dev_fail  Alerts PASS + development FAIL   <- Alerts alone qualifies a page
//   C fail_dev_pass  Alerts FAIL + development PASS   <- development cannot qualify one
//   D fail_dev_fail  Alerts FAIL + development FAIL
//   E local_news     Rule F carried by local news only
//   F weather_thin   weather present, still under Rule F  <- weather never counts
//   G honest_empty   no qualifying records at all
//   H fanout         one jurisdiction's notices across many ZIPs
//   I               anonymous render (every request here is anonymous, no address, no home)
//   J point_dense    the densest development ZIP: no coordinate may leak onto its page
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const SITE = process.env.SITE_DIR || '_site';
const PORT = 8099;
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
                '.json':'application/json', '.xml':'application/xml' };
const UA_MOB = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const UA_DESK = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(SITE, p);
  try {
    if (!(await stat(f)).isFile()) throw new Error('dir');
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>'); }
});

const grab = (h, re) => { const m = re.exec(h); return m ? m[1].trim() : null; };
const get = (base, z, ua) =>
  fetch(`${base}/community/${z}/`, { headers: ua ? { 'User-Agent': ua } : {} });

// ── CONTROL RESOLUTION: PIN WHEN VALID, SUBSTITUTE WHEN DRIFTED, FAIL WHEN EMPTY ───────
//
// ⚖️ CORRECTING MY OWN ARGUMENT (2026-09-11). Earlier the same day I kept these controls
// FROZEN and justified it like this: "a control derived from the same build it tests cannot
// catch a build-wide misclassification, because the class would come back empty and the
// assertion would pass over nothing." The premise is right and the conclusion does not
// follow — it is answered by ONE extra assertion. Assert the class is NON-EMPTY and a
// build-wide misclassification fails loudly, which is the exact case freezing was
// protecting. Freezing was never the only way to get that property; it was just the way
// that also made normal ingestion turn `pages` red, which stops the site updating.
//
// So the pins stay as PREFERENCES, not requirements:
//   * the pinned ZIP still qualifies -> use it, so day-to-day the proof tests the same
//     pages and stays comparable run to run;
//   * it has drifted out of its class -> substitute the first qualifying ZIP and SAY SO,
//     loudly, in the log. Drift stays VISIBLE, which was the founder's stated intent —
//     it just stops being an outage.
//   * the class is EMPTY -> hard failure. That is the build-wide misclassification, and it
//     is now asserted rather than hoped for.
//
// 07010, 01002 and 04401 each cost a red build for this; rule_f_pass read 8,291 / 8,380 /
// 8,372 across three builds, TWO OF THEM ON THE SAME COMMIT.
const CLASSIFY = {
  // [name, predicate(f) -> boolean] where f is the per-ZIP facts below.
  pass_dev_pass: (f) => f.idx && f.dev,
  pass_dev_fail: (f) => f.idx && !f.dev,
  fail_dev_pass: (f) => !f.idx && f.dev,
  fail_dev_fail: (f) => !f.idx && !f.dev,
  local_news:    (f) => f.idx && f.lnList,          // Rule F carried with local news present
  weather_thin:  (f) => !f.idx && f.weather,        // weather never counts toward Rule F
  honest_empty:  (f) => f.emptyGn && f.emptyUm,
  fanout:        (f) => f.gnList,
};

// point_dense is NOT derived: it is the single hardest case for the no-leak assertion
// (the densest development ZIP), and "some page with no leak" is a weaker test than
// "the worst page has no leak". It stays pinned.
const PINNED_ONLY = new Set(['point_dense']);

// PURE HALF #1 — read the built documents and bucket every ZIP into its classes.
// Exported so the behaviour can be driven offline against a synthetic _site, which is the
// only way to prove the substitution and empty-class paths without a live build.
export async function classifyMembers(SITE, man, deps = {}) {
  const rd = deps.readdir || (await import('node:fs/promises')).readdir;
  const rf = deps.readFile || readFile;
  const idx = new Set(man.indexable_zips);
  const dev = new Set(man.dev_indexable_zips || []);
  if (!dev.size) throw new Error('manifest has no dev_indexable_zips — rebuild with the current generator');

  const dirs = (await rd(join(SITE, 'community'), { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d{5}$/.test(d.name)).map((d) => d.name).sort();

  // ONE pass, sorted, so the choice is deterministic: two builds of the same artifact pick
  // the same ZIP and a substitution is reproducible rather than incidental.
  const members = Object.fromEntries(Object.keys(CLASSIFY).map((k) => [k, []]));
  for (const z of dirs) {
    let h; try { h = await rf(join(SITE, 'community', z, 'index.html'), 'utf8'); } catch { continue; }
    const f = {
      idx: idx.has(z), dev: dev.has(z),
      weather: /<h2>Weather alerts<\/h2>/.test(h),
      lnList:  /<h2>Local news<\/h2><ul>/.test(h),
      gnList:  /<h2>Government notices<\/h2><ul>/.test(h),
      emptyGn: h.includes('No government notices on file for this ZIP yet.'),
      emptyUm: h.includes('No upcoming public meetings on file for this ZIP yet.'),
    };
    for (const [k, pred] of Object.entries(CLASSIFY)) if (pred(f)) members[k].push(z);
  }
  return members;
}

// PURE HALF #2 — decide what each control is, given the pins and the measured membership.
// Returns the chosen controls, the classes that are EMPTY (hard failures), and the
// substitutions to report. No I/O, no assertions: the caller owns both.
export function chooseControls(pins, members) {
  const controls = { ...pins };
  const empties = [];
  const notes = [];
  for (const [k, list] of Object.entries(members)) {
    if (PINNED_ONLY.has(k)) continue;
    if (!list.length) { empties.push(k); continue; }
    if (pins[k] && list.includes(pins[k])) { controls[k] = pins[k]; continue; }
    controls[k] = list[0];
    // ⚠️ ONLY A REAL DRIFT IS REPORTED. An UNPINNED class resolving to its first member is
    // the normal path, not a substitution — and once the pins are trimmed to point_dense
    // alone, noting it would print a "no longer qualifies" line for every class on every
    // build. A notice that fires always is the same as no notice, and it would bury the one
    // line that means something.
    if (pins[k]) {
      notes.push(`  ${k}: pinned ${pins[k]} no longer qualifies -> using ${controls[k]} `
        + `(${list.length} member(s); next: ${list.slice(0, 5).join(' ')})`);
    }
  }
  return { controls, empties, notes };
}

async function resolveControls(SITE, man, pins) {
  const members = await classifyMembers(SITE, man);
  const { controls, empties, notes } = chooseControls(pins, members);
  for (const k of Object.keys(CLASSIFY)) {
    if (PINNED_ONLY.has(k)) continue;
    ok(!empties.includes(k), `control class ${k} is NON-EMPTY (${(members[k] || []).length} member(s)) — `
      + `an empty class would let its assertion pass over nothing`);
  }
  if (notes.length) {
    console.log('\n----- CONTROL SUBSTITUTIONS (drift is visible, not fatal) -----');
    for (const n of notes) console.log(n);
    console.log('  Update the pins in .github/workflows/pages.yml when convenient — the proof');
    console.log('  is already testing the right pages either way.');
    console.log('---------------------------------------------------------------');
  }
  return controls;
}

const main = async () => {
  await new Promise((r) => server.listen(PORT, r));
  const base = `http://127.0.0.1:${PORT}`;
  // The manifest is read up front now: control resolution needs it. The later sitemap
  // reconciliation reads the same object rather than re-reading the file.
  const man = JSON.parse(await readFile(join(SITE, 'zip-pages-manifest.json'), 'utf8'));
  const PINS = JSON.parse(process.env.CONTROLS || '{}');
  if (!PINS.point_dense) throw new Error('CONTROLS is missing point_dense (the one pin that is not derived)');
  const C = await resolveControls(SITE, man, PINS);
  for (const k of ['pass_dev_pass', 'pass_dev_fail', 'fail_dev_pass', 'fail_dev_fail',
                   'local_news', 'weather_thin', 'honest_empty', 'fanout', 'point_dense']) {
    if (!C[k]) throw new Error(`no control resolved for ${k}`);
  }
  console.log('controls: ' + Object.entries(C).map(([k, v]) => `${k}=${v}`).join(' '));
  const P = C.pass_dev_fail, F = C.fail_dev_pass;   // the two page-purpose-separation halves

  // ---- initial HTTP response, three user agents -----------------------------------------
  const seen = {};
  for (const [label, ua] of [['normal', null], ['gbot-mobile', UA_MOB], ['gbot-desktop', UA_DESK]]) {
    for (const z of [P, F]) {
      const r = await get(base, z, ua);
      const h = await r.text();
      seen[`${label}:${z}`] = h;
      if (label === 'normal') {
        const wantIdx = z === P;
        ok(r.status === 200, `[${z}] initial response is HTTP 200`);
        ok(h.includes(`content="${wantIdx ? 'index, follow' : 'noindex, follow'}"`),
           `[${z}] initial HTML carries ${wantIdx ? 'index, follow' : 'noindex, follow'}`);
        ok(grab(h, /<link rel="canonical" href="([^"]+)"/) === `https://homesignal.net/community/${z}/`,
           `[${z}] canonical is the ZIP path`);
        ok((grab(h, /<title>([^<]+)<\/title>/) || '').includes(z) ||
           (grab(h, /<h1>([^<]+)<\/h1>/) || '').includes(z), `[${z}] title/H1 carry the ZIP identity`);
        ok(/<h1>[^<]*\d{5}[^<]*<\/h1>/.test(h), `[${z}] ZIP-specific H1 present`);
        ok(/<meta name="description" content="[^"]{40,}"/.test(h), `[${z}] meta description present`);
        ok(!/distance_mi|data-home|\bmi<\/|home_lat|centroid/.test(h),
           `[${z}] no distance/HOME/centroid anywhere in the initial HTML`);
        for (const head of ['Government notices', 'Upcoming public meetings', 'Local news']) {
          ok(h.includes(`<h2>${head}</h2>`), `[${z}] the ${head} heading is in the initial HTML`);
        }
        if (wantIdx) ok(/<section class="zsec"><h2>[^<]+<\/h2><ul>/.test(h),
           `[${z}] initial HTML contains actual Alerts items`);
      }
    }
  }
  ok(seen[`normal:${P}`] === seen[`gbot-mobile:${P}`] && seen[`normal:${P}`] === seen[`gbot-desktop:${P}`],
     'Googlebot smartphone and desktop receive byte-identical HTML — no cloaking');
  ok(seen[`normal:${P}`] !== seen[`normal:${F}`], 'two ZIPs return different documents');

  // ---- the remaining frozen controls, on the initial response ---------------------------
  const body = {};
  for (const k of ['pass_dev_pass', 'fail_dev_fail', 'local_news', 'weather_thin',
                   'honest_empty', 'fanout', 'point_dense']) {
    const r = await get(base, C[k]);
    ok(r.status === 200, `[${C[k]}] ${k}: HTTP 200`);
    body[k] = await r.text();
  }
  ok(body.pass_dev_pass.includes('content="index, follow"'),
     `A [${C.pass_dev_pass}] Alerts PASS + development PASS is index-eligible`);
  ok(body.fail_dev_fail.includes('content="noindex, follow"'),
     `D [${C.fail_dev_fail}] Alerts FAIL + development FAIL is noindex, follow`);
  ok(/<h2>Local news<\/h2><ul>/.test(body.local_news),
     `E [${C.local_news}] the local news that qualifies this page is IN the page`);
  ok(body.weather_thin.includes('content="noindex, follow"'),
     `F [${C.weather_thin}] a weather-only/thin page stays noindex — weather never carries Rule F`);
  ok(/<h2>Weather alerts<\/h2>/.test(body.weather_thin),
     `F [${C.weather_thin}] ...while weather is still DISPLAYED`);
  ok(body.honest_empty.includes('No government notices on file for this ZIP yet.')
     && body.honest_empty.includes('No upcoming public meetings on file for this ZIP yet.'),
     `G [${C.honest_empty}] an honest-empty page names every section and says so truthfully`);
  ok(/<h2>Government notices<\/h2><ul>/.test(body.fanout),
     `H [${C.fanout}] a jurisdiction's notices still fan out onto its ZIP page`);
  ok(!/\d+(\.\d+)?\s*mi\b|centroid|distance_mi|radius/i.test(body.point_dense),
     `J [${C.point_dense}] the densest development ZIP leaks no point/radius/distance string`);

  // ---- unknown / non-canonical ZIP -------------------------------------------------------
  const bad = await fetch(`${base}/community/00000/`);
  ok(bad.status === 404, 'a non-canonical ZIP path is not a page (404, never an indexable shell)');

  // ---- sitemap reconciliation over the real artifact -------------------------------------
  const sm = await readFile(join(SITE, 'sitemap.xml'), 'utf8');
  const smZips = [...sm.matchAll(/<loc>[^<]*\/community\/(\d{5})\/<\/loc>/g)].map((m) => m[1]);
  ok(!/community\.html\?zip=/.test(sm), 'the artifact sitemap no longer advertises the legacy URL');
  ok(smZips.length === man.rule_f_pass,
     `the sitemap advertises exactly the Rule F pass set (${smZips.length} = ${man.rule_f_pass})`);
  ok(smZips.includes(C.pass_dev_fail) && !smZips.includes(C.fail_dev_pass),
     'an Alerts-PASS page is advertised and an Alerts-FAIL page is not');
  ok(/homesignalmap\.html\?zip=/.test(sm),
     'the development half of the sitemap survives untouched (page-purpose separation)');

  // ---- JavaScript must not reverse the build-time decision -------------------------------
  // Every context below is ANONYMOUS: no session, no saved property, no address (control I).
  const browser = await chromium.launch();
  for (const z of [P, F, C.pass_dev_pass]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${base}/community/${z}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3500);
    const after = await page.evaluate(() => ({
      robots: (document.querySelector('meta[name=robots]') || {}).content || null,
      canonical: (document.querySelector('link[rel=canonical]') || {}).href || null,
      h1: (document.querySelector('h1') || {}).textContent || null,
      title: document.title,
      ssrItems: document.querySelectorAll('#hs-ssr li').length,
      rendered: (document.body.innerText || '').length,
      text: (document.body.innerText || '').slice(0, 4000),
    }));
    const want = z === F ? 'noindex, follow' : 'index, follow';
    ok(after.robots === want, `[${z}] robots is STILL "${want}" after JavaScript executes`);
    ok((after.canonical || '').endsWith(`/community/${z}/`), `[${z}] canonical survives hydration`);
    ok((after.h1 || '').includes(z), `[${z}] ZIP identity survives hydration`);
    ok(after.title.includes(z), `[${z}] the ZIP-specific title survives hydration`);
    ok(after.rendered > 200, `[${z}] the hydrated page renders real content (${after.rendered} chars)`);
    ok(errs.length === 0, `[${z}] no uncaught page errors during hydration (${errs.slice(0, 1)})`);
    // A page whose Alerts substance qualified it must still SHOW Alerts substance after
    // hydration — either because the app re-rendered those tiles, or because the build-time
    // block was kept. Content the crawler saw may not vanish for the resident.
    if (z !== F) {
      const kept = after.ssrItems > 0;
      const reRendered = /Government & civic|Local news|Public meetings/i.test(after.text);
      ok(kept || reRendered,
         `[${z}] Alerts substance is still present after hydration (ssr items ${after.ssrItems})`);
    }
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);

  // The drift-suggestion block that lived here is GONE, and its absence is the point:
  // it existed to make a red build cheap to repair. Controls now substitute themselves, so
  // drift never reddens the build and there is nothing to repair. Substitutions are printed
  // above by resolveControls().
  if (fail) process.exit(1);
};
// Auto-run ONLY when executed directly. Importing this module for the offline test must
// not start a web server and walk an artifact that is not there.
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
