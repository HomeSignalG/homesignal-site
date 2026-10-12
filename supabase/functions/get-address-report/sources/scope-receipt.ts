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
export const SCOPE_RULE_VERSION = "v2";

export interface ScopeReceipt {
  scope: "expanded" | "fallback" | "legacy";
  version: string | null;
  complete: boolean;
}

/** Registry keys that do NOT change what a source returns for a ZIP (labels, coverage gating, audit notes, projection and paging
 *  mechanics). Every other key is MATERIAL by default: a key added later moves the signature (a safe rebaseline) instead of being
 *  silently ignored. */
export const NON_MATERIAL_KEYS: ReadonlySet<string> = new Set([
  "jurisdiction", "coverage", "observed_types_unreviewed", "out_fields", "page_size", "yields_to",
]);

/** Deterministic canonical JSON: sorted keys, no whitespace, so the same configuration always serialises identically. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

/** FNV-1a 64-bit over the UTF-16 code units, as 16 hex digits. Pure, synchronous, no runtime dependency; a signature, not a secret. */
export function fnv64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** Signature of the MATERIAL inputs of one registry entry: endpoint/dataset, filters and eligibility, field and identity mapping,
 *  scoping and completeness semantics. Tokens, URLs' volatile query parts and operational settings are not in the entry or are
 *  excluded above. */
export function sourceConfigSignature(entry: Record<string, unknown>): string {
  const material: Record<string, unknown> = {};
  for (const k of Object.keys(entry)) {
    if (k.startsWith("_") || NON_MATERIAL_KEYS.has(k)) continue;
    material[k] = entry[k];
  }
  return fnv64(canonicalJson(material));
}

/** Identity of the expanded scope: rule version + the canonical polygon's geometry identity + the box used + the radius + the
 *  source's material configuration. Same inputs, same string; any change moves it. The geometry identity is REQUIRED: a polygon
 *  edit that keeps the same bounding box must not inherit an old baseline. */
export function scopeVersion(box: ScopeBox, radiusMi: number, geomSig: string, configSig: string): string {
  const f = (n: number) => n.toFixed(5);
  return `${SCOPE_RULE_VERSION}:${f(box.xmin)},${f(box.ymin)},${f(box.xmax)},${f(box.ymax)}:r${radiusMi}:g${geomSig}:c${configSig}`;
}

/** The version a fetch with these inputs would use (callers need it before knowing how the fetch ended). Null when ANY identity
 *  input is unknown — most importantly the polygon's geometry signature — because a version that cannot be compared proves nothing
 *  (the receipt then reads as an unversioned, incomplete expanded read and the ledger holds). */
export function receiptVersion(
  centroid: { lat: number; lng: number } | null | undefined, radiusMi: number | null | undefined,
  bounds: (ScopeBox & { geom_sig?: string | null }) | null, entry?: Record<string, unknown> | null,
): string | null {
  if (!centroid || !radiusMi || !bounds || !entry) return null;
  const g = typeof bounds.geom_sig === "string" && /^[0-9a-f]{8,}$/.test(bounds.geom_sig) ? bounds.geom_sig : null;
  if (!g) return null;
  return scopeVersion(scopeBox(centroid, radiusMi, bounds), radiusMi, g, sourceConfigSignature(entry));
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
  return { scope: "expanded", version: i.version, complete: complete && i.version != null };
}
