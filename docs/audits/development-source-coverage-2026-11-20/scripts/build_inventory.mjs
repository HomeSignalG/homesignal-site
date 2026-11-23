// Converts the saved SQL result of queries.sql (query 2) into family-inventory.json/.csv.
// usage: node build_inventory.mjs <saved-tool-result.txt> <out-dir> <registry-ids.json>
// registry-ids.json: [{id,t}] generated from jurisdiction-registry.json (see README).
import fs from 'node:fs';
const [,, file, outDir, regFile] = process.argv;
const raw = JSON.parse(fs.readFileSync(file, 'utf8')).result;
const rows = JSON.parse(raw.slice(raw.indexOf('[{'), raw.lastIndexOf('}]') + 2)).map(({ pad, ...r }) => r);
const reg = JSON.parse(fs.readFileSync(regFile, 'utf8')); const t = Object.fromEntries(reg.map((x) => [x.id, x.t]));
const out = rows.map((r) => ({ registry_id: r.id, connector: t[r.id], app_projects_development_keys: r.app_keys, generation_proven_points: r.gen_pts, recovered_geometry_keys: r.recovered_geom, snapshot_point_keys: r.snapshot_pts, generation_verdict_rejects: r.verdict_rejects, n5_treatment: r.treatment, fetch_failures_24h: r.fetch_failures_24h, blocked_24h: r.blocked_24h, truncated_24h: r.truncated_24h }));
fs.writeFileSync(outDir + '/family-inventory.json', JSON.stringify({ queried_at: rows[0].queried_at, generation_id: rows[0].generation_id, families: out }, null, 1) + '\n');
