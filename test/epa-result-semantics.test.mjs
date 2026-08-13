// EPA RESULT SEMANTICS — a failed EPA retrieval must never become an authoritative zero.
//
// WHY THIS FILE EXISTS. Between 2026-08-08 22:15Z and 2026-08-12 02:15Z, EPA FRS refused every
// request (502 / 429 / "Failure when receiving data from the peer"). `frsFacilities()` returned a
// BARE `[]` on total failure — byte-identical to the `[]` a genuinely empty rural ZIP produces —
// so the report emitted `counts.facilities: 0` and the cache stored it. Measured in production:
//
//   hour before the window   ~90% of refreshed rows carried facilities
//   INSIDE the window        0.0% — 515 rows, 515 of them zero, no exceptions
//   hour after recovery      ~90% again
//
// 515 consecutive genuine zeros against a ~10% base rate is not a thing that happens. Those were
// false zeros, and nothing in the data could prove it at the time — which is the actual defect.
//
// These checks DRIVE THE SHIPPED MODULE (`sources/epa-frs.ts`) with a mocked fetch, one case per
// failure class, so a regression fails here rather than in production three days later.
//
// Run: node test/epa-result-semantics.test.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = join(root, 'supabase/functions/get-address-report/sources/epa-frs.ts');

// The module is TypeScript. Node >= 22.6 strips types on import, so these checks run the SHIPPED
// code rather than a copy. Fail loudly on an older runtime — a green run must mean something.
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 6)) {
  console.error(`FAIL — node ${process.versions.node} cannot strip TS types; need >= 22.6`);
  process.exit(1);
}

const { frsFacilities, frsRadii } = await import(MOD);

let fails = 0;
const ok = (cond, name, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (!cond && detail ? '\n     ' + detail : ''));
  if (!cond) fails++;
};

// ── fetch doubles, one per FRS behaviour ──────────────────────────────────────────────────────
const body = (rows) => JSON.stringify({ Results: { FRSFacility: rows } });
const PROCESS_LIMIT = JSON.stringify({
  Results: { Error: { ErrorMessage: 'Process Limit would be exceeded - please make search parmeters more selective!' } },
});
const FACILITY = { RegistryId: '110070707401', FacilityName: 'ACME STEEL PLANT', Latitude83: '41.5', Longitude83: '-112.0' };
// Real FRS payloads carry unescaped backslashes in facility names — the v13 parse defect.
const INVALID_JSON_FROM_FRS = '{"Results":{"FRSFacility":[{"FacilityName":"BAD\\NAME CO","RegistryId":"1","Latitude83":"41.5","Longitude83":"-112.0"}]}}'.replace('\\\\N', '\\N');

const res = (status, text) => ({ status, text: () => Promise.resolve(text) });
/** Records every radius requested so back-off order can be asserted, not assumed. */
function recorder(handler) {
  const seen = [];
  const f = (url) => {
    const rad = Number(new URL(url).searchParams.get('search_radius'));
    seen.push(rad);
    return Promise.resolve(handler(rad, seen.filter((r) => r === rad).length));
  };
  f.seen = seen;
  return f;
}

// ── 1. HTTP 200 + relevant facilities → facilities stored, retrieval authoritative ────────────
{
  const f = recorder(() => res(200, body([FACILITY])));
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === true && out.rows.length === 1, '1. HTTP 200 + facilities → ok:true, rows kept',
    `got ok=${out.ok} rows=${out.rows.length}`);
  ok(out.radius_used === 3 && out.attempts === 1, '1b. answered at the first radius, one attempt');
}

// ── 2. HTTP 200 + no facilities → a LEGITIMATE zero, cacheable as zero ────────────────────────
{
  const f = recorder(() => res(200, body([])));
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === true && out.rows.length === 0,
    '2. HTTP 200 + empty → ok:TRUE with zero rows (authoritative zero, not an outage)',
    `got ok=${out.ok}`);
}

// ── 3. HTTP 200 + rows that the caller will filter away → STILL authoritative ─────────────────
// `ok` describes RETRIEVAL. The caller's looksIndustrial() dropping every row is an INTENTIONAL
// filter (St. Louis 63118), and must not be reportable as an EPA failure. This is the check that
// stops a future fix from turning "every zero is suspicious" into the opposite inaccuracy.
{
  const nonIndustrial = [
    { RegistryId: '1', FacilityName: 'BEE WINDOW CO', Latitude83: '38.6', Longitude83: '-90.2' },
    { RegistryId: '2', FacilityName: 'SMITH DENTAL CLINIC', Latitude83: '38.6', Longitude83: '-90.2' },
  ];
  const f = recorder(() => res(200, body(nonIndustrial)));
  const out = await frsFacilities(38.59, -90.23, 3, f);
  ok(out.ok === true && out.rows.length === 2,
    '3. HTTP 200 + rows the caller will filter out → ok:TRUE (filtering is not an outage)',
    `got ok=${out.ok} rows=${out.rows.length}`);
}

// ── 4. timeout / network throw → NOT a zero ───────────────────────────────────────────────────
{
  const f = recorder(() => { throw new Error('The operation was aborted due to timeout'); });
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === false && out.rows.length === 0,
    '4. fetch throws (timeout/DNS/connection) → ok:FALSE, never an authoritative zero',
    `got ok=${out.ok}`);
}

// ── 5. HTTP 500 → NOT a zero ──────────────────────────────────────────────────────────────────
{
  const f = recorder(() => res(500, 'upstream error'));
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === false, '5. HTTP 500 → ok:FALSE', `got ok=${out.ok}`);
  ok(out.reason === 'transient', '5b. 5xx is classified transient (it is retried, not backed off)');
}

// ── 5c. HTTP 429 → NOT a zero. Observed live 2026-08-13 on the atlanta-dense health probe. ────
{
  const f = recorder(() => res(429, 'Too Many Requests'));
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === false, '5c. HTTP 429 rate-limit → ok:FALSE (a refusal to answer, not an answer)');
}

// ── 5d. HTTP 404/403 → NOT a zero ─────────────────────────────────────────────────────────────
{
  for (const code of [403, 404]) {
    const f = recorder(() => res(code, 'nope'));
    const out = await frsFacilities(41.5, -112.0, 3, f);
    ok(out.ok === false, `5d. HTTP ${code} → ok:FALSE (a non-2xx is not "no facilities")`);
  }
}

// ── 6. malformed / unparseable payload → NOT a zero ───────────────────────────────────────────
{
  const f = recorder(() => res(200, '<html>gateway</html>'));
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === false, '6. malformed body (HTML, not JSON) → ok:FALSE', `got ok=${out.ok}`);
}
{
  const f = recorder(() => res(200, ''));
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === false, '6b. empty body → ok:FALSE');
}
{
  // Unexpected schema: valid JSON, no Results envelope. Parsed fine, so retrieval SUCCEEDED and
  // the row list is genuinely empty — an authoritative zero. Pinned so the behaviour is deliberate.
  const f = recorder(() => res(200, JSON.stringify({ SomethingElse: true })));
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === true && out.rows.length === 0,
    '6c. valid JSON with no Results envelope → ok:true, 0 rows (parsed; deliberate)');
}
{
  // The v13 defect: FRS emits invalid JSON escapes. The repair runs BEFORE parse, so this must
  // still succeed — a parse crash here would read as an outage on a perfectly good payload.
  const f = recorder(() => res(200, INVALID_JSON_FROM_FRS));
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === true && out.rows.length === 1,
    '6d. FRS invalid-backslash payload → repaired and parsed, ok:true (v13 defect stays fixed)');
}

// ── 7. process limit then successful back-off → valid smaller-radius result ───────────────────
// Live-confirmed 2026-08-13 for ZIP 63118: r=3 refused, r=1 returned 61 KB of real facilities.
{
  const f = recorder((rad) => (rad > 1 ? res(200, PROCESS_LIMIT) : res(200, body([FACILITY]))));
  const out = await frsFacilities(38.59, -90.23, 3, f);
  ok(out.ok === true && out.rows.length === 1,
    '7. process limit at wide radii + success at r=1 → ok:true with the smaller-radius result');
  ok(out.radius_used === 1, '7b. radius_used reports the radius that actually answered',
    `got ${out.radius_used}`);
  // A process-limit refusal must move to the NEXT radius immediately — retrying it is futile.
  ok(f.seen.filter((r) => r === 3).length === 1,
    '7c. a process-limit refusal is NOT retried at the same radius (back off, do not hammer)',
    `r=3 requested ${f.seen.filter((r) => r === 3).length}x`);
  ok(f.seen.join(',') === '3,2,1.5,1', '7d. back-off descends the declared ladder in order',
    `saw ${f.seen.join(',')}`);
}

// ── 8. process limit at EVERY radius → last-known-good territory, not a zero ───────────────────
{
  const f = recorder(() => res(200, PROCESS_LIMIT));
  const out = await frsFacilities(38.59, -90.23, 3, f);
  ok(out.ok === false && out.reason === 'process_limit',
    '8. process limit at every radius → ok:FALSE (exhausted back-off is a failure, not a zero)',
    `got ok=${out.ok} reason=${out.reason}`);
  ok(f.seen.join(',') === '3,2,1.5,1,0.5,0.25', '8b. every rung of the ladder was tried before giving up',
    `saw ${f.seen.join(',')}`);
}

// ── 9. transient failure then success at the SAME radius → retried, not backed off ────────────
{
  const f = recorder((rad, nth) => (nth < 2 ? res(503, 'busy') : res(200, body([FACILITY]))));
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === true && out.radius_used === 3,
    '9. transient 503 then 200 at the same radius → retried in place, full radius preserved',
    `got ok=${out.ok} radius=${out.radius_used}`);
  ok(out.attempts === 2, '9b. attempts counts the real HTTP tries', `got ${out.attempts}`);
}

// ── 10. THE OUTAGE PATTERN ITSELF — the Aug 8→12 shape cannot produce an authoritative zero ───
// Every radius, every retry, refused. This is precisely what happened for 515 pages.
{
  const f = recorder(() => res(502, 'Bad Gateway'));
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === false,
    '10. the Aug 8→12 outage shape (all requests 502) → ok:FALSE, so no false zero can be cached',
    `got ok=${out.ok}`);
  ok(out.rows.length === 0 && out.radius_used === null,
    '10b. a failed outcome carries no rows and names no radius — nothing to mistake for data');
  // The invariant in one line: rows.length === 0 is only meaningful when ok is true.
  ok(!(out.ok === true && out.rows.length === 0),
    '10c. INVARIANT: a total failure never presents as ok:true with zero rows');
}

// ── 11. the ladder itself ─────────────────────────────────────────────────────────────────────
ok(frsRadii(3).join(',') === '3,2,1.5,1,0.5,0.25', '11. frsRadii(3) is the documented ladder',
  frsRadii(3).join(','));
ok(frsRadii(1).join(',') === '1,0.5,0.25', '11b. a smaller request never widens the search',
  frsRadii(1).join(','));

console.log(fails ? `\n${fails} check(s) failed` : '\nAll EPA result-semantics checks passed');
process.exit(fails ? 1 : 0);
