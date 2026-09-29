// GENERATED FILE. Do not edit it.
// It is lib/nyc-v1-soda.js copied byte for byte under this header, so the edge function and
// the page run one report engine. Change lib/nyc-v1-soda.js, then run
//   node scripts/sync-fsr-engine.mjs
// test/fsr-engine-one-source.test.mjs fails if this copy is stale.
// NYC V1 SODA client. The only allowed host is data.cityofnewyork.us.
// The only allowed views are uf93-f8nk, ipu4-2q9a, rbx6-tga4, w9ak-ipjd.
(function (root) {
  'use strict';

  var HOST = 'https://data.cityofnewyork.us';
  var ALLOWED = { 'uf93-f8nk': 1, 'ipu4-2q9a': 1, 'rbx6-tga4': 1, 'w9ak-ipjd': 1 };
  // Sized so a single request exhausts the window even at 1 mi in the densest part of
  // the city (measured: 3,390 rows, ~0.7 s). If it ever binds, data_state.coverage
  // records it rather than the report implying coverage it does not have.
  var ROW_CAP = 5000;

  // Every record query is floored and ordered to the report's own window. Without
  // that, a dense ZIP group returns the publisher's oldest rows and the report's
  // recency filter drops all of them, so the dataset contributes nothing.
  // Deliberately not a second copy of the arithmetic. The floor the query asks for, the
  // floor the row filter keeps, and the date the page advertises are the same value, so
  // there is one function and the other two callers read it from here.
  function windowFloor() {
    var V1 = root.HSNycV1;
    return V1.windowStartIso(V1.RECENT_DAYS);
  }

  function sodaUrl(kind, id, params) {
    if (!ALLOWED[id]) throw new Error('dataset not on the NYC V1 allowlist');
    var path = kind === 'view' ? '/api/views/' + id + '.json' : '/resource/' + id + '.json';
    var u = new URL(HOST + path);
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] != null && params[k] !== '') u.searchParams.set(k, params[k]);
    });
    return u.toString();
  }

  function getJson(url) {
    if (root.HSNycV1 && root.HSNycV1.forbiddenUrl(url)) {
      return Promise.reject(new Error('forbidden host'));
    }
    if (url.indexOf(HOST + '/') !== 0) return Promise.reject(new Error('host not allowed'));
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (body) {
          throw new Error('SODA HTTP ' + r.status + ' ' + String(body || '').slice(0, 160));
        });
      }
      return r.json();
    });
  }

  function viewVersion(meta) {
    if (!meta) return '';
    var parts = [];
    if (meta.id) parts.push(meta.id);
    if (meta.viewLastModified != null) parts.push('viewLastModified=' + meta.viewLastModified);
    if (meta.rowsUpdatedAt != null) parts.push('rowsUpdatedAt=' + meta.rowsUpdatedAt);
    return parts.join(' ');
  }

  function fetchView(id) {
    return getJson(sodaUrl('view', id, {})).then(function (meta) {
      return { id: id, version: viewVersion(meta), name: meta.name, attribution: meta.attribution };
    });
  }

  function quote(s) {
    return "'" + String(s).replace(/'/g, "''") + "'";
  }

  // Street matching happens on the rows this returns, so the rows have to be all of
  // them. Reading 50 was the same defect as the BIS window: without a ZIP, house_number
  // '1' has 1,328 points citywide and the arbitrary 50 did not include Centre Street —
  // a real address reported as "no match". The most-shared house number in the city is
  // 15 with 2,235 points, so the cap is set where a single read exhausts the set.
  //
  // Deliberately not narrowed with a server-side `like` on the street: the publisher
  // stores the raw string, and the matcher compares normalised ones. "First Avenue"
  // normalises to "1ST AVE", which does not appear in the publisher's "FIRST AVE", so
  // the filter would drop matches the report should make.
  function fetchAddressPoints(parsed) {
    if (!parsed.house) return Promise.resolve([]);
    var where = 'house_number=' + quote(parsed.house);
    if (parsed.zip) where += ' AND zipcode=' + quote(parsed.zip);
    return getJson(sodaUrl('resource', 'uf93-f8nk', {
      $select: 'the_geom,addresspointid,house_number,street_name,full_street_name,zipcode,boroughcode',
      $where: where,
      $limit: String(ROW_CAP)
    }));
  }

  // Scoped on the publisher's own coordinates, which is what the report claims to use.
  // Scoping by zip_code instead trusted a text field the publisher does not always get
  // right: measured at 1 Centre Street, the ZIP route missed 2 records that sit inside
  // the radius but carry ZIP 10006.
  function fetchIssuance(box) {
    if (!box) return Promise.resolve([]);
    // issuance_date and the coordinates are text columns on this view, so each is read
    // as a number or a timestamp. A plain lexical sort mixes MM/DD/YYYY and ISO values.
    var where = [
      "permit_type in('NB','DM','AL','FO')",
      'gis_latitude is not null',
      'gis_longitude is not null',
      'gis_latitude::number between ' + box.minLat + ' and ' + box.maxLat,
      'gis_longitude::number between ' + box.minLng + ' and ' + box.maxLng,
      'issuance_date is not null',
      "issuance_date::floating_timestamp >= '" + windowFloor() + "'"
    ].join(' AND ');
    return getJson(sodaUrl('resource', 'ipu4-2q9a', {
      $select: 'permit_type,permit_status,issuance_date,house__,street_name,gis_latitude,gis_longitude,job__,zip_code',
      $where: where,
      $order: 'issuance_date::floating_timestamp DESC',
      $limit: String(ROW_CAP)
    }));
  }

  // Scoped on the publisher's coordinates, which are text on this view and so are cast.
  // `postcode` is still selected because it is the job-site ZIP and `zip` is the
  // applicant's, but it is no longer what decides whether a record is nearby.
  function fetchFilings(box) {
    if (!box) return Promise.resolve([]);
    var where = [
      "job_type in('New Building','Full Demolition')",
      'latitude is not null',
      'longitude is not null',
      'latitude::number between ' + box.minLat + ' and ' + box.maxLat,
      'longitude::number between ' + box.minLng + ' and ' + box.maxLng,
      "filing_date >= '" + windowFloor() + "'"
    ].join(' AND ');
    return getJson(sodaUrl('resource', 'w9ak-ipjd', {
      $select: 'job_type,filing_status,filing_date,house_no,street_name,latitude,longitude,job_filing_number,postcode',
      $where: where,
      $limit: String(ROW_CAP),
      $order: 'filing_date DESC'
    }));
  }

  function fetchDobNow(box) {
    var where = [
      "work_type in('General Construction','Structural','Foundation','Earth Work','Full Demolition')",
      'latitude is not null',
      'longitude is not null',
      'latitude between ' + box.minLat + ' and ' + box.maxLat,
      'longitude between ' + box.minLng + ' and ' + box.maxLng,
      "issued_date >= '" + windowFloor() + "'"
    ].join(' AND ');
    return getJson(sodaUrl('resource', 'rbx6-tga4', {
      $select: 'work_type,permit_status,issued_date,house_no,street_name,latitude,longitude,job_filing_number,zip_code,work_permit',
      $where: where,
      $limit: String(ROW_CAP),
      $order: 'issued_date DESC'
    }));
  }

  function loadReport(address, zip, radiusMi) {
    var V1 = root.HSNycV1;
    var parsed = V1.parseBuyerAddress(address, zip);
    var retrievedAt = new Date().toISOString();
    return Promise.all([
      fetchView('uf93-f8nk'),
      fetchView('ipu4-2q9a'),
      fetchView('rbx6-tga4'),
      fetchAddressPoints(parsed),
      fetchView('w9ak-ipjd')
    ]).then(function (parts) {
      var versions = {
        addresspoint: parts[0].version,
        issuance: parts[1].version,
        dobnow: parts[2].version,
        filings: parts[4].version
      };
      var match = V1.matchAddressPoint(parts[3], parsed);
      if (match.status !== 'ok') {
        return V1.assembleReport({
          parsed: parsed,
          address: parsed.typed,
          zip: parsed.zip,
          radius_mi: radiusMi,
          address_points: parts[3],
          issuance: [],
          dobnow: [],
          filings: [],
          versions: versions,
          row_cap_per_dataset: ROW_CAP,
          retrieved_at: retrievedAt
        });
      }
      var home = V1.pointCoords(match.point);
      // An address can match a point whose geometry is unusable. There is then nowhere to
      // measure from, and a report of "no records nearby" would be a finding the data does
      // not support. Refusing is the honest outcome, so both surfaces get the same clear
      // error instead of the page failing on a null read and the API returning an empty
      // "ok" report (it did the latter before the two shared one engine).
      if (!home) return Promise.reject(new Error('the matching AddressPoint has no usable coordinates'));
      var radius = radiusMi || 0.5;
      var box = V1.bbox(home.lat, home.lng, radius);
      return Promise.all([fetchIssuance(box), fetchDobNow(box), fetchFilings(box)]).then(function (rows) {
        return V1.assembleReport({
          parsed: parsed,
          address: parsed.typed,
          zip: parsed.zip,
          radius_mi: radius,
          address_points: parts[3],
          issuance: rows[0],
          dobnow: rows[1],
          filings: rows[2],
          versions: versions,
          row_cap_per_dataset: ROW_CAP,
          retrieved_at: retrievedAt
        });
      });
    });
  }

  var api = {
    HOST: HOST,
    ROW_CAP: ROW_CAP,
    windowFloor: windowFloor,
    sodaUrl: sodaUrl,
    viewVersion: viewVersion,
    fetchView: fetchView,
    fetchAddressPoints: fetchAddressPoints,
    fetchIssuance: fetchIssuance,
    fetchFilings: fetchFilings,
    loadReport: loadReport
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HSNycV1Soda = api;
})(typeof window !== 'undefined' ? window : globalThis);
