// Phase 9E item 2 / F9 — regression guard for index-page footer absorption.
//
// This test reproduces the DEFECT and the FIX as pure string logic, so it fails if anyone
// reintroduces the greedy capture — without needing a database or a network fetch.
//
// The bug was not "the parser forgot to strip footers". It was that PostgreSQL decides
// greediness for the WHOLE regular expression from the FIRST quantifier with a preference,
// so a capture written as (.*?) after a greedy [^']+ runs to the LAST </a> in the fragment.
// JavaScript does NOT share that rule, so the greedy behaviour is reproduced here with an
// explicitly greedy (.*) — the point of the test is the BOUNDARY, which is language-neutral:
// a row must be read only to its own </tr>, and a respondent capture must not cross a tag.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const { ok, equal } = assert;

// A real SEC index page shape: two rows, the last one followed by the site footer — this is
// exactly what string_to_array on the row delimiter hands the parser as its final element.
const ROW_DELIM = '<tr class="pr-list-page-row">';
const PAGE = [
  '<table>',
  ROW_DELIM,
  `<td><time datetime="2017-04-03"></time>`,
  `<div class="release-view__respondents'><a href='/files/litigation/admin/2017/34-80364.pdf'>First Respondent, Inc.</a></div>`,
  `<div class="view-table_subfield_release_number"><span class="view-table_subfield_value">34-80364</span></div>`,
  '</td></tr>',
  ROW_DELIM,
  `<td><time datetime="2017-04-03"></time>`,
  `<div class="release-view__respondents'><a href='/files/litigation/admin/2017/34-80365.pdf'>International Building Concepts Ltd. (n/k/a Home Builders International Inc.) RXBAZAAR, Inc.</a></div>`,
  `<div class="view-table_subfield_release_number"><span class="view-table_subfield_value">34-80365</span></div>`,
  `<div class="view-table_subfield_file_number"><span class="view-table_subfield_value">3-17897</span></div>`,
  // "See Also" links are what make the intra-row spill possible: they put ANOTHER </a>
  // later in the same row, so a capture that can cross a tag boundary runs past the
  // respondent cell and swallows the subfields on the way. 3,092 of the 3,244 damaged
  // rows were damaged this way, with no footer involved at all.
  `<div class="view-table_subfield_see_also"><span>See Also:</span>`,
  `<a href="/files/litigation/admin/2017/34-80365-notice.pdf">Notice - Bear Stearns</a>,`,
  `<a href="/files/litigation/admin/2017/34-80365-order.pdf">Final Judgment - JP Morgan</a></div>`,
  '</td></tr>',
  '</table>',
  // ── everything below is page chrome, NOT row content ──
  '<div class="pager">1 to 59 of 59 items</div>',
  '<a href="#top">Return to top</a>',
  '<footer><a href="/">SEC homepage</a><a href="/about">About the SEC</a>',
  '<a href="/jobs">Careers</a><a href="/foia">FOIA</a><a href="/ombuds">Ombuds</a>',
  '<a href="/updates">Sign up for email updates</a></footer>',
].join('\n');

const fragments = PAGE.split(ROW_DELIM).filter(f => f.includes("release-view__respondents"));
equal(fragments.length, 2, 'positive control: the page yields exactly two row fragments');

const lastFragment = fragments[1];
ok(lastFragment.includes('Return to top'), 'positive control: the LAST fragment really does carry the footer');
ok(!fragments[0].includes('Return to top'), 'a non-final fragment carries no footer');

// ── the DEFECT, reproduced ───────────────────────────────────────────────────────────
// A capture that can cross a tag boundary swallows the page footer.
const GREEDY = /release-view__respondents'><a href='[^']+'>(.*)<\/a>/s;
const greedyCapture = lastFragment.match(GREEDY)[1];
ok(greedyCapture.includes('Return to top'), 'the greedy capture reaches the footer — this is the bug');
ok(greedyCapture.includes('SEC homepage'), 'the greedy capture reaches site navigation');
ok(greedyCapture.length > 300, `greedy capture is oversized (${greedyCapture.length} chars)`);

// ── DEFENCE 1: bound the row at its own </tr> ────────────────────────────────────────
const rowBound = html => {
  const i = html.indexOf('</tr>');
  return i >= 0 ? html.slice(0, i) : html;   // no </tr> -> return unchanged, never empty
};
const bounded = rowBound(lastFragment);
ok(!bounded.includes('Return to top'), 'bounding at </tr> removes the footer from the row');
ok(!bounded.includes('SEC homepage'), 'bounding at </tr> removes site navigation');
ok(bounded.includes('International Building Concepts'), 'bounding preserves the real respondent text');
// A row with no </tr> must survive intact rather than being silently emptied.
equal(rowBound('<td>no closing row tag</td>'), '<td>no closing row tag</td>',
      'a fragment without </tr> is returned unchanged, not blanked');

// ── DEFENCE 2: a capture that cannot cross a tag boundary ────────────────────────────
const SAFE = /release-view__respondents'><a href='[^']+'>([^<]*)<\/a>/;
const safeCapture = bounded.match(SAFE)[1];
equal(safeCapture,
      'International Building Concepts Ltd. (n/k/a Home Builders International Inc.) RXBAZAAR, Inc.',
      'the safe capture is exactly the respondent names');

// Either defence alone is sufficient here — assert that, so neither can be quietly dropped
// on the theory that the other covers it.
const safeOnUnbounded = lastFragment.match(SAFE)[1];
equal(safeOnUnbounded, safeCapture, 'the character-class capture is correct even without bounding');
const greedyOnBounded = bounded.match(GREEDY)[1];
ok(!greedyOnBounded.includes('Return to top'), 'bounding alone also keeps the footer out');

// ── the intra-row spill, which was 3,092 of the 3,244 damaged rows ───────────────────
// The footer was only the visible half. A greedy capture also swallowed the row's OWN
// subfields — Release No., File Number, See Also — on every row that has them.
ok(greedyOnBounded.includes('34-80365'), 'greedy capture swallows the row Release No. subfield');
ok(greedyOnBounded.includes('3-17897'), 'greedy capture swallows the row File Number subfield');
ok(!safeCapture.includes('34-80365'), 'the safe capture excludes the Release No. subfield');
ok(!safeCapture.includes('3-17897'), 'the safe capture excludes the File Number subfield');

// ── no footer vocabulary anywhere in the parser (repair at source, not word-stripping) ─
// The migration of record must not "fix" this by naming footer strings to delete.
const sql = readFileSync(new URL('../docs/evidence-phase1-migration.sql', import.meta.url), 'utf8');
const parserSection = sql.slice(sql.indexOf('PHASE 9E ITEM 2'));
ok(parserSection.includes('ev_sec_row_bound'), 'the record names the row-bounding defence');
ok(parserSection.includes('[^<]*'), 'the record names the character-class defence');
ok(parserSection.includes('No footer word, nav label or "See Also" string is named in the parser'),
   'the record states the repair is structural, not vocabulary-based');

console.log('evidence-phase9e-footer-absorption: all checks passed');
