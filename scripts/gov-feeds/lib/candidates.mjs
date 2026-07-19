import { FEEDS_TABLE_COLUMNS, VENDOR_ADAPTER } from './production-contract.mjs';
import { COUNTY_COMMISSION_CATEGORY, normalizeFeedRecord, validateFeedRecord } from './schema.mjs';

/**
 * @param {{ vendor: keyof typeof VENDOR_ADAPTER, source_url: string, confidence?: number, reason?: string }} hit
 */
export function vendorHitToSourceType(hit) {
  const cfg = VENDOR_ADAPTER[hit.vendor];
  if (!cfg) throw new Error(`unknown vendor: ${hit.vendor}`);
  return cfg.source_type;
}

/**
 * Build a candidate public.feeds row from a discovery hit.
 * Candidates always ship active=false.
 */
export function buildCandidateFeedRow(args) {
  const st = args.state.length === 2 ? args.state.toUpperCase() : args.state;
  const slugBase = `${args.county_name}-${st}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const vendor = args.hit.vendor;
  const feed_id = `${args.feed_id_prefix || slugBase}-${vendor}-meetings`.replace(/--+/g, '-');
  const source_type = vendorHitToSourceType(args.hit);

  const row = normalizeFeedRecord({
    feed_id,
    community_id: args.community_id,
    source: args.hit.source_url,
    source_type,
    category: COUNTY_COMMISSION_CATEGORY,
    pipeline_type: 'government_notice',
    agency_name: args.agency_name,
    geographic_reference: args.geographic_reference,
    impact_level: 'medium',
    active: false,
    sort_order: 0,
    target_table: 'meetings',
    filter_expr: '',
    dedupe_on: '',
    status_notes: '',
  });

  const errors = validateFeedRecord(row, { requireCandidateInactive: true });
  if (errors.length) throw new Error(errors.join('; '));
  return row;
}

const INSERT_COLS = [...FEEDS_TABLE_COLUMNS];

/** @param {import('./schema.mjs').FeedRecord} row */
export function candidateToInsertSql(row, { schema = 'public', table = 'feeds' } = {}) {
  const errors = validateFeedRecord(row, { requireCandidateInactive: true });
  if (errors.length) throw new Error(`invalid candidate: ${errors.join('; ')}`);

  const esc = (v) => String(v ?? '').replace(/'/g, "''");
  const values = INSERT_COLS.map((c) => {
    if (c === 'active') return 'false';
    if (c === 'sort_order') return String(row.sort_order ?? 0);
    return `'${esc(row[c])}'`;
  });

  return [
    `-- candidate insert for ${row.feed_id} (idempotent; never deactivates production)`,
    `insert into ${schema}.${table} (${INSERT_COLS.join(', ')})`,
    `values (${values.join(', ')})`,
    'on conflict (feed_id) do nothing;',
    '',
  ].join('\n');
}

/** @param {string} feed_id */
export function candidateToActivateSql(feed_id, { schema = 'public', table = 'feeds' } = {}) {
  const esc = (v) => String(v).replace(/'/g, "''");
  return [
    `-- go-live: activate ${feed_id} (run ONLY after dry-run + title verification)`,
    `update ${schema}.${table}`,
    'set active = true,',
    '    updated_at = now()',
    `where feed_id = '${esc(feed_id)}'`,
    '  and active = false;',
    '',
  ].join('\n');
}

/** @param {import('./schema.mjs').FeedRecord} row */
export function feedRowToInsertSql(row, { schema = 'public', table = 'feeds' } = {}) {
  const errors = validateFeedRecord(row);
  if (errors.length) throw new Error(`invalid feed row: ${errors.join('; ')}`);

  const esc = (v) => String(v ?? '').replace(/'/g, "''");
  const values = INSERT_COLS.map((c) => {
    if (c === 'active') return row.active ? 'true' : 'false';
    if (c === 'sort_order') return String(row.sort_order ?? 0);
    return `'${esc(row[c])}'`;
  });

  return [
    `insert into ${schema}.${table} (${INSERT_COLS.join(', ')})`,
    `values (${values.join(', ')})`,
    'on conflict (feed_id) do nothing;',
    '',
  ].join('\n');
}
