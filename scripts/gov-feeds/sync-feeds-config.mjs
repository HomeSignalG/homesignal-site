#!/usr/bin/env node
// sync-feeds-config.mjs — close the feeds.csv → public.feeds operational gap.
//
// Compares homesignal-ingest feeds.csv (NOT duplicated in this repo) against
// live public.feeds. Fails only on meaningful drift: CSV rows missing from DB,
// or field mismatches for rows present in both.
//
// Usage:
//   FEEDS_CSV=/path/to/homesignal-ingest/feeds.csv \
//     node scripts/gov-feeds/sync-feeds-config.mjs --live
//
// Offline:
//   node scripts/gov-feeds/sync-feeds-config.mjs \
//     --csv fixtures/gov-feeds/feeds-authoring-fixture.csv \
//     --db-json fixtures/gov-feeds/db-feeds-fixture.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFeedsCsv } from './lib/csv-io.mjs';
import { candidateToInsertSql } from './lib/candidates.mjs';
import { diffFeedsConfig, fetchDbFeeds, formatSyncReport } from './lib/sync.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(name);

const csvPath = arg('--csv') || process.env.FEEDS_CSV;
const dbJsonPath = arg('--db-json');
const outReport = arg('--out-report') || 'results/feeds-sync-report.txt';
const outSql = arg('--emit-insert-sql');
const live = has('--live');

if (!csvPath) {
  console.error('Provide --csv or set FEEDS_CSV to homesignal-ingest/feeds.csv');
  process.exit(2);
}

const csvRows = readFeedsCsv(csvPath);
/** @type {import('./schema.mjs').FeedRecord[]} */
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

if (outSql && diff.missing_from_db.length) {
  const csvMap = new Map(csvRows.map((r) => [r.feed_id, r]));
  const sql = diff.missing_from_db.map((id) => candidateToInsertSql(csvMap.get(id))).join('\n');
  writeFileSync(outSql, sql);
  console.log(`\nWrote insert SQL for ${diff.missing_from_db.length} missing row(s) → ${outSql}`);
}

process.exit(diff.summary.has_drift ? 1 : 0);
