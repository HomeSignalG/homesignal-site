// A DENSE ZIP STARTS THE EPA LADDER WHERE ITS STORED, CAPPED LIST ALREADY FITS (2026-10-18).
//
// Measured on 2026-10-18, through the deployed engine: ZIP 98421 (Tacoma) spent
// "3:process_limit","2:process_limit" before 1.5 mi answered, and ZIP 98402 spent
// "3:process_limit","2:process_limit","1.5:process_limit" and then got "1:429" three times, so its
// facility layer stayed stale. About half of single EPA probes failed that day, so every wasted
// request is another chance to fail. The refresh now passes `frs_start_mi`
// (public.dev_frs_start_mi): the ladder rung the ZIP's stored list of 40 (the cap) fits inside.
//
// What this file proves, driving the shipped module with a mocked FRS:
//   1. frsStartRung honours only a ladder rung strictly below the requested radius.
//   2. With a start rung the ladder skips the larger rungs (fewer requests), and still walks down.
//   3. The never-shrink-on-transient and never-a-false-zero rules are unchanged under a hint.
//   4. index.ts runs the full ladder again when the hinted answer is not provably complete.
//
// Run: node test/epa-frs-start-rung.test.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN = join(root, 'supabase/functions/get-address-report');
const { frsFacilities, frsStartRung, frsRadii } = await import(join(FN, 'sources/epa-frs.ts'));

let fails = 0;
const ok = (cond, name, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (!cond && detail ? '\n     ' + detail : ''));
  if (!cond) fails++;
};

const body = (rows) => JSON.stringify({ Results: { FRSFacility: rows } });
const PROCESS_LIMIT = JSON.stringify({
  Results: { Error: { ErrorMessage: 'Process Limit would be exceeded - please make search parmeters more selective!' } },
});
const FAC = { RegistryId: '110070707401', FacilityName: 'ACME STEEL PLANT', Latitude83: '47.25', Longitude83: '-122.44' };
const res = (status, text) => ({ status, headers: { get: () => null }, text: () => Promise.resolve(text) });
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
const noSleep = { sleep: () => Promise.resolve() };

// ── 1. frsStartRung ───────────────────────────────────────────────────────────────────────────
ok(frsStartRung(1.5, 3) === 1.5, '1a. a smaller rung is honoured');
ok(frsStartRung('1', 3) === 1, '1b. a numeric string rung is honoured (jsonb numbers arrive as numbers or strings)');
ok(frsStartRung(3, 3) === undefined, '1c. the requested radius itself is no hint');
ok(frsStartRung(5, 3) === undefined, '1d. a rung above the requested radius is ignored');
ok(frsStartRung(1.2, 3) === undefined, '1e. a value that is not a ladder rung is ignored');
ok(frsStartRung(null, 3) === undefined && frsStartRung(undefined, 3) === undefined, '1f. null / absent = no hint');
ok(frsStartRung('abc', 3) === undefined && frsStartRung(-1, 3) === undefined, '1g. garbage = no hint');
ok(frsStartRung(0.25, 3) === 0.25, '1h. the smallest rung is honoured');
ok(JSON.stringify(frsRadii(3)) === '[3,2,1.5,1,0.5,0.25]', '1i. the ladder itself is unchanged');

// ── 2. the ladder starts at the hint ──────────────────────────────────────────────────────────
{
  // 98402's shape: 3, 2 and 1.5 all exceed the process limit; 1 answers.
  const f = recorder((rad) => res(200, rad > 1 ? PROCESS_LIMIT : body([FAC])));
  const plain = await frsFacilities(47.25, -122.44, 3, f, noSleep);
  ok(plain.ok && plain.radius_used === 1 && JSON.stringify(f.seen) === '[3,2,1.5,1]',
    '2a. control: without a hint the ladder walks 3 → 2 → 1.5 → 1 (4 requests)', JSON.stringify(f.seen));
  const g = recorder((rad) => res(200, rad > 1 ? PROCESS_LIMIT : body([FAC])));
  const hinted = await frsFacilities(47.25, -122.44, 3, g, { ...noSleep, startMi: 1 });
  ok(hinted.ok && hinted.radius_used === 1 && JSON.stringify(g.seen) === '[1]',
    '2b. with start 1 it asks once, at 1', JSON.stringify(g.seen));
  const h = recorder((rad) => res(200, rad > 0.5 ? PROCESS_LIMIT : body([FAC])));
  const deeper = await frsFacilities(47.25, -122.44, 3, h, { ...noSleep, startMi: 1 });
  ok(deeper.ok && deeper.radius_used === 0.5 && JSON.stringify(h.seen) === '[1,0.5]',
    '2c. a hinted rung that now exceeds the limit still walks down', JSON.stringify(h.seen));
  const k = recorder(() => res(200, body([FAC])));
  const ignored = await frsFacilities(47.25, -122.44, 3, k, { ...noSleep, startMi: 1.2 });
  ok(ignored.radius_used === 3 && JSON.stringify(k.seen) === '[3]', '2d. an invalid hint is ignored (full ladder)');
}

// ── 3. the rules that must not move ───────────────────────────────────────────────────────────
{
  const f = recorder(() => res(429, ''));
  const out = await frsFacilities(47.25, -122.44, 3, f, { ...noSleep, startMi: 1 });
  ok(!out.ok && out.reason === 'transient' && JSON.stringify(f.seen) === '[1,1,1]',
    '3a. transient at the hinted rung: three tries at THAT rung, then no answer (never shrinks)', JSON.stringify(f.seen));
  const g = recorder(() => res(200, body([])));
  const z = await frsFacilities(47.25, -122.44, 3, g, { ...noSleep, startMi: 1 });
  ok(!z.ok && z.reason === 'partial_scope', '3b. a zero at the hinted (smaller) circle is partial_scope, never a zero');
}

// ── 4. index.ts wiring ────────────────────────────────────────────────────────────────────────
{
  const src = readFileSync(join(FN, 'index.ts'), 'utf8');
  ok(/const frsStart = frsStartRung\(body\.frs_start_mi, zipRadius\);/.test(src), '4a. ZIP mode reads frs_start_mi through frsStartRung');
  ok(/facilitySites\(clat, clng, zipRadius, deadlineAt, frsStart\)/.test(src), '4b. ZIP mode passes the hint to facilitySites');
  ok(/facilitySites\(lat, lng, radiusMi, deadlineAt\)/.test(src), '4c. address mode takes no hint');
  ok(/outcome\.ok && kept\.length < MAX_FACILITIES\) \|\| outcome\.reason === "partial_scope"/.test(src),
    '4d. a hinted answer short of the cap, or a smaller-circle zero, runs the full ladder');
  ok(/frsFacilities\(homeLat, homeLng, radiusMi, undefined, \{ deadlineAt \}\)/.test(src),
    '4e. the fallback is the full ladder (no hint) inside the same deadline');
  ok(/hint_fallback: hintFallback/.test(src) && /start_mi: startMi \?\? null/.test(src), '4f. the outcome records the hint and the fallback');
}

// ── 5. the SQL hint ───────────────────────────────────────────────────────────────────────────
{
  const sql = readFileSync(join(root, 'docs/dev-frs-start-hint.sql'), 'utf8');
  ok(/>= 40/.test(sql), '5a. the hint applies only to a stored list at the cap (40 = MAX_FACILITIES)');
  ok(/array\[0\.25, 0\.5, 1, 1\.5, 2\]/.test(sql), '5b. the SQL rungs are the engine ladder below 3 mi');
  ok(/'frs_start_mi', public\.dev_frs_start_mi\(r\.zip\)/.test(sql), '5c. the fire functions pass the hint');
  ok(/d\.facilities_refreshed_at\)/.test(sql), '5d. the EPA write guard judges freshness by the facility clock');
  const idx = readFileSync(join(FN, 'index.ts'), 'utf8');
  ok(/const MAX_FACILITIES = 40;/.test(idx), '5e. MAX_FACILITIES is still 40, matching the SQL cap');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
