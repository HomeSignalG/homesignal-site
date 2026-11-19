// national-8: a Type or Stage filter rebuilds the overview and the client briefing from the FILTERED records (ranking and one-line-per-address are taken over what
// the filter leaves), and clearing the filter restores the unfiltered text exactly. Real engine output on the Seattle sample, real browser.
// Run: node test/da-report-filter-rebuild.browser.test.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
await import('../lib/project-type.js');
const M = await import('../supabase/functions/_shared/national-report.ts');
const fx = JSON.parse(readFileSync(join(root, 'test/fixtures/report-quality/seattle-3101-western-2026-11-02.json'), 'utf8'));
const attribution = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/source-attribution.json'), 'utf8'));
const SUBJECT = { address: '3101 Western Ave, Seattle, WA 98121', matched_address: null, lat: fx._meta.subject_point[0], lng: fx._meta.subject_point[1], zip: '98121' };
const a = M.assemble({ now: new Date('2026-11-02T18:00:00Z'), subject: SUBJECT, radius_mi: 0.5, view: 'customer', zip_supported: true, attribution, rows: fx.rows, projects: fx.projects, ledger: fx.ledger, events: fx.events, health: fx.health });
const response = { status: 'OK', coverage_state: a.coverage_state, report: a.intelligence, render: a.renderOnly };
let fails = 0;
const ok = (c, n, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 500)); } };
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<main id="host"></main>');
await page.addScriptTag({ path: join(root, 'lib/da-report-view.js') });
const state = () => page.evaluate(() => {
  const li = [...document.querySelectorAll('[data-da-overview] > li')].map((x) => x.textContent);
  const brief = (document.querySelector('[data-da-briefhost]') || {}).textContent || '';
  return { li, brief, rows: [...document.querySelectorAll('.da-rv-table tbody tr')].filter((r) => !r.hasAttribute('hidden')).length };
});
await page.evaluate((r) => { window.HS.daReportView.mount(document.getElementById('host'), r, { subject: 'x' }); }, response);
const before = await state();
ok(before.li.length > 0 && before.brief.length > 0 && !/Filters on/.test(before.brief), 'unfiltered: overview and briefing present, no filter note', { n: before.li.length });
const types = await page.$$eval('.da-rv-chip[data-da-filter="type"]', (b) => b.map((x) => x.getAttribute('data-da-value')).filter((v) => v !== 'all'));
let tested = 0;
for (const t of types) {
  await page.click('.da-rv-chip[data-da-filter="type"][data-da-value="' + t + '"]');
  const st = await state();
  const wantRows = st.rows;
  const nBrief = Number((/counts the (\d+) record/.exec(st.brief) || [])[1]);
  ok(st.li.length <= 6 && (wantRows === 0 || st.li.length > 0) && nBrief === wantRows, 'type ' + t + ': the briefing counts exactly the ' + wantRows + ' records the table shows', { nBrief, wantRows, li: st.li.length });
  tested++;
}
await page.click('.da-rv-chip[data-da-filter="type"][data-da-value="all"]');
const after = await state();
ok(tested > 0 && JSON.stringify(after.li) === JSON.stringify(before.li) && after.brief === before.brief, 'clearing the filter restores the unfiltered overview and briefing exactly');
await browser.close();
process.exit(fails ? 1 : 0);
