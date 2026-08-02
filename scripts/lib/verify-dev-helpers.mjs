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
    // 2026-08-02: this slot WAS 85004 "Phoenix AZ — facilities-only honest empty", devMax: 0.
    // Wiring `phoenix-building-permits` made that page dev-backed (3,651 sourced records), so
    // the verifier was correctly reporting that the page no longer matched an expectation which
    // had itself gone stale — a fixture failing, not a product defect. It went red daily.
    //
    // The assertion still earns its place: it proves the honest facilities-only page renders the
    // EPA-only coverage copy rather than a blank or a fabricated one. So it moves to a ZIP that
    // is genuinely facilities-only — Fargo ND, in a state with no wired per-record permit source,
    // so it will not flip the moment a metro gets wired. Verified 2026-08-02: facilities 40,
    // development 0, sourced records 0.
    zip: '58102',
    label: 'Fargo ND — facilities-only honest empty',
    state: 'ND',
    expect: { devMax: 0, facilitiesOnly: true, mapMarkers: true },
  },
  {
    // And 85004 keeps its coverage as what it now IS — a dev-backed Phoenix page. Losing the
    // exemplar entirely would have quietly dropped a metro from the representative set.
    zip: '85004',
    label: 'Phoenix AZ — city permit ledger (phoenix-building-permits)',
    state: 'AZ',
    expect: { devMin: 10, mapMarkers: true },
  },
  {
    zip: '01012',
    label: 'Chester MA — honest zero-content empty',
    state: 'MA',
    expect: { totalMax: 0, emptyState: true, mapMarkers: true },
  },
];

// Every per-ZIP assertion, as a pure function of (cached row, stamped flag, rendered page).
// Pure and re-runnable: that is what lets the race guard replay it against a fresher row.
export function assertZip(zip, rep, isIndexable, st) {
  const fails = [];
  const wantFac = (rep.counts && rep.counts.facilities != null) ? rep.counts.facilities : null;
  const sites = Array.isArray(rep.sites) ? rep.sites : [];

  // NEW LAYOUT: every tracker page must render the shared left-sidebar shell.
  if (!st.shell) fails.push(`ZIP ${zip}: new sidebar shell did not render (old layout?)`);
  // SUBSTANCE GATE: indexable iff the stamped flag is true AND the page rendered content.
  const renderedForPolicy = st.rendered != null ? st.rendered : sites;
  const isIndex = /(^|[^n])index/i.test(st.robots) && !/noindex/i.test(st.robots);
  const expectIndex = isIndexable && renderedForPolicy.length > 0;
  if (isIndex !== expectIndex) {
    fails.push(`ZIP ${zip}: robots="${st.robots}" (indexable=${isIndex}) violates the substance gate ` +
      `(expected ${expectIndex ? 'index' : 'noindex'}; flag=${isIndexable}, sites=${renderedForPolicy.length})`);
  }
  if (st.mislabeled && st.mislabeled.length) {
    fails.push(`ZIP ${zip}: ${st.mislabeled.length} record(s) whose label contradicts its dot colour ` +
      `[${st.mislabeled.slice(0, 3).join(', ')}] (stage/colour must agree)`);
  }

  if (!st.mapInited) {
    fails.push(`ZIP ${zip}: map did not initialize`);
    return { fails, check: [] };
  }

  // Facility-count reconciliation (page vs cached report).
  const facShown = st.facText != null ? parseInt(st.facText, 10) : null;
  if (wantFac != null && facShown != null && facShown !== wantFac) {
    fails.push(`ZIP ${zip}: facility count ${facShown} != cached counts.facilities ${wantFac}`);
  }

  // THE ANTI-FABRICATION INVARIANT: every rendered site must carry a record_url.
  const check = st.rendered != null ? st.rendered : sites;
  const noSource = check.filter((s) => !(s && (s.url || s.record_url)));
  if (noSource.length) {
    fails.push(`ZIP ${zip}: ${noSource.length} rendered site(s) with NO record_url — ` +
      `[${noSource.slice(0, 3).map((s) => (s && s.label) || '??').join(', ')}] (fabrication gate)`);
  }

  // ── Task 6 extensions (render-layer invariants; no extra network) ──────────────────
  // 1) record_url points somewhere official (pattern + domain, not body-200).
  const badUrl = check.filter((s) => { const u = s && (s.url || s.record_url); return u && !validRecordUrl(u); });
  if (badUrl.length) {
    fails.push(`ZIP ${zip}: ${badUrl.length} record(s) with a malformed record_url — ` +
      `[${badUrl.slice(0, 3).map((s) => (s && (s.url || s.record_url)) || '??').join(', ')}]`);
  }
  // 2) a jurisdiction-scope record must NOT be rendered as a precise point.
  const fakePoint = check.filter((s) => s && s.geo_precision === 'jurisdiction' && s.scope === 'point');
  if (fakePoint.length) {
    fails.push(`ZIP ${zip}: ${fakePoint.length} jurisdiction-scope record(s) rendered as a precise point ` +
      `[${fakePoint.slice(0, 3).map((s) => (s && s.label) || '??').join(', ')}]`);
  }
  // 3) no bucket outside the lifecycle map: every development record's type ∈ {built,approved,proposed}.
  const devRecs = check.filter((s) => s && s.relevance === 'development');
  const badBucket = devRecs.filter((s) => !LIFECYCLE_BUCKETS.has(s.type));
  if (badBucket.length) {
    fails.push(`ZIP ${zip}: ${badBucket.length} development record(s) with a bucket outside the map ` +
      `(type ∉ built/approved/proposed) [${badBucket.slice(0, 3).map((s) => `${(s.label||'??')}=${s.type}`).join(', ')}]`);
  }
  // 4) Task 5 — ONE PREDICATE PER NUMBER: each cached count === the rendered array it heads.
  const c = rep.counts || {};
  const proposedN = devRecs.filter((s) => s.type === 'proposed').length;
  const approvedN = devRecs.filter((s) => s.type === 'approved').length;
  const operatingN = devRecs.filter((s) => s.type === 'built').length;
  const commentN = check.filter((s) => s && s.comment_open === true).length;
  if (c.proposed != null && c.proposed !== proposedN)
    fails.push(`ZIP ${zip}: counts.proposed ${c.proposed} !== rendered proposed rail ${proposedN} (Task 5)`);
  if (c.approved != null && c.approved !== approvedN)
    fails.push(`ZIP ${zip}: counts.approved ${c.approved} !== rendered approved rail ${approvedN} (Task 5)`);
  if (c.operating != null && c.operating !== operatingN)
    fails.push(`ZIP ${zip}: counts.operating ${c.operating} !== rendered operating rail ${operatingN} (Task 5)`);
  if (c.comment_open != null && c.comment_open !== commentN)
    fails.push(`ZIP ${zip}: counts.comment_open ${c.comment_open} !== commentable set ${commentN} (Task 5)`);

  // TABS invariant (docs/tdlr-tabs-adapter-runbook.md §3): TX permit filings must carry
  // a canonical record_url whose suffix matches project_no.
  const tabsBad = check.filter((s) => {
    const v = validateTabsSite(s);
    return !v.ok && !v.skip;
  });
  if (tabsBad.length) {
    fails.push(`ZIP ${zip}: ${tabsBad.length} TABS site(s) with project_no/url mismatch ` +
      `[${tabsBad.slice(0, 2).map((s) => s.project_no || s.label).join(', ')}]`);
  }
  return { fails, check, facShown };
}

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
