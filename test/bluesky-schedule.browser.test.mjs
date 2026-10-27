// Real Chromium: Tab 12 "Bluesky Publishing Schedule" wired to a stub Supabase client (no network, no credential).
// The overview fixture is the REAL output of public.hs_bsky_schedule_overview() on a disposable Postgres running
// homesignal-ingest's migration 20261027170000 (tests/bsky_schedule_pg/check.py), saved 2026-10-27.
// Run: node test/bluesky-schedule.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const OV = JSON.parse(fs.readFileSync(new URL('./fixtures/bluesky-schedule/overview.json', import.meta.url), 'utf8'));
const AN = { timezone: 'America/Los_Angeles', days: 30,
  summary: { maps: { posts: 12, visitors: 30, registrations: 3, reports: 1, visitors_per_post: 2.5, registrations_per_100_visitors: 10, reports_per_registration: 0.33 },
             shorts: { posts: 4, visitors: 18, registrations: 2, reports: 0, visitors_per_post: 4.5, registrations_per_100_visitors: 11.1, reports_per_registration: 0 } },
  posts: [{ kind: 'shorts', post_id: 'j1', label: 'emerson <b>lake</b> · short1', published_at: '2026-10-26T01:00:00Z', visitors: 9, registrations: 1, reports: 0 }],
  untagged_bluesky_visitors: 5, unavailable: ['YouTube views and clicks that came from Bluesky: no YouTube Analytics data is collected.'], caveats: ['c'] };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body><div id="bs"></div></body></html>');
await page.addScriptTag({ content: fs.readFileSync(new URL('../lib/acq-bluesky-schedule.js', import.meta.url), 'utf8') });
await page.evaluate(({ OV, AN }) => {
  window.calls = [];
  window.confirms = [];
  window.confirm = (q) => { window.confirms.push(q); return true; };
  const moves = [{ kind: 'video', id: 'v1', old: '2026-10-28T02:00:00+00:00', new: '2026-10-28T03:00:00+00:00' }];
  window.client = { rpc: (n, a) => {
    window.calls.push([n, a]);
    if (n === 'hs_bsky_schedule_overview') return Promise.resolve({ data: OV, error: null });
    if (n === 'hs_bsky_maps_vs_shorts') return Promise.resolve({ data: AN, error: null });
    if (n === 'hs_bsky_schedule_preview') {
      const bad = a.p_slots.weekday.maps[1] === '09:00';
      return Promise.resolve({ data: bad ? { ok: false, problems: ['weekday maps 08:30 and 09:00 are 30 minutes apart; at least 150'] }
        : { ok: true, problems: [], reschedule: a.p_reschedule, moves: a.p_reschedule ? moves : [], moved: a.p_reschedule ? 1 : 0 }, error: null });
    }
    if (n === 'hs_bsky_schedule_save') return Promise.resolve({ data: { ok: true, moved: a.p_reschedule ? 1 : 0 }, error: null });
    return Promise.resolve({ data: null, error: { code: 'x' } });
  } };
}, { OV, AN });
await page.evaluate(() => window.HS.acqBlueskySchedule.mount(window.client, document.getElementById('bs'), () => { window.refreshed = true; }));
const txt = await page.locator('#bs').innerText();
ok(txt.includes('Bluesky Publishing Schedule'), 'the section renders');
ok(/MAPS today\s*2\/2/.test(txt) && /VIDEO today\s*2\/2/.test(txt), 'today shows MAPS 2/2 and VIDEO 2/2 from the database');
ok(/PDT/.test(txt) && /CDT/.test(txt), 'times are shown in Pacific and Central');
ok(await page.locator('#bs .bs-day').count() === 7 && await page.locator('#bs .bs-cell').count() === 28, 'the calendar shows 7 days x 4 slots');
ok(await page.locator('#bs .bs-kind.bs-maps').count() > 0 && await page.locator('#bs .bs-kind.bs-video').count() > 0, 'MAPS and VIDEO are labelled distinctly');
ok(txt.includes('Shorts (video)') && txt.includes('Not measured') && txt.includes('no YouTube Analytics'), 'MAPS vs Shorts results show, and say what is not measured');
ok(await page.locator('#bs b:has-text("lake")').count() === 0 && txt.includes('emerson <b>lake</b>'), 'labels are escaped');

// settings: an invalid change is refused with the database's words; nothing is saved
await page.click('#bs .bs-settings summary');
await page.fill('#bs input[data-bs-slot="weekday.maps.1"]', '09:00');
await page.click('#bs [data-bs="preview"]'); await page.waitForTimeout(50);
ok((await page.locator('#bs .bs-warn').innerText()).includes('30 minutes apart'), 'an invalid schedule shows the reason');
ok(await page.locator('#bs [data-bs="save"]').count() === 0, 'and offers no Save button');
// a valid change with "move scheduled posts": the preview lists the move, Save sends the confirmed count
await page.fill('#bs input[data-bs-slot="weekday.maps.1"]', '13:30');
await page.fill('#bs input[data-bs-slot="weekday.video.0"]', '20:00');
await page.check('#bs #bs-resched');
await page.click('#bs [data-bs="preview"]'); await page.waitForTimeout(50);
ok((await page.locator('#bs .bs-ok').innerText()).includes('1 scheduled post(s) would move'), 'the preview shows how many posts move');
ok(await page.locator('#bs .bs-ok tbody tr').count() === 1, 'and lists each move (from, to)');
const pv = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_bsky_schedule_preview').pop()[1]);
ok(pv.p_reschedule === true && pv.p_slots.weekday.video[0] === '20:00' && pv.p_slots.weekend.maps.join() === '10:00,14:30', 'the preview sends weekday and weekend times');
ok(!(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_bsky_schedule_save'))), 'previewing saves nothing');
// editing after a preview withdraws it
await page.fill('#bs input[data-bs-slot="weekday.video.1"]', '22:30');
await page.dispatchEvent('#bs input[data-bs-slot="weekday.video.1"]', 'change');
ok(await page.locator('#bs [data-bs="save"]').count() === 0, 'changing a time after a preview requires a new preview');
await page.fill('#bs input[data-bs-slot="weekday.video.1"]', '21:00');
await page.click('#bs [data-bs="preview"]'); await page.waitForTimeout(50);
await page.click('#bs [data-bs="save"]'); await page.waitForTimeout(80);
const sv = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_bsky_schedule_save').pop());
ok(sv && sv[1].p_reschedule === true && sv[1].p_expected_moves === 1 && sv[1].p_slots.weekday.video.join() === '20:00,21:00', 'Save sends the previewed times and the confirmed number of moves');
ok(await page.evaluate(() => window.confirms.length === 1 && /move 1 scheduled post/.test(window.confirms[0])), 'Save asks for confirmation naming how many posts move');
ok(await page.evaluate(() => window.refreshed === true), 'the post queue refreshes after a save');
await browser.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
