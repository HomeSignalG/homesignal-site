// Phase 1B P0 — canonical feed_id from communities.slug + vendor + target_table.

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VENDORS = new Set(['granicus', 'legistar', 'civicclerk']);
const TARGET_TABLES = new Set(['meetings']);

/**
 * @param {{ community_slug: string, vendor: string, target_table?: string }} args
 */
export function buildCanonicalFeedId({ community_slug, vendor, target_table = 'meetings' }) {
  if (!community_slug || !SLUG_RE.test(community_slug)) {
    throw new Error(`invalid community_slug: ${community_slug}`);
  }
  const v = String(vendor).toLowerCase();
  if (!VENDORS.has(v)) throw new Error(`unsupported vendor for feed_id: ${vendor}`);
  const tt = target_table || 'meetings';
  if (!TARGET_TABLES.has(tt)) throw new Error(`unsupported target_table: ${target_table}`);
  return `${community_slug}-${v}-${tt}`.replace(/--+/g, '-');
}

/**
 * @param {string} feedId
 */
export function parseCanonicalFeedId(feedId) {
  const parts = String(feedId).split('-');
  if (parts.length < 3) return null;
  const target_table = parts[parts.length - 1];
  const vendor = parts[parts.length - 2];
  const community_slug = parts.slice(0, -2).join('-');
  if (!VENDORS.has(vendor) || !TARGET_TABLES.has(target_table)) return null;
  return { community_slug, vendor, target_table };
}

/**
 * Legacy shim: derive slug from county_name + state when community_slug absent.
 * @param {{ county_name: string, state: string }} args
 */
export function legacySlugFromCounty({ county_name, state }) {
  const st = state.length === 2 ? state.toUpperCase() : state;
  return `${county_name}-${st}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * @param {{ community_slug?: string, county_name?: string, state?: string, vendor: string, target_table?: string }} args
 */
export function resolveFeedIdInput(args) {
  if (args.community_slug) {
    return {
      feed_id: buildCanonicalFeedId(args),
      community_slug: args.community_slug,
      legacy: false,
    };
  }
  if (args.county_name && args.state) {
    const community_slug = legacySlugFromCounty({ county_name: args.county_name, state: args.state });
    return {
      feed_id: buildCanonicalFeedId({ ...args, community_slug }),
      community_slug,
      legacy: true,
    };
  }
  throw new Error('community_slug or (county_name + state) required for feed_id');
}
