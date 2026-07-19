import { COUNTY_COMMISSION_CATEGORY, normalizeFeedRecord, validateFeedRecord } from './schema.mjs';

/**
 * Build a candidate public.feeds row from a discovery hit.
 * Candidates ship with active=false — insert + golive are separate, deliberate steps.
 *
 * @param {Object} args
 * @param {string} args.community_id
 * @param {string} args.county_name
 * @param {string} args.state
 * @param {string} args.agency_name
 * @param {string} args.geographic_reference
 * @param {{ vendor: string, source_url: string, confidence?: number, reason?: string }} args.hit
 * @param {string} [args.feed_id_prefix]
 */
export function buildCandidateFeedRow(args) {
  const st = args.state.length === 2 ? args.state.toUpperCase() : args.state;
  const slugBase = `${args.county_name}-${st}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const vendorSlug = args.hit.vendor.replace(/_/g, '-');
  const feed_id = `${args.feed_id_prefix || slugBase}-${vendorSlug}-meetings`.replace(/--+/g, '-');

  const row = normalizeFeedRecord({
    feed_id,
    community_id: args.community_id,
    source_url: args.hit.source_url,
    source_type: args.hit.vendor,
    category: COUNTY_COMMISSION_CATEGORY,
    pipeline_type: 'government_notice',
    destination: 'meetings',
    agency_name: args.agency_name,
    geographic_reference: args.geographic_reference,
    impact_level: 'medium',
    active: false,
    notes: [
      'Phase 1A candidate — not inserted.',
      args.hit.reason ? `discovery: ${args.hit.reason}` : '',
      args.hit.confidence != null ? `confidence=${args.hit.confidence}` : '',
    ].filter(Boolean).join(' '),
  });

  const errors = validateFeedRecord(row);
  if (errors.length) throw new Error(errors.join('; '));
  return row;
}

/** @param {import('./schema.mjs').FeedRecord} row */
export function candidateToInsertSql(row, { schema = 'public', table = 'feeds' } = {}) {
  const errors = validateFeedRecord(row);
  if (errors.length) throw new Error(`invalid candidate: ${errors.join('; ')}`);

  const cols = [
    'feed_id', 'community_id', 'source_url', 'source_type', 'category',
    'pipeline_type', 'destination', 'agency_name', 'geographic_reference',
    'impact_level', 'active', 'notes',
  ];
  const esc = (v) => String(v ?? '').replace(/'/g, "''");
  const values = cols.map((c) => {
    if (c === 'active') return row.active ? 'true' : 'false';
    return `'${esc(row[c])}'`;
  });

  const updates = cols.filter((c) => c !== 'feed_id').map((c) => `  ${c} = excluded.${c}`).join(',\n');
  return [
    `-- candidate insert for ${row.feed_id} (idempotent; does not activate)`,
    `insert into ${schema}.${table} (${cols.join(', ')})`,
    `values (${values.join(', ')})`,
    `on conflict (feed_id) do update set`,
    updates + ';',
    '',
  ].join('\n');
}

/** @param {import('./schema.mjs').FeedRecord} row */
export function candidateToActivateSql(feed_id, { schema = 'public', table = 'feeds' } = {}) {
  const esc = (v) => String(v).replace(/'/g, "''");
  return [
    `-- go-live: activate ${feed_id} (run ONLY after dry-run + title verification)`,
    `update ${schema}.${table}`,
    `set active = true,`,
    `    notes = coalesce(notes, '') || ' | activated ${new Date().toISOString().slice(0, 10)}'`,
    `where feed_id = '${esc(feed_id)}';`,
    '',
  ].join('\n');
}
