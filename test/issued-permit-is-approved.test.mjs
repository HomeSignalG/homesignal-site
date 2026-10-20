// FOUNDER RULING (2026-10-20): an ISSUED permit is "Approved", not "Operating now".
//
// A source whose only date is the permit's ISSUE date (file_date_kind "issued") and that
// has no status column labels every row with one constant (status_const). An issued
// permit authorises work; it says nothing about the building being finished or in use,
// so that constant must be "approved". Found in the Colorado pre-launch audit: all 5,516
// Aurora permits rendered on Map 1 as "Operating now", sign and deck permits included.
//
// The rule is keyed on what the registry itself declares (file_date_kind), never on a
// source name, so a new issued-permit ledger is held to it without being listed here.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(readFileSync(
  join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));

const entries = [];
(function walk(o) {
  if (Array.isArray(o)) { o.forEach(walk); return; }
  if (o && typeof o === 'object') {
    if (typeof o.registry_id === 'string') entries.push(o);
    Object.values(o).forEach(walk);
  }
})(reg);

const failures = [];
let checked = 0;
for (const e of entries) {
  if (e.file_date_kind !== 'issued' || e.status_const == null) continue;
  checked++;
  // Which lifecycle the constant lands in: the bucket that lists it (a verbatim label such
  // as "Issued"), or, where no bucket lists it, the constant itself (the Socrata connector
  // uses a bare "proposed" | "approved" | "operating" constant directly as the bucket).
  const stb = e.status_to_bucket || {};
  const named = Object.entries(stb).filter(([, vals]) => (vals || []).includes(e.status_const)).map(([k]) => k);
  const lands = named.length ? named : [String(e.status_const).toLowerCase()];
  if (lands.length !== 1 || lands[0] !== 'approved') {
    failures.push(`${e.registry_id}: issued-permit constant "${e.status_const}" lands in ${lands.join('/')} (must be approved)`);
  }
}

// Positive control: the rule must actually be looking at something.
if (checked < 11) failures.push(`expected at least 11 issued-permit ledgers with a status constant, found ${checked}`);

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log(`issued permits are Approved: ${checked} issued-permit ledgers checked, 0 labelled operating.`);
