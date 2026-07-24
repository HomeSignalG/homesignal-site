// verify-coverage-state.mjs — Phase 2 coverage-state model verification.
// Runs on a GitHub runner (the build sandbox has no egress — CI is the live
// check, the repo's standing pattern). VERIFICATION ONLY — no product writes.
//
// Asserts, against the LIVE app_coverage_states view (public anon read):
//   1. every app_community_meta ZIP has exactly one row with a VALID state;
//   2. no impossible combinations (honestly_empty with content, facilities_only
//      with local content, populated with none, unsupported_source with a report);
//   3. legacy data_quality consistency (honestly_empty ⇒ coverage_coming;
//      populated/facilities_only ⇒ pass) — the old gate stays valid during rollout;
//   4. determinism: two reads of the same ZIP agree (pure function of columns);
//   5. rendering: one facilities_only page and one honestly_empty/coverage page
//      render on DESKTOP (1440×900) and MOBILE (390×844) with the
//      data-coverage-state attribute matching the view, layout gate unchanged.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const grab = (k) => (cfg.match(new RegExp(`${k}:\\s*'([^']+)'`)) || [])[1];
const SUPABASE_URL = grab('SUPABASE_URL');
const SUPABASE_ANON_KEY = grab('SUPABASE_ANON_KEY');
const VALID = new Set(['populated','facilities_only','honestly_empty','unsupported_source','temporarily_unavailable','failed_ingest','stale_data']);

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}`);
  return res.json();
}

const fails = [];
const ok = (name, cond, extra) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  [' + extra + ']' : ''}`);
  if (!cond) fails.push(name);
};

// ── 1-3: full-population invariants (keyset-paginated; PostgREST caps at 1000) ──
const rows = [];
for (let last = ''; ;) {
  const page = await rest(`app_coverage_states?select=zip,coverage_state,data_quality,dev_markers,fac_markers,changes,refreshed_at&order=zip.asc&limit=1000` + (last ? `&zip=gt.${encodeURIComponent(last)}` : ''));
  rows.push(...page);
  if (page.length < 1000) break;
  last = page[page.length - 1].zip;
}
const metaCount = Number(await fetch(`${SUPABASE_URL}/rest/v1/app_community_meta?select=zip`, {
  method: 'HEAD',
  headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'count=exact' },
}).then(r => (r.headers.get('content-range') || '0/0').split('/')[1]));

ok('every meta ZIP has a coverage-state row', rows.length === metaCount, `view=${rows.length} meta=${metaCount}`);
ok('every state is valid + non-null', rows.every(r => VALID.has(r.coverage_state)),
   [...new Set(rows.filter(r => !VALID.has(r.coverage_state)).map(r => r.coverage_state))].join(','));
ok('no duplicate ZIPs in view', new Set(rows.map(r => r.zip)).size === rows.length);
ok('impossible: honestly_empty with content', !rows.some(r => r.coverage_state === 'honestly_empty' && (r.dev_markers > 0 || r.fac_markers > 0 || r.changes > 0)));
ok('impossible: facilities_only with local content', !rows.some(r => r.coverage_state === 'facilities_only' && (r.dev_markers > 0 || r.changes > 0)));
ok('impossible: populated without content', !rows.some(r => r.coverage_state === 'populated' && r.dev_markers === 0 && r.changes === 0));
ok('impossible: unsupported_source with a report', !rows.some(r => r.coverage_state === 'unsupported_source' && r.refreshed_at !== null));
ok('legacy: honestly_empty => coverage_coming', rows.every(r => r.coverage_state !== 'honestly_empty' || r.data_quality === 'coverage_coming'));
ok('legacy: populated/facilities_only => pass', rows.every(r => !['populated','facilities_only'].includes(r.coverage_state) || r.data_quality === 'pass'));

// ── 4: determinism — re-read a sample, states agree ──
const sample = rows.filter(r => ['populated','facilities_only','honestly_empty'].includes(r.coverage_state)).slice(0, 3);
for (const s of sample) {
  const again = await rest(`app_coverage_states?select=coverage_state&zip=eq.${s.zip}`);
  ok(`determinism ${s.zip}`, again[0] && again[0].coverage_state === s.coverage_state, `${s.coverage_state}`);
}

// ── 5: rendering, desktop + mobile ──
const pick = (st) => (rows.find(r => r.coverage_state === st) || {}).zip;
const pages = [
  { zip: pick('facilities_only'), state: 'facilities_only', wantPass: true },
  { zip: pick('honestly_empty'), state: 'honestly_empty', wantPass: false },
  { zip: pick('populated'), state: 'populated', wantPass: true },
].filter(p => p.zip);
const b = await chromium.launch();
for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true }]) {
  const page = await b.newPage({ viewport: { width: vp.width, height: vp.height }, ...(vp.isMobile ? { isMobile: true, hasTouch: true } : {}) });
  for (const t of pages) {
    await page.goto(`${SITE_BASE}/community.html?zip=${t.zip}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => {
      const p = document.getElementById('commPage');
      return !!(p && p.textContent && p.textContent.trim().length > 0);
    }, { timeout: 20000 });
    const got = await page.evaluate(() => ({
      state: (document.getElementById('commPage') || {}).getAttribute ? document.getElementById('commPage').getAttribute('data-coverage-state') : null,
      isPass: !!document.querySelector('#commPage .strip'),
      txt: (document.getElementById('commPage').textContent || '').slice(0, 400),
      noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    }));
    ok(`${vp.name} ${t.zip} attribute=${t.state}`, got.state === t.state, `got=${got.state}`);
    ok(`${vp.name} ${t.zip} layout gate unchanged`, got.isPass === t.wantPass, `isPass=${got.isPass}`);
    ok(`${vp.name} ${t.zip} no horizontal scroll`, got.noHScroll);
    if (t.state === 'honestly_empty') ok(`${vp.name} ${t.zip} honest empty copy`, /checked every supported public source/i.test(got.txt));
    if (t.state === 'facilities_only') ok(`${vp.name} ${t.zip} facilities-only note`, /still being wired/i.test(got.txt));
  }
  await page.close();
}
await b.close();

console.log(`\nTOTAL checks: pass=${fails.length === 0 ? 'ALL' : 'SOME FAILED'} fails=${fails.length}`);
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }