// Phase 1B P0 — feed-scoped L2 verification (not hostname alone).

const VENDOR_HOST_ALLOW = {
  granicus: /granicus\.com/i,
  legistar: /legistar\.com/i,
  civicclerk: /civicclerk\.com/i,
};

/**
 * @param {string} sourceUrl
 * @param {string} [vendor]
 */
export function extractFeedScope(sourceUrl, vendor) {
  let u;
  try {
    u = new URL(sourceUrl);
  } catch {
    return { vendor: vendor || 'unknown', discriminator: null, mode: 'invalid' };
  }

  const host = u.hostname.toLowerCase();
  const v = vendor || inferVendor(host, u);

  if (v === 'granicus') {
    const viewId = u.searchParams.get('view_id');
    return {
      vendor: 'granicus',
      discriminator: viewId,
      mode: viewId ? 'granicus_view_id' : 'granicus_host_fallback',
      host,
    };
  }

  if (v === 'legistar') {
    const client = host.split('.')[0];
    return {
      vendor: 'legistar',
      discriminator: client,
      mode: 'legistar_client',
      host,
    };
  }

  if (v === 'civicclerk') {
    const sub = host.split('.')[0];
    const portalMatch = sourceUrl.match(/([a-z0-9-]+)\.portal\.civicclerk\.com/i);
    return {
      vendor: 'civicclerk',
      discriminator: portalMatch ? portalMatch[1] : sub,
      mode: 'civicclerk_sub',
      host,
    };
  }

  return { vendor: v, discriminator: host, mode: 'host_only', host };
}

/**
 * @param {string} host
 * @param {URL} u
 */
function inferVendor(host, u) {
  if (VENDOR_HOST_ALLOW.granicus.test(host)) return 'granicus';
  if (VENDOR_HOST_ALLOW.legistar.test(host)) return 'legistar';
  if (VENDOR_HOST_ALLOW.civicclerk.test(host)) return 'civicclerk';
  if (u.pathname.includes('Calendar.aspx')) return 'legistar';
  return 'unknown';
}

/**
 * Build PostgREST ilike pattern for meetings.source_url scoping.
 * @param {string} sourceUrl
 * @param {string} [vendor]
 * @param {{ legacyHostScope?: boolean }} [opts]
 */
export function buildMeetingsScopeFilter(sourceUrl, vendor, { legacyHostScope = false } = {}) {
  const scope = extractFeedScope(sourceUrl, vendor);
  if (legacyHostScope || scope.mode === 'host_only' || scope.mode === 'granicus_host_fallback') {
    const hostPat = scope.host.replace(/\./g, '\\.');
    return { type: 'host', pattern: hostPat, scope };
  }

  if (scope.mode === 'granicus_view_id') {
    return {
      type: 'granicus_view_id',
      pattern: `view_id=${scope.discriminator}`,
      scope,
    };
  }

  if (scope.mode === 'legistar_client') {
    return {
      type: 'legistar_client',
      pattern: `${scope.discriminator}\\.legistar\\.com`,
      scope,
    };
  }

  if (scope.mode === 'civicclerk_sub') {
    return {
      type: 'civicclerk_sub',
      pattern: `${scope.discriminator}\\.portal\\.civicclerk\\.com|${scope.discriminator}\\.api\\.civicclerk\\.com`,
      scope,
    };
  }

  const hostPat = scope.host.replace(/\./g, '\\.');
  return { type: 'host', pattern: hostPat, scope };
}

/**
 * @param {string} meetingSourceUrl
 * @param {ReturnType<typeof buildMeetingsScopeFilter>} filter
 */
export function meetingMatchesScope(meetingSourceUrl, filter) {
  const url = String(meetingSourceUrl || '');
  if (!url) return false;
  const re = new RegExp(filter.pattern, 'i');
  return re.test(url);
}
