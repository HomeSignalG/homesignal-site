// TAB 12 QUEUE ORDER — subscriber ZIPs first, drafts next, approved last (founder, 2026-11-11).
// Run: node test/bluesky-queue-order.test.mjs
//
// Three halves: the grouping library (run), the page's own renderer (extracted from
// acquisition.html and run with stubs), and the SQL reader (shape pins).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m); } };

// ── 1 · THE LIBRARY ──────────────────────────────────────────────────────────────
const ctx = { globalThis: null, Date, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(rd('../lib/acq-bluesky-queue-order.js'), ctx);
const HS = ctx.HS;

const rows = [
  { id: 'a1', content_family: 'MAPS', zip: '11111', status: 'approved', scheduled_slot: '2026-11-12T16:30:00Z', created_at: '2026-11-01T00:00:00Z' },
  { id: 'a2', content_family: 'MAPS', zip: '22222', status: 'approved', scheduled_slot: '2026-11-11T16:30:00Z', created_at: '2026-11-02T00:00:00Z' },
  { id: 'd1', content_family: 'MAPS', zip: '33333', status: 'draft', scheduled_slot: null, created_at: '2026-11-09T00:00:00Z' },
  { id: 'd2', content_family: 'MAPS', zip: '33333', status: 'draft', scheduled_slot: null, created_at: '2026-11-11T08:00:00Z' },
  { id: 's1', content_family: 'MAPS', zip: '64166', status: 'draft', scheduled_slot: null, created_at: '2026-11-10T00:00:00Z' },
  { id: 's2', content_family: 'MAPS', zip: '64166', status: 'draft', scheduled_slot: null, created_at: '2026-11-11T09:00:00Z' },
  { id: 's3', content_family: 'MAPS', zip: '85083', status: 'approved', scheduled_slot: '2026-11-13T16:30:00Z', created_at: '2026-11-03T00:00:00Z' },
  { id: 'x1', content_family: 'ALERTS', zip: '64166', status: 'draft', scheduled_slot: null, created_at: '2026-11-11T10:00:00Z' },
];
const g = HS.bskyQueueGroups(rows, ['64166', '85083', '99999']);
const ids = (a) => a.map((p) => p.id).join(',');
ok(ids(g.subscriber) === 's2,s1,s3', 'subscriber group: that ZIP\'s drafts newest first, then its approved posts');
ok(ids(g.review) === 'x1,d2,d1', 'every other draft, newest first');
ok(ids(g.approved) === 'a2,a1', 'other approved posts by posting time, soonest first');
ok(g.subscriber.length + g.review.length + g.approved.length === rows.length, 'every row is in exactly one group');
ok(!g.subscriber.some((p) => p.content_family !== 'MAPS'), 'an ALERTS post on a subscriber ZIP is not a subscriber map post');
const g0 = HS.bskyQueueGroups(rows, []);
ok(g0.subscriber.length === 0 && ids(g0.approved) === 'a2,a1,s3', 'no subscriber ZIPs: nothing is promoted');

const st = HS.bskySubscriberZipStatus(
  [{ zip: '64166', subscribers: 1, last_published_at: null }, { zip: '85083', subscribers: 1, last_published_at: '2026-11-10T16:30:00Z' },
   { zip: '99999', subscribers: 2, last_published_at: null }], rows);
ok(st.length === 3 && st[0].drafts === 2 && st[0].approved === 0, '64166: 2 drafts to review (the ALERTS row is not counted)');
ok(st[1].drafts === 0 && st[1].approved === 1 && st[1].next_slot === '2026-11-13T16:30:00Z', '85083: 1 approved, with its posting time');
ok(st[2].drafts === 0 && st[2].approved === 0 && st[2].subscribers === 2, 'a subscriber ZIP with nothing queued is still listed');

// ── 2 · THE PAGE'S RENDERER, extracted and run ───────────────────────────────────
const PAGE = rd('../acquisition.html');
const a = PAGE.indexOf('  function bskyGroupHead(');
const b = PAGE.indexOf('  function bskyNavBtn(');
ok(a > 0 && b > a, 'the renderer region is where the test expects it');
const run = (family, sub, visible, open) => {
  const c = { HS, Date, isNaN, String };
  vm.createContext(c);
  vm.runInContext(
    'var _bskyFamily=' + JSON.stringify(family) + ', _bskyApprovedOpen=' + (open ? 'true' : 'false') + ';' +
    'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");}' +
    'function fmtSlot(t){return "SLOT("+t+")";}' +
    'function blueskyRow(p){return "[[" + p.id + "]]";}' +
    'var window={HS:HS};' + PAGE.slice(a, b) +
    ';var OUT=bskyQueueHtml(VIS, ALL, SUB, "EMPTY");', Object.assign(c, { VIS: visible, ALL: rows, SUB: sub }));
  return c.OUT;
};
const SUB = { zips: [{ zip: '64166', subscribers: 1, last_published_at: null }, { zip: '85083', subscribers: 1, last_published_at: '2026-11-10T16:30:00Z' }], error: '' };
const out = run('all', SUB, rows, false);
const pos = (s) => out.indexOf(s);
ok(pos('Subscriber ZIPs') >= 0 && pos('Subscriber ZIPs') < pos('[[s2]]') && pos('[[s2]]') < pos('To review')
  && pos('To review') < pos('[[d2]]') && pos('[[d2]]') < pos('Approved and scheduled') && pos('Approved and scheduled') < pos('[[a2]]'),
  'page order: Subscriber ZIPs, then To review, then Approved and scheduled');
ok(pos('[[a2]]') > pos('[[d1]]') && pos('[[a1]]') > pos('[[s1]]'), 'no approved post is listed above a draft');
ok(/<details id="bsky-approved" style/.test(out) && /<details id="bsky-approved" open/.test(run('all', SUB, rows, true)),
  'Approved is folded by default and stays open once opened');
ok(/data-sub-zip="64166"[^]*?2 drafts to review/.test(out) && /data-sub-zip="85083"[^]*?1 approved, next posts SLOT/.test(out),
  'each subscriber ZIP has its own status line');
ok(/no post published yet, so no email has gone out/.test(out), 'a ZIP with no published post says no email has gone out');
ok((out.match(/\[\[/g) || []).length === rows.length, 'every visible post is drawn exactly once');
const errOut = run('all', { zips: [], error: 'boom' }, rows, false);
ok(/could not be read \(boom\)/.test(errOut) && /NOT separated/.test(errOut) && !/No ZIP has a/.test(errOut),
  'a failed subscriber read is shown, never read as "no subscribers"');
ok(/No ZIP has a Development-alert subscriber yet/.test(run('all', { zips: [], error: '' }, rows, false)), 'no subscribers: says so');
ok(!/Subscriber ZIPs/.test(run('ALERTS', SUB, rows.filter((p) => p.content_family !== 'MAPS'), false)), 'the ALERTS view has no subscriber section');
ok(/EMPTY/.test(run('all', SUB, [], false)), 'an empty queue keeps its message');

// ── 3 · PAGE WIRING ───────────────────────────────────────────────────────────────
ok(/rpc\('hs_bsky_subscriber_zips'\)/.test(PAGE), 'the page asks the database which ZIPs have a subscriber');
ok(/body\.innerHTML=bskyQueueHtml\(visible, rows, sub, emptyMsg\);/.test(PAGE), 'the queue is drawn by the grouped renderer');
ok(!/body\.innerHTML=visible\.length\?visible\.map\(blueskyRow\)/.test(PAGE), 'the old flat list (approved first) is gone');
ok(/lib\/acq-bluesky-queue-order\.js\?v=[0-9a-f]{8}/.test(PAGE), 'the library is loaded with a content key');

// ── 4 · THE SQL READER ───────────────────────────────────────────────────────────
const SQL = rd('../docs/bluesky-subscriber-zips.sql').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
ok(/dashboard_admins/.test(SQL) && /raise exception 'not authorized'/.test(SQL), 'admin-only');
ok(/from public\.bsky_maps_priority_classification c\s+where c\.class = 'eligible'/.test(SQL), 'reads the one classification; test sign-ups are not subscribers');
ok(!/email'?\s*,/.test(SQL.replace(/caller_email[^;]*;/g, '')) && !/user_id/.test(SQL), 'returns no email and no user id');
ok(/revoke all on function public\.hs_bsky_subscriber_zips\(\) from public, anon;/.test(SQL)
  && /grant execute on function public\.hs_bsky_subscriber_zips\(\) to authenticated;/.test(SQL), 'anon cannot call it');
ok(!/\b(insert|update|delete)\b/i.test(SQL), 'it writes nothing');

console.log('\n' + (n - bad) + '/' + n + ' passed');
process.exit(bad ? 1 : 0);
