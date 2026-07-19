#!/usr/bin/env node
// sync-feeds-config.mjs — close the feeds.csv → public.feeds operational gap.
//
// Compares the versioned CSV authoring surface against live public.feeds and emits
// a human-readable report + optional SQL for missing rows (candidates only).
//
// Usage:
//   node scripts/gov-feeds/sync-feeds-config.mjs \
//     --csv data/gov-feeds/feeds.csv \
//     [--db-json path/to/feeds-export.json]   # offline diff
//     [--live]                                 # fetch DB via service role (CI)
//
// SAFETY: never mutates production. --emit-insert-sql writes candidate SQL only
// for rows present in CSV but absent from DB (typically active=false).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFeedsCsv } from './lib/csv-io.mjs';
import { candidateToInsertSql } from './lib/candidates.mjs';
import { diffFeedsConfig, fetchDbFeeds, formatSyncReport } from './lib/sync.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(name);

const csvPath = arg('--csv') || 'data/gov-feeds/feeds.csv';
const dbJsonPath = arg('--db-json');
const outReport = arg('--out-report') || 'results/feeds-sync-report.txt';
const outSql = arg('--emit-insert-sql');
const live = has('--live');

const csvRows = readFeedsCsv(csvPath);
/** @type {import('./lib/schema.mjs').FeedRecord[]} */
let dbRows = [];

if (live) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for --live');
    process.exit(2);
  }
  dbRows = await fetchDbFeeds({ supabaseUrl: url, serviceRoleKey: key });
} else if (dbJsonPath) {
  const raw = JSON.parse(readFileSync(dbJsonPath, 'utf8'));
  dbRows = Array.isArray(raw) ? raw : raw.feeds || [];
} else {
  console.error('Provide --db-json for offline diff or --live for CI sync check');
  process.exit(2);
}

const diff = diffFeedsConfig(csvRows, dbRows);
const report = formatSyncReport(diff);
mkdirSync('results', { recursive: true });
writeFileSync(outReport, report + '\n');
console.log(report);

if (outSql && diff.only_in_csv.length) {
  const csvMap = new Map(csvRows.map((r) => [r.feed_id, r]));
  const sql = diff.only_in_csv.map((id) => candidateToInsertSql(csvMap.get(id))).join('\n');
  writeFileSync(outSql, sql);
  console.log(`\nWrote insert SQL for ${diff.only_in_csv.length} CSV-only row(s) → ${outSql}`);
}

process.exit(diff.summary.in_sync ? 0 : 1);
