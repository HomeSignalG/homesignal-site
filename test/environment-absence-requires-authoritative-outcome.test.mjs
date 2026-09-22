// ENVIRONMENT & UTILITIES: NO AUTHORITATIVE ENVIRONMENT OUTCOME, NO ENVIRONMENT CLAIM.
//
// THE DEFECT THIS FILE EXISTS TO PREVENT. lib/community-page.js drew an "Environment &
// utilities" group from `changes.filter(... /environment|utilit|water/i.test(x.category))`
// and, when that filter was empty, told the resident the ZIP had no environment or utility
// notices on file. Measured 2026-09-22 (read-only db-sql run on a scratch branch):
//
//   app_changes.category   Government & civic 97,593 · Local News 62,171 ·
//                          Planning & zoning 16,748   (sum = the 176,512-row total)
//   rows matching the old pattern: 0 · ZIPs: 0
//
// No producer has ever written an Environment category — the label exists in git only in
// the Phase-1 prototype seed (seed/delvalle.js, 2026-07-12) — and app_coverage_states has
// no Environment state (its columns cover the Development plane and the EPA overlay). So
// the page converted "no data contract" into "verified absence" on every ZIP it rendered.
// Same class as #1307 (Development): absence is a positive fact and needs a complete
// authoritative read behind it. Today no Environment reader or outcome exists at all, so
// the only truthful rendering is NO Environment section — no count, no absence sentence,
// no invented "not measured"/"unavailable" line, no empty heading.
//
// ⚠️ THIS IS NOT "ENVIRONMENT IS UNSUPPORTED FOREVER". The section returns when a real
// Environment outcome (subject membership + coverage, the separate architecture unit) is
// wired into the page. That work SHOULD rewrite §1 of this file to key on the outcome. What
// it may never do is bring the section back through the shapes §2-§3 forbid: a category
// pattern over app_changes, a keyword/title match, or a manual switch / ZIP list.
//
// The behavioural proof — a real generated document hydrated with every neighbouring plane
// populated — is test/environment-absence.browser.test.mjs. This file is the half that runs
// in the REQUIRED offline gate, so a one-line revert fails there too.
//
// Every check reads EXECUTABLE source: whole-line comments are stripped first, because the
// fix comment in lib/community-page.js quotes the very shapes this file forbids.
//
// Run: node test/environment-absence-requires-authoritative-outcome.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
  + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 220) : '')); if (!c) fails++; };
/** Executable source only: every whole-line // or # comment removed. */
const exec = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|#)/.test(l)).join('\n');
const read = (p) => readFileSync(join(root, p), 'utf8');

const pageRaw = read('lib/community-page.js');
const page = exec(pageRaw);
const hosts = { 'community.html': exec(read('community.html')), 'scripts/gen_zip_pages.py': exec(read('scripts/gen_zip_pages.py')) };

// ── positive controls: the file under test is the file that renders the sections ────────
ok(/Government &amp; civic/.test(page) && /Local news/.test(page) && /\+ facHtml/.test(page)
   && /Development &amp; growth/.test(page),
  'control — lib/community-page.js is the shared runtime that composes the neighbouring sections');
ok(/No permit or planning records on file for this ZIP yet/.test(page),
  'control — the stripper keeps executable strings (the #1307 absence sentence is still found)');
ok(/environment or utility notices/.test(pageRaw) && !/environment or utility notices/.test(page),
  'control — the stripper removes comments (the fix comment names the retired sentence; exec source does not)');

// ── §1 no Environment claim of any kind is reachable from the shared runtime ─────────────
ok(!/no environment or utility/i.test(page), '§1 B — the false absence sentence is not in the executable runtime');
for (const [f, src] of Object.entries(hosts))
  ok(!/no environment or utility/i.test(src), '§1 B — ...nor in the host ' + f);
ok(!/environment\s*(?:&amp;|&|and)\s*utilit/i.test(page),
  '§1 A/C — no Environment & utilities heading, group or count is composed');
ok(!/\benvChanges\b/.test(page), '§1 A — the old Environment row set (and its length-derived count) is gone');

// ── §2 no classifier: nothing decides Environment membership from text or category ──────
{
  // Any regex literal that is APPLIED (.test/.exec, or passed to .match/.search/.replace)
  // and whose body names an Environment-ish word. Keyed on application, not on slashes:
  // the runtime is full of HTML strings ('</span> … environmental context</s…'), and a
  // bare slash-pair scan flagged that display copy — an over-flagging pin gets waved
  // through, so the net is the shape a classifier actually takes.
  const W = '(?:environment|utilit|water|sewer|wastewater|substation|transmission)';
  const BODY = '(?:[^\\/\\n\\\\]|\\\\.)*';
  const applied = new RegExp('\\/' + BODY + W + BODY + '\\/[gimsuy]*\\s*\\.(?:test|exec)\\s*\\(', 'gi');
  const passed = new RegExp('\\.(?:match|search|replace|split)\\(\\s*\\/' + BODY + W + BODY + '\\/', 'gi');
  const lits = (page.match(applied) || []).concat(page.match(passed) || []);
  ok(lits.length === 0, '§2 F — no applied regex over environment/utility/water/sewer/… anywhere in the runtime', lits);
  // Self-test of the net itself, so a green §2 cannot be a pattern that matches nothing:
  // it must catch the exact retired classifier and must NOT catch the display copy it tripped on.
  ok(applied.test("changes.filter(function(x){return /environment|utilit|water/i.test(x.category);});"),
    '§2 control — the net catches the retired Environment classifier verbatim');
  applied.lastIndex = 0;
  ok(!applied.test("' + facTotal + ' on record · environmental context</span></div>'"),
    '§2 control — the net does not flag display copy that merely contains the word');
  applied.lastIndex = 0;
  ok(!/category[^;\n]{0,80}(?:environment|utilit|water)/i.test(page)
     && !/(?:environment|utilit|water)[^;\n]{0,80}\.category\b/i.test(page),
    '§2 F — no category comparison routes a record by an Environment-ish value');
}

// ── §3 no manual activation: no switch, flag or ZIP/state list gates an Environment section
{
  const flag = page.match(/\b[A-Za-z_]*(?:env(?:ironment)?)[A-Za-z_]*(?:enabled|disabled|flag|zips|states|allow|deny|list|cohort)\b/gi) || [];
  ok(flag.length === 0, '§3 G — no Environment enable flag / allow-list / deny-list identifier in the runtime', flag);
  const cfg = exec(read('config.js'));
  ok(!/environment/i.test(cfg), '§3 G — config.js carries no Environment switch');
  // A 5-digit-ZIP array literal is how a per-ZIP cohort would be smuggled in.
  const zipLists = page.match(/\[\s*['"]\d{5}['"](?:\s*,\s*['"]\d{5}['"])+\s*\]/g) || [];
  ok(zipLists.length === 0, '§3 G — no hard-coded ZIP list in the shared runtime', zipLists);
}

// ── §4 neighbours are composed exactly as before (D) ─────────────────────────────────────
ok(/var notices = changes\.filter\(function\(x\)\{\s*return \/planning\|government\|civic\/i\.test\(x\.category\)/.test(page),
  '§4 D — Government & civic notices are still selected by their own rule, unchanged');
ok(/HS\.data\.facilities\(zip, home\)/.test(page) && /Regulated facilities nearby/.test(page),
  '§4 D — Regulated facilities still reads its own plane and renders its own section');
ok(/HS\.data\.news\(zip, home\)/.test(page) && /LOCAL_NEWS_CAP/.test(page), '§4 D — Local News is still read and rendered');
ok(/HS\.data\.meetings\(zip, home\)/.test(page) && /mtgWord/.test(page), '§4 D — Meetings still render from meetings()');
ok(/devReadComplete\s*\?/.test(page), '§4 D — Development keeps its #1307 complete-read absence gate');
// E — one shared runtime: both hosts load it, and neither carries its own section markup.
ok(/community-page\.js\?v=[a-f0-9]{8}/.test(hosts['community.html'])
   && /community-page\.js\?v=[a-f0-9]{8}/.test(hosts['scripts/gen_zip_pages.py']),
  '§4 E — community.html and every generated /community/<zip>/ document load the one shared runtime');

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
process.exit(fails ? 1 : 0);
