/* Map 1 project link and project-information panel (2026-11-12).
 *
 * A link of the form /map/<zip>/?project=<project key> opens Map 1 on that project and shows
 * this panel: name, location, the status Map 1 publishes, dated information, the documents
 * and the open questions. It decides nothing about a project. Status, type and location come
 * from the same records the map draws; documents come only from public.map1_project_documents
 * (approved rows). SQL of record: docs/map1-project-link.sql.
 *
 * PROJECT KEYS (stable over status changes, merges and map rebuilds):
 *   dcrec:<record key>  a data center from the canonical layer, named by its publisher's own record
 *                       key (public.dc_observation_record_key). Never the entity uuid: entities are
 *                       superseded on merges, the publisher's record key is not.
 *   nat:<source_key>    a data center from public.national_dc_records (OpenStreetMap).
 *   n5:<source_key>     a development record drawn from the serving N5 generation.
 * The page never builds these keys; public.map1_project_locate resolves one to the ZIP and the
 * map key Map 1 draws it under. The link itself carries no filter setting.
 */
(function (root) {
  'use strict';
  var HS = root.HS = root.HS || {};

  var KEY_RE = /^(dcrec|nat|n5):[^\u0000-\u001f\u007f]{1,255}$/;

  // The ?project= value, or null. Never throws.
  HS.map1ProjectParam = function (href) {
    var raw;
    try { raw = new URL(href || root.location.href).searchParams.get('project'); } catch (e) { return null; }
    if (raw == null) return null;
    raw = String(raw).trim();
    return KEY_RE.test(raw) ? raw : null;
  };
  HS.map1ProjectKeyOk = function (k) { return KEY_RE.test(String(k == null ? '' : k)); };

  // The key a drawn site carries on Map 1 (what public.map1_project_locate returns as map_key).
  HS.map1SiteMapKey = function (s) {
    if (!s) return null;
    if (s.record_kind === 'national_project' && s.source_key) return String(s.source_key);
    if (s.zip_authoritative && s.zip_project_ref) return 'n5:' + String(s.zip_project_ref);
    return null;
  };

  // The public link for a project key. Only the ZIP and the key; never a filter.
  HS.map1ProjectLink = function (origin, zip, key) {
    if (!/^\d{5}$/.test(String(zip || '')) || !HS.map1ProjectKeyOk(key)) return null;
    return String(origin || '').replace(/\/+$/, '') + '/map/' + zip + '/?project=' + encodeURIComponent(key);
  };

  // WHAT THE MAP'S OWN SOURCE IS. A directory listing names a project; it does not establish an
  // official decision. An agency's own record is an official record. Nothing else is inferred.
  HS.map1SourceAssessment = function (s) {
    var url = s && (s.record_url || s.url) || '';
    if (!url) return { kind: 'none', official: false, label: 'No source record on file' };
    if (s.record_kind === 'national_project') {
      var who = s.source_name || 'a data center directory';
      return { kind: 'directory', official: false, url: url,
        label: 'Listed by ' + who + ' (third-party directory)',
        note: 'A directory listing shows the project is reported. It is not an official decision.' };
    }
    if (s.zip_authoritative) {
      return { kind: 'official_record', official: true, url: url,
        label: 'Agency record' + (s.src ? ' (' + s.src + ')' : ''),
        note: 'The agency\'s own record of this filing.' };
    }
    return { kind: 'source', official: false, url: url, label: 'Source record' };
  };

  var DOC_KIND = {
    application: 'Application', planning: 'Planning document', decision: 'Decision record',
    permit: 'Permit record', meeting: 'Meeting record', other_official: 'Official record',
    news: 'News report', directory: 'Directory listing'
  };
  var OFFICIAL_KINDS = { application: 1, planning: 1, decision: 1, permit: 1, meeting: 1, other_official: 1 };
  HS.map1DocKindLabel = function (k) { return DOC_KIND[k] || 'Document'; };
  HS.map1DocIsOfficial = function (k) { return !!OFFICIAL_KINDS[k]; };

  var FLAG_TEXT = {
    CORROBORATED_BY_DERIVED_ADDRESS: 'The map point agrees with the street address its source gives.',
    PUBLISHER_ROAD_REFERENCE: 'The source places this project by a nearby road, not the site itself.',
    PUBLISHER_APPROXIMATE: 'The source gives an approximate location.'
  };

  function day(v) {
    if (!v) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (!m) return null;
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var mo = +m[2];
    if (mo < 1 || mo > 12) return null;
    return names[mo - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }
  HS.map1Day = day;

  function safeUrl(u) { return /^https:\/\/[^\s<>"']+$/i.test(String(u || '')) ? String(u) : null; }

  // What the record's own filing date is. Labels come from date_kind; an unknown kind says "Date on record".
  var DATE_KIND = { filed: 'Filed', submitted: 'Submitted', issued: 'Permit issued', decided: 'Decision date',
    scheduled: 'Scheduled', estimated: 'Estimated', hearing: 'Hearing date', published: 'Published' };

  /* The panel. ctx: {
   *   esc(s), zip, kindLabel (the page's stage line), decisionHtml, currentStatusHtml,
   *   docs: approved document rows, or null when not read, docsState: 'ok' | 'loading' | 'failed',
   *   notOnMap: true when the key named a project this map does not draw }
   */
  HS.map1ProjectPanelHTML = function (s, ctx) {
    ctx = ctx || {};
    var esc = ctx.esc || function (x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
    var out = [];
    out.push("<button type='button' class='pp-close' data-pp='close' aria-label='Close project information'>×</button>");
    if (ctx.notOnMap) {
      out.push("<h3 class='pp-h'>This project is not on JODY's map right now</h3>");
      out.push("<p class='pp-p'>The link names a project that this map does not currently show" +
        (ctx.zip ? ' for ZIP ' + esc(ctx.zip) : '') + ". It may have been removed from its source, or the map is being rebuilt.</p>");
      return out.join('');
    }
    var name = (s && (s.label || s.name)) || 'Unnamed project';
    out.push("<h3 class='pp-h'>" + esc(name) + "</h3>");

    // LOCATION
    var loc = s.location_text || s.canonical_addr || s.location_addr || '';
    var locLine = (loc ? esc(loc) + ' · ' : '') + (ctx.zip ? 'ZIP ' + esc(ctx.zip) : '');
    out.push("<div class='pp-row'><span class='pp-k'>Location</span><span class='pp-v'>" + (locLine || 'Shown on the map') + "</span></div>");

    // STATUS (Map 1's own words; the decision note and current-status line are the page's helpers)
    out.push("<div class='pp-row'><span class='pp-k'>Status on JODY</span><span class='pp-v'>" + esc(ctx.kindLabel || '') + "</span></div>");
    if (ctx.decisionHtml) out.push(ctx.decisionHtml);
    if (ctx.currentStatusHtml) out.push(ctx.currentStatusHtml);
    if (s.raw_status && s.record_kind === 'national_project') {
      out.push("<div class='pp-row'><span class='pp-k'>Status as listed</span><span class='pp-v'>" + esc(s.raw_status) +
        (s.source_name ? ' (' + esc(s.source_name) + ')' : '') + "</span></div>");
    }

    // DATES, each labelled with what it is
    var dates = [];
    if (s.file_date && day(s.file_date)) dates.push([(DATE_KIND[s.date_kind] || 'Date on record') + ' (agency record)', day(s.file_date)]);
    if (s.last_seen_at && day(s.last_seen_at)) dates.push(['Source last observed', day(s.last_seen_at)]);
    var docs = Array.isArray(ctx.docs) ? ctx.docs : [];
    docs.forEach(function (d) {
      if (d && d.doc_date && day(d.doc_date)) dates.push([(d.doc_date_label || 'Document date') + ': ' + (d.title || ''), day(d.doc_date)]);
    });
    if (dates.length) {
      out.push("<div class='pp-sec'>Dates</div><ul class='pp-list'>" + dates.map(function (r) {
        return "<li><span class='pp-d'>" + esc(r[1]) + "</span> " + esc(r[0]) + "</li>";
      }).join('') + "</ul>");
    }

    // DOCUMENTS: the map's own source, then approved documents
    var src = HS.map1SourceAssessment(s);
    var items = [];
    var su = safeUrl(src.url);
    if (su) items.push("<li><a href='" + esc(su) + "' target='_blank' rel='noopener noreferrer'>" + esc(src.label) + "</a>" +
      (src.note ? "<div class='pp-note'>" + esc(src.note) + "</div>" : '') + "</li>");
    docs.forEach(function (d) {
      var u = safeUrl(d && d.url);
      if (!u) return;
      items.push("<li><a href='" + esc(u) + "' target='_blank' rel='noopener noreferrer'>" + esc(d.title || u) + "</a>" +
        "<div class='pp-note'>" + esc(HS.map1DocKindLabel(d.doc_kind)) + (d.publisher ? ' · ' + esc(d.publisher) : '') +
        (d.doc_date && day(d.doc_date) ? ' · ' + esc(d.doc_date_label || 'Document date') + ' ' + esc(day(d.doc_date)) : '') + "</div>" +
        (d.supports ? "<div class='pp-note'>Supports: " + esc(d.supports) + "</div>" : '') + "</li>");
    });
    out.push("<div class='pp-sec'>Documents and sources</div>");
    if (ctx.docsState === 'loading') items.push("<li class='pp-muted'>Loading documents…</li>");
    out.push(items.length ? "<ul class='pp-list'>" + items.join('') + "</ul>" : "<p class='pp-muted'>No documents on file.</p>");

    // OPEN QUESTIONS, from existing fields only
    var open = [];
    if (ctx.docsState === 'failed') open.push('Supporting documents could not be loaded just now. This is not the same as having none.');
    var officialDocs = docs.filter(function (d) { return d && HS.map1DocIsOfficial(d.doc_kind); }).length;
    if (!src.official && !officialDocs && ctx.docsState !== 'failed' && ctx.docsState !== 'loading') {
      open.push('No official government document is on file for this project yet.');
    }
    if (s.scope === 'area') open.push('The map point is placed within the area, not at an exact site.');
    if (s.location_precision && s.location_precision !== 'precise_location' && s.location_precision !== 'exact' && s.record_kind === 'national_project') {
      open.push('The source gives an approximate location (' + String(s.location_precision).replace(/_/g, ' ') + ').');
    }
    (s.quality_flags || []).forEach(function (f) { if (FLAG_TEXT[f] && f !== 'CORROBORATED_BY_DERIVED_ADDRESS') open.push(FLAG_TEXT[f]); });
    if (s.publication_basis === 'legacy_osm_compat') open.push('This entry comes from OpenStreetMap and is not yet matched to another source.');
    var notes = [];
    (s.quality_flags || []).forEach(function (f) { if (f === 'CORROBORATED_BY_DERIVED_ADDRESS') notes.push(FLAG_TEXT[f]); });
    if (notes.length) out.push("<div class='pp-sec'>Location check</div><ul class='pp-list'>" + notes.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + "</ul>");
    if (open.length) out.push("<div class='pp-sec'>Not yet known</div><ul class='pp-list'>" + open.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + "</ul>");

    out.push("<p class='pp-foot'>This is the information JODY has published from these sources. It changes when the sources are read again; it is not live.</p>");
    return out.join('');
  };
})(typeof window !== 'undefined' ? window : globalThis);
