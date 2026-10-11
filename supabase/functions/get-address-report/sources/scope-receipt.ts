// sources/scope-receipt.ts — the SOURCE COMPLETION RECEIPT for the ZIP-mode spatial scope.
//
// WHY (docs/zip-scope-recovery-review-2026-10-11.md): the change ledger must know, per ZIP x source, whether THIS cache
// generation is a complete read of the EXPANDED (polygon) scope — as a positive fact, not as the absence of a failure log. Before
// this, `scope_widened` was set only when a widened-only record was KEPT (csv) and no report carried the scope's identity, so a
// successful expanded read that found zero ring records was indistinguishable from a legacy read, and a change of scope (new
// bounds, new membership rule) was invisible. This module defines the one receipt every spatial connector attaches to its run
// report; public.dev_refresh_receipts_collect (docs/dev-source-receipt.sql) persists it per ZIP x source.
//
//   scope 'expanded'  the widened scope ran to the end (members tested, nothing fell back)
//   scope 'fallback'  widening was REQUESTED and applicable but the result is the LEGACY scope (membership unknown / overflow)
//   scope 'legacy'    widening was not requested (mode off, bounds unavailable) or does not apply (box inside the legacy square)
//   complete          ONLY a positive statement: no truncation, no unresolved or failed membership test, no capacity overflow
//   version           identity of the expanded scope actually used (rule version + envelope + radius); null unless 'expanded'
//
// A fetch that FAILED returns before a receipt is built; the SQL side records that as scope 'failed' from the existing
// dev_failed_sources authority, so a failure is never read as a legacy success.
import { type ScopeBox, scopeBox } from "./scope-box.ts";

/** Bump when the membership/prefilter semantics change in a way that makes an older baseline incomparable. */
export const SCOPE_RULE_VERSION = "v1";

export interface ScopeReceipt {
  scope: "expanded" | "fallback" | "legacy";
  version: string | null;
  complete: boolean;
}

/** Identity of the expanded envelope: rule version + the box used + the radius. Same inputs, same string; any change moves it. */
export function scopeVersion(box: ScopeBox, radiusMi: number): string {
  const f = (n: number) => n.toFixed(5);
  return `${SCOPE_RULE_VERSION}:${f(box.xmin)},${f(box.ymin)},${f(box.xmax)},${f(box.ymax)}:r${radiusMi}`;
}

/** The version a fetch with these inputs would use (callers need it before knowing how the fetch ended). */
export function receiptVersion(
  centroid: { lat: number; lng: number } | null | undefined, radiusMi: number | null | undefined, bounds: ScopeBox | null,
): string | null {
  if (!centroid || !radiusMi || !bounds) return null;
  return scopeVersion(scopeBox(centroid, radiusMi, bounds), radiusMi);
}

export interface ReceiptInput {
  /** widening was requested AND possible (bounds + membership function present) */
  requested: boolean;
  /** the envelope strictly widens the legacy square / circle, i.e. the fetch changed */
  widens: boolean;
  /** the widened fetch ran and was NOT replaced by a legacy result */
  widenedRan: boolean;
  /** report.scope_fallback */
  fallback: string | null | undefined;
  /** report.truncated_at_max_rows */
  truncatedAt: number | null | undefined;
  /** scope accounting of the widened run, when one ran */
  metrics?: { unresolved_excluded: number; rpc_failures: number; capacity_truncated: boolean } | null;
  version: string | null;
}

export function buildScopeReceipt(i: ReceiptInput): ScopeReceipt {
  const truncated = i.truncatedAt != null;
  if (i.fallback) return { scope: "fallback", version: null, complete: false };
  if (!i.requested || !i.widens || !i.widenedRan) return { scope: "legacy", version: null, complete: !truncated };
  const m = i.metrics;
  const complete = !truncated && !!m && m.unresolved_excluded === 0 && m.rpc_failures === 0 && !m.capacity_truncated;
  return { scope: "expanded", version: i.version, complete };
}
