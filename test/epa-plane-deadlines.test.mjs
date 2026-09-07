// UNIT 4 — THE CORE PROJECT PLANE MUST NOT WAIT ON EPA, AND AN EPA MISS IS NEVER A ZERO.
//
// WHY THIS FILE EXISTS. Both call sites in `get-address-report/index.ts` joined the two Map 1
// planes with `Promise.all([devSites(...), facilitySites(...)])`. `facilitySites` →
// `frsFacilities` walks up to six radii x three attempts, each bounded only by its own 30s fetch
// timeout, so a slow-but-not-refusing FRS could hold a FINISHED core project result for minutes —
// and any overlay rejection would have failed the whole core report. That is the coupling the
// founder's 2026-09-07 decision removes: the core plane is REQUIRED, the EPA overlay is OPTIONAL.
//
// These checks DRIVE THE SHIPPED MODULES (`sources/planes.ts`, `sources/epa-frs.ts`) with mocked
// fetch and INJECTED timers/clock, so the deadline behaviour is proven without waiting for it.
//
// The three facts the job asks to prove, asserted below as §3 and §5:
//   (a) EPA timeout/refusal -> devSites still returns
//   (b) the core type records are present, in full
//   (c) the facility count is UNKNOWN/unavailable (`ok:false`), NOT zero
//
// Run: node test/epa-plane-deadlines.test.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN = join(root, 'supabase/functions/get-address-report');

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 6)) {
  console.error(`FAIL — node ${process.versions.node} cannot strip TS types; need >= 22.6`);
  process.exit(1);
}

const { resolvePlanes, CoreDeadlineError, CORE_DEADLINE_MS, OVERLAY_DEADLINE_MS, OVERLAY_GRACE_MS } =
  await import(join(FN, 'sources/planes.ts'));
const { frsFacilities, frsRadii, FRS_ATTEMPT_TIMEOUT_MS } = await import(join(FN, 'sources/epa-frs.ts'));

let fails = 0;
const ok = (cond, name, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (!cond && detail ? '\n     ' + detail : ''));
  if (!cond) fails++;
};

// ── a controllable clock + timer set, so "45 seconds" costs no wall clock ──────────────────────
function fakeClock() {
  let t = 1_000_000;                       // arbitrary non-zero epoch
  const pending = [];                      // {at, fn, id, cancelled}
  let id = 0;
  return {
    now: () => t,
    timers: {
      setTimeout: (fn, ms) => { const h = { at: t + ms, fn, id: ++id, cancelled: false }; pending.push(h); return h; },
      clearTimeout: (h) => { if (h) h.cancelled = true; },
    },
    /** Advance to `ms` from now, firing every timer due at or before that instant, in order. */
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = pending.filter((h) => !h.cancelled && h.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at; due.cancelled = true; due.fn();
        await new Promise((r) => setImmediate(r));   // let the microtask queue drain
      }
      t = target;
      await new Promise((r) => setImmediate(r));
    },
    pendingCount: () => pending.filter((h) => !h.cancelled).length,
  };
}

/** The exact unavailable shape index.ts ships (`facilitiesUnavailable`). ok:false, never a zero. */
const UNAVAILABLE = (reason) => ({
  sites: [], epa: { ok: false, radius_used: null, reason, attempts: 0, raw_rows: 0, kept: 0 },
});
/** Three real core records, standing in for devSites' output. */
const CORE_RECORDS = [
  { label: 'Rezoning — 12 Elm St', type: 'proposed', url: 'https://county.gov/notice/1' },
  { label: 'Site plan approved — Depot Yard', type: 'approved', url: 'https://county.gov/notice/2' },
  { label: 'Final plat — Wonder Valley', type: 'approved', url: 'https://county.gov/notice/3' },
];
const never = () => new Promise(() => {});   // a promise that never settles: EPA hung

console.log('\n== 1. baseline: both planes answer, nothing is disturbed ==');
{
  const c = fakeClock();
  const p = resolvePlanes({
    core: async () => CORE_RECORDS,
    overlay: async () => ({ sites: [{ registry_id: '110070707401' }], epa: { ok: true, radius_used: 3, reason: null, attempts: 1, raw_rows: 1, kept: 1 } }),
    overlayUnavailable: UNAVAILABLE, now: c.now, timers: c.timers,
  });
  await c.advance(0);
  const out = await p;
  ok(out.core.length === 3, '1a. core records pass through in full', `got ${out.core.length}`);
  ok(out.overlay.epa.ok === true && out.overlay.sites.length === 1, '1b. overlay passes through untouched');
  ok(out.overlay_deadline_missed === false && out.overlay_threw === false, '1c. neither miss flag is set');
  ok(c.pendingCount() === 0, '1d. BOTH timers are cleared — no timer outlives the response',
    `${c.pendingCount()} still pending`);
}

console.log('\n== 2. the planes run CONCURRENTLY, not one after the other ==');
{
  const c = fakeClock();
  let coreStarted = false, overlayStarted = false;
  let coreSawOverlay = null, overlaySawCore = null;
  const p = resolvePlanes({
    core: async () => {
      coreStarted = true;
      await null;                       // yield once, so both factories have been invoked
      coreSawOverlay = overlayStarted;
      return CORE_RECORDS;
    },
    overlay: async () => {
      overlayStarted = true;
      await null;
      overlaySawCore = coreStarted;
      return UNAVAILABLE('error');
    },
    overlayUnavailable: UNAVAILABLE, now: c.now, timers: c.timers,
  });
  await c.advance(0); await p;
  // NEITHER plane's completion gates the other's start. Asserted in BOTH directions, because a
  // one-directional check passes on a sequential join that happens to run them in that order.
  ok(coreSawOverlay === true, '2a. the overlay is in flight while core is still running',
    'the join serialised overlay behind core');
  ok(overlaySawCore === true, '2b. core is in flight while the overlay is still running',
    'the join serialised core behind the overlay');
}

console.log('\n== 3. THE HEADLINE — EPA HANGS FOREVER, CORE STILL RETURNS ==');
{
  const c = fakeClock();
  const p = resolvePlanes({
    core: async () => CORE_RECORDS,                       // core answers immediately
    overlay: () => never(),                               // EPA never answers at all
    overlayUnavailable: UNAVAILABLE, now: c.now, timers: c.timers,
  });
  let settled = false; p.then(() => { settled = true; }, () => { settled = true; });

  await c.advance(OVERLAY_DEADLINE_MS);                   // at the deadline itself: grace remains
  ok(settled === false, '3a. the outer guard waits out its grace before firing');

  await c.advance(OVERLAY_GRACE_MS);
  const out = await p;
  // (a) devSites still returns:
  ok(Array.isArray(out.core), '3b. (a) devSites STILL RETURNS while EPA is hung');
  // (b) types records present:
  ok(out.core.length === 3 && out.core[0].label === 'Rezoning — 12 Elm St',
    '3c. (b) every core TYPE record is present and intact', JSON.stringify(out.core));
  // (c) facilities unknown, NOT zero:
  ok(out.overlay.epa.ok === false, '3d. (c) the overlay reports ok:false — the UNKNOWN discriminator');
  ok(out.overlay.epa.reason === 'deadline', '3e. (c) the reason names the deadline', `got ${out.overlay.epa.reason}`);
  ok(out.overlay_deadline_missed === true, '3f. the miss is reported to the caller for observability');
  // The distinction this whole workstream exists to preserve, stated as an assertion:
  ok(out.overlay.epa.ok === false && out.overlay.sites.length === 0,
    '3g. (c) "no answer" is an EMPTY LIST WITH ok:false — never an authoritative zero');
  ok(c.pendingCount() === 0, '3h. the core timer is cleared even though only the overlay fired');
}

console.log('\n== 4. an overlay that THROWS degrades to unavailable — it never fails the report ==');
{
  const c = fakeClock();
  const p = resolvePlanes({
    core: async () => CORE_RECORDS,
    overlay: async () => { throw new Error('FRS blew up'); },
    overlayUnavailable: UNAVAILABLE, now: c.now, timers: c.timers,
  });
  // Pre-attach: without a handler in this microtask turn, a regression that lets the overlay
  // rejection through would ABORT the run on Node's unhandled-rejection default — a crash is a
  // weaker signal than a named failing assertion, and it hides every later section.
  p.catch(() => {});
  await c.advance(0);
  let threw = null, out = null;
  try { out = await p; } catch (e) { threw = e; }
  ok(threw === null, '4a. an overlay rejection does NOT fail the core report',
    threw && String(threw.message));
  ok(out && out.core.length === 3, '4b. the core records still come back in full');
  ok(out && out.overlay.epa.ok === false && out.overlay.epa.reason === 'error',
    '4c. the rejection becomes ok:false/"error" — again not a zero');
  ok(out && out.overlay_threw === true, '4d. the throw is reported, not swallowed silently');
}

console.log('\n== 5. THE ASYMMETRY — a CORE miss FAILS the report (it must never be a fake empty) ==');
{
  const c = fakeClock();
  const p = resolvePlanes({
    core: () => never(),                                   // core is stuck
    overlay: async () => UNAVAILABLE('error'),
    overlayUnavailable: UNAVAILABLE, now: c.now, timers: c.timers,
  });
  let threw = null, out = null;
  p.catch(() => {});                                       // pre-attach; we await below
  await c.advance(CORE_DEADLINE_MS);
  try { out = await p; } catch (e) { threw = e; }
  ok(threw instanceof CoreDeadlineError, '5a. a core deadline miss THROWS',
    `got ${out ? 'a resolved value' : threw && threw.name}`);
  ok(out === null, '5b. it does NOT return an empty core — a partial core is fabrication by omission');
  ok(CORE_DEADLINE_MS > OVERLAY_DEADLINE_MS,
    '5c. core is given the LONGER budget, so the overlay can never outlive it');
}

console.log('\n== 6. a core rejection is passed through unwrapped, and is not blamed on EPA ==');
{
  const c = fakeClock();
  const boom = new Error('alerts window read failed after retry');
  const p = resolvePlanes({
    core: async () => { throw boom; },
    overlay: () => never(),                                // EPA hung at the same time
    overlayUnavailable: UNAVAILABLE, now: c.now, timers: c.timers,
  });
  p.catch(() => {});
  await c.advance(OVERLAY_DEADLINE_MS + OVERLAY_GRACE_MS);
  let threw = null;
  try { await p; } catch (e) { threw = e; }
  ok(threw === boom, '6a. the CORE read error surfaces verbatim, not a CoreDeadlineError',
    threw && threw.name);
}

console.log('\n== 7. the FRS ladder itself stops at the deadline (the cooperative half) ==');
{
  // ⚠️ THE UNBOUNDED SHAPE IS **MIXED**, NOT A PURE HANG — this test was wrong first and the
  // code corrected it. Three transient failures at ONE radius already return early (the
  // 2026-08-27 "a transient failure must not shrink the search area" rule), so a pure hang was
  // never the 18-attempt case. The real worst case interleaves: two slow transients then a FAST
  // process-limit refusal, which breaks to the next SMALLER radius with the transient counter
  // reset — six radii x ~60s = ~360s, all of it previously charged to the core plane.
  let t = 0, calls = 0, perRadius = 0;
  const now = () => t;
  const LIMIT = JSON.stringify({ Results: { Error: { ErrorMessage: 'Process Limit would be exceeded' } } });
  const mixed = () => {
    calls++;
    if (perRadius < 2) { perRadius++; t += FRS_ATTEMPT_TIMEOUT_MS; return Promise.resolve({ status: 504, text: () => Promise.resolve('') }); }
    perRadius = 0;                       // fast refusal → next radius, transient counter resets
    return Promise.resolve({ status: 200, text: () => Promise.resolve(LIMIT) });
  };
  const out = await frsFacilities(41.5, -112.0, 3, mixed, { deadlineAt: 65_000, now });
  ok(out.ok === false, '7a. the ladder reports ok:false');
  ok(out.reason === 'deadline', '7b. the reason names the deadline', `got ${out.reason}`);
  ok(out.rows.length === 0 && out.radius_used === null, '7c. no rows and no radius claimed');
  ok(t <= 90_000, '7d. it stopped near its budget instead of running the full ladder', `t=${t}ms`);

  // CONTROL — the SAME fetch with NO deadline runs the whole ladder. Without this the numbers
  // above prove nothing: a bounded run and a run that was never long look identical.
  t = 0; calls = 0; perRadius = 0;
  const free = await frsFacilities(41.5, -112.0, 3, mixed);
  ok(free.ok === false && calls === 18 && t === 360_000,
    '7e. CONTROL — undeadlined, the same failure runs 18 attempts / 360s',
    `calls=${calls} t=${t}`);
  ok(frsRadii(3).length === 6, '7f. control — the ladder is 6 radii wide', `${frsRadii(3).length}`);
}

console.log('\n== 7b. the PURE-transient early return is PRESERVED, not replaced ==');
{
  // The deadline must not weaken the 2026-08-27 rule: three transient failures at one radius
  // still stop there and report "transient", so a flaky FRS can never walk down to a tiny
  // radius and return a real-but-far-smaller number. Same outcome with or without a deadline.
  let t = 0; const now = () => t;
  const hang = () => { t += FRS_ATTEMPT_TIMEOUT_MS; return Promise.resolve({ status: 503, text: () => Promise.resolve('') }); };
  const out = await frsFacilities(41.5, -112.0, 3, hang, { deadlineAt: 1_000_000, now });
  ok(out.ok === false && out.reason === 'transient' && out.attempts === 3,
    '7g. unchanged: 3 transients at one radius still stop there, reason "transient"',
    `ok=${out.ok} reason=${out.reason} attempts=${out.attempts}`);
}

console.log('\n== 8. the deadline SHORTENS the last attempt rather than overrunning it ==');
{
  // The value handed to AbortSignal.timeout is what actually bounds the socket, so it is read
  // directly rather than inferred. Without this cap the ladder could start an attempt with 2s
  // of budget left and hold the core plane for a further 30s.
  const realTimeout = AbortSignal.timeout;
  const asked = [];
  AbortSignal.timeout = (ms) => { asked.push(ms); return realTimeout.call(AbortSignal, 60_000); };
  try {
    let t = 0; const now = () => t;
    const hang = () => { t += 20_000; return Promise.resolve({ status: 503, text: () => Promise.resolve('') }); };
    // Budget 25s: attempt 1 gets the full 30s cap (25s remains → capped to 25s), attempt 2 has
    // only 5s left and must be asked for 5s, not 30s.
    await frsFacilities(41.5, -112.0, 3, hang, { deadlineAt: 25_000, now });
    ok(asked.length >= 2, '8a. at least two attempts were made', JSON.stringify(asked));
    ok(asked[0] === 25_000, '8b. the first attempt is capped to the remaining budget, not 30s',
      `got ${asked[0]}`);
    ok(asked[1] === 5_000, '8c. the last attempt is capped to the 5s that actually remained',
      `got ${asked[1]}`);
    ok(asked.every((ms) => ms <= FRS_ATTEMPT_TIMEOUT_MS),
      '8d. and no attempt is ever given MORE than the historical 30s', JSON.stringify(asked));

    // CONTROL — with no deadline every attempt still asks for the historical 30s exactly.
    asked.length = 0; t = 0;
    await frsFacilities(41.5, -112.0, 3, hang);
    ok(asked.length > 0 && asked.every((ms) => ms === FRS_ATTEMPT_TIMEOUT_MS),
      '8e. CONTROL — undeadlined, every attempt still asks for 30000', JSON.stringify(asked));
  } finally {
    AbortSignal.timeout = realTimeout;
  }
}

console.log('\n== 9. NO DEADLINE => the ladder is byte-for-byte its previous self ==');
{
  // The guard must not change behaviour for callers that pass no deadline — that is what makes
  // this additive. A pure process-limit sequence still walks every radius and reports its own
  // reason, exactly as `epa-result-semantics` pins it.
  const LIMIT = JSON.stringify({ Results: { Error: { ErrorMessage: 'Process Limit would be exceeded' } } });
  let calls = 0;
  const f = () => { calls++; return Promise.resolve({ status: 200, text: () => Promise.resolve(LIMIT) }); };
  const out = await frsFacilities(41.5, -112.0, 3, f);
  ok(out.ok === false && out.reason === 'process_limit', '9a. unchanged: process_limit still reported',
    `got ok=${out.ok} reason=${out.reason}`);
  ok(calls === frsRadii(3).length, '9b. unchanged: it still walks every radius once',
    `${calls} calls vs ${frsRadii(3).length} radii`);
  ok(out.attempts === calls, '9c. unchanged: the attempt counter still matches');
}

console.log('\n== 10. a healthy-but-slow FRS is NOT converted into a false unknown ==');
{
  // The budget is deliberately sized ABOVE one full attempt timeout. If it were not, a single
  // slow-but-successful FRS read would be cut off and real facility records would be LOST —
  // the same class of harm as a false zero, reached from the other side.
  ok(OVERLAY_DEADLINE_MS > FRS_ATTEMPT_TIMEOUT_MS,
    '10a. the overlay budget exceeds one full FRS attempt timeout',
    `${OVERLAY_DEADLINE_MS} vs ${FRS_ATTEMPT_TIMEOUT_MS}`);
  let t = 0; const now = () => t;
  const slow = () => { t += 29_000; return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ Results: { FRSFacility: [{ RegistryId: '1', FacilityName: 'ACME STEEL', Latitude83: '41.5', Longitude83: '-112.0' }] } })) }); };
  const out = await frsFacilities(41.5, -112.0, 3, slow, { deadlineAt: OVERLAY_DEADLINE_MS, now });
  ok(out.ok === true && out.rows.length === 1,
    '10b. a 29s successful read still succeeds under the 45s budget', `ok=${out.ok} rows=${out.rows.length}`);
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILING'} — epa-plane-deadlines`);
process.exit(fails === 0 ? 0 : 1);
