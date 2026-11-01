#!/usr/bin/env node
// Emits supabase/functions/_shared/source-publishers.generated.json: for every source in the development source registry
// (supabase/functions/get-address-report/jurisdiction-registry.json), the AGENCY that publishes it (the registry's own
// `jurisdiction`) and WHERE its official data lives (the dataset reference). The report shows these on every record and in its
// coverage note, so a reader always knows whose record it is, even for a source whose rights entry carries no credit line.
//
// WHY A GENERATED FILE. The registry is the one place a source's publisher is written down; the report engine runs in another
// edge function and bundles only its own tree. This file is mechanically derived from the registry (nothing to edit in it), and
// `--check` fails CI the moment it differs, so the report can never name a publisher the registry does not.
//
// Usage:
//   node scripts/gen-source-publishers.mjs          write the file
//   node scripts/gen-source-publishers.mjs --check  exit 1 if the file on disk is not what this would write
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'supabase/functions/get-address-report/jurisdiction-registry.json';
const OUT = 'supabase/functions/_shared/source-publishers.generated.json';
const CONNECTORS = ['socrata', 'arcgis', 'ckan', 'csv', 'carto'];

function host(u) { try { return new URL(u).host; } catch { return ''; } }

/** "data.seattle.gov, dataset ht3q-kdvx" for a Socrata dataset; otherwise the host the official data is served from. */
export function datasetRef(conn, e) {
  if (conn === 'socrata' && e.domain && e.dataset_id) return e.domain + ', dataset ' + e.dataset_id;
  if (conn === 'ckan' && e.resource_id) return (host(e.sql_url || e.base_url || e.url || '') || 'CKAN') + ', resource ' + e.resource_id;
  if (conn === 'carto' && e.table) return (host(e.sql_url || e.url || '') || 'Carto') + ', table ' + e.table;
  const svc = e.service_url || '';
  const name = /\/services\/(.+?)\/(?:Feature|Map)Server/i.exec(svc);
  if (conn === 'arcgis' && host(svc) && name) return host(svc) + ', service ' + decodeURIComponent(name[1]);
  return host(svc || e.url || e.dataset_url || '') || null;
}

export function build(registry) {
  const out = {};
  for (const conn of CONNECTORS) {
    for (const e of registry[conn] || []) {
      if (!e || typeof e.registry_id !== 'string') continue;
      const agency = typeof e.jurisdiction === 'string' && e.jurisdiction.trim() ? e.jurisdiction.trim() : null;
      if (out[e.registry_id]) throw new Error('duplicate registry_id ' + e.registry_id);
      out[e.registry_id] = { agency, dataset: datasetRef(conn, e) };
    }
  }
  const sorted = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  return JSON.stringify({ _generated: 'GENERATED FILE — DO NOT EDIT. Source: ' + SRC + '. Regenerate: node scripts/gen-source-publishers.mjs', publishers: sorted }, null, 1) + '\n';
}

const wanted = build(JSON.parse(readFileSync(join(root, SRC), 'utf8')));
if (process.argv.includes('--check')) {
  let onDisk = null;
  try { onDisk = readFileSync(join(root, OUT), 'utf8'); } catch { /* missing */ }
  if (onDisk !== wanted) { console.error(OUT + ' is stale: run node scripts/gen-source-publishers.mjs'); process.exit(1); }
  console.log(OUT + ' matches the registry');
} else {
  writeFileSync(join(root, OUT), wanted);
  console.log('wrote ' + OUT);
}
