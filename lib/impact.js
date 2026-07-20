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

  // ONE sentence for development cards — 80–140 chars, evidence-gated.
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
    } else if (type && status) {
      sentence = 'A ' + st + ' ' + typeLower
        + ' is on the public record near you — open the official filing to learn what may change.';
    } else if (type) {
      sentence = 'A ' + typeLower
        + ' project is on the public record near you — see the official filing for what could affect the area.';
    } else if (status) {
      sentence = 'A ' + st
        + ' development project is on file near you — see the official record for what could affect the area.';
    } else {
      sentence = 'This development record is on file near you — see the official public source for what could affect the area.';
    }

    return fitLength(sentence, dist);
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

  // Compact table/card value: "72 | High", or '' when no score (table empty-state).
  HS.impactScoreValue = function (score) {
    if (score == null || score === '') return '';
    var rating = HS.impactRating(score);
    return rating ? String(score) + ' | ' + rating : String(score);
  };
})();
