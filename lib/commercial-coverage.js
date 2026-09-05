// COMMERCIAL COVERAGE — the one sentence that stops Map 1 implying a measured zero for a
// Type it never searched.
//
// THE DEFECT THIS EXISTS TO FIX (measured 2026-09-05, read-only Commercial decision gate):
// Commercial-capable sources cover 100 (state, county) pairs. **9,481 of 12,722 ZIP pages
// sit in a county no Commercial source covers**, so those pages can never draw a Commercial
// hexagon — yet the legend lists Commercial as a category and, on an empty page, ZIP mode
// says "No qualifying development records across ZIP X. This is a measurement of the whole
// ZIP, not an empty search." Read together, a resident is told commercial development was
// measured across their ZIP and none exists. For those 9,481 pages that is not true: it was
// never measured.
//
// FOUNDER RULE (2026-09-05): "A Commercial-uncovered ZIP must NEVER communicate 'No
// Commercial development exists here' or an equivalent measured-zero claim… A missing source
// is not evidence of zero."
//
// WHAT THIS MAY AND MAY NOT SAY. It inherits lib/coverage-copy.js's rules verbatim, because
// they are measured constraints and not style:
//   • THE GAP IS OURS. "We have not identified a source" — never "the county does not
//     publish", which is unestablished and mostly untrue.
//   • NO DATE, NO PROMISE. No "coming soon", no month, no "we're adding counties".
//   • NEVER NAME A DISTANCE, and never claim a fetch returned nothing.
// It also adds one of its own:
//   • NEVER SAY "there is no commercial development here". The honest statement is about
//     OUR measurement, never about the world.
//
// SELF-CLEARING, by construction. The input is lib/generated/county-sources.json, which is
// regenerated from the registry in the SAME commit as any registry edit (enforced by
// test/county-sources-parity.test.mjs). Wire a Commercial-capable source for a county and
// this note disappears there on the same deploy — there is no second step to forget.
(function () {
  'use strict';

  // Does any source covering this county still classify records as Commercial?
  // `commercial` is stamped per source by scripts/gen-county-sources.mjs and is false for an
  // entry whose commercial_work_evidence is `unresolved` — i.e. one that can no longer assert
  // Commercial at all. Counting such an entry as coverage would reintroduce exactly the claim
  // the founder rule forbids.
  function commercialSources(map, county, state) {
    if (!map || !state) return [];
    var out = [];
    var local = (map.counties && county) ? map.counties[state + '|' + county] : null;
    var wide = map.statewide ? map.statewide[state] : null;
    [local, wide].forEach(function (list) {
      (list || []).forEach(function (s) { if (s && s.commercial) out.push(s); });
    });
    return out;
  }

  // UNKNOWN IS NOT UNCOVERED. With no map loaded, or no unambiguous county for the ZIP, we
  // cannot establish that the county is uncovered — and asserting it would be the same class
  // of error in the other direction. Return null (say nothing) rather than guess.
  //   covered === true   → a Commercial-capable source covers this county
  //   covered === false  → none does; the note applies
  //   covered === null   → not established; render nothing
  function status(map, county, state) {
    if (!map || !state) return { covered: null, sources: [] };
    var hasCountyKey = !!(map.counties && county && map.counties[state + '|' + county]);
    var hasStateKey = !!(map.statewide && map.statewide[state]);
    var srcs = commercialSources(map, county, state);
    if (srcs.length) return { covered: true, sources: srcs };
    // We know the registry's shape for this state, so "none of them is Commercial-capable"
    // is a real finding rather than an absence of data.
    if (hasCountyKey || hasStateKey || (map.counties && map.statewide)) {
      return { covered: false, sources: [] };
    }
    return { covered: null, sources: [] };
  }

  // The sentence, or null when nothing honest can be said.
  // `place` is the already-formatted place name the caller uses elsewhere on the page, so the
  // two never disagree; when absent we say "this area", never an invented county term.
  function note(map, county, state, place) {
    var st = status(map, county, state);
    if (st.covered !== false) return null;
    var where = place || (county ? county + ' County' : 'this area');
    return 'Commercial development is not measured for ' + where + ' yet — we have not '
         + 'identified a source that publishes commercial building or site permits here, so '
         + 'this page cannot show commercial projects and does not imply there are none.';
  }

  var api = { commercialSources: commercialSources, status: status, note: note };
  if (typeof window !== 'undefined') {
    window.HS = window.HS || {};
    window.HS.commercialCoverage = api;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
