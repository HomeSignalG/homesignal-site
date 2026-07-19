import { FEEDS_DB_READONLY, FEEDS_TABLE_COLUMNS } from './production-contract.mjs';
import { diffFeedRecords, feedRecordKey, normalizeFeedRecord } from './schema.mjs';

/**
 * Compare feeds.csv rows (authoring intent) against live public.feeds.
 * Only rows present in CSV are checked. Extra DB-only production feeds are
 * informational — NOT drift failures.
 *
 * @param {import('./schema.mjs').FeedRecord[]} csvRows
 * @param {import('./schema.mjs').FeedRecord[]} dbRows
 */
export function diffFeedsConfig(csvRows, dbRows) {
  const csvMap = new Map(csvRows.map((r) => [feedRecordKey(r), normalizeFeedRecord(r)]));
  const dbMap = new Map(dbRows.map((r) => [feedRecordKey(r), normalizeFeedRecord(r)]));

  /** @type {string[]} */
  const missingFromDb = [];
  /** @type {string[]} */
  const dbOnlyProduction = [];
  /** @type {Array<{ feed_id: string, mismatches: ReturnType<typeof diffFeedRecords> }>} */
  const mismatched = [];

  for (const id of csvMap.keys()) {
    if (!dbMap.has(id)) missingFromDb.push(id);
    else {
      const mm = diffFeedRecords(csvMap.get(id), dbMap.get(id));
      if (mm.length) mismatched.push({ feed_id: id, mismatches: mm });
    }
  }
  for (const id of dbMap.keys()) {
    if (!csvMap.has(id)) dbOnlyProduction.push(id);
  }

  const hasDrift = missingFromDb.length > 0 || mismatched.length > 0;

  return {
    summary: {
      csv_count: csvRows.length,
      db_count: dbRows.length,
      missing_from_db: missingFromDb.length,
      db_only_production: dbOnlyProduction.length,
      mismatched: mismatched.length,
      has_drift: hasDrift,
    },
    missing_from_db: missingFromDb.sort(),
    db_only_production: dbOnlyProduction.sort(),
    mismatched,
  };
}

/**
 * @param {{ supabaseUrl: string, serviceRoleKey: string }} creds
 */
export async function fetchDbFeeds(creds) {
  const base = creds.supabaseUrl.replace(/\/$/, '');
  const select = [...FEEDS_TABLE_COLUMNS, ...FEEDS_DB_READONLY].join(',');
  const rows = [];
  const pageSize = 500;
  let offset = 0;
  while (true) {
    const url = `${base}/rest/v1/feeds?select=${select}&order=feed_id.asc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        apikey: creds.serviceRoleKey,
        Authorization: `Bearer ${creds.serviceRoleKey}`,
      },
    });
    if (!res.ok) throw new Error(`feeds read failed: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push(...batch.map((r) => normalizeFeedRecord(r)));
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

/** @param {ReturnType<typeof diffFeedsConfig>} diff */
export function formatSyncReport(diff) {
  const lines = [
    'feeds.csv → public.feeds sync report',
    '===================================',
    `CSV rows (authoring): ${diff.summary.csv_count}`,
    `DB rows (all):        ${diff.summary.db_count}`,
    `CSV rows missing from DB: ${diff.summary.missing_from_db}`,
    `DB-only production feeds (informational): ${diff.summary.db_only_production}`,
    `Mismatched fields (CSV vs DB): ${diff.summary.mismatched}`,
    `Drift detected: ${diff.summary.has_drift ? 'YES' : 'NO'}`,
  ];
  if (diff.missing_from_db.length) {
    lines.push('', '--- missing from DB (action required) ---', ...diff.missing_from_db.map((id) => `  ${id}`));
  }
  if (diff.mismatched.length) {
    lines.push('', '--- mismatched ---');
    for (const m of diff.mismatched) {
      lines.push(`  ${m.feed_id}:`);
      for (const f of m.mismatches) lines.push(`    ${f.field}: csv=${JSON.stringify(f.csv)} db=${JSON.stringify(f.db)}`);
    }
  }
  if (diff.db_only_production.length) {
    lines.push('', '--- DB-only (not compared; expected for live feeds) ---', ...diff.db_only_production.slice(0, 20).map((id) => `  ${id}`));
    if (diff.db_only_production.length > 20) lines.push(`  … and ${diff.db_only_production.length - 20} more`);
  }
  return lines.join('\n');
}
