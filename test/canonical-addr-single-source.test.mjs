// ONE normalizer, ONE ladder. The data-centre derived-location path reuses the report engine's
// canonicalAddr() and geocoding ladder; it must never grow its own copy of either, because two
// normalizers key the same address two ways in public.geocodes and two ladders drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['supabase/functions', 'scripts', 'lib', 'bluesky'];
function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n === 'dist') continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js)$/.test(n)) out.push(p);
  }
  return out;
}
const FILES = ROOTS.flatMap((r) => walk(r));

test('canonicalAddr is DEFINED in exactly one file, and the report engine imports it', () => {
  const defs = FILES.filter((f) => /function\s+canonicalAddr\s*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(defs, ['supabase/functions/get-address-report/canonical-addr.ts']);
  const idx = readFileSync('supabase/functions/get-address-report/index.ts', 'utf8');
  assert.match(idx, /import \{ canonicalAddr \} from "\.\/canonical-addr\.ts";/);
});

test('the production ladder is COMPOSED in exactly one place, and every consumer calls it', () => {
  const composers = FILES.filter((f) => /datasetRung\([^)]*national_address_points/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(composers, ['supabase/functions/get-address-report/geocode-cache.ts']);
  const idx = readFileSync('supabase/functions/get-address-report/index.ts', 'utf8');
  assert.match(idx, /productionLadder\(supabase, fetch\)/);
  // Positive control: the probe really is a consumer (so the assertion above is not vacuous).
  const probe = readFileSync('scripts/dc-geocode-probe.ts', 'utf8');
  assert.match(probe, /productionLadder\(supabase, fetch\)/);
  assert.match(probe, /from "\.\.\/supabase\/functions\/get-address-report\/canonical-addr\.ts"/);
});

test('no NEW Census geocoder: the callers are exactly the three that predate this change', () => {
  const callers = FILES.filter((f) => readFileSync(f, 'utf8').includes('geocoding.geo.census.gov/geocoder/locations'))
    .filter((f) => !f.startsWith('scripts/verify-geocodes'))   // the geofence VERIFIER, not a geocoder
    .sort();
  assert.deepEqual(callers, [
    // stateless consumer proxy for add-your-home (browser flow; no cache, no DB)
    'supabase/functions/geocode-address/index.ts',
    // THE record ladder's Census rung
    'supabase/functions/get-address-report/geocode-cache.ts',
    // PRE-EXISTING, named not fixed: the report engine's address-mode geocode() of the
    // REQUESTING USER'S home address (not of any record). Out of scope here.
    'supabase/functions/get-address-report/index.ts',
  ]);
});
