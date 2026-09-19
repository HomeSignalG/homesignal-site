// MAPS · DATA CENTER THEME — the panel says what actually happened, and a locked
// Approve LOOKS locked. Offline proof of the four dashboard corrections made 2026-09-19.
// No network, no browser, no DB.
//
// BEHAVIOURAL WHERE IT CAN BE. The two decisions under test — "what status does this ZIP
// get?" and "does this post's Approve start locked?" — are plain functions inside
// acquisition.html, so they are EXTRACTED FROM THE SHIPPED PAGE and executed against the
// real classifier (lib/map.js + lib/maps-social-theme.js). Nothing here re-implements a
// rule; a grep alone would prove a line exists and nothing about what it decides.
//
// THE FOUR DEFECTS, all measured against production on 2026-09-19:
//   1. zipOrderStatusMap counted only data-centre drafts, so 9 ZIPs that each produced a
//      draft rendered as blank cells — indistinguishable from the 1 ZIP that produced
//      nothing. All ten rows read the same.
//   2. The Approve button's lock came from mapsImageRequired (MAPS *and* an image path),
//      so the one Data Center Theme post — which has no capture at all — rendered as a
//      normal enabled button and was refused only on click.
//   3. "Replace CSV" was a one-way door: no control returned the generator to its
//      nationwide scan, though the panel's own copy promised that state existed.
//   4. zipOrderLoad set `loaded = true` even on failure, so one transient error pinned the
//      panel to "unavailable" until a full browser reload.
import { readFileSync } from 'node:fs';

const DASH = readFileSync(new URL('../acquisition.html', import.meta.url), 'utf8');
const strip = (src) => src
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1 ')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
const CODE = strip(DASH);

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('PASS — ' + msg); else { bad++; console.log('FAIL — ' + msg); } };

// ── THE REAL CLASSIFIER, so theme membership here is Map 1's own answer ──────────────
const win = { HS: {} };
const doc = { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  querySelectorAll: () => [], getElementById: () => null, addEventListener() {} };
for (const f of ['../lib/map.js', '../lib/maps-social-theme.js']) {
  new Function('window', 'document', readFileSync(new URL(f, import.meta.url), 'utf8'))(win, doc);
}
win.window = win;
ok(typeof win.HS.resolveMarker === 'function' && typeof win.HS.mapsSocialThemeKey === 'function',
  'the shipped Map 1 classifier and theme helper both loaded (guards every check below '
  + 'from passing vacuously against a stub)');

// ── EXTRACT the shipped functions and RUN them ───────────────────────────────────────
const slice = (from, to, label) => {
  const i = CODE.indexOf(from), j = CODE.indexOf(to);
  ok(i > -1 && j > i, `${label}: located in the shipped page`);
  return CODE.slice(i, j);
};
// mapsImageRequired -> bskyTheme -> dcThemeImageMandatory -> bskyApprovalGated, contiguous.
const gateSrc = slice('function mapsImageRequired', 'function bskyApprovalBlockReason', 'approval gate');
const statusSrc = slice('function zipOrderStatusMap', 'function zipOrderRender', 'status map');
const sandbox = new Function('window', 'HS',
  `${gateSrc}\n${statusSrc}\nreturn { mapsImageRequired, dcThemeImageMandatory, bskyApprovalGated, bskyTheme, zipOrderStatusMap };`
)(win, win.HS);
const { dcThemeImageMandatory, bskyApprovalGated, bskyTheme, zipOrderStatusMap } = sandbox;

// Real production shapes. The data-centre row is the live queue's only theme post.
const DC = { id: 'dc', zip: '64155', status: 'draft', content_family: 'MAPS', tile: 'development',
  image_bucket_path: null,
  evidence: { type: 'Development', project_name: 'RBC Data Center Campus Major Amendment', status: 'Proposed' } };
const OFF = { id: 'off', zip: '64105', status: 'draft', content_family: 'MAPS', tile: 'development',
  image_bucket_path: null,
  evidence: { type: 'Development', project_name: 'Kansas City Board of Education Parking Lot Expansion', status: 'Proposed' } };
const WITH_IMG = Object.assign({}, OFF, { id: 'img', image_bucket_path: 'social-posts/img.png' });
const ALERTS = { id: 'a', zip: '64155', status: 'draft', content_family: 'ALERTS', tile: 'notices' };

ok(bskyTheme(DC) === 'datacenter', 'control: the real classifier still calls the live row a data centre');
ok(bskyTheme(OFF) === null, 'control: it still refuses the parking-lot row');

// ── 1 · APPROVE LOOKS THE WAY IT BEHAVES ─────────────────────────────────────────────
ok(bskyApprovalGated(DC) === true,
  '1a: a Data Center Theme post with NO capture starts LOCKED — this is the defect, and '
  + 'mapsImageRequired alone returns false for it');
ok(sandbox.mapsImageRequired(DC) === false,
  '1b: and mapsImageRequired really does return false here, so 1a is not passing by accident');
ok(bskyApprovalGated(WITH_IMG) === true, '1c: a MAPS post carrying an image still starts locked until seen');
ok(bskyApprovalGated(OFF) === false,
  '1d: an off-theme MAPS post with no image is NOT locked — the DC rule must not become a '
  + 'blanket lock on every imageless draft');
ok(bskyApprovalGated(ALERTS) === false, '1e: ALERTS is untouched by this gate');
ok(dcThemeImageMandatory(ALERTS) === false, '1f: the theme rule never fires outside MAPS');
// The rendered button must derive from the SAME predicate, or appearance and behaviour part.
ok(/\(bskyApprovalGated\(p\)\s*\n?\s*\?\s*' data-gate="image" disabled/.test(CODE),
  '1g: the button renders its lock from bskyApprovalGated, not from mapsImageRequired');
ok(!/\(mapsImageRequired\(p\)\s*\n?\s*\?\s*' data-gate="image"/.test(CODE),
  '1h: the old narrower render condition is gone (the defect cannot be reintroduced silently)');
ok(/function bskyApprovalBlockReason/.test(CODE) && /bskyApprovalBlockReason\(gr\)/.test(CODE),
  '1i: the click-time refusal is UNCHANGED — the affordance fix is additive, never a '
  + 'replacement for the check that actually blocks the write');

// ── 2 · EVERY ZIP OUTCOME NAMES ITSELF ───────────────────────────────────────────────
const m = zipOrderStatusMap([DC, OFF, ALERTS]);
ok(m['64155'] && m['64155'].label === 'Draft exists' && m['64155'].cls === 't-persist',
  '2a: a data-centre draft reports as a theme draft');
ok(m['64105'] && /not a data centre/.test(m['64105'].label) && m['64105'].cls === 't-pending',
  '2b: an OFF-THEME draft is reported as off-theme, not hidden — this is the whole defect');
ok(!!m['64105'] && !!m['64155'] && m['64105'].rank < 2 && m['64155'].rank >= 2,
  '2c: rank separates theme from off-theme, so the render can count the off-theme ones');
ok(Object.keys(m).length === 2, '2d: the ALERTS row contributes no ZIP status');
const approved = zipOrderStatusMap([DC, Object.assign({}, DC, { id: 'dc2', status: 'approved' })]);
ok(!!approved['64155'] && approved['64155'].label === 'Approved' && approved['64155'].cls === 't-real',
  '2e: approved still outranks draft for the same ZIP');
const mixed = zipOrderStatusMap([Object.assign({}, OFF, { zip: '64155', status: 'approved' }), DC]);
ok(!!mixed['64155'] && mixed['64155'].label === 'Draft exists',
  '2f: a THEME draft outranks an APPROVED off-theme post on the same ZIP — the founder is '
  + 'told about the data centre, not about the parking lot');
ok(/no draft yet/.test(CODE),
  '2g: a ZIP with no post renders a named outcome, never an empty cell');
// The sentence is built by string concatenation in the page, so it is matched on the
// JOINED copy rather than on the raw source — a regex over the raw file would be testing
// where the '+' happens to fall, which is not a contract.
const COPY = DASH.replace(/'\s*\+\s*\n?\s*'/g, '');
ok(/does not restrict the generator to this theme/.test(COPY)
   && /newest eligible project of any type/.test(COPY),
  '2h: the panel states in copy that the ordered run is NOT theme-filtered and drafts any type');
ok(/which<\/b> ZIPs the generator looks at/.test(COPY),
  '2i-pre: and states what the list DOES decide, so the correction is not just a disclaimer');
// NOT a guess dressed as a fact: the panel must never claim to know why a ZIP is empty.
ok(!/no qualifying project/i.test(CODE.slice(CODE.indexOf('function zipOrderStatusMap'), CODE.indexOf('async function refreshBluesky'))),
  '2i: the panel still never asserts "no qualifying project" — only the generator knows that');

// ── 3 · THE ONE-WAY DOOR IS OPEN ─────────────────────────────────────────────────────
ok(/data-zo="clear"/.test(CODE), '3a: a Clear control exists');
ok(/if\(act==='clear'\)\{ zipOrderClear\(\); return; \}/.test(CODE), '3b: it is routed');
ok(/hs_set_maps_dc_zip_order',\{p_zips:\[\]\}/.test(CODE.replace(/\s+/g, ' ').replace(/ ,/g, ',')) ||
   /p_zips:\s*\[\]/.test(CODE),
  '3c: it clears through the SAME single-transaction RPC as an upload, so a clear cannot '
  + 'half-succeed and leave a truncated order');
ok(/rows\.length\?'<button class="bsky-btn" data-zo="clear"/.test(CODE),
  '3d: it is offered only when a list exists');
const clearFn = CODE.slice(CODE.indexOf('async function zipOrderClear'), CODE.indexOf('async function refreshBluesky'));
ok(/confirm\(/.test(clearFn), '3e: it confirms before destroying the order');
ok(/Download current list/.test(DASH.slice(DASH.indexOf('async function zipOrderClear'), DASH.indexOf('async function refreshBluesky'))),
  '3f: the confirm points at the download, because a cleared order is not recoverable here');
ok(!/\.delete\(|\.update\(|social_posts/.test(clearFn),
  '3g: clearing touches no post and no other table');

// ── 4 · A FAILED READ IS NOT A LOADED ONE ────────────────────────────────────────────
ok(/_zipOrder\.loaded\s*=\s*!_zipOrder\.error;/.test(CODE),
  '4a: only a successful read marks the list loaded, so a transient failure retries');
ok(!/_zipOrder\.loaded\s*=\s*true;/.test(CODE),
  '4b: the unconditional form is gone');

console.log(`\n${n - bad}/${n} passed`);
if (bad) process.exit(1);
