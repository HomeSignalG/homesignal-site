/* HomeSignal — evidence-backed property card (Phase 4 pilot).
 *
 * PURE RENDERER. It receives the payload from ONE normalized RPC,
 * public.ev_property_card(id_type, id_value), and knows nothing about TCAD, TDLR,
 * Denver, or any county field name. Every consumer word it prints either comes from
 * the payload or from CONSUMER_COPY below — there is no county-specific branch.
 *
 * Vanilla, no build step, matches the repo's plain-ES5-ish style (CLAUDE.md §4).
 */
(function (global) {
  'use strict';

  // §8 — the only place internal state becomes consumer language on the client.
  // The RPC already maps status; this covers the badge tone + accessible label.
  var STATUS = {
    corroborated: { tone: 'ok',   icon: '✓', sr: 'Corroborated' },
    reported:     { tone: 'info', icon: '•', sr: 'Reported by one source' },
    disagree:     { tone: 'warn', icon: '!', sr: 'Records disagree' },
    unknown:      { tone: 'muted',icon: '–', sr: 'Not available' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function titleish(s) {
    if (!s) return '';
    // Source names arrive in ALL CAPS from county rolls. Title-case for readability,
    // but keep the as-recorded string available in Sources & Verification.
    // Two-letter state codes and common entity suffixes must survive title-casing.
    var KEEP = /^(TX|CO|CA|NY|NC|NV|AZ|UT|OH|IL|MI|WA|MN|MA|MD|PA|FL|TN|NJ|CT|MO|LLC|LP|LLP|LLLP|INC|CORP|LTD|PC|PA|II|III|IV|US|USA|NE|NW|SE|SW|N|S|E|W)$/;
    return String(s).replace(/\b[A-Z][A-Z'&.]*\b/g, function (w) {
      if (KEEP.test(w)) return w;
      return w.charAt(0) + w.slice(1).toLowerCase();
    });
  }
  function fmtNum(v) {
    var n = Number(v);
    return isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 3 }) : String(v || '');
  }
  function fmtDate(d) {
    if (!d) return '';
    var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(d);
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
      .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function year(d) { var m = String(d || '').match(/^(\d{4})/); return m ? m[1] : ''; }

  function disclosure(summaryText, bodyHtml, openByDefault) {
    // <details> is keyboard-accessible and screen-reader-announced with no JS (§24).
    return '<details class="hs-ev-more"' + (openByDefault ? ' open' : '') + '>' +
      '<summary>' + esc(summaryText) + '</summary>' +
      '<div class="hs-ev-more-body">' + bodyHtml + '</div></details>';
  }

  function badge(kind, text) {
    var s = STATUS[kind] || STATUS.unknown;
    // §24 meaning is never carried by colour alone: icon + text + sr-only label.
    return '<span class="hs-ev-badge hs-ev-badge--' + s.tone + '">' +
      '<span aria-hidden="true">' + s.icon + '</span>' +
      '<span class="hs-ev-sr">' + esc(s.sr) + ': </span>' +
      esc(text) + '</span>';
  }

  function propertySection(p) {
    if (!p) return '';
    var primary = (p.identifiers || []).filter(function (i) { return i.primary; })[0]
               || (p.identifiers || [])[0];
    var secondary = (p.identifiers || []).filter(function (i) { return i !== primary; });
    var h = '<section class="hs-ev-sec"><h3 class="hs-ev-h">Property</h3>';
    if (p.situs) h += '<p class="hs-ev-lede">' + esc(titleish(p.situs)) + '</p>';
    h += '<dl class="hs-ev-dl">';
    // §10 the jurisdiction's own term, never "APN"
    if (primary) {
      h += '<dt>' + esc(primary.label) + '</dt><dd>' + esc(primary.value) + '</dd>';
    }
    if (p.acreage && p.acreage.value) {
      var unit = p.acreage.unit === 'sqft' ? 'sq ft' : (p.acreage.unit || '');
      h += '<dt>Parcel area</dt><dd>' + esc(fmtNum(p.acreage.value)) + ' ' + esc(unit) + '</dd>';
    }
    h += '</dl>';

    // §12 long legal descriptions live behind a disclosure, never on the face of the card
    var detail = '<dl class="hs-ev-dl">';
    if (p.legal_description) {
      detail += '<dt>Legal description</dt><dd class="hs-ev-legal">' + esc(p.legal_description) + '</dd>';
    }
    if (p.classification && p.classification.length) {
      detail += '<dt>Classification</dt><dd>' + esc(p.classification.join(' · ')) + '</dd>';
    }
    secondary.forEach(function (i) {
      detail += '<dt>' + esc(i.label) + '</dt><dd>' + esc(i.value) + '</dd>';
    });
    // §11 other measurements are retained and labelled, never silently substituted
    (p.acreage_alternates || []).forEach(function (a) {
      var u = a.unit === 'sqft' ? 'sq ft' : (a.unit || '');
      detail += '<dt>Other reported measurement</dt><dd>' + esc(fmtNum(a.value)) + ' ' + esc(u) +
                ' <span class="hs-ev-dim">(' + esc(a.measurement) + ')</span></dd>';
    });
    detail += '</dl>';
    if (detail.indexOf('<dt>') > -1) h += disclosure('Property details', detail);
    return h + '</section>';
  }

  function ownershipSection(o) {
    if (!o || !o.owner) return '';
    var h = '<section class="hs-ev-sec"><h3 class="hs-ev-h">' + esc(o.role_label) + '</h3>';
    h += '<p class="hs-ev-owner">' + esc(titleish(o.owner)) + '</p>';
    h += '<p class="hs-ev-status">' + badge(o.status_kind, o.status) + '</p>';
    if (o.role_caveat) {
      h += '<p class="hs-ev-caveat">' + esc(o.role_caveat) + '</p>';
    }
    // §18 a disagreement is surfaced, never silently arbitrated
    if (o.status_kind === 'disagree') {
      h += '<p class="hs-ev-warn">County records name different parties for the same period. ' +
           'Both records are listed under Sources &amp; verification.</p>';
    }
    return h + '</section>';
  }

  function instrumentsSection(list, note) {
    list = list || [];
    if (!list.length && !note) return '';
    var h = '<section class="hs-ev-sec"><h3 class="hs-ev-h">Recorded instruments</h3>';
    // §13 never claim a complete ownership chronology
    h += '<p class="hs-ev-dim">Individual recorded documents. This is not a complete ownership history.</p>';
    if (note) h += '<p class="hs-ev-note">' + esc(note) + '</p>';
    if (list.length) {
      var head = list.slice(0, 2), rest = list.slice(2);
      h += '<ul class="hs-ev-list">' + list_items(head) + '</ul>';
      if (rest.length) {
        h += disclosure('Show ' + rest.length + ' earlier instrument' + (rest.length > 1 ? 's' : ''),
                        '<ul class="hs-ev-list">' + list_items(rest) + '</ul>');
      }
    }
    return h + '</section>';
  }

  function list_items(list) {
    var h = '';
    list.forEach(function (r) {
        h += '<li class="hs-ev-item">';
        h += '<div class="hs-ev-item-head"><span class="hs-ev-yr">' + esc(year(r.recording_date)) + '</span>' +
             '<span class="hs-ev-doc">' + esc(r.document_type || 'Recorded instrument') + '</span></div>';
        if (r.parties_available) {
          var ge = (r.grantee || []).map(function (g) { return titleish(g.party); }).join(', ');
          var gr = (r.grantor || []).map(function (g) { return titleish(g.party); }).join(', ');
          h += '<div class="hs-ev-parties">';
          if (gr) h += '<div><span class="hs-ev-role">Grantor</span> ' + esc(gr) + '</div>';
          if (ge) h += '<div><span class="hs-ev-role">Grantee</span> ' + esc(ge) + '</div>';
          h += '</div>';
        } else {
          h += '<div class="hs-ev-dim">Parties not available from this source.</div>';
        }
        h += '<div class="hs-ev-meta">No. ' + esc(r.instrument_number || '—') +
             (r.recording_date ? ' · Recorded ' + esc(fmtDate(r.recording_date)) : '') + '</div>';
        h += '</li>';
    });
    return h;
  }

  function developmentSection(list) {
    list = list || [];
    if (!list.length) return '';
    var h = '<section class="hs-ev-sec"><h3 class="hs-ev-h">Development activity</h3>';
    if (list[0] && list[0].owner_role_caveat) {
      h += '<p class="hs-ev-caveat">' + esc(list[0].owner_role_caveat) + '</p>';
    }
    // Newest filings first, so the most recent activity is on the face of the card.
    var ordered = list.slice().sort(function (a, b) {
      return String(b.project_number || '').localeCompare(String(a.project_number || ''));
    });
    var dHead = ordered.slice(0, 3), dRest = ordered.slice(3);
    h += '<ul class="hs-ev-list">' + dev_items(dHead) + '</ul>';
    if (dRest.length) {
      h += disclosure('Show ' + dRest.length + ' more filing' + (dRest.length > 1 ? 's' : ''),
                      '<ul class="hs-ev-list">' + dev_items(dRest) + '</ul>');
    }
    return h + '</section>';
  }

  function dev_items(list) {
    var h = '';
    list.forEach(function (d) {
      h += '<li class="hs-ev-item">';
      h += '<div class="hs-ev-item-head"><span class="hs-ev-doc">' +
           esc(d.project_name || d.project_number || 'Project') + '</span></div>';
      if (d.project_owner_as_filed) {
        // §5 never a generic "Owner"
        h += '<div class="hs-ev-parties"><div><span class="hs-ev-role">' +
             esc(d.owner_role_label) + '</span> ' + esc(d.project_owner_as_filed) + '</div></div>';
      }
      h += '<div class="hs-ev-meta">' + esc(d.project_number || '') +
           (d.source ? ' · ' + esc(d.source) : '') + '</div>';
      h += '</li>';
    });
    return h;
  }

  function sourcesSection(card) {
    var body = '';
    var sup = (card.ownership && card.ownership.supporting) || [];
    if (sup.length) {
      body += '<h4 class="hs-ev-h4">Ownership evidence</h4><ul class="hs-ev-srclist">';
      sup.forEach(function (s) {
        body += '<li><strong>' + esc(titleish(s.party)) + '</strong><br>' + esc(s.source) +
                (s.source_record_key ? ' · record ' + esc(s.source_record_key) : '') +
                (s.as_of ? ' · as of ' + esc(fmtDate(s.as_of)) : '') +
                '<br><span class="hs-ev-dim">' + esc(s.evidence) +
                (s.retrieved_at ? ' · retrieved ' + esc(fmtDate(s.retrieved_at)) : '') + '</span></li>';
      });
      body += '</ul>';
    }
    if ((card.unavailable_sources || []).length) {
      body += '<h4 class="hs-ev-h4">Sources checked but unavailable</h4><ul class="hs-ev-srclist">';
      card.unavailable_sources.forEach(function (u) {
        body += '<li>' + esc(u.source) + ' — could not be checked automatically' +
                (u.last_checked ? ' · last attempt ' + esc(fmtDate(u.last_checked)) : '') + '</li>';
      });
      body += '</ul>';
    }
    if ((card.sources || []).length) {
      body += '<h4 class="hs-ev-h4">Contributing sources</h4><ul class="hs-ev-srclist">';
      card.sources.forEach(function (s) {
        body += '<li>' + esc(s.name) + '</li>';
      });
      body += '</ul>';
    }
    if (!body) return '';
    return '<section class="hs-ev-sec">' + disclosure('Sources & verification', body) + '</section>';
  }

  function render(card) {
    if (!card || card.pilot_enabled !== true) return '';   // §22 default OFF
    if (card.found !== true) return '';
    var h = '<div class="hs-ev-card" data-hs-evidence-card="1">';
    h += '<div class="hs-ev-top"><h2 class="hs-ev-title">Property records</h2>' +
         (card.jurisdiction ? '<span class="hs-ev-juris">' + esc(card.jurisdiction) + '</span>' : '') +
         '</div>';
    h += propertySection(card.property);
    h += ownershipSection(card.ownership);
    h += instrumentsSection(card.recorded_instruments, card.recorded_instruments_note);
    h += developmentSection(card.development);
    h += sourcesSection(card);
    return h + '</div>';
  }

  var api = { render: render, _titleish: titleish, _badge: badge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.HS = global.HS || {};
  global.HS.EvidenceCard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
