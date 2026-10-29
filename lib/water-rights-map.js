// lib/water-rights-map.js — STATE WATER-RIGHTS FILINGS on Map 1 (2026-10-29)
//
// The map half of the ZIP page's "Water rights filings" section (lib/water-rights.js,
// docs/state-water-rights.sql). A pending water-rights application is filed with a STATE agency
// (Utah Division of Water Rights, Idaho Department of Water Resources), so it is its own Map 1
// layer with its own switch, "Water rights filings", under Regulatory records — the same rules as
// the State cleanup sites layer (lib/state-cleanup.js):
//   * NOT a project Type and NOT an EPA facility: drawn whatever the Status and Type chips say,
//     never in the EPA facility count, the development counts or any list of projects.
//   * ONE PREDICATE, ONE MAPPING. Every Map 1 surface asks HS.isWaterRight(site) and draws the
//     marker HS.waterRightMarker returns; the page decides nothing about these records itself.
//   * The rows come only from the database readers in docs/state-water-rights.sql:
//       ZIP mode     public.water_rights_for_zip(zip) — the same answer the ZIP page renders;
//                    every point carries the reader's polygon verdict and HS.zipModeSites admits
//                    only 'member'.
//       address mode public.map1_water_rights_near(lat, lng, radius_mi) — the resident's circle.
//
// HONESTY (the same as the ZIP section). The status word is the agency's own; a use is shown only
// when it is a word; a person is never named (the server sends "Individual applicant"). A pending
// application is a request the agency has not decided, not a finding about anyone.
//
// ONE PIN PER POINT OF DIVERSION. A filing can name several points; each is drawn. Filings that
// share exactly one point become one pin ("N water-rights filings at this location"). Every list
// row and every count is a FILING, never a pin.
(function () {
  var HS = window.HS = window.HS || {};

  HS.WATER_RIGHTS_RELEVANCE = 'water_rights';
  HS.WATER_RIGHTS_LEGEND = {
    key: 'water_rights',
    chipLabel: 'Water rights filings',
    symbol: 'circle',          // no project Type uses the plain circle; the colour and letter differ from cleanup
    color: '#1c6ea4',
    letter: 'W'
  };
  HS.WATER_RIGHTS_NOTE = 'A pending application on the state agency’s list. It has not been decided, '
    + 'and it is not a finding about anyone.';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function httpsUrl(u) { return /^https:\/\/[^\s"'<>]+$/.test(str(u)) ? str(u) : ''; }
  function wordUses(u) { return /[A-Za-z]{4,}/.test(str(u)) ? str(u) : ''; }
  function day(v) { return HS.waterRights && HS.waterRights.day ? HS.waterRights.day(v) : ''; }

  HS.isWaterRight = function (s) {
    return !!s && s.relevance === HS.WATER_RIGHTS_RELEVANCE;
  };

  // One filing (as the reader sends it) + where it came from -> one site per point. A filing with
  // no https record link or no point yields nothing, so nothing unsourced can be drawn.
  function sitesOfFiling(f, ctx) {
    if (!f || typeof f !== 'object') return [];
    var url = httpsUrl(f.record_url);
    if (!url || !Array.isArray(f.points)) return [];
    var filing = {
      source: str(f.source || ctx.source), state: str(f.state || ctx.state),
      agency: str(ctx.agency), checked_at: str(ctx.checked_at), load_status: str(ctx.status),
      filing_no: str(f.filing_no), right_no: str(f.right_no), filing_type: str(f.filing_type),
      status: str(f.status), uses: wordUses(f.uses), diversion: str(f.diversion),
      applicant: str(f.applicant), applicant_withheld: f.applicant_withheld === true,
      filed_on: str(f.filed_on), date_label: str(f.date_label), record_url: url
    };
    var seen = {}, out = [];
    f.points.forEach(function (p) {
      var lat = p && typeof p.lat === 'number' ? p.lat : NaN;
      var lng = p && typeof p.lng === 'number' ? p.lng : NaN;
      if (!isFinite(lat) || !isFinite(lng)) return;
      var k = lat + ',' + lng;
      if (seen[k]) return;
      seen[k] = 1;
      var site = {
        scope: 'point',
        relevance: HS.WATER_RIGHTS_RELEVANCE,
        label: HS.waterRightTitleOf(filing),
        lat: lat, lng: lng,
        record_url: url,
        src: (filing.agency || 'State') + ' water rights',
        water: { filing: filing, key: filing.source + ':' + filing.filing_no },
        geo_precision: 'point'
      };
      if (p.zip_membership != null) site.zip_membership = p.zip_membership;
      out.push(site);
    });
    return out;
  }
  // "Application To Appropriate a55167"
  HS.waterRightTitleOf = function (f) {
    return (f.filing_type ? f.filing_type + ' ' : 'Water-rights filing ') + (f.filing_no || '');
  };

  // A reader body -> sites. ZIP reader: { status, agency, checked_at, filings }. Circle reader:
  // { status, sources:[{source, agency, checked_at, status}], filings:[{source, ...}] }. A body we
  // do not recognise yields [] (HS.waterRightsOutcome says it was a failed read, never "none").
  HS.waterRightsSitesFrom = function (body) {
    if (HS.waterRightsOutcome(body) === 'unavailable') return [];
    var bySource = {};
    (Array.isArray(body.sources) ? body.sources : []).forEach(function (s) {
      if (s && s.source) bySource[s.source] = s;
    });
    var top = { agency: body.agency, checked_at: body.checked_at, status: body.status, state: body.state };
    var sites = [];
    body.filings.forEach(function (f) {
      var src = (f && bySource[f.source]) || top;
      sites = sites.concat(sitesOfFiling(f, {
        source: f && f.source, state: (f && f.state) || src.state, agency: src.agency || top.agency,
        checked_at: src.checked_at || top.checked_at, status: src.status || top.status
      }));
    });
    return HS.groupWaterRightSites(sites);
  };
  // The reader's answer, in the page's words: 'complete' / 'stale' / 'not_covered' /
  // 'not_measured', or 'unavailable' for anything we could not read.
  HS.waterRightsOutcome = function (body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.filings)) return 'unavailable';
    if (body.status === 'complete') return 'complete';
    if (body.status === 'unavailable') return 'stale';
    if (body.status === 'not_covered' || body.status === 'not_measured') return body.status;
    return 'unavailable';
  };

  // Points shared exactly by several filings become one pin, listing them in reader order.
  HS.groupWaterRightSites = function (sites) {
    var order = [], by = {};
    (sites || []).forEach(function (s) {
      var k = s.lat + ',' + s.lng;
      if (!by[k]) { by[k] = []; order.push(k); }
      if (!by[k].some(function (x) { return x.water.key === s.water.key; })) by[k].push(s);
    });
    return order.map(function (k) {
      var m = by[k];
      if (m.length === 1) return m[0];
      var g = {};
      for (var f in m[0]) g[f] = m[0][f];
      g.label = m.length + ' water-rights filings at this location';
      g.water = { filing: m[0].water.filing, key: 'group:' + m.map(function (x) { return x.water.key; }).join('+'), group: m };
      return g;
    });
  };
  HS.waterRightGroupOf = function (s) {
    return s && s.water && Array.isArray(s.water.group) ? s.water.group : null;
  };
  // Pins -> the FILINGS they carry, once each (a filing with two points is one filing).
  HS.waterRightFilings = function (items) {
    var seen = {}, out = [];
    (items || []).forEach(function (s) {
      if (!HS.isWaterRight(s)) return;
      (HS.waterRightGroupOf(s) || [s]).forEach(function (m) {
        if (seen[m.water.key]) return;
        seen[m.water.key] = 1;
        out.push(m);
      });
    });
    return out;
  };

  // "Unapproved · Priority date Oct 15, 2026" — the one type line every surface prints.
  HS.waterRightTypeLine = function (s) {
    var g = HS.waterRightGroupOf(s);
    if (g) return g.length + ' water-rights filings at this location';
    var f = (s && s.water && s.water.filing) || {};
    var parts = [];
    if (f.status) parts.push('Agency status: ' + f.status);
    if (f.filed_on && day(f.filed_on)) parts.push((f.date_label || 'Date') + ' ' + day(f.filed_on));
    return parts.join(' · ') || 'Pending water-rights filing';
  };
  // "BAR H RANCH INC. · Surface · Use: Irrigation" — what the filing says, never decoded.
  HS.waterRightFactsLine = function (s) {
    var f = (s && s.water && s.water.filing) || {};
    var facts = [];
    if (f.applicant) facts.push(f.applicant);
    if (f.diversion) facts.push(f.diversion);
    if (f.uses) facts.push('Use: ' + f.uses);
    if (f.right_no) facts.push('Changes right ' + f.right_no);
    return facts.join(' · ');
  };
  // "From Utah Division of Water Rights's list, checked Oct 29, 2026" (or, when the last load is
  // older than 48 hours, "last confirmed …"). Nothing is printed when the reader sent no date.
  HS.waterRightCheckedLine = function (s) {
    var f = (s && s.water && s.water.filing) || {};
    var d = day(f.checked_at);
    if (!d) return '';
    return 'From ' + (f.agency || 'the state agency') + '’s list, '
      + (f.load_status === 'unavailable' ? 'last confirmed ' : 'checked ') + d;
  };

  HS.waterRightMarker = function () {
    var L = HS.WATER_RIGHTS_LEGEND;
    return {
      shape: L.symbol, color: L.color, label: L.letter, signal: null,
      categories: [L.key], typeKey: null, filterKey: L.key,
      legendLabel: 'Water-rights filing', typeLabel: 'Water-rights filing',
      popupLabel: 'Water-rights filing', isFacility: false, isWaterRight: true,
      lifecycle: 'unknown', lifecycleBucket: 'unknown'
    };
  };
  HS.waterRightTitle = function (s) {
    var g = HS.waterRightGroupOf(s);
    if (g) return 'Water-rights filings: ' + g.length + ' at this location';
    return 'Water-rights filing · ' + ((s && s.label) || '');
  };

  // ── the switch ───────────────────────────────────────────────────────────────────────
  var visible = true;
  HS.waterRightsVisible = function () { return visible; };
  HS.setWaterRightsVisible = function (on) { visible = !!on; };
  // ?water=0 / ?water=1, anything else keeps the default (on).
  HS.waterRightsFromUrl = function (href) {
    try {
      var v = new URL(href).searchParams.get('water');
      return v === '0' ? false : v === '1' ? true : null;
    } catch (e) { return null; }
  };

  // ── popup / card / list HTML (esc is the page's own escaper) ──────────────────────────
  var GROUP_POPUP_CAP = 8;
  function linkHTML(s, esc) {
    var f = s.water.filing;
    return "<a href='" + esc(f.record_url) + "' target='_blank' rel='noopener' style='color:inherit'>"
      + esc((f.agency || 'Agency') + ' record') + ' ▸</a>';
  }
  function oneHTML(s, esc, muted) {
    var facts = HS.waterRightFactsLine(s);
    return "<div style='margin-top:4px'>" + esc(HS.waterRightTypeLine(s)) + '</div>'
      + (facts ? "<div style='color:" + muted + "'>" + esc(facts) + '</div>' : '')
      + "<div style='margin-top:3px'>" + linkHTML(s, esc) + '</div>';
  }
  function membersHTML(g, esc, muted) {
    var shown = g.slice(0, GROUP_POPUP_CAP).map(function (m) {
      return "<div style='margin-top:5px'><div style='font-weight:600'>" + esc(m.label || '') + '</div>'
        + oneHTML(m, esc, muted) + '</div>';
    }).join('');
    var rest = g.length - GROUP_POPUP_CAP;
    return shown + (rest > 0 ? "<div style='margin-top:5px;color:" + muted + "'>The other " + rest
      + (rest === 1 ? ' is' : ' are') + ' in the Water rights filings list.</div>' : '');
  }
  function footHTML(s, esc, muted) {
    var checked = HS.waterRightCheckedLine(s);
    return (checked ? "<div style='margin-top:3px;font-size:11px;color:" + muted + "'>" + esc(checked) + '</div>' : '')
      + "<div style='margin-top:3px;font-size:11px;color:" + muted + "'>" + esc(HS.WATER_RIGHTS_NOTE) + '</div>';
  }
  HS.waterRightPopupHTML = function (s, esc, dark) {
    var muted = dark ? '#9fb0ad' : '#5d6f72';
    var g = HS.waterRightGroupOf(s);
    var f = s.water.filing;
    return "<div class='pt'>" + esc(s.label || '') + '</div>'
      + "<div class='pk'>Water-rights filing" + (g ? 's' : '') + ' · ' + esc(f.agency || 'State') + '</div>'
      + (g ? membersHTML(g, esc, muted) : oneHTML(s, esc, muted))
      + footHTML(s, esc, muted);
  };
  // The 3D views' click card, in that card's own classes.
  HS.waterRightCardHTML = function (s, esc) {
    var muted = '#9fb0ad';
    var g = HS.waterRightGroupOf(s);
    var f = s.water.filing;
    return "<div class='ci-n'>" + esc(s.label || '') + '</div>'
      + "<div class='ci-t'>" + esc((g ? 'Water-rights filings · ' : 'Water-rights filing · ') + (f.agency || 'State')) + '</div>'
      + "<div class='ci-v' style='font-weight:400'>" + (g ? membersHTML(g, esc, muted) : oneHTML(s, esc, muted)) + '</div>'
      + "<div class='ci-v' style='font-weight:400'>" + footHTML(s, esc, muted) + '</div>';
  };
  // Rows in the page's own rail markup, one per FILING, capped like every rail.
  HS.waterRightsListHTML = function (items, esc, cap) {
    var rows = HS.waterRightFilings(items);
    var n = cap || 12;
    var out = rows.slice(0, n).map(function (s) {
      var f = s.water.filing;
      var facts = HS.waterRightFactsLine(s);
      return "<div class='rec' data-ref='" + esc(s.water.key) + "'>"
        + "<span class='dot' style='background:" + HS.WATER_RIGHTS_LEGEND.color + "'></span>"
        + "<div style='flex:1'><div class='t'>" + esc(s.label || '') + '</div>'
        + "<div class='s'>" + esc(HS.waterRightTypeLine(s)) + (facts ? ' · ' + esc(facts) : '')
        + " · <a href='" + esc(f.record_url) + "' target='_blank' rel='noopener'>"
        + esc((f.agency || 'Agency') + ' record') + ' ▸</a></div></div></div>';
    }).join('');
    if (rows.length > n) {
      var rest = rows.length - n;
      out += "<div class='listmore'>Showing " + n + ' of ' + rows.length + '. The other ' + rest
        + (rest === 1 ? ' is' : ' are') + ' on the map.</div>';
    }
    return out;
  };
})();
