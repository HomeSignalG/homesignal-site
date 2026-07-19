// Vendor discovery + dry-run probes for county government meeting feeds.
// Supports Granicus RSS, Legistar, and CivicClerk — the three adapters already
// live in homesignal-ingest (parse_granicus_rss, adapters/legistar.py,
// adapters/civicclerk.py).

/**
 * @typedef {Object} CountyInput
 * @property {string} county_name
 * @property {string} state
 * @property {string} [community_id]
 * @property {string} [slug]
 * @property {{ granicus_entity?: string, legistar_client?: string, civicclerk_sub?: string }} [hints]
 */

/**
 * @typedef {'granicus' | 'legistar' | 'civicclerk'} VendorId
 */

/**
 * @typedef {Object} DiscoveryHit
 * @property {VendorId} vendor
 * @property {string} source_url
 * @property {number} confidence
 * @property {string} reason
 * @property {Record<string, unknown>} [probe]
 */

const SLUG_PARTS_RE = /\b(county|parish|borough|census area|municipality|city and borough)\b/gi;

export function slugifyCounty(countyName, stateAbbr) {
  const base = countyName
    .replace(SLUG_PARTS_RE, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
  const st = String(stateAbbr || '').toLowerCase().replace(/[^a-z]/g, '');
  return { base, withCounty: `${base}county`, withState: st ? `${base}${st}` : base };
}

/** @param {CountyInput} input */
export function buildDiscoveryCandidates(input) {
  const st = input.state.length === 2 ? input.state.toUpperCase() : input.state;
  const slugs = slugifyCounty(input.county_name, st);
  const hints = input.hints || {};
  const geo = `${input.county_name}, ${st}`;
  const agency = `${input.county_name} Board of Commissioners`;

  /** @type {Array<{ vendor: DiscoveryHit['vendor'], urls: string[], reason: string }>} */
  const out = [];

  const granicusEntities = unique([
    hints.granicus_entity,
    slugs.base,
    slugs.withCounty,
    slugs.withState,
    input.slug,
  ].filter(Boolean).map((s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '')));

  for (const entity of granicusEntities) {
  for (const viewId of [1, 2, 3, 18, 28]) {
      out.push({
        vendor: 'granicus',
        urls: [`https://${entity}.granicus.com/ViewPublisherRSS.php?view_id=${viewId}&mode=agendas`],
        reason: `granicus entity=${entity} view_id=${viewId}`,
      });
    }
  }

  const legistarClients = unique([
    hints.legistar_client,
    slugs.base,
    slugs.withCounty,
    `${slugs.base}county`,
    input.slug,
  ].filter(Boolean).map((s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '')));

  for (const client of legistarClients) {
    out.push({
      vendor: 'legistar',
      urls: [`https://${client}.legistar.com/Calendar.aspx`],
      reason: `legistar client=${client}`,
    });
  }

  const civicSubs = unique([
    hints.civicclerk_sub,
    `${slugs.base}co${st.toLowerCase()}`,
    `${slugs.base}county${st.toLowerCase()}`,
    slugs.withCounty,
    input.slug,
  ].filter(Boolean).map((s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '')));

  for (const sub of civicSubs) {
    out.push({
      vendor: 'civicclerk',
      urls: [`https://${sub}.portal.civicclerk.com/`],
      reason: `civicclerk sub=${sub}`,
    });
  }

  return { geo, agency, candidates: out };
}

function unique(arr) {
  return [...new Set(arr)];
}

/**
 * Offline-safe probe using injected fetch (for tests) or global fetch (CI).
 * @param {string} url
 * @param {{ fetchFn?: typeof fetch, timeoutMs?: number }} [opts]
 */
export async function probeUrl(url, opts = {}) {
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctl.signal,
      headers: {
        'User-Agent': 'HomeSignal-gov-feed-discovery/1.0 (+https://homesignal.net)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, bytes: body.length, body };
  } catch (e) {
    return { ok: false, status: 0, bytes: 0, body: '', error: String(e && e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} body */
export function analyzeGranicusRss(body) {
  if (!body.includes('<rss') && !body.includes('<channel')) return { valid: false, items: 0, sampleTitle: '' };
  const items = (body.match(/<item\b/gi) || []).length;
  const m = body.match(/<title>([^<]+)<\/title>/i);
  return { valid: items > 0, items, sampleTitle: m ? m[1].trim() : '' };
}

/** @param {string} body @param {number} status */
export function analyzeLegistar(body, status) {
  const valid = status === 200 && /legistar/i.test(body) && (/Calendar/i.test(body) || /Meeting/i.test(body));
  return { valid, hasCalendar: /Calendar/i.test(body) };
}

/** @param {string} portalUrl @param {{ fetchFn?: typeof fetch }} [opts] */
export async function probeCivicClerk(portalUrl, opts = {}) {
  const sub = portalUrl.match(/https?:\/\/([^.]+)\.portal\.civicclerk\.com/i)?.[1];
  if (!sub) return { valid: false, events: 0, apiUrl: '' };
  const apiUrl = `https://${sub}.api.civicclerk.com/v1/Events?$top=5&$orderby=startDateTime%20desc`;
  const res = await probeUrl(apiUrl, opts);
  let events = 0;
  let sampleTitle = '';
  if (res.ok) {
    try {
      const data = JSON.parse(res.body);
      const list = data.value || data.events || [];
      events = Array.isArray(list) ? list.length : 0;
      sampleTitle = events ? String(list[0].eventName || list[0].title || '') : '';
    } catch { /* non-json */ }
  }
  return {
    valid: events > 0,
    events,
    sampleTitle,
    apiUrl,
    status: res.status,
  };
}

/**
 * Score a probe result for ranking discovery hits.
 * @param {DiscoveryHit['vendor']} vendor
 * @param {Awaitable<Record<string, unknown>>} probeResult
 */
export function scoreProbe(vendor, probeResult) {
  if (vendor === 'granicus') {
    const { valid, items, sampleTitle } = probeResult;
    if (!valid) return 0;
    let score = 50 + Math.min(items, 50);
    if (/commission|county|council|board/i.test(sampleTitle || '')) score += 20;
    return score;
  }
  if (vendor === 'legistar') {
    return probeResult.valid ? 60 : 0;
  }
  if (vendor === 'civicclerk') {
    const events = Number(probeResult.events || 0);
    if (!events) return 0;
    let score = 55 + events * 5;
    if (/commission|county|council|court/i.test(String(probeResult.sampleTitle || ''))) score += 15;
    return score;
  }
  return 0;
}

/**
 * Run discovery for one county — tries hinted + generated URLs, returns ranked hits.
 * @param {CountyInput} input
 * @param {{ fetchFn?: typeof fetch, maxProbes?: number }} [opts]
 */
export async function discoverCountyVendor(input, opts = {}) {
  const { geo, agency, candidates } = buildDiscoveryCandidates(input);
  const maxProbes = opts.maxProbes ?? 40;
  /** @type {DiscoveryHit[]} */
  const hits = [];
  let probed = 0;

  for (const cand of candidates) {
    if (probed >= maxProbes) break;
    for (const url of cand.urls) {
      if (probed >= maxProbes) break;
      probed++;
      if (cand.vendor === 'granicus') {
        const res = await probeUrl(url, opts);
        const analysis = analyzeGranicusRss(res.body);
        const confidence = scoreProbe('granicus', analysis);
        if (confidence > 0) {
          hits.push({
            vendor: 'granicus',
            source_url: url,
            confidence,
            reason: `${cand.reason}; items=${analysis.items}`,
            probe: { status: res.status, items: analysis.items, sampleTitle: analysis.sampleTitle },
          });
        }
      } else if (cand.vendor === 'legistar') {
        const res = await probeUrl(url, opts);
        const analysis = analyzeLegistar(res.body, res.status);
        const confidence = scoreProbe('legistar', analysis);
        if (confidence > 0) {
          hits.push({
            vendor: 'legistar',
            source_url: url,
            confidence,
            reason: cand.reason,
            probe: { status: res.status, ...analysis },
          });
        }
      } else if (cand.vendor === 'civicclerk') {
        const analysis = await probeCivicClerk(url, opts);
        const confidence = scoreProbe('civicclerk', analysis);
        if (confidence > 0) {
          hits.push({
            vendor: 'civicclerk',
            source_url: url,
            confidence,
            reason: `${cand.reason}; events=${analysis.events}`,
            probe: analysis,
          });
        }
      }
    }
  }

  hits.sort((a, b) => b.confidence - a.confidence);
  return { county: input.county_name, state: input.state, geo, agency, hits, probed };
}
