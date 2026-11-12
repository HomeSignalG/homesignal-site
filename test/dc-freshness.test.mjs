// DATA-CENTRE SOURCE FRESHNESS on Map 1 (lib/dc-freshness.js) — the offline half.
// The SQL half is test/dc_source_freshness_pg/run.sh (dc-source-freshness-suite.yml).
//   A  three separate dates, worded separately; a failed attempt names the read the records come from
//   B  no per-facility claim: the notice says the dates are dataset-level
//   C  only sources with a record on the page are shown; unknown states never read as success
//   D  fail closed: a missing reader, a failed read or a non-array answer renders nothing
//   E  the page wires it (script, element, mount) and shows it only for national data-centre records
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

let fails = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { fails++; console.log('FAIL — ' + name + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(read('lib/dc-freshness.js'), ctx);
const HS = ctx.window.HS;

// Real values read from production on 2026-11-12 (public.dc_source + dc_acquisition_run), in the
// shape docs/dc-source-freshness.sql returns.
const ATLAS = { source_key: 'compute_atlas', source_name: 'Compute Atlas (Edward Kubiak)',
  publisher_edition_at: '2026-11-05T18:24:03.746+00:00', last_success_at: '2026-11-06T09:45:05.255227+00:00',
  last_attempt_at: '2026-11-12T09:44:17.109168+00:00', last_attempt_state: 'FETCH_FAILED' };
const EPOCH = { source_key: 'epoch_ai', source_name: 'Epoch AI', publisher_edition_at: null,
  last_success_at: '2026-11-12T10:16:26.708644+00:00', last_attempt_at: '2026-11-12T10:16:27.38218+00:00',
  last_attempt_state: 'SUCCESS_COMPLETE' };
const ROWS = [EPOCH, ATLAS];

// ---- A
const a = HS.dcFreshnessEntries(ROWS, ['Compute Atlas (Edward Kubiak)']);
ok(a.length === 1 && a[0].key === 'compute_atlas', 'A1 only the source on the page is listed', a);
const la = HS.dcFreshnessLines(a[0]);
ok(la[0] === "Publisher's edition date: November 5, 2026", 'A2 the publisher edition date is its own line', la[0]);
ok(la[1] === 'Our last successful read: November 6, 2026', 'A3 our last successful read is its own line', la[1]);
ok(la[2] === "Our most recent read attempt: November 12, 2026, did not complete: the publisher's file could not be downloaded. The records shown are from the November 6, 2026 read.",
  'A4 the most recent attempt, its outcome, and which read the records come from', la[2]);
ok(new Set([a[0].edition, a[0].success, a[0].attempt]).size === 3, 'A5 the three dates are three different values here');
const le = HS.dcFreshnessLines(HS.dcFreshnessEntries(ROWS, ['Epoch AI'])[0]);
ok(le[0] === "Publisher's edition date: not stated by the publisher", 'A6 a publisher that states no edition date is said so, never filled in', le[0]);
ok(le[2] === 'Our most recent read attempt: November 12, 2026, completed.', 'A7 a successful attempt adds no stale sentence', le[2]);

// ---- B
const html = HS.dcFreshnessHTML(HS.dcFreshnessEntries(ROWS, ['Compute Atlas (Edward Kubiak)', 'Epoch AI']));
ok(html.includes('They do not mean that each facility was individually checked on either date.'),
  'B1 the notice says the dates are not per-facility checks');
ok(!/verified|confirmed|up to date|current as of/i.test(html), 'B2 no wording that implies verification', html.match(/verified|confirmed|up to date|current as of/i));
ok(html.includes('data-dc-stale="1"') && html.includes('Data-center records here may be out of date'),
  'B3 a failed newest attempt marks the notice and changes its heading');
ok((html.match(/data-dc-attempt-failed="1"/g) || []).length === 1 && html.indexOf('Compute Atlas') < html.indexOf('Epoch AI'),
  'B4 only the failing source row is marked; rows are in name order');
const fine = HS.dcFreshnessHTML(HS.dcFreshnessEntries(ROWS, ['Epoch AI']));
ok(!fine.includes('data-dc-stale') && fine.includes('About the data-center records'), 'B5 a healthy source gets the plain heading');

// ---- C
ok(HS.dcFreshnessEntries(ROWS, []).length === 0 && HS.dcFreshnessEntries(ROWS, ['OpenStreetMap']).length === 0,
  'C1 a source with no record on the page (or no acquisition row) is not shown');
ok(HS.dcFreshnessHTML([]) === '', 'C2 nothing to show renders nothing');
for (const st of ['PARTIAL', 'SCHEMA_REJECTED', 'IN_FLIGHT', 'SOMETHING_NEW', null, undefined, '']) {
  const e = HS.dcFreshnessEntries([Object.assign({}, ATLAS, { last_attempt_state: st })], [ATLAS.source_name])[0];
  ok(e.attemptOk === false && !/, completed\./.test(HS.dcFreshnessLines(e)[2]), 'C3 state ' + JSON.stringify(st) + ' never reads as a completed read');
}
const never = HS.dcFreshnessLines(HS.dcFreshnessEntries([{ source_key: 'x', source_name: 'X', publisher_edition_at: null,
  last_success_at: null, last_attempt_at: null, last_attempt_state: null }], ['X'])[0]);
ok(never[1] === 'Our last successful read: none recorded' && never[2] === 'Our most recent read attempt: none recorded',
  'C4 a source never read says so', never);
const x = HS.dcFreshnessHTML(HS.dcFreshnessEntries([Object.assign({}, ATLAS, { source_name: '<img src=x onerror=1>' })], ['<img src=x onerror=1>']));
ok(!x.includes('<img') && x.includes('&lt;img'), 'C5 a source name is escaped');
ok(HS.dcFreshnessDay('2026-13-45T00:00:00Z') === '' && HS.dcFreshnessDay(null) === '' && HS.dcFreshnessDay('yesterday') === '',
  'C6 an unreadable date is blank, never a guess');

// ---- P (the popup line)
const pl = HS.dcFreshnessPopupLine(ROWS, 'Compute Atlas (Edward Kubiak)');
ok(pl === 'From this source\u2019s dataset. Publisher\u2019s edition date: November 5, 2026. Our last successful read: November 6, 2026. Our most recent read attempt (November 12, 2026) did not complete. This facility was not individually checked on either date.',
  'P1 the popup line: three dates and no per-facility claim', pl);
const pe = HS.dcFreshnessPopupLine(ROWS, 'Epoch AI');
ok(pe === 'From this source\u2019s dataset. Publisher\u2019s edition date: not stated. Our last successful read: November 12, 2026. This facility was not individually checked on either date.',
  'P2 a healthy source: no failed-attempt sentence, edition not invented', pe);
ok(HS.dcFreshnessPopupLine(ROWS, 'OpenStreetMap') === '' && HS.dcFreshnessPopupLine(null, 'Epoch AI') === '' && HS.dcFreshnessPopupLine(ROWS, undefined) === '',
  'P3 no row, no read or no source name: no line');

// ---- D
const el = () => ({ innerHTML: 'old' });
{
  const e1 = el(); await HS.mountDcFreshness(e1, { names: [ATLAS.source_name], read: () => Promise.resolve(null) });
  ok(e1.innerHTML === '', 'D1 a failed read renders nothing');
  const e2 = el(); await HS.mountDcFreshness(e2, { names: [ATLAS.source_name], read: () => Promise.reject(new Error('x')) });
  ok(e2.innerHTML === '', 'D2 a rejected read renders nothing');
  const e3 = el(); await HS.mountDcFreshness(e3, { names: [ATLAS.source_name], read: () => { throw new Error('x'); } });
  ok(e3.innerHTML === '', 'D3 a throwing reader renders nothing');
  const e4 = el(); await HS.mountDcFreshness(e4, { names: [ATLAS.source_name], read: () => Promise.resolve({ message: 'not found' }) });
  ok(e4.innerHTML === '', 'D4 a non-array answer (a missing function) renders nothing');
  let called = 0;
  const e5 = el(); await HS.mountDcFreshness(e5, { names: [], read: () => { called++; return Promise.resolve(ROWS); } });
  ok(e5.innerHTML === '' && called === 0, 'D5 no data-centre record on the page: nothing shown and nothing requested');
  const e6 = el(); await HS.mountDcFreshness(e6, { names: [ATLAS.source_name], read: () => Promise.resolve(ROWS) });
  ok(e6.innerHTML.includes('November 6, 2026') && e6.innerHTML.includes('data-dc-freshness="1"'), 'D6 a good read renders the notice');
  const e7 = el();
  let release; const slow = new Promise((r) => { release = r; });
  const first = HS.mountDcFreshness(e7, { names: [ATLAS.source_name], read: () => slow });
  await HS.mountDcFreshness(e7, { names: ['Epoch AI'], read: () => Promise.resolve(ROWS) });
  release(ROWS); await first;
  ok(e7.innerHTML.includes('Epoch AI') && !e7.innerHTML.includes('Compute Atlas'), 'D7 a late answer for an older render never overwrites the newer one');
}

// ---- E
const page = read('homesignalmap.html');
const key = createHash('sha256').update(read('lib/dc-freshness.js')).digest('hex').slice(0, 8);
ok(page.includes('<script src="lib/dc-freshness.js?v=' + key + '"></script>'), 'E1 the page loads lib/dc-freshness.js with its current cache key', key);
ok((page.match(/<div id="dcFresh"><\/div>/g) || []).length === 1, 'E2 one mount element');
ok(/HS\.mountDcFreshness\(\$\("dcFresh"\), \{\s*names: sites\.filter\(function\(s\)\{ return s && s\.record_kind === "national_project"; \}\)/.test(page),
  'E3 the notice is asked only for national data-centre records on the page');
ok((page.match(/"\/rest\/v1\/rpc\/dc_source_freshness"/g) || []).length === 1 && /read: dcFreshRead\b/.test(page),
  'E4 one reader call, to public.dc_source_freshness, shared by the notice and the popups');
ok(/m\.bindPopup\(function\(\)\{ return popupHTML\(s\); \}\);/.test(page) && /mk\.bindPopup\(function\(\)\{ return popupHTML\(s\); \}, \{ maxWidth:260 \}\);/.test(page)
  && /popup\.on\("open", function\(\)\{ popup\.setHTML\(popupHTML\(s\)\); \}\);/.test(page),
  'E7 every popup is built when it opens, so a pin drawn before the read still gets the line');
ok(/s\.record_kind !== "national_project" \|\| !DC_FRESH_ROWS/.test(page) && /approxNote\+fanNote\+dcFreshNote\(s\);/.test(page),
  'E8 the popup line is only for a national data-centre record and only after the reader answered');
ok(/\.hs-embed #dcFresh,/.test(page), 'E9 the embedded map hides the block below the map (its pins carry the line instead)');
const sql = read('docs/dc-source-freshness.sql');
ok(/returns table\(source_key text, source_name text, publisher_edition_at timestamptz,\s*last_success_at timestamptz, last_attempt_at timestamptz, last_attempt_state text\)/.test(sql),
  'E5 the SQL returns the columns the page reads');
ok(!/\b(insert|update|delete|truncate)\b/i.test(sql.replace(/--.*$/gm, '')), 'E6 the reader writes nothing');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
