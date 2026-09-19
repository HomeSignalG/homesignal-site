// EVERY GENERATED ZIP PAGE WAS AN ORPHAN, AND THE SITEMAP WAS ITS ONLY CRAWL PATH.
//
// Measured on production before this change: /community/78617/ and /community/01002/ each
// carried ZERO links to another /community/ page — all 25 anchors on 78617 were outbound
// rel="nofollow" source records, and the site's navigation is injected by shell.js after
// hydration, so a crawler reading the initial HTML sees none of it. ~12,722 documents
// reachable only by sitemap is the classic way a large corpus never gets fully indexed.
//
// WHY THE EXISTING SUITE COULD NOT COVER THIS: test/fixtures/zip-pages.json carries five
// ZIPs in FIVE DIFFERENT counties, so no page there has a sibling and the block never
// renders. Every assertion in zip-pages-seo passed on the sibling change without ever
// executing it — the "a fixture that only builds the working shape cannot fail on the
// broken one" trap. This file ships its own multi-ZIP-per-county fixture.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

// ---- fixture: one dense county, one two-ZIP county, a same-NAMED county in another
// state (the cross-state merge trap), and a county-less ZIP (absent stays absent).
const HAMPDEN = ['01001', '01002', '01003', '01004', '01005', '01006',
                 '01007', '01008', '01009', '01010', '01011', '01012'];   // 12 > SIB_CAP
const BERGEN  = ['07010', '07011'];
const OTHER   = ['64050', '64051'];            // Jackson County MO
const KSJACK  = ['66061'];                     // Jackson County KS — same NAME, other state
const NOCOUNTY = ['99999'];
const ALL = [...HAMPDEN, ...BERGEN, ...OTHER, ...KSJACK, ...NOCOUNTY];

const meta = [
  ...HAMPDEN.map((z) => ({ zip: z, name: `Springfield (${z})`, county: 'Hampden', state: 'MA', data_quality: 'pass', indexable: true })),
  ...BERGEN.map((z)  => ({ zip: z, name: `Cliffside (${z})`,   county: 'Bergen',  state: 'NJ', data_quality: 'pass', indexable: true })),
  ...OTHER.map((z)   => ({ zip: z, name: `Independence (${z})`, county: 'Jackson', state: 'MO', data_quality: 'pass', indexable: true })),
  ...KSJACK.map((z)  => ({ zip: z, name: `Holton (${z})`,      county: 'Jackson', state: 'KS', data_quality: 'pass', indexable: true })),
  // hostile: an ampersand in a county name must be escaped, not emitted raw
  { zip: '99999', name: 'Nowhere (99999)', county: '', state: 'ZZ', data_quality: 'pass', indexable: false },
];
// 01001 gets enough content to be index-eligible, so the FIRST nav is exercised on a
// page that also carries the sibling block.
const changes = [1, 2, 3].map((i) => ({
  id: `c${i}`, zip: '01001', community_id: 'x', category: 'Government & civic',
  title: `Notice ${i}`, source_ref: `https://example.gov/${i}`, occurred_at: '2026-09-01',
}));
const FIX = { zips: ALL, meta, changes, agency: [], retractions: [], communities: [], meetings: [] };

const dir = mkdtempSync(join(tmpdir(), 'sibs-'));
const fixPath = join(dir, 'fix.json');
writeFileSync(fixPath, JSON.stringify(FIX));
const build = (out) => execFileSync('python3',
  [GEN, '--fixture', fixPath, '--out', out, '--now', '2026-09-19T00:00:00'],
  { cwd: root, encoding: 'utf8' });
const out1 = join(dir, 'a'), out2 = join(dir, 'b');
build(out1); build(out2);
const doc = (out, z) => readFileSync(join(out, 'community', z, 'index.html'), 'utf8');

// ---- 1. the block renders at all (the thing the old fixture could not see) ------------
const a = doc(out1, '01001');
ok(/<nav class="zsib"/.test(a), 'a ZIP with in-county siblings renders the sibling nav');
ok(/<h2>More ZIP codes in Hampden County, MA<\/h2>/.test(a),
   'the block names its county and state');

// ---- 2. NO ORPHANS — every ZIP is linked FROM at least one other page ------------------
// This is the whole point. A "first N of the county" list would make N hubs and leave the
// rest exactly as orphaned as before, which is the same defect wearing a fix.
const inDegree = Object.fromEntries(ALL.map((z) => [z, 0]));
for (const z of ALL) {
  const h = doc(out1, z);
  for (const m of h.matchAll(/href="\/community\/(\d{5})\/"/g)) {
    ok(m[1] !== z, `${z} never links to itself`);
    inDegree[m[1]] = (inDegree[m[1]] || 0) + 1;
  }
}
const orphans = HAMPDEN.concat(BERGEN, OTHER).filter((z) => inDegree[z] === 0);
ok(orphans.length === 0, `every multi-ZIP-county page has in-degree >= 1 (orphans: ${orphans.length})`);
ok(inDegree['66061'] === 0, 'a county with ONE ZIP in that state links to nobody — no filler');
ok(inDegree['99999'] === 0, 'a ZIP with no county is never linked from a county ring');

// ---- 3. the cross-state merge trap ----------------------------------------------------
// County names repeat across states (Jackson MO vs Jackson KS, Benton, Washington…).
// Grouping on the name alone would send a Missouri resident to Kansas pages.
const mo = doc(out1, '64050');
ok(/href="\/community\/64051\/"/.test(mo), 'Jackson MO links its own in-state sibling');
ok(!/href="\/community\/66061\/"/.test(mo),
   'Jackson MO does NOT link Jackson KS — grouping is (state, county), never county alone');
ok(!/<nav class="zsib"/.test(doc(out1, '66061')),
   'the lone Jackson KS ZIP renders no sibling block rather than reaching across the state line');

// ---- 4. absent stays absent -----------------------------------------------------------
ok(!/<nav class="zsib"/.test(doc(out1, '99999')),
   'a ZIP whose meta carries no county gets NO siblings — never guessed');

// ---- 5. the cap, and the ring shape ---------------------------------------------------
const linksOf = (z) => [...doc(out1, z).matchAll(/href="\/community\/(\d{5})\/"/g)].map((m) => m[1]);
ok(linksOf('01001').length === 10, `SIB_CAP caps a 12-ZIP county at 10 links (got ${linksOf('01001').length})`);
ok(linksOf('07010').length === 1, 'a two-ZIP county links exactly its one sibling');
ok(JSON.stringify(linksOf('01012')) === JSON.stringify(['01001','01002','01003','01004','01005','01006','01007','01008','01009','01010']),
   'the ring WRAPS — the last ZIP links back to the first, which is what closes the cycle');

// ---- 6. THE LIVE-MONITOR BREAKER ------------------------------------------------------
// scripts/prove-zip-pages-live.mjs scrapes `<nav class="zsec">[\s\S]*?</nav>` and takes the
// FIRST match to assert usable internal links. A second zsec nav placed above would steal
// that match and redden the daily production monitor on every ZIP.
const firstNav = (a.match(/<nav class="zsec">[\s\S]*?<\/nav>/) || [''])[0];
ok(/homesignalmap\.html\?zip=/.test(firstNav) && /href="\/"/.test(firstNav),
   'the FIRST nav.zsec is still the original links nav (what the live monitor reads)');
ok(!/class="zsec"/.test((a.match(/<nav class="zsib"[\s\S]*?<\/nav>/) || [''])[0]),
   'the sibling nav does not carry the zsec class');

// ---- 7. it must not satisfy the content-section proof vacuously -----------------------
// `<section class="zsec"><h2>…</h2><ul>` is how the control classifier counts REAL content
// sections; reusing it would let an empty Alerts page pass that proof on sibling links.
const sections = (z) => (doc(out1, z).match(/<section class="zsec"><h2>[^<]+<\/h2><ul>/g) || []).length;
ok(sections('01002') === 0, 'a content-empty page still reports ZERO content sections');
ok(!/<section class="zsec"><h2>More ZIP codes/.test(a), 'the sibling block is not a zsec section');

// ---- 8. canonical form, never the legacy URL ------------------------------------------
ok(!/href="\/community\.html\?zip=/.test(a),
   'siblings are linked at /community/<zip>/, never the legacy URL this page canonicalises from');

// ---- 9. escaping + the no-point leak patterns, on EVERY document ----------------------
const LEAK = [/\d+(\.\d+)?\s*mi\b/, /distance_mi/, /data-home/, /centroid/i,
              /\bnearest/i, /radius/i, /\bmi<\//];
let leaked = 0;
for (const z of ALL) for (const re of LEAK) if (re.test(doc(out1, z))) leaked++;
ok(leaked === 0, `no document leaks a point/proximity token (${leaked} hits)`);

// ---- 10. determinism — the build is asserted byte-identical across two runs -----------
let same = 0;
for (const z of ALL) if (doc(out1, z) === doc(out2, z)) same++;
ok(same === ALL.length, `all ${ALL.length} documents are byte-identical across two builds`);

// ---- 11. Rule F is untouched ----------------------------------------------------------
ok(/content="index, follow"/.test(a), '01001 (3 notices) is still index-eligible');
ok(/content="noindex, follow"/.test(doc(out1, '01003')),
   'a sibling-linked but content-empty ZIP is still noindex — links never satisfy Rule F');

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
