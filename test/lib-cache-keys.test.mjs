// A SHIPPED FIX THAT THE BROWSER NEVER FETCHES IS NOT A SHIPPED FIX.
// Run: node test/lib-cache-keys.test.mjs
//
// WHY THIS FILE EXISTS. Four consecutive colour fixes were merged, deployed green, and
// produced ZERO visible change on the live page. The colours were never the problem:
//
//     <script src="lib/map.js?v=20260720b"></script>
//
// Every one of those fixes lives in lib/map.js, and that cache key had not moved since
// 20 July while the file changed four times in an hour — so browsers kept serving a
// July copy. lib/templates.js, which holds the neutral, carried NO key at all on any of
// its 14 call sites. Meanwhile edits to homesignalmap.html itself DID appear, because an
// HTML document revalidates; that contrast is what made the deploys look successful.
//
// THE KEY IS NOW THE CONTENT, NOT A DATE. A dated key is a promise a human has to keep
// on every edit, and this is what happens when it is not kept — silently, with green CI
// and a green deploy the whole way. `?v=<first 8 of sha256(file)>` cannot go stale,
// because it IS the file: change a byte and the URL changes with it. That is a
// deliberate departure from the dated keys on the sibling libs, which keep theirs.
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// shell.js joins the two libs #1087 keyed. It is the shared runtime — the header, the
// search, the modals, the boot sequence — so a fix in it that a browser never fetches is
// the same class of silent failure, and #1089's search fix was the first to ship behind
// exactly that risk. Its tags are written as src="shell.js" on the 14 pages and as
// src="/shell.js" by the generator (which carries <base href="/">), so §1 matches both.
const CONTENT_KEYED = ['lib/map.js', 'lib/templates.js', 'shell.js'];
const pages = readdirSync(root).filter((f) => f.endsWith('.html'))
  .concat(readdirSync(join(root, 'partials')).filter((f) => f.endsWith('.html')).map((f) => 'partials/' + f));

const key = (rel) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex').slice(0, 8);

// §1 — every content-keyed file's tags carry EXACTLY its current content hash.
CONTENT_KEYED.forEach((rel) => {
  const want = key(rel);
  const found = [];
  pages.forEach((p) => {
    const src = readFileSync(join(root, p), 'utf8');
    const re = new RegExp('src="/?' + rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?v=([^"]*))?"', 'g');
    let m;
    while ((m = re.exec(src))) found.push({ page: p, key: m[2] || null });
  });
  ok(found.length > 0, `1a: ${rel} is actually loaded by at least one page (${found.length} tags)`);
  const wrong = found.filter((f) => f.key !== want);
  ok(wrong.length === 0,
    `1b: all ${found.length} ${rel} tags carry its content hash ?v=${want}`
    + (wrong.length ? ` — stale: ${wrong.map((w) => w.page + ' (' + w.key + ')').join(', ')}` : ''));
});

// §2 — the KEYLESS set may not grow. Nine other libs carry no ?v= at all, which is the
// same latent defect: a fix in one of them would ship, deploy green, and never reach a
// browser that already has the file. They are NOT keyed here — that is a product-wide
// change nobody asked for, in a session that has already produced several surprises, and
// each one needs the same check for hard-coded URL references that caught
// scripts/verify-map-markers.mjs. So the set is PINNED at its measured membership: a NEW
// keyless lib fails immediately, and closing the existing nine stays a deliberate act.
// ⚠️ MEASURED, NOT FIXED — the nine are listed so this is a record, not a silence.
// ⚠️ WIDENED from `lib/*.js` to EVERY same-origin script. The original sweep could only
// ever see lib/, so a keyless script anywhere else was not "known" — it was invisible.
// shell.js was keyless on all 14 pages for the life of the repo and this pin reported
// nothing, which is the failure mode §2 exists to prevent: an absence that reads as a pass.
// Now shell.js is content-keyed above and the rest are pinned at measured membership.
const KNOWN_KEYLESS = new Set([
  'lib/data.js', 'lib/topic-prefs.js', 'lib/impact.js', 'lib/gov-notice-copy.js',
  'lib/community-page.js', 'lib/coverage-copy.js', 'lib/why.js', 'lib/landing.js',
  'config.js', 'seed/delvalle.js', 'share.js', 'assets/acquisition-video-producer.js'
]);
// A leading "/" is the generator's absolute form, not a different file (same rule as
// test/zip-page-shared-runtime.test.mjs). Absolute http(s) sources are third-party CDN
// loads, versioned in their own URL, and are not ours to key.
const localSrc = (u) => u.replace(/^\//, '');
const keyless = new Set();
pages.forEach((p) => {
  const src = readFileSync(join(root, p), 'utf8');
  const re = /<script\s+src="(?!https?:)([^"?]+\.js)"/g;
  let m;
  while ((m = re.exec(src))) keyless.add(localSrc(m[1]));
});
const unexpected = [...keyless].filter((f) => !KNOWN_KEYLESS.has(f));
ok(unexpected.length === 0,
  '2a: no NEW keyless same-origin script has appeared'
  + (unexpected.length ? ' — ' + unexpected.join(', ') : ` (${keyless.size} known, pinned)`));
// And the two files that carry shipped fixes must never fall back into that set.
CONTENT_KEYED.forEach((rel) => {
  ok(!keyless.has(rel), `2b: ${rel} is never loaded keyless`);
});

// §3 — one file, one key across every page, or a partial bump ships a split brain where
// two pages run different versions of the same module.
const byFile = {};
pages.forEach((p) => {
  const src = readFileSync(join(root, p), 'utf8');
  const re = /src="\/?([a-z0-9/-]+\.js)\?v=([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) (byFile[m[1]] = byFile[m[1]] || new Set()).add(m[2]);
});
Object.entries(byFile).forEach(([f, keys]) => {
  ok(keys.size === 1, `3a: ${f} has ONE key across all pages (${[...keys].join(', ')})`);
});

// §4 — controls, so §1 is load-bearing rather than tautological.
ok(key('lib/map.js') !== key('lib/templates.js'),
  '4a: the two files hash differently — the key really is derived from content');
const stale = createHash('sha256').update(readFileSync(join(root, 'lib/map.js')) + 'x').digest('hex').slice(0, 8);
ok(stale !== key('lib/map.js'),
  '4b: a one-byte change produces a different key, which is what makes §1b unforgettable');

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
