// Shared helpers for development-tracker verification (verify-development.mjs,
// verify-representative-zips.mjs, and unit tests). Keep pure — no Playwright here.

/** A record_url must be an absolute http(s) URL with a real hostname. */
export function validRecordUrl(u) {
  if (!u || typeof u !== 'string') return false;
  try {
    const p = new URL(u.trim());
    return (p.protocol === 'https:' || p.protocol === 'http:') && /\./.test(p.hostname);
  } catch {
    return false;
  }
}

export const LIFECYCLE_BUCKETS = new Set(['built', 'approved', 'proposed']);

export const TABS_URL_RE = /^https:\/\/www\.tdlr\.texas\.gov\/TABS\/Projects\/(TABS\d{10})$/;

/** TDLR TABS sites must carry a project_no matching the record_url suffix. */
export function validateTabsSite(site) {
  const url = String((site && (site.url || site.record_url)) || '');
  if (!/tdlr\.texas\.gov/i.test(url)) return { ok: true, skip: true };
  const m = url.match(TABS_URL_RE);
  if (!m) return { ok: false, reason: `malformed TABS url: ${url}` };
  const suffix = m[1];
  const pno = site.project_no ? String(site.project_no).trim() : '';
  if (!pno) return { ok: false, reason: 'missing project_no on TABS site' };
  if (pno !== suffix) return { ok: false, reason: `project_no ${pno} !== url suffix ${suffix}` };
  return { ok: true };
}

/**
 * Representative ZIP panel — one per major pattern across states.
 * `expect` drives conditional assertions; omitted keys are not checked.
 */
export const REPRESENTATIVE_ZIPS = [
  {
    zip: '84302',
    label: 'Brigham City UT — planning hearings prototype',
    state: 'UT',
    expect: { devMin: 1, civicMin: 1, hearings: true, mapMarkers: true },
  },
  {
    zip: '78617',
    label: 'Del Valle TX — TABS permits + property dossier',
    state: 'TX',
    expect: { devMin: 1, tabs: true, propertyPage: '2200 CALDWELL LN, DEL VALLE, TX 78617', mapMarkers: true },
  },
  {
    zip: '60601',
    label: 'Chicago IL — dense Socrata permits',
    state: 'IL',
    expect: { devMin: 100, mapMarkers: true, filtering: true },
  },
  {
    zip: '02138',
    label: 'Cambridge MA — metro permits',
    state: 'MA',
    expect: { devMin: 50, mapMarkers: true },
  },
  {
    zip: '80202',
    label: 'Denver CO — Front Range permits',
    state: 'CO',
    expect: { devMin: 50, mapMarkers: true },
  },
  {
    zip: '98101',
    label: 'Seattle WA — Puget Sound permits',
    state: 'WA',
    expect: { devMin: 10, mapMarkers: true },
  },
  {
    zip: '48226',
    label: 'Detroit MI — BSEED permits',
    state: 'MI',
    expect: { devMin: 10, mapMarkers: true },
  },
  {
    zip: '84336',
    label: 'Snowville UT — resolved-project buckets',
    state: 'UT',
    expect: { devMin: 1, mapMarkers: true, badges: true },
  },
  {
    zip: '85004',
    label: 'Phoenix AZ — facilities-only honest empty',
    state: 'AZ',
    expect: { devMax: 0, facilitiesOnly: true, mapMarkers: true },
  },
  {
    zip: '01012',
    label: 'Chester MA — honest zero-content empty',
    state: 'MA',
    expect: { totalMax: 0, emptyState: true, mapMarkers: true },
  },
];

/** Summarize engine source-run reports across connector families. */
export function summarizeSourceReports(engineJson) {
  const reports = [];
  for (const key of ['socrata_reports', 'arcgis_reports', 'ckan_reports', 'carto_reports', 'csv_reports']) {
    for (const rep of engineJson[key] || []) {
      reports.push({ family: key.replace(/_reports$/, ''), ...rep });
    }
  }
  return reports;
}

/** Classify ingestion health from an engine response. */
export function ingestionIssues(engineJson) {
  const issues = [];
  const quarantined = engineJson.tabs_quarantined || engineJson.quarantined || [];
  for (const rep of summarizeSourceReports(engineJson)) {
    if ((rep.unmapped_statuses || []).length) {
      issues.push(`${rep.registry_id}: unmapped status(es) — ${rep.unmapped_statuses.map((u) => `${u.status}(${u.count})`).join(', ')}`);
    }
    if ((rep.no_record_url || 0) > 0) {
      issues.push(`${rep.registry_id}: ${rep.no_record_url} record(s) with no derivable record_url`);
    }
  }
  return { issues, quarantined };
}
