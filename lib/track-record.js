// HomeSignal — Company & Developer Track Record (Del Valle pilot).
//
// Pure formatters for app_project_track_record(). No prose lives in the pages; no judgement
// is ever formed here. The rules this module exists to enforce:
//
//   1. THREE LEVELS NEVER MERGE. What happened at the facility the user clicked, what
//      happened at other facilities of the resolved company, and what belongs to the
//      verified parent are three separate statements and are labelled as such.
//   2. NO COLLAPSED COUNTS. An inspection is not a violation, a notice of violation is not
//      an enforcement order, and an order is not a penalty. Every count names the agency's
//      own record class. There is deliberately no total.
//   3. ABSENCE IS REPORTED AS ABSENCE. "No records found in the sources checked" — never
//      "no violations", which claims something the query cannot support.
//   4. NO GRADE. No score, no colour rating, no good/bad/clean/safe wording. The dates and
//      the record classes are the output; the reader draws the conclusion.
(function () {
  const HS = (typeof window !== 'undefined') ? (window.HS = window.HS || {}) : {};
  const esc = HS.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  // The agency's own record classes, in the order a reader should meet them: what an
  // inspector wrote up, what the agency escalated, what an order imposed.
  const RECORD = {
    inspection:           { one: 'inspection', many: 'inspections' },
    notice_of_violation:  { one: 'notice of violation', many: 'notices of violation' },
    notice_of_enforcement:{ one: 'notice of enforcement', many: 'notices of enforcement' },
    administrative_order: { one: 'administrative order', many: 'administrative orders' },
    civil_judgment:       { one: 'civil judgment', many: 'civil judgments' },
    compliance_summary:   { one: 'compliance summary', many: 'compliance summaries' }
  };
  const ORDER = ['inspection', 'notice_of_violation', 'notice_of_enforcement',
                 'administrative_order', 'civil_judgment', 'compliance_summary'];

  function recordLabel(type, n) {
    const r = RECORD[type];
    if (!r) return String(type || '').replace(/_/g, ' ');
    return n === 1 ? r.one : r.many;
  }
  function year(d) { const m = /^(\d{4})/.exec(String(d || '')); return m ? m[1] : ''; }
  function span(oldest, newest) {
    const a = year(oldest), b = year(newest);
    if (!a && !b) return '';
    return a === b ? a : a + '–' + b;
  }
  function money(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '';
    return '$' + Number(n).toLocaleString('en-US');
  }
  function sortCounts(list) {
    return (list || []).slice().sort((x, y) => ORDER.indexOf(x.type) - ORDER.indexOf(y.type));
  }

  // One sourced line per record class. Never a total, never an adjective.
  //   "12 notices of violation at 11 facilities, 2021–2026"
  //   "1 administrative order, 2021 — $6,750 assessed"
  function countLines(counts) {
    return sortCounts(counts).map(c => {
      const n = Number(c.count) || 0;
      let s = n + ' ' + recordLabel(c.type, n);
      if (c.facilities > 0) s += ' at ' + c.facilities + ' ' + (c.facilities === 1 ? 'facility' : 'facilities');
      const sp = span(c.oldest, c.newest);
      if (sp) s += ', ' + sp;
      if (c.penalties != null && Number(c.penalties) > 0) s += ' — ' + money(c.penalties) + ' assessed';
      return { type: c.type, text: s, count: n };
    });
  }

  // What the card's compact indicator may claim. Only true when real records exist.
  function availability(tr) {
    const cs = (tr && tr.companies) || [];
    const fac = (tr && tr.facility && tr.facility.events) || [];
    let env = fac.length > 0;
    cs.forEach(c => {
      if ((c.record_counts || []).length) env = true;
      if (c.parent && (c.parent.record_counts || []).length) env = true;
    });
    return {
      environmental: env,
      // OSHA is deliberately absent: its establishment name is free text with no company
      // identifier, so nothing in this pilot can claim a safety record.
      safety: false,
      any: env
    };
  }

  // Did we actually look? Used to tell "nothing found" apart from "not checked".
  function checkedSummary(checked) {
    const rows = checked || [];
    if (!rows.length) return '';
    const names = Array.from(new Set(rows.map(r => r.agency + ' ' + r.dataset)));
    return 'Checked: ' + names.join('; ') + '.';
  }
  const NOTHING_FOUND = 'No records found in the sources checked.';
  // Not the same statement, and the difference matters: one says we looked, the other says
  // we have not. Printing "no records found" for a company nobody queried would be the
  // false-clean claim this whole layer exists to avoid.
  const NOT_CHECKED = 'Not yet checked in this pilot.';

  function eventLine(e) {
    const bits = [];
    const n = Number(e.violation_count);
    bits.push(recordLabel(e.type, 1).replace(/^./, ch => ch.toUpperCase()));
    if (e.date) bits.push(HS.fmtDate ? HS.fmtDate(e.date) : e.date);
    let s = bits.join(' · ');
    if (e.facility) s += ' — ' + e.facility;
    const tail = [];
    if (n > 0) tail.push(n + ' ' + (n === 1 ? 'violation' : 'violations') + ' cited by the agency');
    if (e.penalty != null && Number(e.penalty) > 0) tail.push(money(e.penalty) + ' assessed');
    if (e.program) tail.push(e.program);
    return { head: s, tail: tail.join(' · ') };
  }

  HS.track = {
    RECORD_TYPES: ORDER.slice(),
    NOTHING_FOUND,
    NOT_CHECKED,
    recordLabel, span, money, countLines, availability, checkedSummary, eventLine,

    // "Environmental records available" — and nothing else, unless it is true.
    indicatorHTML(tr) {
      const a = this.availability(tr);
      if (!a.any) return '';
      const items = [];
      if (a.environmental) items.push('Environmental records available');
      if (a.safety) items.push('Safety records available');
      return '<div class="trind">'
        + items.map(t => '<span class="trbit">' + esc(t) + '</span>').join('')
        + '</div>';
    },

    // The detail section. Facility first — it is the thing the user clicked — then each
    // resolved company, with its verified parent nested inside it.
    detailHTML(tr) {
      if (!tr) return '';
      const out = [];
      const fac = tr.facility || {};
      const facEvents = fac.events || [];
      out.push('<div class="trsec"><h5>This facility</h5>'
        + (facEvents.length
            ? '<ul class="trlist">' + facEvents.map(e => {
                const l = this.eventLine(e);
                return '<li><span class="trh">' + esc(l.head) + '</span>'
                  + (l.tail ? '<span class="trt">' + esc(l.tail) + '</span>' : '')
                  + (e.url ? ' <a href="' + esc(e.url) + '" target="_blank" rel="noopener">record ▸</a>' : '')
                  + '</li>';
              }).join('') + '</ul>'
            : '<p class="trnone">'
                + esc((fac.checked && fac.checked.length) ? NOTHING_FOUND : NOT_CHECKED) + '</p>')
        + (fac.checked && fac.checked.length
            ? '<p class="trchk">' + esc(this.checkedSummary(fac.checked)) + '</p>' : '')
        + '</div>');

      (tr.companies || []).forEach(c => {
        out.push('<div class="trsec"><h5>' + esc(c.role) + ' — ' + esc(c.name) + '</h5>'
          + this.companyBodyHTML(c, 'other facilities operated by this company')
          + (c.parent ? '<div class="trparent"><h6>Parent company — ' + esc(c.parent.name)
              + ' <span class="pver verified">✓ Verified</span></h6>'
              + '<p class="trnote">These records belong to the parent company and did not happen at '
              + 'the facility above, or at this company\'s own facilities.</p>'
              + this.companyBodyHTML(c.parent, 'facilities of the parent company') + '</div>' : '')
          + '</div>');
      });
      return out.join('');
    },

    companyBodyHTML(c, whatFacilitiesAre) {
      const f = c.facilities || {};
      const lines = this.countLines(c.record_counts);
      const parts = [];
      if (f.count) {
        parts.push('<p class="trfac"><b>' + f.count + '</b> ' + esc(whatFacilitiesAre)
          + (f.counties ? ' across ' + f.counties + ' ' + (f.counties === 1 ? 'county' : 'counties') : '')
          + (f.state ? ' in ' + esc(f.state) : '') + '.'
          + (f.open != null && f.open !== f.count
              ? ' <span class="trt">' + f.open + ' still listed as an open affiliation.</span>' : '')
          + '</p>');
      }
      if (lines.length) {
        parts.push('<ul class="trlist tight">' + lines.map(l => '<li>' + esc(l.text) + '</li>').join('') + '</ul>');
      } else {
        const looked = (c.checked || []).length > 0 || (c.facilities && c.facilities.count > 0);
        parts.push('<p class="trnone">' + esc(looked ? NOTHING_FOUND : NOT_CHECKED) + '</p>');
      }
      if ((c.checked || []).length) parts.push('<p class="trchk">' + esc(this.checkedSummary(c.checked)) + '</p>');
      return parts.join('');
    },

    // Evidence rows for Sources & verification: every material claim, inspectable.
    evidenceEntries(tr) {
      const out = [];
      if (!tr) return out;
      ((tr.facility && tr.facility.checked) || []).forEach(c => {
        out.push({
          role: 'This facility — ' + c.dataset, entity: c.agency,
          status: c.found > 0 ? (c.found + ' record' + (c.found === 1 ? '' : 's') + ' found') : 'No records found',
          tone: 'verified', org: c.agency, document: c.basis, url: c.url || '',
          filed: '', retrieved: c.checked_at || '',
          note: c.found > 0 ? null : 'Checked and returned nothing. That is an absence in this dataset, not a finding of compliance.'
        });
      });
      (tr.companies || []).forEach(c => {
        const f = c.facilities || {};
        if (f.count) {
          out.push({
            role: c.role + ' — other facilities', entity: c.name,
            status: f.count + ' facilities', tone: 'verified', org: 'TCEQ',
            document: f.basis, url: f.url || '', filed: '', retrieved: ''
          });
        }
        (c.events || []).forEach(e => out.push(this.eventEvidence(e, c.role + ' — ' + c.name)));
        if (c.parent) {
          const pf = c.parent.facilities || {};
          if (pf.count) {
            out.push({
              role: 'Parent company — facilities', entity: c.parent.name,
              status: pf.count + ' facilities', tone: 'verified', org: 'TCEQ',
              document: pf.basis, url: pf.url || '', filed: '', retrieved: '',
              note: 'Parent-company information. These are not facilities of ' + c.name + '.'
            });
          }
          (c.parent.events || []).forEach(e =>
            out.push(this.eventEvidence(e, 'Parent company — ' + c.parent.name)));
        }
      });
      return out;
    },

    eventEvidence(e, who) {
      const l = this.eventLine(e);
      return {
        role: who, entity: l.head + (l.tail ? ' (' + l.tail + ')' : ''),
        status: e.evidence === 'VERIFIED' ? 'Verified' : 'Reported',
        tone: e.evidence === 'VERIFIED' ? 'verified' : 'reported',
        org: e.agency === 'TCEQ' ? 'Texas Commission on Environmental Quality (TCEQ)' : e.agency,
        document: [e.facility_ref, e.citations, e.penalty_note].filter(Boolean).join(' · '),
        url: e.url || '', filed: e.date || '', retrieved: '',
        note: e.attributed_entity && e.attributed_entity !== null
          ? 'Recorded by the agency against "' + e.attributed_entity + '". ' + (e.note || '')
          : (e.note || null)
      };
    }
  };
})();
