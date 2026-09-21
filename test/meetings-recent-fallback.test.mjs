// RECENT-MEETINGS FALLBACK — the tile fills, and it never lies about what it is showing.
//
// WHY IT EXISTS. Measured 2026-09-21: 103 of Utah's 310 ZIP pages showed an empty Upcoming
// Meetings tile across 13 counties, and not one was a wiring defect — all 13 ingested that
// day, ~72% of their notices arrive before the meeting. The cause is publishing CADENCE.
// Salt Lake County files its whole year of council meetings at once (lead 240-338 days) so
// its tile is never empty; Weber County files one notice 1-2 days ahead — while filing MORE
// notices than Davis (19 vs 16 in 30 days) — so its tile is blank most of the time. Feed
// count predicts nothing: Weber 14 feeds / 0 upcoming, Salt Lake 13 / 38.
// Of those 103 ZIPs, 103 had a meeting inside 30 days and ZERO had nothing recent.
//
// ⚠️ THE LABEL IS THE LOAD-BEARING HALF. Filling the tile while still calling a meeting from
// last Tuesday "upcoming" is a false statement about a public body — worse than the empty
// tile it replaces. §3 fails if any meetings label in lib/community-page.js hard-codes the
// upcoming wording instead of deriving it from the one flag.
//
// ⚠️ DELIBERATELY NOT IN scripts/gen_zip_pages.py, and §4 pins that. The static generator's
// meeting count is an INDEXABILITY input — `rule_f_count = n_ln_journalism + n_gn + n_um` —
// so giving the crawler document this fallback would let past meetings push pages from
// noindex to index. A copy change must not become an SEO change.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataSrc = readFileSync(join(root, 'lib/data.js'), 'utf8');
const pageSrc = readFileSync(join(root, 'lib/community-page.js'), 'utf8');
const pySrc = readFileSync(join(root, 'scripts/gen_zip_pages.py'), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripPy = (s) => s.replace(/^\s*#.*$/gm, '');
ok(stripJs('// upcoming\nvar a=1;').includes('var a=1') && !stripJs('// upcoming\nvar a=1;').includes('upcoming'),
   '§0 comment stripper works in both directions');

// ------------------------------------------------------------------ the fake client ----
// Chainable + thenable, exactly the shape lib/data.js drives. It RECORDS the calls so the
// window bounds can be asserted, not assumed.
function makeSb(meetingRows) {
  const calls = [];
  function q(table) {
    const state = { table, args: {} };
    const b = {
      select() { return b; }, contains() { return b; }, order() { return b; },
      limit() { return b; }, eq(k, v) { state.args[k] = v; return b; },
      in() { return b; },
      gte(_c, v) { state.args.gte = v; return b; },
      lt(_c, v) { state.args.lt = v; return b; },
      then(res) {
        calls.push(state);
        if (table === 'communities') {
          if (state.args.id) return res({ data: [{ id: 'county', parent_id: null }] });
          return res({ data: [{ id: 'zipc', parent_id: 'county', level: 'zip', name: 'Ogden (84401)' }] });
        }
        // meetings: the fallback is the ONLY call carrying an upper bound
        return res({ data: state.args.lt ? meetingRows.past : meetingRows.future });
      },
    };
    return b;
  }
  return { calls, client: { from: q } };
}
async function runMeetings(rows) {
  const win = { HS: {}, HS_CONFIG: { DATA_SOURCE: 'supabase', SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'y' } };
  const sb = makeSb(rows);
  win.supabase = { createClient: () => sb.client };
  globalThis.window = win;
  new Function('window', dataSrc)(win);
  const out = await win.HS.data.meetings('84401', null);
  return { out, calls: sb.calls, HS: win.HS };
}

const future = [{ id: 'f1', title: 'County Commission', body: 'Weber County', meeting_date: '2099-01-01T06:00:00+00:00', category: 'County Commission & county business' }];
const past = [{ id: 'p1', title: 'County Commission', body: 'Weber County', meeting_date: '2020-01-01T06:00:00+00:00', category: 'County Commission & county business' }];

// §1 upcoming present -> upcoming returned, flag false, NO second query
{
  const { out, calls } = await runMeetings({ future, past });
  ok(out.length === 1 && out[0].id === 'f1', '§1a upcoming meetings are returned when present');
  ok(out.recent === false, '§1b .recent is FALSE when the set is upcoming');
  ok(calls.filter((c) => c.table === 'meetings').length === 1,
     '§1c the fallback query is NOT made when upcoming meetings exist');
  ok(!out.some((m) => m.recent), '§1d no row is marked recent');
}
// §2 nothing upcoming -> fallback, flag true, window bounded on BOTH ends
{
  const { out, calls } = await runMeetings({ future: [], past });
  ok(out.length === 1 && out[0].id === 'p1', '§2a the recent meeting is returned');
  ok(out.recent === true, '§2b .recent is TRUE so the caller can relabel');
  ok(out.every((m) => m.recent === true), '§2c every row is marked recent');
  const mq = calls.filter((c) => c.table === 'meetings');
  ok(mq.length === 2, '§2d exactly one fallback query');
  const fb = mq[1];
  ok(!!fb.args.lt, '§2e the fallback is bounded ABOVE — it can never return a future meeting');
  ok(fb.args.lt === mq[0].args.gte, '§2f its upper bound is exactly the upcoming cutoff (no gap, no overlap)');
  const days = (Date.parse(fb.args.lt) - Date.parse(fb.args.gte)) / 86400000;
  ok(Math.round(days) === 30, `§2g the window is 30 days (got ${Math.round(days)})`);
}
// §3 genuinely nothing -> empty, and the flag must NOT claim recent
{
  const { out } = await runMeetings({ future: [], past: [] });
  ok(out.length === 0, '§3a nothing upcoming and nothing recent -> empty');
  ok(out.recent === false, '§3b .recent is FALSE on an empty set, so the empty-state copy still shows');
}

// ------------------------------------------------------------------- the labels ----
const page = stripJs(pageSrc);
ok(/var mtgRecent\s*=\s*!!meetings\.recent/.test(page), '§4a the page reads the flag');
for (const [name, re] of [
  ['stat tile', /statTile\(meetings\.length,\s*mtgTile,/],
  ['group-head count', /meetings\.length \+ ' ' \+ mtgWord \+/],
  ['card sentence', /HS\.esc\(mtgSowhat\)/],
]) ok(re.test(page), `§4b the ${name} is derived from the flag, not hard-coded`);
ok(!/statTile\(meetings\.length,\s*'Public meetings'/.test(page),
   '§4c the stat tile no longer hard-codes "Public meetings"');
ok(!/meetings\.length \+ ' upcoming/.test(page),
   '§4d the group head no longer hard-codes " upcoming"');
ok(!/sowhat">Upcoming public meetings/.test(page),
   '§4e the card sentence no longer hard-codes "Upcoming public meetings"');
// the empty state is for a genuinely empty ZIP and MUST survive
ok(/No upcoming public meetings on file for this ZIP yet/.test(page),
   '§4f the honest empty state is still there for a ZIP with nothing at all');

// -------------------------------------------- the crawler document is NOT changed ----
const py = stripPy(pySrc);
ok(/rule_f_count.*n_um/.test(py), '§5a control: the generator still counts meetings toward Rule F');
ok(!/recent/i.test(py.split('def fetch_data')[1].split('def esc')[0] || ''),
   '§5b the generator fetch has NO recent window — past meetings cannot inflate indexability');
ok(!/\.lt\(|meeting_date=lt\./.test(py), '§5c the generator never queries below the cutoff');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
