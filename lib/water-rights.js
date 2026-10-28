// HomeSignal — the "Water rights filings" section of a ZIP page (founder decision 2026-10-28).
//
// One reader, public.water_rights_for_zip (docs/state-water-rights.sql), answers EVERY ZIP page
// with one of four states, and this file only renders that answer. It decides nothing about which
// filings belong to a ZIP: membership is the server's polygon test.
//
//   complete      the state's pending applications whose point lies in this ZIP (maybe none)
//   unavailable   the state is read, but its last complete load is older than 48 hours
//   not_measured  the state is read, but this ZIP has no Census area to place points in
//   not_covered   HomeSignal does not read this state's water-rights records
//
// WHAT MAY BE SAID. "not_covered" is about US, never about the state: most states were not
// checked, so the page never says a state publishes nothing. "complete" with no filings is the
// only absence sentence, and it names the agency and the day the records were checked. A status
// word is the agency's own; a use is shown only when it is a word (Utah publishes letter codes
// such as "OP", which this page does not decode). A person is never named: the server sends
// "Individual applicant" for anyone who is not an organisation.
(function () {
  var HS = window.HS = window.HS || {};
  var CAP = 5;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // "2026-10-15" or an ISO timestamp -> "Oct 15, 2026" (UTC; a date-only value is never shifted).
  function day(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    if (!m) return '';
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return '';
    return MONTHS[mo - 1] + ' ' + parseInt(m[3], 10) + ', ' + m[1];
  }
  function httpsUrl(u) { return /^https:\/\/[^\s"'<>]+$/.test(String(u || '')) ? String(u) : null; }
  function wordUses(u) { return /[A-Za-z]{4,}/.test(String(u || '')) ? String(u) : ''; }

  var STATES = ['complete', 'unavailable', 'not_measured', 'not_covered'];
  // The page's one reading of a reader answer. Anything malformed is a failed read, never "none".
  function outcome(body) {
    if (!body || typeof body !== 'object' || STATES.indexOf(body.status) < 0) return 'read_failed';
    if ((body.status === 'complete' || body.status === 'unavailable') && !Array.isArray(body.filings)) return 'read_failed';
    return body.status;
  }

  function filingCard(f) {
    var url = httpsUrl(f.record_url);
    var title = (f.filing_type ? f.filing_type + ' ' : 'Filing ') + (f.filing_no || '');
    var facts = [];
    if (f.applicant) facts.push(f.applicant);
    if (f.diversion) facts.push(f.diversion);
    var uses = wordUses(f.uses);
    if (uses) facts.push('Use: ' + uses);
    if (f.filed_on && day(f.filed_on)) facts.push((f.date_label || 'Date') + ' ' + day(f.filed_on));
    if (f.right_no) facts.push('Changes right ' + f.right_no);
    var tag = url ? 'a' : 'div';
    return '<' + tag + ' class="card mini' + (url ? ' clickable card-link' : '') + '"'
      + (url ? ' href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"' : '')
      + ' style="border-left-color:var(--teal,#0e7c86);margin-bottom:10px' + (url ? ';display:block;text-decoration:none;color:inherit' : '') + '"'
      + ' data-water-right="' + esc(f.filing_no || '') + '">'
      + '<span class="lens">Water rights' + (f.status ? ' · Agency status: ' + esc(f.status) : '') + '</span>'
      + '<h3>' + esc(title) + '</h3>'
      + (facts.length ? '<p class="sowhat">' + facts.map(esc).join(' · ') + '</p>' : '')
      + (url ? '<p class="sowhat" style="margin-top:4px">Official record ▸</p>' : '')
      + '</' + tag + '>';
  }

  function quiet(text) {
    return '<div class="quiet" style="margin-bottom:10px;font-size:12.5px">' + esc(text) + '</div>';
  }

  // The whole section for one reader answer (or null/undefined for a failed read).
  function sectionHTML(body) {
    var o = outcome(body);
    var agency = (body && body.agency) || 'The state agency';
    var checked = body && day(body.checked_at);
    var filings = (o === 'complete' || o === 'unavailable') ? body.filings : [];
    var n = filings.length;
    var head = '<h2 class="bt">Water rights filings'
      + ((o === 'complete' || (o === 'unavailable' && n)) ? ' <span class="gc">— ' + n + (n === 1 ? ' pending application' : ' pending applications') + '</span>' : '')
      + '</h2>';
    var bodyHtml;
    if (o === 'read_failed') {
      bodyHtml = quiet('Water-rights filings could not be read just now.');
    } else if (o === 'not_covered') {
      bodyHtml = quiet('HomeSignal does not read ' + ((body.state_name && body.state_name + '’s') || 'this state’s') + ' water-rights records yet.');
    } else if (o === 'not_measured') {
      bodyHtml = quiet('This ZIP has no mapped Census area, so ' + agency + '’s filings cannot be placed on it.');
    } else {
      var cards = filings.slice(0, CAP).map(filingCard).join('');
      var more = n > CAP ? quiet('Showing ' + CAP + ' of ' + n + '. The rest are in ' + agency + '’s records.') : '';
      var note;
      if (o === 'complete') {
        note = n
          ? 'Pending applications in ' + agency + '’s records whose point lies in this ZIP' + (checked ? ', checked ' + checked : '') + '.'
          : 'No pending water-rights applications in ' + agency + '’s records lie in this ZIP.' + (checked ? ' Checked ' + checked + '.' : '');
      } else {
        note = n
          ? agency + '’s records could not be refreshed on the last check' + (checked ? '; these were last confirmed ' + checked : '') + '.'
          : agency + '’s water-rights records could not be read on the last check, so this ZIP’s filings are unknown.';
      }
      bodyHtml = cards + more + quiet(note);
    }
    return '<div class="block" id="zip-water-rights" data-water-rights-state="' + esc(o) + '">' + head + bodyHtml + '</div>';
  }

  // The read. A failed request returns null, which sectionHTML renders as a failed read.
  // The seed preview (DATA_SOURCE 'seed', the same test lib/data.js uses) makes no database call:
  // it shows HS_SEED.water_rights when the seed carries one, else a failed read.
  function load(zip) {
    if (!/^\d{5}$/.test(String(zip || ''))) return Promise.resolve(null);
    var cfg = window.HS_CONFIG || {};
    if ((cfg.DATA_SOURCE || 'seed') === 'seed') return Promise.resolve((window.HS_SEED && window.HS_SEED.water_rights) || null);
    if (!HS.sb || !HS.sb()) return Promise.resolve(null);
    return HS.sb().rpc('water_rights_for_zip', { p_zip: String(zip) })
      .then(function (res) { return res && !res.error ? res.data : null; }, function () { return null; });
  }

  HS.waterRights = { load: load, sectionHTML: sectionHTML, outcome: outcome, day: day, CAP: CAP };
})();
