import { diffFeedRecords, feedRecordKey, normalizeFeedRecord } from './schema.mjs';

/**
 * Compare authored feeds.csv rows against live public.feeds rows.
 * Returns a structured diff — never mutates either side.
 *
 * @param {import('./schema.mjs').FeedRecord[]} csvRows
 * @param {import('./schema.mjs').FeedRecord[]} dbRows
 */
export function diffFeedsConfig(csvRows, dbRows) {
  const csvMap = new Map(csvRows.map((r) => [feedRecordKey(r), normalizeFeedRecord(r)]));
  const dbMap = new Map(dbRows.map((r) => [feedRecordKey(r), normalizeFeedRecord(r)]));

  /** @type {string[]} */
  const onlyInCsv = [];
  /** @type {string[]} */
  const onlyInDb = [];
  /** @type {Array<{ feed_id: string, mismatches: ReturnType<typeof diffFeedRecords> }>} */
  const mismatched = [];

  for (const id of csvMap.keys()) {
    if (!dbMap.has(id)) onlyInCsv.push(id);
    else {
      const mm = diffFeedRecords(csvMap.get(id), dbMap.get(id));
      if (mm.length) mismatched.push({ feed_id: id, mismatches: mm });
    }
  }
  for (const id of dbMap.keys()) {
    if (!csvMap.has(id)) onlyInDb.push(id);
  }

  return {
    summary: {
      csv_count: csvRows.length,
      db_count: dbRows.length,
      only_in_csv: onlyInCsv.length,
      only_in_db: onlyInDb.length,
      mismatched: mismatched.length,
      in_sync: onlyInCsv.length === 0 && onlyInDb.length === 0 && mismatched.length === 0,
    },
    only_in_csv: onlyInCsv.sort(),
    only_in_db: onlyInDb.sort(),
    mismatched,
  };
}

/**
 * Fetch public.feeds via Supabase REST (service role required — table is not anon-readable).
 * @param {{ supabaseUrl: string, serviceRoleKey: string }} creds
 */
export async function fetchDbFeeds(creds) {
  const base = creds.supabaseUrl.replace(/\/$/, '');
  const rows = [];
  const pageSize = 500;
  let offset = 0;
  while (true) {
    const url = `${base}/rest/v1/feeds?select=feed_id,community_id,source_url,source_type,category,pipeline_type,destination,agency_name,geographic_reference,impact_level,active,notes&order=feed_id.asc&limit=${pageSize}&offset=${offset}`;
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
    'feeds.csv ↔ public.feeds sync report',
    '====================================',
    `CSV rows: ${diff.summary.csv_count}`,
    `DB rows:  ${diff.summary.db_count}`,
    `Only in CSV (missing from DB): ${diff.summary.only_in_csv}`,
    `Only in DB (missing from CSV): ${diff.summary.only_in_db}`,
    `Mismatched fields: ${diff.summary.mismatched}`,
    `In sync: ${diff.summary.in_sync ? 'YES' : 'NO'}`,
  ];
  if (diff.only_in_csv.length) {
    lines.push('', '--- only in CSV ---', ...diff.only_in_csv.map((id) => `  ${id}`));
  }
  if (diff.only_in_db.length) {
    lines.push('', '--- only in DB ---', ...diff.only_in_db.map((id) => `  ${id}`));
  }
  if (diff.mismatched.length) {
    lines.push('', '--- mismatched ---');
    for (const m of diff.mismatched) {
      lines.push(`  ${m.feed_id}:`);
      for (const f of m.mismatches) lines.push(`    ${f.field}: csv=${JSON.stringify(f.csv)} db=${JSON.stringify(f.db)}`);
    }
  }
  return lines.join('\n');
}
