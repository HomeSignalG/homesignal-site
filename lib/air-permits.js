// HomeSignal — the "Air permits & filings" section of a ZIP page (founder requirement 2026-11-21).
//
// One reader, public.air_permits_for_zip (docs/air-permits.sql), answers EVERY ZIP page with one state, and this file
// only renders that answer. It decides nothing about which records belong to a ZIP: membership is the server's polygon test.
//
//   complete      the source's records whose point lies in this ZIP (maybe none), read within its freshness window
//   unavailable   the source is read, but its last complete read is older than its window
//   not_measured  this ZIP has no Census area to place points in
//   not_covered   HomeSignal does not read this state's air-permit records
//   blocked       the agency's list exists but cannot be read by a program; the reason is the agency's own robots.txt etc.
//
// WHAT MAY BE SAID (each rule is pinned by test/air-permits-section.test.mjs):
//   * Only "complete" may say "none", and it names the agency, the permit types the source covers and the day checked.
//     unavailable / blocked / not_covered / not_measured / a failed read NEVER read as "no air permits".
//   * A status word is the agency's own and is printed as the agency wrote it, including "Approved", "Issued" or
//     "Granted" when that is what the agency says. Every record with a status also says the status is for THIS air
//     authorization only, never for the development. This module adds no approval wording of its own.
//   * A renewal, modification or amendment is said to change an EXISTING authorization; it is never counted or worded
//     as new construction. Counts are split: applications and registrations / issued / renewals and changes.
//   * Permitted limits are not measured air quality: the section says so and prints no emission amount.
//   * A person is never named: the server sends "Individual applicant".
//   * Records the source states without a point are counted for the ZIP's county and never placed or guessed.
(function () {
  var HS = window.HS = window.HS || {};
  var CAP = 5;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var KIND_LABEL = {
    application: 'Application', registration: 'Registration', proposed_action: 'Proposed action',
    issued: 'Issued authorization', modification: 'Modification', renewal: 'Renewal', amendment: 'Amendment', other: 'Air permit action'
  };
  var NEW_KINDS = ['application', 'registration', 'proposed_action'];
  var CHANGE_KINDS = ['modification', 'renewal', 'amendment'];
  var STATUS_SCOPE = 'Status applies to this air authorization only, not to the development';
  var NOTE = 'An air authorization is one permit for one activity, not approval of a whole development, and permitted limits are not measured air quality at any home.';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function day(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    if (!m) return '';
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return '';
    return MONTHS[mo - 1] + ' ' + parseInt(m[3], 10) + ', ' + m[1];
  }
  function httpsUrl(u) { return /^https:\/\/[^\s"'<>]+$/.test(String(u || '')) ? String(u) : null; }
  function todayISO(now) { var d = now instanceof Date ? now : new Date(); return d.toISOString().slice(0, 10); }

  var STATES = ['complete', 'unavailable', 'not_measured', 'not_covered', 'blocked'];
  function outcome(body) {
    if (!body || typeof body !== 'object' || STATES.indexOf(body.status) < 0) return 'read_failed';
    if ((body.status === 'complete' || body.status === 'unavailable') && !Array.isArray(body.records)) return 'read_failed';
    return body.status;
  }

  function kindLabel(k) { return KIND_LABEL[k] || KIND_LABEL.other; }
  function number(r) { return r.permit_no || r.project_no || ''; }
  // "Registration 185303" — the record kind and number only; the agency's status word is shown beside it, never invented here.
  function title(r) { return kindLabel(r.action_kind) + (number(r) ? ' ' + number(r) : ''); }

  // What the action means for the reader, in one clause. Applications and registrations claim nothing about the
  // outcome; renewals/changes say they concern an existing authorization.
  function meaning(r) {
    if (r.action_kind === 'renewal') return 'Renewal of an existing authorization, not a new project';
    if (r.action_kind === 'modification' || r.action_kind === 'amendment') return 'Changes an existing authorization';
    return '';
  }
  // Public comment, only when the source states a deadline. 'now' is injectable so the rule is testable.
  function commentLine(r, now) {
    if (!r.comment_until || !day(r.comment_until)) return '';
    return r.comment_until >= todayISO(now) ? 'Public comment open until ' + day(r.comment_until)
                                            : 'Public comment period ended ' + day(r.comment_until);
  }
  function facilityLine(r) {
    if (!r.facility_name && !r.facility_ref) return '';
    return 'Facility: ' + (r.facility_name || '') + (r.facility_ref ? (r.facility_name ? ' ' : '') + '(' + r.facility_ref + ')' : '');
  }
  function datesLine(r) {
    var p = [];
    if (r.received_on && day(r.received_on)) p.push('Received ' + day(r.received_on));
    if (r.action_on && day(r.action_on)) p.push('Action ' + day(r.action_on));
    if (r.effective_on && day(r.effective_on)) p.push('Effective ' + day(r.effective_on));
    if (r.expires_on && day(r.expires_on)) p.push('Expires ' + day(r.expires_on));
    return p.join(' · ');
  }
  function locationLine(r) {
    if (r.location_basis === 'geocoded_address') return 'Location placed from the facility address; approximate';
    if (r.location_basis === 'reviewed_point') return 'Location set by a HomeSignal reviewer from the agency’s directions; approximate';
    return '';
  }
  // Counts that keep renewals out of the "new" number.
  function counts(records) {
    var c = { total: 0, new_filings: 0, issued: 0, changes: 0, other: 0 };
    (records || []).forEach(function (r) {
      c.total++;
      if (NEW_KINDS.indexOf(r.action_kind) >= 0) c.new_filings++;
      else if (r.action_kind === 'issued') c.issued++;
      else if (CHANGE_KINDS.indexOf(r.action_kind) >= 0) c.changes++;
      else c.other++;
    });
    return c;
  }
  function countsLine(c) {
    var p = [];
    if (c.new_filings) p.push(c.new_filings + (c.new_filings === 1 ? ' application or registration' : ' applications or registrations'));
    if (c.issued) p.push(c.issued + ' issued');
    if (c.changes) p.push(c.changes + (c.changes === 1 ? ' renewal or change' : ' renewals or changes'));
    if (c.other) p.push(c.other + ' other');
    return p.join(', ');
  }

  function recordCard(r, now) {
    var url = httpsUrl(r.record_url);
    var facts = [facilityLine(r), r.applicant ? 'Applicant: ' + r.applicant : '', r.permit_type, meaning(r), r.status ? STATUS_SCOPE : '',
                 commentLine(r, now), datesLine(r), locationLine(r)].filter(Boolean);
    var tag = url ? 'a' : 'div';
    return '<' + tag + ' class="card mini' + (url ? ' clickable card-link' : '') + '"'
      + (url ? ' href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"' : '')
      + ' style="border-left-color:#5b6b7a;margin-bottom:10px' + (url ? ';display:block;text-decoration:none;color:inherit' : '') + '"'
      + ' data-air-permit="' + esc(r.record_id || number(r)) + '">'
      + '<span class="lens">Air permits &amp; filings' + (r.status ? ' · Agency status: ' + esc(r.status) : '') + '</span>'
      + '<h3>' + esc(title(r)) + '</h3>'
      + (facts.length ? '<p class="sowhat">' + facts.map(esc).join(' · ') + '</p>' : '')
      + (url ? '<p class="sowhat" style="margin-top:4px">Official record ▸</p>' : '')
      + '</' + tag + '>';
  }
  function quiet(text) { return '<div class="quiet" style="margin-bottom:10px;font-size:12.5px">' + esc(text) + '</div>'; }

  function coverageLine(body) {
    var types = Array.isArray(body.permit_types) && body.permit_types.length ? body.permit_types.join('; ') : '';
    return types ? 'Covers: ' + types + '.' : '';
  }

  function sectionHTML(body, now) {
    var o = outcome(body);
    var agency = (body && body.agency) || 'The state agency';
    var checked = body && day(body.checked_at);
    var records = (o === 'complete' || o === 'unavailable') ? body.records : [];
    var n = records.length;
    var head = '<h2 class="bt">Air permits &amp; filings'
      + ((o === 'complete' || (o === 'unavailable' && n)) ? ' <span class="gc">— ' + n + (n === 1 ? ' record' : ' records') + '</span>' : '') + '</h2>';
    var html;
    if (o === 'read_failed') {
      html = quiet('Air permits and filings could not be read just now.');
    } else if (o === 'not_covered') {
      html = quiet('HomeSignal does not read ' + ((body.state_name && body.state_name + '’s') || 'this state’s') + ' air-permit records yet. That says nothing about whether permits exist here.');
    } else if (o === 'blocked') {
      html = quiet(agency + '’s air-permit list cannot be read by HomeSignal yet, so air permits in this ZIP are unknown, not absent.');
    } else if (o === 'not_measured') {
      html = quiet('This ZIP has no mapped Census area, so ' + agency + '’s air permits cannot be placed on it.');
    } else {
      var cards = records.slice(0, CAP).map(function (r) { return recordCard(r, now); }).join('');
      var more = n > CAP ? quiet('Showing ' + CAP + ' of ' + n + '. The rest are in ' + agency + '’s records.') : '';
      var summary = n ? quiet(countsLine(counts(records)) + '.') : '';
      var cov = coverageLine(body);
      var note;
      if (o === 'complete') {
        note = (n ? 'Air-permit records in ' + agency + '’s list whose point lies in this ZIP'
                  : 'No air-permit records in ' + agency + '’s list lie in this ZIP')
          + (checked ? (n ? ', checked ' : '. Checked ') + checked : '') + '.' + (cov ? ' ' + cov : '');
      } else {
        note = (n ? agency + '’s list could not be refreshed on the last check; these were last confirmed ' + (checked || 'earlier') + '.'
                  : agency + '’s air-permit list could not be read on the last check, so this ZIP’s records are unknown.')
          + (cov ? ' ' + cov : '');
      }
      var unloc = Number(body.unlocated_in_county) > 0
        ? quiet(body.unlocated_in_county + (body.unlocated_in_county === 1 ? ' more record' : ' more records')
                + ' in this county ' + (body.unlocated_in_county === 1 ? 'is' : 'are') + ' listed without a location and could not be placed on a map.') : '';
      html = summary + cards + more + quiet(note) + unloc + (n ? quiet(NOTE) : '');
    }
    return '<div class="block" id="zip-air-permits" data-air-permits-state="' + esc(o) + '">' + head + html + '</div>';
  }

  function load(zip) {
    if (!/^\d{5}$/.test(String(zip || ''))) return Promise.resolve(null);
    var cfg = window.HS_CONFIG || {};
    if ((cfg.DATA_SOURCE || 'seed') === 'seed') return Promise.resolve((window.HS_SEED && window.HS_SEED.air_permits) || null);
    if (!HS.sb || !HS.sb()) return Promise.resolve(null);
    return HS.sb().rpc('air_permits_for_zip', { p_zip: String(zip) })
      .then(function (res) { return res && !res.error ? res.data : null; }, function () { return null; });
  }

  HS.airPermits = {
    load: load, sectionHTML: sectionHTML, outcome: outcome, day: day, CAP: CAP, NOTE: NOTE, STATUS_SCOPE: STATUS_SCOPE,
    title: title, kindLabel: kindLabel, meaning: meaning, commentLine: commentLine, facilityLine: facilityLine,
    datesLine: datesLine, locationLine: locationLine, counts: counts, countsLine: countsLine, coverageLine: coverageLine
  };
})();
