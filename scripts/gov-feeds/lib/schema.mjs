// Canonical shape for government meeting-feed rows in public.feeds / feeds.csv.
// Mirrors the ingest engine contract (homesignal-ingest load_config) — DB-first at
// runtime; feeds.csv is the versioned authoring surface this automation syncs.

/** @typedef {'meetings' | 'alerts'} FeedDestination */

/** @typedef {'granicus_rss' | 'legistar' | 'civicclerk'} VendorSourceType */

/**
 * @typedef {Object} FeedRecord
 * @property {string} feed_id
 * @property {string} community_id
 * @property {string} source_url
 * @property {string} source_type
 * @property {string} category
 * @property {string} pipeline_type
 * @property {FeedDestination} destination
 * @property {string} agency_name
 * @property {string} geographic_reference
 * @property {string} [impact_level]
 * @property {boolean} active
 * @property {string} [notes]
 */

export const CSV_COLUMNS = [
  'feed_id',
  'community_id',
  'source_url',
  'source_type',
  'category',
  'pipeline_type',
  'destination',
  'agency_name',
  'geographic_reference',
  'impact_level',
  'active',
  'notes',
];

export const COUNTY_COMMISSION_CATEGORY = 'County Commission & county business';

export const VENDOR_SOURCE_TYPES = /** @type {const} */ ([
  'granicus_rss',
  'legistar',
  'civicclerk',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {unknown} v */
export function parseBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n', ''].includes(s)) return false;
  throw new Error(`invalid boolean: ${JSON.stringify(v)}`);
}

/** @param {Partial<FeedRecord>} row */
export function validateFeedRecord(row, { allowInactive = true } = {}) {
  const errors = [];
  if (!row.feed_id || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(row.feed_id)) {
    errors.push('feed_id must be kebab-case slug (3–81 chars)');
  }
  if (!row.community_id || !UUID_RE.test(row.community_id)) {
    errors.push('community_id must be a UUID');
  }
  if (!row.source_url || !/^https?:\/\//i.test(row.source_url)) {
    errors.push('source_url must be an http(s) URL');
  }
  if (!row.source_type) errors.push('source_type is required');
  if (!row.category) errors.push('category is required');
  if (!row.pipeline_type) errors.push('pipeline_type is required');
  if (!row.destination || !['meetings', 'alerts'].includes(row.destination)) {
    errors.push('destination must be meetings or alerts');
  }
  if (!row.agency_name) errors.push('agency_name is required');
  if (!row.geographic_reference) errors.push('geographic_reference is required');
  if (row.active === undefined) errors.push('active is required');
  if (!allowInactive && !row.active) errors.push('active must be true for go-live rows');

  if (row.source_type === 'granicus_rss' && !/granicus\.com\/ViewPublisherRSS\.php/i.test(row.source_url || '')) {
    errors.push('granicus_rss source_url must be a ViewPublisherRSS.php URL');
  }
  if (row.source_type === 'legistar' && !/\.legistar\.com\/Calendar\.aspx/i.test(row.source_url || '')) {
    errors.push('legistar source_url must be a *.legistar.com/Calendar.aspx URL');
  }
  if (row.source_type === 'civicclerk' && !/\.portal\.civicclerk\.com/i.test(row.source_url || '')) {
    errors.push('civicclerk source_url must be a *.portal.civicclerk.com URL');
  }

  return errors;
}

/** @param {FeedRecord} row */
export function normalizeFeedRecord(row) {
  return {
    feed_id: String(row.feed_id).trim(),
    community_id: String(row.community_id).trim(),
    source_url: String(row.source_url).trim(),
    source_type: String(row.source_type).trim(),
    category: String(row.category).trim(),
    pipeline_type: String(row.pipeline_type).trim(),
    destination: /** @type {FeedDestination} */ (String(row.destination).trim()),
    agency_name: String(row.agency_name).trim(),
    geographic_reference: String(row.geographic_reference).trim(),
    impact_level: String(row.impact_level || 'medium').trim(),
    active: parseBool(row.active),
    notes: String(row.notes || '').trim(),
  };
}

/** @param {FeedRecord} row */
export function feedRecordKey(row) {
  return row.feed_id;
}

/** Compare two normalized rows — fields that must match between CSV and DB. */
const SYNC_FIELDS = CSV_COLUMNS.filter((c) => c !== 'notes');

/** @param {FeedRecord} a @param {FeedRecord} b */
export function diffFeedRecords(a, b) {
  const mismatches = [];
  for (const field of SYNC_FIELDS) {
    const av = String(a[field] ?? '');
    const bv = String(b[field] ?? '');
    if (field === 'active') {
      if (parseBool(av) !== parseBool(bv)) mismatches.push({ field, csv: av, db: bv });
    } else if (av !== bv) {
      mismatches.push({ field, csv: av, db: bv });
    }
  }
  return mismatches;
}
