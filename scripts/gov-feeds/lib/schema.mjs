import {
  COUNTY_COMMISSION_CATEGORY,
  FEEDS_CSV_COLUMNS,
  FEEDS_OPTIONAL_DEFAULTS,
  PRODUCTION_SOURCE_TYPES,
  SYNC_COMPARE_FIELDS,
  VENDOR_ADAPTER,
} from './production-contract.mjs';

export { COUNTY_COMMISSION_CATEGORY, FEEDS_CSV_COLUMNS as CSV_COLUMNS };

/**
 * @typedef {Object} FeedRecord
 * @property {string} feed_id
 * @property {string} community_id
 * @property {string} source
 * @property {string} source_type
 * @property {string} category
 * @property {string} pipeline_type
 * @property {string} agency_name
 * @property {string} geographic_reference
 * @property {string} impact_level
 * @property {boolean} active
 * @property {number} sort_order
 * @property {string} target_table
 * @property {string} filter_expr
 * @property {string} dedupe_on
 * @property {string} status_notes
 * @property {string[]} [presentColumns] columns supplied by the CSV row (sync scope)
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL_RE = /^https?:\/\//i;
const EMAIL_SOURCE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** @param {unknown} v */
export function parseBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n', ''].includes(s)) return false;
  throw new Error(`invalid boolean: ${JSON.stringify(v)}`);
}

/** @param {unknown} v */
export function parseSortOrder(v) {
  if (v === undefined || v === null || v === '') return FEEDS_OPTIONAL_DEFAULTS.sort_order;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid sort_order: ${JSON.stringify(v)}`);
  return Math.trunc(n);
}

/** Map legacy/wrong column names from tooling drafts to production. */
export function coerceFeedRow(raw) {
  const row = { ...raw };
  if (!row.source && row.source_url) row.source = row.source_url;
  if (row.filter_expr === undefined && row.filter !== undefined) row.filter_expr = row.filter;
  if (row.source_type === 'granicus_rss') row.source_type = 'rss';
  if (row.source_type === 'legistar' || row.source_type === 'civicclerk') row.source_type = 'html';
  return row;
}

/** @param {string} sourceType @param {string} source */
export function validateSourceForType(sourceType, source) {
  const s = String(source ?? '').trim();
  if (!s) return ['source is required'];

  switch (sourceType) {
    case 'rss':
    case 'html':
      if (!HTTP_URL_RE.test(s)) return ['source must be an http(s) URL for rss/html feeds'];
      break;
    case 'keyword':
      if (s.length < 2) return ['source must be a non-empty keyword or search URL'];
      break;
    case 'email':
      if (!EMAIL_SOURCE_RE.test(s) && !HTTP_URL_RE.test(s) && !/^mailto:/i.test(s)) {
        return ['source must be an email address, mailto: URL, or http(s) mailbox endpoint for email feeds'];
      }
      break;
    default:
      break;
  }
  return [];
}

/** @param {Partial<FeedRecord>} row @param {{ allowInactive?: boolean, requireCandidateInactive?: boolean, columnsPresent?: string[] }} [opts] */
export function validateFeedRecord(row, { allowInactive = true, requireCandidateInactive = false, columnsPresent } = {}) {
  const errors = [];
  if (!row.feed_id || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(row.feed_id)) {
    errors.push('feed_id must be kebab-case slug (3–81 chars)');
  }
  if (!row.community_id || !UUID_RE.test(row.community_id)) {
    errors.push('community_id must be a UUID');
  }
  if (!row.source_type || !PRODUCTION_SOURCE_TYPES.includes(row.source_type)) {
    errors.push(`source_type must be one of: ${PRODUCTION_SOURCE_TYPES.join(', ')}`);
  } else if (row.source) {
    errors.push(...validateSourceForType(row.source_type, row.source));
  } else {
    errors.push('source is required');
  }
  if (!row.category) errors.push('category is required');
  if (!row.pipeline_type) errors.push('pipeline_type is required');
  if (!row.agency_name) errors.push('agency_name is required');
  if (!row.geographic_reference) errors.push('geographic_reference is required');
  if (row.active === undefined) errors.push('active is required');
  if (!allowInactive && !row.active) errors.push('active must be true for go-live rows');
  if (requireCandidateInactive && row.active) {
    errors.push('candidate rows must have active=false until deliberate go-live');
  }

  if (columnsPresent?.includes('target_table') && !row.target_table) {
    errors.push('target_table must be non-empty when provided in CSV');
  }

  if (row.source && row.source_type) {
    const vendor = Object.entries(VENDOR_ADAPTER).find(([, cfg]) => cfg.source_type === row.source_type && cfg.urlPattern.test(row.source));
    if (row.source_type === 'rss' && /granicus\.com/i.test(row.source) && !vendor) {
      errors.push('rss Granicus source must be a ViewPublisherRSS.php URL');
    }
    if (row.source_type === 'html' && (/legistar\.com/i.test(row.source) || /civicclerk\.com/i.test(row.source)) && !vendor) {
      errors.push('html vendor source URL does not match Legistar or CivicClerk patterns');
    }
  }

  return errors;
}

/**
 * @param {Partial<FeedRecord>} row
 * @param {{ presentColumns?: string[] }} [opts]
 */
export function normalizeFeedRecord(row, { presentColumns } = {}) {
  const coerced = coerceFeedRow(row);
  const present = presentColumns || Object.keys(coerced).filter((k) => coerced[k] !== undefined && coerced[k] !== '');

  /** @param {keyof typeof FEEDS_OPTIONAL_DEFAULTS} key */
  const opt = (key) => {
    if (present.includes(key) || coerced[key] !== undefined) {
      return String(coerced[key] ?? FEEDS_OPTIONAL_DEFAULTS[key]).trim();
    }
    return String(FEEDS_OPTIONAL_DEFAULTS[key]).trim();
  };

  return {
    feed_id: String(coerced.feed_id).trim(),
    community_id: String(coerced.community_id).trim(),
    source: String(coerced.source).trim(),
    source_type: String(coerced.source_type).trim(),
    category: String(coerced.category).trim(),
    pipeline_type: String(coerced.pipeline_type).trim(),
    agency_name: String(coerced.agency_name).trim(),
    geographic_reference: String(coerced.geographic_reference).trim(),
    impact_level: opt('impact_level'),
    active: parseBool(coerced.active),
    sort_order: parseSortOrder(coerced.sort_order),
    target_table: opt('target_table'),
    filter_expr: opt('filter_expr'),
    dedupe_on: opt('dedupe_on'),
    status_notes: opt('status_notes'),
    presentColumns: present,
  };
}

/** @param {FeedRecord} row */
export function feedRecordKey(row) {
  return row.feed_id;
}

/**
 * Compare only fields the CSV row actually authored.
 * @param {FeedRecord} a csv row
 * @param {FeedRecord} b db row
 */
export function diffFeedRecords(a, b) {
  const present = new Set(a.presentColumns?.length ? a.presentColumns : SYNC_COMPARE_FIELDS);
  const mismatches = [];
  for (const field of SYNC_COMPARE_FIELDS) {
    if (!present.has(field)) continue;
    const av = a[field];
    const bv = b[field];
    if (field === 'active') {
      if (parseBool(av) !== parseBool(bv)) mismatches.push({ field, csv: av, db: bv });
    } else if (field === 'sort_order') {
      if (parseSortOrder(av) !== parseSortOrder(bv)) mismatches.push({ field, csv: av, db: bv });
    } else if (String(av ?? '') !== String(bv ?? '')) {
      mismatches.push({ field, csv: av, db: bv });
    }
  }
  return mismatches;
}
