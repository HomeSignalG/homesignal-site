#!/usr/bin/env node
// AUDIT (read-only, repeatable): which registry date mappings might call a CREATION or UPDATE field a "Filed" date (report-accuracy-universal, 2026-11-19).
// A field NAME is a candidate for review, never proof of what the source means: nothing here reclassifies a mapping or writes the registry. The verified answer for a source is
// its publisher's field documentation, recorded by adding `file_date_basis` ("filing" | "record_created") to its registry entry in a reviewed change.
//   node scripts/audit-date-basis.mjs            human report on stdout
//   node scripts/audit-date-basis.mjs --json     the same as JSON (for diffing between runs)
//   node scripts/audit-date-basis.mjs --check    exit 1 if a mapping declares a basis the vocabulary does not know, or declares `filing` on a field named like a system/update timestamp
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { surfaceBanner } from './lib/surface-banner.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REGISTRY = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const CREATION = /(^|[_\s.-])(creat|created|creation|entered|entry|added|imported|loaded|insert|system|sys|posted|recorded|record_?date|first_?seen)/i;
const UPDATE = /(modif|update|updated|edit|edited|last_?(mod|upd|edit|chg|change)|changed|revis)/i;
const FILING = /(appl(ication|ied)?|submit|submitted|filed|filing|received|intake|accepted|open_?date|date_?filed)/i;
const cols = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);
export function audit(registry) {
  const rows = [];
  for (const [conn, list] of Object.entries(registry)) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (!e || typeof e.registry_id !== 'string') continue;
      const cm = e.column_map || {};
      const f = cols(cm.file_date);
      if (!f.length) continue;
      const kind = e.file_date_kind || 'filed (default)';
      const basis = e.file_date_basis || null;
      const label = e.file_date_label || null;
      const hits = { creation: f.some((c) => CREATION.test(c)), update: f.some((c) => UPDATE.test(c)), filing: f.some((c) => FILING.test(c)) };
      let status;
      if (basis) status = 'declared';
      else if (label) status = 'own_label';                                   // the registry already labels the date in the agency's own words
      else if (hits.update || hits.creation) status = 'candidate_review';     // a creation/update-looking field kept under the default "Filed" label
      else if (hits.filing) status = 'name_suggests_filing';                  // still unproven: a name is not evidence
      else status = 'unclassified_name';
      rows.push({ connector: conn, registry_id: e.registry_id, file_date: f, file_date_kind: kind, file_date_basis: basis, file_date_label: label, name_hits: Object.keys(hits).filter((k) => hits[k]), status });
    }
  }
  return rows;
}
/** The only things --check enforces: a declared basis outside the vocabulary, and `filing` declared on a field NAMED like a creation/update timestamp. It does not certify any mapping. */
export function violations(rows) {
  return rows.filter((r) => (r.file_date_basis && !['filing', 'record_created'].includes(r.file_date_basis)) || (r.file_date_basis === 'filing' && r.name_hits.some((h) => h === 'creation' || h === 'update')));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--json')) surfaceBanner('audit-date-basis'); // the banner is stdout text, so JSON mode leaves it out
  const rows = audit(REGISTRY);
  const by = (s) => rows.filter((r) => r.status === s);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ total: rows.length, counts: Object.fromEntries(['declared', 'own_label', 'candidate_review', 'name_suggests_filing', 'unclassified_name'].map((s) => [s, by(s).length])), rows }, null, 1));
  else if (process.argv.includes('--check')) {
    const bad = violations(rows);
    for (const r of bad) console.error('REVIEW: ' + r.registry_id + ' declares ' + r.file_date_basis + ' on ' + r.file_date.join(','));
    process.exit(bad.length ? 1 : 0);
  } else {
    console.log(`date-basis audit: ${rows.length} registry mappings read (a field name is a lead, never proof)\n`);
    for (const [s, t] of [['declared', 'DECLARED (a basis is recorded)'], ['own_label', "OWN LABEL (the registry labels the date in the agency's words)"], ['candidate_review', 'CANDIDATE: a creation/update-looking field kept under the default "Filed" label — verify against the publisher documentation'], ['name_suggests_filing', 'UNPROVEN: the name suggests filing/application; still no declared basis'], ['unclassified_name', 'UNCLASSIFIED: the name says nothing either way']]) {
      console.log(`== ${t}: ${by(s).length}`);
      for (const r of by(s)) console.log(`   ${r.registry_id}  [${r.connector}]  ${r.file_date.join(' + ')}  kind=${r.file_date_kind}${r.file_date_basis ? ' basis=' + r.file_date_basis : ''}`);
      console.log('');
    }
  }
}
