// HomeSignal Dashboard — the ALL MY PLACES view-model (Fix 8).
//
// WHY THIS FILE EXISTS. The Dashboard is the one page whose scope is the resident's
// whole portfolio rather than the viewed ZIP, and every defect this file guards against
// is a silent one: a record attributed to the wrong place, two genuinely different
// filings merged into one row, a meeting stamped with a clock time the source never
// stated, a failed source rendered as "nothing is happening". None of those throw.
//
// So the rules live HERE, as pure functions with no DOM and no globals, and
// test/dashboard-all-places.test.mjs drives this shipped code directly in Node. The
// page receives display-ready structures and decides nothing on its own.
//
// THE ONE RULE THAT EXPLAINS MOST OF THE OTHERS: the Dashboard never reads the viewed
// place. Not HS.state.zip, not myZip, not sessionStorage viewZip, not ?zip=, not the
// active address. Membership comes from the canonical My Places stores and nothing else,
// and every rendered record carries its OWN zip — never the one the shell happens to be
// pointing at. See docs/zip-navigation.md for why the viewed place is a separate concept.
(function () {
  'use strict';

  // ---------------------------------------------------------------- membership ----
  // TWO TYPES, TWO STORES, AS MY PLACES DEFINES THEM (properties.html is the management
  // surface and test/my-places-contract.test.mjs pins the separation):
  //   Address  -> app_properties, via HS.state.properties
  //   ZIP Code -> app_follows,    via HS.followedCommunities()
  // Followed PROJECTS are deliberately absent: properties.html states they are not a
  // Place type and excludes them from its Places count, so counting them here would make
  // the header disagree with My Places.
  //
  // The ZIP list is the same one My Places reads, on purpose. shell.js hydrates it from
  // app_follows in BOTH directions before HS.onReady resolves (syncFollowsFromAccount),
  // and ensureAccountScope() wipes it when the account id changes — so after boot it is
  // the account's set. Reading the server array instead would look stricter and behave
  // worse: refreshServerFollowZips() leaves it EMPTY on a failed read, which is
  // indistinguishable from "follows nothing" and would silently blank half the briefing.
  // A false empty is the failure mode this file exists to prevent.
  //
  // A `sample` property is never a Place (config.js:14-20 — the demo persona must not
  // leak into a signed-out or preview session as if it were the resident's own home).
  function canonicalPlaces(opts) {
    opts = opts || {};
    var out = [];
    var seenZip = {};

    (opts.properties || []).forEach(function (p) {
      if (!p || p.sample || p.demo) return;
      var zip = p.zip != null && /^\d{5}$/.test(String(p.zip)) ? String(p.zip) : null;
      out.push({
        kind: 'address',
        id: 'address:' + String(p.id),
        placeId: String(p.id),
        zip: zip,
        label: p.address || 'Saved address',
        sub: [p.city, p.state, p.zip].filter(Boolean).join(', ') || null
      });
    });

    (opts.followedZips || []).forEach(function (c) {
      if (!c || c.zip == null) return;
      var zip = String(c.zip).trim();
      if (!/^\d{5}$/.test(zip) || seenZip[zip]) return;
      seenZip[zip] = 1;
      out.push({
        kind: 'zip',
        id: 'zip:' + zip,
        placeId: zip,
        zip: zip,
        label: c.name || ('ZIP ' + zip),
        sub: c.state ? (zip + ', ' + c.state) : zip
      });
    });

    return out;
  }

  // The ZIP set the data reads are scoped to. An Address contributes its own ZIP, so a
  // resident with a saved home and no ZIP follow still gets a briefing. Deduped, because
  // an Address inside a followed ZIP must not make that ZIP queried twice.
  function queryZips(places, cap) {
    var seen = {}, out = [];
    (places || []).forEach(function (p) {
      if (!p || !p.zip || seen[p.zip]) return;
      seen[p.zip] = 1;
      out.push(p.zip);
    });
    if (cap != null && out.length > cap) return out.slice(0, cap);
    return out;
  }

  // Which monitored places a record's ZIP belongs to. One ZIP can back several Places
  // (a saved Address inside a followed ZIP), and both are legitimately affected.
  function placesForZip(places, zip) {
    if (!zip) return [];
    return (places || []).filter(function (p) { return p && p.zip === String(zip); });
  }

  // ---------------------------------------------------------- dedup identity ----
  // MEASURED 2026-09-13: 180,595 app_changes rows carry only 14,602 distinct records, and
  // 11,148 of those (76%) span more than one ZIP — one reaches 246. A county notice is
  // materialized once per ZIP, so without this a resident monitoring three ZIPs in one
  // county reads the same notice three times and the briefing is mostly repeats.
  //
  // ⛔ source_ref ALONE IS NOT THE KEY, and this is the half that is easy to get wrong.
  // Measured on the same corpus: 674 refs carry more than one distinct TITLE, 1,837 more
  // than one occurred_at, 176 more than one category — a portal URL shared by many items,
  // or a notice re-issued on a new date. Keying on source_ref alone over-merges 2,572
  // groups, i.e. falsely merges genuinely distinct filings. Same rule the development
  // dedup identity already states in CLAUDE.md §7 ("file_date and case_number MUST stay
  // in the key"), and the same shape alerts.html:120-124 already uses for meetings.
  //
  // Values are compared RAW apart from whitespace trimming. No lowercasing, no
  // punctuation folding, no fuzzy title matching — a normalizer that merges more than the
  // source distinguishes is the defect, not the feature.
  var SEP = '\u001f';   // ASCII unit separator: cannot occur in a URL, title or date
  function changeKey(item) {
    item = item || {};
    return [item.source_ref, item.title, item.occurred_at, item.category]
      .map(function (v) { return v == null ? '' : String(v).trim(); })
      .join(SEP);
  }

  // A TOTAL order, so the surviving row is deterministic rather than a function of which
  // network response landed first. Newest first; ties broken by zip then id, both of which
  // are stable. Without the tiebreaks two runs could keep different rows for one record
  // and the place attribution would wobble between page loads.
  function compareForDedupe(a, b) {
    var ad = String((a && a.occurred_at) || ''), bd = String((b && b.occurred_at) || '');
    if (ad !== bd) return ad < bd ? 1 : -1;              // desc, '' sorts last
    var az = String((a && a.zip) || ''), bz = String((b && b.zip) || '');
    if (az !== bz) return az < bz ? -1 : 1;
    var ai = String((a && a.id) || ''), bi = String((b && b.id) || '');
    return ai < bi ? -1 : (ai > bi ? 1 : 0);
  }

  // Collapse to one row per canonical record, accumulating which monitored places it
  // reaches. THE PROVENANCE RULE, MADE STRUCTURAL: the surviving row's own `id` and `zip`
  // travel together, taken from the same source row — a surviving id is never paired with
  // another place's ZIP, and the viewed place is never consulted to choose a winner.
  function dedupeChanges(items) {
    var sorted = (items || []).slice().sort(compareForDedupe);
    var byKey = {}, out = [];
    sorted.forEach(function (it) {
      var k = changeKey(it);
      var hit = byKey[k];
      if (hit) {
        (it.places || []).forEach(function (p) {
          if (!p) return;
          if (hit._placeIds[p.id]) return;
          hit._placeIds[p.id] = 1;
          hit.places.push(p);
        });
        return;
      }
      var row = Object.assign({}, it);
      row.places = (it.places || []).slice();
      row._placeIds = {};
      row.places.forEach(function (p) { if (p) row._placeIds[p.id] = 1; });
      byKey[k] = row;
      out.push(row);
    });
    out.forEach(function (r) {
      r.placeCount = r.places.length;
      delete r._placeIds;
    });
    return out;
  }

  // ------------------------------------------------------------- type labels ----
  // ONLY labels an authoritative category actually supports. app_changes carries exactly
  // three categories in production (measured: Government & civic 118,036 · Local News
  // 46,668 · Planning & zoning 15,939).
  //
  // "Planning & zoning" renders as Government Notice, NOT Development: sampled rows read
  // "Lake Ray Roberts Planning Commission Report … — Notice from Denton County, see the
  // official record". They are notices about planning, not permit filings, and labelling
  // a notice as a permit record would misstate what the resident is looking at.
  //
  // ⛔ THERE IS NO "Infrastructure" CATEGORY IN PRODUCTION. The approved mock shows an
  // Infrastructure row; no data backs it, so it is never rendered. A label with no
  // authoritative category behind it is a claim about a record the source never made.
  var CHANGE_TYPE_LABEL = {
    'Government & civic': 'Government Notice',
    'Planning & zoning': 'Government Notice',
    'Local News': 'Local News'
  };
  function typeLabelForChange(category) {
    return CHANGE_TYPE_LABEL[String(category || '')] || null;
  }

  // ------------------------------------------------------- meeting time safety ----
  // ⛔ meeting_date's CLOCK COMPONENT IS NOT A MEETING TIME. Measured 2026-09-13 over all
  // 2,574 upcoming meetings: 1,475 sit at exactly 06:00:00Z and 1,005 at exactly
  // 07:00:00Z — midnight MDT and midnight MST/PDT, i.e. a date stored in a local zone.
  // That is 2,480 of 2,574 (96.3%), and the correlation with the STATED time column is
  // perfect in both directions: every row in those two buckets has meeting_time null, and
  // every row outside them has it populated. Read back locally the artifact is obvious —
  // five Santa Clara County meetings stamped 2026-09-14 06:00+00 are 11 PM Pacific the
  // night before, and a Board of Supervisors does not convene at 11 PM.
  //
  // So the ONLY trustworthy time is meeting_time, the value the source itself stated:
  // 51 of 2,574 upcoming meetings, 2.0%. Everything else renders as a date, which is what
  // the source actually said. No timezone is assumed, and America/Chicago in particular is
  // never applied (lib/templates.js does that today — pre-existing, out of scope, Fix 8A).
  function meetingTimeDisplay(m) {
    if (!m) return null;
    var t = m.meeting_time == null ? '' : String(m.meeting_time).trim();
    return t ? t : null;
  }

  // ------------------------------------------------------------ official dates ----
  function ymd(v) {
    if (v == null) return null;
    var s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  }

  // An open comment window is the only deadline signal that exists in production:
  // alerts.comment_deadline is null on all 44,626 rows and meetings.comment_period_open is
  // false on all 2,574 upcoming, so app_changes.window_closes_at is the entire supply
  // (1,516 rows, 639 ZIPs). It is a DATE — no time, no timezone — so it renders to the day
  // and never carries a clock. All three §8 conditions must hold: the record states the
  // window, the deadline is unexpired, and the destination opens the authoritative notice.
  function isOpenCommentWindow(item, todayYmd) {
    var w = ymd(item && item.window_closes_at);
    return !!(w && todayYmd && w >= todayYmd);
  }

  // One chronological list of dated official events. Meetings are appointments, comment
  // windows are deadlines; both are official dates a resident should know, and neither
  // implies a participation opportunity — no participation data exists anywhere in the
  // product, so no participation CTA is ever produced here.
  function officialDateItems(opts) {
    opts = opts || {};
    var today = opts.todayYmd;
    var out = [];

    (opts.meetings || []).forEach(function (m) {
      if (!m) return;
      var d = ymd(m.meeting_date);
      if (!d || (today && d < today)) return;         // completed meetings excluded
      out.push({
        kind: 'meeting',
        id: m.id,
        zip: m.zip || null,
        places: m.places || [],
        title: m.title || 'Public meeting',
        dateYmd: d,
        time: meetingTimeDisplay(m),
        location: m.location ? String(m.location) : null,
        href: m.source_url || null,
        hrefKind: 'external'
      });
    });

    (opts.changes || []).forEach(function (c) {
      if (!c || !isOpenCommentWindow(c, today)) return;
      out.push({
        kind: 'comment_window',
        id: c.id,
        zip: c.zip || null,
        places: c.places || [],
        title: c.title || 'Official notice',
        dateYmd: ymd(c.window_closes_at),
        time: null,                                    // a date column has no time
        location: null,
        href: null,                                    // the page builds the focused route
        hrefKind: 'notice'
      });
    });

    out.sort(function (a, b) {
      if (a.dateYmd !== b.dateYmd) return a.dateYmd < b.dateYmd ? -1 : 1;
      return String(a.id || '') < String(b.id || '') ? -1 : 1;
    });
    return out;
  }

  // ------------------------------------------------------------- date display ----
  // ⚠️ A DATE-ONLY COLUMN MUST NOT BE PARSED AS AN INSTANT. Every date this page renders is a
  // Postgres `date`: app_changes.occurred_at, app_projects.submitted_at, window_closes_at, and
  // meetings' own calendar day. `new Date('2026-09-16')` parses as UTC MIDNIGHT, so
  // toLocaleDateString() in any negative-offset zone renders the DAY BEFORE — measured:
  // TZ=America/Los_Angeles gives "Sep 15", TZ=UTC gives "Sep 16". That is essentially every
  // HomeSignal resident, and on a comment deadline it understates the time they have left.
  //
  // So a calendar date is formatted FROM ITS PARTS and never becomes a Date at all. There is no
  // timezone in the value, so none is applied.
  //
  // ⛔ HS.fmtDate (lib/templates.js) has this defect for date-only inputs and is used on other
  // surfaces. It is SHARED and deliberately not touched here — repairing it is Fix 8A.
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtCalendarDate(value) {
    var d = ymd(value);
    if (!d) return '';
    var parts = d.split('-');
    var mi = Number(parts[1]) - 1;
    if (!(mi >= 0 && mi < 12)) return '';
    return MONTHS[mi] + ' ' + String(Number(parts[2]));
  }

  // --------------------------------------------------------- source availability ----
  // "We could not read this" and "there is nothing here" are DIFFERENT FACTS and must
  // never render the same way. Every empty state on the page branches on this, so a failed
  // read can never become a claim of absence.
  function sourceAvailability(results) {
    results = results || {};
    var out = {};
    ['changes', 'development', 'meetings', 'places'].forEach(function (k) {
      out[k] = results[k] === true ? 'ok' : (results[k] === false ? 'failed' : 'unknown');
    });
    out.anyFailed = Object.keys(out).some(function (k) { return out[k] === 'failed'; });
    out.allFailed = ['changes', 'development', 'meetings'].every(function (k) { return out[k] === 'failed'; });
    return out;
  }

  // ------------------------------------------------------------- Premium module ----
  // The Quality-of-Life module is a ROADMAP STATEMENT, not a data-quality fallback. It is
  // constant: it renders identically whether every source succeeded or every source failed,
  // because it is not reporting on data at all. A failed read renders the failure.
  //
  // It exists because Phase 1 proved there is no authoritative Quality-of-Life impact plane:
  // app_changes.impacts is NULL on all 180,595 rows, app_projects.impact_dimensions is NULL
  // on all 3,207,251, and impact_score holds exactly FOUR values across the corpus, each
  // constant within its (status, record_kind) pair — so "High impact" would resolve to
  // "status = Proposed" on 357,857 records. No label, score, explanation or direction is
  // rendered anywhere on this page.
  //
  // Copy is frozen here, in one place, so the page cannot drift from the approved wording.
  var PREMIUM_QOL = {
    sectionLabel: 'QUALITY-OF-LIFE IMPACT · PREMIUM',
    availability: 'Coming soon',
    title: 'Get deeper local insights',
    body: 'See added context around major development, infrastructure, and civic activity across the places you monitor.',
    cta: 'Get Premium access →'
  };
  function premiumQolModuleState() {
    return {
      label: PREMIUM_QOL.sectionLabel,
      availability: PREMIUM_QOL.availability,
      title: PREMIUM_QOL.title,
      body: PREMIUM_QOL.body,
      cta: PREMIUM_QOL.cta
    };
  }

  // THE LEAD IS FEATURE-LEVEL. It carries a source and nothing else — no zip key, no
  // address key, so there is no field for a place to arrive in even by mistake. The
  // Acquisition Dashboard's Source column renders this string verbatim beside
  // "ZIP Community Profile" and "Property Insights"; hs_premium_interest_key folds it into
  // 'dashboard quality-of-life||', a distinct interest from both.
  var PREMIUM_LEAD_SOURCE = 'Dashboard Quality-of-Life';
  function premiumLeadContext() { return { source: PREMIUM_LEAD_SOURCE }; }

  // ------------------------------------------------------------- legacy ?zip= ----
  // Fix 8 D1 took dashboard.html out of ZIP_NAV_PAGES, so sidebar navigation no longer
  // stamps a ZIP on it. A legacy ?zip= can still ARRIVE — an old bookmark, an external
  // link, or today.html's redirect, which forwards its query string verbatim.
  //
  // It must not reach the Premium lead: HS.submitWaitlist falls back to
  // HSPremiumWaitlist.zipFromLocation(location) when the CTA states no ZIP, and that reads
  // location.search. Stripping the parameter from the Dashboard's own URL is what makes
  // the fallback find nothing, so a feature-level lead cannot inherit one place's ZIP.
  //
  // Returns the cleaned search string ('' when nothing is left), or null when there was no
  // zip parameter to remove — so the caller can skip a pointless history write.
  function searchWithoutZip(search) {
    var s = search == null ? '' : String(search);
    if (!/[?&]zip=/.test(s)) return null;
    var qs = s.charAt(0) === '?' ? s.slice(1) : s;
    var kept = qs.split('&').filter(function (pair) {
      return pair !== '' && pair.split('=')[0] !== 'zip';
    });
    return kept.length ? '?' + kept.join('&') : '';
  }

  var api = {
    canonicalPlaces: canonicalPlaces,
    queryZips: queryZips,
    placesForZip: placesForZip,
    changeKey: changeKey,
    compareForDedupe: compareForDedupe,
    dedupeChanges: dedupeChanges,
    typeLabelForChange: typeLabelForChange,
    meetingTimeDisplay: meetingTimeDisplay,
    isOpenCommentWindow: isOpenCommentWindow,
    officialDateItems: officialDateItems,
    fmtCalendarDate: fmtCalendarDate,
    sourceAvailability: sourceAvailability,
    premiumQolModuleState: premiumQolModuleState,
    premiumLeadContext: premiumLeadContext,
    searchWithoutZip: searchWithoutZip,
    PREMIUM_QOL: PREMIUM_QOL,
    PREMIUM_LEAD_SOURCE: PREMIUM_LEAD_SOURCE,
    MAX_QUERY_ZIPS: 25,
    QUERY_CONCURRENCY: 4
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window.HS = window.HS || {}, { dashAgg: api });
})();
