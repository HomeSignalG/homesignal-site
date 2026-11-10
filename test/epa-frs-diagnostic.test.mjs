// FRS error diagnostics (2026-11-10, DIAGNOSTIC ONLY).
// After get-address-report v313 an increase in TypeError failures was observed on the third FRS attempt after two
// 429s (32 of 92 such reads after the deploy, 0 of 626 before); the mechanism is unknown, because the engine
// stores only the error's name. This patch records each thrown error as FIXED VALUES (stage, name, kind, errno
// code, os error number, timings), never free-form text. These tests pin that it is diagnostic only: retry
// decisions, completeness, `failures` and every field a consumer reads are unchanged; the record is bounded in
// entries and in UTF-8 bytes; and no text from an error can reach it.
//
// Run: node test/epa-frs-diagnostic.test.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN = join(root, 'supabase/functions/get-address-report');
const F = await import(join(FN, 'sources/epa-frs.ts'));
const Z = await import(join(FN, 'sources/epa-frs-zip.ts'));

let fails = 0;
const ok = (cond, name, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (!cond && detail ? '\n     ' + detail : ''));
  if (!cond) fails++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

// ── fake FRS replies ─────────────────────────────────────────────────────────────────────────
const SECRET_URL = 'https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities?latitude83=34.803600&longitude83=-86.970700&search_radius=3&output=JSON&apikey=SECRET123';
const withCause = (err, cause) => { err.cause = cause; return err; };
const netError = (msg = `error sending request for url (${SECRET_URL})`, cause = Object.assign(new Error('Connection reset by peer (os error 104) at 10.20.30.40:443 via ofmpub.epa.gov token abc123'), { code: 'ECONNRESET' })) =>
  withCause(new TypeError(msg), cause);
const json = (status, body) => ({ status, ok: status === 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const ROWS = (n, p = 'R') => Array.from({ length: n }, (_, i) => ({ RegistryId: `${p}${i}`, Latitude83: '34.8', Longitude83: '-86.97', FacilityName: `F${i}` }));
const OK = (n = 2) => json(200, { Results: { FRSFacility: ROWS(n) } });
const TOO_BIG = () => json(200, { Results: { Error: { ErrorMessage: 'too many' } } });
const R429 = () => ({ status: 429, ok: false, headers: { get: () => null }, text: async () => 'limit' });
const R503 = () => ({ status: 503, ok: false, headers: { get: () => null }, text: async () => '' });
const BODY_FAIL = () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => { throw new TypeError('error reading a body from connection'); } });
const BAD_JSON = () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => '{"Results": {"FRSFacility": [ {"RegistryId": "1"' });
// a response whose status getter throws: an error after headers arrived but before any body read
const AFTER_HEADERS = () => ({ get status() { throw new TypeError('response object unusable'); }, headers: { get: () => null }, text: async () => '' });
const TIMEOUT = () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };

const scripted = (steps) => { let i = 0; const calls = []; return { calls, f: async (url) => { calls.push(url); const s = steps[Math.min(i++, steps.length - 1)]; return s(); } }; };
const box = { xmin: -86.97, ymin: 34.80, xmax: -86.96, ymax: 34.81 };
// large enough that its circle (about 4.3 mi) can be split into quarters above the 0.25 mi floor
const bigBox = { xmin: -87.0, ymin: 34.75, xmax: -86.9, ymax: 34.85 };
const recordSleeps = () => { const waits = []; return { waits, sleep: async (ms) => { waits.push(ms); } }; };
const ENTRY_KEYS = 'stage,name,kind,code,os_error,ms';

// ── 1. stage attribution: fetch / after_headers / body_read / parse ───────────────────────────
{
  const a = await F.frsAt(34.8, -86.97, 1, async () => { throw netError(); }, 30000);
  ok(a.why === 'TypeError', '1a. a connection error before headers keeps why = "TypeError" (the failures label is unchanged)', JSON.stringify(a));
  ok(a.diag?.stage === 'fetch' && a.diag.kind === 'connection_reset' && a.diag.code === 'ECONNRESET' && a.diag.os_error === 104,
    '1b. ... recorded as stage fetch, kind connection_reset, code ECONNRESET, os_error 104', JSON.stringify(a.diag));
  const h = await F.frsAt(34.8, -86.97, 1, async () => AFTER_HEADERS(), 30000);
  ok(h.diag?.stage === 'after_headers' && h.why === 'TypeError', '1c. an error after the response arrived but before reading the body is stage after_headers', JSON.stringify(h));
  const b = await F.frsAt(34.8, -86.97, 1, async () => BODY_FAIL(), 30000);
  ok(b.why === 'TypeError' && b.diag?.stage === 'body_read' && b.diag.kind === 'unknown', '1d. an error while reading the body is stage body_read (kind not guessed from wording it does not match)', JSON.stringify(b));
  const p = await F.frsAt(34.8, -86.97, 1, async () => BAD_JSON(), 30000);
  ok(p.why === 'SyntaxError' && p.diag?.stage === 'parse' && p.diag.kind === 'invalid_json', '1e. a body that is not valid JSON is stage parse, kind invalid_json, not a network failure', JSON.stringify(p));
  const t = await F.frsAt(34.8, -86.97, 1, async () => TIMEOUT(), 30000);
  ok(t.why === 'TimeoutError' && t.diag?.stage === 'fetch' && t.diag.kind === 'timeout', '1f. a timeout stays TimeoutError, stage fetch, kind timeout', JSON.stringify(t));
  ok(typeof a.diag?.ms === 'number' && a.diag.ms >= 0, '1g. the attempt duration is recorded in ms');
  const kinds = [
    ['connection closed before message completed', 'connection_closed'],
    ['dns error: failed to lookup address information', 'dns'],
    ['invalid peer certificate: UnknownIssuer', 'tls'],
    ['Connection refused (os error 111)', 'connection_refused'],
    ['something nobody has seen', 'unknown'],
  ];
  for (const [m, k] of kinds) {
    const d = F.errorDiag(withCause(new TypeError('fetch failed'), new Error(m)), 'fetch', 1);
    ok(d.kind === k, `1h. "${m}" classifies as ${k}`, JSON.stringify(d));
  }
}

// ── 2. replies that did not throw carry NO diag (the attempt object is exactly what it was) ─────
{
  const shapes = [
    ['ok', OK(1), { ok: true, tooBig: false, schema: false, rows: ROWS(1) }],
    ['429', R429(), { ok: false, tooBig: false, schema: false, rows: [], why: '429' }],
    ['too big', TOO_BIG(), { ok: false, tooBig: true, schema: false, rows: [] }],
    ['schema', json(200, { nope: 1 }), { ok: false, tooBig: false, schema: true, rows: [] }],
  ];
  for (const [label, reply, expected] of shapes) {
    const a = await F.frsAt(34.8, -86.97, 1, async () => reply, 30000);
    ok(eq(a, expected), `2. a ${label} reply returns exactly the pre-patch attempt (no diag key)`, JSON.stringify(a));
  }
}

// ── 3. bounded entries and UTF-8 bytes, including Unicode and JSON-escaping inputs ─────────────
{
  const nasty = [
    'x'.repeat(20000) + SECRET_URL,
    '东京 データ 🚧🚧🚧 ' + '😀'.repeat(5000),
    '"quoted" \\ back\\slash \n newline \t tab \u0000 nul   sep ' + '"'.repeat(5000),
  ];
  let k = 0;
  const huge = () => { const m = nasty[k++ % nasty.length]; throw withCause(new TypeError(m), Object.assign(new Error(m), { code: m })); };
  // first circle: error, error, too big (split into 4); each child: error, error, ok → 2 + 8 = 10 thrown errors.
  const steps = [huge, huge, TOO_BIG, ...Array.from({ length: 4 }, () => [huge, huge, () => OK(1)]).flat()];
  const out = await Z.frsZipCoverage(bigBox, scripted(steps).f, { sleep: async () => {} });
  ok(out.ok === true, '3a. the read itself still completes', JSON.stringify({ ok: out.ok, reason: out.reason }));
  ok(Array.isArray(out.diag) && out.diag.length > 0, '3a2. large or hostile error text still yields entries (fixed values are always small)', JSON.stringify(out.diag));
  out.diag = out.diag ?? [];
  ok(out.diag.length <= Z.DIAG_MAX, `3b. 10 thrown errors keep at most DIAG_MAX (${Z.DIAG_MAX}) entries (${out.diag.length})`);
  const b = bytes(out.diag);
  ok(b <= Z.DIAG_MAX_BYTES, `3c. the diag array is at most DIAG_MAX_BYTES (${Z.DIAG_MAX_BYTES}) UTF-8 bytes once serialized (${b})`);
  ok(/^[\x20-\x7e]*$/.test(JSON.stringify(out.diag)), '3d. the serialized record is plain ASCII: no input text, Unicode or escape sequence reaches it');
  ok(out.diag.every((d) => Object.keys(d).join(',') === ENTRY_KEYS + ',attempt,since_prev_ms'), '3e. every entry has exactly the fixed fields');
  ok(out.diag.every((d) => d.code === null), '3f. a "code" that is not errno-shaped is dropped, not copied');
  // the budget is enforced, not estimated: an over-large entry is refused and the list is unchanged
  const list = [];
  const big = { stage: 'fetch', name: 'TypeError', kind: 'unknown', code: 'E' + 'X'.repeat(5000), os_error: null, ms: 1, attempt: 1, since_prev_ms: null };
  ok(Z.pushDiag(list, big) === false && list.length === 0, '3g. pushDiag refuses an entry that would exceed DIAG_MAX_BYTES');
  const small = { stage: 'fetch', name: 'TypeError', kind: 'timeout', code: null, os_error: null, ms: 1, attempt: 1, since_prev_ms: null };
  for (let i = 0; i < 20; i++) Z.pushDiag(list, { ...small, attempt: i + 1 });
  ok(list.length === Z.DIAG_MAX && bytes(list) <= Z.DIAG_MAX_BYTES, `3h. pushDiag stops at DIAG_MAX entries and stays within the byte budget (${bytes(list)} bytes)`);
  const multi = { ...small, code: 'É'.repeat(10) };
  ok(Z.jsonBytes(multi) === new TextEncoder().encode(JSON.stringify(multi)).length && Z.jsonBytes(multi) > JSON.stringify(multi).length,
    '3i. jsonBytes counts UTF-8 bytes, not string length (a 2-byte character counts twice)');
}

// ── 4. privacy: no free-form text from an error can reach the record ──────────────────────────
{
  const leaks = [
    `error sending request for url (${SECRET_URL})`,
    '{"lat":34.8036,"lng":-86.9707,"address":"123 Main St","apikey":"SECRET123"}',
    'failed near 34.8036,-86.9707 / -86.9707 34.8036 (N34°48\'13" W86°58\'14")',
    'connect to 10.20.30.40:443 and [2606:4700:4700::1111]:443 failed',
    'lookup ofmpub.epa.gov / internal-host.corp / localhost failed',
    'Authorization: Bearer eyJhbGciOi.secret.sig; token=abc123; user@example.com',
  ];
  for (const m of leaks) {
    const d = F.errorDiag(withCause(new TypeError(m), Object.assign(new Error(m), { code: m, name: m })), 'fetch', 5);
    const flat = JSON.stringify(Object.values(d));  // values only: field names are fixed and not under test
    const words = m.match(/[A-Za-z0-9]{3,}/g) ?? [];
    const leaked = words.filter((w) => flat.includes(w) && !['TypeError', 'fetch'].includes(w) && !d.kind.includes(w.toLowerCase()));
    ok(leaked.length === 0 && Object.keys(d).join(',') === ENTRY_KEYS, `4. nothing from ${JSON.stringify(m.slice(0, 40))} appears in the record → ${flat}`, 'leaked: ' + leaked.join(', '));
  }
  const weird = Object.assign(new Error('x'), { name: 'EvilName https://host.example/?k=v' });
  ok(F.errorDiag(weird, 'fetch', 1).name === 'other', '4. an error name outside the allowlist is recorded as "other"');
  ok(F.errorDiag('a thrown string with 34.8036', 'fetch', 1).kind === 'unknown', '4. a thrown non-Error value records no text');
  ok(F.errorDiag(withCause(new TypeError('x'), new Error('os error 104')), 'fetch', 1).os_error === 104 &&
     F.errorDiag(withCause(new TypeError('x'), new Error('os error 34803600')), 'fetch', 1).os_error === null,
    '4. os_error keeps a short errno number only (a long number such as a coordinate is not taken)');
}

// ── 5. no change to retry decisions, completeness or failures ─────────────────────────────────
{
  const scenarios = [
    ['two errors then ok', (e) => [e, e, () => OK(3)]],
    ['three errors', (e) => [e, e, e]],
    ['error, too big, then 4 ok children', (e) => [e, TOO_BIG, () => OK(1), () => OK(1), () => OK(1), () => OK(1)]],
    ['429, 429, error (the production shape)', (e) => [R429, R429, e]],
  ];
  for (const [label, build] of scenarios) {
    const sa = recordSleeps(), sb = recordSleeps();
    const A = scripted(build(() => { throw netError(); }));
    const B = scripted(build(R503));
    const oa = await Z.frsZipCoverage(bigBox, A.f, { sleep: sa.sleep });
    const ob = await Z.frsZipCoverage(bigBox, B.f, { sleep: sb.sleep });
    const strip = (o) => { const { diag, failures, ...rest } = o; return { ...rest, failures: failures.map((f) => f.replace(/:(TypeError|503)$/, ':X')) }; };
    ok(eq(strip(oa), strip(ob)), `5. ${label}: outcome (ok, reason, attempts, tiles, rows, failures) identical to the non-throwing path`, JSON.stringify([strip(oa), strip(ob)]));
    ok(eq(sa.waits, sb.waits) && eq(A.calls, B.calls), `5. ${label}: the same waits and the same requests`, JSON.stringify([sa.waits, sb.waits]));
    ok(oa.failures.every((f) => /^[0-9.]+:[A-Za-z0-9_]+$/.test(f)), `5. ${label}: failures keep the "<radius>:<label>" form`, JSON.stringify(oa.failures));
  }
  let reads = 0; const clock = () => { reads++; return 1_000_000; };
  await Z.frsZipCoverage(box, scripted([() => { throw netError(); }, () => OK(1)]).f, { sleep: async () => {}, now: clock, deadlineAt: 2_000_000 });
  let readsB = 0; const clockB = () => { readsB++; return 1_000_000; };
  await Z.frsZipCoverage(box, scripted([R503, () => OK(1)]).f, { sleep: async () => {}, now: clockB, deadlineAt: 2_000_000 });
  // main reads it 3 times here: the deadline check before each of the 2 requests, and once before the retry wait.
  ok(reads === 3 && readsB === 3, `5. the injected clock is read exactly as on main: 3 times with or without a thrown error (${reads}, ${readsB})`);
  const plain = await Z.frsZipCoverage(box, scripted([() => OK(2)]).f, { sleep: async () => {} });
  ok(Object.keys(plain).join(',') === 'ok,rows,reason,attempts,failures,tiles,cover_radius_mi,raw_rows', '5. a read without thrown errors has no diag key (byte-identical response object)', Object.keys(plain).join(','));
  const addr = await F.frsFacilities(34.8, -86.97, 3, scripted([() => { throw netError(); }, () => OK(2)]).f, { sleep: async () => {} });
  ok(!('diag' in addr) && addr.ok === true, '5. address mode (frsFacilities) returns no diag and decides as before', JSON.stringify(Object.keys(addr)));
  // a parse failure is still a transient, retried exactly as before (the why label is unchanged: SyntaxError)
  const sp = recordSleeps();
  const op = await Z.frsZipCoverage(box, scripted([BAD_JSON, () => OK(1)]).f, { sleep: sp.sleep });
  ok(op.ok && eq(op.failures, [`${Z.circumCircle(box).radiusMi}:SyntaxError`]) && eq(sp.waits, [2000]), '5. a parse failure is retried as before, labelled SyntaxError', JSON.stringify([op.failures, sp.waits]));
}

// ── 6. compatibility with consumers of the response's epa object ──────────────────────────────
{
  const idx = readFileSync(join(FN, 'index.ts'), 'utf8');
  const base = idx.match(/const base = \{ mode: "zip_boundary",[^\n]*\n/)?.[0] ?? '';
  ok(/raw_rows: out\.raw_rows, \.\.\.\(out\.diag \? \{ diag: out\.diag \} : \{\}\) \};/.test(base), '6a. index.ts adds diag to the epa object only when present, after every existing field', base.trim());
  // The database reads exactly one key of the response's epa object: ok (dev_epa_write_refused,
  // dev_facility_read_untrusted, as (j->'epa'->>'ok')::boolean). The engine reads epa.ok (planes.ts, echo-cwa.ts).
  const epa = { ok: false, radius_used: null, reason: 'transient', mode: 'zip_boundary', attempts: 3, failures: ['1:429', '1:429', '1:TypeError'], tiles: 0, cover_radius_mi: 1, raw_rows: 0, diag: [{ stage: 'fetch', name: 'TypeError', kind: 'connection_reset', code: 'ECONNRESET', os_error: 104, ms: 3, attempt: 3, since_prev_ms: 5000 }], pre_cap: 0, kept: 0 };
  const back = JSON.parse(JSON.stringify({ epa }));
  ok(back.epa.ok === false && typeof back.epa.ok === 'boolean', '6b. epa.ok survives serialization unchanged');
  for (const f of ['sources/planes.ts', 'sources/echo-cwa.ts']) {
    const src = readFileSync(join(FN, f), 'utf8');
    ok(!/\bdiag\b/.test(src), `6c. ${f} does not read diag`);
  }
  const zipSrc = readFileSync(join(FN, 'sources/epa-frs-zip.ts'), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  const decisions = zipSrc.split('\n').filter((l) => /\bdiag\b/.test(l) && /\bif\b|return fail|\bbreak\b|answered =/.test(l));
  ok(decisions.length === 1 && /if \(a\.diag\) pushDiag\(diag,/.test(decisions[0]), '6d. the only branch on diag is the one that records it', decisions.join(' | '));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
