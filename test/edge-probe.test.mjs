// Offline checks for the edge-probe reachability preflight (supabase/functions/edge-probe).
// Drives the SHIPPED handler with a stubbed fetch — no network.
//
// The load-bearing assertion is FETCH-SHAPE PARITY: the probe must send byte-identical
// headers and the identical timeout to sources/arcgis.ts::getWithBackoff's GET path,
// because a probe with a different request shape answers a DIFFERENT question (a WAF can
// key on the User-Agent alone — the PennDOT/pg_net split is exactly a client-shape split).
// If either file drifts, this test goes red until they match again.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const SRC = join(root, 'supabase/functions/edge-probe/index.ts');
let handleProbe, probeOne, refusalReason;
try {
  ({ handleProbe, probeOne, refusalReason } = await import(SRC));
} catch (err) {
  console.log('FAIL — import edge-probe/index.ts (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

// ── 1. FETCH-SHAPE PARITY with the arcgis connector (textual, both files) ────────
{
  const probeSrc = readFileSync(SRC, 'utf8');
  const arcgisSrc = readFileSync(join(root, 'supabase/functions/get-address-report/sources/arcgis.ts'), 'utf8');
  const UA = 'HomeSignal public-records refresh (contact: admin@homesignal.net)';
  ok(probeSrc.includes(`"User-Agent": "${UA}"`), 'probe sends the connector User-Agent verbatim');
  ok(arcgisSrc.includes(`"User-Agent": "${UA}"`), 'the connector still sends that same User-Agent (parity anchor exists)');
  ok(probeSrc.includes('"Accept": "application/json"') && arcgisSrc.includes('"Accept": "application/json"'),
    'both send Accept: application/json');
  ok(probeSrc.includes('AbortSignal.timeout(PARITY_TIMEOUT_MS)') && probeSrc.includes('PARITY_TIMEOUT_MS = 30000')
      && arcgisSrc.includes('AbortSignal.timeout(30000)'),
    'both use the identical 30 s timeout — the probe waits exactly as long as the connector would');
}

// ── 2. SSRF fences — refused BEFORE any fetch ────────────────────────────────────
ok(refusalReason('http://example.com/') === 'https only', 'http refused');
ok(refusalReason('not a url') === 'invalid URL', 'garbage refused');
ok(refusalReason('https://localhost/x') !== null, 'localhost refused');
ok(refusalReason('https://foo.internal/x') !== null, '*.internal refused');
ok(refusalReason('https://metadata.google.internal/computeMetadata') !== null, 'metadata endpoint refused');
ok(refusalReason('https://169.254.169.254/latest/meta-data') !== null, 'link-local metadata address refused');
ok(refusalReason('https://10.0.0.8/x') !== null, '10.x refused');
ok(refusalReason('https://172.20.1.1/x') !== null, '172.16-31 refused');
ok(refusalReason('https://192.168.1.1/x') !== null, '192.168 refused');
ok(refusalReason('https://127.0.0.1/x') !== null, 'loopback refused');
ok(refusalReason('https://gis.penndot.pa.gov/gis/rest/services?f=json') === null, 'a real public gov host passes the fence');
{
  const calls = [];
  const r = await probeOne({ id: 'fence', url: 'https://192.168.0.1/secret' }, async (u) => { calls.push(u); });
  ok(calls.length === 0 && r.error !== null && r.status === null,
    'a fenced URL is NEVER fetched — refusal happens before the network');
}

// ── 3. Receipt shape on a stubbed 200 ────────────────────────────────────────────
function stubResponse({ status = 200, body = '{"ok":true}', ct = 'application/json', redirected = false, url = '' } = {}) {
  const bytes = new TextEncoder().encode(body);
  let served = false;
  return {
    ok: status >= 200 && status < 300, status, redirected, url,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? ct : null) },
    body: {
      getReader: () => ({
        read: async () => (served ? { done: true } : (served = true, { done: false, value: bytes })),
        cancel: async () => {},
      }),
    },
  };
}
{
  const r = await probeOne({ id: 'ok200', url: 'https://gis.example.gov/rest?f=json' },
    async () => stubResponse({ body: '{"currentVersion":10.91}', url: 'https://gis.example.gov/rest?f=json' }));
  ok(r.ok === true && r.status === 200, 'a 200 stamps ok:true status:200');
  ok(r.bytes === 24 && r.body_head === '{"currentVersion":10.91}', 'bytes counted and body_head carried verbatim');
  ok(r.content_type === 'application/json' && typeof r.elapsed_ms === 'number', 'content_type + elapsed_ms present');
  ok(r.error === null, 'no error on success');
}
{
  const r = await probeOne({ id: 'waf', url: 'https://blocked.example.gov/x' },
    async () => stubResponse({ status: 403, body: 'Access Denied by WAF', ct: 'text/html' }));
  ok(r.ok === false && r.status === 403 && r.body_head.includes('WAF'),
    'a 403 stamps ok:false with the blocking page text in body_head — the evidence a stamp needs');
}
{
  const r = await probeOne({ id: 'boom', url: 'https://dead.example.gov/x' },
    async () => { throw new Error('error sending request'); });
  ok(r.ok === false && r.status === null && r.error.includes('error sending request'),
    'a thrown fetch stamps status:null with the error text — network-level failure distinguishable from an HTTP block');
}

// ── 4. Body cap — a huge body never blows the budget ─────────────────────────────
{
  const chunk = new TextEncoder().encode('x'.repeat(16384));
  let reads = 0;
  const res = {
    ok: true, status: 200, redirected: false, url: '',
    headers: { get: () => 'text/html' },
    body: { getReader: () => ({ read: async () => (reads++, { done: false, value: chunk }), cancel: async () => {} }) },
  };
  const r = await probeOne({ id: 'big', url: 'https://big.example.gov/x' }, async () => res);
  ok(r.bytes >= 65536 && r.bytes <= 65536 + 16384 && reads <= 6,
    `body read stops at the 64 KB cap (bytes=${r.bytes}, reads=${reads})`);
  ok(r.body_head.length === 600, 'body_head clipped to 600 chars');
}

// ── 5. Handler contract ──────────────────────────────────────────────────────────
{
  const bad = await handleProbe({ nope: 1 }, async () => stubResponse());
  ok(bad.status === 400, 'missing targets → 400');
  const many = await handleProbe({ targets: Array.from({ length: 11 }, (_, i) => ({ id: String(i), url: 'https://a.gov/' })) }, async () => stubResponse());
  ok(many.status === 400, '11 targets → 400 (cap 10)');
  const good = await handleProbe({ targets: [{ id: 'a', url: 'https://a.example.gov/x' }, { id: 'b', url: 'http://b.example.gov/x' }] },
    async () => stubResponse());
  ok(good.status === 200 && good.payload.receipts.length === 2, 'mixed batch → 200 with one receipt per target');
  ok(good.payload.receipts[1].error === 'https only', 'per-target refusal rides in its receipt, not a whole-call failure');
  ok(good.payload.mode === 'edge-probe' && typeof good.payload.probed_at === 'string', 'payload stamps mode + probed_at');
}

console.log(fails ? `\n${fails} edge-probe assertion(s) FAILED.` : '\nAll edge-probe assertions passed.');
process.exit(fails ? 1 : 0);
