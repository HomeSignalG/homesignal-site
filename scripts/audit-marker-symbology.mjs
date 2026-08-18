// Backbone marker-symbology audit — replays HS.resolveMarker against production data.
// Run: node scripts/audit-marker-symbology.mjs [--live-sample=N]
//
// Offline: replays the (record_kind, type, status) universe snapshot below.
// Live:    pulls N development rows from app_projects (name + source_ref) to measure
//          keyword recovery on generic source types and per-feed circle rates.
import { surfaceBanner } from './lib/surface-banner.mjs';
surfaceBanner('audit-marker-symbology');

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;
const FAC = HS.markerRegistry.facilityHex;

const LEGEND_HIST = {
  'Industrial': 'triangle',
  'Residential': 'pentagon',
  'Roads & infrastructure': 'diamond',
  'Commercial': 'hexagon',
  'Data center': 'square',
  'Other project': 'circle',
  'Regulated facility': 'square'
};

// Source: app_projects, project qwnnmljucajnexpxdgxr, pulled 2026-07-24.
const UNIVERSE = [
  ['development', 'Development', 'Approved', 283367], ['development', 'Residential', 'Approved', 61245],
  ['development', 'unclassified', 'Approved', 39291], ['development', 'Development', 'Operating', 37640],
  ['development', 'Commercial', 'Approved', 32143], ['development', 'unclassified', 'Operating', 19577],
  ['development', 'Trades', 'Approved', 15669], ['development', 'Residential', 'Operating', 10714],
  ['development', 'Residential', 'Proposed', 5529], ['development', 'Development', 'Proposed', 4678],
  ['development', 'Commercial', 'Operating', 1914], ['development', 'Commercial', 'Proposed', 1765],
  ['development', 'unclassified', 'Proposed', 1309], ['development', 'Civic/Public', 'Approved', 303],
  ['development', 'Utility', 'Approved', 281], ['development', 'Industrial', 'Approved', 214],
  ['development', 'Land use', 'Operating', 82], ['development', 'Industrial', 'Proposed', 63],
  ['development', 'Industrial', 'Operating', 38], ['development', 'Utility', 'Proposed', 22],
  ['development', 'Civic/Public', 'Proposed', 21], ['development', 'Utility', 'Operating', 11],
  ['development', 'Land use', 'Approved', 10], ['development', 'Civic/Public', 'Operating', 5],
  ['development', 'commercial', 'On file', 2], ['development', 'animal-facility', 'On file', 1],
  ['development', 'industrial', 'On file', 1], ['development', 'research', 'On file', 1],
  ['facility', 'industrial', 'Operating', 155532], ['facility', 'energy', 'Operating', 37649],
  ['facility', 'logistics', 'Operating', 24026], ['facility', 'datacenter', 'Operating', 761],
];

// Status → canonical pin colour. Mirrors lib/map.js::statusTier + STATUS_TIERS, stated here
// independently so this audit asserts the contract rather than borrowing the implementation.
//
// `Active` was added 2026-08-18 with the gate2b vocabulary repair: production's status
// vocabulary is exactly four values (Operating / Approved / Proposed / Active, 0 NULL), and
// `Active` buckets to operating (lib/map.js:198 — 'operating' || 'active' || 'built'). It is
// absent from the UNIVERSE snapshot below only because that snapshot is frozen at 2026-07-24;
// the live-sample path does see it.
// `On file` STAYS: it is the legacy TABS vocabulary the frozen UNIVERSE rows still carry, and
// it is the lifecycle-unknown colour. Both are real; neither is a guess.
const STATUS_EXPECT = { Proposed: '#c47a1a', Approved: '#3f7fb0', Operating: '#1f9d5c', Active: '#1f9d5c', 'On file': '#6b7f76' };
const GENERIC_TYPES = new Set(['Development', 'unclassified', 'Trades', 'Land use', 'Civic/Public']);

function auditRow(item, n) {
  const m = HS.resolveMarker(item);
  // FAIL CLOSED AND NAME THE VALUE. Without this an unrecognised status yields `undefined`,
  // which silently loses the `m.color === expect` comparison and surfaces only as an
  // anonymous drop in "every record resolves to its canonical status/facility color" — the
  // reader is told the colours are wrong, not that the vocabulary moved. Same guard, same
  // reason, as STATUS_BUCKET in scripts/gate2/full-inventory.mjs.
  const expect = item.record_kind === 'facility' ? FAC : STATUS_EXPECT[item.status];
  if (expect === undefined) {
    console.error(`FAIL — unrecognised status ${JSON.stringify(item.status)}: the lifecycle `
      + `vocabulary moved and this audit will not guess its colour. Add it to STATUS_EXPECT `
      + `(and check lib/map.js::statusTier agrees).`);
    process.exit(1);
  }
  return { m, expect, n, item };
}

function printUniverseAudit() {
  let records = 0, correctColor = 0, purpleOnDev = 0, devCircle = 0, devExplicit = 0, fails = 0;
  const byShape = {}, byColor = {}, byLegend = {}, byRule = {};
  console.log('=== OFFLINE UNIVERSE (type/status snapshot — no names) ===\n');
  console.log('count     kind         type            status     => legend                  shape     color      shapeRule');
  for (const [kind, type, status, n] of UNIVERSE) {
    const item = kind === 'facility' ? { type, status, record_kind: 'facility' } : { type, status };
    const { m, expect } = auditRow(item, n);
    records += n;
    if (m.color === expect) correctColor += n;
    if (kind === 'development' && m.color === FAC) purpleOnDev += n;
    if (kind === 'development' && m.shape === 'circle') devCircle += n;
    if (kind === 'development' && m.shape !== 'circle') devExplicit += n;
    byShape[m.shape] = (byShape[m.shape] || 0) + n;
    byColor[m.color] = (byColor[m.color] || 0) + n;
    byLegend[m.legendLabel] = (byLegend[m.legendLabel] || 0) + n;
    byRule[m.shapeRule || '?'] = (byRule[m.shapeRule || '?'] || 0) + n;
    console.log(String(n).padStart(7) + '  ' + kind.padEnd(11) + '  ' + type.padEnd(14) + '  ' +
      String(status).padEnd(9) + ' => ' + m.legendLabel.padEnd(24) + m.shape.padEnd(9) + ' ' +
      m.color + '  ' + (m.shapeRule || ''));
  }
  const devTotal = UNIVERSE.filter(u => u[0] === 'development').reduce((a, u) => a + u[3], 0);
  console.log('\n--- HISTOGRAM (legend category) ---');
  ['Industrial', 'Residential', 'Roads & infrastructure', 'Commercial', 'Other project', 'Data center', 'Regulated facility']
    .forEach(function (lab) { console.log('  ' + lab.padEnd(28) + (byLegend[lab] || 0)); });
  console.log('\n--- TOTALS ---');
  console.log('records                        :', records);
  console.log('correct status/facility color  :', correctColor, '(' + (100 * correctColor / records).toFixed(3) + '%)');
  console.log('DEV → circle (fallback)        :', devCircle, '(' + (100 * devCircle / devTotal).toFixed(1) + '% of dev)');
  console.log('DEV → explicit shape           :', devExplicit, '(' + (100 * devExplicit / devTotal).toFixed(1) + '% of dev)');
  console.log('DEV painted PURPLE (defect)    :', purpleOnDev);
  console.log('by shapeRule (top)             :', Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 8));

  const assert = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
  console.log('\n--- INVARIANTS ---');
  assert(purpleOnDev === 0, 'no development record resolves to the regulated (purple) icon');
  assert(correctColor === records, 'every record resolves to its canonical status/facility color');
  assert((byColor[FAC] || 0) === UNIVERSE.filter(u => u[0] === 'facility').reduce((a, u) => a + u[3], 0),
    'purple is used for exactly the facility records');
  return fails;
}

async function liveSample(n) {
  const SB = 'https://qwnnmljucajnexpxdgxr.supabase.co';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3bm5tbGp1Y2FqbmV4cHhkZ3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTAyOTgsImV4cCI6MjA5NTk4NjI5OH0.prpXB6lSIhWMAsdkkaxAfkvEodbojfUUyN4L4JbQE1U';
  const rows = [];
  for (let off = 0; off < n; off += 1000) {
    const url = SB + '/rest/v1/app_projects?select=name,type,status,source_ref,record_kind&record_kind=eq.development'
      + '&limit=' + Math.min(1000, n - off) + '&offset=' + off;
    const res = await fetch(url, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    if (!res.ok) { console.warn('live fetch failed', res.status); break; }
    rows.push(...await res.json());
  }
  console.log('\n=== LIVE SAMPLE (' + rows.length + ' development rows with names) ===\n');
  const byLegend = {}, byRule = {}, byFeed = {};
  let circle = 0, keywordRecovered = 0, genericCircle = 0;
  for (const r of rows) {
    const m = HS.resolveMarker(r);
    byLegend[m.legendLabel] = (byLegend[m.legendLabel] || 0) + 1;
    byRule[m.shapeRule || '?'] = (byRule[m.shapeRule || '?'] || 0) + 1;
    if (m.shape === 'circle') circle++;
    if (GENERIC_TYPES.has(r.type) && m.shapeRule && m.shapeRule.indexOf('KEYWORD:') === 0) keywordRecovered++;
    if (GENERIC_TYPES.has(r.type) && m.shape === 'circle') genericCircle++;
    let feed = '?';
    try { feed = new URL(r.source_ref).hostname.replace(/^www\./, ''); } catch (e) {}
    if (!byFeed[feed]) byFeed[feed] = { total: 0, circle: 0 };
    byFeed[feed].total++;
    if (m.shape === 'circle') byFeed[feed].circle++;
  }
  console.log('--- HISTOGRAM (legend category) ---');
  ['Industrial', 'Residential', 'Roads & infrastructure', 'Commercial', 'Other project', 'Data center']
    .forEach(function (lab) { console.log('  ' + lab.padEnd(28) + (byLegend[lab] || 0)); });
  console.log('\n--- LIVE TOTALS ---');
  console.log('circle fallback               :', circle, '(' + (100 * circle / rows.length).toFixed(1) + '%)');
  console.log('explicit canonical shapes     :', rows.length - circle, '(' + (100 * (rows.length - circle) / rows.length).toFixed(1) + '%)');
  console.log('generic type + KEYWORD rule   :', keywordRecovered, '(' + (100 * keywordRecovered / rows.length).toFixed(2) + '% of sample)');
  console.log('generic type still circle     :', genericCircle);
  console.log('shapeRule distribution        :', Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 10));
  const hotFeeds = Object.entries(byFeed).filter(([, v]) => v.total >= 50 && v.circle / v.total > 0.5)
    .sort((a, b) => b[1].circle / b[1].total - a[1].circle / a[1].total);
  console.log('\n--- FEEDS >50% CIRCLE (n>=50) — source type_map granularity, not renderer bypass ---');
  hotFeeds.slice(0, 12).forEach(function ([d, v]) {
    console.log('  ' + d.padEnd(36) + v.circle + '/' + v.total + ' = ' + (100 * v.circle / v.total).toFixed(0) + '%');
  });
}

let fails = printUniverseAudit();
const liveArg = process.argv.find(a => a.startsWith('--live-sample='));
if (liveArg) await liveSample(+liveArg.split('=')[1] || 10000);
else console.log('\n(Pass --live-sample=10000 to measure name-keyword recovery on live rows.)');

if (fails) { console.error('\n' + fails + ' invariant(s) failed'); process.exit(1); }
console.log('\nBackbone marker classification audit complete.');
