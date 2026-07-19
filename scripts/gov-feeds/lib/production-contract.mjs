// Verified against live public.feeds via PostgREST column probe (2026-07-19).
// Evidence: GET /rest/v1/feeds?select=<col>&limit=1 — 200 for listed cols, 400 otherwise.
//
// homesignal-ingest load_config reads these rows; feeds.csv in the INGEST repo
// is the versioned authoring surface (not duplicated in homesignal-site).

/** Writable columns on public.feeds (all included in INSERT SQL). */
export const FEEDS_TABLE_COLUMNS = [
  'feed_id',
  'community_id',
  'county',
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

/**
 * Verbatim header from homesignal-ingest/feeds.csv (authoritative ingest contract).
 * Vendored in fixtures/gov-feeds/feeds-ingest-contract.csv — do not reorder casually.
 */
export const FEEDS_INGEST_CSV_HEADER =
  'feed_id,county,community_id,source,source_type,category,pipeline_type,agency_name,geographic_reference,impact_level,active,sort_order,target_table,filter,dedupe_on,status / notes';

/** CSV header labels → canonical public.feeds / internal column names. */
export const FEEDS_CSV_COLUMN_ALIASES = {
  filter: 'filter_expr',
  'status / notes': 'status_notes',
};

/** Canonical column names accepted from feeds.csv (maps 1:1 to DB except updated_at). */
export const FEEDS_CSV_KNOWN_COLUMNS = [...FEEDS_TABLE_COLUMNS];

/** Minimum columns every feeds.csv row must supply (after alias resolution). */
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
  'county',
  'impact_level',
  'sort_order',
  'target_table',
  'filter_expr',
  'dedupe_on',
  'status_notes',
];

/** Internal column order for tooling that emits canonical (non-ingest) CSV. */
export const FEEDS_CSV_COLUMNS = [...FEEDS_TABLE_COLUMNS];

/**
 * Ingest runtime keys on community_id (multi-county-plan.md). The county column is
 * denormalized operator metadata in public.feeds for spreadsheet readability and
 * sync drift checks — NOT the ingest routing key. Preserved end-to-end when present
 * in feeds.csv; load_config adapter consumption inside homesignal-ingest is not
 * verified in this repo (private ingest repo).
 */
export const COUNTY_COLUMN_RUNTIME_NOTE =
  'county is stored in public.feeds and synced from feeds.csv; ingest selects feeds by community_id.';

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
  county: '',
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
  'county',
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

/** @param {string} rawHeaderCell */
export function canonicalCsvColumn(rawHeaderCell) {
  const trimmed = String(rawHeaderCell ?? '').trim();
  return FEEDS_CSV_COLUMN_ALIASES[trimmed] || trimmed;
}

/** @param {string} canonical */
export function isKnownFeedsCsvColumn(canonical) {
  return FEEDS_CSV_KNOWN_COLUMNS.includes(canonical);
}
