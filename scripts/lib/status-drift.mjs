// Pure helpers for the Phase 3.5 status-domain drift check (scripts/source-monitor.mjs).
// Extracted so they can be unit-tested WITHOUT importing source-monitor.mjs, which runs its
// whole nightly pass (network included) at import time.

// ── the connector's OWN window (Rule 13: probe the question the connector asks) ──────
//
// A probe whose scope differs from the connector's answers a DIFFERENT question. Too narrow
// invents absences; too wide invents drift. Phase 3.5 previously applied extra_where but NOT
// recency_days, so on the 61 windowed entries it read the entry's whole HISTORY and would
// have reported historical values as nightly drift forever — on entries that are 100% clean
// in production. (Denver is the worked example: its layer stores Title Case inside the
// 365-day window and UPPERCASE outside it, so an unwindowed probe flags 16 uppercase values
// that the connector can never fetch.)
//
// Each clause below is copied from its connector's own builder, including the differences —
// arcgis `>= DATE`, socrata `> '…T00:00:00'`, ckan quoted-ident `>`, carto PG interval — and
// including which column each falls back to: arcgis/socrata use file_date || incremental_field,
// ckan/carto use file_date ONLY. Reproducing those exactly is the whole point.
export function firstColOf(ref) { return Array.isArray(ref) ? (ref[0] ?? null) : (ref ?? null); }

export function windowClause(family, e, invert = false) {
  if (!(e.recency_days > 0)) return null;                       // no window ⇒ whole dataset is in-window
  const cutoff = new Date(Date.now() - e.recency_days * 86400000).toISOString().slice(0, 10);
  const fd = firstColOf(e.column_map?.file_date);
  const col = (family === 'arcgis' || family === 'socrata') ? (fd || e.incremental_field) : fd;
  if (!col) return null;                                        // nothing to window on
  switch (family) {
    case 'arcgis':  return invert ? `(${col} < DATE '${cutoff}' OR ${col} IS NULL)` : `${col} >= DATE '${cutoff}'`;
    case 'socrata': return invert ? `(${col} <= '${cutoff}T00:00:00' OR ${col} IS NULL)` : `${col} > '${cutoff}T00:00:00'`;
    case 'ckan':    return invert ? `("${col}" <= '${cutoff}' OR "${col}" IS NULL)` : `"${col}" > '${cutoff}'`;
    case 'carto':   return invert
      ? `(${col} <= now() - interval '${e.recency_days} days' OR ${col} IS NULL)`
      : `${col} > now() - interval '${e.recency_days} days'`;
    default:        return null;                                // csv windows in-process; ods has no connector
  }
}
export const andWhere = (a, b) => (a && b) ? `(${a}) AND (${b})` : (a || b || null);

/** Human description of the scope a probe actually tested, printed beside every finding. */
export function windowLabel(family, e) {
  const parts = [];
  if (e.extra_where) parts.push(`extra_where: ${e.extra_where}`);
  const w = windowClause(family, e);
  parts.push(w ? `recency: ${w}` : (e.recency_days > 0 ? 'recency_days set but no date column — NOT windowed' : 'no recency window — whole dataset is in-window'));
  return parts.join(' · ');
}

// ── difference categories (tier 3) ───────────────────────────────────────────────────
// resolveNormalized (sources/socrata.ts) trims and case-folds but does NOT collapse interior
// whitespace, so "differs only in case" resolves in production while "differs only in
// whitespace" still DROPS the record. Both are reported as non-failing notes per the founder's
// taxonomy, but they are NOT the same defect and the report says which is which.
export const collapseWs = (s) => String(s).replace(/\s+/g, ' ').trim();
/** Byte-level rendering so an invisible difference is visible in the report. */
export function renderBytes(s) {
  return JSON.stringify(String(s)).slice(1, -1).replace(/ /g, '·');
}
export function differenceCategory(live, mappedKeys) {
  const lv = String(live).trim();
  for (const k of mappedKeys) {
    if (k === lv) return null;                                        // exact — not a difference
    if (k.toLowerCase() === lv.toLowerCase()) {
      return { category: 'differs only in case', key: k, resolves: true };
    }
    if (collapseWs(k).toLowerCase() === collapseWs(lv).toLowerCase()) {
      return { category: 'differs only in whitespace', key: k, resolves: false };
    }
  }
  return null;
}

/** Values a human has looked up and could not attribute a meaning to — see status_unresolved
 *  in jurisdiction-registry.json. Never a bucket: the record still fails closed and is still
 *  dropped. This only suppresses the GATE, and only up to UNRESOLVED_VOLUME_BOUND. */
export const UNRESOLVED_VOLUME_BOUND = 0.05;
export function unresolvedIndex(e) {
  const m = new Map();
  for (const u of (e.status_unresolved || [])) m.set(String(u.value).trim(), u);
  return m;
}

/** Rows for the "Unreachable" table. An entry whose status domain could NOT be read is not an
 *  entry that came back clean — but a bare COUNT makes the two indistinguishable in every
 *  downstream consumer, so a green run stays compatible with N entries never having been read.
 *  That is the failure the drift check exists to prevent, reproduced inside the check, which is
 *  why the reason is carried through rather than reconstructed at render time. A missing reason
 *  is itself reported, never silently blanked. */
export function unreachableRows(drift) {
  return (drift || [])
    .filter((d) => d && d.unreachable)
    .map((d) => ({
      registry_id: d.registry_id,
      family: d.family || '—',
      field: d.field || '—',
      reason: d.unreachableReason || 'reader returned null; no reason captured',
    }));
}
