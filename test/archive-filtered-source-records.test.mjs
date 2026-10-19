// Offline checks for scripts/archive-filtered-source-records.mjs: it asks the SHIPPED filter which records
// to keep, over the same title the connector builds, and it never re-states the rule.
import { readFileSync } from 'node:fs';
import { selectDropped, readCol, fingerprint, parseArgs } from '../scripts/archive-filtered-source-records.mjs';
import * as hygiene from '../supabase/functions/get-address-report/sources/record-hygiene.ts';

let pass = 0, fail = 0;
const ok = (c, name, d) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.error('  ✗ ' + name + (d ? '\n     ' + d : '')); } };

const reg = JSON.parse(readFileSync(new URL('../supabase/functions/get-address-report/jurisdiction-registry.json', import.meta.url)));
const entry = reg.arcgis.find((e) => e.registry_id === 'tacoma-accela-permits');
ok(!!entry && Array.isArray(entry.drop_minor_repairs?.types), 'tacoma entry declares drop_minor_repairs');

// Rows shaped like the Tacoma layer (attribute names from the entry's column_map). Scope texts are REAL
// (test/record-hygiene.test.mjs), ids SYNTHETIC.
const row = (id, type, desc, status = 'Issued') => ({
  permit_number: id, permit_type: type, description: desc, current_status: status,
  application_date: Date.UTC(2026, 0, 5), link: `https://aca-prod.accela.com/TACOMA/x?id=${id}`, zip: '98404',
});
const rows = [
  row('A1', 'Building', 'Re-roof of commercial building'),
  row('A2', 'Building', 'WHOLE REPIPE at CONDO A101 in MULTI-FAMILY BLDG.', 'Finaled'),
  row('A3', 'Building', 'New SFD with furnace and water heater'),          // development evidence wins: kept
  row('A4', 'Land Use', 'Re-roof of commercial building'),                  // type not in the drop list: kept
  row('A1', 'Building', 'Re-roof of commercial building'),                  // duplicate id
  row('', 'Building', 'Replace furnace'),                                   // no id
];
const out = selectDropped(rows, entry, hygiene);
ok(out.rows.map((r) => r.source_record_id).join() === 'A1,A2', 'selects exactly the rows the shipped filter drops', out.rows.map((r) => r.source_record_id).join());
ok(out.noId === 1, 'a row with no id is counted, not archived');

// Parity with the connector's own decision, row by row.
for (const r of rows) {
  const type = String(readCol(r, entry.column_map.type_source) ?? '').trim();
  const engineDrops = entry.drop_minor_repairs.types.includes(type) && hygiene.isMinorRepairNoise(String(readCol(r, entry.column_map.title) ?? ''));
  const archived = out.rows.some((x) => x.source_record_id === r.permit_number);
  if (r.permit_number) ok(engineDrops === archived, `parity with the connector rule: ${r.permit_number} ${r.permit_type}`);
}

const a1 = out.rows[0];
ok(a1.title === 'Building Re-roof of commercial building', 'title is the connector title (column_map joined with one space)', a1.title);
ok(a1.file_date === '2026-01-05' && a1.status_raw === 'Issued' && a1.record_url.includes('A1'), 'file date, status and record link carried');
ok(a1.row_json === rows[0], 'row_json is the publisher row, verbatim');
ok(/^[0-9a-f]{32}$/.test(a1.rule_fingerprint), 'rule fingerprint recorded');

ok(fingerprint(['b', 'a']) === fingerprint(['a', 'b']), 'id fingerprint is order-independent');
ok(parseArgs([]).apply === false, 'report-only by default');
let threw = false; try { parseArgs(['--since', '2025/10/15']); } catch { threw = true; }
ok(threw, 'a malformed --since is refused');

const src = readFileSync(new URL('../scripts/archive-filtered-source-records.mjs', import.meta.url), 'utf8');
ok(!/furnace|re-?roof|heat pump/i.test(src), 'the script does not re-state any filter term');
ok(/resolution=ignore-duplicates/.test(src), 'writes never overwrite an archived copy');

const ddl = readFileSync(new URL('../docs/filtered-source-records-archive.sql', import.meta.url), 'utf8');
ok(/enable row level security/.test(ddl) && /revoke all on public\.filtered_source_records_archive from public, anon, authenticated/.test(ddl), 'archive table: RLS on, no anon/authenticated access');
ok(/before update or delete/.test(ddl), 'archive table is append-only');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
