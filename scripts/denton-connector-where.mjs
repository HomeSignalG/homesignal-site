// READ ONLY helper for the Denton audit. Prints, per registry id, the publisher WHERE clause the shipped ArcGIS connector would send
// (extra_where AND include_types AND recency window), minus the ZIP clause, by calling the connector's OWN buildWhere. Nothing is re-typed.
// buildWhere is module-private, so a throw-away copy of the shipped file with one export line appended is imported from the runner's checkout
// (the copy is deleted afterwards and never committed; the shipped source is not modified).
// usage: node scripts/denton-connector-where.mjs <registry_id>...   (needs Node >= 22.18 type stripping, like test/arcgis-geometry.test.mjs)
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase/functions/get-address-report/sources');
const registry = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const tmp = join(dir, `arcgis.audit-copy.${process.pid}.ts`);
const out = {};
try {
  writeFileSync(tmp, readFileSync(join(dir, 'arcgis.ts'), 'utf8') + '\nexport { buildWhere as __auditBuildWhere };\n');
  const mod = await import(pathToFileURL(tmp).href);
  for (const id of process.argv.slice(2)) {
    const e = registry.arcgis.find((x) => x.registry_id === id);
    if (!e) { out[id] = { error: 'unknown registry id' }; continue; }
    // spatial_zip_radius_mi > 0 makes the connector's ZIP clause "1=1", leaving exactly the ZIP-independent predicate.
    const w = mod.__auditBuildWhere({ ...e, spatial_zip_radius_mi: 1 }, '00000', 'ZIP');
    out[id] = { where: w.replace(/^1=1( AND )?/, '') || '1=1', full: w };
  }
} catch (err) {
  console.log(JSON.stringify({ _error: String(err && err.message || err) }));
  process.exitCode = 1;
} finally {
  try { unlinkSync(tmp); } catch { /* already gone */ }
}
if (!process.exitCode) console.log(JSON.stringify(out));
