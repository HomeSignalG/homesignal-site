// LIVE verifier for property.html — the saved-place dossier (Del Valle 78617 is the pilot).
//
// WHY IT EXISTS: property.html was one of six surfaces with NO verifier (surface-banner.mjs
// UNVERIFIED_SURFACES). It is the flagship case study and it renders factual claims about named
// real projects near a specific home, so it sits under the same anti-fabrication directive as the
// map page — but nothing was checking it.
//
// ⚠️ THE STRUCTURAL LIMIT, STATED UP FRONT SO NOBODY OVER-READS A GREEN RUN: property.html is an
// AUTHENTICATED page. `HS.data.properties()` returns [] for a signed-out visitor (lib/data.js),
// so an unauthenticated check can only ever exercise the EMPTY state — it cannot render a real
// dossier. This verifier therefore proves two things and does NOT claim the third:
//   ✓ the signed-out page is honest (empty state, no fabricated home, no seed leak)
//   ✓ the DATA a signed-in dossier would render satisfies the anti-fabrication invariants
//   ✗ NOT verified: the rendered dossier itself. That needs a test account and is a founder call.
//
// THE HAZARD THIS EXISTS TO CATCH (§2). lib/data.js line ~17 is:
//     const isSeed = () => (CFG.DATA_SOURCE || 'seed') === 'seed';
// The default is SEED. If config.js ever fails to load, every app page silently renders
// seed/delvalle.js — whose own header says its permit numbers, dates and dollar figures are
// "prototype placeholders ... MUST be reconciled by the Python engine against the real feed before
// this ships to the live path." That is a FAIL-OPEN to hand-authored numbers on a page that makes
// factual claims. Production sets DATA_SOURCE explicitly today, so this is latent, not live —
// which is exactly when it is cheapest to pin.
//
//   SITE_BASE=https://homesignal.net node scripts/verify-property-page.mjs
// Env: SITE_BASE (default https://homesignal.net), ZIP (default the config DEFAULT_ZIP).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { surfaceBanner } from './lib/surface-banner.mjs';

surfaceBanner('verify-property-page');

const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
let fail = 0, pass = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

// The seeded demo persona, verbatim from seed/delvalle.js. If ANY of these reach a signed-out
// production page, a fabricated home is being presented as a real one.
const PERSONA_MARKERS = ['4400 Wildhorse Trail'];

// ── §1 — the shipped runtime config ───────────────────────────────────────────────────────────
console.log('\n1) config.js as SERVED — the live page must read the live DB, not the seed');
const cfgSrc = await (await fetch(`${SITE_BASE}/config.js`)).text();
const grab = (k) => (cfgSrc.match(new RegExp(`${k}\\s*:\\s*['"]?([A-Za-z0-9_.-]+)['"]?`)) || [])[1];
const dataSource = grab('DATA_SOURCE');
const demo = grab('DEMO_SESSION');
ok(`DATA_SOURCE is 'supabase' (got ${dataSource})`, dataSource === 'supabase',
  'a live page on the seed would present hand-authored placeholder figures as real records');
ok(`DEMO_SESSION is false (got ${demo})`, demo === 'false',
  'with the demo session on, the seeded persona leaks into the public chrome as if signed in');
const zip = process.env.ZIP || (cfgSrc.match(/DEFAULT_ZIP\s*:\s*'(\d{5})'/) || [])[1] || '78617';
console.log(`     pilot ZIP: ${zip}`);

// ── §2 — the fail-open default, pinned ────────────────────────────────────────────────────────
console.log('\n2) the fail-open default is PRESENT and NEUTRALISED (not assumed away)');
{
  const dataJs = readFileSync(new URL('../lib/data.js', import.meta.url), 'utf8');
  const hasSeedDefault = /DATA_SOURCE\s*\|\|\s*['"]seed['"]/.test(dataJs);
  // Deliberately assert the hazard EXISTS. If someone removes it, this line should be revisited
  // rather than silently passing — a check that cannot fail teaches nothing.
  ok('lib/data.js still defaults to seed when DATA_SOURCE is unset (documented hazard)',
    hasSeedDefault,
    'the default changed — re-read this section; the neutralisation below may no longer be the right guard');
  ok('config.js sets DATA_SOURCE EXPLICITLY, so the seed default is unreachable in production',
    /DATA_SOURCE\s*:\s*['"]supabase['"]/.test(cfgSrc),
    'config.js does not set DATA_SOURCE — the page would fall through to the hand-authored seed');
}

// ── §3 + §4 — what a signed-out visitor actually gets ─────────────────────────────────────────
console.log('\n3) signed-out render — honest empty state, no fabricated home');
const browser = await chromium.launch();
const load = async (url) => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  const text = await page.evaluate(() => document.body.innerText);
  const html = await page.content();
  await page.close();
  return { text, html, errors };
};

const live = await load(`${SITE_BASE}/property.html`);
ok('page renders with no uncaught JS errors', live.errors.length === 0, live.errors.slice(0, 3).join(' | '));
ok('signed-out visitor gets the honest empty state ("No Saved Place")',
  /No Saved Place/i.test(live.text),
  `body began: ${live.text.slice(0, 160).replace(/\s+/g, ' ')}`);
for (const m of PERSONA_MARKERS) {
  ok(`the seeded demo persona (${m}) does NOT appear`, !live.html.includes(m),
    'a fabricated home is being presented to a signed-out visitor');
}

console.log('\n4) the seed is reachable ONLY by explicit opt-in (proves §3 is not vacuous)');
{
  // If ?data=seed did NOT change anything, §3's "no persona" result would prove nothing — the
  // marker might simply never render. This is the positive control for that assertion.
  const seeded = await load(`${SITE_BASE}/property.html?data=seed`);
  const seedShowsPersona = PERSONA_MARKERS.some((m) => seeded.html.includes(m));
  ok('?data=seed DOES surface the seeded persona — so §3 tested a real discriminator',
    seedShowsPersona,
    'neither mode shows the persona, so the §3 assertion has no power; find a live seed marker and re-pin');
  ok('and the DEFAULT page differs from the seeded page',
    live.html !== seeded.html,
    'default and seed render identically — the production page may be on the seed');
}
await browser.close();

// ── §5 — the data a real dossier would render ─────────────────────────────────────────────────
console.log('\n5) anti-fabrication over the data the dossier reads (app_projects)');
{
  const url = (cfgSrc.match(/SUPABASE_URL\s*:\s*'([^']+)'/) || [])[1];
  const key = (cfgSrc.match(/SUPABASE_ANON_KEY\s*:\s*'([^']+)'/) || [])[1];
  ok('config.js exposes the anon key + URL the page itself uses', !!(url && key));
  if (url && key) {
    const rows = await (await fetch(
      `${url}/rest/v1/app_projects?zip=eq.${zip}&select=name,source_ref,lat,lng,record_kind&limit=2000`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } })).json();
    ok(`${zip} returns rows through the anon/RLS path the page uses`, Array.isArray(rows) && rows.length > 0,
      JSON.stringify(rows).slice(0, 200));
    if (Array.isArray(rows) && rows.length) {
      const noSrc = rows.filter((r) => !r.source_ref);
      const noGeo = rows.filter((r) => r.lat == null || r.lng == null);
      const noName = rows.filter((r) => !r.name);
      ok(`every record carries a source_ref (${rows.length} rows)`, noSrc.length === 0,
        `${noSrc.length} without one — the anti-fabrication gate`);
      ok('every record carries coordinates', noGeo.length === 0, `${noGeo.length} without`);
      ok('every record carries a name', noName.length === 0, `${noName.length} without`);
      const dev = rows.filter((r) => r.record_kind === 'development').length;
      console.log(`     ${rows.length} rows — ${dev} development, ${rows.length - dev} facility`);
    }
  }
}

console.log(fail ? `\n${fail} check(s) FAILED (${pass} passed)` : `\nAll ${pass} checks passed.`);
console.log('NOTE: the signed-in dossier itself is NOT covered — see the header.');
process.exit(fail ? 1 : 0);
