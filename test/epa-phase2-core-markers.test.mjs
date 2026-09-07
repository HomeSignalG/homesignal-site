// PHASE 2 · UNIT 1 — the CORE completion markers must not read the EPA/regulatory plane.
// Offline: CI has no database, so this pins the SQL OF RECORD
// (docs/epa-decouple-phase2-unit1-core-completion-markers.sql) and re-implements the
// marker semantics as a model exercised over every case the founder's rules name.
//
// WHY THIS FILE EXISTS. Phase 1 cut the two RUNTIME control paths (EPA could pause the
// national core refresh; refusing the regulatory write refused the core write). A third
// path is SEMANTIC and survived: `app_refresh_zip` decided indexability with
// `(_ndp > 0 or _nfc >= 3)`, so EPA facility count alone advertised a ZIP as a
// DEVELOPMENT page. Measured from the stored stamps 2026-09-07: 1,005 of 11,704
// indexable ZIPs qualify on the EPA limb and carry zero parcel-precise development
// records — 1,005 of 1,005 via that limb, 0 via anything else.
//
// ⚠️ THE MODEL IS NOT THE PRODUCT. A truth table proves the RULE; it cannot prove the
// parked SQL implements it. Every semantic case is therefore paired with a structural
// assertion against the SQL of record.
//
// ⚖️ THE STRUCTURAL PINS READ EXECUTABLE STATEMENTS ONLY, for the same reason as
// test/dev-refresh-plane-split.test.mjs: this document *documents* the identifiers it
// deliberately does not change, so a whole-file regex would assert prose and the scope
// checks would be tripped by their own rationale.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'docs/epa-decouple-phase2-unit1-core-completion-markers.sql'), 'utf8');

/** Executable SQL only: every whole-line comment removed. */
const executable = (sql) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const sql = executable(raw);

const failures = [];
const ok = (name, cond) => { if (cond) console.log(`PASS — ${name}`); else { console.log(`FAIL — ${name}`); failures.push(name); } };

// ───────────────────────── the model ─────────────────────────
// Mirrors the spliced expressions. `nf`/`nfc` are accepted as arguments ON PURPOSE:
// the point of this unit is that they are accepted and IGNORED, and a model that
// simply omitted them could not demonstrate that.
const indexableAfter  = ({ nd, ndp, nc }) => (nd + nc) > 0 && ndp > 0;
const indexableBefore = ({ nd, ndp, nc, nf, nfc }) => (nd + nf + nc) > 0 && (ndp > 0 || nfc >= 3);
const coreRecords     = ({ nd, nc }) => (nd + nc) > 0;
const scanStatus      = ({ hasReport, nd }) =>
  !hasReport ? 'not_scanned' : nd > 0 ? 'projects_found' : 'no_qualifying_projects_found';

const EPA_GRID = [{ nf: 0, nfc: 0 }, { nf: 1, nfc: 0 }, { nf: 3, nfc: 3 }, { nf: 40, nfc: 40 }, { nf: 400, nfc: 399 }];
const CORE_GRID = [
  { hasReport: false, nd: 0, ndp: 0, nc: 0 },
  { hasReport: true,  nd: 0, ndp: 0, nc: 0 },
  { hasReport: true,  nd: 0, ndp: 0, nc: 7 },
  { hasReport: true,  nd: 3, ndp: 0, nc: 0 },
  { hasReport: true,  nd: 5, ndp: 5, nc: 3 },
  { hasReport: true,  nd: 900, ndp: 612, nc: 61 },
];

// 1 — RULE #1, stated as an INVARIANCE rather than an example. For every core shape, the
// three core markers must return the SAME answer across the whole EPA grid. This is the
// strongest form of "EPA must not determine whether a ZIP page is considered complete":
// it fails if any EPA value changes any core answer anywhere.
{
  let varied = 0;
  for (const core of CORE_GRID) {
    const answers = EPA_GRID.map((e) => JSON.stringify([
      indexableAfter({ ...core, ...e }), coreRecords({ ...core, ...e }), scanStatus({ ...core, ...e }),
    ]));
    if (new Set(answers).size !== 1) varied++;
  }
  ok('1. core markers are invariant across the whole EPA grid (rule #1)', varied === 0);
  ok('1b. the grid is non-trivial (control: the OLD expression DOES vary)',
     CORE_GRID.some((core) => new Set(EPA_GRID.map((e) => indexableBefore({ ...core, ...e }))).size > 1));
}

// 2 — the facilities-only ZIP: the 1,005. Advertised today, not advertised after, and
// honestly described by the new markers rather than silently demoted.
{
  const z = { hasReport: true, nd: 0, ndp: 0, nc: 0, nf: 40, nfc: 40 };
  ok('2. facilities-only ZIP was indexable before', indexableBefore(z) === true);
  ok('2b. facilities-only ZIP is NOT indexable after', indexableAfter(z) === false);
  ok('2c. its scan status is a COMPLETE result, not a failure',
     scanStatus(z) === 'no_qualifying_projects_found');
  ok('2d. its core plane is honestly reported empty', coreRecords(z) === false);
}

// 3 — RULE #8: an EPA outage must not make a core-backed ZIP look incomplete. Same ZIP,
// EPA at 40 facilities and EPA at zero, must be identical on every core marker.
{
  const healthy = { hasReport: true, nd: 5, ndp: 5, nc: 3, nf: 40, nfc: 40 };
  const outage  = { hasReport: true, nd: 5, ndp: 5, nc: 3, nf: 0,  nfc: 0 };
  ok('3. an EPA outage does not change indexability of a core-backed ZIP',
     indexableAfter(healthy) === indexableAfter(outage) && indexableAfter(outage) === true);
  ok('3b. an EPA outage does not change its scan status',
     scanStatus(healthy) === scanStatus(outage) && scanStatus(outage) === 'projects_found');
  ok('3c. an EPA outage does not change core_records_present',
     coreRecords(healthy) === coreRecords(outage) && coreRecords(outage) === true);
  ok('3d. under the OLD rule the outage ZIP was still indexable too (no regression here)',
     indexableBefore(outage) === true);
}

// 4 — the case that separates _nd from _ndp. A ZIP with area-scope development records
// has PROJECTS (so the scan found something and the marker must say so) but nothing
// parcel-precise to pin, so it is correctly not advertised as a map page. Reporting
// 'no_qualifying_projects_found' here would be a false negative — §11 false exclusion.
{
  const z = { hasReport: true, nd: 3, ndp: 0, nc: 0, nf: 0, nfc: 0 };
  ok('4. area-scope-only development reports projects_found', scanStatus(z) === 'projects_found');
  ok('4b. ... and is still not indexable (the pin-precision bar is unchanged)',
     indexableAfter(z) === false);
  ok('4c. ... and its core plane is present', coreRecords(z) === true);
}

// 5 — never scanned is distinguishable from scanned-and-empty. Collapsing the two is how
// "did not run" becomes indistinguishable from "no match".
{
  ok('5. an unscanned ZIP is not_scanned',
     scanStatus({ hasReport: false, nd: 0 }) === 'not_scanned');
  ok('5b. ... and is never confused with a completed empty scan',
     scanStatus({ hasReport: false, nd: 0 }) !== scanStatus({ hasReport: true, nd: 0 }));
  ok('5c. an unscanned ZIP carrying civic notices still reports core records',
     coreRecords({ nd: 0, nc: 4 }) === true);
}

// 6 — the marker pair is a statement, not two independent columns.
ok('6. projects_found always implies core_records_present',
   CORE_GRID.every((c) => scanStatus(c) !== 'projects_found' || coreRecords(c) === true));

// ───────────────────── structural pins on the SQL of record ─────────────────────

// 7 — the new expression, and the removed limb.
ok('7. SQL: the EPA-free indexable expression is spliced in',
   /\(\(_nd\+_nc\)>0 and _ndp > 0\),/.test(sql));
ok('7b. SQL: the replacement value itself names no EPA counter',
   (() => {
     const m = sql.match(/va\s+text := ([\s\S]*?);\n\s*kb\s+text/);
     return !!m && !/_nfc|_nf\b/.test(m[1]);
   })());
ok('7c. SQL: the removed anchor is the facility limb', /_ndp > 0 or _nfc >= 3/.test(sql));

// 8 — the splice fails CLOSED. Each anchor must be asserted unique, with its own raise.
ok('8. SQL: three anchors, each asserted to occur exactly once',
   (sql.match(/if n <> 1 then/g) || []).length === 3);
ok('8b. SQL: each anchor check raises rather than warning',
   (sql.match(/raise exception 'PHASE 2 UNIT 1 FAILED: .*anchor occurs/g) || []).length === 3);
ok('8c. SQL: the splice is proven reversible (no collateral movement)',
   /splice is not reversible/.test(sql) && /replace\(replace\(replace\(out_, va, ka\), vb, kb\), vd, kd\) <> src/.test(sql));
ok('8d. SQL: the stored body is re-read and compared after execute (it proves it ran)',
   /src <> out_/.test(sql) && /stored body differs from the spliced body/.test(sql));

// 9 — ONE migration, not two. Column, backfill and writer must all be in this file, or
// replaying it recreates the 67-second window that cost 6 rows in Phase 1B.
ok('9. SQL: the columns are added here',
   /add column if not exists core_project_scan_status text/.test(sql)
   && /add column if not exists core_records_present\s+boolean/.test(sql));
ok('9b. SQL: the backfill is here', /^update public\.app_community_meta m$/m.test(sql));
ok('9c. SQL: the writer is spliced here', /execute out_;/.test(sql));
ok('9d. SQL: the marker vocabulary is constrained AND validated',
   /check \(core_project_scan_status is null/.test(sql)
   && /validate constraint app_community_meta_core_scan_status_chk/.test(sql));

// 10 — the set is computed in the DB, never transcribed (rule 7).
ok('10. SQL: the backfill derives its set from the DB',
   /from public\.development_reports d where d\.zip = m\.zip/.test(sql)
   && /from public\.app_projects p/.test(sql) && /from public\.app_changes\s+c/.test(sql));
ok('10b. SQL: no hand-listed ZIP array', !/'\d{5}'\s*,\s*'\d{5}'\s*,\s*'\d{5}'/.test(sql));

// 11 — no dead statements. A parked migration that looks complete and cannot run is the
// Phase 1B review finding; an unreachable draft statement is the same defect one step on.
ok('11. SQL: no unreachable draft statement survived', !/\bwhere false\b/i.test(sql));

// 12 — the invariants actually assert the thing.
ok('12. SQL: an invariant forbids the EPA limb returning',
   /the EPA facility limb still gates indexable/.test(sql));
ok('12b. SQL: an invariant pins the overlay is still SELF-REPORTING (6 _nfc refs)',
   /n_nf_index <> 6/.test(sql));
ok('12c. SQL: an invariant forbids NULL markers after backfill',
   /core_project_scan_status is null or core_records_present is null/.test(sql));
ok('12d. SQL: an invariant pins projects_found => core_records_present',
   /projects_found' and core_records_present is not true/.test(sql));

// 13 — SCOPE. This unit changes the indexability decision and adds two core markers.
// It must not touch data_quality (the render gate), the coverage states, the sitemap,
// robots, cron, or the report critical path — those are Units 2-4 and Phase 1.
ok('13. SCOPE: data_quality is not reassigned',
   !/data_quality\s*=/.test(sql) && !/then 'pass'/.test(sql));
ok('13b. SCOPE: no coverage-state change rode along',
   !/app_coverage_states|facilities_only|coverage_coming/.test(sql));
ok('13c. SCOPE: no sitemap / robots / indexing-artifact change rode along',
   !/sitemap|robots|noindex/i.test(sql));
ok('13d. SCOPE: no cron job is touched',
   !/cron\.(alter_job|schedule|unschedule)/.test(sql) && !/dev-reports-rolling-refresh/.test(sql));
ok('13e. SCOPE: the Phase 1 write path is not re-edited',
   !/dev_refresh_collect|dev_epa_write_refused|facilities_refreshed_at/.test(sql));
ok('13f. SCOPE: only app_community_meta and app_refresh_zip are written',
   !/(alter|drop) table public\.(?!app_community_meta)/.test(sql)
   && !/create or replace function/.test(sql));

console.log(`\n${failures.length ? `FAILED: ${failures.length}` : 'ALL PASS'} — EPA phase 2 unit 1 core markers`);
if (failures.length) process.exit(1);
