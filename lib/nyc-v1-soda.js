// NYC V1 SODA client. The only allowed host is data.cityofnewyork.us.
// The only allowed views are uf93-f8nk, ipu4-2q9a, rbx6-tga4.
(function (root) {
  'use strict';

  var HOST = 'https://data.cityofnewyork.us';
  var ALLOWED = { 'uf93-f8nk': 1, 'ipu4-2q9a': 1, 'rbx6-tga4': 1 };

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

  function fetchAddressPoints(parsed) {
    if (!parsed.house) return Promise.resolve([]);
    var where = 'house_number=' + quote(parsed.house);
    if (parsed.zip) where += ' AND zipcode=' + quote(parsed.zip);
    return getJson(sodaUrl('resource', 'uf93-f8nk', {
      $select: 'the_geom,addresspointid,house_number,street_name,full_street_name,zipcode,boroughcode',
      $where: where,
      $limit: '50'
    }));
  }

  function fetchNearbyZips(lat, lng, radiusMi) {
    var meters = Math.round((radiusMi || 0.5) * 1609.344);
    return getJson(sodaUrl('resource', 'uf93-f8nk', {
      $select: 'zipcode',
      $where: 'within_circle(the_geom,' + lat + ',' + lng + ',' + meters + ')',
      $group: 'zipcode',
      $limit: '50'
    })).then(function (rows) {
      return (rows || []).map(function (r) { return String(r.zipcode || ''); }).filter(function (z) {
        return /^\d{5}$/.test(z);
      });
    });
  }

  function fetchIssuance(zips) {
    var list = (zips || []).filter(function (z) { return /^\d{5}$/.test(z); }).slice(0, 20);
    if (!list.length) return Promise.resolve([]);
    var inList = list.map(quote).join(',');
    var where = [
      "permit_type in('NB','DM','AL','FO')",
      'gis_latitude is not null',
      'gis_longitude is not null',
      'zip_code in(' + inList + ')'
    ].join(' AND ');
    return getJson(sodaUrl('resource', 'ipu4-2q9a', {
      $select: 'permit_type,permit_status,issuance_date,house__,street_name,gis_latitude,gis_longitude,job__,zip_code',
      $where: where,
      $limit: '200'
    }));
  }

  function fetchDobNow(box) {
    var where = [
      "work_type in('General Construction','Structural','Foundation','Earth Work','Full Demolition')",
      'latitude is not null',
      'longitude is not null',
      'latitude between ' + box.minLat + ' and ' + box.maxLat,
      'longitude between ' + box.minLng + ' and ' + box.maxLng
    ].join(' AND ');
    return getJson(sodaUrl('resource', 'rbx6-tga4', {
      $select: 'work_type,permit_status,issued_date,house_no,street_name,latitude,longitude,job_filing_number,zip_code,work_permit',
      $where: where,
      $limit: '200',
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
      fetchAddressPoints(parsed)
    ]).then(function (parts) {
      var versions = {
        addresspoint: parts[0].version,
        issuance: parts[1].version,
        dobnow: parts[2].version
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
          versions: versions,
          retrieved_at: retrievedAt
        });
      }
      var home = V1.pointCoords(match.point);
      var radius = radiusMi || 0.5;
      var box = V1.bbox(home.lat, home.lng, radius);
      return fetchNearbyZips(home.lat, home.lng, radius).then(function (zips) {
        if (match.point.zipcode && zips.indexOf(match.point.zipcode) === -1) zips.push(match.point.zipcode);
        return Promise.all([fetchIssuance(zips), fetchDobNow(box)]).then(function (rows) {
          return V1.assembleReport({
            parsed: parsed,
            address: parsed.typed,
            zip: parsed.zip,
            radius_mi: radius,
            address_points: parts[3],
            issuance: rows[0],
            dobnow: rows[1],
            versions: versions,
            retrieved_at: retrievedAt
          });
        });
      });
    });
  }

  var api = {
    HOST: HOST,
    sodaUrl: sodaUrl,
    viewVersion: viewVersion,
    fetchView: fetchView,
    fetchAddressPoints: fetchAddressPoints,
    loadReport: loadReport
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HSNycV1Soda = api;
})(typeof window !== 'undefined' ? window : globalThis);
