// An HTTP/1.1-only client for publishers whose servers break on HTTP/2 (opt-in per registry entry,
// `http1_only`). Found 2026-11-06: maps.huntsvilleal.gov answers a GitHub runner's HTTP/1.1 request
// with 19,015 permits, while Deno's fetch and pg_net (both of which negotiate HTTP/2) fail with
// "error sending request" / "Stream error in the HTTP/2 framing layer". Deno exposes
// Deno.createHttpClient({ http2: false }); the client is created once and reused.
// Returns null when the runtime has no such API (node tests, or a runtime that withholds it).

let cached: unknown | null | undefined;

export function http1Client(): unknown | null {
  if (cached !== undefined) return cached;
  const d = (globalThis as { Deno?: { createHttpClient?: (o: Record<string, unknown>) => unknown } }).Deno;
  try {
    cached = d && typeof d.createHttpClient === "function" ? d.createHttpClient({ http1: true, http2: false }) : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test seam: forget the cached client. */
export function resetHttp1Client(): void { cached = undefined; }
