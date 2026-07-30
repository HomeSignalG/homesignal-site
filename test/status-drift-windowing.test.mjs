// Phase 3.5 status-domain drift — windowing, difference categories, and the bounded
// status_unresolved hatch (scripts/lib/status-drift.mjs).
//
// The defect these pin: the drift check applied each entry's `extra_where` but NOT its
// `recency_days`, so on the 61 windowed entries it read the entry's whole HISTORY and would
// have reported historical values as nightly drift forever — on entries that are 100% clean
// in production. Denver is the worked example: Title Case inside the 365-day window,
// UPPERCASE outside it, and the connector only ever fetches the windowed half.
//
// Rule 13 — "probe the question the connector asks". Each clause below is asserted against
// the clause its own connector builds, INCLUDING the differences between families, because a
// probe whose scope differs from the connector's answers a different question.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  windowClause, windowLabel, andWhere, differenceCategory, renderBytes,
  unresolvedIndex, UNRESOLVED_VOLUME_BOUND, firstColOf,
} from '../scripts/lib/status-drift.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};
const cutoff = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

// ── 1. Each family's window clause matches ITS OWN connector, differences included ────
{
  const e = { recency_days: 365, column_map: { file_date: 'ISSUE_DATE' } };
  ok(windowClause('arcgis', e) === `ISSUE_DATE >= DATE '${cutoff(365)}'`,
    "arcgis: `>= DATE '<cutoff>'` (sources/arcgis.ts)", windowClause('arcgis', e));
  ok(windowClause('socrata', e) === `ISSUE_DATE > '${cutoff(365)}T00:00:00'`,
    "socrata: `> '<cutoff>T00:00:00'` — a different operator AND a timestamp literal",
    windowClause('socrata', e));
  ok(windowClause('ckan', e) === `"ISSUE_DATE" > '${cutoff(365)}'`,
    'ckan: quoted identifier, bare date', windowClause('ckan', e));
  ok(windowClause('carto', e) === `ISSUE_DATE > now() - interval '365 days'`,
    'carto: PostgreSQL interval, not a literal cutoff', windowClause('carto', e));
  ok(windowClause('csv', e) === null,
    'csv: no SQL clause — sources/csv.ts windows in-process at parse time');
}

// ── 2. The date-column FALLBACK differs by family, and getting it wrong changes scope ──
{
  const e = { recency_days: 365, column_map: {}, incremental_field: 'UPDATED' };
  ok(windowClause('arcgis', e) === `UPDATED >= DATE '${cutoff(365)}'`,
    'arcgis falls back to incremental_field when file_date is absent');
  ok(windowClause('socrata', e) === `UPDATED > '${cutoff(365)}T00:00:00'`,
    'socrata falls back to incremental_field too');
  ok(windowClause('ckan', e) === null && windowClause('carto', e) === null,
    'ckan/carto use file_date ONLY — no incremental_field fallback, so no window exists here',
    `ckan=${windowClause('ckan', e)} carto=${windowClause('carto', e)}`);
}

// ── 3. No window ⇒ the whole dataset is in-window (the fort-collins case) ─────────────
{
  const e = { column_map: { file_date: null }, recency_days: null };
  ok(windowClause('arcgis', e) === null, 'recency_days null → no clause');
  ok(/no recency window — whole dataset is in-window/.test(windowLabel('arcgis', e)),
    'windowLabel says so in words, so a reader can see the scope tested', windowLabel('arcgis', e));
  const e2 = { column_map: {}, recency_days: 365 };
  ok(/recency_days set but no date column — NOT windowed/.test(windowLabel('ckan', e2)),
    'a window that cannot be applied is stated, never silently skipped', windowLabel('ckan', e2));
}

// ── 4. The inverted (out-of-window) clause includes NULL dates ────────────────────────
// A row with no date is never fetched by the connector, so it belongs to the out-of-window
// half. Omitting `IS NULL` would make those rows vanish from BOTH halves and be silently
// uncounted — the "too narrow invents absences" direction of Rule 13.
{
  const e = { recency_days: 730, column_map: { file_date: 'ISSUE_DATE' } };
  for (const fam of ['arcgis', 'socrata', 'ckan', 'carto']) {
    ok(/IS NULL/.test(windowClause(fam, e, true)), `${fam}: out-of-window clause covers NULL dates`,
      windowClause(fam, e, true));
  }
  ok(andWhere('A', 'B') === '(A) AND (B)', 'extra_where and the window are ANDed, never replaced');
  ok(andWhere(null, 'B') === 'B' && andWhere('A', null) === 'A' && andWhere(null, null) === null,
    'either half alone is passed through unchanged');
}

// ── 5. Difference categories — case vs whitespace are NOT the same defect ─────────────
{
  const keys = ['New Building', "Finaled No Inspection Req'd", 'Issued'];
  const c = differenceCategory('NEW BUILDING', keys);
  ok(c && c.category === 'differs only in case' && c.key === 'New Building' && c.resolves === true,
    'case-only → resolves in production (resolveNormalized case-folds)', JSON.stringify(c));

  const w = differenceCategory("Finaled  No Inspection Req'd", keys);
  ok(w && w.category === 'differs only in whitespace' && w.resolves === false,
    'interior-whitespace-only → does NOT resolve; the record is still dropped', JSON.stringify(w));

  ok(differenceCategory('Issued', keys) === null, 'an exact value is not a difference at all');
  ok(differenceCategory('Totally Unknown', keys) === null,
    'a genuinely unmapped value is not a difference category — it must reach a tier, not a note');
}

// ── 6. Byte-level rendering makes an invisible difference visible ─────────────────────
{
  ok(renderBytes("Finaled  No Inspection Req'd") === "Finaled··No·Inspection·Req'd",
    'spaces render as · so a double space is visible', renderBytes("Finaled  No Inspection Req'd"));
  ok(renderBytes('a\tb') === 'a\\tb', 'a tab renders as an escape, not as blank space');
}

// ── 7. status_unresolved is an annotation, never a bucket ─────────────────────────────
{
  const e = { status_unresolved: [{ value: 'CAGIS', first_seen: '2026-07-30', records_at_first_seen: 1, asked: 'no public data dictionary' }] };
  const idx = unresolvedIndex(e);
  ok(idx.has('CAGIS') && idx.get('CAGIS').first_seen === '2026-07-30',
    'an unresolved value is indexed with its provenance');
  ok(!Object.values(e).some((v) => JSON.stringify(v).includes('proposed') || JSON.stringify(v).includes('operating')),
    'status_unresolved carries NO bucket — the record still fails closed and is still dropped');
  ok(UNRESOLVED_VOLUME_BOUND === 0.05, 'the hatch is bounded at 5% of in-window records');
  // The bound is what stops the hatch becoming a silent catch-all.
  const inTotal = 1000;
  ok((49 / inTotal) <= UNRESOLVED_VOLUME_BOUND && (51 / inTotal) > UNRESOLVED_VOLUME_BOUND,
    'below the bound suppresses the gate; above it, the gate fires anyway');
}

// ── 8. Contract against the LIVE registry, not a fixture ──────────────────────────────
{
  const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
  const fams = ['arcgis', 'socrata', 'ckan', 'csv', 'carto', 'opendatasoft'];
  const checked = fams.flatMap((f) => (REG[f] || []).map((e) => [f, e]))
    .filter(([, e]) => e.column_map?.status_raw && !e.status_const &&
      ['proposed', 'approved', 'operating', 'exclude'].some((b) => (e.status_to_bucket?.[b] || []).length));
  const windowed = checked.filter(([f, e]) => windowClause(f, e) !== null);
  ok(checked.length > 0, `the drift check covers ${checked.length} live entries`);
  ok(windowed.length > 0,
    `${windowed.length} of ${checked.length} carry a window the old check ignored — each would have reported its history as drift`);
  // Every status_unresolved entry in the live registry must carry its provenance, or the
  // hatch degrades into "an unexplained value someone silenced".
  for (const [, e] of checked) {
    for (const u of (e.status_unresolved || [])) {
      ok(!!u.value && !!u.first_seen && u.records_at_first_seen != null && !!u.asked,
        `${e.registry_id}: status_unresolved "${u.value}" carries value+first_seen+records_at_first_seen+asked`,
        JSON.stringify(u));
    }
  }
  ok(firstColOf(['A', 'B']) === 'A' && firstColOf('A') === 'A' && firstColOf(null) === null,
    'firstColOf mirrors the connectors: an array means the FIRST column, never a join');
}

console.log(fails ? `\n${fails} check(s) failed.` : '\nAll status-drift windowing assertions passed.');
process.exit(fails ? 1 : 0);
