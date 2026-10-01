// NYC V1 Future Surroundings Report — allowlist assembly only.
// No Census geocoder, OpenAddresses, Geoclient, ArcGIS, OSM, or get-address-report.
(function (root) {
  'use strict';

  var MILES_PER_DEG_LAT = 69.0;
  var DATASETS = {
    addresspoint: {
      id: 'uf93-f8nk',
      name: 'AddressPoint',
      publisher: 'New York City Office of Technology and Innovation, on NYC Open Data'
    },
    issuance: {
      id: 'ipu4-2q9a',
      name: 'DOB Permit Issuance',
      publisher: 'New York City Department of Buildings, on NYC Open Data',
      registry_id: 'nyc-dob-permit-issuance'
    },
    dobnow: {
      id: 'rbx6-tga4',
      name: 'DOB NOW: Build – Approved Permits',
      publisher: 'New York City Department of Buildings, on NYC Open Data',
      registry_id: 'nyc-dobnow-approved-permits'
    },
    filings: {
      id: 'w9ak-ipjd',
      name: 'DOB NOW: Build – Job Application Filings',
      publisher: 'New York City Department of Buildings, on NYC Open Data',
      registry_id: 'nyc-dobnow-job-filings'
    }
  };

  var ISSUANCE_TYPES = { NB: 1, DM: 1, AL: 1, FO: 1 };
  var DOBNOW_TYPES = {
    'General Construction': 1,
    Structural: 1,
    Foundation: 1,
    'Earth Work': 1,
    'Full Demolition': 1
  };
  var FILING_TYPES = { 'New Building': 1, 'Full Demolition': 1 };
  // A filing the publisher marks withdrawn is not pending work. It is not listed as such.
  var FILING_DEAD_STATUS = { 'filing withdrawn': 1 };
  var NEARBY_CAP = 50;
  // The report only lists records dated inside this window. The SODA client must
  // request the same window: an unordered row window returns the publisher's oldest
  // rows, which this filter then drops, and the view goes silently empty.
  var RECENT_DAYS = 365;

  var SUFFIX = {
    STREET: 'ST', STREETS: 'ST', ST: 'ST',
    AVENUE: 'AVE', AVENUES: 'AVE', AVE: 'AVE', AV: 'AVE',
    BOULEVARD: 'BLVD', BLVD: 'BLVD',
    ROAD: 'RD', RD: 'RD',
    PLACE: 'PL', PL: 'PL',
    DRIVE: 'DR', DR: 'DR',
    LANE: 'LN', LN: 'LN',
    COURT: 'CT', CT: 'CT',
    TERRACE: 'TER', TER: 'TER',
    PARKWAY: 'PKWY', PKWY: 'PKWY',
    CIRCLE: 'CIR', CIR: 'CIR',
    SQUARE: 'SQ', SQ: 'SQ',
    HIGHWAY: 'HWY', HWY: 'HWY',
    PLAZA: 'PLZ', PLZ: 'PLZ'
  };

  var ORDINALS = {
    FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH',
    SIXTH: '6TH', SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH'
  };

  var BOROUGH = {
    MANHATTAN: '1', 'NEW YORK': '1', NYC: '1',
    BRONX: '2',
    BROOKLYN: '3', KINGS: '3',
    QUEENS: '4',
    'STATEN ISLAND': '5', RICHMOND: '5'
  };

  var FORBIDDEN_HOST_RE = /geocoding\.geo\.census\.gov|geoclient\.nyc\.gov|geosupport|openaddresses|arcgis\.com|openstreetmap\.org|tile\.openstreetmap|get-address-report/i;

  var EXCLUSIONS = [
    'Census geocoder output',
    'OpenAddresses national_address_points',
    'ZCTA / TIGER/Line membership as official ZIP or proximity',
    'NYC Geoclient or Geosupport API output',
    'the ArcGIS AddressPoint FeatureServer',
    'EPA FRS / ECHO, TCEQ, TDLR/TABS',
    'any other jurisdiction-registry entry',
    'Compute Atlas, OpenStreetMap, or Epoch placement',
    'Local News, meetings, government notices, email, or MAPS posts',
    'scores, outlooks, Quality of Life scoring, predictive sowhat prose, or Effect at this address',
    'get-address-report as a payload, cache, or embed'
  ];

  var INVESTIGATE = 'This report lists Department of Buildings records on file near the matching AddressPoint. Open each official record and investigate. It does not predict traffic, utilities, insurance, or property value.';

  function upper(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function normalizeHouse(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/^#/, '');
    if (/^0+$/.test(s)) return '0';
    return s.replace(/^0+(?=\d)/, '');
  }

  function normalizeStreet(raw) {
    var s = upper(raw).replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    var parts = s.split(' ').map(function (w) {
      return ORDINALS[w] || SUFFIX[w] || w;
    });
    return parts.join(' ');
  }

  function streetCore(normalized) {
    var parts = String(normalized || '').split(' ');
    if (parts.length > 1 && SUFFIX[parts[parts.length - 1]]) {
      return parts.slice(0, -1).join(' ');
    }
    return String(normalized || '');
  }

  function parseBuyerAddress(address, zip) {
    var raw = String(address || '').trim();
    var zip5 = String(zip || '').trim();
    var fromAddr = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (!/^\d{5}$/.test(zip5) && fromAddr) zip5 = fromAddr[1];
    if (!/^\d{5}$/.test(zip5)) zip5 = '';

    var borough = '';
    Object.keys(BOROUGH).forEach(function (name) {
      if (upper(raw).indexOf(name) !== -1) borough = BOROUGH[name];
    });

    var house = '';
    var rest = raw;
    var m = raw.match(/^\s*(\d+[A-Z]?(?:-\d+[A-Z]?)*)\s+(.+)$/i);
    if (m) {
      house = normalizeHouse(m[1]);
      rest = m[2];
    }
    rest = rest.replace(/,?\s*(New York|NY|USA)\b/ig, ' ');
    rest = rest.replace(/\b\d{5}(?:-\d{4})?\b/, ' ');
    Object.keys(BOROUGH).forEach(function (name) {
      rest = rest.replace(new RegExp('\\b' + name + '\\b', 'ig'), ' ');
    });
    var street = normalizeStreet(rest);
    return {
      typed: raw,
      house: house,
      street: street,
      street_core: streetCore(street),
      zip: zip5,
      borough: borough
    };
  }

  function streetMatches(point, parsed) {
    var full = normalizeStreet(point.full_street_name || '');
    var name = normalizeStreet(point.street_name || '');
    var want = parsed.street;
    var core = parsed.street_core;
    if (!want) return false;
    if (full && full === want) return true;
    if (name && name === want) return true;
    if (core && name && name === core) return true;
    if (core && full && streetCore(full) === core) return true;
    return false;
  }

  function matchAddressPoint(candidates, parsed) {
    var rows = (candidates || []).filter(function (p) {
      if (!p || !p.the_geom) return false;
      if (parsed.house && normalizeHouse(p.house_number) !== parsed.house) return false;
      if (parsed.zip && String(p.zipcode || '') !== parsed.zip) return false;
      if (parsed.borough && String(p.boroughcode || '') !== parsed.borough) return false;
      return streetMatches(p, parsed);
    });
    if (!rows.length) return { status: 'address_miss', point: null };
    if (rows.length > 1) return { status: 'address_ambiguous', point: null, count: rows.length };
    return { status: 'ok', point: rows[0] };
  }

  function pointCoords(point) {
    var g = point && point.the_geom;
    if (!g) return null;
    var c = g.coordinates;
    if (!c || c.length < 2) return null;
    var lng = Number(c[0]);
    var lat = Number(c[1]);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat: lat, lng: lng };
  }

  function toEN(homeLat, homeLng, lat, lng) {
    var n = (lat - homeLat) * MILES_PER_DEG_LAT;
    var e = (lng - homeLng) * MILES_PER_DEG_LAT * Math.cos((homeLat * Math.PI) / 180);
    return [Math.round(e * 1000) / 1000, Math.round(n * 1000) / 1000];
  }

  function milesBetween(lat1, lng1, lat2, lng2) {
    var en = toEN(lat1, lng1, lat2, lng2);
    return Math.round(Math.sqrt(en[0] * en[0] + en[1] * en[1]) * 1000) / 1000;
  }

  function bbox(lat, lng, radiusMi) {
    var dLat = radiusMi / MILES_PER_DEG_LAT;
    var dLng = radiusMi / (MILES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    return {
      minLat: lat - dLat,
      maxLat: lat + dLat,
      minLng: lng - dLng,
      maxLng: lng + dLng
    };
  }

  // One view stores dates as text MM/DD/YYYY, the others as ISO timestamps. The ISO
  // ones are Socrata floating timestamps and carry no zone, which Date.parse then
  // reads as local time: east of UTC that reports the permit a day early. They are
  // pinned to UTC so the date a buyer reads does not depend on where this code runs.
  function parseDateMs(raw) {
    var s = String(raw || '');
    if (!s) return NaN;
    var us = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (us) return Date.parse(us[3] + '-' + us[1] + '-' + us[2]);
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(s)) return Date.parse(s + 'Z');
    return Date.parse(s);
  }

  function isoDate(raw) {
    var t = parseDateMs(raw);
    if (!isFinite(t)) return '';
    return new Date(t).toISOString().slice(0, 10);
  }

  // The one definition of where the window starts. The SODA queries floor on a calendar
  // date, the page advertises a calendar date, and this filter keeps rows — all three
  // must be the same expression. They were not: the filter used a rolling millisecond
  // offset, so a permit dated on the very day the page named as the start was fetched
  // and then dropped for the rest of that day.
  function windowStartIso(days, now) {
    return new Date((now || Date.now()) - (days || RECENT_DAYS) * 86400000)
      .toISOString().slice(0, 10);
  }

  function withinDays(isoOrUs, days, now) {
    if (!isoOrUs) return false;
    var t = parseDateMs(isoOrUs);
    if (!isFinite(t)) return false;
    var d = isoDate(isoOrUs);
    if (!d) return false;
    return d >= windowStartIso(days, now) && t <= (now || Date.now()) + 86400000;
  }

  // What the report actually retrieved from a view, as opposed to what it asked for.
  // `capped` true means the publisher had more in the window than the request returned,
  // so `oldest` is how far back this view really reaches for this address.
  function coverageFor(rows, dateField, rowCap) {
    var list = rows || [];
    var dates = [];
    list.forEach(function (r) {
      var d = isoDate(r && r[dateField]);
      if (d) dates.push(d);
    });
    dates.sort();
    return {
      fetched: list.length,
      capped: !!rowCap && list.length >= rowCap,
      oldest: dates[0] || '',
      newest: dates[dates.length - 1] || ''
    };
  }

  function issuanceRow(r, home, radiusMi) {
    if (!r || !ISSUANCE_TYPES[r.permit_type]) return null;
    var lat = Number(r.gis_latitude);
    var lng = Number(r.gis_longitude);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var dist = milesBetween(home.lat, home.lng, lat, lng);
    if (dist > radiusMi) return null;
    if (!withinDays(r.issuance_date, RECENT_DAYS)) return null;
    var en = toEN(home.lat, home.lng, lat, lng);
    return {
      source: DATASETS.issuance.registry_id,
      dataset_id: DATASETS.issuance.id,
      case_number: r.job__ || '',
      type: r.permit_type,
      status: r.permit_status || '',
      stage: 'Permit issued',
      date: r.issuance_date || '',
      date_label: 'Issued',
      address: [r.house__, r.street_name].filter(Boolean).join(' '),
      zip: r.zip_code || '',
      lat: lat,
      lng: lng,
      distance_mi: dist,
      east_mi: en[0],
      north_mi: en[1],
      record_url: 'https://data.cityofnewyork.us/d/' + DATASETS.issuance.id
    };
  }

  function dobnowRow(r, home, radiusMi) {
    if (!r || !DOBNOW_TYPES[r.work_type]) return null;
    var lat = Number(r.latitude);
    var lng = Number(r.longitude);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var dist = milesBetween(home.lat, home.lng, lat, lng);
    if (dist > radiusMi) return null;
    if (!withinDays(r.issued_date, RECENT_DAYS)) return null;
    var en = toEN(home.lat, home.lng, lat, lng);
    return {
      source: DATASETS.dobnow.registry_id,
      dataset_id: DATASETS.dobnow.id,
      case_number: r.job_filing_number || r.work_permit || '',
      type: r.work_type,
      status: r.permit_status || '',
      stage: 'Permit approved',
      date: r.issued_date || '',
      date_label: 'Issued',
      address: [r.house_no, r.street_name].filter(Boolean).join(' '),
      zip: r.zip_code || '',
      lat: lat,
      lng: lng,
      distance_mi: dist,
      east_mi: en[0],
      north_mi: en[1],
      record_url: 'https://data.cityofnewyork.us/d/' + DATASETS.dobnow.id
    };
  }

  function filingRow(r, home, radiusMi) {
    if (!r || !FILING_TYPES[r.job_type]) return null;
    if (FILING_DEAD_STATUS[String(r.filing_status || '').toLowerCase()]) return null;
    var lat = Number(r.latitude);
    var lng = Number(r.longitude);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var dist = milesBetween(home.lat, home.lng, lat, lng);
    if (dist > radiusMi) return null;
    if (!withinDays(r.filing_date, RECENT_DAYS)) return null;
    var en = toEN(home.lat, home.lng, lat, lng);
    return {
      source: DATASETS.filings.registry_id,
      dataset_id: DATASETS.filings.id,
      case_number: r.job_filing_number || '',
      type: r.job_type,
      status: r.filing_status || '',
      stage: 'Filed',
      date: r.filing_date || '',
      date_label: 'Filed',
      // postcode is the job-site ZIP. `zip` on this view is the applicant's ZIP.
      address: [r.house_no, r.street_name].filter(Boolean).join(' '),
      zip: r.postcode || '',
      lat: lat,
      lng: lng,
      distance_mi: dist,
      east_mi: en[0],
      north_mi: en[1],
      record_url: 'https://data.cityofnewyork.us/d/' + DATASETS.filings.id
    };
  }

  function nearbyFromPublisherRows(issuance, dobnow, home, radiusMi, filings) {
    var out = [];
    (issuance || []).forEach(function (r) {
      var row = issuanceRow(r, home, radiusMi);
      if (row) out.push(row);
    });
    (dobnow || []).forEach(function (r) {
      var row = dobnowRow(r, home, radiusMi);
      if (row) out.push(row);
    });
    (filings || []).forEach(function (r) {
      var row = filingRow(r, home, radiusMi);
      if (row) out.push(row);
    });
    out.sort(function (a, b) { return a.distance_mi - b.distance_mi; });
    return out;
  }

  function attributionFor(views) {
    var lines = [];
    (views || []).forEach(function (v) {
      var meta = DATASETS[v.key];
      if (!meta) return;
      lines.push({
        source: meta.publisher,
        dataset: meta.id,
        name: meta.name,
        version: v.version || 'version retrieved ' + (v.retrieved_at || ''),
        modifications: v.modifications
      });
    });
    return lines;
  }

  function forbiddenUrl(url) {
    return FORBIDDEN_HOST_RE.test(String(url || ''));
  }

  function canonicalize(draft) {
    var copy = JSON.parse(JSON.stringify(draft));
    delete copy.report_id;
    delete copy.generated_at;
    return JSON.stringify(copy);
  }

  function sha256Hex(text) {
    if (typeof require === 'function') {
      try {
        return Promise.resolve(require('crypto').createHash('sha256').update(text).digest('hex'));
      } catch (_e) { /* browser bundle */ }
    }
    if (root.crypto && root.crypto.subtle) {
      var enc = new TextEncoder().encode(text);
      return root.crypto.subtle.digest('SHA-256', enc).then(function (buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
      });
    }
    return Promise.resolve('unsigned');
  }

  function assembleReport(input) {
    var parsed = input.parsed || parseBuyerAddress(input.address, input.zip);
    var radiusMi = Number(input.radius_mi);
    if (!isFinite(radiusMi) || radiusMi <= 0) radiusMi = 0.5;
    if (radiusMi > 1) radiusMi = 1;
    var match = matchAddressPoint(input.address_points || [], parsed);
    var home = match.point ? pointCoords(match.point) : null;
    var matched = (match.status === 'ok' && home)
      ? nearbyFromPublisherRows(input.issuance, input.dobnow, home, radiusMi, input.filings)
      : [];
    var nearby = matched.slice(0, NEARBY_CAP);

    var views = [
      {
        key: 'addresspoint',
        version: input.versions && input.versions.addresspoint,
        retrieved_at: input.retrieved_at,
        modifications: 'Selected the_geom, addresspointid, house_number, street_name, full_street_name, zipcode, boroughcode. Matched the buyer-supplied address string to those fields.'
      },
      {
        key: 'issuance',
        version: input.versions && input.versions.issuance,
        retrieved_at: input.retrieved_at,
        modifications: 'Selected permit_type, permit_status, issuance_date, house__, street_name, gis_latitude, gis_longitude, job__, zip_code. Kept NB/DM/AL/FO with publisher coordinates inside the stated radius, issued in the last ' + RECENT_DAYS + ' days. Ordered newest first on issuance_date read as a timestamp, because the publisher stores that column as text.'
      },
      {
        key: 'dobnow',
        version: input.versions && input.versions.dobnow,
        retrieved_at: input.retrieved_at,
        modifications: 'Selected work_type, permit_status, issued_date, house_no, street_name, latitude, longitude, job_filing_number, zip_code. Kept General Construction, Structural, Foundation, Earth Work, Full Demolition with publisher coordinates inside the stated radius, issued in the last ' + RECENT_DAYS + ' days.'
      },
      {
        key: 'filings',
        version: input.versions && input.versions.filings,
        retrieved_at: input.retrieved_at,
        modifications: 'Selected job_type, filing_status, filing_date, house_no, street_name, latitude, longitude, job_filing_number, postcode. Kept New Building and Full Demolition with publisher coordinates inside the stated radius, filed in the last ' + RECENT_DAYS + ' days, and dropped filings the publisher marks Filing Withdrawn.'
      }
    ];

    // A miss is only honest if every candidate was looked at. If the AddressPoint read
    // hit its cap, the right point may simply not be among the rows, and "no match" is
    // then a guess rather than a finding.
    var candidates = (input.address_points || []).length;
    var candidatesCapped = !!input.row_cap_per_dataset
      && candidates >= input.row_cap_per_dataset;

    var rowCap = input.row_cap_per_dataset || 0;
    var coverage = {};
    coverage[DATASETS.issuance.id] = coverageFor(input.issuance, 'issuance_date', rowCap);
    coverage[DATASETS.dobnow.id] = coverageFor(input.dobnow, 'issued_date', rowCap);
    coverage[DATASETS.filings.id] = coverageFor(input.filings, 'filing_date', rowCap);

    var coverageComplete = true;
    Object.keys(coverage).forEach(function (id) {
      if (coverage[id].capped) coverageComplete = false;
    });

    // A record view that is on the allowlist, credited in the attribution, and returned
    // nothing at all is the defect this field exists to surface. Not being among the
    // closest rows listed is normal and is not silence. Only meaningful on a match: a
    // miss deliberately queries nothing.
    var silent = (match.status === 'ok' && home)
      ? Object.keys(coverage).filter(function (id) { return coverage[id].fetched === 0; })
      : [];

    var property = null;
    if (match.point && home) {
      property = {
        addresspointid: String(match.point.addresspointid || ''),
        house_number: match.point.house_number || '',
        street_name: match.point.street_name || '',
        full_street_name: match.point.full_street_name || '',
        zipcode: match.point.zipcode || '',
        boroughcode: match.point.boroughcode || '',
        lat: home.lat,
        lng: home.lng
      };
    }

    var draft = {
      product: 'HomeSignal Future Surroundings Report',
      version: 'nyc-v1',
      buyer: { address: parsed.typed, zip: parsed.zip },
      status: match.status,
      radius_mi: radiusMi,
      property: property,
      nearby: nearby,
      nearby_matched: matched.length,
      nearby_truncated: matched.length > nearby.length,
      attribution: attributionFor(views),
      exclusions: EXCLUSIONS.slice(),
      investigate: INVESTIGATE,
      data_state: {
        host: 'data.cityofnewyork.us',
        datasets: [DATASETS.addresspoint.id, DATASETS.issuance.id, DATASETS.dobnow.id, DATASETS.filings.id],
        window_days: RECENT_DAYS,
        window_start: windowStartIso(RECENT_DAYS),
        row_cap_per_dataset: input.row_cap_per_dataset || null,
        address_point_candidates: candidates,
        address_points_capped: candidatesCapped,
        coverage: coverage,
        coverage_complete: coverageComplete,
        silent_datasets: silent,
        versions: (input.versions || {})
      }
    };

    return sha256Hex(canonicalize(draft)).then(function (id) {
      draft.report_id = id;
      draft.generated_at = input.generated_at || new Date().toISOString();
      return draft;
    });
  }

  var api = {
    DATASETS: DATASETS,
    EXCLUSIONS: EXCLUSIONS,
    INVESTIGATE: INVESTIGATE,
    RECENT_DAYS: RECENT_DAYS,
    NEARBY_CAP: NEARBY_CAP,
    isoDate: isoDate,
    windowStartIso: windowStartIso,
    coverageFor: coverageFor,
    parseBuyerAddress: parseBuyerAddress,
    normalizeHouse: normalizeHouse,
    normalizeStreet: normalizeStreet,
    matchAddressPoint: matchAddressPoint,
    pointCoords: pointCoords,
    toEN: toEN,
    milesBetween: milesBetween,
    bbox: bbox,
    nearbyFromPublisherRows: nearbyFromPublisherRows,
    forbiddenUrl: forbiddenUrl,
    canonicalize: canonicalize,
    assembleReport: assembleReport
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HSNycV1 = api;
})(typeof window !== 'undefined' ? window : globalThis);
