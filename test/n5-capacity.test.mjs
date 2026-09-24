// N5 disk capacity — ONE fail-closed decision, executed by the REQUIRED offline CI gate.
//
// The defect: seven builders each carried DISK_TOTAL_MB = 11607 (another 12288, another
// inlined 11607 into SQL). That constant was never a reading of the volume. On 2026-09-24
// the database was 11,292 MB + 1,024 MB WAL, so every builder computed NEGATIVE free space
// from a number the database had outgrown. A wrong constant can pass a build as easily as
// block one, so the fix is not a bigger constant: it is a dated record, an explicit refusal
// when that record is missing or contradicted, and a floor that can never be lowered.
//
// Shells out to python3 and calls the SHIPPED module (scripts/n5_capacity.py), never a copy
// of its rules — the same reason n5-shard-list-parsing.test.mjs does. No network, no DB:
// sql() is replaced by a fake that records whether it was called.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = join(root, 'scripts');
const tmp = mkdtempSync(join(tmpdir(), 'n5cap-'));

let fails = 0;
const ok = (cond, name) => {
  if (!cond) { fails++; console.error('FAIL ' + name); } else { console.log('ok   ' + name); }
};

// Run a python body against the shipped module. Returns {out, refused, reason}.
// `env` REPLACES the capacity-relevant env so a CI runner's own env cannot leak in.
const py = (body, env = {}) => {
  const base = { ...process.env };
  delete base.DISK_TOTAL_MB;
  delete base.DISK_FLOOR_MB;
  const prog = [
    'import sys, json',
    'sys.path.insert(0, sys.argv[1])',
    'import n5_capacity as C',
    'try:',
    ...body.split('\n').map((l) => '    ' + l),
    'except C.CapacityRefused as e:',
    '    print(json.dumps({"refused": True, "reason": e.reason}))',
  ].join('\n');
  const out = execFileSync('python3', ['-c', prog, scripts], {
    encoding: 'utf8', env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim().split('\n').pop();
  return JSON.parse(out);
};

const record = (name, obj) => {
  const p = join(tmp, name + '.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
};
const GOOD = {
  provisioned_disk_mb: 18000, non_database_mb: 0, recorded_at: '2026-09-24',
  recorded_by: 'founder', source: 'Supabase -> Project Settings -> Compute and Disk',
};

// ---------------------------------------------------------------- the committed record
{
  const r = py('C.load(); print(json.dumps({"refused": False}))');
  const committed = JSON.parse(readFileSync(join(root, 'data', 'db-capacity.json'), 'utf8'));
  if (committed.provisioned_disk_mb === null) {
    // The shipped state: unrecorded. It MUST refuse, or "unknown" has become "ample".
    ok(r.refused && /not recorded/.test(r.reason), 'an UNRECORDED committed capacity refuses');
  } else {
    // Once recorded, the committed record must itself validate.
    ok(!r.refused, 'the committed capacity record validates: ' + (r.reason || ''));
  }
}

// ---------------------------------------------------------------- record validation
{
  const p = record('good', GOOD);
  const r = py(`c = C.load(${JSON.stringify(p)}); print(json.dumps({"refused": False, "c": c}))`);
  ok(!r.refused && r.c.provisioned_disk_mb === 18000, 'a complete, dated record loads');

  const cases = [
    ['provisioned null', { ...GOOD, provisioned_disk_mb: null }, /not recorded/],
    ['provisioned zero', { ...GOOD, provisioned_disk_mb: 0 }, /out of range/],
    ['provisioned string', { ...GOOD, provisioned_disk_mb: '18000' }, /not a number/],
    ['provisioned boolean', { ...GOOD, provisioned_disk_mb: true }, /not a number/],
    ['non-database null', { ...GOOD, non_database_mb: null }, /not recorded/],
    ['non-database negative', { ...GOOD, non_database_mb: -1 }, /out of range/],
    ['non-database fills the volume', { ...GOOD, non_database_mb: 18000 }, /not smaller/],
    ['undated', { ...GOOD, recorded_at: null }, /not a date/],
    ['bad date', { ...GOOD, recorded_at: 'last week' }, /not a date/],
    ['compact date', { ...GOOD, recorded_at: '20260924' }, /not a date/],
    ['impossible date', { ...GOOD, recorded_at: '2026-02-30' }, /not a date/],
    ['date with garbage', { ...GOOD, recorded_at: '2026-09-24x' }, /not a date/],
    ['no source', { ...GOOD, source: '' }, /source is not recorded/],
    ['no recorder', { ...GOOD, recorded_by: null }, /recorded_by is not recorded/],
  ];
  for (const [name, obj, re] of cases) {
    const r2 = py(`C.load(${JSON.stringify(record(name.replace(/\W/g, '_'), obj))})\n` +
      'print(json.dumps({"refused": False, "reason": ""}))');
    ok(r2.refused && re.test(r2.reason), `refuses: ${name} -> ${r2.reason}`);
  }
  const missing = py(`C.load(${JSON.stringify(join(tmp, 'absent.json'))})`);
  ok(missing.refused && /does not exist/.test(missing.reason), 'a missing record refuses');
  const junk = join(tmp, 'junk.json');
  writeFileSync(junk, '{not json');
  const bad = py(`C.load(${JSON.stringify(junk)})`);
  ok(bad.refused && /unreadable/.test(bad.reason), 'an unparseable record refuses');

  // The retired override is a refusal, never a second answer — even with a good record.
  const ret = py(`C.load(${JSON.stringify(p)})\nprint(json.dumps({"refused": False, "reason": ""}))`,
    { DISK_TOTAL_MB: '11607' });
  ok(ret.refused && /retired/.test(ret.reason), 'DISK_TOTAL_MB is refused, not honoured');
}

// ---------------------------------------------------------------- the floor
{
  // repr() so a NaN floor reaches node as the string 'nan' rather than invalid JSON.
  const f = (v) => py('x = C.floor_mb()\nprint(json.dumps({"refused": False, "f": x if x == x else repr(x)}))',
    v === undefined ? {} : { DISK_FLOOR_MB: v });
  ok(f().f === 2048, 'floor defaults to 2048 MB');
  ok(f('4096').f === 4096, 'floor can be RAISED');
  ok(f('2048').f === 2048, 'floor at exactly 2048 is allowed');
  ok(f('2047').refused, 'floor can NOT be lowered (2047)');
  ok(f('0').refused, 'floor can NOT be zeroed');
  ok(f('nan').refused, 'a NaN floor refuses (NaN compares false to everything)');
  ok(f('lots').refused, 'a non-numeric floor refuses');
}

// ---------------------------------------------------------------- free space
{
  const p = record('free', { ...GOOD, non_database_mb: 500 });
  const free = (db, wal) => py(
    `print(json.dumps({"refused": False, "v": C.free_mb(${db}, ${wal}, C.load(${JSON.stringify(p)}))}))`);
  ok(free(11292, 1024).v === 18000 - 11292 - 1024 - 500, 'free = volume - (db + WAL + non-database)');
  // The shape of the incident: what the DB can see already fills the recorded volume.
  const stale = free(17000, 1024);
  ok(stale.refused && /stale/.test(stale.reason), 'a record the measurement contradicts refuses');
  ok(free(-1, 0).refused, 'a negative measurement refuses');
  ok(free('float("nan")', 0).refused, 'a NaN measurement refuses');
}

// ---------------------------------------------------------------- measure()
{
  // Unrecorded capacity must refuse BEFORE spending a query on a hot database.
  const unrec = record('unrec', { ...GOOD, provisioned_disk_mb: null });
  const r = py([
    'called = []',
    'def fake(q, tag="", read_only=False):',
    '    called.append(1); return [{"db": 1, "wal": 1}]',
    `C.measure(fake, ${JSON.stringify(unrec)})`,
  ].join('\n'));
  ok(r.refused, 'measure() refuses on an unrecorded capacity');
  const r2 = py([
    'called = []',
    'def fake(q, tag="", read_only=False):',
    '    called.append(1); return [{"db": 1, "wal": 1}]',
    `try:\n    C.measure(fake, ${JSON.stringify(unrec)})`,
    'except C.CapacityRefused:',
    '    print(json.dumps({"refused": False, "calls": len(called)}))',
  ].join('\n'));
  ok(r2.calls === 0, 'measure() never queries the database when capacity is unknown');

  const good = record('measure', GOOD);
  const m = py([
    'seen = {}',
    'def fake(q, tag="", read_only=False):',
    '    seen["ro"] = read_only; return [{"db": 11292, "wal": 1024}]',
    `f = C.measure(fake, ${JSON.stringify(good)})`,
    'print(json.dumps({"refused": False, "f": f, "ro": seen["ro"]}))',
  ].join('\n'));
  ok(JSON.stringify(m.f) === JSON.stringify([18000 - 12316, 11292, 1024]), 'measure() returns (free, db, wal)');
  ok(m.ro === true, 'the disk measurement is sent read_only');
  const empty = py([
    'def fake(q, tag="", read_only=False): return []',
    `C.measure(fake, ${JSON.stringify(good)})`,
  ].join('\n'));
  ok(empty.refused && /no row/.test(empty.reason), 'an empty measurement refuses');
}

// ---------------------------------------------------------------- headroom + projection
{
  const h = (free, need) => py(
    `print(json.dumps({"refused": False, "v": C.require_headroom(${free}, ${need}, 2048, "open")}))`);
  ok(h(5684, 3200).v === 2484, 'headroom passes when free - need stays above the floor');
  ok(h(5684, 3700).refused, 'headroom refuses when free - need falls below the floor');
  ok(h(5684, 3636).v === 2048, 'landing exactly on the floor is allowed');
  ok(h(5684, -1).refused, 'a negative projection refuses');

  const proj = (row) => py([
    `def fake(q, tag="", read_only=False): return [${row}]`,
    'print(json.dumps({"refused": False, "p": C.projected_generation_mb(fake)}))',
  ].join('\n'));
  const p = proj('{"build_mb": 1800, "capture_rel_mb": 1500, "capture_rel_rows": 3000000, ' +
    '"live_rows": 3100000, "max_wal_mb": 4096, "wal_mb": 1024}');
  ok(!p.refused && Math.abs(p.p.capture_mb - 1550) < 1e-6, 'capture scales per-row size by live rows');
  ok(p.p.wal_reserve_mb === 3072, 'WAL reserve is room to grow to max_wal_size');
  ok(Math.abs(p.p.total_mb - (1550 + 1800 + 3072)) < 1e-6, 'total is the sum of its parts');
  const never = proj('{"build_mb": 1, "capture_rel_mb": 1, "capture_rel_rows": 0, ' +
    '"live_rows": 1, "max_wal_mb": 1, "wal_mb": 1}');
  ok(never.refused, 'an un-analysed relation (reltuples <= 0) refuses rather than projecting 0');
  const src = readFileSync(join(scripts, 'n5_capacity.py'), 'utf8');
  ok(!/count\(\*\)\s+from\s+public\.app_projects/i.test(src),
    'the projection never full-scans app_projects (the database is running hot)');
}

// ---------------------------------------------------------------- one decision, everywhere
{
  const py_files = readdirSync(scripts).filter((f) => f.endsWith('.py') && f !== 'n5_capacity.py');
  const offenders = [];
  for (const f of py_files) {
    const s = readFileSync(join(scripts, f), 'utf8');
    if (/\b11607\b|\b12288\b|DISK_TOTAL_MB|\bTOTAL_MB\b|DISK_OTHER_MB/.test(s)) offenders.push(f + ' (volume constant)');
    if (/environ\.get\(\s*["']DISK_FLOOR_MB/.test(s)) offenders.push(f + ' (own floor)');
  }
  ok(offenders.length === 0, 'no script carries its own volume size or floor: ' + offenders.join(', '));

  const builders = ['n5_shard.py', 'n5_boundary_first.py', 'n5_unit_a_shadow.py', 'n5_a3_markers.py',
    'n5_a3_clip_stats.py', 'n5_a4_index.py', 'n5_recon_population.py', 'n5_orchestrate.py',
    'phase2_b3_geometry.py'];
  for (const b of builders) {
    ok(/import n5_capacity/.test(readFileSync(join(scripts, b), 'utf8')), `${b} uses n5_capacity`);
  }

  // The orchestrator must check headroom BEFORE the one-transaction capture, or a full
  // volume is discovered half-way through a 3 GB insert.
  const orch = readFileSync(join(scripts, 'n5_orchestrate.py'), 'utf8');
  const openBody = orch.slice(orch.indexOf('def mode_open'), orch.indexOf('def mode_work'));
  const gate = openBody.indexOf('require_headroom(');
  const capture = openBody.indexOf('insert into preservation.app_project_identity');
  ok(gate > 0 && capture > 0 && gate < capture, 'open checks headroom before the capture insert');
  ok(openBody.indexOf('projected_generation_mb(') > 0 && openBody.indexOf('projected_generation_mb(') < capture,
    'open projects the generation size before the capture insert');
}

if (fails) { console.error(`\n${fails} failure(s)`); process.exit(1); }
console.log('\nall n5-capacity checks passed');
