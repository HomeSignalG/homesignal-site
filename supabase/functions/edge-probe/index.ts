// edge-probe — edge-runtime reachability preflight (founder-approved 2026-08-17).
//
// WHY THIS EXISTS. PennDOT proved the reachability instruments disagree by client class:
// gis.penndot.pa.gov hard-400s EVERY pg_net request while the deployed edge runtime (the
// client that actually matters — the engine) fetches it cleanly. So a pg_net-based
// rejection stamp ("WAF-walled", "unreachable") is a claim about the WRONG client. This
// function answers the question the connector asks: can THIS runtime fetch THAT host —
// with receipts (status, timing, response shape) strong enough to stamp a verdict.
//
// FETCH-SHAPE PARITY (Rule 13, enforced not conventional): the headers and timeout below
// are BYTE-IDENTICAL to sources/arcgis.ts::getWithBackoff's GET path, and
// test/edge-probe.test.mjs fails CI if either file drifts from the other. A probe with a
// different request shape answers a different question (a WAF can key on UA alone).
//
// SAFETY RAILS — an arbitrary-URL fetcher is an SSRF primitive, so:
//   • https only; GET only; no caller headers forwarded; no credentials attached.
//   • hostnames that ARE addresses in private/link-local/loopback ranges are refused,
//     as are localhost/*.internal/metadata names. (A DNS name resolving privately is
//     not detectable pre-fetch in this runtime; the gateway JWT check plus these fences
//     cover the realistic surface — this function also runs with JWT verification ON,
//     unlike the engine.)
//   • ≤ 10 targets per call; 30 s per target (the connector's own patience); body read
//     capped at 64 KB, receipt carries only the first 600 chars.
//   • Writes nothing anywhere — pure fetch-and-report. The pg_net response row IS the
//     receipt channel back to the sandbox.

// KEEP IDENTICAL to sources/arcgis.ts::getWithBackoff (test-enforced).
const PARITY_HEADERS: Record<string, string> = {
  "Accept": "application/json",
  "User-Agent": "HomeSignal public-records refresh (contact: admin@homesignal.net)",
};
const PARITY_TIMEOUT_MS = 30000;

const MAX_TARGETS = 10;
const BODY_CAP_BYTES = 65536;
const BODY_HEAD_CHARS = 600;

interface Target { id?: string; url?: string }
interface Receipt {
  id: string;
  url: string;
  ok: boolean;
  status: number | null;
  elapsed_ms: number;
  bytes: number | null;
  content_type: string | null;
  redirected: boolean | null;
  final_url: string | null;
  body_head: string | null;
  error: string | null;
}

// Refuse obviously-internal destinations before any fetch. Literal-address checks cover
// IPv4 private/loopback/link-local + the cloud metadata address; name checks cover the
// common internal suffixes. https-only is enforced separately.
export function refusalReason(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "invalid URL"; }
  if (u.protocol !== "https:") return "https only";
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host === "metadata.google.internal") {
    return "internal hostname refused";
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)) return "private/link-local address refused";
  }
  if (host.includes(":")) return "IP-literal refused"; // bracketless IPv6 can't reach here via URL, but fail closed
  return null;
}

export async function probeOne(t: Target, fetchImpl: typeof fetch): Promise<Receipt> {
  const id = String(t.id ?? t.url ?? "??");
  const url = String(t.url ?? "");
  const base: Receipt = {
    id, url, ok: false, status: null, elapsed_ms: 0, bytes: null,
    content_type: null, redirected: null, final_url: null, body_head: null, error: null,
  };
  const refusal = refusalReason(url);
  if (refusal) return { ...base, error: refusal };
  const t0 = Date.now();
  try {
    const res = await fetchImpl(url, { headers: PARITY_HEADERS, signal: AbortSignal.timeout(PARITY_TIMEOUT_MS) });
    // Read at most BODY_CAP_BYTES so a huge or slow-streaming body can't blow the worker budget.
    let text = "";
    let bytes = 0;
    const reader = res.body?.getReader();
    if (reader) {
      const dec = new TextDecoder();
      while (bytes < BODY_CAP_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (text.length < BODY_HEAD_CHARS * 4) text += dec.decode(value, { stream: true });
      }
      await reader.cancel().catch(() => {});
    }
    return {
      ...base,
      ok: res.ok,
      status: res.status,
      elapsed_ms: Date.now() - t0,
      bytes,
      content_type: res.headers.get("content-type"),
      redirected: res.redirected,
      final_url: res.url || null,
      body_head: text.slice(0, BODY_HEAD_CHARS) || null,
    };
  } catch (err) {
    return { ...base, elapsed_ms: Date.now() - t0, error: String((err as Error)?.message ?? err) };
  }
}

export async function handleProbe(body: unknown, fetchImpl: typeof fetch): Promise<{ status: number; payload: unknown }> {
  const targets = (body as { targets?: Target[] })?.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    return { status: 400, payload: { error: "body must be {\"targets\":[{id,url},…]}" } };
  }
  if (targets.length > MAX_TARGETS) {
    return { status: 400, payload: { error: `at most ${MAX_TARGETS} targets per call` } };
  }
  const receipts: Receipt[] = [];
  for (const t of targets) receipts.push(await probeOne(t, fetchImpl)); // sequential on purpose — timing receipts must not contend
  return { status: 200, payload: { mode: "edge-probe", probed_at: new Date().toISOString(), receipts } };
}

if (typeof Deno !== "undefined" && (Deno as { serve?: unknown }).serve) {
  Deno.serve(async (req: Request) => {
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
    let body: unknown;
    try { body = await req.json(); } catch { body = null; }
    const { status, payload } = await handleProbe(body, fetch);
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  });
}
