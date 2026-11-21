// lib/air-permits-map.js — AIR PERMITS & FILINGS on Map 1 (founder requirement 2026-11-21)
//
// The map half of the ZIP page's "Air permits & filings" section (lib/air-permits.js, docs/air-permits.sql). A state air
// authorization is filed with an AUTHORITY (TCEQ first), so it is its own Map 1 layer with its own switch, "Air permits &
// filings", under Regulatory records, by the same rules as State cleanup sites and Water rights filings:
//   * NOT a project Type, NOT an EPA facility: drawn whatever the Status and Type chips say, never in the EPA facility
//     count, the development counts or any list of projects. A record linked to a development project (project_link_ref)
//     is still not counted as one: the link is context, never a second project.
//   * ONE PREDICATE, ONE MAPPING. Every Map 1 surface asks HS.isAirPermit(site) and draws HS.airPermitMarker.
//   * Rows come only from the readers in docs/air-permits.sql: ZIP mode public.air_permits_for_zip (every point carries the
//     polygon verdict; HS.zipModeSites admits only 'member'); address mode public.map1_air_permits_near.
// HONESTY. The status is the agency's own word; a renewal/modification is never worded as new construction; no emission
// amount is shown; "approved" is never said. Lists and counts are RECORDS.
(function () {
  var HS = window.HS = window.HS || {};
  HS.AIR_PERMITS_RELEVANCE = 'air_permits';
  HS.AIR_PERMITS_LEGEND = { key: 'air_permits', chipLabel: 'Air permits & filings', symbol: 'circle', color: '#5b6b7a', letter: 'A' };

  function str(v) { return v == null ? '' : String(v).trim(); }
  function httpsUrl(u) { return /^https:\/\/[^\s"'<>]+$/.test(str(u)) ? str(u) : ''; }
  function AP() { return HS.airPermits || {}; }

  HS.isAirPermit = function (s) { return !!s && s.relevance === HS.AIR_PERMITS_RELEVANCE; };

  function sitesOfRecord(r, ctx) {
    if (!r || typeof r !== 'object') return [];
    var url = httpsUrl(r.record_url);
    if (!url || !Array.isArray(r.points)) return [];
    var rec = {
      record_id: str(r.record_id), source: str(r.source || ctx.source), state: str(r.state || ctx.state),
      agency: str(ctx.agency), checked_at: str(ctx.checked_at), load_status: str(ctx.status),
      permit_no: str(r.permit_no), project_no: str(r.project_no), facility_ref: str(r.facility_ref), facility_name: str(r.facility_name),
      applicant: str(r.applicant), permit_type: str(r.permit_type), action_kind: str(r.action_kind), status: str(r.status),
      received_on: str(r.received_on), action_on: str(r.action_on), effective_on: str(r.effective_on), expires_on: str(r.expires_on),
      comment_until: str(r.comment_until), location_basis: str(r.location_basis), record_url: url,
      project_link_ref: str(r.project_link_ref)
    };
    var out = [];
    r.points.forEach(function (p) {
      var lat = p && typeof p.lat === 'number' ? p.lat : NaN, lng = p && typeof p.lng === 'number' ? p.lng : NaN;
      if (!isFinite(lat) || !isFinite(lng)) return;
      var site = {
        scope: 'point', relevance: HS.AIR_PERMITS_RELEVANCE, label: HS.airPermitTitleOf(rec),
        lat: lat, lng: lng, record_url: url, src: (rec.agency || 'State') + ' air permits',
        air: { record: rec, key: rec.record_id || (rec.source + ':' + (rec.permit_no || rec.project_no)) },
        geo_precision: 'point'
      };
      if (p.zip_membership != null) site.zip_membership = p.zip_membership;
      out.push(site);
    });
    return out;
  }
  HS.airPermitTitleOf = function (r) {
    var A = AP();
    return (A.title ? A.title(r) : (r.action_kind || 'Air permit action') + ' ' + (r.permit_no || r.project_no || ''))
      + (r.facility_name ? ' — ' + r.facility_name : '');
  };

  HS.airPermitsOutcome = function (body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.records)) return 'unavailable';
    if (body.status === 'complete') return 'complete';
    if (body.status === 'unavailable') return 'stale';
    if (body.status === 'not_covered' || body.status === 'not_measured' || body.status === 'blocked') return body.status;
    return 'unavailable';
  };
  // A reader body -> sites. A stale/blocked/unknown body yields [] here; the outcome says why (never "none").
  HS.airPermitsSitesFrom = function (body) {
    var o = HS.airPermitsOutcome(body);
    if (o !== 'complete' && o !== 'stale') return [];
    var bySource = {};
    (Array.isArray(body.sources) ? body.sources : []).forEach(function (s) { if (s && s.source) bySource[s.source] = s; });
    var top = { agency: body.agency, checked_at: body.checked_at, status: body.status, state: body.state };
    var sites = [];
    body.records.forEach(function (r) {
      var src = (r && bySource[r.source]) || top;
      if (src.status === 'blocked') return;
      sites = sites.concat(sitesOfRecord(r, { source: r && r.source, state: (r && r.state) || src.state,
        agency: src.agency || top.agency, checked_at: src.checked_at || top.checked_at, status: src.status || top.status }));
    });
    return HS.groupAirPermitSites(sites);
  };

  // Records sharing a point become one pin; the pin lists them, and every count stays a RECORD.
  HS.groupAirPermitSites = function (sites) {
    var order = [], by = {};
    (sites || []).forEach(function (s) {
      var k = s.lat + ',' + s.lng;
      if (!by[k]) { by[k] = []; order.push(k); }
      if (!by[k].some(function (x) { return x.air.key === s.air.key; })) by[k].push(s);
    });
    return order.map(function (k) {
      var m = by[k];
      if (m.length === 1) return m[0];
      var g = {};
      for (var f in m[0]) g[f] = m[0][f];
      g.label = m.length + ' air permit records at this location';
      g.air = { record: m[0].air.record, key: 'group:' + m.map(function (x) { return x.air.key; }).join('+'), group: m };
      return g;
    });
  };
  HS.airPermitGroupOf = function (s) { return s && s.air && Array.isArray(s.air.group) ? s.air.group : null; };
  HS.airPermitRecords = function (items) {
    var seen = {}, out = [];
    (items || []).forEach(function (s) {
      if (!HS.isAirPermit(s)) return;
      (HS.airPermitGroupOf(s) || [s]).forEach(function (m) {
        if (seen[m.air.key]) return;
        seen[m.air.key] = 1; out.push(m);
      });
    });
    return out;
  };

  // "Registration · Agency status: PENDING · Received Sep 8, 2026"
  HS.airPermitTypeLine = function (s, now) {
    var g = HS.airPermitGroupOf(s);
    if (g) return g.length + ' air permit records at this location';
    var r = (s && s.air && s.air.record) || {}, A = AP();
    var parts = [A.kindLabel ? A.kindLabel(r.action_kind) : r.action_kind];
    if (r.status) parts.push('Agency status: ' + r.status);
    var m = A.meaning ? A.meaning(r) : ''; if (m) parts.push(m);
    var c = A.commentLine ? A.commentLine(r, now) : ''; if (c) parts.push(c);
    if (r.received_on && A.day && A.day(r.received_on)) parts.push('Received ' + A.day(r.received_on));
    return parts.join(' · ');
  };
  HS.airPermitFactsLine = function (s) {
    var r = (s && s.air && s.air.record) || {}, A = AP();
    var f = [A.facilityLine ? A.facilityLine(r) : '', r.applicant ? 'Applicant: ' + r.applicant : '', r.permit_type].filter(Boolean);
    return f.join(' · ');
  };
  HS.airPermitCheckedLine = function (s) {
    var r = (s && s.air && s.air.record) || {}, A = AP();
    var d = A.day ? A.day(r.checked_at) : '';
    if (!d) return '';
    return 'From ' + (r.agency || 'the state agency') + '’s list, ' + (r.load_status === 'unavailable' ? 'last confirmed ' : 'checked ') + d;
  };

  HS.airPermitMarker = function () {
    var L = HS.AIR_PERMITS_LEGEND;
    return { shape: L.symbol, color: L.color, label: L.letter, signal: null, categories: [L.key], typeKey: null, filterKey: L.key,
             legendLabel: 'Air permit record', typeLabel: 'Air permit record', popupLabel: 'Air permit record',
             isFacility: false, isAirPermit: true, lifecycle: 'unknown', lifecycleBucket: 'unknown' };
  };
  // The shared marker resolver (lib/map.js) does not know this layer. This module, loaded after map.js, puts the layer
  // first in the resolver so no Type or facility rule can classify an air-permit record; every other record is unchanged.
  if (typeof HS.resolveTrackerMarker === 'function' && !HS.resolveTrackerMarker.__airPermits) {
    var resolveBefore = HS.resolveTrackerMarker;
    HS.resolveTrackerMarker = function (s, frsRidFn) {
      return HS.isAirPermit(s) ? HS.airPermitMarker(s) : resolveBefore.call(HS, s, frsRidFn);
    };
    HS.resolveTrackerMarker.__airPermits = true;
  }
  HS.airPermitTitle = function (s) {
    var g = HS.airPermitGroupOf(s);
    return g ? 'Air permits: ' + g.length + ' records at this location' : 'Air permit record · ' + ((s && s.label) || '');
  };

  var visible = true;
  HS.airPermitsVisible = function () { return visible; };
  HS.setAirPermitsVisible = function (on) { visible = !!on; };
  HS.airPermitsFromUrl = function (href) {
    try { var v = new URL(href).searchParams.get('air'); return v === '0' ? false : v === '1' ? true : null; } catch (e) { return null; }
  };

  var GROUP_POPUP_CAP = 8;
  function linkHTML(s, esc) {
    var r = s.air.record;
    return "<a href='" + esc(r.record_url) + "' target='_blank' rel='noopener' style='color:inherit'>" + esc((r.agency || 'Agency') + ' record') + ' ▸</a>';
  }
  function oneHTML(s, esc, muted) {
    var facts = HS.airPermitFactsLine(s);
    return "<div style='margin-top:4px'>" + esc(HS.airPermitTypeLine(s)) + '</div>'
      + (facts ? "<div style='color:" + muted + "'>" + esc(facts) + '</div>' : '')
      + "<div style='margin-top:3px'>" + linkHTML(s, esc) + '</div>';
  }
  function membersHTML(g, esc, muted) {
    var shown = g.slice(0, GROUP_POPUP_CAP).map(function (m) {
      return "<div style='margin-top:5px'><div style='font-weight:600'>" + esc(m.label || '') + '</div>' + oneHTML(m, esc, muted) + '</div>';
    }).join('');
    var rest = g.length - GROUP_POPUP_CAP;
    return shown + (rest > 0 ? "<div style='margin-top:5px;color:" + muted + "'>The other " + rest + (rest === 1 ? ' is' : ' are') + ' in the Air permits & filings list.</div>' : '');
  }
  function footHTML(s, esc, muted) {
    var checked = HS.airPermitCheckedLine(s), note = AP().NOTE || '';
    return (checked ? "<div style='margin-top:3px;font-size:11px;color:" + muted + "'>" + esc(checked) + '</div>' : '')
      + "<div style='margin-top:3px;font-size:11px;color:" + muted + "'>" + esc(note) + '</div>';
  }
  HS.airPermitPopupHTML = function (s, esc, dark) {
    var muted = dark ? '#9fb0ad' : '#5d6f72', g = HS.airPermitGroupOf(s), r = s.air.record;
    return "<div class='pt'>" + esc(s.label || '') + '</div>'
      + "<div class='pk'>Air permit record" + (g ? 's' : '') + ' · ' + esc(r.agency || 'State') + '</div>'
      + (g ? membersHTML(g, esc, muted) : oneHTML(s, esc, muted)) + footHTML(s, esc, muted);
  };
  HS.airPermitCardHTML = function (s, esc) {
    var muted = '#9fb0ad', g = HS.airPermitGroupOf(s), r = s.air.record;
    return "<div class='ci-n'>" + esc(s.label || '') + '</div>'
      + "<div class='ci-t'>" + esc((g ? 'Air permit records · ' : 'Air permit record · ') + (r.agency || 'State')) + '</div>'
      + "<div class='ci-v' style='font-weight:400'>" + (g ? membersHTML(g, esc, muted) : oneHTML(s, esc, muted)) + '</div>'
      + "<div class='ci-v' style='font-weight:400'>" + footHTML(s, esc, muted) + '</div>';
  };
  HS.airPermitsListHTML = function (items, esc, cap) {
    var rows = HS.airPermitRecords(items), n = cap || 12;
    var out = rows.slice(0, n).map(function (s) {
      var r = s.air.record, facts = HS.airPermitFactsLine(s);
      return "<div class='rec' data-ref='" + esc(s.air.key) + "'>"
        + "<span class='dot' style='background:" + HS.AIR_PERMITS_LEGEND.color + "'></span>"
        + "<div style='flex:1'><div class='t'>" + esc(s.label || '') + '</div>'
        + "<div class='s'>" + esc(HS.airPermitTypeLine(s)) + (facts ? ' · ' + esc(facts) : '')
        + " · <a href='" + esc(r.record_url) + "' target='_blank' rel='noopener'>" + esc((r.agency || 'Agency') + ' record') + ' ▸</a></div></div></div>';
    }).join('');
    if (rows.length > n) {
      var rest = rows.length - n;
      out += "<div class='listmore'>Showing " + n + ' of ' + rows.length + '. The other ' + rest + (rest === 1 ? ' is' : ' are') + ' on the map.</div>';
    }
    return out;
  };
})();
