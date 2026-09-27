// OpenAddresses health recovery: loader scope/lockstep, city-less keys, datasetRung fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const rerun = spawnSync(process.execPath, ['--experimental-strip-types', here, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  process.exit(rerun.status ?? 1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOADER = join(root, 'scripts/load-openaddresses.py');
const CANON = join(root, 'supabase/functions/get-address-report/canonical-addr.ts');

function py(code) {
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8', cwd: root });
  if (r.status !== 0) {
    throw new Error(`python failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

function lastJson(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

const LOAD = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("oa", ${JSON.stringify(LOADER)})
oa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oa)
`;

const VECTORS = [
  '2200 Caldwell Lane, Del Valle, TX 78617',
  '2200 Caldwell Ln, Del Valle, TX, 78617',
  '10 Oak Avenue, Austin, Texas 78701',
  '100 Main Street',
  '4035 E SH 71 SVRD WB, Del Valle, TX 78617',
  '10 Oak Ave, TX 78617',
  '  500  Parkway. Drive,  Salt Lake City,  Utah  84101  ',
];

test('Python canonical_addr matches TypeScript canonicalAddr on the lockstep vectors', async () => {
  const { canonicalAddr } = await import(CANON);
  const quoted = VECTORS.map((v) => JSON.stringify(v)).join(', ');
  const raw = py(`${LOAD}
print(json.dumps([oa.canonical_addr(x) for x in [${quoted}]]))
`);
  const pyOut = JSON.parse(raw);
  const tsOut = VECTORS.map((v) => canonicalAddr(v));
  assert.deepEqual(pyOut, tsOut);
});

test('merge_scope uses demand pairs unless ZIPS/STATES override', () => {
  const raw = py(`${LOAD}
pairs = [("78617","TX"),("98104","WA"),("02108","MA")]
print(json.dumps([
  sorted(oa.merge_scope(pairs, [], [])[0]),
  sorted(oa.merge_scope(pairs, [], [])[1]),
  sorted(oa.merge_scope(pairs, ["78617"], [])[0]),
  sorted(oa.merge_scope(pairs, ["78617"], [])[1]),
  sorted(oa.merge_scope(pairs, ["78617"], ["WA"])[1]),
]))
`);
  const [zAll, sAll, zOne, sOne, sForce] = JSON.parse(raw);
  assert.deepEqual(zAll, ['02108', '78617', '98104']);
  assert.deepEqual(sAll, ['MA', 'TX', 'WA']);
  assert.deepEqual(zOne, ['78617']);
  assert.deepEqual(sOne, ['TX']);
  assert.deepEqual(sForce, ['WA']);
});

test('extract_zip / extract_state / cityless_key cover the demand and no-city shapes', () => {
  const raw = py(`${LOAD}
print(json.dumps({
  "z1": oa.extract_zip("2200 CALDWELL LN, DEL VALLE, TX 78617"),
  "s1": oa.extract_state("2200 CALDWELL LN, DEL VALLE, TX 78617"),
  "z2": oa.extract_zip("10 OAK AVE"),
  "s2": oa.extract_state("10 OAK AVE"),
  "z3": oa.extract_zip("10 OAK AVE, TX 78617-1234"),
  "s3": oa.extract_state("10 oak ave, tx 78617-1234"),
  "c1": oa.cityless_key("2200 CALDWELL LN, DEL VALLE, TX 78617"),
  "c2": oa.cityless_key("2200 CALDWELL LN, TX 78617"),
  "sz1": oa.street_zip_key("2200 CALDWELL LN, DEL VALLE, TX 78617"),
  "sz2": oa.street_zip_key("2200 CALDWELL LN, TX 78617"),
  "sz3": oa.street_zip_key("CALDWELL LN, TX 78617"),
  "sz4": oa.street_zip_key("3521 RAIDER DR"),
  "hs1": oa.housestreet_key("2200 CALDWELL LN, DEL VALLE, TX 78617"),
  "hs2": oa.housestreet_key("2200 CALDWELL LN, TX 78617"),
  "hs3": oa.housestreet_key("3521 RAIDER DR"),
}))
`);
  const d = JSON.parse(raw);
  assert.equal(d.z1, '78617');
  assert.equal(d.s1, 'TX');
  assert.equal(d.z2, '');
  assert.equal(d.s2, '');
  assert.equal(d.z3, '78617');
  assert.equal(d.s3, 'TX');
  assert.equal(d.c1, '2200 CALDWELL LN, TX 78617');
  assert.equal(d.c2, null);
  assert.equal(d.sz1, 'CALDWELL LN, TX 78617');
  assert.equal(d.sz2, 'CALDWELL LN, TX 78617');
  assert.equal(d.sz3, 'CALDWELL LN, TX 78617');
  assert.equal(d.sz4, null);
  assert.equal(d.hs1, '2200 CALDWELL LN');
  assert.equal(d.hs2, '2200 CALDWELL LN');
  assert.equal(d.hs3, '3521 RAIDER DR');
});

test('enqueue stores the city-less key once, first-wins on the full key', () => {
  const raw = py(`${LOAD}
seen, batch = set(), []
oa.enqueue(seen, batch, "v", "t", "2200 CALDWELL LN, DEL VALLE, TX 78617", 30.1, -97.6, "TX", "travis.csv", "parcel_centroid")
oa.enqueue(seen, batch, "v", "t", "2200 CALDWELL LN, DEL VALLE, TX 78617", 99.0, 99.0, "TX", "capcog.csv", "parcel_centroid")
print(json.dumps(batch))
`);
  const batch = JSON.parse(raw);
  assert.equal(batch.length, 2);
  assert.equal(batch[0].canonical_addr, '2200 CALDWELL LN, DEL VALLE, TX 78617');
  assert.equal(batch[1].canonical_addr, '2200 CALDWELL LN, TX 78617');
  assert.equal(batch[0].lat, 30.1);
  assert.equal(batch[0].source_vintage, 'v');
  assert.equal(batch[0].loaded_at, 't');
});

test('parse_region quarantines one bad member and still yields the good one; BadZipFile is fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-health-'));
  const goodZip = join(dir, 'good.zip');
  const badZip = join(dir, 'bad.zip');
  const helper = join(dir, 'mk.py');
  writeFileSync(helper, `
import zipfile, csv, io, os
z = zipfile.ZipFile(${JSON.stringify(goodZip)}, "w")
buf = io.StringIO()
w = csv.DictWriter(buf, fieldnames=["number","street","city","region","postcode","lat","lon"])
w.writeheader()
w.writerow({"number":"10","street":"Oak Avenue","city":"Del Valle","region":"TX","postcode":"78617","lat":"30.1","lon":"-97.6"})
z.writestr("us/tx/good.csv", buf.getvalue())
z.writestr("us/tx/bad.csv", "not-a-csv\\x00\\xff")
z.close()
open(${JSON.stringify(badZip)}, "wb").write(b"not a zip")
`);
  const mk = spawnSync('python3', [helper], { encoding: 'utf8' });
  assert.equal(mk.status, 0, mk.stderr);
  const raw = py(`${LOAD}
import json
stats = {"quarantined": 0}
rows = list(oa.parse_region("us_south", {"TX"}, {"78617"}, ${JSON.stringify(goodZip)}, stats))
print(json.dumps({"rows": rows, "q": stats["quarantined"]}))
`);
  const got = lastJson(raw);
  assert.ok(got.rows.length >= 1);
  // BadZipFile must exit non-zero
  const fatal = spawnSync('python3', ['-c', `${LOAD}
import sys
stats = {"quarantined": 0}
try:
    list(oa.parse_region("us_south", {"TX"}, {"78617"}, ${JSON.stringify(badZip)}, stats))
except SystemExit as e:
    print("FATAL", e)
    sys.exit(0)
print("NO_EXIT")
sys.exit(2)
`], { encoding: 'utf8', cwd: root });
  assert.equal(fatal.status, 0, fatal.stderr);
  assert.match(fatal.stdout, /FATAL: us_south collection is not a valid zip/);
  assert.ok(got.rows.length >= 1);
  assert.equal(got.rows[0][0], '10 OAK AVE, DEL VALLE, TX 78617');
});

test('parse_region quarantines a member that raises and keeps the next member', () => {
  const raw = py(`${LOAD}
import zipfile, csv, io, tempfile, os
from pathlib import Path
td = tempfile.mkdtemp()
zp = Path(td) / "r.zip"
with zipfile.ZipFile(zp, "w") as z:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["number","street","city","region","postcode","lat","lon"])
    w.writeheader()
    w.writerow({"number":"11","street":"Pine Street","city":"Del Valle","region":"TX","postcode":"78617","lat":"30.2","lon":"-97.7"})
    z.writestr("us/tx/good.csv", buf.getvalue())
    z.writestr("us/tx/broken.csv", "number,street\\n1,x")
# wrap parse_member to raise on broken.csv
real = oa.parse_member
def wrapped(zf, name, zips):
    if name.endswith("broken.csv"):
        raise RuntimeError("boom")
    yield from real(zf, name, zips)
oa.parse_member = wrapped
stats = {"quarantined": 0}
rows = list(oa.parse_region("us_south", {"TX"}, {"78617"}, zp, stats))
print(json.dumps({"n": len(rows), "q": stats["quarantined"], "addr": rows[0][0] if rows else None}))
`);
  const got = lastJson(raw);
  assert.equal(got.q, 1);
  assert.equal(got.n, 1);
  assert.equal(got.addr, '11 PINE ST, DEL VALLE, TX 78617');
});

test('oaCitylessKey matches the Python cityless_key', async () => {
  const { oaCitylessKey, oaStreetZipKey, oaHousestreetKey } = await import(join(root, 'supabase/functions/get-address-report/geocode-cache.ts'));
  assert.equal(oaCitylessKey('2200 CALDWELL LN, DEL VALLE, TX 78617'), '2200 CALDWELL LN, TX 78617');
  assert.equal(oaCitylessKey('2200 CALDWELL LN, TX 78617'), null);
  assert.equal(oaStreetZipKey('2200 CALDWELL LN, DEL VALLE, TX 78617'), 'CALDWELL LN, TX 78617');
  assert.equal(oaStreetZipKey('2200 CALDWELL LN, TX 78617'), 'CALDWELL LN, TX 78617');
  assert.equal(oaStreetZipKey('3521 RAIDER DR'), null);
  assert.equal(oaHousestreetKey('2200 CALDWELL LN, DEL VALLE, TX 78617'), '2200 CALDWELL LN');
  assert.equal(oaHousestreetKey('3521 RAIDER DR'), '3521 RAIDER DR');
  const pyKey = py(`${LOAD}
print(json.dumps({
  "c": oa.cityless_key("2200 CALDWELL LN, DEL VALLE, TX 78617"),
  "sz": oa.street_zip_key("2200 CALDWELL LN, DEL VALLE, TX 78617"),
  "hs": oa.housestreet_key("2200 CALDWELL LN, DEL VALLE, TX 78617"),
}))
`);
  const d = JSON.parse(pyKey);
  assert.equal(d.c, '2200 CALDWELL LN, TX 78617');
  assert.equal(d.sz, 'CALDWELL LN, TX 78617');
  assert.equal(d.hs, '2200 CALDWELL LN');
});

test('datasetRung uses the RPC hit, then exact table, then city-less table', async () => {
  const { datasetRung } = await import(join(root, 'supabase/functions/get-address-report/geocode-cache.ts'));
  const point = { lat: 30.2, lng: -97.7, match_type: 'parcel_centroid' };
  const rpcSupa = {
    rpc: async () => ({ data: [point] }),
    from() { throw new Error('table should not be used when RPC hits'); },
  };
  const hit = await datasetRung(rpcSupa, 'national_address_points', 'openaddresses')
    .resolve('2200 Caldwell Lane, Del Valle, TX 78617', '2200 CALDWELL LN, DEL VALLE, TX 78617');
  assert.equal(hit.lat, 30.2);
  assert.equal(hit.match_type, 'parcel_centroid');

  const rows = {
    '2200 CALDWELL LN, TX 78617': point,
  };
  const tableSupa = {
    rpc: async () => ({ data: null, error: { message: 'missing' } }),
    from() {
      return {
        select() {
          return {
            eq(_col, key) {
              return {
                maybeSingle: async () => ({ data: rows[key] ?? null }),
              };
            },
          };
        },
      };
    },
  };
  const viaAlt = await datasetRung(tableSupa, 'national_address_points', 'openaddresses')
    .resolve('x', '2200 CALDWELL LN, DEL VALLE, TX 78617');
  assert.equal(viaAlt.lng, -97.7);

  const missSupa = {
    rpc: async () => ({ data: null, error: { message: 'missing' } }),
    from() {
      return {
        select() {
          return { eq() { return { maybeSingle: async () => ({ data: null }) }; } };
        },
      };
    },
  };
  const miss = await datasetRung(missSupa, 'national_address_points', 'openaddresses').resolve('x', '100 MAIN ST');
  assert.equal(miss, null);
});

test('upgrade script skips writes on DRY_RUN=1', () => {
  const r = spawnSync('python3', [join(root, 'scripts/upgrade-geocodes-from-oa.py')], {
    encoding: 'utf8',
    env: { ...process.env, DRY_RUN: '1', SUPABASE_SERVICE_ROLE_KEY: 'test' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY_RUN=1/);
});

test('workflow timeout and demand-scope copy match the health recovery', () => {
  const yml = readFileSync(join(root, '.github/workflows/load-openaddresses.yml'), 'utf8');
  assert.match(yml, /timeout-minutes: 360/);
  assert.match(yml, /geocodes ∪ dc_geocode_queue ∪ property_reports/);
  assert.match(yml, /upgrade-geocodes-from-oa.py/);
  assert.match(yml, /oa_demand_scope|demand-scope/);
  const sql = readFileSync(join(root, 'docs/oa-health-recovery.sql'), 'utf8');
  assert.match(sql, /function public\.oa_street_zip_key/);
  assert.match(sql, /function public\.oa_housestreet_key/);
  assert.match(sql, /function public\.oa_upsert_nap_rows/);
  assert.match(sql, /street_zip_unique/);
  assert.match(sql, /housestreet_unique/);
  const idx = readFileSync(join(root, 'supabase/functions/get-address-report/index.ts'), 'utf8');
  assert.match(idx, /await geocode\(supabase, address\)/);
  assert.match(idx, /resolveGeocode\(/);
});
