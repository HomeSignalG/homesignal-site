// PHASE 2 · UNIT 2 — `facilities_only` leaves the CORE coverage enum.
// Offline: CI has no database, so this pins the SQL OF RECORD
// (docs/epa-decouple-phase2-unit2-coverage-state-split.sql), the three shipped
// consumers, and the classification rule as a model.
//
// WHY THIS FILE EXISTS. `app_coverage_states.coverage_state` is one CASE ladder whose
// fifth branch reads `fac_markers` — so a ZIP whose CORE plane is genuinely empty was
// reported as `facilities_only` BECAUSE EPA had records for it. That is founder rule #1
// in the direction nobody looks at (EPA PRESENCE deciding a core state), and rule #11
// outright: remove the overlay and a value of the core enum disappears with it.
//
// Measured from the stored stamps 2026-09-07: 11,678 core-content + 766 core-empty-with-
// EPA + 278 empty-either-way = 12,722, exact; all 766 are data_quality 'pass'.
//
// ⚖️ THE NO-OP CLAIM IS THE POINT, so most of this file exists to pin it: the 766 pages
// keep the same banner, in the same words, and every consumer reads BOTH shapes so the
// code is correct before AND after the view migration is applied.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const rawSql = read('docs/epa-decouple-phase2-unit2-coverage-state-split.sql');
/** Executable SQL only: every whole-line comment removed (see the Unit 1 suite). */
const executable = (s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const sql = executable(rawSql);
const page = read('lib/community-page.js');
const data = read('lib/data.js');
const ver = read('scripts/verify-coverage-state.mjs');

const failures = [];
const ok = (name, cond) => { if (cond) console.log(`PASS — ${name}`); else { console.log(`FAIL — ${name}`); failures.push(name); } };

// ───────────────────────── the model ─────────────────────────
// PRE-split: production today. Content branches only; the freshness branches above them
// are unchanged by this unit and are already core-only (Phase 1B gave the overlay its
// own clock, `facilities_refreshed_at`).
function classifyPre({ dev_markers = 0, fac_markers = 0, changes = 0 }) {
  if (dev_markers > 0 || changes > 0) return 'populated';
  if (fac_markers > 0) return 'facilities_only';
  return 'honestly_empty';
}
// POST-split: two answers, neither derived from the other.
function classifyPost({ dev_markers = 0, fac_markers = 0, changes = 0, facilities_unavailable = false, has_report = true }) {
  const core = (dev_markers > 0 || changes > 0) ? 'populated' : 'honestly_empty';
  const overlay = !has_report ? 'overlay_unsupported'
                : fac_markers > 0 ? 'overlay_records'
                : facilities_unavailable ? 'overlay_unknown'
                : 'overlay_empty';
  return { core, overlay };
}

const GRID = [];
for (const dev of [0, 4]) for (const ch of [0, 9]) for (const fac of [0, 40]) for (const un of [false, true]) {
  GRID.push({ dev_markers: dev, changes: ch, fac_markers: fac, facilities_unavailable: un });
}

// 1 — RULE #1 AS AN INVARIANCE. For every core shape, the CORE state must be identical
// across every EPA value. This is the assertion the old ladder could not satisfy.
{
  let varied = 0;
  for (const dev of [0, 4]) for (const ch of [0, 9]) {
    const answers = new Set(GRID.filter((g) => g.dev_markers === dev && g.changes === ch)
      .map((g) => classifyPost(g).core));
    if (answers.size !== 1) varied++;
  }
  ok('1. the CORE state is invariant across the whole EPA grid (rule #1)', varied === 0);
  ok('1b. control: the PRE-split ladder DID vary with EPA',
     new Set(GRID.filter((g) => g.dev_markers === 0 && g.changes === 0).map(classifyPre)).size > 1);
}

// 2 — RULE #11. Deleting the overlay entirely must not remove a value from the core
// enum. Modelled by running every case with the overlay stripped out.
{
  const withOverlay = GRID.map((g) => classifyPost(g).core);
  const withoutOverlay = GRID.map((g) => classifyPost({ ...g, fac_markers: 0, facilities_unavailable: false, has_report: true }).core);
  ok('2. removing the overlay changes no core state (rule #11)',
     JSON.stringify(withOverlay) === JSON.stringify(withoutOverlay));
  ok('2b. control: the PRE-split ladder DID lose a value when the overlay was stripped',
     new Set(GRID.map(classifyPre)).has('facilities_only')
     && !new Set(GRID.map((g) => classifyPre({ ...g, fac_markers: 0 }))).has('facilities_only'));
}

// 3 — THE EQUIVALENCE, both directions. `facilities_only` IS core-empty + overlay-records
// and nothing else, so the split renames a composition rather than reclassifying anything.
{
  const mismatches = GRID.filter((g) => {
    const pre = classifyPre(g), post = classifyPost(g);
    return pre === 'facilities_only'
      ? !(post.core === 'honestly_empty' && post.overlay === 'overlay_records')
      : pre !== post.core;
  });
  ok('3. every pre-split verdict maps onto exactly one composed pair', mismatches.length === 0);
  ok('3b. ... and the mapping is onto: some case really is facilities_only',
     GRID.some((g) => classifyPre(g) === 'facilities_only'));
}

// 4 — THE OVERLAY NEVER CLAIMS AN EMPTINESS IT DID NOT VERIFY (Phase 1B's rule, applied
// to the state as well as to the count).
{
  ok('4. a refused EPA read with no records is overlay_unknown, not overlay_empty',
     classifyPost({ fac_markers: 0, facilities_unavailable: true }).overlay === 'overlay_unknown');
  ok('4b. a verified zero is overlay_empty',
     classifyPost({ fac_markers: 0, facilities_unavailable: false }).overlay === 'overlay_empty');
  ok('4c. preserved records still read overlay_records even while the read is refused',
     classifyPost({ fac_markers: 40, facilities_unavailable: true }).overlay === 'overlay_records');
  ok('4d. no report at all is overlay_unsupported, never overlay_empty',
     classifyPost({ has_report: false }).overlay === 'overlay_unsupported');
  ok('4e. overlay_empty is never returned over an unverified read',
     !GRID.some((g) => g.facilities_unavailable && classifyPost(g).overlay === 'overlay_empty'));
}

// 5 — LOCAL NEWS STILL CANNOT LIFT A COVERAGE STATE (the 2026-08-02 rule survives the
// split; `changes` is civic-only and news rides in news_items).
ok('5. news is still not coverage after the split',
   classifyPost({ dev_markers: 0, changes: 0, fac_markers: 0 }).core === 'honestly_empty');

// ───────────────────── structural pins on the SQL of record ─────────────────────

ok('6. SQL: the view is REPLACED, never dropped (grants and dependents survive)',
   /create or replace view public\.app_coverage_states\s*\n?\s*with \(security_invoker = true\) as/.test(sql)
   && !/drop view/i.test(sql));

// 6a — SECURITY_INVOKER IS RESTATED, AND ITS ABSENCE WOULD BE SILENT. Measured on this
// database: creating a view WITH the option and then issuing a bare `create or replace
// view` WITHOUT it leaves reloptions = (none) — the option is DROPPED, not preserved.
// The live view carries security_invoker=true and is owned by postgres, so omitting it
// converts an anon-readable view into one running with the owner's rights, bypassing RLS
// on four tables. Nothing in the SQL would have reported that.
ok('6a. SQL: the view is restated WITH (security_invoker = true)',
   /with \(security_invoker = true\) as/.test(sql));
ok('6a2. SQL: an invariant fails if the view is not security_invoker',
   /is not security_invoker — it would bypass RLS/.test(sql)
   && /'security_invoker=true' = any \(c\.reloptions\)/.test(sql));
// Scoped to the VIEW BODY, not the whole file: the invariant block deliberately NAMES
// `facilities_only` in order to forbid it, and a guard that cannot mention what it
// guards against is not a guard.
const viewBody = (() => {
  const i = sql.indexOf('create or replace view public.app_coverage_states');
  const j = sql.indexOf('comment on view');
  return i >= 0 && j > i ? sql.slice(i, j) : '';
})();
ok('6b. SQL: facilities_only appears nowhere in the view body',
   viewBody.length > 500 && !/facilities_only/.test(viewBody));
ok('6c. SQL: the core ladder reads no EPA term',
   (() => {
     const i = sql.indexOf('CASE'), j = sql.indexOf('AS coverage_state');
     const ladder = i >= 0 && j > i ? sql.slice(i, j) : '';
     return ladder.length > 100 && !/fac_markers|facilities_/.test(ladder);
   })());
ok('6d. SQL: the overlay plane is exposed with its own state and clock',
   /AS regulatory_overlay_state/.test(sql) && /overlay_records/.test(sql)
   && /overlay_unknown/.test(sql) && /overlay_unsupported/.test(sql)
   && /r\.facilities_refreshed_at/.test(sql));
ok('6e. SQL: new columns are APPENDED (create-or-replace cannot reorder)',
   sql.indexOf('AS regulatory_overlay_state') > sql.indexOf('AS news_items'));
ok('6f. SQL: the anon read grant is restated',
   /grant select on public\.app_coverage_states to anon, authenticated;/.test(sql));
// 6g — every relation the view reads is SCHEMA-QUALIFIED, so the definition cannot be
// re-pointed by whatever search_path the applying session happens to carry.
ok('6g. SQL: every source relation is schema-qualified',
   /FROM public\.app_community_meta m/.test(viewBody)
   && /LEFT JOIN public\.development_reports r/.test(viewBody)
   && /FROM public\.app_projects p/.test(viewBody)
   && /FROM public\.app_changes a/.test(viewBody)
   && !/(FROM|JOIN) (app_community_meta|development_reports|app_projects|app_changes)\b/.test(viewBody));

// 7 — the invariants must assert, not describe.
ok('7. SQL: an invariant forbids the EPA plane in the core ladder',
   /the core coverage ladder still reads the EPA plane/.test(sql));
ok('7b. SQL: an invariant forbids facilities_only surviving anywhere',
   /facilities_only survives in the view definition/.test(sql));
ok('7c. SQL: an invariant fails on a VACUOUS split',
   /the split is vacuous/.test(sql));
ok('7d. SQL: an invariant forbids overlay_empty over an unverified read',
   /report overlay_empty over an unverified EPA read/.test(sql));
ok('7e. SQL: an invariant pins core state against core content only',
   /whose core state disagrees with core content/.test(sql));
// 7f — THE LADDER ISOLATION MUST NOT DEPEND ON pg_get_viewdef's KEYWORD CASING. A slice
// anchored on a casing that changes silently returns the wrong substring, and an EPA term
// inside it then goes unseen — a guard that stops guarding without failing.
ok('7f. SQL: the ladder isolation lowercases both the haystack and the needles',
   /select lower\(pg_get_viewdef\('public\.app_coverage_states'::regclass, true\)\) into def;/.test(sql)
   && /position\('case' in def\)/.test(sql)
   && /position\('as coverage_state' in def\)/.test(sql)
   && !/position\('CASE' in def\)/.test(sql)
   && !/position\('AS coverage_state' in def\)/.test(sql));

// ───────────────────── structural pins on the shipped consumers ─────────────────────

// 8 — THE READ MUST SURVIVE BOTH SHAPES. Naming a column PostgREST does not have 400s
// the whole request, and both readers swallow that into a null — so a named column list
// would silently blank the coverage copy in the window before the migration.
ok('8. lib/data.js reads the view with select(*)',
   /from\('app_coverage_states'\)\s*\n?\s*\.select\('\*'\)/.test(data));
ok('8b. lib/data.js no longer names coverage_state in the select',
   !/\.select\('coverage_state/.test(data));
ok('8c. the verifier reads the view with select=*',
   /app_coverage_states\?select=\*/.test(ver));

// 9 — THE BANNER IS A COMPOSITION, and accepts the pre-split spelling too.
ok('9. community-page composes core-empty + overlay-records',
   /coverage_state === 'honestly_empty' && c\.regulatory_overlay_state === 'overlay_records'/.test(page));
ok('9b. ... and still accepts the pre-split facilities_only',
   /c\.coverage_state === 'facilities_only'/.test(page));
ok('9c. the banner wording is unchanged (the no-op claim)',
   /Local government meeting and permit feeds for this area are still being wired — the EPA-registered facility records below are live public data\./.test(page));
ok('9d. the honest-empty copy is gated on the overlay agreeing',
   /coverage_state === 'honestly_empty'[\s\S]{0,240}regulatory_overlay_state === 'overlay_empty'/.test(page));

// 10 — THE VERIFIER MUST BE SHAPE-AGNOSTIC AND NON-VACUOUS.
ok('10. the verifier normalizes both shapes',
   /function normalize\(r\)/.test(ver) && /coverage_state === 'facilities_only'/.test(ver));
ok('10b. the verifier validates each plane against its own vocabulary',
   /CORE_VALID/.test(ver) && /OVERLAY_VALID/.test(ver) && !/const VALID = new Set/.test(ver));
ok('10c. the verifier asserts the planes are INDEPENDENT, non-vacuously',
   /the two planes are independent \(core-empty ZIPs with overlay records exist\)/.test(ver));
ok('10d. the verifier no longer treats fac_markers as core content',
   !/honestly_empty' && \(r\.dev_markers > 0 \|\| r\.fac_markers > 0/.test(ver));
ok('10e. the legacy data_quality rules are restated on the composed pair',
   /legacy: populated => pass/.test(ver)
   && /legacy: core-empty \+ overlay records => pass/.test(ver)
   && /legacy: core-empty \+ no overlay records => coverage_coming/.test(ver));

// 13 — THE VERIFIER'S RENDERING SAMPLES MUST MATCH THE PAGE'S OWN CONDITIONS. Picking
// the honest-empty sample with the COMPLEMENT (`overlay !== 'overlay_records'`) also
// admits overlay_unknown, where the page deliberately suppresses that sentence — the
// sample would then assert copy the page is right not to show, and turn the daily job red
// on a correction. The page's condition and the sampler's must be the same set.
ok('13. the verifier samples honest-empty from the SAME set as the page',
   /const EMPTY_OVERLAYS = new Set\(\['overlay_empty', 'overlay_unsupported'\]\)/.test(ver)
   && /EMPTY_OVERLAYS\.has\(nz\(r\)\.overlay\)/.test(ver));
// Scoped to the SAMPLER block. The complement is still correct — and still used — in the
// LEGACY data_quality assertion above it, where "no overlay records" genuinely covers
// overlay_empty AND overlay_unknown because both are coverage_coming. Forbidding the
// shape file-wide would have broken a rule that is right.
const sampler = (() => {
  const i = ver.indexOf('const pickRow = (pred)');
  const j = ver.indexOf('].filter(Boolean);', i);
  return i >= 0 && j > i ? ver.slice(i, j) : '';
})();
ok('13b. ... and never by the complement of overlay_records, in the sampler',
   sampler.length > 400 && !/overlay !== 'overlay_records'/.test(sampler.replace(/^\s*\/\/.*$/gm, '')));
ok('13c. the overlay_unknown sample is gated on SPLIT_LIVE',
   /const rUnknown = SPLIT_LIVE/.test(ver));
ok('13d. ... and says WHY it skipped rather than passing in silence',
   /overlay_unknown sample SKIPPED: the view is PRE-SPLIT/.test(ver)
   && /overlay_unknown sample SKIPPED: the view is SPLIT but no ZIP/.test(ver));
ok('13e. ... and asserts BOTH halves: the claim is gone AND true copy replaced it',
   /unverified EPA read does not claim a checked registry/.test(ver)
   && /!\/checked every supported public source\/i\.test\(got\.txt\)/.test(ver)
   && /falls through to the being-wired copy/.test(ver)
   && /\/Coverage for this ZIP is being wired\/i\.test\(got\.txt\)/.test(ver));

// 14 — THE VERIFY BLOCK IS KEYED, NOT A UNIVERSE SCAN, AND THE VIEW BODY DID NOT MOVE.
//
// WHY THIS EXISTS. The first verify block ran FIVE unfiltered aggregates over the view.
// Measured on production: the plan is correct (index scans on both laterals) but costs
// ~9.3M — 12,722 ZIPs x ~622 app_projects rows, ~7.9M index+heap reads PER PASS against a
// 3.21M-row table. ONE pass exceeded 60s warm, and the slice `zip < '15000'` alone exceeded
// 50s, so the migration could never finish and was never once executed. A migration whose
// verification cannot run is not verified. The semantic checks are now asserted on named
// ZIPs; the universe counts are a reporting question, measured after commit.
{
  // 14a — the view body, security_invoker, and the comment are IMMUTABLE by this edit.
  // Hash rather than regex: the requirement is byte-identity, so only a hash can state it.
  const viewRegion = (() => {
    const i = rawSql.indexOf('create or replace view public.app_coverage_states');
    const k = rawSql.indexOf("neither may be derived from the other.';");
    return i >= 0 && k > i ? rawSql.slice(i, k + "neither may be derived from the other.';".length) : '';
  })();
  ok('14. SQL: the view body + security_invoker + comment are byte-identical',
     createHash('md5').update(viewRegion).digest('hex') === 'fcc041a896e4abf8aa77963e0de5698c');

  // The verify block only — every pin below is scoped to it, never to the whole file.
  const verifyBlock = (() => {
    const i = sql.indexOf('do $verify$');
    const k = sql.indexOf('$verify$;');
    return i >= 0 && k > i ? sql.slice(i, k) : '';
  })();
  ok('14b. SQL: the verify block is present and non-trivial', verifyBlock.length > 800);

  // 14c — the keyed probes, and the vacuous-split text preserved EXACTLY.
  ok('14c. SQL: the split is asserted on named ZIPs',
     /where zip = '03224'/.test(verifyBlock)
     && ["'01001'", "'01002'", "'03224'", "'03268'", "'01034'", "'02543'"]
          .every((z) => verifyBlock.includes(z)));
  ok('14d. SQL: the vacuous-split raise keeps its exact text',
     verifyBlock.includes('the split is vacuous'));

  // 14e — THE POINT OF THE EDIT: no unfiltered aggregate over the view survives. The old
  // shape is named explicitly, and the general shape is forbidden too, so restoring any
  // universe scan fails rather than only the one line that was removed.
  const executableVerify = verifyBlock
    .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  ok('14e. SQL: the old universe count is gone',
     !/select\s+count\(\*\)\s+into\s+n_rows\s+from\s+public\.app_coverage_states/i.test(executableVerify));
  ok('14f. SQL: NO aggregate reads the view without a zip predicate',
     (() => {
       const re = /from\s+public\.app_coverage_states([\s\S]{0,400}?);/gi;
       for (const m of executableVerify.matchAll(re)) {
         const tail = m[1];
         if (!/\bzip\s*=/.test(tail) && !/\bv?\.?zip\b/.test(tail)) return false;
       }
       return true;
     })());
  ok('14g. SQL: the semantic checks (d)(e)(f)(g) all survive, on the probe set',
     /invalid state on one of the planes/.test(verifyBlock)
     && /disagrees with core content/.test(verifyBlock)
     && /overlay_empty over an unverified EPA read/.test(verifyBlock)
     && /is not security_invoker/.test(verifyBlock));
}

// 11 — SCOPE. This unit is the view and its readers. Units 1, 3, 4 and Phase 1 are not.
ok('11. SCOPE: the parked SQL does not touch data_quality or the materializer',
   !/data_quality\s*=/.test(sql) && !/app_refresh_zip|create or replace function/.test(sql));
ok('11b. SCOPE: no cron job and no Phase 1 write path is touched',
   !/cron\.(alter_job|schedule|unschedule)/.test(sql) && !/dev_refresh_collect|dev_epa_write_refused/.test(sql));
ok('11c. SCOPE: Unit 1 markers do not ride along',
   !/core_project_scan_status|core_records_present|indexable/.test(sql));
ok('11d. SCOPE: no table is altered — this unit is a view and its readers',
   !/alter table/i.test(sql));

// 12 — THE HONEST-EMPTY COPY MAY ONLY CLAIM AN ABSENCE IT VERIFIED. Mirrors the shipped
// condition in lib/community-page.js. Measured 2026-09-07: of the 278 ZIPs empty on both
// planes, 226 carry facilities_unavailable — the EPA read was REFUSED, so the page was
// claiming "we checked … the EPA facility registry … and found no qualifying records"
// over an unknown, not a zero. The split is what makes that expressible.
{
  const showsHonestEmptyCopy = (c) => c.coverage_state === 'honestly_empty'
    && (c.regulatory_overlay_state === undefined
        || c.regulatory_overlay_state === 'overlay_empty'
        || c.regulatory_overlay_state === 'overlay_unsupported');
  ok('12. the honest-empty copy renders over a VERIFIED empty overlay',
     showsHonestEmptyCopy({ coverage_state: 'honestly_empty', regulatory_overlay_state: 'overlay_empty' }));
  ok('12b. ... and NOT over an unverified EPA read (the 226)',
     !showsHonestEmptyCopy({ coverage_state: 'honestly_empty', regulatory_overlay_state: 'overlay_unknown' }));
  ok('12c. ... and not where the overlay holds records',
     !showsHonestEmptyCopy({ coverage_state: 'honestly_empty', regulatory_overlay_state: 'overlay_records' }));
  ok('12d. ... and pre-split rows still render it (backward compatible)',
     showsHonestEmptyCopy({ coverage_state: 'honestly_empty' }));
  ok('12e. ... and it never renders on a populated page',
     !showsHonestEmptyCopy({ coverage_state: 'populated', regulatory_overlay_state: 'overlay_empty' }));
}

console.log(`\n${failures.length ? `FAILED: ${failures.length}` : 'ALL PASS'} — EPA phase 2 unit 2 coverage-state split`);
if (failures.length) process.exit(1);
