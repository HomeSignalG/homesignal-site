// lib/state-cleanup.js — STATE CLEANUP SITES on Map 1 (2026-10-21)
//
// ⚖️ FOUNDER DECISION 2026-10-21: a state cleanup site (a state's list of open waste-cleanup cases:
// Florida DEP, Washington Ecology) is
// its own Map 1 layer with its own switch, "State cleanup sites", under Regulatory records. It is
// NOT an EPA facility (no FRS registry id, no ECHO link, no purple R) and NOT a project Type, so it
// is drawn whatever the Status and Type chips say, and it never enters the EPA facility count, the
// development counts or any list of projects.
//
// ONE MAPPING, ONE PREDICATE. Every Map 1 surface asks HS.isStateCleanup(site) and draws the
// marker HS.stateCleanupMarker returns; the page decides nothing about these records itself.
// The rows come only from the database readers in docs/state-cleanup-sites.sql:
//   ZIP mode     public.map1_state_cleanup_zip_members(zip) — ZCTA polygon membership, each row
//                carrying the canonical verdict; HS.zipModeSites admits only 'member'.
//   address mode public.map1_state_cleanup_near(lat, lng, radius_mi) — the resident's own circle.
//
// HONESTY. Category and status are DEP's own codes, shown in DEP's own words (the category names
// are the labels on DEP's published map legend). A listing is a public record of a cleanup case;
// it is not a finding about any owner or operator (docs/development-tracker-source-of-truth.md
// §10), and the popup says so. A code DEP's legend does not name is shown as the code, never
// guessed.
//
// 2026-10-22 (audit follow-up):
//  * A private home is never named: the reader sends "Residential property" (rule in the SQL,
//    public.state_cleanup_display_name), and the page shows what it is sent.
//  * Every popup says when the list was last checked (the reader's checked_at).
//  * A record link shared by several sites says so ("facility documents (N cleanup sites here)").
//  * Sites at the SAME point are one pin ("N cleanup sites at this location"), decided once here
//    in HS.stateCleanupSitesFrom, so all three map views draw the same thing. The list still shows
//    every site (HS.stateCleanupMembers), and every count is of sites, never of pins.
(function () {
  var HS = window.HS = window.HS || {};

  HS.STATE_CLEANUP_RELEVANCE = 'state_cleanup';
  HS.STATE_CLEANUP_LEGEND = {
    key: 'state_cleanup',
    chipLabel: 'State cleanup sites',
    symbol: 'circle',          // no project Type uses the plain circle
    color: '#8a5a00',
    letter: 'C'
  };
  // DEP's own legend labels (MapServer/0 drawingInfo, read 2026-10-21). FED has no legend entry.
  HS.STATE_CLEANUP_CATEGORY = {
    PETRO: 'Petroleum',
    BROWN: 'Brownfield site',
    SUPER: 'Superfund',
    OTHCU: 'Other waste cleanup',
    PFAS: 'PFAS site'
  };
  HS.STATE_CLEANUP_STATUS = { ACTIVE: 'Active', OPEN: 'Open', ONHOLD: 'On hold' };
  // Codes are per source: the legend words above are Florida DEP's. Washington Ecology publishes
  // its status in words and no category, so its values are shown as published.
  HS.STATE_CLEANUP_LABELS = {
    fl_dep_cleanup: { category: HS.STATE_CLEANUP_CATEGORY, status: HS.STATE_CLEANUP_STATUS }
  };
  HS.STATE_CLEANUP_NOTE = 'On the state’s list of cleanup sites that are not closed. A listing is a public '
    + 'record of a cleanup case, not a finding about any owner.';

  function str(v) { return v == null ? '' : String(v).trim(); }

  HS.isStateCleanup = function (s) {
    return !!s && s.relevance === HS.STATE_CLEANUP_RELEVANCE;
  };

  function labelsFor(s) {
    return HS.STATE_CLEANUP_LABELS[str(s && s.cleanup && s.cleanup.source)] || { category: {}, status: {} };
  }
  HS.stateCleanupCategoryLabel = function (s) {
    var c = str(s && s.cleanup && s.cleanup.category);
    return labelsFor(s).category[c] || (c ? 'Cleanup category ' + c : 'Cleanup site');
  };
  HS.stateCleanupStatusLabel = function (s) {
    var c = str(s && s.cleanup && s.cleanup.status);
    return labelsFor(s).status[c] || c;
  };
  // "Petroleum · Florida DEP status: Active" — the one type line every surface prints.
  HS.stateCleanupTypeLine = function (s) {
    var grp = HS.stateCleanupGroupOf && HS.stateCleanupGroupOf(s);
    if (grp) return grp.length + ' cleanup sites at this location';
    var st = HS.stateCleanupStatusLabel(s);
    var agency = str(s && s.cleanup && s.cleanup.agency) || 'state';
    return HS.stateCleanupCategoryLabel(s) + (st ? ' · ' + agency + ' status: ' + st : '');
  };

  // A reader row -> a Map 1 site. Returns null for anything that is not a usable record (no
  // source link, no point), so nothing unsourced can be drawn.
  HS.stateCleanupSite = function (row) {
    if (!row || typeof row !== 'object') return null;
    var url = str(row.record_url);
    var lat = typeof row.lat === 'number' ? row.lat : NaN;
    var lng = typeof row.lng === 'number' ? row.lng : NaN;
    if (!/^https:\/\//.test(url) || !isFinite(lat) || !isFinite(lng)) return null;
    var addr = [str(row.address), str(row.city)].filter(Boolean).join(', ');
    var site = {
      scope: 'point',
      relevance: HS.STATE_CLEANUP_RELEVANCE,
      label: str(row.name) || 'Cleanup site',
      lat: lat, lng: lng,
      record_url: url,
      src: (str(row.agency) || 'State') + ' cleanup sites',
      cleanup: {
        source: str(row.source), site_key: str(row.site_key), program_id: str(row.program_id),
        agency: str(row.agency), category: str(row.category), status: str(row.status),
        address: addr, loaded_at: str(row.source_loaded_at), checked_at: str(row.checked_at),
        url_sites: typeof row.record_url_sites === 'number' && row.record_url_sites > 0 ? row.record_url_sites : 1,
        name_withheld: row.name_withheld === true
      },
      geo_precision: 'point'
    };
    if (row.zip_membership != null) site.zip_membership = row.zip_membership;
    return site;
  };
  // The reader's body -> sites. A body we do not recognise yields [] (shown as nothing, never as
  // a measured empty — HS.stateCleanupOutcome says which).
  HS.stateCleanupSitesFrom = function (body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.sites)) return [];
    return HS.groupStateCleanupSites(body.sites.map(HS.stateCleanupSite).filter(Boolean));
  };
  // Sites at exactly the same point become one pin. A lone site is returned unchanged; a group is
  // a site whose cleanup.group lists its members (in the reader's order), labelled by its count,
  // carrying the first member's link and point so every gate that needs one still has one.
  HS.groupStateCleanupSites = function (sites) {
    var order = [], by = {};
    (sites || []).forEach(function (s) {
      if (s.cleanup && Array.isArray(s.cleanup.group)) { order.push({ one: s }); return; }
      var k = s.lat + ',' + s.lng;
      if (!by[k]) { by[k] = []; order.push({ key: k }); }
      by[k].push(s);
    });
    return order.map(function (o) {
      if (o.one) return o.one;
      var m = by[o.key];
      if (m.length === 1) return m[0];
      var g = {};
      for (var f in m[0]) g[f] = m[0][f];
      g.label = m.length + ' cleanup sites at this location';
      g.cleanup = {};
      for (var c in m[0].cleanup) g.cleanup[c] = m[0].cleanup[c];
      g.cleanup.site_key = 'group:' + m.map(function (x) { return x.cleanup.site_key; }).join('+');
      g.cleanup.group = m;
      return g;
    });
  };
  HS.stateCleanupGroupOf = function (s) {
    return s && s.cleanup && Array.isArray(s.cleanup.group) ? s.cleanup.group : null;
  };
  // Pins -> the sites they carry. Every count and every list row is a site, never a pin.
  HS.stateCleanupMembers = function (items) {
    var out = [];
    (items || []).forEach(function (s) {
      if (!HS.isStateCleanup(s)) return;
      var g = HS.stateCleanupGroupOf(s);
      if (g) out.push.apply(out, g); else out.push(s);
    });
    return out;
  };
  // "Florida DEP site documents" / "Florida DEP facility documents (74 cleanup sites here)".
  HS.stateCleanupLinkLabel = function (s) {
    var c = (s && s.cleanup) || {};
    var n = c.url_sites || 1;
    return (c.agency || 'State') + (n > 1 ? ' facility documents (' + n + ' cleanup sites here)' : ' site documents');
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // "From Washington Ecology's list, checked Oct 22, 2026" — when the last complete run of the
  // source confirmed the site. Nothing is printed when the reader sent no date.
  HS.stateCleanupCheckedLine = function (s) {
    var c = (s && s.cleanup) || {};
    var d = c.checked_at ? new Date(c.checked_at) : null;
    if (!d || isNaN(d.getTime())) return '';
    return 'From ' + (c.agency || 'the state') + '\u2019s list, checked '
      + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  };
  HS.stateCleanupOutcome = function (body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.sites)) return 'unavailable';
    return body.status === 'complete' || body.status === 'not_measured' ? body.status : 'unavailable';
  };

  // The marker. Its own shape and colour, no lifecycle colour (DEP states no construction or
  // operating stage) and no regulatory R (that badge means an EPA-linked record).
  HS.stateCleanupMarker = function (s) {
    var L = HS.STATE_CLEANUP_LEGEND;
    return {
      shape: L.symbol, color: L.color, label: L.letter, signal: null,
      categories: [L.key], typeKey: null, filterKey: L.key,
      legendLabel: 'State cleanup site', typeLabel: 'State cleanup site',
      popupLabel: 'State cleanup site', isFacility: false, isStateCleanup: true,
      lifecycle: 'unknown', lifecycleBucket: 'unknown'
    };
  };
  HS.stateCleanupTitle = function (s) {
    var grp = HS.stateCleanupGroupOf(s);
    if (grp) return 'State cleanup sites: ' + grp.length + ' at this location';
    return 'State cleanup site · ' + HS.stateCleanupCategoryLabel(s);
  };

  // ── the switch ───────────────────────────────────────────────────────────────────────
  var visible = true;
  HS.stateCleanupVisible = function () { return visible; };
  HS.setStateCleanupVisible = function (on) { visible = !!on; };
  // ?cleanup=0 / ?cleanup=1, anything else keeps the default (on).
  HS.stateCleanupFromUrl = function (href) {
    try {
      var v = new URL(href).searchParams.get('cleanup');
      return v === '0' ? false : v === '1' ? true : null;
    } catch (e) { return null; }
  };

  // ── popup / card / list HTML (esc is the page's own escaper) ──────────────────────────
  var GROUP_POPUP_CAP = 8;
  function linkHTML(s, esc) {
    return "<a href='" + esc(s.record_url) + "' target='_blank' rel='noopener' style='color:inherit'>"
      + esc(HS.stateCleanupLinkLabel(s)) + ' \u25b8</a>';
  }
  function memberLinesHTML(g, esc, muted) {
    var shown = g.slice(0, GROUP_POPUP_CAP).map(function (m) {
      return "<div style='margin-top:5px'><div style='font-weight:600'>" + esc(m.label || '') + '</div>'
        + '<div>' + esc(HS.stateCleanupTypeLine(m)) + '</div>'
        + '<div>' + linkHTML(m, esc) + '</div></div>';
    }).join('');
    var rest = g.length - GROUP_POPUP_CAP;
    return shown + (rest > 0 ? "<div style='margin-top:5px;color:" + muted + "'>The other " + rest
      + (rest === 1 ? ' is' : ' are') + ' in the State cleanup sites list.</div>' : '');
  }
  function footHTML(s, esc, muted) {
    var checked = HS.stateCleanupCheckedLine(s);
    return (checked ? "<div style='margin-top:3px;font-size:11px;color:" + muted + "'>" + esc(checked) + '</div>' : '')
      + "<div style='margin-top:3px;font-size:11px;color:" + muted + "'>" + esc(HS.STATE_CLEANUP_NOTE) + '</div>';
  }
  HS.stateCleanupPopupHTML = function (s, esc, dark) {
    var c = (s && s.cleanup) || {};
    var muted = dark ? '#9fb0ad' : '#5d6f72';
    var g = HS.stateCleanupGroupOf(s);
    return "<div class='pt'>" + esc(s.label || '') + '</div>'
      + "<div class='pk'>State cleanup site" + (g ? 's' : '') + ' · ' + esc(c.agency || 'State') + '</div>'
      + (g ? '' : "<div style='margin-top:4px'>" + esc(HS.stateCleanupTypeLine(s)) + '</div>')
      + (c.address ? "<div style='color:" + muted + "'>" + esc(c.address) + '</div>' : '')
      + (g ? memberLinesHTML(g, esc, muted) : "<div style='margin-top:3px'>" + linkHTML(s, esc) + '</div>')
      + footHTML(s, esc, muted);
  };
  // The 3D views' click card, in that card's own classes (.ci-n / .ci-t / .ci-v / .ci-l).
  HS.stateCleanupCardHTML = function (s, esc) {
    var c = (s && s.cleanup) || {};
    var muted = '#9fb0ad';
    var g = HS.stateCleanupGroupOf(s);
    return "<div class='ci-n'>" + esc(s.label || '') + '</div>'
      + "<div class='ci-t'>" + esc(g ? 'State cleanup sites · ' + (c.agency || 'State')
                                       : 'State cleanup site · ' + HS.stateCleanupTypeLine(s)) + '</div>'
      + (c.address ? "<div class='ci-v'>" + esc(c.address) + '</div>' : '')
      + (g ? "<div class='ci-v' style='font-weight:400'>" + memberLinesHTML(g, esc, muted) + '</div>'
           : "<div class='ci-l'>" + linkHTML(s, esc) + '</div>')
      + "<div class='ci-v' style='font-weight:400'>" + footHTML(s, esc, muted) + '</div>';
  };
  // Rows in the page's own rail markup (.rec / .dot / .t / .s, .listmore), capped like every rail.
  // One row per SITE: a pin carrying several sites lists each of them.
  HS.stateCleanupListHTML = function (items, esc, cap) {
    var rows = HS.stateCleanupMembers(items);
    var n = cap || 12;
    var out = rows.slice(0, n).map(function (s) {
      var c = s.cleanup || {};
      return "<div class='rec' data-ref='" + esc((c.source || 'state') + ':' + (c.site_key || '')) + "'>"
        + "<span class='dot' style='background:" + HS.STATE_CLEANUP_LEGEND.color + "'></span>"
        + "<div style='flex:1'><div class='t'>" + esc(s.label || '') + '</div>'
        + "<div class='s'>" + esc(HS.stateCleanupTypeLine(s)) + (c.address ? ' \u00b7 ' + esc(c.address) : '')
        + " \u00b7 <a href='" + esc(s.record_url) + "' target='_blank' rel='noopener'>"
        + esc(HS.stateCleanupLinkLabel(s)) + ' \u25b8</a></div></div></div>';
    }).join('');
    if (rows.length > n) {
      var rest = rows.length - n;
      out += "<div class='listmore'>Showing " + n + ' of ' + rows.length + '. The other ' + rest
        + (rest === 1 ? ' is' : ' are') + ' on the map.</div>';
    }
    return out;
  };
})();
