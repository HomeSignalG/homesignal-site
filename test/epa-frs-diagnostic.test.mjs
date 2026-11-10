// FRS error diagnostics (2026-11-10, DIAGNOSTIC ONLY).
// After get-address-report v313, the third FRS attempt after two 429s started failing with a bare
// "TypeError" (32 of 92 such reads, against 0 of 626 before). The engine stored only the error's name, so
// the mechanism could not be identified. This patch records a sanitized description of each thrown error.
// These tests pin that it is diagnostic only: retry decisions, completeness, `failures` and every field a
// consumer reads are unchanged; the record is bounded; nothing request-identifying can reach it.
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

// ── fake FRS replies ─────────────────────────────────────────────────────────────────────────
const SECRET_URL = 'https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities?latitude83=34.803600&longitude83=-86.970700&search_radius=3&output=JSON&apikey=SECRET123';
const netError = (msg = `error sending request for url (${SECRET_URL})`) => {
  const e = new TypeError(msg);
  e.cause = Object.assign(new Error('Connection reset by peer (os error 104) at 10.20.30.40:443 via ofmpub.epa.gov token abc123'), { code: 'ECONNRESET' });
  return e;
};
const json = (status, body) => ({ status, ok: status === 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const ROWS = (n, p = 'R') => Array.from({ length: n }, (_, i) => ({ RegistryId: `${p}${i}`, Latitude83: '34.8', Longitude83: '-86.97', FacilityName: `F${i}` }));
const OK = (n = 2) => json(200, { Results: { FRSFacility: ROWS(n) } });
const TOO_BIG = () => json(200, { Results: { Error: { ErrorMessage: 'too many' } } });
const R429 = () => ({ status: 429, ok: false, headers: { get: () => null }, text: async () => 'limit' });
const BODY_FAIL = () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => { throw new TypeError('error reading a body from connection'); } });
const TIMEOUT = () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };

/** A fetch that plays a script of outcomes in order; each entry is a function returning a reply or throwing. */
const scripted = (steps) => { let i = 0; const calls = []; return { calls, f: async (url) => { calls.push(url); const s = steps[Math.min(i++, steps.length - 1)]; return s(); } }; };
const box = { xmin: -86.97, ymin: 34.80, xmax: -86.96, ymax: 34.81 };
// large enough that its circle (about 4.3 mi) can be split into quarters above the 0.25 mi floor
const bigBox = { xmin: -87.0, ymin: 34.75, xmax: -86.9, ymax: 34.85 };
const recordSleeps = () => { const waits = []; return { waits, sleep: async (ms) => { waits.push(ms); } }; };

// ── 1. thrown before response headers vs. during body reading ────────────────────────────────
{
  const a = await F.frsAt(34.8, -86.97, 1, async () => { throw netError(); }, 30000);
  ok(a.why === 'TypeError', '1a. a connection error before headers keeps why = "TypeError" (the failures label is unchanged)', JSON.stringify(a));
  ok(a.diag?.stage === 'fetch', '1b. ... and is recorded as stage "fetch"', JSON.stringify(a.diag));
  ok(/ECONNRESET: Connection reset by peer \(os error 104\)/.test(a.diag?.cause ?? ''), '1c. ... with the underlying network reason as the cause', a.diag?.cause);
  const b = await F.frsAt(34.8, -86.97, 1, async () => BODY_FAIL(), 30000);
  ok(b.why === 'TypeError' && b.diag?.stage === 'body', '1d. an error while reading the body is TypeError, stage "body"', JSON.stringify(b));
  ok(b.diag?.msg === 'error reading a body from connection', '1e. ... with the runtime message kept', b.diag?.msg);
  const c = await F.frsAt(34.8, -86.97, 1, async () => TIMEOUT(), 30000);
  ok(c.why === 'TimeoutError' && c.diag?.stage === 'fetch', '1f. a timeout stays "TimeoutError", stage "fetch"', JSON.stringify(c));
  ok(typeof a.diag?.ms === 'number' && a.diag.ms >= 0, '1g. the attempt duration is recorded in ms');
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

// ── 3. bounded entry count and serialized size, under adversarial messages ─────────────────────
{
  // first circle: error, error, too big (split into 4); each child: error, error, ok → 2 + 8 = 10 thrown errors.
  const huge = () => { throw netError('x'.repeat(20000) + SECRET_URL); };
  const steps = [huge, huge, TOO_BIG, ...Array.from({ length: 4 }, () => [huge, huge, () => OK(1)]).flat()];
  const s = scripted(steps);
  const out = await Z.frsZipCoverage(bigBox, s.f, { sleep: async () => {} });
  ok(out.ok === true && out.diag?.length === Z.DIAG_MAX, `3a. 10 thrown errors keep exactly DIAG_MAX (${Z.DIAG_MAX}) entries; the read itself still completes`, JSON.stringify({ ok: out.ok, n: out.diag?.length, reason: out.reason }));
  const bytes = JSON.stringify(out.diag).length;
  ok(bytes <= 3000, `3b. the whole diag record serializes to <= 3,000 bytes (${bytes})`);
  ok(out.diag.every((d) => d.msg.length <= 100 && (d.cause ?? '').length <= 100 && d.name.length <= 40), '3c. every message and cause is capped at 100 characters, the name at 40');
  ok(out.diag.map((d) => d.attempt).join(',') === '1,2,4,5,7,8,10,11', '3d. entries name the attempt they came from (the first 8 thrown, in order)', out.diag.map((d) => d.attempt).join(','));
}

// ── 4. redaction ─────────────────────────────────────────────────────────────────────────────
{
  const cases = [
    [`error sending request for url (${SECRET_URL})`, ['ofmpub', 'epa.gov', '34.8036', '86.9707', 'SECRET123', 'search_radius=3']],
    ['latitude83=34.803600&longitude83=-86.970700&apikey=SECRET123', ['34.8036', '86.9707', 'SECRET123']],
    ['connect to 10.20.30.40:443 failed', ['10.20.30.40']],
    ['connect to [2606:4700:4700::1111]:443 failed', ['2606:4700']],
    ['dns error: failed to lookup address information for ofmpub.epa.gov', ['ofmpub', 'epa.gov']],
    ['host api.example.co.uk:8443 refused', ['example']],
    ['Authorization: Bearer eyJhbGciOi.secret.sig', ['eyJhbGciOi']],
    ['token abc123 rejected', ['abc123']],
  ];
  for (const [input, forbidden] of cases) {
    const out = F.sanitizeErrorText(input);
    const leaked = forbidden.filter((x) => out.includes(x));
    ok(leaked.length === 0, `4. redacts ${JSON.stringify(input.slice(0, 50))} → ${JSON.stringify(out)}`, 'leaked: ' + leaked.join(', '));
  }
  ok(F.sanitizeErrorText('Connection reset by peer (os error 104)') === 'Connection reset by peer (os error 104)', '4. the runtime wording itself is kept');
  const a = await F.frsAt(34.8, -86.97, 1, async () => { throw netError(); }, 30000);
  const flat = JSON.stringify(a.diag);
  ok(!/epa\.gov|ofmpub|34\.8|86\.97|SECRET|10\.20|abc123/.test(flat), '4. a real attempt\'s diag carries no URL, host, coordinate, key, IP or token', flat);
}

// ── 5. no change to retry decisions, completeness or failures ─────────────────────────────────
// Each scenario runs twice: once with THROWN errors (which now produce diag) and once with the same
// sequence as 503 replies (which never did). Everything but the failure label and diag must match.
{
  const scenarios = [
    ['two errors then ok', (e) => [e, e, () => OK(3)]],
    ['three errors', (e) => [e, e, e]],
    ['error, too big, then 4 ok children', (e) => [e, TOO_BIG, () => OK(1), () => OK(1), () => OK(1), () => OK(1)]],
    ['429, 429, error (the production shape)', (e) => [R429, R429, e]],
  ];
  const R503 = () => ({ status: 503, ok: false, headers: { get: () => null }, text: async () => '' });
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
  // an injected clock sees exactly the same reads: diag timing uses its own clock.
  let reads = 0; const clock = () => { reads++; return 1_000_000; };
  await Z.frsZipCoverage(box, scripted([() => { throw netError(); }, () => OK(1)]).f, { sleep: async () => {}, now: clock, deadlineAt: 2_000_000 });
  let readsB = 0; const clockB = () => { readsB++; return 1_000_000; };
  await Z.frsZipCoverage(box, scripted([R503, () => OK(1)]).f, { sleep: async () => {}, now: clockB, deadlineAt: 2_000_000 });
  // main reads it 3 times here: the deadline check before each of the 2 requests, and once before the retry wait.
  ok(reads === 3 && readsB === 3, `5. the injected clock is read exactly as on main: 3 times with or without a thrown error (${reads}, ${readsB})`);
  // a read with no thrown error has exactly the pre-patch keys, in order
  const plain = await Z.frsZipCoverage(box, scripted([() => OK(2)]).f, { sleep: async () => {} });
  ok(Object.keys(plain).join(',') === 'ok,rows,reason,attempts,failures,tiles,cover_radius_mi,raw_rows', '5. a read without thrown errors has no diag key (byte-identical response object)', Object.keys(plain).join(','));
  // address mode ignores it entirely
  const addr = await F.frsFacilities(34.8, -86.97, 3, scripted([() => { throw netError(); }, () => OK(2)]).f, { sleep: async () => {} });
  ok(!('diag' in addr) && addr.ok === true, '5. address mode (frsFacilities) returns no diag and decides as before', JSON.stringify(Object.keys(addr)));
}

// ── 6. compatibility with consumers of the response's epa object ──────────────────────────────
{
  const idx = readFileSync(join(FN, 'index.ts'), 'utf8');
  const base = idx.match(/const base = \{ mode: "zip_boundary",[^\n]*\n/)?.[0] ?? '';
  ok(/raw_rows: out\.raw_rows, \.\.\.\(out\.diag \? \{ diag: out\.diag \} : \{\}\) \};/.test(base), '6a. index.ts adds diag to the epa object only when present, after every existing field', base.trim());
  // The database reads exactly one key of the response's epa object: ok (dev_epa_write_refused,
  // dev_facility_read_untrusted, as (j->'epa'->>'ok')::boolean). The engine reads epa.ok (planes.ts,
  // echo-cwa.ts). A JSON round trip with diag present leaves ok a boolean.
  const epa = { ok: false, radius_used: null, reason: 'transient', mode: 'zip_boundary', attempts: 3, failures: ['1:429', '1:429', '1:TypeError'], tiles: 0, cover_radius_mi: 1, raw_rows: 0, diag: [{ stage: 'fetch', name: 'TypeError', cause: 'x', msg: 'fetch failed', ms: 3, attempt: 3, since_prev_ms: 5000 }], pre_cap: 0, kept: 0 };
  const back = JSON.parse(JSON.stringify({ epa }));
  ok(back.epa.ok === false && typeof back.epa.ok === 'boolean', '6b. epa.ok survives serialization unchanged');
  for (const f of ['sources/planes.ts', 'sources/echo-cwa.ts']) {
    const src = readFileSync(join(FN, f), 'utf8');
    ok(!/\bdiag\b/.test(src), `6c. ${f} does not read diag`);
  }
  const zipSrc = readFileSync(join(FN, 'sources/epa-frs-zip.ts'), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  const decisions = zipSrc.split('\n').filter((l) => /\bdiag\b/.test(l) && /\bif\b|return fail|\bbreak\b|answered =/.test(l));
  ok(decisions.length === 1 && /if \(a\.diag && diag\.length < DIAG_MAX\)/.test(decisions[0]), '6d. the only branch on diag is the one that records it', decisions.join(' | '));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
