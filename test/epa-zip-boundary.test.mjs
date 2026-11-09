// ZIP-mode EPA facility plane covers the WHOLE ZIP boundary (2026-11-09).
// Drives the shipped module (supabase/functions/get-address-report/sources/epa-frs-zip.ts) with a mocked FRS.
// The end-to-end proof through index.ts is epa-zip-boundary.handler.test.ts (Deno, real saved FRS rows).
//
// Run: node test/epa-zip-boundary.test.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN = join(root, 'supabase/functions/get-address-report');
const Z = await import(join(FN, 'sources/epa-frs-zip.ts'));
const FIX = JSON.parse(readFileSync(join(root, 'test/fixtures/epa-zip-boundary/frs-85083-64166-2026-11-09.json'), 'utf8'));

let fails = 0;
const ok = (cond, name, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (!cond && detail ? '\n     ' + detail : ''));
  if (!cond) fails++;
};
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const noSleep = { sleep: async () => {} };

// ── 1. the first circle contains the whole box, for real ZIPs ─────────────────────────────
for (const zip of ['85083', '64166']) {
  const b = FIX.bounds[zip];
  const c = Z.circumCircle(b);
  const corners = [[b.ymin, b.xmin], [b.ymin, b.xmax], [b.ymax, b.xmin], [b.ymax, b.xmax]];
  ok(corners.every(([la, ln]) => Z.milesBetween(c.lat, c.lng, la, ln) <= c.radiusMi), `1. ${zip}: the covering circle (${c.radiusMi} mi) contains every corner of the ZIP box`);
  const [sl, sg] = FIX.stored_points[zip];
  const farStored = Math.max(...corners.map(([la, ln]) => Z.milesBetween(sl, sg, la, ln)));
  if (zip === '85083') ok(farStored > 3, '1b. 85083: a box corner is beyond 3 mi of the stored point (why one 3-mi circle missed part of it)', farStored.toFixed(2));
}
{
  const b = { xmin: -1, ymin: -1, xmax: 1, ymax: 1 };
  const q = Z.splitBox(b);
  const area = (x) => (x.xmax - x.xmin) * (x.ymax - x.ymin);
  ok(q.length === 4 && Math.abs(q.reduce((s, x) => s + area(x), 0) - area(b)) < 1e-12, '1c. the four quarters exactly tile the box');
}

// ── 2. coverage: refused circles are split, failures are never partial ────────────────────
const box = FIX.bounds['85083'];
{
  const seen = [];
  const fetch = async (u) => {
    const r = Number(new URL(u).searchParams.get('search_radius'));
    seen.push(r);
    if (r > 2.5) return res(200, { Results: { Error: { ErrorMessage: 'limit' } } });
    return res(200, { Results: { FRSFacility: [{ RegistryId: 'A', FacilityName: 'X PLANT', Latitude83: '33.74', Longitude83: '-112.16' }] } });
  };
  const o = await Z.frsZipCoverage(box, fetch, noSleep);
  ok(o.ok && o.tiles === 4 && seen.length === 5, '2a. a process-limit refusal becomes four quarter circles, never a smaller circle in place', JSON.stringify(seen));
  ok(o.rows.length === 1 && o.raw_rows === 4, '2b. the same registration from four overlapping circles is kept once', JSON.stringify({ rows: o.rows.length, raw: o.raw_rows }));
}
{
  let n = 0;
  const fetch = async () => { n++; return n === 1 ? res(200, { Results: { Error: {} } }) : n === 3 ? res(503, {}) : res(200, { Results: { FRSFacility: [] } }); };
  // n: 1 = big circle refused; 2 = quarter 1 ok; 3 = quarter 2 fails once; then retried ok.
  const o = await Z.frsZipCoverage(box, fetch, noSleep);
  ok(o.ok && o.attempts === 6, '2c. a transient failure is retried at the SAME circle', JSON.stringify(o));
}
{
  const fetch = async (u) => (Number(new URL(u).searchParams.get('search_radius')) < 2.5 && new URL(u).searchParams.get('latitude83') > '33.74' ? res(503, {}) : res(200, { Results: { FRSFacility: [{ RegistryId: 'B' }] } }));
  const big = async (u) => (Number(new URL(u).searchParams.get('search_radius')) > 2.5 ? res(200, { Results: { Error: {} } }) : fetch(u));
  const o = await Z.frsZipCoverage(box, big, noSleep);
  ok(!o.ok && o.reason === 'transient' && o.rows.length === 0, '2d. one quarter that never answers ⇒ ok:false with NO rows (never a partial inventory)', JSON.stringify(o));
}
{
  const o = await Z.frsZipCoverage(box, async () => res(200, { Results: { Error: {} } }), noSleep);
  ok(!o.ok && o.rows.length === 0 && ['process_limit', 'request_limit'].includes(o.reason), '2e. refused all the way down ⇒ ok:false', o.reason);
  const s = await Z.frsZipCoverage(box, async () => res(200, { Results: {} }), noSleep);
  ok(!s.ok && s.reason === 'schema', '2f. an unrecognised body ⇒ ok:false schema (not a zero)');
  let t = 0; const now = () => t;
  const d = await Z.frsZipCoverage(box, async () => { t += 50; return res(503, {}); }, { now, deadlineAt: 60, sleep: async (ms) => { t += ms; } });
  ok(!d.ok && d.reason === 'deadline', '2g. the overlay deadline ends coverage as ok:false deadline', JSON.stringify(d));
  const z = await Z.frsZipCoverage(box, async () => res(200, { Results: { FRSFacility: [] } }), noSleep);
  ok(z.ok && z.rows.length === 0 && z.tiles === 1, '2h. a covering circle that answers empty is an authoritative zero for the whole ZIP');
}

// ── 3. selection: boundary FIRST, cap second ──────────────────────────────────────────────
{
  const center = { lat: 0, lng: 0 };
  // 300 outside rows right at the centre, 20 in-ZIP rows farther out. A cap of 10.
  const rows = [];
  for (let i = 0; i < 300; i++) rows.push({ id: `out${i}`, lat: 0.0001 * i, lng: 0 });
  for (let i = 0; i < 20; i++) rows.push({ id: `in${i}`, lat: 0.05, lng: 0.001 * i });
  const calls = [];
  const member = async (pts) => { calls.push(pts.length); return pts.map(([la]) => (la >= 0.05 ? 'member' : 'outside')); };
  const p = await Z.pickZipFacilities(rows, (r) => ({ ...r }), member, center, 10);
  ok(p.kept.length === 10 && p.kept.every((s) => s.id.startsWith('in')), '3a. outside rows never consume the cap (all 10 kept are in-ZIP)', p.kept.map((s) => s.id).join(','));
  ok(p.members === 20 && p.outside === 300 && p.over_cap === 10, '3b. the over-cap count says the stored list is not the whole inventory', JSON.stringify(p));
  ok(calls.length === 1 && calls[0] === 320, '3c. one membership call for 320 points');
  const big = [];
  for (let i = 0; i < 1201; i++) big.push({ id: i, lat: 1, lng: 1 });
  const sizes = [];
  await Z.pickZipFacilities(big, (r) => r, async (pts) => { sizes.push(pts.length); return pts.map(() => 'member'); }, center);
  ok(JSON.stringify(sizes) === '[500,500,201]', '3d. membership is asked in batches of 500 and every point gets a verdict', JSON.stringify(sizes));
  let threw = false;
  try { await Z.pickZipFacilities(rows, (r) => r, async (pts) => pts.slice(1).map(() => 'member'), center); } catch { threw = true; }
  ok(threw, '3e. a short membership answer throws (the engine turns it into ok:false)');
  const q = await Z.pickZipFacilities(rows, (r) => (r.id === 'in3' ? null : r), member, center, 100);
  ok(q.members === 19 && q.unresolved === 0, '3f. the caller\'s own filter drops a row before the boundary test, not after');
  const u = await Z.pickZipFacilities([{ lat: 1, lng: 1 }], (r) => r, async () => ['not_measured'], center);
  ok(u.kept.length === 0 && u.unresolved === 1, '3g. an unresolved verdict is excluded and counted, nothing invented');
}

// ── 4. wiring in index.ts ────────────────────────────────────────────────────────────────
{
  const src = readFileSync(join(FN, 'index.ts'), 'utf8');
  ok(/overlay: \(deadlineAt\) => facilitySitesForZip\(zipGeo\.bounds, zipMembers, clat, clng, deadlineAt\)/.test(src), '4a. ZIP mode uses the boundary coverage');
  ok(/overlay: \(deadlineAt\) => facilitySites\(lat, lng, radiusMi, deadlineAt\)/.test(src), '4b. address mode keeps its own radius search');
  ok(!/facilitySites\(clat, clng/.test(src), '4c. ZIP mode never calls the radius search');
  ok(/const zipGeo = await zipScopeBounds\(supabase, zip\);/.test(src) && /const scope = policy\.on \? zipGeo :/.test(src),
    '4d. the boundary is read once per ZIP request; the permit scope still follows its own rollout policy');
  ok(/if \(!bounds\) return facilitiesUnavailable\("no_boundary"\);/.test(src), '4e. no boundary ⇒ ok:false, never a radius fallback');
}

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall passed');
