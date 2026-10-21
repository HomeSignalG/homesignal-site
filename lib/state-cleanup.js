// lib/state-cleanup.js — STATE CLEANUP SITES on Map 1 (2026-10-21)
//
// ⚖️ FOUNDER DECISION 2026-10-21: a state cleanup site (Florida DEP's open waste-cleanup list) is
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
  HS.STATE_CLEANUP_NOTE = 'Listed on the state’s open cleanup sites. A listing is a public record of a '
    + 'cleanup case, not a finding about any owner.';

  function str(v) { return v == null ? '' : String(v).trim(); }

  HS.isStateCleanup = function (s) {
    return !!s && s.relevance === HS.STATE_CLEANUP_RELEVANCE;
  };

  HS.stateCleanupCategoryLabel = function (s) {
    var c = str(s && s.cleanup && s.cleanup.category);
    return HS.STATE_CLEANUP_CATEGORY[c] || (c ? 'Cleanup category ' + c : 'Cleanup site');
  };
  HS.stateCleanupStatusLabel = function (s) {
    var c = str(s && s.cleanup && s.cleanup.status);
    return HS.STATE_CLEANUP_STATUS[c] || c;
  };
  // "Petroleum · Florida DEP status: Active" — the one type line every surface prints.
  HS.stateCleanupTypeLine = function (s) {
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
        address: addr, loaded_at: str(row.source_loaded_at)
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
    return body.sites.map(HS.stateCleanupSite).filter(Boolean);
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
  HS.stateCleanupPopupHTML = function (s, esc, dark) {
    var c = (s && s.cleanup) || {};
    var muted = dark ? '#9fb0ad' : '#5d6f72';
    var link = "<a href='" + esc(s.record_url) + "' target='_blank' rel='noopener' style='color:inherit'>"
      + esc((c.agency || 'State') + ' site documents') + ' ▸</a>';
    return "<div class='pt'>" + esc(s.label || '') + '</div>'
      + "<div class='pk'>State cleanup site · " + esc(c.agency || 'State') + '</div>'
      + "<div style='margin-top:4px'>" + esc(HS.stateCleanupTypeLine(s)) + '</div>'
      + (c.address ? "<div style='color:" + muted + "'>" + esc(c.address) + '</div>' : '')
      + "<div style='margin-top:3px'>" + link + '</div>'
      + "<div style='margin-top:3px;font-size:11px;color:" + muted + "'>" + esc(HS.STATE_CLEANUP_NOTE) + '</div>';
  };
  // Rows in the page's own rail markup (.rec / .dot / .t / .s, .listmore), capped like every rail.
  HS.stateCleanupListHTML = function (items, esc, cap) {
    var rows = (items || []).filter(HS.isStateCleanup);
    var n = cap || 12;
    var out = rows.slice(0, n).map(function (s) {
      var c = s.cleanup || {};
      return "<div class='rec' data-ref='" + esc((c.source || 'state') + ':' + (c.site_key || '')) + "'>"
        + "<span class='dot' style='background:" + HS.STATE_CLEANUP_LEGEND.color + "'></span>"
        + "<div style='flex:1'><div class='t'>" + esc(s.label || '') + '</div>'
        + "<div class='s'>" + esc(HS.stateCleanupTypeLine(s)) + (c.address ? ' \u00b7 ' + esc(c.address) : '')
        + " \u00b7 <a href='" + esc(s.record_url) + "' target='_blank' rel='noopener'>"
        + esc((c.agency || 'State') + ' documents') + ' \u25b8</a></div></div></div>';
    }).join('');
    if (rows.length > n) {
      var rest = rows.length - n;
      out += "<div class='listmore'>Showing " + n + ' of ' + rows.length + '. The other ' + rest
        + (rest === 1 ? ' is' : ' are') + ' on the map.</div>';
    }
    return out;
  };
})();
