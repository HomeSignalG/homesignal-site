// HomeSignal — honest empty-state copy for a ZIP page with nothing on it.
//
// THE DEFECT THIS EXISTS TO FIX. development.html used to tell every empty page
// "We check county and permit records for this area continuously — new projects appear
// here the moment they're filed." On 443 of the 801 all-empty pages that is FALSE: no
// registry entry covers those counties at all, so nothing is being checked and nothing
// will appear. A resident in Arroyo Hondo (87513, Taos County NM) read a promise we
// cannot keep, and still could not tell "nothing is happening here" from "you aren't
// covered." This module replaces that one claim with three that are each traceable to a
// stored field.
//
// WHAT MAY AND MAY NOT BE SAID — every one of these is a measured constraint, not a
// style preference. Changing any of them needs new evidence, not an edit.
//
//  1. NEVER NAME A DISTANCE. get-address-report's frsFacilities() walks
//     [3, 2, 1.5, 1, 0.5, 0.25] miles, stepping down whenever EPA refuses on its process
//     limit, and stores nothing about which radius answered. "within 3 miles" is
//     therefore unprovable per page.
//  2. NEVER SAY "EPA LISTS NO REGULATED FACILITIES". The count is name-filtered through
//     looksIndustrial() — an INCLUDE/EXCLUDE token list. A zero means no facility whose
//     NAME we recognise as industrial, utility or waste. Say that, or say nothing.
//  3. NEVER SAY "WE CHECKED X AND FOUND NOTHING" for a permit source. development_reports
//     has no sources_checked column (property_reports does); the only evidence a source
//     ran is the ABSENCE of a fetch_failed row, which is silence, not a receipt. So we may
//     state what we DRAW ON (the committed registry) and what the page HOLDS (live data),
//     never what a fetch returned. When sources_checked is ported to ZIP mode, this is the
//     one rule that relaxes.
//  4. NEVER SAY A COUNTY REFUSES OR CANNOT PROVIDE ACCESS. docs/source-registry.md carries
//     zero recorded rejections for the counties in class (d) — grep returns 0 for South
//     Dakota, Wyoming, New Mexico, Idaho, Taos and Bethel. "Nobody has looked" is the only
//     supported statement.
//  5. THE GAP IS OURS. "We have not identified a source" — never "the county does not
//     publish", which we have not established and mostly is not true.
//  6. NO DATE, NO PROMISE. No "coming soon", no "by <month>", no "we're adding counties".
//
// SELF-CLEARING. build() is a pure function of live page data plus the generated
// county-source map, so every state clears itself with no manual step:
//   • a record arrives (any kind)      -> counts stop being zero -> build() returns null
//   • a failing source recovers        -> no failure row at the newest refresh -> line drops
//   • a source is wired for the county -> lib/generated/county-sources.json is regenerated
//     in the SAME commit as the registry edit (enforced by county-sources-parity.test.mjs),
//     so the copy and the wiring ship together
//   • the EPA read recovers            -> server-side flag, already self-reverting
(function () {
  'use strict';

  // Naming a place is a factual claim too. "Bethel County" and "Virginia Beach County"
  // do not exist. Append a term only where the state's system is unambiguous and the row
  // is not one of the known city/county collisions; otherwise use the bare name, which is
  // less specific but never wrong. (app_community_meta.county does not record whether an
  // Alaska row is a borough or a census area, so Alaska never takes a suffix.)
  // Where no term is safe, the bare name is ambiguous in a way that misleads: "Bethel"
  // alone reads as the town of Bethel, which is a DIFFERENT page (99559) with its own
  // records. So those cases get the state appended instead — "Bethel, Alaska" — which is
  // locationally true on either reading and never invents a term.
  var NO_SUFFIX_STATES = { AK: 'Alaska' };
  var AMBIGUOUS = {                         // city/county name collisions: stay unqualified
    'VA|Virginia Beach': 'Virginia', 'MD|Baltimore': 'Maryland', 'MO|St. Louis': 'Missouri'
  };

  function placeName(county, state) {
    if (!county) return null;
    if (state === 'LA') return county + ' Parish';
    if (NO_SUFFIX_STATES[state]) return county + ', ' + NO_SUFFIX_STATES[state];
    if (AMBIGUOUS[state + '|' + county]) return county + ', ' + AMBIGUOUS[state + '|' + county];
    if (/\bcity\b/i.test(county)) return county;
    return county + ' County';
  }

  // The sources the registry declares for this county, most specific first: a source that
  // names this county beats one that merely covers the state.
  function sourcesFor(map, county, state) {
    if (!map || !state) return [];
    var local = (map.counties && map.counties[state + '|' + county]) || [];
    var wide = (map.statewide && map.statewide[state]) || [];
    return local.concat(wide);
  }

  function joinList(items) {
    if (items.length <= 1) return items[0] || '';
    if (items.length === 2) return items[0] + ' and ' + items[1];
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  // opts:
  //   county, state        strings from app_community_meta
  //   devCount, facCount   live marker counts for this ZIP
  //   civicCount           live civic (non-news) change count for this ZIP
  //   facUnavailable       development_reports.facilities_unavailable for this snapshot
  //   failedSources        [] of labels that failed at the newest refresh (may be empty)
  //   map                  the parsed lib/generated/county-sources.json (may be null)
  // Returns null when the page is not empty, or { heading, lines: [{label, text}] }.
  function build(opts) {
    opts = opts || {};
    // THE GATE IS LIVE CONTENT, not a stored coverage_state. With the refresh paused,
    // 707 of the 801 empty pages currently read `stale_data` in app_coverage_states — a
    // state-gated block would reach 82 of them. The three counts below are what the copy
    // actually asserts, so they are what it keys on.
    if ((opts.devCount || 0) > 0) return null;
    if ((opts.facCount || 0) > 0) return null;
    if ((opts.civicCount || 0) > 0) return null;

    var place = placeName(opts.county, opts.state);
    var sources = sourcesFor(opts.map, opts.county, opts.state);
    var local = sources.filter(function (s) { return s.scope !== 'statewide'; });
    var wide = sources.filter(function (s) { return s.scope === 'statewide'; });
    var lines = [];

    // ── 1. What we draw on here ────────────────────────────────────────────────────
    // Rule 2: describe EPA by what the filter actually keeps. Rule 1: no radius.
    // When the EPA read failed for this snapshot we make NO facility claim at all and
    // leave it to the existing outage copy, which is the page's authority on that.
    // Sources get their OWN line rather than being joined to the EPA clause: the labels
    // carry commas ("City of Albuquerque, New Mexico"), so one long conjunction reads as
    // comma soup and buries the sentence that matters most on a page like Jemez Springs.
    if (!opts.facUnavailable) {
      lines.push({
        label: 'What we draw on here',
        text: "EPA's Facility Registry Service — the federal register of industrial, "
          + 'utility and waste sites.'
      });
    }
    if (local.length || wide.length) {
      var permitText;
      var cityOnly = local.length === 1 && local[0].scope === 'city' && place;
      if (cityOnly) {
        // scope === 'city' comes from the entry's own jurisdiction string beginning
        // "City of …" — the source declaring its own reach. That is what licenses this
        // sentence, the single most useful thing on a page like Jemez Springs: the only
        // ledger we hold is a city's, and the resident's address is not in that city.
        permitText = 'the only permit source we have that reaches ' + place + ' is '
          + local[0].label + '. Those records cover the city, so a filing elsewhere in '
          + 'the county would not be in them.';
      } else if (local.length) {
        permitText = joinList(local.map(function (s) { return s.label; })) + '.';
      } else {
        // No subject-matter claim: we name the body and its declared reach. The reader
        // learns what it publishes from the body's own name, never from us.
        permitText = joinList(wide.map(function (s) { return s.label; }))
          + (wide.length > 1 ? ', which cover the whole state.' : ', which covers the whole state.');
      }
      if (local.length && wide.length) {
        permitText = permitText.replace(/\.$/, '') + ', plus '
          + joinList(wide.map(function (s) { return s.label; })) + ' statewide.';
      }
      lines.push({ label: 'For permits and planning', text: permitText });
    }

    // ── 2. What this page holds ────────────────────────────────────────────────────
    // A statement about the page, from live data — never about what a fetch returned
    // (rule 3). Local news rides below and is deliberately not counted as coverage, so
    // the wording never claims the page is blank.
    lines.push({
      label: 'What this page holds',
      text: opts.facUnavailable
        ? 'no permit or planning records for this area.'
        : 'no facility, permit or planning records for this area.'
    });

    // ── 3. What isn't covered ──────────────────────────────────────────────────────
    // Rules 4 and 5: the gap is ours, and "not identified" is the strongest claim the
    // evidence supports.
    var where = place || 'this area';
    if (!local.length) {
      lines.push({
        label: "What isn't covered",
        text: 'building permits, zoning cases and hearing notices for ' + where + '. '
          + 'We have not identified a source that publishes them. That is a gap in what '
          + "we've found, not a finding about what's available."
      });
    } else {
      lines.push({
        label: "What isn't covered",
        text: where + "'s own permit and planning records aren't among our sources yet."
      });
    }

    // ── 4. A contaminated zero is not a zero ───────────────────────────────────────
    // Same distinction the EPA outage copy makes: incomplete, not empty. Never names a
    // source as blocked or permanently unavailable — all four measured cases were
    // timeouts and connection resets from sources that are otherwise alive.
    var failed = (opts.failedSources || []).filter(Boolean);
    if (failed.length) {
      lines.push({
        label: 'One source did not respond',
        text: joinList(failed) + ' did not respond when this page last updated, so what '
          + 'you see may be incomplete rather than empty. This resolves on its own the '
          + 'next time it responds.'
      });
    }

    return { heading: "What's on this page, and what isn't", lines: lines };
  }

  var api = { build: build, placeName: placeName, sourcesFor: sourcesFor };
  if (typeof window !== 'undefined') {
    window.HS = window.HS || {};
    window.HS.coverageCopy = api;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
