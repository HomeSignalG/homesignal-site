#!/usr/bin/env node
// INTERNAL diagnostic for the ZIP coverage record (docs/maps-coverage/fix4/zip-coverage-internal.json,
// founder 2026-10-03). It reads the INTERNAL record, which keeps the provenance the public
// lib/zip-coverage.json does not carry.
// Prints, for every ZIP in the model (or the ZIPs named as arguments), what we know about it and
// WHY map-based results are unavailable. Developer-run only: nothing here ships in a page, and
// the public pages never show this wording.
//
//   node scripts/zip-coverage-report.mjs            # every modelled ZIP + a tally
//   node scripts/zip-coverage-report.mjs 78769 98205
//   node scripts/zip-coverage-report.mjs --json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { coverageMode } from './lib/zip-coverage-live.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = JSON.parse(readFileSync(join(root, 'docs', 'maps-coverage', 'fix4', 'zip-coverage-internal.json'), 'utf8'));
const args = process.argv.slice(2);
const json = args.includes('--json');
const want = args.filter((a) => /^\d{5}$/.test(a));

export function reasonUnavailable(e) {
  const c2020 = e.zcta_2020_status === 'present', c2010 = e.zcta_2010_status === 'present';
  if (c2020) return 'has a 2020 Census ZCTA, so a ZIP-wide map is possible';
  return `no Census ZCTA for 2020 (2010: ${c2010 ? 'present, so it lost its area' : 'absent, so it never had one'}); `
    + `${e.zip_type === 'po_box' ? 'a PO box ZIP' : e.zip_type === 'unique' ? 'a single-organization ZIP' : 'a regular street ZIP, which needs a USPS check'}; `
    + 'map and ZIP-wide development records are not shown';
}

const list = (want.length ? want : Object.keys(doc.zips).sort()).map((z) => {
  const e = doc.zips[z];
  if (!e) return { zip_code: z, page_mode: 'standard', note: 'not in the model: a standard page' };
  return { zip_code: z, postal_status: e.postal_status, postal_status_source: e.postal_status_source, zip_type: e.zip_type,
    zcta_2010: e.zcta_2010_status, zcta_2020: e.zcta_2020_status, map_coverage: e.map_coverage, page_mode: e.page_mode,
    effective_mode: coverageMode(e), last_verified: e.postal_status_verified_at || 'never', reason: reasonUnavailable(e) };
});
if (json) { console.log(JSON.stringify(list, null, 1)); process.exit(0); }
for (const r of list) {
  if (r.note) { console.log(`${r.zip_code}  ${r.note}`); continue; }
  console.log(`${r.zip_code}  ${r.page_mode.padEnd(20)} postal=${r.postal_status}(${r.postal_status_source}) type=${r.zip_type} `
    + `zcta2010=${r.zcta_2010} zcta2020=${r.zcta_2020} map=${r.map_coverage} verified=${r.last_verified}\n       ${r.reason}`);
}
if (!want.length) {
  const t = {}; for (const r of list) t[r.page_mode] = (t[r.page_mode] || 0) + 1;
  console.log('\n' + list.length + ' ZIPs: ' + JSON.stringify(t));
}
