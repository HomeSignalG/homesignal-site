// Future Surroundings Report — Steps 9–13 scale layer.
// Coverage, usage, listing, portfolio, and API request validation.
// Assembles nothing from Census, OpenAddresses, Geoclient, ArcGIS, OSM, or get-address-report.
(function (root) {
  'use strict';

  var PRODUCT = 'HomeSignal Future Surroundings Report';
  var PORTFOLIO_KEY = 'hs_nyc_v1_portfolio';
  var USAGE_KEY = 'hs_nyc_v1_usage';
  var SIGNED_PAID_PILOTS = 0;
  var VERDICT = 'NOT YET';
  var FORBIDDEN_REQUEST_KEYS = {
    lat: 1, lng: 1, geocode: 1, census: 1, openaddresses: 1, arcgis: 1,
    osm: 1, score: 1, outlook: 1, sowhat: 1, impact: 1
  };

  function memoryStore(seed) {
    var data = {};
    if (seed) {
      Object.keys(seed).forEach(function (k) { data[k] = String(seed[k]); });
    }
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); }
    };
  }

  function readJson(store, key, fallback) {
    try {
      var raw = store && store.getItem ? store.getItem(key) : null;
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (_e) {
      return fallback;
    }
  }

  function writeJson(store, key, value) {
    if (!store || !store.setItem) return;
    store.setItem(key, JSON.stringify(value));
  }

  function coverageMatrix() {
    return {
      product: PRODUCT,
      as_of: '2026-09-27',
      verdict: VERDICT,
      signed_paid_pilots: SIGNED_PAID_PILOTS,
      assemblable_market_ids: ['nyc-v1'],
      markets: [
        {
          id: 'nyc-v1',
          market: 'New York City',
          assemblable: true,
          geography: {
            source: 'NYC AddressPoint',
            dataset_id: 'uf93-f8nk',
            host: 'data.cityofnewyork.us',
            classification: 'CLEARED WITH ATTRIBUTION',
            published_points: 967871,
            role: 'Property coordinate when the buyer-supplied address matches a published point'
          },
          publisher_data: [
            {
              source: 'nyc-dob-permit-issuance',
              dataset_id: 'ipu4-2q9a',
              classification: 'CLEARED WITH ATTRIBUTION',
              published_rows: 3990687,
              rows_with_publisher_coordinates: 3983266,
              allowlisted_type_and_coordinates: 754011
            },
            {
              source: 'nyc-dobnow-approved-permits',
              dataset_id: 'rbx6-tga4',
              classification: 'CLEARED WITH ATTRIBUTION',
              published_rows: 1006422,
              rows_with_publisher_coordinates: 999963,
              allowlisted_type_and_coordinates: 316643
            },
            {
              source: 'nyc-dobnow-job-filings',
              dataset_id: 'w9ak-ipjd',
              classification: 'CLEARED WITH ATTRIBUTION',
              published_rows: 962558,
              rows_with_publisher_coordinates: 957926,
              allowlisted_type_and_coordinates: 63748
            }
          ],
          hold: [],
          note: 'The only market that can be assembled entirely from cleared publisher data and cleared geography.'
        },
        {
          id: 'seattle',
          market: 'Seattle',
          assemblable: false,
          geography: {
            source: 'Addresses (MAF)',
            dataset_id: 'ctqe-m6xd',
            host: 'data.seattle.gov',
            classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED',
            assetType: 'federated_href',
            viewType: 'href',
            access_points: [
              'https://data-seattlecitygis.opendata.arcgis.com/datasets/SeattleCityGIS::addresses-maf',
              'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/TRANSPO_MAFDAP_PV/FeatureServer/0'
            ],
            role: 'Not a Socrata table. Empty columns. ArcGIS FeatureServer / Hub stay HOLD.'
          },
          publisher_data: [
            {
              source: 'seattle-building-permits',
              dataset_id: '76t5-zqzr',
              classification: 'CLEARED WITH ATTRIBUTION',
              paid_property_report: 'HOLD'
            }
          ],
          hold: [
            'Addresses (MAF) ctqe-m6xd is a federated_href to ArcGIS',
            'Census geocoder',
            'OpenAddresses',
            'ZCTA proximity'
          ],
          note: 'Permits stay CLEARED WITH ATTRIBUTION. Geography is not cleared. The market is not assemblable.'
        },
        {
          id: 'cambridge',
          market: 'Cambridge, MA',
          assemblable: false,
          geography: {
            source: 'Master Addresses List',
            dataset_id: 'vup6-kpwv',
            host: 'data.cambridgema.gov',
            classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED',
            published_rows: 20874,
            rows_with_publisher_coordinates: 20874,
            role: 'A real Socrata table with publisher coordinates, but the City publishes a conflicting commercial-use prohibition.'
          },
          publisher_data: [
            { source: 'cambridge-building-permits-new-construction', dataset_id: '9qm7-wbdc', classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED' },
            { source: 'cambridge-building-permits-addition-alteration', dataset_id: 'qu2z-8suj', classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED' },
            { source: 'cambridge-demolition-permits', dataset_id: 'kcfi-ackv', classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED' }
          ],
          hold: [
            'cambridgema.gov disclaimer: "Commercial Use Prohibited" without prior written consent',
            'PDDL appears in the Socrata license field and the GIS dictionary, and is not reconciled with that prohibition'
          ],
          note: 'docs/corporate-output-cambridge-pilot-attempt-2026-09-28.md'
        },
        {
          id: 'chicago',
          market: 'Chicago',
          assemblable: false,
          geography: { classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED', source: 'not opened as a cleared address table' },
          publisher_data: [
            { source: 'chicago-building-permits', dataset_id: 'ydr8-5enu', classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED' }
          ],
          hold: ['Publisher terms withhold a stable commercial grant'],
          note: 'docs/corporate-output-chicago-permits-2026-09-27.md'
        },
        {
          id: 'austin',
          market: 'Austin',
          assemblable: false,
          geography: { classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED', source: 'not opened as a cleared address table' },
          publisher_data: [
            { source: 'austin-issued-construction-permits', dataset_id: '3syk-w9eu', classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED' }
          ],
          hold: ['Portal story is not a stable grant'],
          note: 'docs/corporate-output-austin-issued-permits-2026-09-27.md'
        },
        {
          id: 'little-rock',
          market: 'Little Rock',
          assemblable: false,
          geography: { classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED', source: 'Permits_All MapServer' },
          publisher_data: [
            { source: 'little-rock-permits', classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED' }
          ],
          hold: ['ArcGIS MapServer'],
          note: 'docs/corporate-output-little-rock-permits-2026-09-27.md'
        },
        {
          id: 'brunswick',
          market: 'Brunswick County',
          assemblable: false,
          geography: { classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED', source: 'Permit_Locations FeatureServer' },
          publisher_data: [
            { source: 'brunswick-county-permits', classification: 'HOLD — TERMS/RIGHTS NOT ESTABLISHED' }
          ],
          hold: ['ArcGIS FeatureServer'],
          note: 'docs/corporate-output-brunswick-county-permits-2026-09-27.md'
        }
      ]
    };
  }

  function isNycV1Report(report) {
    return !!(report &&
      report.product === PRODUCT &&
      report.version === 'nyc-v1' &&
      report.buyer &&
      typeof report.report_id === 'string');
  }

  function listingSummary(report) {
    if (!isNycV1Report(report)) {
      return { status: 'rejected', reason: 'not an NYC V1 Future Surroundings Report' };
    }
    var nearby = report.nearby || [];
    var byType = {};
    var bySource = {};
    var byStage = {};
    nearby.forEach(function (row) {
      if (!row) return;
      var t = row.type || '(blank)';
      var s = row.source || '(blank)';
      var g = row.stage || '(blank)';
      byType[t] = (byType[t] || 0) + 1;
      bySource[s] = (bySource[s] || 0) + 1;
      byStage[g] = (byStage[g] || 0) + 1;
    });
    var first = nearby[0];
    return {
      product: PRODUCT,
      version: 'nyc-v1-listing',
      derived_from: report.report_id,
      status: report.status,
      listing: {
        buyer_address: report.buyer.address,
        buyer_zip: report.buyer.zip || '',
        addresspointid: report.property ? report.property.addresspointid : null,
        published_address: report.property
          ? [report.property.house_number, report.property.full_street_name].filter(Boolean).join(' ')
          : null,
        zipcode: report.property ? report.property.zipcode : null,
        lat: report.property ? report.property.lat : null,
        lng: report.property ? report.property.lng : null,
        radius_mi: report.radius_mi
      },
      nearby_count: nearby.length,
      nearby_matched: report.nearby_matched == null ? nearby.length : report.nearby_matched,
      nearby_truncated: !!report.nearby_truncated,
      nearest: first ? {
        address: first.address || '',
        zip: first.zip || '',
        type: first.type || '',
        status: first.status || '',
        stage: first.stage || '',
        date: first.date || '',
        date_label: first.date_label || '',
        distance_mi: first.distance_mi,
        source: first.source || '',
        case_number: first.case_number || ''
      } : null,
      by_type: byType,
      by_source: bySource,
      by_stage: byStage,
      attribution: report.attribution,
      exclusions: report.exclusions,
      investigate: report.investigate
    };
  }

  function listPortfolio(store) {
    var list = readJson(store, PORTFOLIO_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function addToPortfolio(store, report) {
    if (!isNycV1Report(report)) {
      return { ok: false, error: 'not an NYC V1 Future Surroundings Report' };
    }
    var list = listPortfolio(store).filter(function (x) { return x.report_id !== report.report_id; });
    list.unshift({
      report_id: report.report_id,
      generated_at: report.generated_at,
      status: report.status,
      address: report.buyer.address,
      zip: report.buyer.zip || '',
      radius_mi: report.radius_mi,
      addresspointid: report.property ? report.property.addresspointid : null,
      nearby_count: (report.nearby || []).length,
      report: report
    });
    writeJson(store, PORTFOLIO_KEY, list.slice(0, 25));
    return { ok: true, count: Math.min(list.length, 25) };
  }

  function removeFromPortfolio(store, reportId) {
    var id = String(reportId || '');
    var list = listPortfolio(store).filter(function (x) { return x.report_id !== id; });
    writeJson(store, PORTFOLIO_KEY, list);
    return { ok: true, count: list.length };
  }

  function summarizePortfolio(store) {
    var list = listPortfolio(store);
    var points = {};
    var okCount = 0;
    var missCount = 0;
    var nearbyTotal = 0;
    list.forEach(function (x) {
      if (x.status === 'ok') okCount++;
      else missCount++;
      nearbyTotal += Number(x.nearby_count) || 0;
      if (x.addresspointid) points[x.addresspointid] = 1;
    });
    return {
      product: PRODUCT,
      version: 'nyc-v1-portfolio',
      count: list.length,
      unique_addresspoints: Object.keys(points).length,
      reports_ok: okCount,
      reports_miss: missCount,
      nearby_total: nearbyTotal,
      markets: { 'nyc-v1': list.length },
      signed_paid_pilots: SIGNED_PAID_PILOTS,
      verdict: VERDICT
    };
  }

  function listUsage(store) {
    var list = readJson(store, USAGE_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function recordUse(store, event) {
    var kind = event && event.kind ? String(event.kind) : '';
    if (!kind) return { ok: false, error: 'kind required' };
    var list = listUsage(store);
    list.unshift({
      kind: kind,
      report_id: event.report_id || '',
      at: event.at || new Date().toISOString()
    });
    writeJson(store, USAGE_KEY, list.slice(0, 200));
    return { ok: true, count: Math.min(list.length, 200) };
  }

  function usageSummary(store) {
    var list = listUsage(store);
    var byKind = {};
    var ids = {};
    list.forEach(function (e) {
      byKind[e.kind] = (byKind[e.kind] || 0) + 1;
      if (e.report_id) ids[e.report_id] = 1;
    });
    return {
      product: PRODUCT,
      version: 'nyc-v1-usage',
      events: list.length,
      by_kind: byKind,
      distinct_report_ids: Object.keys(ids).length,
      signed_paid_pilots: SIGNED_PAID_PILOTS,
      verdict: VERDICT,
      note: 'No customer has been sold an allowlisted artifact. This log is local instrumentation only.'
    };
  }

  function validateApiRequest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, error: 'JSON object required' };
    }
    var keys = Object.keys(body);
    for (var i = 0; i < keys.length; i++) {
      if (FORBIDDEN_REQUEST_KEYS[String(keys[i]).toLowerCase()]) {
        return { ok: false, error: 'field not on the NYC V1 allowlist: ' + keys[i] };
      }
    }
    if (body.market && body.market !== 'nyc-v1' && body.market !== 'nyc') {
      return { ok: false, error: 'market is not assemblable' };
    }
    var address = String(body.address || '').trim();
    if (!address) return { ok: false, error: 'address required' };
    var zip = String(body.zip || '').trim();
    if (zip && !/^\d{5}$/.test(zip)) return { ok: false, error: 'zip must be five digits' };
    var radius = Number(body.radius_mi);
    if (!isFinite(radius) || radius <= 0) radius = 0.5;
    if (radius > 1) radius = 1;
    return { ok: true, address: address, zip: zip, radius_mi: radius, market: 'nyc-v1' };
  }

  function apiCapability() {
    return {
      product: PRODUCT,
      version: 'nyc-v1',
      market: 'nyc-v1',
      host: 'data.cityofnewyork.us',
      datasets: ['uf93-f8nk', 'ipu4-2q9a', 'rbx6-tga4', 'w9ak-ipjd'],
      signed_paid_pilots: SIGNED_PAID_PILOTS,
      verdict: VERDICT,
      note: 'POST { address, zip, radius_mi }. The function fetches only those four NYC Open Data views.'
    };
  }

  var api = {
    PRODUCT: PRODUCT,
    PORTFOLIO_KEY: PORTFOLIO_KEY,
    USAGE_KEY: USAGE_KEY,
    SIGNED_PAID_PILOTS: SIGNED_PAID_PILOTS,
    VERDICT: VERDICT,
    memoryStore: memoryStore,
    coverageMatrix: coverageMatrix,
    isNycV1Report: isNycV1Report,
    listingSummary: listingSummary,
    listPortfolio: listPortfolio,
    addToPortfolio: addToPortfolio,
    removeFromPortfolio: removeFromPortfolio,
    summarizePortfolio: summarizePortfolio,
    listUsage: listUsage,
    recordUse: recordUse,
    usageSummary: usageSummary,
    validateApiRequest: validateApiRequest,
    apiCapability: apiCapability
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HSFsrScale = api;
})(typeof window !== 'undefined' ? window : globalThis);
