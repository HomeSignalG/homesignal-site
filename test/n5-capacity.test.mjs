// N5 disk capacity — ONE fail-closed decision, executed by the REQUIRED offline CI gate.
//
// The defect: seven builders each carried DISK_TOTAL_MB = 11607 and compared free space to
// their own floor. On 2026-09-24 the database was 11,292 MB + 1,024 MB WAL, so every builder
// computed NEGATIVE free space. The first repair (#1330 v1) centralised the reading but a
// competitor-CTO audit found it still fail-open: n5-acquire measured and never compared,
// `Infinity` passed, a value in bytes passed, units and age were ignored, a branch could
// supply the record, and the tests only checked that builders IMPORTED the module.
//
// So this suite tests BEHAVIOUR. test/n5_capacity/harness.py runs each builder's REAL entry
// point against a fake database that records every write statement and blocks the network,
// once per capacity scenario. A builder passes only if every bad scenario is refused BY THE
// CAPACITY GATE with ZERO writes and ZERO network, and the ample scenario passes the gate
// (so the refusals cannot be vacuous).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = join(root, 'scripts');

let fails = 0;
const ok = (cond, name) => {
  if (!cond) { fails++; console.error('FAIL ' + name); } else { console.log('ok   ' + name); }
};

const cleanEnv = () => {
  const e = { ...process.env };
  for (const k of ['DISK_TOTAL_MB', 'DISK_FLOOR_MB', 'GITHUB_ACTIONS', 'GITHUB_REF', 'GITHUB_SHA']) delete e[k];
  return e;
};

// Run a python body against the shipped module; the body must print one JSON line.
const py = (body, env = {}) => {
  const prog = [
    'import sys, json, datetime, functools',
    // allow_nan=False: an infinite or NaN result becomes an exception reported as data,
    // never the non-JSON token Infinity that would crash the parse below.
    'json.dumps = functools.partial(json.dumps, allow_nan=False)',
    'sys.path.insert(0, sys.argv[1])',
    'import n5_capacity as C',
    'NOW = datetime.datetime(2026, 9, 24, 22, 0, tzinfo=datetime.timezone.utc)',
    'try:',
    ...body.split('\n').map((l) => '    ' + l),
    'except C.CapacityRefused as e:',
    '    print(json.dumps({"refused": True, "reason": e.reason}))',
    // Any other exception is reported as DATA, so a broken rule fails an assertion by
    // name instead of crashing the suite (a crash is red, but it says nothing).
    'except Exception as e:',
    '    print(json.dumps({"refused": False, "reason": "", "error": repr(e)}))',
  ].join('\n');
  const out = execFileSync('python3', ['-c', prog, scripts], {
    encoding: 'utf8', env: { ...cleanEnv(), ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim().split('\n').pop();
  return JSON.parse(out);
};

// ================================================================ 1. the committed record
{
  const text = readFileSync(join(root, 'data', 'db-capacity.json'), 'utf8');
  const r = py(`C.parse_record(${JSON.stringify(text)}, NOW)\nprint(json.dumps({"refused": False}))`);
  const committed = JSON.parse(text);
  if (committed.provisioned_disk.value === null) {
    ok(r.refused && /not recorded/.test(r.reason), 'the shipped, UNRECORDED record refuses');
  } else {
    ok(!r.refused, 'the committed record validates: ' + (r.reason || ''));
  }
}

// ================================================================ 2. record schema, units, time
const GOOD = {
  provisioned_disk: { value: 18, unit: 'GB' },
  non_database_usage: { value: 500, unit: 'MiB' },
  observed_at: '2026-09-24T20:00:00Z',
  recorded_by: 'founder',
  source: 'Supabase -> Project Settings -> Compute and Disk',
};
const parse = (textOrObj) => {
  const text = typeof textOrObj === 'string' ? textOrObj : JSON.stringify(textOrObj);
  return py(`r = C.parse_record(${JSON.stringify(text)}, NOW)\nprint(json.dumps({"refused": False, "r": r}))`);
};
{
  const g = parse(GOOD);
  ok(!g.refused && Math.abs(g.r.provisioned_mib - 18e9 / 1048576) < 1e-6,
    'decimal GB normalises to MiB exactly: 18 GB = 17,166.14 MiB');
  const gi = parse({ ...GOOD, provisioned_disk: { value: 18, unit: 'GiB' } });
  ok(gi.r.provisioned_mib === 18432, 'GiB normalises exactly: 18 GiB = 18,432 MiB');
  const mb = parse({ ...GOOD, provisioned_disk: { value: 18000, unit: 'MB' } });
  ok(Math.abs(mb.r.provisioned_mib - 18000e6 / 1048576) < 1e-6, 'decimal MB is not MiB');
  ok(g.r.non_database_mib === 500, 'non-database usage normalises too');

  const Q = (v, u) => ({ ...GOOD, provisioned_disk: { value: v, unit: u } });
  const refusals = [
    ['empty file', '', /unreadable/],
    ['malformed JSON', '{not json', /unreadable/],
    ['not an object', '[1,2]', /not a JSON object/],
    ['empty object', '{}', /missing/],
    ['NaN token (rejected at PARSE)', JSON.stringify(Q(1, 'GB')).replace('"value":1', '"value":NaN'), /unreadable: NaN is not a number/],
    ['Infinity token (rejected at PARSE)', JSON.stringify(Q(1, 'GB')).replace('"value":1', '"value":Infinity'), /unreadable: Infinity is not a number/],
    ['-Infinity token (rejected at PARSE)', JSON.stringify(Q(1, 'GB')).replace('"value":1', '"value":-Infinity'), /unreadable: \-Infinity is not a number/],
    ['overflowing literal 1e400', JSON.stringify(Q(1, 'GB')).replace('"value":1', '"value":1e400'), /not finite/],
    ['zero', Q(0, 'GB'), /out of range/],
    ['negative', Q(-5, 'GB'), /out of range/],
    ['string number', Q('18', 'GB'), /not a number/],
    ['boolean', Q(true, 'GB'), /not a number/],
    ['null value', Q(null, 'GB'), /not recorded/],
    ['missing unit', { ...GOOD, provisioned_disk: { value: 18 } }, /exactly 'value' and 'unit'/],
    ['unsupported unit TB', Q(18, 'TB'), /unit='TB'/],
    ['unit case variant gb', Q(18, 'gb'), /unit='gb'/],
    ['unit bytes', Q(18e9, 'B'), /unit='B'/],
    ['extra key inside quantity', { ...GOOD, provisioned_disk: { value: 18, unit: 'GB', note: 'x' } }, /exactly/],
    ['bare number (no unit object)', { ...GOOD, provisioned_disk: 18 }, /exactly/],
    ['unknown top-level field', { ...GOOD, provisioned_gb: 18 }, /unknown field/],
    ['legacy v1 field name', { ...GOOD, provisioned_disk_mb: 18000 }, /unknown field/],
    ['missing required field', (({ source, ...x }) => x)(GOOD), /missing/],
    ['non-database >= provisioned', { ...GOOD, non_database_usage: { value: 18, unit: 'GB' } }, /not smaller/],
    ['date only, no time', { ...GOOD, observed_at: '2026-09-24' }, /ISO-8601/],
    ['no timezone', { ...GOOD, observed_at: '2026-09-24T20:00:00' }, /ISO-8601/],
    ['compact timestamp', { ...GOOD, observed_at: '20260924T200000Z' }, /ISO-8601/],
    ['impossible date', { ...GOOD, observed_at: '2026-02-30T20:00:00Z' }, /not a real date/],
    ['free text time', { ...GOOD, observed_at: 'yesterday' }, /ISO-8601/],
    ['future (beyond skew)', { ...GOOD, observed_at: '2026-09-24T23:00:00Z' }, /future/],
    ['stale: 24 h 1 min old', { ...GOOD, observed_at: '2026-09-23T21:59:00Z' }, /old/],
    ['stale: last year', { ...GOOD, observed_at: '2025-09-24T20:00:00Z' }, /old/],
    ['no source', { ...GOOD, source: ' ' }, /source is not recorded/],
    ['no recorder', { ...GOOD, recorded_by: null }, /recorded_by is not recorded/],
  ];
  for (const [name, input, re] of refusals) {
    const r = parse(input);
    ok(r.refused && re.test(r.reason), `refuses: ${name} -> ${r.reason || 'ACCEPTED'}`);
  }
  ok(!parse({ ...GOOD, observed_at: '2026-09-23T22:01:00Z' }).refused, 'a 23 h 59 min reading is still fresh');
  ok(!parse({ ...GOOD, observed_at: '2026-09-24T22:05:00Z' }).refused, 'a reading 5 min ahead (clock skew) is tolerated');
  ok(!parse({ ...GOOD, observed_at: '2026-09-24T15:00:00-05:00' }).refused, 'a timezone offset is honoured');
}

// ================================================================ 3. the floor
{
  const f = (v) => py('x = C.floor_mb()\nprint(json.dumps({"refused": False, "f": x}))',
    v === undefined ? {} : { DISK_FLOOR_MB: v });
  ok(f().f === 2048, 'floor defaults to 2048');
  ok(f('4096').f === 4096, 'floor can be RAISED');
  ok(f('2048').f === 2048, 'floor at exactly 2048 is allowed');
  for (const v of ['2047', '0', '-1', 'nan', 'inf', 'lots']) ok(f(v).refused, `floor refuses DISK_FLOOR_MB=${v}`);
}

// ================================================================ 4. arithmetic + plausibility
{
  const cap = (prov, nondb = 0) => `{"provisioned_mib": ${prov}, "non_database_mib": ${nondb}, "observed_at": "t", "age_hours": 1}`;
  const free = (prov, db, wal, nondb = 0) => py(
    `print(json.dumps({"refused": False, "v": C.free_mib(${db}, ${wal}, ${cap(prov, nondb)})}))`);
  ok(free(18000, 11292, 1024, 500).v === 18000 - 11292 - 1024 - 500, 'free = volume - (db + WAL + non-database)');
  ok(free(12316, 11292, 1024).refused, 'use == volume refuses (stale or not the provisioned size)');
  ok(free(12000, 11292, 1024).refused, 'use > volume refuses');
  ok(free(100 * 12316, 11292, 1024).v > 0, 'exactly 100x measured use is accepted');
  const big = free(100 * 12316 + 1, 11292, 1024);
  ok(big.refused && /unit mistake/.test(big.reason), 'more than 100x measured use refuses as a unit mistake');
  ok(free(18e9, 11292, 1024).refused, 'bytes typed as MiB refuses');
  ok(free(18000, -1, 0).refused && free(18000, 'float("nan")', 0).refused && free(18000, 'float("inf")', 0).refused,
    'negative / NaN / infinite measurements refuse');
}

// ================================================================ 5. trust boundary
{
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const trust = (env, path = 'C.RECORD_PATH', extra = '') => py(
    `${extra}C.check_trusted_source(${path})\nprint(json.dumps({"refused": False}))`, env);
  const MAIN = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: head };
  ok(/Actions/.test(trust({}).reason), 'outside GitHub Actions: refused');
  ok(/feature/.test(trust({ ...MAIN, GITHUB_REF: 'refs/heads/feature' }).reason), 'a feature-branch run: refused');
  ok(/refs\/pull/.test(trust({ ...MAIN, GITHUB_REF: 'refs/pull/1330/merge' }).reason), 'a pull_request run: refused');
  ok(/triggering main commit/.test(trust({ ...MAIN, GITHUB_SHA: '0'.repeat(40) }).reason),
    'main ref but a different commit checked out: refused');
  ok(/triggering main commit/.test(trust({ ...MAIN, GITHUB_SHA: '' }).reason), 'GITHUB_SHA unset: refused');
  ok(/must come from/.test(trust(MAIN, '"/tmp/x.json"').reason), 'a record at any other path: refused');
  ok(/differs from the copy committed/.test(trust(MAIN, 'C.RECORD_PATH', 'C._git_committed = lambda rel: b"{}"\n').reason),
    'a record edited during the run (differs from HEAD): refused');
  ok(!trust(MAIN).refused, 'POSITIVE CONTROL: main, triggering commit, committed file -> trusted');
  const ret = py(`C.load(None, None, NOW)\nprint(json.dumps({"refused": False}))`, { DISK_TOTAL_MB: '11607' });
  ok(ret.refused && /retired/.test(ret.reason), 'DISK_TOTAL_MB is refused, never honoured');
}

// ================================================================ 6. peak-space projection
{
  const proj = (temp, sk) => py([
    'def fake(q, tag="", read_only=False):',
    '    if "as build_mib" in q:',
    `        return [{"build_mib": 1400, "capture_rel_mib": 1453, "capture_rel_rows": 3172292, "live_rows": 3115623, "temp_limit_kb": ${temp}}]`,
    `    return [{"mw": 4096, "sk": ${sk}, "wk": 0, "wal": 1024}]`,
    'p = C.generation_projection(fake)',
    'print(json.dumps({"refused": False, "p": p}))',
  ].join('\n'));
  const p = proj(-1, 2048).p;
  const c = Object.fromEntries(p.components.map((x) => [x.component, x]));
  ok(Math.abs(c.capture.mib - 1453 / 3172292 * 3115623) < 1e-6, 'capture = measured per-row size x live rows');
  ok(c.generation_tables.mib === 1400 && c.dead_row_rewrite.mib === 1400, 'build tables + one dead copy');
  ok(c.wal.mib === 4096 + 2048 - 1024, 'WAL = max_wal_size + slot keep + wal_keep - current');
  ok(c.n5_geom_growth.status === 'UNMODELED' && c.n5_geom_growth.mib === null, 'n5_geom growth is UNMODELED, not zero');
  ok(c.temp_files.status === 'UNMODELED', 'temp files are UNMODELED while temp_file_limit = -1');
  ok(p.unmodeled.includes('n5_geom_growth') && p.unmodeled.includes('temp_files'), 'unmodeled list names both');
  ok(proj(1048576, 2048).p.components.find((x) => x.component === 'temp_files').mib === 1024,
    'a set temp_file_limit models temp space (1 GiB)');
  ok(proj(-1, -1).p.components.find((x) => x.component === 'wal').status === 'UNMODELED',
    'unbounded slot WAL retention is UNMODELED');
  const never = py([
    'def fake(q, tag="", read_only=False):',
    '    return [{"build_mib": 1, "capture_rel_mib": 1, "capture_rel_rows": 0, "live_rows": 1, "temp_limit_kb": 1, "mw": 1, "sk": 1, "wk": 0, "wal": 0}]',
    'C.generation_projection(fake)',
  ].join('\n'));
  ok(never.refused, 'an un-analysed relation (reltuples <= 0) refuses rather than projecting 0');
  const src = readFileSync(join(scripts, 'n5_capacity.py'), 'utf8');
  ok(!/count\(\*\)\s+from\s+public\.app_projects/i.test(src), 'the projection never full-scans app_projects');
}

// ================================================================ 7. EVERY BUILDER, BEHAVIOURALLY
const BUILDERS = ['shard', 'shard_advance', 'acquire', 'boundary_first', 'unit_a', 'a3_markers', 'a3_clip', 'a4_index',
  'recon', 'recon_chunk', 'verify', 'open', 'b3_load', 'b3_nvdot', 'zcta_reload'];
// Builders whose fake database lets the ample run reach a real write statement - the proof
// that the harness can SEE a write, so "0 writes" on a refusal is a measurement.
const SEES_WRITE = ['shard', 'boundary_first', 'unit_a', 'a3_markers', 'a3_clip', 'a4_index', 'verify'];
for (const b of BUILDERS) {
  const raw = execFileSync('python3', [join(root, 'test', 'n5_capacity', 'harness.py'), b],
    { encoding: 'utf8', env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const line = raw.split('\n').find((l) => l.startsWith('HARNESS_JSON '));
  if (!line) { ok(false, `${b}: harness produced no result`); continue; }
  const res = JSON.parse(line.slice('HARNESS_JSON '.length));
  for (const [scenario, r] of Object.entries(res)) {
    if (scenario === 'ample') continue;
    ok(r.capacity && r.writes === 0 && r.network === 0 && r.gates_passed === 0,
      `${b} / ${scenario}: refused by the capacity gate before any write ` +
      `(capacity=${r.capacity} writes=${r.writes} network=${r.network}) ${r.reason.slice(0, 70)}`);
  }
  const a = res.ample;
  if (b === 'open') {
    ok(a.capacity && /UNMODELED/.test(a.reason) && a.writes === 0,
      'open / ample: STILL refused - the peak projection has unmodeled terms, so no national generation opens');
  } else {
    ok(a.gates_passed >= 1, `${b} / ample: POSITIVE CONTROL - the gate passes a valid, ample reading`);
    if (SEES_WRITE.includes(b)) ok(a.writes >= 1, `${b} / ample: the harness observed the builder's first write`);
  }
}

// ================================================================ 8. one decision, every path
{
  const pyFiles = readdirSync(scripts).filter((f) => f.endsWith('.py') && f !== 'n5_capacity.py');
  const offenders = [];
  for (const f of pyFiles) {
    const s = readFileSync(join(scripts, f), 'utf8');
    if (/\b11607\b|\b12288\b|DISK_TOTAL_MB|\bTOTAL_MB\b|DISK_OTHER_MB|\bFLOOR_MB\b|DISK_STOP_MB|SAFETY_FLOOR/.test(s)) offenders.push(`${f} (own constant)`);
    if (/environ\.get\(\s*["']DISK_FLOOR_MB/.test(s)) offenders.push(`${f} (own floor)`);
    if (/n5_capacity\.(floor_mb|free_mib|parse_record|load|check_trusted_source)\(/.test(s)) offenders.push(`${f} (re-decides)`);
  }
  ok(offenders.length === 0, 'no script carries a volume constant, a floor, or its own decision: ' + offenders.join(', '));

  // Every script a workflow runs that writes to the database is either GATED (proven in §7)
  // or EXCLUDED with a reason. A new bulk builder cannot appear without a decision here.
  const GATED = new Set(['n5_shard.py', 'n5_acquire_registry.py', 'n5_boundary_first.py', 'n5_unit_a_shadow.py',
    'n5_a3_markers.py', 'n5_a3_clip_stats.py', 'n5_a4_index.py', 'n5_recon_population.py',
    'n5_verify_snapshot.py', 'n5_orchestrate.py', 'phase2_b3_geometry.py', 'phase2_b1_zcta.py']);
  const EXCLUDED = {
    // The N3 pilot is pinned to two batch keys (786 | 207: 37 ZCTAs, 454 projects). All of
    // its geo.n3_* tables together measured ~7 MB on 2026-09-24; it cannot allocate at scale.
    'n3_pilot.py': 'bounded pilot, ~7 MB total',
  };
  const WRITE = /insert\s+into|create\s+(table|index|unique)|delete\s+from|truncate\s|update\s+[a-z_.]+\s+set/i;
  const wf = join(root, '.github', 'workflows');
  const invoked = new Set();
  for (const f of readdirSync(wf)) {
    for (const m of readFileSync(join(wf, f), 'utf8').matchAll(/scripts\/([A-Za-z0-9_]+\.py)/g)) invoked.add(m[1]);
  }
  const ungated = [...invoked].filter((f) => {
    let s; try { s = readFileSync(join(scripts, f), 'utf8'); } catch { return false; }
    return WRITE.test(s) && (f.startsWith('n5_') || f.startsWith('n3_') || f.startsWith('phase2_'))
      && !GATED.has(f) && !(f in EXCLUDED);
  });
  ok(ungated.length === 0, 'every workflow-run geography writer is gated or excluded with a reason: ' + ungated.join(', '));
  ok(GATED.has('n5_acquire_registry.py') && invoked.has('n5_acquire_registry.py'), 'n5-acquire is on the gated list');

  // The ZCTA reload's network acquisition precedes its gate, so §7 drives the gate directly;
  // this pins that main() calls it BEFORE the first write.
  const z = readFileSync(join(scripts, 'phase2_b1_zcta.py'), 'utf8');
  const zm = z.slice(z.indexOf('\ndef main('));
  ok(zm.indexOf('zcta_capacity_gate(') > 0 && zm.indexOf('zcta_capacity_gate(') < zm.indexOf('build_prepare_sql('),
    'phase2_b1_zcta main() gates before its first write');
  // MID-RUN checks: the harness stops at a builder's FIRST write, so the checks that run
  // after it are proven two ways - the decision functions behaviourally in section 7
  // (shard_advance, recon_chunk), and their call sites here.
  const shard = readFileSync(join(scripts, 'n5_shard.py'), 'utf8');
  const rs = shard.slice(shard.indexOf('def run_shard'), shard.indexOf('def halt('));
  ok(rs.includes('disk_ok, cr = shard_advance_capacity(z3)') && rs.includes('if verified and disk_ok:'),
    'n5_shard advances a shard only on the capacity decision');
  const recon = readFileSync(join(scripts, 'n5_recon_population.py'), 'utf8');
  const loop = recon.slice(recon.indexOf('done += CHUNK'));
  ok(loop.indexOf('chunk_gate(k, parts)') > 0 && loop.indexOf('chunk_gate(k, parts)') < loop.indexOf('% 10 == 0'),
    'recon gates EVERY chunk, before (not inside) the every-tenth report');
  const MIN_GATES = { 'n5_boundary_first.py': 2, 'n5_unit_a_shadow.py': 2, 'n5_a3_markers.py': 2,
    'n5_a3_clip_stats.py': 2, 'n5_a4_index.py': 2, 'n5_verify_snapshot.py': 2, 'n5_acquire_registry.py': 1,
    'n5_recon_population.py': 2, 'n5_shard.py': 2 };
  for (const [f, min] of Object.entries(MIN_GATES)) {
    const n = (readFileSync(join(scripts, f), 'utf8').match(/n5_capacity\.(require_capacity|capacity_ok)\(/g) || []).length;
    ok(n >= min, `${f}: ${n} capacity gate call(s), start + after-work (min ${min})`);
  }
  const o = readFileSync(join(scripts, 'n5_orchestrate.py'), 'utf8');
  const ob = o.slice(o.indexOf('def mode_open'), o.indexOf('def mode_work'));
  ok(ob.indexOf('require_generation_fits(') > 0 &&
     ob.indexOf('require_generation_fits(') < ob.indexOf('insert into preservation.app_project_identity'),
    'open gates the generation before the capture insert');
}

if (fails) { console.error(`\n${fails} failure(s)`); process.exit(1); }
console.log('\nall n5-capacity checks passed');
