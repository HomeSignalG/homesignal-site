// sources/zip-bounds.ts — reads the bounding box of a ZIP's canonical polygon for the ZIP-mode
// spatial scope (sources/scope-box.ts). The ONLY source is geo.zcta_boundary, through the
// service-role-only RPC public.zip_scope_bounds (docs/zip-scope-bounds.sql). No second copy of
// ZIP geometry exists in the engine.
//
// FAIL-SAFE BY DESIGN: any failure (RPC absent because the migration is not applied yet, a
// transport error, a malformed answer, a ZIP with no boundary) returns null, and null means the
// legacy centroid scope — exactly what ran before this module existed. A failed read can never
// make a fetch smaller; it can only leave the fetch as it is today. The failure is returned as a
// reason so the caller can log it instead of swallowing it.

import { validBounds, type ZipBounds } from "./scope-box.ts";

// deno-lint-ignore no-explicit-any
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }> };

export interface ZipBoundsResult { bounds: ZipBounds | null; reason: string | null }

export async function zipScopeBounds(db: Rpc, zip: string): Promise<ZipBoundsResult> {
  if (!/^\d{5}$/.test(zip)) return { bounds: null, reason: "zip is not 5 digits" };
  try {
    const { data, error } = await db.rpc("zip_scope_bounds", { p_zip: zip });
    if (error) return { bounds: null, reason: `rpc error: ${error.message}` };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { bounds: null, reason: "no boundary for this ZIP (not_measured)" };
    const b = { xmin: Number(row.xmin), ymin: Number(row.ymin), xmax: Number(row.xmax), ymax: Number(row.ymax) };
    if (!validBounds(b)) return { bounds: null, reason: "boundary box failed validation" };
    // The polygon's own identity (md5 of its canonical geometry). Carried ON the bounds object so every connector's receipt can
    // include it without new plumbing; absent (older database) => receipts cannot be versioned and the ledger holds.
    let sig: string | null = null;
    try {
      const g = await db.rpc("zip_geom_sig", { p_zip: zip });
      if (!g.error && typeof g.data === "string" && /^[0-9a-f]{32}$/.test(g.data)) sig = g.data;
    } catch { /* no signature => the receipt cannot be versioned => the ledger holds (fail closed) */ }
    return { bounds: sig ? { ...b, geom_sig: sig } as ZipBounds : b, reason: null };
  } catch (e) {
    return { bounds: null, reason: `rpc threw: ${(e as Error).message}` };
  }
}

// ── ROLLOUT POLICY (server-controlled; a caller cannot touch it) ─────────────────────────────
// Whether a ZIP-mode request widens its spatial scope is decided ONLY by function secrets, never by
// anything in the request body: the endpoint is reachable with the public anon key, and an
// unauthenticated caller must not be able to turn a production-wide behaviour on or off, nor force
// the heavier fetch on a ZIP that has not been canaried.
//
//   ZIP_SCOPE_BOUNDS_MODE   "off" (default) | "allowlist" | "all"
//   ZIP_SCOPE_BOUNDS_ZIPS   comma/space separated 5-digit ZIPs; read ONLY when mode is "allowlist"
//
// FAIL CLOSED: an unset, misspelt or unknown mode is "off"; in allowlist mode a token that is not
// exactly five digits is ignored, so a typo narrows the canary rather than widening it; an empty
// allowlist enables nothing. "all" is the national switch and needs its own approval.
export type ScopeMode = "off" | "allowlist" | "all";
export interface ScopePolicy { on: boolean; mode: ScopeMode; why: string }

export function scopePolicy(get: (name: string) => string | undefined, zip: string): ScopePolicy {
  const raw = (get("ZIP_SCOPE_BOUNDS_MODE") ?? "").trim().toLowerCase();
  const mode: ScopeMode = raw === "all" ? "all" : raw === "allowlist" ? "allowlist" : "off";
  if (mode === "off") {
    return { on: false, mode, why: raw && raw !== "off" ? `unknown ZIP_SCOPE_BOUNDS_MODE "${raw}" — treated as off` : "polygon-bbox scope off" };
  }
  if (mode === "all") return { on: true, mode, why: "mode=all" };
  const allowed = new Set((get("ZIP_SCOPE_BOUNDS_ZIPS") ?? "").split(/[\s,]+/).filter((z) => /^\d{5}$/.test(z)));
  return allowed.has(zip)
    ? { on: true, mode, why: "ZIP on the canary allowlist" }
    : { on: false, mode, why: "ZIP not on the canary allowlist" };
}
