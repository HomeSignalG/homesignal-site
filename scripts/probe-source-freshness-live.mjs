// probe-source-freshness-live.mjs — does the source freshness box on real pages say exactly what the
// database says, per source and per ZIP? (founder, 2026-11-01: verify on actual Washington and Oregon ZIP pages)
//
// TWO INDEPENDENT READS PER ZIP:
//   backend — public.source_freshness_for_zip(zip), fetched here with the page's public anon key, turned into
//             the expected lines by the SHIPPED wording (lib/templates.js, evaluated in node).
//   page    — /community/<zip>/ and homesignalmap.html?zip=<zip> in a real browser: the text of every
//             [data-source] row the page drew.
// Fails when a page shows no box, when a source line differs from the backend's, when a "This ZIP" line is
// missing, or when the box says current / fresh / stale. Read-only: no secret, no write.
// Env: SITE_BASE (default https://jodytracks.com), ZIPS (default: Oregon 97202,97030,97006 + Washington 98466,98101).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright';

const html = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const grab = (n) => { const m = html.match(new RegExp(`var ${n}\\s*=\\s*["']([^"']+)["']`)); if (!m) throw new Error('could not read ' + n); return m[1]; };
const APIKEY = grab('APIKEY');
const SUPABASE_URL = grab('ENDPOINT').replace(/\/functions\/v1\/.*$/, '');
const SITE_BASE = (process.env.SITE_BASE || 'https://jodytracks.com').replace(/\/$/, '');
const ZIPS = (process.env.ZIPS || '97202,97030,97006,98466,98101').split(',').map((s) => s.trim()).filter((z) => /^\d{5}$/.test(z));

const win = {};
vm.runInNewContext(readFileSync(new URL('../lib/templates.js', import.meta.url), 'utf8'), { window: win, console });
const HS = win.HS;
const labelsJson = JSON.parse(readFileSync(new URL('../lib/generated/county-sources.json', import.meta.url), 'utf8'));
const LABELS = {};
for (const group of [labelsJson.statewide, labelsJson.counties]) for (const arr of Object.values(group || {})) for (const e of arr) if (!LABELS[e.id]) LABELS[e.id] = e.label;

let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : '')); if (!c) fails++; };

async function backend(zip) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/source_freshness_for_zip', {
    method: 'POST', headers: { apikey: APIKEY, Authorization: 'Bearer ' + APIKEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_zip: zip, p_ids: [] })
  });
  if (!r.ok) throw new Error('reader HTTP ' + r.status + ' for ' + zip);
  return r.json();
}

async function pageRows(page, url, sel) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await page.waitForSelector(sel + ' [data-source]', { timeout: 45000 }); } catch (_) { return null; }
  return page.$$eval(sel + ' [data-source]', (els) => els.map((e) => ({ id: e.getAttribute('data-source'), text: e.innerText })));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
for (const zip of ZIPS) {
  const rows = await backend(zip);
  const want = HS.sourceFreshnessEntries(rows, LABELS);
  console.log(`\n== ZIP ${zip}: backend returns ${rows.length} source(s)`);
  for (const [where, url, sel] of [['ZIP page', `${SITE_BASE}/community/${zip}/`, '#dev-source-freshness'],
                                   ['Map 1', `${SITE_BASE}/homesignalmap.html?zip=${zip}`, '#srcFresh']]) {
    const got = await pageRows(page, url, sel);
    if (!rows.length) { ok(!got || !got.length, `${zip} ${where}: no sources read for this ZIP, no box`); continue; }
    ok(Array.isArray(got) && got.length > 0, `${zip} ${where}: the box is drawn`, url);
    if (!got) continue;
    const byId = Object.fromEntries(got.map((g) => [g.id, g.text]));
    for (const e of want) {
      const text = byId[e.id];
      if (where === 'Map 1' && !text) { console.log(`   · ${where} lists no row for ${e.id} (Map 1 lists only ZIP-read sources plus drawn records)`); continue; }
      ok(!!text, `${zip} ${where}: row for ${e.id}`);
      if (!text) continue;
      for (const line of HS.sourceFreshnessLines(e, true)) ok(text.includes(line), `${zip} ${where} ${e.id}: "${line}"`, text);
      if (e.scope) ok(text.includes(e.scope), `${zip} ${where} ${e.id}: coverage limit "${e.scope}"`, text);
      ok(!/\b(current|currently|up to date|fresh|stale)\b/i.test(text), `${zip} ${where} ${e.id}: never current/fresh/stale`, text);
      console.log('   ' + text.replace(/\n/g, ' | '));
    }
  }
}
await browser.close();
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
