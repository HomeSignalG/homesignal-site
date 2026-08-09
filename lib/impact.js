// HomeSignal project-card impact line — one homeowner-focused sentence derived
// deterministically from fields already on the project record. Never invents
// effects that aren't supported by impact_dimensions or lifecycle metadata.
(function () {
  const HS = (window.HS = window.HS || {});

  function joinLabels(labels) {
    if (!labels.length) return '';
    if (labels.length === 1) return labels[0];
    return labels[0] + ' and ' + labels[1];
  }

  function statusKey(status) {
    return String(status || '').trim().toLowerCase();
  }

  function withDistPrefix(sentence, dist) {
    if (!dist) return sentence;
    const prefix = 'About ' + dist + ' from your home, ';
    const out = prefix + sentence.charAt(0).toLowerCase() + sentence.slice(1);
    return out.length <= 140 ? out : sentence;
  }

  // Upper bound only — a complete sentence is never padded to reach a floor.
  function capLength(sentence) {
    let s = String(sentence || '').replace(/\s+/g, ' ').trim();
    if (s.length > 140) s = s.slice(0, 137).replace(/\s+\S*$/, '') + '…';
    return s;
  }

  function fitLength(sentence, dist) {
    let s = String(sentence || '').replace(/\s+/g, ' ').trim();
    if (!s) return s;
    if (!/[.!?]$/.test(s)) s += '.';

    if (s.length < 80) {
      const pad = ' Review the official public record for specifics that apply near your home.';
      const extended = s.replace(/\.$/, '') + pad;
      if (extended.length <= 140) s = extended;
    }
    if (s.length < 80) {
      const distPad = withDistPrefix(s, dist);
      if (distPad.length >= 80 && distPad.length <= 140) s = distPad;
    }
    if (s.length > 140) {
      s = s.slice(0, 137).replace(/\s+\S*$/, '') + '…';
    }
    return s;
  }

  // ───────────────── FACTUAL RECORD SENTENCE (no dimensions on file) ─────────
  // Builds "An operating industrial facility is listed in public records near this
  // location." from the record's OWN lifecycle and type. It replaced a template that
  // concatenated raw field values — `'A ' + status + ' ' + type` — and so emitted
  // "A operating industrial is on the public record near you": wrong article, a bare
  // adjective used as a noun, and the reader's own location asserted.
  //
  // THREE RULES:
  //  1. The lifecycle word comes from the SAME resolver the map pin uses, so the
  //     sentence can never contradict the pin's colour.
  //  2. The noun is only as specific as the record's own type text. "unclassified" and
  //     "Development" are generic buckets and yield the plain noun — we never promote a
  //     generic record into a "data center" or a "manufacturing facility".
  //  3. No lifecycle evidence -> no lifecycle adjective. The sentence simply drops it
  //     rather than saying "A unknown …".

  // Lifecycle -> the word, and where it sits. Prepositive ("a proposed development");
  // postpositive for construction, which reads as a state the thing is in rather than a
  // kind of thing ("a development under construction"). `closed` is carried so a source
  // that states it renders correctly; no wired source emits it today.
  const LIFECYCLE_WORD = {
    proposed:     { before: 'proposed' },
    approved:     { before: 'approved' },
    construction: { after: 'under construction' },
    operating:    { before: 'operating' },
    closed:       { before: 'closed' },
    unknown:      {}
  };
  // The record's own status text -> a lifecycle key. Anything unrecognised is `unknown`,
  // which drops the adjective instead of echoing an unknown word at the reader.
  function lifecycleKey(p) {
    const s = String((p && p.status) || '').trim().toLowerCase();
    const stage = String((p && p.stage) || '').trim().toLowerCase();
    // A stage that says construction is the record stating it, not us inferring it.
    if (/(^|\b)(under construction|construction|building)(\b|$)/.test(stage)
        && s !== 'proposed') return 'construction';
    if (s === 'proposed') return 'proposed';
    if (s === 'approved') return 'approved';
    if (s === 'operating' || s === 'active' || s === 'built') return 'operating';
    if (s === 'closed' || s === 'inactive') return 'closed';
    return 'unknown';
  }
  HS.lifecycleKey = lifecycleKey;

  // Specific nouns, matched on the record's OWN type words. Each entry earns its
  // specificity from the text it matches — "data center" only from a type that says data
  // center, "warehouse" only from a type that says warehouse.
  const SPECIFIC_NOUN = [
    [/\bdata\s*cent(er|re)\b|\bdatacent(er|re)\b/, 'data center'],
    [/\bmanufactur/,                               'manufacturing facility'],
    [/\bwarehous/,                                 'warehouse'],
    [/\blogistic/,                                 'logistics facility'],
    [/\b(power|energy|substation|electric)\b/,     'power facility'],
    [/\bsolar\b/,                                  'solar facility'],
    [/\bpipeline\b/,                               'pipeline project']
  ];
  // Type strings that are buckets, not descriptions. They must never lend specificity —
  // a record typed "unclassified" is "a development", never "an unclassified development".
  const GENERIC_TYPE = /^(development|unclassified|other|record|project|general|misc|n\/?a|)$/;
  // Words that are already the head noun of a phrase, so we must not append another one:
  // "animal facility" stays as filed rather than becoming "animal facility facility".
  const HEAD_NOUN = /\b(facility|facilities|center|centre|building|buildings|project|projects|development|plant|works|site|yard|park|campus|station|terminal|warehouse)\s*$/;
  // Categories where "development" would misdescribe the record — a road widening or a
  // utility relocation is a project, not a development. The word still comes from the
  // source's own type; only the head noun differs.
  const PROJECT_HEAD = /^(utility|utilities|infrastructure|road|roads|highway|transportation|transit|bridge|drainage|stormwater)\b/;

  function isFacilityRecord(p) {
    return !!(p && (p._facility || p.record_kind === 'facility'));
  }
  // The noun is the source's own type word, given a head noun that fits what the record
  // is. Nothing is promoted: no keyword table turns "industrial" into a "data center",
  // and a generic bucket yields the plain noun. Deliberately standalone — it does not
  // reach into lib/map.js, which development.html and property.html do not load.
  function nounFor(p) {
    const head = isFacilityRecord(p) ? 'facility' : 'development';
    const raw = String((p && (p.type || p.use_type || p.layer || p.category)) || '')
      .replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (GENERIC_TYPE.test(raw)) return head;
    for (let i = 0; i < SPECIFIC_NOUN.length; i++) {
      if (SPECIFIC_NOUN[i][0].test(raw)) return SPECIFIC_NOUN[i][1];
    }
    if (HEAD_NOUN.test(raw)) return raw;                       // already a full phrase
    if (PROJECT_HEAD.test(raw)) return raw + ' project';
    return raw + ' ' + head;
  }
  HS.recordNoun = nounFor;

  // "a" / "an" on the sound of the following word. Our vocabulary is closed and fully
  // covered by the vowel rule plus the two exception classes below, both tested.
  function article(phrase) {
    const w = String(phrase || '').trim().toLowerCase().split(/\s+/)[0] || '';
    if (/^(uni|use|util|eu|one)/.test(w)) return 'a';    // "a utility", "a one-storey"
    if (/^(hour|honest)/.test(w)) return 'an';
    return /^[aeiou]/.test(w) ? 'an' : 'a';
  }
  HS.article = article;

  // The reusable formatter. Exported so any surface renders one wording.
  HS.recordSentence = function (p) {
    p = p || {};
    const life = LIFECYCLE_WORD[lifecycleKey(p)] || {};
    const noun = nounFor(p);
    // Never "proposed ... development ... proposed": if the noun already carries the
    // lifecycle word (a source type like "Proposed Development"), don't repeat it.
    const before = (life.before && noun.indexOf(life.before) === -1) ? life.before + ' ' : '';
    const phrase = before + noun;
    const after = life.after ? ' ' + life.after : '';
    const s = article(phrase) + ' ' + phrase + after
      + ' is listed in public records near this location.';
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  // ONE sentence for development cards — evidence-gated.
  HS.projectImpact = function (p) {
    p = p || {};
    const dims = p.impact_dimensions || [];
    const bad = dims.filter(function (d) { return d.bad; }).slice(0, 2)
      .map(function (d) { return String(d.label || '').trim().toLowerCase(); })
      .filter(Boolean);
    const good = dims.filter(function (d) { return !d.bad; }).slice(0, 2)
      .map(function (d) { return String(d.label || '').trim().toLowerCase(); })
      .filter(Boolean);
    const status = String(p.status || '').trim();
    const type = String(p.type || '').trim();
    const st = statusKey(status);
    const typeLower = type.toLowerCase();
    const building = st === 'active' || st === 'operating' || st === 'built';
    const proposed = st === 'proposed';
    const dist = p.dist || '';

    let sentence = '';

    if (bad.length && good.length) {
      sentence = 'Nearby homeowners may feel more ' + joinLabels(bad)
        + ' in daily life, with a possible lift to ' + joinLabels(good) + '.';
    } else if (bad.length >= 2) {
      sentence = 'Could mean more ' + joinLabels(bad)
        + ' for residents living near this ' + (typeLower || 'project') + '.';
    } else if (bad.length === 1) {
      if (building) {
        sentence = 'Active work nearby may add more ' + bad[0]
          + ' on the roads and routines you use in this area.';
      } else if (proposed) {
        sentence = 'If approved, nearby homeowners could see added pressure on '
          + bad[0] + ' once construction begins.';
      } else {
        sentence = 'Nearby homeowners may see added pressure on ' + bad[0]
          + ' if this ' + (typeLower || 'project') + ' moves ahead.';
      }
    } else if (good.length) {
      sentence = 'May offer a modest lift to ' + joinLabels(good)
        + ' for homeowners in the surrounding neighborhood.';
    } else {
      // No sourced dimensions -> the factual record sentence. It is complete and
      // grammatical on its own, so it is NOT run through fitLength: that helper pads
      // anything under 80 chars with a second sentence, which on this copy produced a
      // run-on that said "public record" twice. Only the 140-char cap still applies.
      return capLength(HS.recordSentence(p));
    }

    return fitLength(sentence, dist);
  };

  // ─────────────── QUALITY OF LIFE IMPACT SCORE™ — SUPPRESSED ────────────────
  // WHAT THE STORED SCORE ACTUALLY IS (audited 2026-08-09, app_refresh_zip):
  //   case lower(coalesce(bucket, type, ''))
  //     when 'proposed' then 72 when 'approved' then 55 when 'built' then 55
  //     else 45 end                                   -- development rows
  //   30                                              -- facility rows, a literal
  // That is its ENTIRE input: one lifecycle string. Not distance, not size, not
  // capacity, not emissions, not releases, not waste, not water, not noise, not
  // enforcement history. `impact_dimensions`, the only sourced impact field, is
  // populated on 0 of 3,027,784 rows and is not read by the score at all.
  //
  // So the number is a lifecycle constant wearing the name of a measurement. Shown as
  // "Quality of Life Impact Score™: 72 | High" it invites exactly one reading — that
  // HomeSignal assessed this project's effect on quality of life and it scored badly —
  // and it ranks a PROPOSED project (72, "High") above an OPERATING one (45, "Low"),
  // which asserts that a proposal is more harmful than a working facility.
  //
  // It is therefore GATED OFF, not deleted. `impactScoreRaw()` keeps the original
  // computation intact and tested; flip SHOW_LIFECYCLE_ONLY_SCORE, or set
  // IMPACT_SCORE_METHOD to something other than 'lifecycle_constant' once a defensible
  // methodology exists, and every surface returns to displaying it with no other edit.
  HS.IMPACT_SCORE_METHOD = 'lifecycle_constant';
  HS.SHOW_LIFECYCLE_ONLY_SCORE = false;
  HS.impactScoreIsEvidenceBased = function () {
    return HS.IMPACT_SCORE_METHOD !== 'lifecycle_constant';
  };
  HS.impactScoreDisplayable = function () {
    return HS.impactScoreIsEvidenceBased() || HS.SHOW_LIFECYCLE_ONLY_SCORE === true;
  };

  // Rating label for the stored impact_score (0–100). Thresholds align with the
  // status-derived constants the materializer writes (Proposed≈72, Approved≈55,
  // Operating≈45, facility≈30) — presentation only, not a second scoring system.
  HS.impactRating = function (score) {
    if (score == null || score === '') return null;
    var s = Number(score);
    if (isNaN(s)) return null;
    if (s >= 60) return 'High';
    if (s >= 40) return 'Medium';
    return 'Low';
  };

  // The PRESERVED computation: "72 | High", or '' when no score. Unchanged, still
  // unit-tested, and the single thing to re-point a surface at when the score earns
  // its name back.
  HS.impactScoreRaw = function (score) {
    if (score == null || score === '') return '';
    var rating = HS.impactRating(score);
    return rating ? String(score) + ' | ' + rating : String(score);
  };

  // The DISPLAY value every surface calls. Returns '' while the score is a lifecycle
  // constant, so callers render nothing at all rather than a label with an em dash
  // beside it. One gate, so no surface can drift back on its own.
  HS.impactScoreValue = function (score) {
    return HS.impactScoreDisplayable() ? HS.impactScoreRaw(score) : '';
  };
})();
