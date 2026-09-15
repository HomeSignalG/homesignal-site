// verify-coverage-state.mjs — Phase 2 coverage-state model verification.
// Runs on a GitHub runner (the build sandbox has no egress — CI is the live
// check, the repo's standing pattern). VERIFICATION ONLY — no product writes.
//
// Asserts, against the LIVE app_coverage_states view (public anon read):
//   1. every app_community_meta ZIP has exactly one row with a VALID state on BOTH planes;
//   2. no impossible combinations (core state disagreeing with core content,
//      populated with none, unsupported_source with a report, overlay claiming an
//      emptiness it did not verify);
//   3. legacy data_quality consistency — the old gate stays valid during rollout;
//   3c. LOCAL NEWS IS CONTENT, NOT COVERAGE — it can never lift a coverage state;
//   4. determinism: two reads of the same ZIP agree (pure function of columns);
//   5. rendering: one core-empty-with-facilities page and one honestly-empty page
//      render on DESKTOP (1440×900) and MOBILE (390×844) with the
//      data-coverage-state attribute matching the view, layout gate unchanged.
//
// ⚠️ TWO PLANES, AND THIS FILE READS BOTH SHAPES (EPA/regulatory decoupling, Unit 2).
// `coverage_state` describes the CORE project plane only; `regulatory_overlay_state`
// describes the EPA/FRS overlay. The pre-split enum collapsed the composition into one
// core value, `facilities_only`. This verifier runs against LIVE production every day,
// so it must be correct BEFORE the view migration is applied as well as after: every
// assertion below is stated on a NORMALIZED (core, overlay) pair, and `normalize()`
// maps the pre-split shape onto it. Deleting `facilities_only` from a VALID set here
// would have turned this job red on merge, days before the change it describes.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { surfaceBanner } from './lib/surface-banner.mjs';
surfaceBanner('verify-coverage-state');

const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const grab = (k) => (cfg.match(new RegExp(`${k}:\\s*'([^']+)'`)) || [])[1];
const SUPABASE_URL = grab('SUPABASE_URL');
const SUPABASE_ANON_KEY = grab('SUPABASE_ANON_KEY');
const CORE_VALID    = new Set(['populated','honestly_empty','unsupported_source','temporarily_unavailable','failed_ingest','stale_data']);
const OVERLAY_VALID = new Set(['overlay_records','overlay_empty','overlay_unknown','overlay_unsupported']);

// Normalize either view shape to one (core, overlay) pair. Post-split the view states
// both directly. Pre-split, `facilities_only` IS core-empty + overlay-records, and every
// other row's overlay is read from fac_markers — the same column the old branch used.
function normalize(r) {
  if (r.regulatory_overlay_state !== undefined && r.regulatory_overlay_state !== null) {
    return { core: r.coverage_state, overlay: r.regulatory_overlay_state, split: true };
  }
  if (r.coverage_state === 'facilities_only') {
    return { core: 'honestly_empty', overlay: 'overlay_records', split: false };
  }
  return {
    core: r.coverage_state,
    overlay: r.refreshed_at === null ? 'overlay_unsupported' : (r.fac_markers > 0 ? 'overlay_records' : 'overlay_empty'),
    split: false,
  };
}

// A READ FAILURE IS NOT AN ASSERTION FAILURE, AND THIS JOB COULD NOT TELL YOU WHICH.
// The old body threw `REST <path> -> 500` and discarded the response, so the daily red
// read as "an invariant is failing" — and was recorded that way in CLAUDE.md for over a
// week — when in fact the very FIRST read was being cancelled and not one assertion had
// run. PostgREST puts the Postgres SQLSTATE and message in the body; surface them.
class ReadError extends Error {
  constructor(path, status, body) {
    const j = (() => { try { return JSON.parse(body); } catch { return null; } })();
    super(`REST ${path} -> ${status}`
      + (j?.code ? ` [${j.code}]` : '')
      + (j?.message ? ` ${j.message}` : (body ? ` ${body.slice(0, 200)}` : '')));
    this.status = status; this.code = j?.code || null; this.path = path;
  }
}
// 57014 is `canceling statement due to statement timeout`. It is the ONE failure this
// reader can do something about (ask for less), so it is named rather than inferred from
// the status: PostgREST reports it as a 500, the same status a genuine outage carries.
const isTimeout = (e) => e instanceof ReadError && (e.code === '57014' || e.status === 500);

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new ReadError(path, res.status, await res.text().catch(() => ''));
  return res.json();
}

// AN UNREADABLE SOURCE AND A FAILING INVARIANT MUST NOT LOOK THE SAME IN THE LOG. This
// file is top-level await, so a throw surfaces as an unhandled rejection and prints a bare
// stack — which is exactly how "the first read was cancelled" got recorded as "the stale
// assertion is failing". Label it, and say plainly that nothing was verified.
process.on('unhandledRejection', (e) => {
  const read = e instanceof ReadError || /unreadable at floor page size/.test(e?.message || '');
  console.error(`\n${read ? 'INFRASTRUCTURE' : 'ERROR'}: ${e?.message || e}`);
  if (read) {
    console.error('NOTHING WAS VERIFIED — this run could not READ the source, so it makes no');
    console.error('claim about any invariant. Do not record it as an assertion failure.');
  } else if (e?.stack) {
    console.error(e.stack);
  }
  process.exit(1);
});

const fails = [];
const ok = (name, cond, extra) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  [' + extra + ']' : ''}`);
  if (!cond) fails.push(name);
};

// ── 1-3: full-population invariants (keyset-paginated, ADAPTIVE page size) ──
//
// ⚠️ A 1000-ROW PAGE OF THIS VIEW CANNOT BE READ BY `anon`, AND THAT IS ARITHMETIC, NOT A
// FLAKE. The view LEFT JOINs a LATERAL `count(*) FILTER (...) FROM app_projects WHERE
// zip = m.zip` per ZIP. `app_projects` is ~3.19M rows / 2.9 GB with its visibility map
// 0.1% set (relallvisible 210 of relpages 370,510), so that aggregate cannot go
// index-only despite `app_projects_zip_kind_date_idx (zip, record_kind, ...)` covering
// it — every ZIP pays ~144 random heap fetches. Measured 2026-09-15 with EXPLAIN ANALYZE:
// one 1000-row page = 55.6 s cold, 33.1 s warm (86,678 page reads even warm — the working
// set does not fit cache). The `anon` role carries `statement_timeout = 3s`. So the first
// page was cancelled every single day and the run died before assertion one.
//
// PAGE COST IS NOT UNIFORM, which is why a smaller CONSTANT would only move the failure:
// a 50-row page measured 206 ms at the start of the ZIP range but 3,516 ms at
// `zip > '40000'`, a ~17x spread, because dense ZIPs carry 275 app_projects rows against
// 127. Only an adaptive size can cross both. Same ladder as verify-development.mjs (halve
// on a failed page, floor 1, recover after clean pages) — there it is row SIZE that
// blows the budget, here it is per-row WORK, and the remedy is identical.
//
// 📌 THE DURABLE FIX IS IN THE DATABASE, NOT HERE, and is deliberately NOT bundled: with
// the visibility map set, that lateral becomes an index-only scan and the whole read goes
// back to ~1 min. This reader only stops lying about why it failed.
const MAX_STEP = 32;
const rows = [];
{
  let step = MAX_STEP, last = '', clean = 0, floorRetries = 0;
  for (;;) {
    // `select=*` on purpose: naming regulatory_overlay_state before the view migration
    // 400s the whole request, which would read as an outage rather than as a not-yet.
    let page;
    try {
      page = await rest(`app_coverage_states?select=*&order=zip.asc&limit=${step}`
        + (last ? `&zip=gt.${encodeURIComponent(last)}` : ''));
    } catch (e) {
      if (!isTimeout(e)) throw e;                 // a real outage is not a page-size problem
      if (step > 1) { step = Math.max(1, Math.floor(step / 2)); clean = 0; continue; }
      floorRetries++;
      if (floorRetries > 3) throw new Error(`app_coverage_states unreadable at floor page size: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2500 * floorRetries));
      continue;
    }
    floorRetries = 0;
    rows.push(...page);
    if (page.length < step) break;
    last = page[page.length - 1].zip;
    if (++clean >= 3 && step < MAX_STEP) { step = Math.min(MAX_STEP, step * 2); clean = 0; }
  }
}
const metaCount = Number(await fetch(`${SUPABASE_URL}/rest/v1/app_community_meta?select=zip`, {
  method: 'HEAD',
  headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'count=exact' },
}).then(r => (r.headers.get('content-range') || '0/0').split('/')[1]));

ok('every meta ZIP has a coverage-state row', rows.length === metaCount, `view=${rows.length} meta=${metaCount}`);
const N = new Map(rows.map(r => [r.zip, normalize(r)]));
const nz = (r) => N.get(r.zip);
const SPLIT_LIVE = rows.length > 0 && rows.every(r => nz(r).split);
console.log(`INFO planes: the view is ${SPLIT_LIVE ? 'SPLIT (regulatory_overlay_state present)' : 'PRE-SPLIT (normalized from facilities_only/fac_markers)'}`);

ok('every CORE state is valid + non-null', rows.every(r => CORE_VALID.has(nz(r).core)),
   [...new Set(rows.filter(r => !CORE_VALID.has(nz(r).core)).map(r => nz(r).core))].join(','));
ok('every OVERLAY state is valid + non-null', rows.every(r => OVERLAY_VALID.has(nz(r).overlay)),
   [...new Set(rows.filter(r => !OVERLAY_VALID.has(nz(r).overlay)).map(r => nz(r).overlay))].join(','));
ok('no duplicate ZIPs in view', new Set(rows.map(r => r.zip)).size === rows.length);

// THE CORE PLANE IS ABOUT CORE CONTENT, AND ONLY CORE CONTENT. `fac_markers` is
// deliberately absent from both directions here: a core-empty ZIP holding EPA
// facilities is the NORMAL post-split shape, not an impossible one, and treating it as
// a violation is precisely the coupling this unit removes.
ok('impossible: core honestly_empty with core content',
   !rows.some(r => nz(r).core === 'honestly_empty' && (r.dev_markers > 0 || r.changes > 0)));
ok('impossible: populated without core content',
   !rows.some(r => nz(r).core === 'populated' && r.dev_markers === 0 && r.changes === 0));
ok('impossible: unsupported_source with a report',
   !rows.some(r => nz(r).core === 'unsupported_source' && r.refreshed_at !== null));

// THE OVERLAY MAY NEVER CLAIM AN EMPTINESS IT DID NOT VERIFY (Phase 1B's rule, applied
// to the state as well as to the count): a refused EPA read reports overlay_unknown.
ok('impossible: overlay_records with zero facility markers',
   !rows.some(r => nz(r).overlay === 'overlay_records' && r.fac_markers === 0));
ok('impossible: overlay_empty over an unverified EPA read',
   !rows.some(r => nz(r).overlay === 'overlay_empty' && r.facilities_unavailable === true));

// THE DECOUPLING, AS DATA. If no ZIP is core-empty while the overlay holds records,
// either the planes are still fused or there is nothing to tell apart — and a
// vacuous pass is not a pass.
const coreEmptyOverlayRecords = rows.filter(r => nz(r).core === 'honestly_empty' && nz(r).overlay === 'overlay_records');
ok('the two planes are independent (core-empty ZIPs with overlay records exist)',
   coreEmptyOverlayRecords.length > 0, `${coreEmptyOverlayRecords.length} ZIP(s)`);

// LEGACY data_quality consistency, restated on the composed pair. `data_quality` still
// counts EPA facilities (it is the LAYOUT gate — audit §14.1), so a core-empty ZIP
// WITH overlay records is legitimately 'pass' while one without is 'coverage_coming'.
// The pre-split spelling of the first rule was `populated/facilities_only => pass`.
ok('legacy: populated => pass',
   rows.every(r => nz(r).core !== 'populated' || r.data_quality === 'pass'));
ok('legacy: core-empty + overlay records => pass',
   coreEmptyOverlayRecords.every(r => r.data_quality === 'pass'),
   coreEmptyOverlayRecords.filter(r => r.data_quality !== 'pass').slice(0, 5).map(r => r.zip).join(','));
ok('legacy: core-empty + no overlay records => coverage_coming',
   rows.every(r => !(nz(r).core === 'honestly_empty' && nz(r).overlay !== 'overlay_records')
                || r.data_quality === 'coverage_coming'),
   rows.filter(r => nz(r).core === 'honestly_empty' && nz(r).overlay !== 'overlay_records' && r.data_quality !== 'coverage_coming').slice(0, 5).map(r => r.zip).join(','));

// ── 3c: LOCAL NEWS IS CONTENT, NOT COVERAGE (regression pin, 2026-08-02) ──
// `app_changes` holds three categories; only 'Government & civic' and
// 'Planning & zoning' are coverage. Local News later began materializing into the
// SAME table, and while this view counted the table with no category filter it read
// news as coverage — reporting 5,734 ZIPs one state better than their data supports
// (5,072 facilities_only and 662 honestly_empty, all shown as `populated`). The
// materializer never drifted: app_refresh_zip counts `_nc` BEFORE inserting news, so
// data_quality has always been civic-only by construction. That asymmetry is what
// made `legacy: populated/facilities_only => pass` fail daily. Pin the rule so a
// future category added to app_changes cannot quietly widen coverage again.
const newsOnly = rows.filter(r => r.news_items > 0 && r.dev_markers === 0 && r.fac_markers === 0 && r.changes === 0);
ok('news is not coverage: news-only ZIPs are honestly_empty',
   newsOnly.every(r => nz(r).core === 'honestly_empty'),
   newsOnly.filter(r => nz(r).core !== 'honestly_empty').slice(0, 5).map(r => r.zip + ':' + nz(r).core).join(','));
console.log(`INFO news: ${rows.filter(r => r.news_items > 0).length} ZIP(s) carry Local News; `
  + `${newsOnly.length} carry news and nothing else (honestly_empty by rule)`);

// ── 3b: PRODUCTION COVERAGE-PASS GATES (2026-07-25 Maps data coverage pass) ──
// The full-universe audit classified all ZIPs and resolved every FAILED /
// UNDER_RETURN / STALE case (docs/maps-data-coverage-pass-2026-07-25.md). These
// gates keep that state: a regression to a failed or chronically-stale
// materialization anywhere in the universe fails CI. Explained exceptions, if
// ever needed, go in the allowlist WITH a receipt — never silently.
const FAILED_ALLOWLIST = new Set([]);   // zip -> must carry a receipt in the coverage-pass doc

// `temporarily_unavailable` IS A DESIGNED STATE, NOT A FAILURE — for up to 7 days (2026-08-02).
// dev_refresh_collect() deliberately refuses a response that reports zero where the cached row
// has content, treating it as a possible flake, and that hold is bounded: the refusal condition
// carries `d.refreshed_at >= now() - interval '7 days'`, and its own comment says that beyond
// that "the flake theory is exhausted and the clean 200 response is the truth". Because a
// refusal does not bump refreshed_at, the window is measured from the last GOOD write and the
// hold releases on its own.
//
// Treating every such row as FAILED made this job red daily for a state the system produces on
// purpose (20769, 55103, 55109, 55119, 94024 — all 4-5 days into a 7-day hold, all with
// last_refresh_attempt_at today, i.e. being retried and correctly refused).
//
// The real invariant is that no page stays there BEYOND the window. Inside it, report and move
// on; outside it, the hold has failed to resolve and that IS a defect.
const HOLD_DAYS = 7;
const heldRows = rows.filter(r => nz(r).core === 'temporarily_unavailable');
const withinHold = heldRows.filter(r => r.refreshed_at && Date.parse(r.refreshed_at) >= Date.now() - HOLD_DAYS * 86400000);
const stuckHold = heldRows.filter(r => !withinHold.includes(r));
if (withinHold.length) {
  console.log(`INFO coverage-pass: ${withinHold.length} ZIP(s) inside the ${HOLD_DAYS}-day transient hold `
    + `(designed, self-releasing): ${withinHold.slice(0, 5).map(r => r.zip).join(',')}`);
}
const failedRows = rows.filter(r => nz(r).core === 'failed_ingest' && !FAILED_ALLOWLIST.has(r.zip))
  .concat(stuckHold.filter(r => !FAILED_ALLOWLIST.has(r.zip)));
ok('coverage-pass: zero FAILED materializations (and no hold past its window)', failedRows.length === 0,
   failedRows.slice(0, 5).map(r => r.zip + ':' + nz(r).core).join(','));
const staleRows = rows.filter(r => nz(r).core === 'stale_data');
ok('coverage-pass: zero unintentionally STALE ZIPs', staleRows.length === 0,
   staleRows.slice(0, 5).map(r => r.zip).join(','));
ok('coverage-pass: every ZIP classified (full universe)', rows.length === metaCount && rows.length > 0);
// Meetings-marker policy: map markers come ONLY from app_projects; a meeting could
// only become a marker via a coordinate-bearing app_changes row. Assert none exist —
// general government meetings ride the notices LIST, never the map.
const coordChanges = await rest('app_changes?select=zip&lat=not.is.null&limit=1');
ok('coverage-pass: no coordinate-bearing app_changes (no meeting can be a map marker)', coordChanges.length === 0,
   coordChanges.length ? 'found zip=' + coordChanges[0].zip : '');

// ── 4: determinism — re-read a sample, states agree ──
const sample = rows.filter(r => ['populated','honestly_empty'].includes(nz(r).core)).slice(0, 3);
for (const s of sample) {
  const again = await rest(`app_coverage_states?select=*&zip=eq.${s.zip}`);
  const a = again[0] ? normalize(again[0]) : null;
  ok(`determinism ${s.zip}`, !!a && a.core === nz(s).core && a.overlay === nz(s).overlay,
     `${nz(s).core}/${nz(s).overlay}`);
}

// ── 5: rendering, desktop + mobile ──
// The rendered `data-coverage-state` attribute carries whatever the view says, so the
// expected value is read from the row rather than hardcoded — that is what lets one
// rendering test cover both the pre-split and post-split shapes.
const pickRow = (pred) => rows.find(pred);
const rFacOnly = pickRow(r => nz(r).core === 'honestly_empty' && nz(r).overlay === 'overlay_records');
// ⚠️ THE HONEST-EMPTY SAMPLE MUST MATCH THE PAGE'S OWN CONDITION, NOT ITS COMPLEMENT.
// lib/community-page.js renders the "we checked every supported public source … including
// the EPA facility registry" sentence only when the overlay AGREES it is empty —
// overlay_empty | overlay_unsupported (or, pre-split, no overlay column at all). Picking
// with `overlay !== 'overlay_records'` also admits overlay_unknown, where that sentence is
// deliberately suppressed, so the sample would assert copy the page is right not to show.
const EMPTY_OVERLAYS = new Set(['overlay_empty', 'overlay_unsupported']);
const rEmpty   = pickRow(r => nz(r).core === 'honestly_empty' && EMPTY_OVERLAYS.has(nz(r).overlay));
const rPop     = pickRow(r => nz(r).core === 'populated');
// overlay_unknown can only exist once the view is SPLIT — normalize() never synthesises it
// from the pre-split shape, because the pre-split view has no way to express "we could not
// read EPA". Sampling it before then would pick nothing and assert nothing.
const rUnknown = SPLIT_LIVE
  ? pickRow(r => nz(r).core === 'honestly_empty' && nz(r).overlay === 'overlay_unknown')
  : null;
if (!SPLIT_LIVE) {
  console.log('INFO overlay_unknown sample SKIPPED: the view is PRE-SPLIT, so no row can '
    + 'carry overlay_unknown (normalize() maps the old shape onto records/empty/unsupported '
    + 'only). This is not a failure — the sample arms itself when the migration lands.');
} else if (!rUnknown) {
  console.log('INFO overlay_unknown sample SKIPPED: the view is SPLIT but no ZIP is '
    + 'core-empty with an unverified EPA read right now (every EPA read succeeded). '
    + 'Not a failure — nothing to sample.');
}
const pages = [
  rFacOnly && { zip: rFacOnly.zip, state: rFacOnly.coverage_state, kind: 'facilities_only',  wantPass: true },
  rEmpty   && { zip: rEmpty.zip,   state: rEmpty.coverage_state,   kind: 'honestly_empty',   wantPass: false },
  rUnknown && { zip: rUnknown.zip, state: rUnknown.coverage_state, kind: 'overlay_unknown',  wantPass: false },
  rPop     && { zip: rPop.zip,     state: rPop.coverage_state,     kind: 'populated',        wantPass: true },
].filter(Boolean);
const b = await chromium.launch();
for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true }]) {
  const page = await b.newPage({ viewport: { width: vp.width, height: vp.height }, ...(vp.isMobile ? { isMobile: true, hasTouch: true } : {}) });
  for (const t of pages) {
    await page.goto(`${SITE_BASE}/community.html?zip=${t.zip}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => {
      const p = document.getElementById('commPage');
      return !!(p && p.textContent && p.textContent.trim().length > 0);
    }, { timeout: 20000 });
    const got = await page.evaluate(() => ({
      state: (document.getElementById('commPage') || {}).getAttribute ? document.getElementById('commPage').getAttribute('data-coverage-state') : null,
      isPass: !!document.querySelector('#commPage .strip'),
      txt: (document.getElementById('commPage').textContent || '').slice(0, 400),
      noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    }));
    ok(`${vp.name} ${t.zip} attribute=${t.state} (${t.kind})`, got.state === t.state, `got=${got.state}`);
    ok(`${vp.name} ${t.zip} layout gate unchanged`, got.isPass === t.wantPass, `isPass=${got.isPass}`);
    ok(`${vp.name} ${t.zip} no horizontal scroll`, got.noHScroll);
    // The COPY is keyed on the composed kind, never on the raw enum value — the banner
    // must read identically before and after the split, which is the whole no-op claim.
    if (t.kind === 'honestly_empty') ok(`${vp.name} ${t.zip} honest empty copy`, /checked every supported public source/i.test(got.txt));
    if (t.kind === 'facilities_only') ok(`${vp.name} ${t.zip} facilities-only note`, /still being wired/i.test(got.txt));
    // An unverified EPA read must NOT claim we checked the registry. The page falls
    // through to the existing non-assertive copy; both halves are asserted, because
    // "the sentence is gone" and "something true replaced it" are different facts.
    if (t.kind === 'overlay_unknown') {
      ok(`${vp.name} ${t.zip} unverified EPA read does not claim a checked registry`,
         !/checked every supported public source/i.test(got.txt));
      ok(`${vp.name} ${t.zip} falls through to the being-wired copy`,
         /Coverage for this ZIP is being wired/i.test(got.txt));
    }
  }
  await page.close();
}
await b.close();

console.log(`\nTOTAL checks: pass=${fails.length === 0 ? 'ALL' : 'SOME FAILED'} fails=${fails.length}`);
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }