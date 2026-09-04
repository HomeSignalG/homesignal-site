// HomeSignal — honest state for the Government Notices section of a ZIP page.
//
// THE DEFECT THIS EXISTS TO FIX. community.html rendered Development, Environment &
// utilities and upcoming meetings each with their own empty state, but Government
// Notices with NONE: the group heading said "… · 0 notices" and then
// `notices.slice(0,2).map(...).join('')` produced the empty string. On the 6,491
// canonical ZIP pages with no Government Notices (measured 2026-09-04, control 12,722)
// the section rendered a count and then nothing at all — indistinguishable, to a
// resident, from a page still loading or broken. Worse, it made "we have not wired a
// source for this county" look identical to "this county published nothing this week".
//
// WHAT MAY AND MAY NOT BE SAID. These are measured constraints, not style. Changing one
// needs new evidence, not an edit. They are the Government Notices analogues of the six
// bans in lib/coverage-copy.js, and test/gov-notice-copy.test.mjs enforces them.
//
//  1. NEVER SAY A GOVERNMENT BODY PUBLISHES NOTHING. We observe our own holdings, never
//     the county's output. A blank section means we hold nothing for this ZIP right now;
//     it is not evidence about what was posted. (Workbook 0017 §11, "UI honesty": never
//     render a coverage gap as a statement about what a government body does or does not
//     publish.)
//  2. THE GAP IS OURS. Where nothing is wired, say "we have not identified a source" —
//     never "the county does not publish" and never "the county refuses". Of the 263
//     unwired jurisdictions measured 2026-09-04, the recorded reasons are overwhelmingly
//     our own ingest limits (123 bespoke county sites with no vendor platform), not
//     refusals: docs/source-registry.md and the ingest hold rows carry zero recorded
//     rejections by a county.
//  3. NO DATE, NO PROMISE. No "coming soon", no "by <month>", no "we're adding counties".
//  4. NEVER NAME A SOURCE WE DO NOT HOLD. The configured list is the only evidence of
//     wiring; if a ZIP is absent from it we name no body, no portal and no vendor.
//  5. FAIL CLOSED. A missing/unreadable map yields the no-source-identified copy, which
//     asserts the least. An outage must never upgrade a page into claiming coverage.
//  6. NEVER CLAIM A FETCH RESULT. We may say what is wired and what this page holds,
//     never what a fetch returned — the site has no per-ZIP fetch receipt.
//
// SELF-CLEARING, like lib/coverage-copy.js: build() is a pure function of the live
// notice count plus the generated map, so
//   • a notice arrives for the ZIP  -> count stops being zero -> build() returns null
//   • a county gets wired           -> lib/generated/gov-notice-coverage.json is
//                                      regenerated and the ZIP moves to the tracked state
(function () {
  'use strict';

  // Naming a place is a factual claim too — the same rule lib/coverage-copy.js applies.
  // "Bethel County" and "Baltimore County" (for Baltimore CITY) do not exist, so where a
  // suffix is unsafe we use the bare name or the state, never an invented term.
  var NO_SUFFIX_STATES = { AK: 1, LA: 1 };            // boroughs/census areas; parishes
  var AMBIGUOUS = {                                    // city/county collisions
    'VA|Fairfax': 1, 'MD|Baltimore': 1, 'MO|St. Louis': 1, 'VA|Virginia Beach': 1
  };

  function placeName(county, state) {
    if (!county) return null;
    var c = String(county).trim();
    if (!c) return null;
    if (/\b(County|Borough|Parish|Census Area|Municipality|city)\b/i.test(c)) return c;
    if (AMBIGUOUS[state + '|' + c] || NO_SUFFIX_STATES[state]) return c;
    return c + ' County';
  }

  // A ZIP is "wired" only if the generated map lists it. Absence is never read as
  // presence, and a null/!array map is treated as absence (ban 5).
  function isConfigured(map, zip) {
    if (!map || !Array.isArray(map.configured_zips) || !zip) return false;
    if (!map._set) {
      try { map._set = new Set(map.configured_zips); }
      catch (e) { return map.configured_zips.indexOf(String(zip)) !== -1; }
    }
    return map._set.has(String(zip));
  }

  // opts:
  //   zip           the canonical ZIP string for this page
  //   county,state  strings from app_community_meta
  //   noticeCount   live count of Government Notices rendered on this page
  //   map           parsed lib/generated/gov-notice-coverage.json (may be null)
  // Returns null when the section has notices, else { state, label, text }.
  //   state 'tracked'    — a source IS wired; we simply hold nothing right now
  //   state 'no_source'  — no source wired; the gap is ours
  function build(opts) {
    opts = opts || {};
    if ((opts.noticeCount || 0) > 0) return null;     // the section has content

    var place = placeName(opts.county, opts.state);
    var where = place || 'this area';

    if (isConfigured(opts.map, opts.zip)) {
      // Ban 1: this describes OUR holdings for this ZIP, not the county's output.
      // Ban 6: no claim about what any fetch returned.
      return {
        state: 'tracked',
        label: 'No notices on file right now',
        text: 'We track public notices for ' + where + '. None are on file for this ZIP '
            + 'right now. When one is published it appears here, linked to its official '
            + 'source.'
      };
    }
    // Ban 2 (the gap is ours), ban 3 (no promise), ban 4 (name no source we lack).
    return {
      state: 'no_source',
      label: 'No source identified yet',
      text: 'We have not identified a public-notice source we can read for ' + where + ' '
          + 'yet, so this section stays empty rather than showing anything unverified. '
          + 'That gap is ours, not a statement about what ' + where + ' publishes.'
    };
  }

  var api = { build: build, placeName: placeName, isConfigured: isConfigured };
  if (typeof window !== 'undefined') {
    window.HS = window.HS || {};
    window.HS.govNoticeCopy = api;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
