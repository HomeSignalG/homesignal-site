// MAPS · DATA CENTER THEME — FOUNDER-ORDERED ZIP CSV. Offline proof of the SITE half.
// No network, no browser, no DB.
//
// BEHAVIOURAL assertions load and RUN the shipped lib/maps-dc-zip-order.js, so the CSV
// contract is proven by execution. STRUCTURAL assertions read the shipped
// acquisition.html and docs/maps-dc-zip-order.sql, for contracts that live in a browser
// page or in the database.
//
// THE CONTRACT: one input control. It persists an ORDER. It creates no post, changes no
// post's state, and introduces no second approval, schedule or publish path.
import { readFileSync } from 'node:fs';

const DASH = readFileSync(new URL('../acquisition.html', import.meta.url), 'utf8');
const SQL = readFileSync(new URL('../docs/maps-dc-zip-order.sql', import.meta.url), 'utf8');
const LIB_SRC = readFileSync(new URL('../lib/maps-dc-zip-order.js', import.meta.url), 'utf8');

// Comment-stripped view: a doc comment naming a forbidden concept is not using it, and
// these files explain at length what they refuse to do.
const strip = (src) => src
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1 ')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
const DASH_CODE = strip(DASH);

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('PASS — ' + msg); else { bad++; console.log('FAIL — ' + msg); } };

const win = { HS: {} };
new Function('window', 'document', LIB_SRC)(win, {});
const HS = win.HS;

// ── 1-9 · CSV / ORDER ────────────────────────────────────────────────────────────────
const good = HS.parseZipOrderCsv('zip\n64155\n20166\n55405\n95054\n');
ok(good.ok === true && good.zips.length === 4, '1: valid CSV accepted');
ok(good.zips.join(',') === '64155,20166,55405,95054', '2: row order preserved exactly');

// 3 — the one that a spreadsheet breaks. Both directions asserted.
const zero = HS.parseZipOrderCsv('zip\n07446\n"01824"\n=\"02138\"\n\'05001\n');
ok(zero.ok === true && zero.zips[0] === '07446', '3a: leading-zero ZIP preserved as a string');
ok(zero.zips.join(',') === '07446,01824,02138,05001',
  '3b: quoted / Excel ="..." / leading-apostrophe forms all unwrap to 5-digit strings');

const dup = HS.parseZipOrderCsv('zip\n64155\n20166\n64155\n');
ok(dup.ok === false && /appears more than once/.test(dup.errors.join(' ')), '4: duplicate ZIP detected');

const malformed = HS.parseZipOrderCsv('zip\n64155\nABCDE\n');
ok(malformed.ok === false && /not a valid 5-digit ZIP/.test(malformed.errors.join(' ')),
  '5a: malformed ZIP rejected');
const truncated = HS.parseZipOrderCsv('zip\n7446\n');
ok(truncated.ok === false && truncated.zips.length === 0,
  '5b: a 4-digit value is REJECTED, never zero-padded into a different ZIP');
ok(/leading zero/i.test(truncated.errors.join(' ')),
  '5c: the 4-digit error explains the spreadsheet cause instead of just failing');

const badHeader = HS.parseZipOrderCsv('zipcode\n64155\n');
ok(badHeader.ok === false && /must be headed/.test(badHeader.errors.join(' ')),
  '6a: malformed CSV rejected (wrong header)');
const noHeader = HS.parseZipOrderCsv('64155\n20166\n');
ok(noHeader.ok === false, '6b: a file with no header row is rejected');

const blanks = HS.parseZipOrderCsv('zip\n64155\n\n \n20166\n');
ok(blanks.ok === true && blanks.zips.join(',') === '64155,20166', '7a: blank rows safely ignored');
ok(/Skipped 2 blank/.test(blanks.warnings.join(' ')),
  '7b: skipped blank rows are REPORTED, not silently dropped');
ok(HS.parseZipOrderCsv('zip\n64155\n').warnings.length === 0,
  '7c: a trailing newline is not miscounted as a blank row');

ok(HS.parseZipOrderCsv('zip\n').ok === false, '8a: empty usable list rejected (header only)');
ok(HS.parseZipOrderCsv('').ok === false, '8b: empty file rejected');
ok(HS.parseZipOrderCsv('   \n').ok === false, '8c: whitespace-only file rejected');

const MAX = HS.MAPS_DC_ZIP_ORDER_MAX;
ok(Number.isFinite(MAX) && MAX > 0, '9a: the maximum is an explicit documented constant, not a hidden limit');
const atMax = 'zip\n' + Array.from({ length: MAX }, (_, i) => String(10000 + i)).join('\n');
ok(HS.parseZipOrderCsv(atMax).ok === true, '9b: a list exactly at the maximum is accepted');
const overMax = 'zip\n' + Array.from({ length: MAX + 1 }, (_, i) => String(10000 + i)).join('\n');
const over = HS.parseZipOrderCsv(overMax);
ok(over.ok === false && new RegExp('maximum is ' + MAX).test(over.errors.join(' ')),
  '9c: over the maximum is rejected with a user-facing message naming the limit');

// A partial accept would shift every later founder priority, which is the renumbering the
// contract forbids — so one bad row rejects the WHOLE file.
ok(HS.parseZipOrderCsv('zip\n64155\nABCDE\n55405\n').zips.length === 0,
  '9d: a file with any invalid row is rejected whole, never partially accepted');

// Extra columns are ignored, and SAID to be ignored — a "priority" column must never
// silently compete with row order.
const extra = HS.parseZipOrderCsv('zip,priority\n64155,9\n20166,1\n');
ok(extra.ok === true && extra.zips.join(',') === '64155,20166',
  '9e: row order wins; an extra priority column does not reorder anything');
ok(/Ignored extra column/.test(extra.warnings.join(' ')), '9f: ignored columns are disclosed');

// ── 10-13 · PERSISTENCE ──────────────────────────────────────────────────────────────
ok(/founder_position\s+integer\s+not null/.test(SQL) && /PRIMARY KEY \(founder_position\)/.test(SQL),
  '10: order is persisted as a column and is the PRIMARY KEY, so it cannot be ambiguous');
ok(/order\('founder_position'\s*,\s*\{\s*ascending:\s*true/.test(DASH_CODE),
  '11a: the page reloads the list ORDERED by founder_position — same order every time');
const rt = HS.parseZipOrderCsv(HS.zipOrderToCsv(['07446', '64155', '20166']));
ok(rt.ok === true && rt.zips.join(',') === '07446,64155,20166',
  '11b: download -> re-upload round-trips losslessly, leading zero included');
ok(/hs_set_maps_dc_zip_order/.test(DASH_CODE) && /delete from public\.maps_dc_zip_order/.test(SQL),
  '12a: replacement goes through the one transactional RPC that clears and re-inserts');
ok(/with ordinality/i.test(SQL),
  '12b: array position becomes founder priority — no sort between upload and storage');
ok(HS.zipOrderToCsv(['07446', '64155']) === 'zip\n"07446"\n"64155"\n',
  '13: Download current list reproduces the persisted order, quoted so zeros survive Excel');
ok(HS.zipOrderTemplateCsv() === 'zip\n64155\n20166\n55405\n',
  '18: template is one zip column — no fake project data, no city/state, no priority column');

// ── 20-21 · SCOPE ────────────────────────────────────────────────────────────────────
ok(/_bskyFamily===.MAPS.\s*&&\s*_bskyTheme===.datacenter./.test(DASH_CODE),
  '20: the control renders only under MAPS > Data Center Theme, not other MAPS themes');
ok(/if\(!zipOrderVisible\(\)\)\{\s*host\.innerHTML=..;\s*return/.test(DASH_CODE),
  '21: it renders nothing at all outside that view, so ALERTS is untouched');

// ── 30-36 · THE FROZEN EXISTING WORKFLOW ─────────────────────────────────────────────
// The decisive proof is ABSENCE: this unit must add no way to change a post's state.
const panel = DASH_CODE.slice(DASH_CODE.indexOf('var _zipOrder'), DASH_CODE.indexOf('async function refreshBluesky'));
ok(panel.length > 500, 'panel slice located (guards the assertions below from vacuously passing)');
ok(!/social_posts/.test(panel), '30: the ZIP-order control never reads or writes social_posts');
ok(!/hs_approve_social_post/.test(panel), '31/32/33: it never calls approve — no second approval path, no auto-approve');
ok(!/status\s*:\s*['"]approved['"]/.test(panel) && !/\.update\(/.test(panel),
  '33b: it never sets a post status and performs no post update');
ok(!/scheduled_slot/.test(panel), '35: it never touches scheduling');
ok(!/image_bucket_path/.test(panel) && !/embed/.test(panel),
  '34: it never touches the image/embed gate');
// SCOPED ON PURPOSE. The bare word "publish" appears in the panel's own confirm() copy,
// which PROMISES published posts are not changed — flagging that sentence would be the
// over-flagging direction, and a guard that cries wolf gets deleted. What must be absent
// is an actual publishing CALL or module reference.
ok(!/publish\w*\s*\(/.test(panel) && !/publish-worker|publishPost|publish_worker/.test(panel),
  '36: it never invokes publishing (the word survives only in copy saying it is untouched)');
ok(/hs_set_maps_dc_zip_order/.test(panel) && /maps_dc_zip_order/.test(panel),
  'the only table and function it uses are its own');

// The approval gate itself must still be the shipped one, untouched by this unit.
ok(/function bskyApprovalBlockReason/.test(DASH_CODE) && /hs_approve_social_post/.test(DASH_CODE),
  '32b: the existing approval gate and RPC are still present and unmodified in shape');

// ── POSTURE ──────────────────────────────────────────────────────────────────────────
ok(/enable row level security/.test(SQL), 'RLS is enabled on the new table');
ok(/revoke all on public\.maps_dc_zip_order from anon/.test(SQL), 'anon is revoked outright');
ok(/auth\.jwt\(\) ->> 'email'\) = 'sdsutca@proton\.me'/.test(SQL.replace(/\(\(/g, '(')),
  'the RLS policy mirrors social_posts_owner_all');
ok(/raise exception\s*\n?\s*'maps_dc_zip_order must NOT be anon-readable/.test(SQL),
  'the DDL fails closed if a future edit makes it anon-readable');
ok(/errcode = '42501'/.test(SQL) && /not authorized/.test(SQL),
  'the SECURITY DEFINER write path re-checks the caller rather than trusting RLS it bypasses');

console.log(`\n${n - bad}/${n} passed`);
if (bad) process.exit(1);
