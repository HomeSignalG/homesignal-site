// LAST MET — a government on a ZIP page with no upcoming meeting is still shown, as past
// (founder, option 1, 2026-11-06). Run: node test/meetings-last-met.test.mjs
//
// Real case: ZIP 80808. zip_government_bodies('80808') = El Paso County (root) + Calhan (city).
// El Paso County has upcoming meetings, so before this change the tile showed only those, and
// Calhan's 29 stored meetings (packets post AFTER each meeting) never appeared. The Calhan row
// below is the stored newest row, verbatim (read 2026-11-06).
import fs from 'node:fs';
import path from 'node:path';

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const COUNTY = '85b3f26b-05fa-4a30-8f00-d44121a55585';
const CALHAN = '092a33f4-5998-4553-a6b6-8e9db5720c96';
const BODIES = [
  { name: 'El Paso County', body_kind: 'county', community_id: COUNTY, sort_key: 0, has_source: true, measured: true },
  { name: 'Calhan', body_kind: 'city', community_id: CALHAN, sort_key: 1, has_source: true, measured: true },
];
const CALHAN_LAST = { id: 'c1', community_id: CALHAN, title: 'Calhan Board of Trustees — Special Meeting',
  meeting_date: '2026-09-24 06:00:00+00', source_url: 'https://www.calhan.co/Special%20092426.pdf',
  category: 'County Commission & county business', is_cancelled: false };
const COUNTY_UP = { id: 'e1', community_id: COUNTY, title: 'Board of County Commissioners',
  meeting_date: '2099-01-06 16:00:00+00', source_url: 'https://example.gov/e1',
  category: 'County Commission & county business', is_cancelled: false };

// rows: { [communityId]: [rows] }; every query is answered from them by its own filters.
function makeSb(rows, opts = {}) {
  const calls = [];
  function q(table) {
    const st = { table, eq: {}, in: null, gte: null, lt: null };
    const b = {
      select() { return b; }, contains() { return b; }, order() { return b; }, limit(n) { st.limit = n; return b; },
      eq(k, v) { st.eq[k] = v; return b; }, in(k, v) { st.in = v; return b; },
      gte(_c, v) { st.gte = v; return b; }, lt(_c, v) { st.lt = v; return b; },
      then(res) {
        calls.push(st);
        if (table === 'communities') {
          if (st.eq.id) return res({ data: [{ id: COUNTY, parent_id: null }] });
          return res({ data: [{ id: 'zip80808', parent_id: COUNTY, level: 'zip', name: 'Calhan (80808)' }] });
        }
        if (opts.failBody && st.eq.community_id === opts.failBody) return res({ data: null, error: { message: 'boom' } });
        const ids = st.in || (st.eq.community_id ? [st.eq.community_id] : []);
        let out = ids.flatMap((id) => rows[id] || []);
        if (st.gte) out = out.filter((r) => Date.parse(r.meeting_date.replace(' ', 'T').replace(/\+00$/, 'Z')) >= Date.parse(st.gte));
        if (st.lt) out = out.filter((r) => Date.parse(r.meeting_date.replace(' ', 'T').replace(/\+00$/, 'Z')) < Date.parse(st.lt));
        out.sort((a, b2) => st.lt ? b2.meeting_date.localeCompare(a.meeting_date) : a.meeting_date.localeCompare(b2.meeting_date));
        return res({ data: out.slice(0, st.limit || 99) });
      },
    };
    return b;
  }
  const rpc = (name) => Promise.resolve(opts.noGov ? { data: null, error: { message: 'x' } }
    : name === 'zip_government_bodies' ? { data: BODIES } : { data: [] });
  return { calls, client: { from: q, rpc } };
}
async function run(rows, opts) {
  const win = { HS: {}, HS_CONFIG: { DATA_SOURCE: 'supabase', SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'y' } };
  const sb = makeSb(rows, opts);
  win.supabase = { createClient: () => sb.client };
  globalThis.window = win;
  new Function('window', read('lib/templates.js'))(win);
  new Function('window', read('lib/data.js'))(win);
  const out = await win.HS.data.meetings("80808", null);
  return { out, HS: win.HS, calls: sb.calls };
}

// §1 the 80808 case: county upcoming, Calhan past only
{
  const { out, HS } = await run({ [COUNTY]: [COUNTY_UP], [CALHAN]: [CALHAN_LAST] });
  ok(out.length === 1 && out[0].id === 'e1' && out.recent === false, '§1a the upcoming list is unchanged (county only)');
  ok(Array.isArray(out.lastMet) && out.lastMet.length === 1, '§1b Calhan is returned as lastMet');
  const lm = out.lastMet[0];
  ok(lm.government === 'Calhan' && lm.recent === true && lm.lastMet === true, '§1c it names Calhan and is marked past');
  ok(lm.source_ref === CALHAN_LAST.source_url, '§1d it carries the meeting record link');
  ok(!out.some((m) => m.id === 'c1'), '§1e it is not added to the upcoming list or its count');
  const html = HS.tpl.lastMetHTML(out.lastMet);
  ok(/<b>Calhan<\/b> has no upcoming meeting posted\. Last met Sep 24, 2026/.test(html), '§1f the line says past, with the Mountain date (Sep 24, not Sep 23)');
  ok(html.includes('href="https://www.calhan.co/Special%20092426.pdf"'), '§1g the line links the agency record');
  ok(!/upcoming meeting on|Upcoming:/i.test(html), '§1h the line never calls the meeting upcoming');
}
// §2 a body with an upcoming meeting is NOT given a last-met line (even beyond the shown list)
{
  // 13 county meetings fill the 12-row list first, so Calhan's upcoming meeting is NOT shown;
  // the line must still not appear, because Calhan HAS something upcoming.
  const many = Array.from({ length: 13 }, (_, i) => Object.assign({}, COUNTY_UP, { id: 'e' + i, meeting_date: '2099-01-' + String(i + 1).padStart(2, '0') + ' 16:00:00+00' }));
  const { out } = await run({ [COUNTY]: many, [CALHAN]: [CALHAN_LAST, Object.assign({}, CALHAN_LAST, { id: 'c2', meeting_date: '2099-02-01 06:00:00+00' })] });
  ok(out.length === 12 && !out.some((m) => m.id === 'c2'), '§2a control: Calhan\'s upcoming meeting is beyond the shown list');
  ok(out.lastMet.length === 0, '§2b a body with something upcoming gets no last-met line');
}
// §3 recent fallback: nothing upcoming anywhere, Calhan older than 30 days -> lastMet still shows it
{
  const old = Object.assign({}, CALHAN_LAST, { meeting_date: '2020-01-02 07:00:00+00' });
  const { out } = await run({ [COUNTY]: [], [CALHAN]: [old] });
  ok(out.length === 0 && out.lastMet.length === 1 && out.lastMet[0].id === 'c1', '§3 outside the 30-day window, the town still shows as last met');
}
// §4 one failed read leaves that body out and nothing else changes
{
  const { out } = await run({ [COUNTY]: [COUNTY_UP], [CALHAN]: [CALHAN_LAST] }, { failBody: CALHAN });
  ok(out.length === 1 && out.lastMet.length === 0, '§4 a failed read for Calhan drops only its line');
}
// §5 a page with one government (no zipGovernment answer) makes no extra query
{
  const { out, calls } = await run({ [COUNTY]: [COUNTY_UP] }, { noGov: true });
  ok(out.lastMet.length === 0 && calls.filter((c) => c.table === 'meetings').length === 1, '§5 no government list -> no last-met queries');
}
// §6 both pages render it; the crawler document does not
ok(read('lib/community-page.js').includes('HS.tpl.lastMetHTML(meetings.lastMet)'), '§6a the ZIP page renders the last-met lines');
ok(/tab === 'meetings' \? HS\.tpl\.lastMetHTML\(meetings\.lastMet\)/.test(read('alerts.html')), '§6b the Alerts meetings tab renders them');
ok(!/lastMet|last_met/i.test(read('scripts/gen_zip_pages.py')), '§6c the static generator is untouched (no indexability change)');
ok(HS_EMPTY(), '§6d an empty list renders nothing');
function HS_EMPTY() { return globalThis.window.HS.tpl.lastMetHTML([]) === '' && globalThis.window.HS.tpl.lastMetHTML(undefined) === ''; }

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
