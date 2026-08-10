/* Company Sustainability Record — the render contract for a DOWNSTREAM enrichment.
 *
 * Everything here reads a payload the identity layer produced. There is no company search, no
 * name matching and no parent inference in this file, and there must never be: identity flows
 * one way, HomeSignal identity -> ESG lookup, never the reverse.
 *
 * The rules this file exists to hold:
 *   • the consumer words are "Company sustainability record", never "ESG score";
 *   • there is NO overall score, letter, colour or average — WikiRate publishes no defensible
 *     overall figure for these companies and HomeSignal is forbidden from inventing one;
 *   • a parent company's record is labelled as the PARENT's and is never presented as a
 *     measurement of the subsidiary or of the facility the reader clicked;
 *   • four availability states stay distinguishable, and none of them is a zero;
 *   • a DISCLOSURE "No" means "not reported in this benchmark", never "performs badly";
 *   • WikiRate attribution rides with every displayed item.
 */
(function () {
  const HS = (window.HS = window.HS || {});
  const esc = (s) => HS.esc ? HS.esc(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // The identity layer's internal states, translated once. A homeowner never sees an enum,
  // and — separately — never sees an FRS-reported company presented as more certain than the
  // identity layer says it is.
  const IDENTITY_WORD = { VERIFIED: 'Verified', HIGH_CONFIDENCE: 'Reported', UNRESOLVED: 'Not yet verified' };

  HS.sustain = {
    // ── availability, as four DISTINCT states (brief §9) ─────────────────────────────────
    // 'unresolved'  the identity layer has no company -> say nothing about sustainability;
    //               "ESG data unavailable" would blame the wrong thing.
    // 'not_checked' we know the company and have not asked yet.
    // 'no_data'     we asked and the sources checked hold nothing usable.
    // 'available'   there is at least one displayable indicator.
    // A zero is never any of these.
    state(company) {
      if (!company || !company.company_name) return 'unresolved';
      const n = (company.indicators || []).length;
      if (n > 0) return 'available';
      const s = company.lookup_status;
      if (!s || s === 'not_checked') return 'not_checked';
      return 'no_data';                    // checked_no_data / ambiguous_rejected / error
    },
    STATE_LINE: {
      unresolved:  'Company identity not yet verified',
      not_checked: 'Sustainability record not yet checked',
      no_data:     'No sustainability data found in the sources checked',
      available:   'Company sustainability information available'
    },
    // Only companies the payload actually carries, split by attribution. The direct company and
    // its parent are two separate answers to two separate questions and are never merged.
    direct(item) {
      const a = item && item.sustainability && item.sustainability.companies;
      return Array.isArray(a) ? a.filter(c => c && c.attribution === 'direct_company') : [];
    },
    parents(item) {
      const a = item && item.sustainability && item.sustainability.companies;
      return Array.isArray(a) ? a.filter(c => c && c.attribution === 'parent_company') : [];
    },
    withData(item) {
      return this.direct(item).concat(this.parents(item))
        .filter(c => (c.indicators || []).length > 0);
    },

    // ── the first-level card: ONE line, and only when something is actually displayable ────
    // No indicators are dumped here (brief §10). The indicator says which KIND of record exists,
    // because "the parent company reports this" is a materially different claim.
    indicatorHTML(item) {
      const withData = this.withData(item);
      if (!withData.length) return '';
      const anyDirect = withData.some(c => c.attribution === 'direct_company');
      const line = anyDirect
        ? 'Company sustainability information available'
        : 'Parent-company sustainability information available';
      return '<p class="susind"><span class="susdot" aria-hidden="true"></span>' + esc(line) + '</p>';
    },

    // ── the detail view ────────────────────────────────────────────────────────────────────
    identityWord(c) { return IDENTITY_WORD[String((c && c.identity_verification) || '').toUpperCase()] || ''; },

    // A disclosure answer is about REPORTING, and the wording has to say so. "Waste reduction
    // target: No" reads as a verdict on the company's waste performance; it is not one.
    valueLine(ind) {
      const v = String((ind && ind.value) || '');
      if (ind && ind.kind === 'disclosure') {
        if (/^(no|not specified|not applicable)$/i.test(v)) return 'Not reported in this benchmark';
        if (/^partially$/i.test(v)) return 'Partly reported in this benchmark';
        if (/^yes$/i.test(v)) return 'Reported';
      }
      return v;
    },
    DISCLOSURE_NOTE: 'These lines record what the company reported to a public benchmark. '
      + '"Not reported" means the benchmark did not find a disclosure — it is not a measurement '
      + 'of how the company performs.',
    PARENT_NOTE: 'This information applies to the parent company and is not a measurement of '
      + 'this individual facility.',

    indicatorsHTML(c) {
      const rows = (c && c.indicators) || [];
      if (!rows.length) return '';
      return '<ul class="suslist">' + rows.map(i =>
        '<li><span class="sustopic">' + esc(i.topic) + '</span>'
        + '<span class="suslabel">' + esc(i.label) + '</span>'
        + '<span class="susval">' + esc(this.valueLine(i))
        + (i.year ? ' <span class="susyr">(' + esc(i.year) + ')</span>' : '') + '</span></li>'
      ).join('') + '</ul>';
    },

    companyHTML(c) {
      const isParent = c.attribution === 'parent_company';
      const head = isParent ? 'Parent-company sustainability record' : 'Company sustainability record';
      const word = this.identityWord(c);
      const rows = [
        [isParent ? 'Parent company' : 'Company', c.company_name],
        [isParent ? 'Parent of' : 'Role', isParent ? (c.parent_of_name || '') : c.role],
        ['Source', c.source || 'WikiRate']
      ].filter(r => r[1]);
      const anyDisclosure = (c.indicators || []).some(i => i.kind === 'disclosure');
      return '<div class="sussec"><h5>' + esc(head) + '</h5>'
        + '<div class="susmeta">' + rows.map(r =>
            '<div class="row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1])
            + (r[0] === 'Company' && word ? ' <span class="pver ' + (word === 'Verified' ? 'verified' : 'reported')
                + '">' + (word === 'Verified' ? '✓ ' : '') + esc(word) + '</span>' : '')
            + '</b></div>').join('') + '</div>'
        + this.indicatorsHTML(c)
        + (isParent ? '<p class="ihint">' + esc(this.PARENT_NOTE) + '</p>' : '')
        + (anyDisclosure ? '<p class="ihint">' + esc(this.DISCLOSURE_NOTE) + '</p>' : '')
        + '</div>';
    },

    detailHTML(item) {
      const withData = this.withData(item);
      if (!withData.length) return '';
      return withData.map(c => this.companyHTML(c)).join('');
    },

    // Evidence for the Sources & verification disclosure. Every displayed item keeps its
    // company, its direct-vs-parent attribution, the metric, the value, the reporting year, the
    // per-answer URL, the retrieval date, and the WikiRate attribution the licence requires.
    evidenceEntries(item) {
      const out = [];
      this.withData(item).forEach(c => {
        (c.indicators || []).forEach(i => {
          out.push({
            role: (c.attribution === 'parent_company' ? 'Parent-company sustainability' : 'Company sustainability')
                  + ' — ' + i.topic,
            entity: c.company_name, status: 'Reported', tone: 'reported',
            org: 'WikiRate',
            document: [i.metric_designer + ' — ' + i.metric_name,
                       'value: ' + i.value,
                       i.year ? 'reporting year ' + i.year : '',
                       'listed on WikiRate as "' + (c.external_company_name || c.company_name) + '"',
                       i.attribution_note].filter(Boolean).join(' · '),
            url: i.answer_url || 'https://wikirate.org/', filed: '',
            retrieved: i.retrieved_at || '',
            note: c.attribution === 'parent_company' ? this.PARENT_NOTE : null
          });
        });
      });
      return out;
    }
  };
})();
