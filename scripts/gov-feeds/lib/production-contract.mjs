// Verified against live public.feeds via PostgREST column probe (2026-07-19).
// Evidence: GET /rest/v1/feeds?select=<col>&limit=1 — 200 for listed cols, 400 otherwise.
//
// homesignal-ingest load_config reads these rows; feeds.csv in the INGEST repo
// is the versioned authoring surface (not duplicated in homesignal-site).

/** Columns that exist on public.feeds (read/write for sync). */
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
];

/** Columns returned by PostgREST but not authored in feeds.csv. */
export const FEEDS_DB_READONLY = ['updated_at'];

/** feeds.csv authoring columns (= table columns). */
export const FEEDS_CSV_COLUMNS = [...FEEDS_TABLE_COLUMNS];

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

/** Fields compared for feeds.csv → public.feeds drift (meaningful only). */
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
];
