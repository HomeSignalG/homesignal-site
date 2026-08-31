// Pre-rendered Box Elder County ZIP development pages — RAW-HTML SEO invariants.
//
// WHAT THIS PINS. `homesignalmap.html?zip=` ships a `noindex, nofollow` that JavaScript
// later flips, an empty `<template>` body, and one hardcoded canonical shared by 11,591
// URLs. The pre-rendered pages exist so that none of those three things is true for the
// Box Elder test set. Every assertion below reads the COMMITTED HTML as bytes — no DOM,
// no JS execution — because "a crawler that runs no JavaScript sees this" is exactly the
// property under test. Parsing with a DOM would silently prove a weaker claim.
//
// It also pins the SITEMAP↔ROBOTS agreement, which is the specific contradiction the
// audit found in production: a URL must never be advertised while its own page says
// noindex.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'developments/ut/box-elder';
const BASE = 'https://homesignal.net';

// The ZIP list is READ FROM THE GENERATOR, never retyped here — a hand-copied second
// list stops covering whatever the first list gains next.
const gen = readFileSync(join(root, 'scripts/gen_zip_pages.py'), 'utf8');
const zipBlock = /TEST_ZIPS = \[([\s\S]*?)\]/.exec(gen);
const ZIPS = zipBlock ? [...zipBlock[1].matchAll(/"(\d{5})"/g)].map((m) => m[1]) : [];

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

ok(ZIPS.length === 18, `generator declares 18 Box Elder ZIPs (got ${ZIPS.length})`);

const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);
const pages = new Map();
for (const z of ZIPS) pages.set(z, read(`${OUT}/${z}/index.html`));
const hub = read(`${OUT}/index.html`);

ok(hub !== null, 'county hub page exists');
ok([...pages.values()].every((h) => h !== null), 'every declared ZIP has a generated page');

// ── 1. no SEO content is trapped behind JavaScript ────────────────────────────
for (const [z, h] of pages) {
  if (!h) continue;
  ok(!/<template\b/i.test(h), `${z}: no <template> element (content is ordinary HTML)`);
}
ok(!/<template\b/i.test(hub || ''), 'hub: no <template> element');

// The only <script> permitted is the map loader, and it must come AFTER the content.
for (const [z, h] of pages) {
  if (!h) continue;
  const scripts = [...h.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  const nonLd = scripts.filter((s) => !/application\/ld\+json/i.test(s));
  ok(nonLd.length === 1, `${z}: exactly one executable <script> (the map loader), got ${nonLd.length}`);
  ok(h.indexOf('<h1>') < h.lastIndexOf('<script'), `${z}: <h1> precedes the loader script`);
}

// ── 2. head directives ────────────────────────────────────────────────────────
const titles = new Set();
const h1s = new Set();
for (const [z, h] of pages) {
  if (!h) continue;
  const title = (/<title>([^<]+)<\/title>/.exec(h) || [])[1];
  const h1 = (/<h1>([^<]+)<\/h1>/.exec(h) || [])[1];
  const canon = (/<link rel="canonical" href="([^"]+)">/.exec(h) || [])[1];
  const robots = (/<meta name="robots" content="([^"]+)">/.exec(h) || [])[1];
  const desc = (/<meta name="description" content="([^"]+)">/.exec(h) || [])[1];

  ok(!!title && titles.add(title) && !titles.has(undefined), `${z}: has a <title>`);
  h1s.add(h1);
  ok(!!h1, `${z}: has an <h1>`);
  ok((h.match(/<h1>/g) || []).length === 1, `${z}: exactly one <h1>`);
  ok(title.includes(z), `${z}: title names the ZIP`);
  ok(h1.includes(z), `${z}: H1 names the ZIP`);
  ok(/\bUT\b|\bUtah\b/.test(title) && /Utah/.test(h1), `${z}: title and H1 carry the state`);

  // canonical: self-referencing, never the parameterless map page
  ok(canon === `${BASE}/${OUT}/${z}/`, `${z}: canonical is self-referencing (${canon})`);
  ok(!/homesignalmap\.html\s*"?$/.test(canon || ''), `${z}: canonical is NOT /homesignalmap.html`);
  ok((h.match(/rel="canonical"/g) || []).length === 1, `${z}: exactly one canonical`);

  ok(robots === 'index, follow' || robots === 'noindex, follow',
    `${z}: robots is index,follow or noindex,follow (got "${robots}")`);
  ok(!/nofollow/.test(robots || ''), `${z}: never nofollow — noindexed pages still pass link equity`);
  ok(!!desc && desc.length > 60, `${z}: has a substantive meta description`);
  ok(desc.includes(z), `${z}: description names the ZIP`);
}
ok(titles.size === pages.size, `all ${pages.size} titles are unique (got ${titles.size})`);
ok(h1s.size === pages.size, `all ${pages.size} H1s are unique (got ${h1s.size})`);

// ── 3. the index rule: environmental records alone never qualify ──────────────
// 84313 has 0 development and 0 environmental records; 84329 has 0 development and 1
// environmental record. Both must be noindex. If a future data refresh gives either a
// real development record this assertion is SUPPOSED to fail — that is the signal to
// re-run the generator, not to loosen the test.
for (const z of ['84313', '84329']) {
  const h = pages.get(z);
  if (!h) continue;
  ok(/<meta name="robots" content="noindex, follow">/.test(h),
    `${z}: noindex — zero development records (environmental records do not qualify it)`);
}
const indexed = [...pages].filter(([, h]) => h && /content="index, follow"/.test(h));
ok(indexed.length === 16, `16 of 18 ZIPs are index,follow (got ${indexed.length})`);

// ── 4. real development records are present as raw HTML ──────────────────────
for (const [z, h] of indexed) {
  const recs = (h.match(/<article class="rec/g) || []).length;
  ok(recs >= 1 && recs <= 20, `${z}: ${recs} development record(s) in raw HTML (1..20)`);
  ok((h.match(/class="src" href="http/g) || []).length === recs,
    `${z}: every rendered record carries an official-source link`);
  ok(/Jurisdiction<\/dt>/.test(h), `${z}: records name their jurisdiction`);
}

// A noindexed, record-less page must NOT fake records to look full.
for (const z of ['84313', '84329']) {
  const h = pages.get(z);
  if (!h) continue;
  ok(!/<article class="rec/.test(h), `${z}: renders zero fabricated records`);
  ok(/No permit or project records are on file/.test(h), `${z}: states the absence honestly`);
}

// ── 5. crawlable internal links + breadcrumbs ────────────────────────────────
for (const [z, h] of pages) {
  if (!h) continue;
  ok(new RegExp(`href="/${OUT}/"`).test(h), `${z}: links up to the county hub`);
  const siblings = [...h.matchAll(new RegExp(`href="/${OUT}/(\\d{5})/"`, 'g'))].map((m) => m[1]);
  ok(siblings.length >= 1, `${z}: links to ${siblings.length} sibling ZIP page(s)`);
  ok(!siblings.includes(z), `${z}: does not link to itself as a sibling`);
  ok(/<nav class="crumbs"/.test(h), `${z}: has a visible breadcrumb`);
  ok(/"@type":"BreadcrumbList"/.test(h), `${z}: has BreadcrumbList JSON-LD`);
  // JSON-LD must mirror the visible trail, not invent one.
  const ld = (/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(h) || [])[1];
  try {
    const parsed = JSON.parse(ld);
    const names = parsed.itemListElement.map((i) => i.name);
    ok(names.length === 3 && names[0] === 'HomeSignal',
      `${z}: breadcrumb JSON-LD has the 3 visible levels`);
    ok(h.includes(names[2]), `${z}: JSON-LD leaf "${names[2]}" appears in the visible page`);
  } catch {
    ok(false, `${z}: breadcrumb JSON-LD parses`);
  }
}
ok(ZIPS.every((z) => (hub || '').includes(`href="/${OUT}/${z}/"`)),
  'hub links to every ZIP page, including the noindexed ones');

// ── 6. the interactive map is preserved, and is enhancement only ─────────────
for (const [z, h] of pages) {
  if (!h) continue;
  ok(h.includes(`data-src="/homesignalmap.html?zip=${z}"`),
    `${z}: embeds the existing map page for this ZIP`);
  ok(h.includes(`<a href="/homesignalmap.html?zip=${z}">`),
    `${z}: map region degrades to a plain link with JS disabled`);
}

// ── 7. sitemap agreement — the production contradiction this test exists for ──
const sitemap = read('sitemap.xml') || '';
for (const [z, h] of pages) {
  if (!h) continue;
  const listed = sitemap.includes(`<loc>${BASE}/${OUT}/${z}/</loc>`);
  const indexable = /content="index, follow"/.test(h);
  ok(listed === indexable,
    `${z}: sitemap listing (${listed}) matches its own robots directive (${indexable})`);
  // and the legacy parameter URL must not be advertised alongside it
  ok(!sitemap.includes(`<loc>${BASE}/homesignalmap.html?zip=${z}</loc>`),
    `${z}: not double-advertised under the legacy homesignalmap.html?zip= URL`);
}
ok(sitemap.includes(`<loc>${BASE}/${OUT}/</loc>`), 'hub is in the sitemap');

// ── 8. no fabricated dates ───────────────────────────────────────────────────
// app_refresh_zip stamps app_changes.occurred_at with current_date when the source has
// no parseable date. Those rows are county-wide samples, not ZIP facts, and their date
// is a refresh artifact — the generator must never print one as a notice date.
for (const [z, h] of pages) {
  if (!h) continue;
  ok(!/Planning &amp; zoning<\/h2>/.test(h),
    `${z}: does not render the md5-sampled app_changes planning block`);
}

console.log(fails ? `\n${fails} failing check(s)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
