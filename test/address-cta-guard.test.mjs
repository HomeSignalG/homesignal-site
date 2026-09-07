// THE addressCta GUARD, PROVEN IN BOTH DIRECTIONS AND PINNED AGAINST DRIFT — offline.
//
// This assertion has now been reddened by a copy edit three times (#1079 removed the literal it
// was pinned to, #1083 replaced it with a longer literal list, #1086 fell outside that list two
// hours later), and each fix was proven ad hoc in a commit message with no committed test. That
// is why it kept breaking: a guard whose correctness lives in prose is re-derived by every
// session that touches it, and re-derived wrongly.
//
// What the guard GUARANTEES: a ZIP page whose development is not measured still directs the
// resident to the address control, so the honest "we have not measured this" is never a dead
// end. What it must NOT do is pass on a page whose CTA has been deleted — which a bare
// /address/i would, because unrelated sentences mention the word.
//
// Two live copies exist by design (the production verifier and user-journey 14c) so the
// contract is checked against both live production and a fixtured browser. #1088 asked that
// they not drift and nothing enforced it; §3 does.
//
// Run: node test/address-cta-guard.test.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

// The pattern is READ OUT OF THE SHIPPED FILES rather than retyped here. A copy typed into the
// test would prove only that the test agrees with itself — the exact failure this file exists
// to end.
const VERIFIER = join(root, 'scripts/verify-map1-zip-states.mjs');
const JOURNEY  = join(root, 'test/user-journey.browser.test.mjs');
const RE_SRC = /\/\\b\([a-z|]+\)\\b\[\^\.\\n\]\{0,24\}\\baddress\\b\/i/;

const vSrc = await readFile(VERIFIER, 'utf8');
const jSrc = await readFile(JOURNEY, 'utf8');
const vPat = (vSrc.match(RE_SRC) || [])[0];
const jPat = (jSrc.match(RE_SRC) || [])[0];

ok(!!vPat, '1a the verifier still carries a recognisable addressCta pattern', vPat);
ok(!!jPat, '1b user-journey 14c still carries one too', jPat);
if (!vPat || !jPat) { console.log('\n' + fails + ' FAILED'); process.exit(1); }

// eslint-disable-next-line no-eval
const RE = eval(vPat);

// ── 1. MUST MATCH — every wording this page has actually shipped, plus the current one ───────
// Each string is REAL: taken from a shipped page, a shipped note, or this repo's own history.
const MUST_MATCH = {
  'the CURRENT helper text (#1090)': 'Choose an address from the suggestions, press Enter, or click search.',
  'the shipped not-measured note': 'Development coverage for ZIP 08005 is not measured yet — we will not estimate it from a circle around the ZIP centre. Enter an address for the live view around your home.',
  "#1086's ZIP-mode hint": 'Enter a street address to switch from ZIP-wide results to development nearby.',
  "#1079's ZIP-mode hint": 'Enter an address to see development nearby.',
  'the loadZip failure banner': "Couldn't load ZIP 08005. Enter your address for the live view.",
  'the inline validation message (#1090)': 'Enter or select a valid address to search nearby development.',
  'a plausible future rewording': 'Type an address to see what is planned near your home.',
};
for (const [name, s] of Object.entries(MUST_MATCH)) {
  ok(RE.test(s), '2 matches: ' + name, s);
}

// ── 2. MUST NOT MATCH — the negatives are what make the guard mean anything ──────────────────
// Without these the pattern could be relaxed to /address/i and would then pass on a page whose
// CTA had been deleted, which is the failure it exists to catch.
const MUST_NOT_MATCH = {
  'the ZIP clarifier (mentions "address", is not a CTA)': 'The entire ZIP area — not only projects near one address.',
  'the static Box Elder hint': "Box Elder County addresses only, for now. Free while we're in launch.",
  'the note with its CTA sentence DELETED': 'Development coverage for ZIP 08005 is not measured yet — we will not estimate it from a circle around the ZIP centre.',
  'a verb and a noun in DIFFERENT sentences': 'Enter what you like. This page shows one address.',
  'a verb too far from the noun to be one direction': 'Enter it here, then wait for the map to finish drawing before the address',
  'unrelated page text': 'Development around your home — every item linked to its official public record.',
  'the field label alone': 'Address',
};
for (const [name, s] of Object.entries(MUST_NOT_MATCH)) {
  ok(!RE.test(s), '3 does NOT match: ' + name, s);
}

// ── 3. THE TWO COPIES MAY NOT DRIFT ──────────────────────────────────────────────────────────
// #1088: "user-journey 14c carries the same pattern so the two cannot drift." That was an
// instruction, not a control — one of them could be widened alone and the live check and the
// fixtured check would then be asserting different contracts, with the weaker one green.
ok(vPat === jPat,
   '4 the production verifier and user-journey 14c carry the IDENTICAL pattern',
   { verifier: vPat, journey: jPat });

// ── 4. THE GUARD IS STILL LOAD-BEARING ───────────────────────────────────────────────────────
// A guard that cannot fail is decoration. This proves the discrimination is real rather than
// asserting that it is: the deleted-CTA note and the shipped note differ ONLY by the CTA
// sentence, and the guard must separate them.
const withCta = MUST_MATCH['the shipped not-measured note'];
const withoutCta = MUST_NOT_MATCH['the note with its CTA sentence DELETED'];
ok(withCta.startsWith(withoutCta.slice(0, 60)),
   '5a the two note strings really are the same note (control)');
ok(RE.test(withCta) && !RE.test(withoutCta),
   '5b deleting only the CTA sentence flips the guard — it is load-bearing');

console.log('='.repeat(72));
console.log(fails ? (fails + ' FAILED') : 'ALL PASS');
process.exit(fails ? 1 : 0);
