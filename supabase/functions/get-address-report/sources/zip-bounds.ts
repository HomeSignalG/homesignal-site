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
    return { bounds: b, reason: null };
  } catch (e) {
    return { bounds: null, reason: `rpc threw: ${(e as Error).message}` };
  }
}
