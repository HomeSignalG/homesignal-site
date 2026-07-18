// HomeSignal "Why This Matters" — the ONE derivation backbone shared by the app's
// project surfaces (maps.html info panel + development.html detail page).
//
// CONTRACT (Sprint-3, and the repo's anti-fabrication rules): every sentence is
// EVIDENCE-BASED — derived from a field actually present on the record (or its
// matched public hearing), never from the project type, never from a guess.
//   * A fact the record doesn't state is either OMITTED or listed under
//     "What we don't know yet" — said to be unknown, never filled in.
//   * Distances render only from a real saved home (the caller passes hasHome);
//     no home -> the answer says WHY there's no distance, it never invents one.
//   * Stage wording is the record's own text (stage/status verbatim); the
//     canonical-sounding "Application filed <date>" appears only when the record
//     carries that actual filing date.
// Pure + DOM-free so test/why.test.mjs can pin every gate.
(function () {
  const HS = (window.HS = window.HS || {});

  function fmtLong(d) { return HS.fmtDate(d, { year: 'numeric', month: 'long', day: 'numeric' }); }
  function upcoming(mtg) { return !!(mtg && mtg.starts_at && new Date(mtg.starts_at) > new Date()); }

  // The ONE meeting picker for a project: prefer the SOONEST UPCOMING matched
  // hearing (that's the actionable one); fall back to the most recent past one
  // (history for the timeline). A first-match .find() hid a real upcoming
  // hearing behind an already-held earlier meeting — this is the fix.
  HS.bestMeeting = function (meetings, projectId, now) {
    now = now ? new Date(now) : new Date();
    const rel = (meetings || []).filter(function (m) { return m.related_project_id === projectId && m.starts_at; });
    const up = rel.filter(function (m) { return new Date(m.starts_at) > now; })
      .sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
    if (up.length) return up[0];
    return rel.sort(function (a, b) { return new Date(b.starts_at) - new Date(a.starts_at); })[0] || null;
  };

  // Derive the full "Why this matters" answer set for one record.
  //   it  — a project (has .type) or an alerts/notice record (no .type)
  //   ctx — { hasHome, homeAddress, place, radiusMi, meeting }
  // Returns { seeing, close, stage, participate, know:[], unknown:[], nextKnown }
  HS.whyDerive = function (it, ctx) {
    ctx = ctx || {};
    const isProject = !!it.type;
    const mtg = ctx.meeting || null;
    const hasPoint = it.lat != null && it.lng != null;
    const hasDist = ctx.hasHome && it.distance_mi != null;
    const hearing = upcoming(mtg);
    const winDays = it.window_closes_at != null ? HS.daysUntil(it.window_closes_at) : null;
    const winOpen = winDays != null && winDays >= 0;
    const st = String(it.status || '').toLowerCase();
    const done = st === 'operating' || st === 'built';
    const building = st === 'active';
    const approved = st === 'approved';

    // ── 1) Why am I seeing this? ─────────────────────────────────────────────
    let seeing;
    if (hasDist && ctx.radiusMi != null && it.distance_mi <= ctx.radiusMi) {
      seeing = 'It’s inside your ' + ctx.radiusMi + '-mile map view around your saved home.';
    } else if (hasDist) {
      seeing = 'It’s on the public record near your saved home.';
    } else if (ctx.place) {
      seeing = 'It’s on the public record for ' + ctx.place + ', the area you’re viewing.';
    } else {
      seeing = 'It’s on the public record for this area.';
    }

    // ── 2) How close is it? ──────────────────────────────────────────────────
    let close;
    if (hasDist) {
      close = 'Located about ' + (it.dist || HS.fmtMi(it.distance_mi)) + ' from your saved home'
        + (ctx.homeAddress ? ' at ' + ctx.homeAddress : '') + '.';
    } else if (!hasPoint) {
      close = 'This applies to the whole area rather than one address, so it has no single distance.';
    } else {
      close = 'It’s shown at its recorded location on the map. Save your home address to see how far away it is.';
    }

    // ── 3) What stage is it in? — the record's OWN lifecycle words only ─────
    let stage;
    if (it.stage && it.submitted_at) {
      stage = 'The record lists it as “' + it.stage + '” — filed ' + fmtLong(it.submitted_at) + '.';
    } else if (it.stage) {
      stage = 'The record lists it as “' + it.stage + '.”';
    } else if (it.status) {
      stage = 'The record lists its status as “' + it.status + '.”';
    } else if (it.occurred_at) {
      stage = 'Recorded on the official feed ' + fmtLong(it.occurred_at) + '; the record doesn’t state a stage.';
    } else {
      stage = 'The record doesn’t state a stage yet.';
    }

    // ── 4) Can I still participate? ─────────────────────────────────────────
    let participate;
    if (winOpen) {
      participate = 'Public comments are open — the window closes ' + fmtLong(it.window_closes_at)
        + (winDays === 0 ? ' (today)' : ' (in ' + winDays + ' day' + (winDays === 1 ? '' : 's') + ')') + '.';
    } else if (hearing) {
      participate = 'A public hearing is scheduled for ' + fmtLong(mtg.starts_at) + '.';
    } else if (it.source_ref) {
      participate = 'No comment window is currently listed — review the official record for options.';
    } else {
      participate = 'No participation opportunity is currently listed.';
    }

    // ── What we know — one line per fact the record actually carries ────────
    const know = [];
    if (it.submitted_at) know.push('County application filed ' + fmtLong(it.submitted_at));
    else if (it.occurred_at) know.push('Recorded on the official feed ' + fmtLong(it.occurred_at));
    if (it.status) know.push('Status on file: ' + it.status);
    if (it.stage && it.stage !== it.status) know.push('Stage on file: ' + it.stage);
    if (it.developer) know.push('Applicant on file: ' + it.developer);
    if (hasPoint) know.push('Location on file — shown on the map');
    if (hearing) know.push('Public hearing scheduled for ' + fmtLong(mtg.starts_at));
    if (winOpen) know.push('Public comment window open until ' + fmtLong(it.window_closes_at));
    if (it.source_ref) know.push('Official public record available');

    // ── What we don't know yet — TRUE absences only, gated by what IS known ──
    // (an approved project never lists "final approval" as unknown, an operating
    // one never lists "construction start"). Empty list = nextKnown fallback.
    const unknown = [];
    let nextKnown = null;
    if (isProject) {
      if (!approved && !building && !done) unknown.push('Final approval decision');
      if (!building && !done) unknown.push('Construction start date');
      unknown.push('Environmental findings');
      if (!done) unknown.push('Final operating conditions');
    } else if (!hearing && !winOpen) {
      unknown.push('What happens next — the record doesn’t list a follow-up step');
    } else {
      nextKnown = hearing
        ? 'The scheduled hearing is the next known step.'
        : 'The open comment window is the next known step.';
    }

    return { seeing, close, stage, participate, know, unknown, nextKnown };
  };

  // ── Markup builders (inner content only — each page wraps them in its own
  //    section chrome: .isec cards on maps, .kicker/.divider panels on detail) ──
  const QA = [
    ['Why am I seeing this?', 'seeing'],
    ['How close is it?', 'close'],
    ['What stage is it in?', 'stage'],
    ['Can I still participate?', 'participate']
  ];
  HS.whyQaHTML = function (d) {
    return '<dl class="wtm">' + QA.map(function (q) {
      return '<div class="wq"><dt>' + q[0] + '</dt><dd>' + HS.esc(d[q[1]]) + '</dd></div>';
    }).join('') + '</dl>';
  };
  HS.whyKnowHTML = function (d) {
    if (!d.know.length) return '<p class="wnote">The record carries no confirmed details yet beyond its listing.</p>';
    return '<ul class="known">' + d.know.map(function (k) {
      return '<li><span class="kmark" aria-hidden="true">✓</span>' + HS.esc(k) + '</li>';
    }).join('') + '</ul>';
  };
  HS.whyUnknownHTML = function (d) {
    let html;
    if (!d.unknown.length) {
      html = '<p class="wnote">' + HS.esc(d.nextKnown || 'Nothing further is pending on this record.') + '</p>';
    } else {
      html = '<ul class="unknown">' + d.unknown.map(function (u) {
        return '<li><span class="umark" aria-hidden="true">•</span>' + HS.esc(u) + '</li>';
      }).join('') + '</ul>';
    }
    return html + '<p class="wnote">We list only what the public record supports — these stay unknown until the county publishes them.</p>';
  };
})();
