// RESIDENTIAL QUALIFICATION — the national before/after, measured through the REAL SHIPPED PATH.
//
// WHY NOT SQL. The obvious measurement is one query over app_projects. It was tried and it does
// not work here: there is no index on (record_kind, type), so isolating the ~635k residential
// rows out of 3.2M is a full scan, and with a concurrent geography build on the same instance
// that scan exceeded the 60s MCP budget AND the 120s Management-API budget on every shape tried
// (hash join, cross-join-lateral, ZIP-range chunk). Measuring through the production RPC is not
// a workaround with worse evidence - it is BETTER evidence: app_zip_projects_markers is the read
// the page itself performs, and the numbers below are produced by the same lib/ modules the
// browser runs, in the same order.
//
// HOW "BEFORE" IS OBTAINED. Not by a second implementation of the rule. The same shipped
// zipAuthSitesFrom() is called twice per ZIP - once normally, once with HS.residentialGateDrops
// detached - so "before" is literally this build with the gate off. Anything the two runs
// disagree about is exactly what the gate removed.
//
// Usage: node scripts/residential-measure.mjs   (env: SAMPLE=n to cap ZIPs, CONCURRENCY=n)
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const grab = (n) => {
  const m = html.match(new RegExp(`var ${n}\\s*=\\s*["']([^"']+)["']`));
  if (!m) throw new Error(`Could not read ${n} from homesignalmap.html`);
  return m[1];
};
const SB = grab('ENDPOINT').replace(/\/functions\/v1\/.*$/, '');
const KEY = grab('APIKEY');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const SAMPLE = process.env.SAMPLE ? parseInt(process.env.SAMPLE, 10) : 0;
const CONCURRENCY = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 8;
// STRIDE takes every Nth canonical ZIP. Deterministic and SPATIALLY SPREAD - ZIP codes are
// geographic, so every Nth one walks the whole country, while SAMPLE=n takes the first n and
// would report New England. Used when the full 12,722-ZIP walk does not fit the runner budget;
// the receipt must then say STRIDE and the ZIP count, because a sample is not a census.
const STRIDE = process.env.STRIDE ? parseInt(process.env.STRIDE, 10) : 0;

// The SHIPPED modules, loaded in the page's own order.
globalThis.window = globalThis;
for (const f of ['../lib/map.js', '../lib/residential-qualify.js', '../lib/n5-radius.js', '../lib/zip-authoritative.js']) {
  (0, eval)(readFileSync(new URL(f, import.meta.url), 'utf8'));
}
const HS = globalThis.window.HS;
const GATE = HS.residentialGateDrops;

// The product denominator. canonical_zip_registry is the source of truth for which ZIP pages
// exist, but it is not readable by the anon role, so the script falls back to app_community_meta
// (one row per materialised ZIP page) and REPORTS which source it used and how many ZIPs it got.
// A denominator that silently changed source would make every percentage below unreadable.
let ZIP_SOURCE = null;
async function pageAll(table, col) {
  const out = [];
  let last = '';
  for (;;) {
    const url = `${SB}/rest/v1/${table}?select=${col}&order=${col}.asc&limit=1000`
      + (last ? `&${col}=gt.${encodeURIComponent(last)}` : '');
    const r = await fetch(url, { headers: H });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows.length) break;
    for (const row of rows) out.push(row[col]);
    last = rows[rows.length - 1][col];
    if (SAMPLE && out.length >= SAMPLE) break;
  }
  return out;
}
async function canonicalZips() {
  for (const t of ['canonical_zip_registry', 'app_community_meta']) {
    const rows = await pageAll(t, 'zip');
    if (rows && rows.length) {
      ZIP_SOURCE = t;
      let uniq = Array.from(new Set(rows));
      if (STRIDE > 1) uniq = uniq.filter((_, i) => i % STRIDE === 0);
      return SAMPLE ? uniq.slice(0, SAMPLE) : uniq;
    }
  }
  throw new Error('no readable ZIP list (tried canonical_zip_registry, app_community_meta)');
}

const T = {
  zips_total: 0, zips_measurable: 0, zips_not_measured: 0, zips_unavailable: 0,
  zips_residential_before: 0, zips_residential_after: 0, zips_losing_residential: 0,
  zips_shrunk: 0, zips_measured_zero_residential: 0,
  obj_before: 0, obj_after: 0, obj_removed: 0,
  removed_ROUTINE: 0, removed_UNRESOLVED: 0,
  kept_stage: {}, kept_undated: 0, kept_label_street_number: 0, removed_label_street_number: 0,
  kept_by_family: {}, removed_by_family: {}, removed_by_rule: {},
  kept_rule: {}, other_types_before: 0, other_types_after: 0
};
const STREET = /[0-9]{2,6}\s+[A-Za-z]/;

// WHY THE REASON IS RECORDED: the first full run reported measurable:0 / unavailable:1279 while
// 11,494 ZIPs were boundary_complete - the instrument had not actually read anything, and a bare
// "unavailable" counter could not say whether that was an HTTP failure, an unrecognised status or
// a shape problem. "No data" and "did not run" must never be indistinguishable.
const REASONS = Object.create(null);
const reason = (k) => { REASONS[k] = (REASONS[k] || 0) + 1; };

async function oneZip(zip) {
  let payload;
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/app_zip_projects_markers`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ p_zip: zip, p_kind: 'development', p_authoritative: true }),
    });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 200);
      reason('http_' + r.status + ':' + body);
      T.zips_unavailable++; return;
    }
    payload = await r.json();
  } catch (e) { reason('threw:' + String(e && e.message).slice(0, 120)); T.zips_unavailable++; return; }

  const outcome = HS.zipAuthOutcome(payload);
  if (outcome !== 'complete') {
    reason('outcome_' + outcome + ' status=' + String(payload && payload.status)
      + ' projects=' + (Array.isArray(payload && payload.projects) ? 'array' : typeof (payload || {}).projects));
  }
  if (outcome === 'not_measured') { T.zips_not_measured++; return; }
  if (outcome !== 'complete') { T.zips_unavailable++; return; }
  T.zips_measurable++;

  // AFTER = the shipped build. BEFORE = the same function with the gate detached.
  const after = HS.zipAuthSitesFrom(payload);
  HS.residentialGateDrops = null;
  const before = HS.zipAuthSitesFrom(payload);
  HS.residentialGateDrops = GATE;

  const isRes = (s) => { try { return HS.resolveTrackerMarker(s).typeKey === 'residential'; } catch { return false; } };
  const byRef = Object.create(null);
  for (const p of payload.projects || []) if (p && p.project_ref) byRef[p.project_ref] = p;

  const beforeRes = before.filter(isRes);
  const afterRes = after.filter(isRes);
  const keptRefs = new Set(afterRes.map((s) => s.zip_project_ref));
  const uniq = (arr) => new Set(arr.map((s) => s.zip_project_ref)).size;

  T.other_types_before += before.length - beforeRes.length;
  T.other_types_after += after.length - afterRes.length;
  const nb = uniq(beforeRes), na = uniq(afterRes);
  T.obj_before += nb; T.obj_after += na; T.obj_removed += nb - na;
  if (nb > 0) T.zips_residential_before++;
  if (na > 0) T.zips_residential_after++; else if (nb > 0) T.zips_losing_residential++;
  if (na === 0 && nb === 0) T.zips_measured_zero_residential++;
  if (na > 0 && na < nb) T.zips_shrunk++;

  const seen = new Set();
  for (const s of beforeRes) {
    const ref = s.zip_project_ref;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const p = byRef[ref] || {};
    const fam = p.registry_id || '<none>';
    const v = HS.residentialActivity(p);
    if (keptRefs.has(ref)) {
      T.kept_by_family[fam] = (T.kept_by_family[fam] || 0) + 1;
      T.kept_rule[v.rule] = (T.kept_rule[v.rule] || 0) + 1;
      const st = p.status == null ? 'null' : String(p.status);
      T.kept_stage[st] = (T.kept_stage[st] || 0) + 1;
      if (!p.submitted_at) T.kept_undated++;
      if (STREET.test(String(p.name || ''))) T.kept_label_street_number++;
    } else {
      T.removed_by_family[fam] = (T.removed_by_family[fam] || 0) + 1;
      T.removed_by_rule[v.rule] = (T.removed_by_rule[v.rule] || 0) + 1;
      if (v.verdict === 'ROUTINE') T.removed_ROUTINE++; else T.removed_UNRESOLVED++;
      if (STREET.test(String(p.name || ''))) T.removed_label_street_number++;
    }
  }
}

const zips = await canonicalZips();
T.zips_total = zips.length;
let i = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const k = i++;
    if (k >= zips.length) return;
    await oneZip(zips[k]);
    if (k % 1000 === 0) console.log(`… ${k}/${zips.length}`);
  }
}));

const top = (o, n = 12) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
console.log('\n===== RESIDENTIAL MEASUREMENT =====');
console.log(JSON.stringify({
  measured_at: new Date().toISOString(),
  zip_source: ZIP_SOURCE,
  stride: STRIDE || 1,
  zips: {
    total: T.zips_total, measurable: T.zips_measurable, not_measured: T.zips_not_measured,
    unavailable: T.zips_unavailable,
    check_total: T.zips_measurable + T.zips_not_measured + T.zips_unavailable,
    residential_before: T.zips_residential_before, residential_after: T.zips_residential_after,
    losing_residential_entirely: T.zips_losing_residential, materially_shrunk: T.zips_shrunk,
    measured_zero_residential: T.zips_measured_zero_residential
  },
  objects: {
    residential_before: T.obj_before, residential_after: T.obj_after, removed: T.obj_removed,
    check: T.obj_before - T.obj_removed === T.obj_after,
    removed_ROUTINE: T.removed_ROUTINE, removed_UNRESOLVED: T.removed_UNRESOLVED,
    removed_check: T.removed_ROUTINE + T.removed_UNRESOLVED === T.obj_removed
  },
  control_other_types: { before: T.other_types_before, after: T.other_types_after,
    unchanged: T.other_types_before === T.other_types_after },
  kept_stage: T.kept_stage, kept_undated: T.kept_undated,
  labels: { kept_with_street_number: T.kept_label_street_number,
            removed_with_street_number: T.removed_label_street_number },
  kept_by_rule: T.kept_rule, removed_by_rule: T.removed_by_rule,
  kept_by_family: top(T.kept_by_family), removed_by_family: top(T.removed_by_family),
  non_complete_reasons: top(REASONS, 8)
}, null, 1));
