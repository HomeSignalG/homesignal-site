// PUBLIC HEARINGS: a posting-date placeholder never reaches a resident (founder policy 2026-11-17/19).
// Run: node test/hearing-placeholder-leakage.test.mjs
// Executes the SHIPPED lib/templates.js, and checks the SQL and the build script by text.
import fs from 'node:fs';
import vm from 'node:vm';
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const ctx = { URL, console }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(read('lib/templates.js'), ctx);
const T = ctx.HS.tpl;
const PLACEHOLDER = '2026-11-19T07:00:00+00:00';
const undated = { title: 'Planning Commission hearing', starts_at: PLACEHOLDER, date_not_announced: true };

const row = T.meetingRow(undated);
ok(row.includes('Hearing date not announced'), '1a an undated hearing says "Hearing date not announced"');
ok(!/Nov(ember)?\s+1[89]/.test(row) && !row.includes('2026-11-19'), '1b the placeholder date is not printed');
ok(!/day(s)? away|Today/.test(row), '1c no countdown for an undated hearing');
const link = T.meetingRowLink(undated, 'https://example.gov/x');
ok(link.includes('Hearing date not announced') && !/Nov(ember)?\s+1[89]/.test(link), '1d the linked row withholds it too');

const dated = { title: 'Hearing', starts_at: '2026-12-04T17:00:00Z', date_not_announced: false };
ok(/Dec/.test(T.meetingRow(dated)), '2 a stated date still shows');

const prov = { title: 'H', starts_at: '2026-12-04T17:00:00Z', provisional: true };
ok(T.hearingExtras(prov).includes('Official confirmation pending'), '3a provisional is labelled');
ok(!T.hearingExtras(Object.assign({}, prov, { cancelled: true })).includes('confirmation pending'), '3b a cancelled one is not "pending"');
const dl = T.hearingExtras({ comment_deadline: '2026-12-01', participation_url: 'https://example.gov/c' });
ok(dl.includes('Comments due 2026-12-01') && dl.includes('How to comment'), '3c a verified deadline and its link show');
ok(!T.hearingExtras({ comment_deadline: '2026-12-01', participation_url: 'javascript:alert(1)' }).includes('javascript'), '3d a non-http participation link never renders');
ok(T.hearingExtras({}) === '', '3e nothing is invented');

const data = read('lib/data.js');
ok(/date_not_announced: m\.date_basis === 'posting_date_fallback'/.test(data), '4a the reader derives the flag from date_basis');
ok(/comment_deadline_verified === true \? \(m\.comment_deadline/.test(data), '4b only a VERIFIED deadline is carried');
ok(/hearing_key\.not\.is\.null/.test(data) && /comment_deadline_verified\.eq\.true/.test(data), '4c participation rows are read outside the 24-row cap');
ok(!/map1|pin|marker/i.test(data.slice(data.indexOf('PARTICIPATION FIRST'), data.indexOf('PARTICIPATION FIRST') + 900)), '4d no Map 1 pin is required');

const gen = read('scripts/gen_zip_pages.py');
ok(/"undated": m\.get\("date_basis"\) == "posting_date_fallback"/.test(gen)
  && /"date": \(""\s+if m\.get\("date_basis"\) == "posting_date_fallback"/.test(gen), '5 the static ZIP page withholds the placeholder too');

const sql = read('docs/public-hearings.sql');
ok(/create or replace function public\.hearing_public_date/.test(sql)
  && /date_basis in \('vendor_event','stated_in_notice','stated_in_title'\)/.test(sql), '6 the SQL derivation only exposes a stated date');
process.exit(fails ? 1 : 0);
