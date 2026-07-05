// generate-sitemap.mjs — regenerate sitemap.xml from the LIVE communities table.
//
// WHY: every community is a data row (CLAUDE.md §0), so the sitemap must be derived from
// the DB, not hand-maintained — otherwise it goes stale the moment a community is added
// without a repo push. This runs where egress works (a GitHub runner, see
// .github/workflows/sitemap.yml) and rewrites ONLY the community-page <url> entries; any
// hand-curated static/bespoke <url> block (home, how-it-works, box-elder.html, …) is
// preserved verbatim. Mirrors scripts/verify-communities.mjs for the DB read (same anon
// key, extracted from community.html so it is never forked; same 1000-row pagination).

import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('../community.html', import.meta.url), 'utf8');
const grab = (name) => {
  const m = html.match(new RegExp(`const ${name}\\s*=\\s*'([^']+)'`));
  if (!m) throw new Error(`Could not read ${name} from community.html`);
  return m[1];
};
const SUPABASE_URL = grab('SUPABASE_URL');
const SUPABASE_ANON_KEY = grab('SUPABASE_ANON_KEY');
const SITE = 'https://homesignal.net';
const SITEMAP = new URL('../sitemap.xml', import.meta.url);

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// The stable per-community URL: pretty slug first, then a covered ZIP, then the id.
function communityPath(r) {
  if (r.slug) return `community=${encodeURIComponent(r.slug)}`;
  if (r.zip_codes && r.zip_codes[0]) return `zip=${encodeURIComponent(r.zip_codes[0])}`;
  return `id=${encodeURIComponent(r.id)}`;
}

async function loadCommunities() {
  // PostgREST caps a single read at 1000 rows — page with Range headers until a short page.
  const base = `${SUPABASE_URL}/rest/v1/communities?select=id,slug,zip_codes,name&order=name.asc,id.asc`;
  const PAGE = 1000;
  let rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(base, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) throw new Error(`Supabase communities read failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows = rows.concat(page);
    if (page.length < PAGE) break;
  }
  return rows;
}

function main() {
  return loadCommunities().then((rows) => {
    // Preserve every hand-curated <url> block that is NOT a dynamic community page.
    const existing = readFileSync(SITEMAP, 'utf8');
    const staticBlocks = (existing.match(/ {2}<url>[\s\S]*?<\/url>/g) || [])
      .filter((b) => !b.includes('community.html?'));

    const communityUrls = rows
      .map((r) => `${SITE}/community.html?${communityPath(r)}`)
      .sort()
      .map((loc) => `  <url><loc>${xmlEscape(loc)}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`);

    const out = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- HomeSignal sitemap. Static pages + bespoke launch pages are listed by hand below;',
      '     the per-community pages (one per live communities row) are appended from the live',
      '     DB by scripts/generate-sitemap.mjs (.github/workflows/sitemap.yml) — zero-touch. -->',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...staticBlocks,
      '  <!-- Community pages (generated from the live communities table) -->',
      ...communityUrls,
      '</urlset>',
      '',
    ].join('\n');

    writeFileSync(SITEMAP, out);
    console.log(`sitemap.xml: ${staticBlocks.length} static + ${communityUrls.length} community = ${staticBlocks.length + communityUrls.length} urls`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
