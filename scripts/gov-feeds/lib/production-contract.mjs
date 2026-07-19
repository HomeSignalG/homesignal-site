// Verified against live public.feeds via PostgREST column probe (2026-07-19).
// Evidence: GET /rest/v1/feeds?select=<col>&limit=1 — 200 for listed cols, 400 otherwise.
//
// homesignal-ingest load_config reads these rows; feeds.csv in the INGEST repo
// is the versioned authoring surface (not duplicated in homesignal-site).

/** Writable columns on public.feeds (all included in INSERT SQL). */
export const FEEDS_TABLE_COLUMNS = [
  'feed_id',
  'community_id',
  'source',
  'source_type',
  'category',
  'pipeline_type',
  'agency_name',
  'geographic_reference',
  'impact_level',
  'active',
  'sort_order',
  'target_table',
  'filter_expr',
  'dedupe_on',
  'status_notes',
];

/** DB-managed; never authored in feeds.csv. */
export const FEEDS_DB_READONLY = ['updated_at'];

/** Minimum columns every feeds.csv row must supply. */
export const FEEDS_CSV_REQUIRED_COLUMNS = [
  'feed_id',
  'community_id',
  'source',
  'source_type',
  'category',
  'pipeline_type',
  'agency_name',
  'geographic_reference',
  'active',
];

/** Optional feeds.csv columns (carried when present; omitted columns keep DB values on sync). */
export const FEEDS_CSV_OPTIONAL_COLUMNS = [
  'impact_level',
  'sort_order',
  'target_table',
  'filter_expr',
  'dedupe_on',
  'status_notes',
];

/** Canonical feeds.csv header order (matches homesignal-ingest contract snapshot). */
export const FEEDS_CSV_COLUMNS = [
  'feed_id',
  'community_id',
  'source',
  'source_type',
  'category',
  'pipeline_type',
  'agency_name',
  'geographic_reference',
  'impact_level',
  'active',
  'sort_order',
  'target_table',
  'filter_expr',
  'dedupe_on',
  'status_notes',
];

/** Legacy CSV alias accepted at parse time (maps to filter_expr). */
export const FEEDS_CSV_COLUMN_ALIASES = { filter: 'filter_expr' };

/** Production source_type values (homesignal-ingest ingest.py + multi-county-plan.md). */
export const PRODUCTION_SOURCE_TYPES = ['rss', 'keyword', 'html', 'email'];

/**
 * Vendor adapters map to production source_type + URL shape (state-notice-portals.md).
 * @type {Record<string, { source_type: 'rss' | 'html', urlPattern: RegExp }>}
 */
export const VENDOR_ADAPTER = {
  granicus: {
    source_type: 'rss',
    urlPattern: /granicus\.com\/ViewPublisherRSS\.php/i,
  },
  legistar: {
    source_type: 'html',
    urlPattern: /\.legistar\.com\/Calendar\.aspx/i,
  },
  civicclerk: {
    source_type: 'html',
    urlPattern: /\.portal\.civicclerk\.com/i,
  },
};

export const COUNTY_COMMISSION_CATEGORY = 'County Commission & county business';

/** Defaults applied when optional columns are absent (candidate INSERT + normalize). */
export const FEEDS_OPTIONAL_DEFAULTS = {
  impact_level: 'medium',
  sort_order: 0,
  target_table: 'meetings',
  filter_expr: '',
  dedupe_on: '',
  status_notes: '',
};

/** Fields compared for feeds.csv → public.feeds drift when present in the CSV row. */
export const SYNC_COMPARE_FIELDS = [
  'community_id',
  'source',
  'source_type',
  'category',
  'pipeline_type',
  'agency_name',
  'geographic_reference',
  'impact_level',
  'active',
  'sort_order',
  'target_table',
  'filter_expr',
  'dedupe_on',
  'status_notes',
];
