// HomeSignal component templates — small vanilla functions that turn data into the
// mockup's component vocabulary (story card, impact chips, score ring/bars, timeline
// thread, meeting rows, stat tiles). Markup mirrors homesignalphase1_13.html verbatim.
(function () {
  const HS = (window.HS = window.HS || {});
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  HS.esc = esc;
  // null-safe display for an optional 12-mo value trend (real data may not have one)
  HS.trend = v => (v == null || v === '') ? 'Tracking' : (v > 0 ? '+' : '') + v + '%';

  // Canonical permit-status colors — THE one status→color mapping, used by every
  // surface (map pins via lib/map.js, card bars here, legends). Launch rule:
  // the same status is the same color on Dashboard, Maps, Alerts, and the
  // development pages — never re-derived per page.
  HS.statusHex = { proposed: '#c47a1a', approved: '#3f7fb0', operating: '#1f9d5c', onfile: '#6b7f76' };
  function statusKey(s) {
    s = String(s || '').toLowerCase();
    return s === 'proposed' ? 'proposed'
      : s === 'approved' ? 'approved'
      : (s === 'operating' || s === 'active' || s === 'built') ? 'operating' : null;
  }

  // color a card's left bar: records WITH a permit status use the canonical
  // status colors (identical to their map pin); status-less records (alerts/
  // notices) keep the attention heuristics below.
  function barColor(item) {
    const k = statusKey(item.status);
    if (k) return HS.statusHex[k];
    // A record that HAS a status we don't recognise is lifecycle-unknown, and takes the
    // same neutral the map pin uses for that state — so the card's left bar and the pin
    // agree. It used to fall through to `impact_score` here, which would have coloured a
    // 'Decided' record amber off a lifecycle constant. Unreachable in today's data
    // (0 of 3,027,784 rows carry a status outside the recognised set, and no seed row
    // does either), but 'Decided' is a value app_refresh_zip can emit, so this was a
    // latent read rather than a dead one.
    if (item.status) return HS.statusHex.onfile;
    // Status-less records — alerts and notices, which carry no impact_score at all —
    // keep the attention heuristic below, now driven only by `confidence`.
    const s = (item.confidence === 'High' ? 80 : 40);
    if (s >= 75) return 'var(--red)';
    if (s >= 45) return 'var(--amber)';
    if (item.impacts && item.impacts.every(i => !i.bad)) return 'var(--green-2)';
    return 'var(--blue)';
  }
  HS.barColor = barColor;

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr), now = new Date();
    return Math.ceil((d - now) / 86400000);
  }
  HS.daysUntil = daysUntil;

  function fmtDate(dateStr, opts) {
    if (!dateStr) return '';
    try { return new Date(dateStr).toLocaleDateString('en-US',
      opts || { month: 'short', day: 'numeric' }); } catch (e) { return dateStr; }
  }
  HS.fmtDate = fmtDate;

  // ── Which single record a surface features ──────────────────────────────────
  // MOST RECENTLY FILED, then a stable tie-break on id. One field and a tie-break —
  // nothing weighted, nothing combined, no pseudo-score.
  //
  // It replaced `max(impact_score)`, which was a lifecycle constant (Proposed=72,
  // Approved/built=55, else 45) and so picked an arbitrary Proposed record while calling
  // it the most important project in the ZIP.
  //
  // WHY RECENCY AND NOT MAGNITUDE: no magnitude field is populated enough to rank on.
  // Measured across the whole table 2026-08-09 — `size` 5 of 3,027,784 rows,
  // `investment` 5, `jobs` 0; there is no acreage or capacity column at all. Ranking on
  // a field present in 0.0002% of rows would make a magnitude claim about the rest.
  // Recency is the one attribute every dated record genuinely has, so it is the only
  // thing the label may assert — hence "Recent Development", not "flagship".
  // Returns null for an empty list; callers must render an honest empty state.
  HS.featuredProject = function (projects) {
    const list = Array.isArray(projects) ? projects.filter(Boolean) : [];
    if (!list.length) return null;
    return list.slice().sort(function (a, b) {
      const da = a.submitted_at ? String(a.submitted_at) : '';
      const db = b.submitted_at ? String(b.submitted_at) : '';
      if (da !== db) return db.localeCompare(da);        // dated first, newest first
      return String(a.id).localeCompare(String(b.id));   // stable, deterministic
    })[0];
  };

  const arrow = dir => dir === 'down' ? '↓' : '↑';

  // User-facing branding for the proprietary per-project score (presentation layer only).
  const QOL_IMPACT_SCORE_BRAND = 'Quality of Life Impact Score<sup>™</sup>';

  const tpl = {
    qolImpactScoreBrand: QOL_IMPACT_SCORE_BRAND,
    // The chip row WITH its wrapper — '' when there are no chips, so a card never emits
    // an empty <div class="impacts"> that still occupies its margin. impact_dimensions is
    // populated on 0 of 3,027,784 app_projects rows, so on development cards this wrapper
    // was always empty; alert/notice cards can carry real `impacts` and are unaffected.
    impactsBlock(impacts) {
      const chips = tpl.impactChips(impacts);
      return chips ? `<div class="impacts">${chips}</div>` : '';
    },

    impactChips(impacts) {
      return (impacts || []).map(i =>
        `<span class="ichip ${i.bad ? 'bad' : 'good'}"><span class="cd ${esc(i.k)}"></span>${esc(i.label)} <span class="ar">${arrow(i.dir)}</span></span>`
      ).join('');
    },

    windowPill(item) {
      const d = daysUntil(item.window_closes_at);
      if (item.window_closes_at && d != null && d >= 0)
        return `<span class="win">◔ ${d === 0 ? 'Window closes today' : 'Window closes in ' + d + ' day' + (d === 1 ? '' : 's')}</span>`;
      if (item.category && /water|environment/i.test(item.category) && item.confidence === 'Medium')
        return `<span class="win soft">Advisory possible</span>`;
      return '';
    },

    // Full alerts story card
    storyCard(c) {
      const why = c.why ? `
        <details class="why"><summary>ⓘ Why you're seeing this</summary>
          <div class="wbody">
            ${c.why.source ? `<div class="r"><b>Source:</b> ${esc(c.why.source)}</div>` : ''}
            ${c.why.rank ? `<div class="r"><b>Why it ranks high for you:</b> ${esc(c.why.rank)}</div>` : ''}
            ${c.why.confidence ? `<div class="r"><b>Confidence:</b> ${esc(c.why.confidence)}</div>` : ''}
          </div></details>` : '';
      const win = tpl.windowPill(c);
      const beat = c.beat ? `<span style="color:var(--ink-3)">${esc(c.beat)}</span>` : '';
      const href = c.related_project_id ? `development.html?id=${encodeURIComponent(c.related_project_id)}` : (c.source_ref || '#');
      return `
      <div class="card" data-alert-id="${esc(c.id)}" style="border-left-color:${barColor(c)}">
        <span class="lens"><span class="sw ${esc(c.lens || 'traffic')}"></span>${esc(c.category || '')}</span>
        <h3>${esc(c.title)}</h3>
        <p class="sowhat"><b>What it means for you:</b> ${esc(c.plain_language)}</p>
        ${tpl.impactsBlock(c.impacts)}
        ${why}
        <div class="foot">
          <div class="meta">${win || beat}${c.dist ? `<span class="dist">${esc(c.dist)}</span>` : ''}</div>
          <div class="actions">${tpl.cardActions(c)}</div>
        </div>
      </div>`;
    },

    cardActions(c) {
      if (c.related_project_id)
        return `<button class="btn primary" onclick="location.href='development.html?id=${encodeURIComponent(c.related_project_id)}'">See detail →</button>`;
      const ref = c.source_ref
        ? `<button class="btn" onclick="window.open('${esc(c.source_ref)}','_blank','noopener')">Read →</button>` : '';
      return ref + `<button class="btn ghost" onclick="HS.toggleFollow(this,'change','${esc(c.id)}')">Notify me</button>`;
    },

    // compact card (dashboard / maps / community / property)
    miniCard(item, lensLabel) {
      return `
      <div class="card mini" style="border-left-color:${barColor(item)}">
        <span class="lens"><span class="sw ${esc(item.lens || 'traffic')}"></span>${esc(lensLabel || item.category || '')}</span>
        <h3>${esc(item.title || item.name)}</h3>
        <p class="sowhat">${item.plain_language ? '<b>What it means for you:</b> ' + esc(item.plain_language) : esc(item.sowhat || '')}</p>
        ${tpl.impactsBlock(item.impacts || item.impact_dimensions)}
      </div>`;
    },

    miniCardLink(item, lensLabel, href) {
      if (!href) return tpl.miniCard(item, lensLabel);
      return `
      <a class="card mini clickable card-link" href="${esc(href)}" style="border-left-color:${barColor(item)};display:block;text-decoration:none;color:inherit">
        <span class="lens"><span class="sw ${esc(item.lens || 'traffic')}"></span>${esc(lensLabel || item.category || '')}</span>
        <h3>${esc(item.title || item.name)}</h3>
        <p class="sowhat">${item.plain_language ? '<b>What it means for you:</b> ' + esc(item.plain_language) : esc(item.sowhat || '')}</p>
        ${tpl.impactsBlock(item.impacts || item.impact_dimensions)}
      </a>`;
    },

    // Renders NOTHING when there is no displayable score — no paragraph, no label, no
    // em-dash placeholder. It used to emit "Quality of Life Impact Score™: —", which is
    // an orphan label: it names a measurement and then shows the absence of one. With
    // the score gated off (lib/impact.js) this returns '' on every card, so the factual
    // status already on each card — the lens line's "PROPOSED · 1.3 MI", the status
    // chip, the Status/Stage table columns — is what the reader is left with.
    impactScoreLine(p) {
      const val = (HS.impactScoreValue && HS.impactScoreValue(p.impact_score)) || '';
      if (!val) return '';
      return `<p class="impactline"><b>${QOL_IMPACT_SCORE_BRAND}:</b> ${esc(val)}</p>`;
    },

    // TRUE when the generated summary restates only what a card's lens line already
    // shows (type · status) and carries nothing further. Used to drop a duplicate
    // caption — "DEVELOPMENT · PROPOSED" followed by "Development · proposed" — never to
    // hide real metadata: the comparison is against the exact bare string, so the moment
    // factualSowhat has a size, an investment or a named owner to add, the strings differ
    // and the line renders. A source-written summary (sowhat_factual false, e.g. a TABS
    // scope_text) is never suppressed.
    summaryAddsNothing(p) {
      if (!p || !p.sowhat_factual || !p.sowhat) return false;
      const bare = [p.type, p.status && String(p.status).toLowerCase()]
        .filter(Boolean).join(' · ');
      return p.sowhat === bare;
    },

    devImpactBlock(p) {
      return `<p class="impactline"><b>Impact:</b> ${esc((HS.projectImpact && HS.projectImpact(p)) || '')}</p>`
        + tpl.impactScoreLine(p);
    },

    // clickable development project card
    devCard(p) {
      const statusClass = p.status === 'Active' ? 'active' : p.status === 'Approved' ? 'appr' : 'prop';
      return `
      <div class="card clickable" style="border-left-color:${barColor(p)}" onclick="location.href='development.html?id=${encodeURIComponent(p.id)}'">
        <span class="lens"><span class="sw ${esc(p.lens || 'value')}"></span>${esc(p.status)} · ${esc(p.dist || p.type)}</span>
        <h3>${esc(p.name)}</h3>
        ${tpl.devImpactBlock(p)}
        <p class="sowhat"><b>${p.sowhat_factual ? 'On the record:' : 'How it impacts you:'}</b> ${esc(p.sowhat || '')}</p>
        ${tpl.impactsBlock(p.impact_dimensions)}
        <div class="foot">
          <div class="meta"><span style="color:var(--ink-3)">${esc(p.stage || '')}</span>${p.dist ? `<span class="dist">${esc(p.dist)}</span>` : ''}</div>
          <div class="actions"><span class="status ${statusClass}">${esc(p.status)}</span></div>
        </div>
      </div>`;
    },

    statTile(n, label, cls) {
      return `<div class="stat ${cls || ''}"><div class="n">${n}</div><div class="l">${esc(label)}</div></div>`;
    },

    statTileLink(n, label, cls, href) {
      if (!href) return tpl.statTile(n, label, cls);
      return `<a class="stat stat-link ${cls || ''}" href="${esc(href)}"><div class="n">${n}</div><div class="l">${esc(label)}</div></a>`;
    },

    scoreRing(score, pct) {
      const p = pct != null ? pct : score;
      return `<div class="ring" style="--p:${p}"><div class="in">${esc(score)}</div></div>`;
    },

    scoreBars(components) {
      return Object.keys(components || {}).map(k => {
        const c = components[k], label = k.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
        const fill = c.tone === 'blue' ? 'var(--blue)' : c.tone === 'green-2' ? 'var(--green-2)' : 'var(--amber)';
        return `<div class="sb"><div class="sl"><span>${esc(label)}</span><b>${esc(c.label)}</b></div>
          <div class="track"><div class="fill" style="width:${c.pct}%;background:${fill}"></div></div></div>`;
      }).join('');
    },

    thread(events) {
      return (events || []).map(e => `
        <div class="tev ${e.future ? 'future' : ''}"><span class="tk"></span><div>
          <div class="td">${esc(e.date)}</div><div class="tt">${esc(e.title)}</div>
          ${e.link ? `<div class="tl">↳ ${esc(e.link)}</div>` : ''}</div></div>`).join('');
    },

    meetingRow(m) {
      const when = fmtDate(m.starts_at) + ' · ' +
        new Date(m.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
      const d = daysUntil(m.window_closes_at || m.starts_at);
      return `<div class="aw"><span class="ak"></span><div>
        <div class="at">${esc(m.title || m.body)}</div>
        <div class="ad">${esc(when)}${m.location ? ' · ' + esc(m.location) : ''}</div>
        ${d != null && d >= 0 && d <= 10 ? `<div class="au">${d === 0 ? 'Today' : d + ' day' + (d === 1 ? '' : 's') + ' away'}</div>` : ''}
      </div></div>`;
    },

    meetingRowLink(m, href) {
      if (!href) return tpl.meetingRow(m);
      const when = fmtDate(m.starts_at) + ' · ' +
        new Date(m.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
      const d = daysUntil(m.window_closes_at || m.starts_at);
      return `<a class="aw aw-link" href="${esc(href)}">
        <span class="ak"></span><div>
        <div class="at">${esc(m.title || m.body)}</div>
        <div class="ad">${esc(when)}${m.location ? ' · ' + esc(m.location) : ''}</div>
        ${d != null && d >= 0 && d <= 10 ? `<div class="au">${d === 0 ? 'Today' : d + ' day' + (d === 1 ? '' : 's') + ' away'}</div>` : ''}
      </div></a>`;
    }
  };
  HS.tpl = tpl;

  // ── Regulated-facility interpretation (docs/regulated-facilities-entity-spec §5) ──
  // Works on app_projects.facility_env = { link_type, epa?, tceq?, tceq_rn?, tceq_url? } —
  // the engine's geo-matched environmental record, materialized verbatim (never re-fetched).
  // HONESTY RULES:
  //   • Permit statuses are VERBATIM ECHO ICIS-NPDES strings (live-verified 2026-07-17:
  //     ECHO says "Admin Continued", not "Administratively Continued" — both accepted).
  //   • An unknown/absent status interprets to NOTHING — callers render the explicit
  //     "permit status not yet confirmed" state, never a guess.
  //   • Enforcement ZEROS are a positive signal ONLY while compliance tracking is on.
  //     A Terminated/Retired/Pending permit's zeros reflect an UNTRACKED permit, not a
  //     verified clean history — that caveat must render wherever the zeros would.
  const FAC_STATUTE_WORD = { CWA: 'Clean Water Act', CAA: 'Clean Air Act', RCRA: 'RCRA hazardous-waste', SDWA: 'Safe Drinking Water Act' };
  const FAC_VIOLATION_WORD = { CWA: 'water', CAA: 'air', RCRA: 'hazardous-waste', SDWA: 'drinking-water', TSCA: 'chemical', FIFRA: 'pesticide', EPCRA: 'chemical-reporting' };
  const FAC_TRACKING_OFF_CAVEAT = 'Once a permit is inactive, EPA turns compliance tracking off — so zero-violation counts reflect an untracked permit, not a verified clean operating history.';
  const FAC_STATUS = {
    'Effective':                  { line: w => `Active ${w} permit — currently permitted discharger`, tracking: true },
    'Admin Continued':            { line: w => `Active ${w} permit, renewal pending (operating under prior terms)`, tracking: true },
    'Administratively Continued': { line: w => `Active ${w} permit, renewal pending (operating under prior terms)`, tracking: true },
    'Expired':                    { line: w => `${w} permit expired — EPA still counts it as active`, tracking: true },
    'Pending':                    { line: w => `${w} permit application pending`, tracking: false },
    'Not Needed':                 { line: () => 'No permit required at this facility', tracking: false,
                                    caveat: 'No permit is required here, so there is no compliance history to report.' },
    'Retired':                    { line: w => `${w} permit retired — no longer an active permitted discharger`, tracking: false },
    'Terminated':                 { line: w => `${w} permit terminated — past its end date, no longer active`, tracking: false }
  };
  // TCEQ program_code → plain-language meaning (same vocabulary as homesignalmap.html's
  // ENV_TCEQ_PROGRAMS, derived from the real Central-Registry vocabulary, verified 2026-07-11).
  const FAC_TCEQ_PROGRAMS = [
    [/^(LPST|LUST)/, ['leaking petroleum-tank cleanup on record', 'alert']],
    [/^(VCP|IOP|BROWNFIELD|SUPERFUND|STATESUP|CERCLA)/, ['enrolled in a state cleanup program', 'alert']],
    [/^(SPILL|EMERGENC)|^ER$/, ['emergency-response / spill record', 'alert']],
    [/^PST/, ['petroleum storage tank on record', 'watch']],
    [/^IHW/, ['industrial / hazardous-waste handler', 'watch']],
    [/^MSW/, ['municipal solid-waste site', 'watch']],
    [/^TIRE/, ['scrap-tire site', 'watch']],
    [/^(USEDOIL|LIOL|WATEROL)/, ['used-oil / registration on record', 'watch']],
    [/^SLUDGE/, ['biosolids / sludge registration', 'watch']],
    [/^STORM/, ['construction / industrial stormwater permit', 'progress']],
    [/^(WW|WQ|TPDES)/, ['wastewater / water-quality permit', 'info']],
    [/^PWS/, ['public water system', 'info']],
    [/^(AIR|NSR|AQ)/, ['air-quality permit', 'info']],
    [/^OSSF/, ['on-site sewage (septic) facility', 'info']]
  ];
  // ───────────────────── COMPANY / PROPERTY IDENTITY ─────────────────────────
  // The relationship model behind "Who's behind it". Roles are DISTINCT and are never
  // collapsed into one generic company field:
  //
  //   Property / Facility
  //     -> Property Owner   -> Parent Company (verified only)
  //     -> Developer        -> Parent Company (verified only)
  //     -> Applicant
  //     -> Operator         -> Parent Company (verified only)
  //     -> Contact / Filed By / Design Firm   (people + service providers on the filing)
  //
  // LINEAGE IS NEVER COLLAPSED. A parent renders BESIDE its subsidiary, never instead of
  // it: "Operator: ABC Operations LLC" keeps its own row and gains a "Parent company:
  // ABC Holdings, Inc." line beneath. The direct operating/legal entity is the fact the
  // record establishes; the parent is a separate, separately-evidenced fact.
  //
  // A PARENT NAME RENDERS ONLY FOR verification === 'verified'. The database already
  // makes an unverified parent unstorable (company_parents CHECK constraints), and this
  // is the second, independent gate: a `parent` object carrying a name with any other
  // verification value is treated as absent. Shared founders, shared executives, shared
  // investors, similar names, news co-occurrence and "same corporate ecosystem" are not
  // evidence, and none of them can reach this function as one.
  // Roles a corporate parent can hang off. Contact / Filed By are people and Design Firm is
  // a vendor, so they are deliberately absent: printing "Parent company — not yet verified"
  // under a named individual invents a question that does not exist.
  const PARENT_ROLES = ['Owner', 'Property Owner', 'Facility Owner', 'Developer', 'Applicant', 'Operator'];

  // The four roles the identity layer resolves, in the order a resident reads them:
  // who owns the land/building, who is building it, who applied, who runs it.
  // 'Facility Owner' is deliberately NOT 'Property Owner'. EPA FRS OWNER is an affiliation to
  // a REGULATED FACILITY — it does not establish who holds title to the parcel. A TDLR owner
  // block, a county deed and an FRS facility owner are three different claims, so they get
  // three different labels and the weakest one never borrows the strongest one's words.
  const IDENTITY_ROLES = ['Property Owner', 'Facility Owner', 'Developer', 'Applicant', 'Operator'];
  // Same rule as the database's app_company_key(): fold case and punctuation ONLY.
  // Corporate suffixes are kept, so "Neuralink" and "Neuralink Corporation" stay different
  // companies — merging them would infer a relationship from name similarity.
  function norm(nm) { return String(nm || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  // ── CONSUMER PRESENTATION LAYER ────────────────────────────────────────────────────────
  // The evidence model is unchanged: VERIFIED / HIGH_CONFIDENCE / UNRESOLVED remain the
  // internal data-quality states, with their storage constraints intact. What follows is
  // the translation a homeowner reads. The enum strings themselves must never reach the
  // page — not as text, not as a CSS class — so `tone()` maps them to neutral words.
  //
  //   VERIFIED         -> "Verified"          an authoritative source establishes it
  //   HIGH_CONFIDENCE  -> "Reported"          an official filing names the entity, but the
  //                                           relationship is not confirmed at the strongest
  //                                           level available (a TDLR owner block is not a deed)
  //   UNRESOLVED       -> "Not yet verified"
  const CONSUMER_LABEL = { VERIFIED: 'Verified', HIGH_CONFIDENCE: 'Reported', UNRESOLVED: 'Not yet verified' };
  const CONSUMER_TONE = { VERIFIED: 'verified', HIGH_CONFIDENCE: 'reported', UNRESOLVED: 'unverified' };

  // Recognisable source names, matched against the evidence text. `short` is what a person
  // would call the agency; `phrase` completes "Reported in …". An endpoint or dataset id is
  // never one of these — the machine URL lives behind the disclosure.
  const SOURCE_ORGS = [
    { re: /\bTCEQ\b|Central Registry/i, short: 'TCEQ',
      full: 'Texas Commission on Environmental Quality (TCEQ)', phrase: 'state environmental records (TCEQ)' },
    { re: /\bTDLR\b|\bTABS\b/i, short: 'TDLR',
      full: 'Texas Department of Licensing and Regulation (TABS)', phrase: 'a state licensing filing (TDLR)' },
    { re: /\bSEC\b|Exhibit 21|Form 10-K|EDGAR/i, short: 'SEC',
      full: 'U.S. Securities and Exchange Commission', phrase: 'an SEC filing' },
    { re: /City of Austin/i, short: 'City of Austin',
      full: 'City of Austin', phrase: 'a City of Austin filing' },
    { re: /Travis County|Travis CAD/i, short: 'Travis County',
      full: 'Travis County', phrase: 'Travis County property records' },
    { re: /Facility Registry Service|\bFRS\b/i, short: 'EPA',
      full: 'U.S. Environmental Protection Agency — Facility Registry Service (FRS)',
      phrase: 'EPA facility records' },
    { re: /\bEPA\b|\bECHO\b/i, short: 'EPA',
      full: 'U.S. Environmental Protection Agency', phrase: 'EPA records' }
  ];
  const SOURCE_FALLBACK = { short: '', full: '', phrase: 'an official filing' };

  // Plural forms, so a record with two operators does not read "Operator" twice.
  const ROLE_PLURAL = {
    'Facility Owner': 'Facility owners',
    'Property Owner': 'Property owners', 'Developer': 'Developers',
    'Applicant': 'Applicants', 'Operator': 'Operators', 'Owner': 'Owners',
    'Contact': 'Contacts', 'Filed By': 'Filed by', 'Design Firm': 'Design firms'
  };
  const ROLE_SINGULAR = {
    'Facility Owner': 'Facility owner',
    'Property Owner': 'Property owner', 'Developer': 'Developer', 'Applicant': 'Applicant',
    'Operator': 'Operator', 'Owner': 'Owner', 'Contact': 'Contact',
    'Filed By': 'Filed by', 'Design Firm': 'Design firm'
  };
  HS.parties = {
    PARENT_ROLES: PARENT_ROLES.slice(),
    // Every role the model supports. Present so a future source can emit Developer /
    // Applicant / Operator and render with no code change; absent roles simply never appear.
    ROLES: ['Owner', 'Developer', 'Applicant', 'Operator', 'Contact', 'Filed By', 'Design Firm'],
    IDENTITY_ROLES: IDENTITY_ROLES.slice(),
    list(item) {
      const a = item && item.parties;
      return Array.isArray(a) ? a.filter(p => p && p.name && p.role) : [];
    },
    // Roles resolved by the identity layer, each carrying the source that STATES it.
    // Ordered by role, then most-recent evidence first within a role — a regulator can
    // list more than one responsible party for the same site, and dropping the older one
    // would be editing the registry rather than reporting it.
    identity(item) {
      const a = item && item.identity;
      if (!Array.isArray(a)) return [];
      return a.filter(p => p && p.name && IDENTITY_ROLES.indexOf(p.role) !== -1)
        .slice()
        .sort((x, y) => (IDENTITY_ROLES.indexOf(x.role) - IDENTITY_ROLES.indexOf(y.role))
          || String(y.evidence_date || '').localeCompare(String(x.evidence_date || '')));
    },
    // ── EPA FRS organization affiliations ────────────────────────────────────────────────
    // A complementary source: government-published roles, but the organization is identified
    // by NAME, so it never outranks the identifier-backed TCEQ chain or a direct filing.
    // The database has already arbitrated each row; `suppressed_reason` says why one is not
    // displayable — 'agrees' (a stronger source names the same company, so show it once) or
    // 'conflict' (a stronger source names a different company; kept for internal review and
    // deliberately NOT surfaced on the card).
    frsCurrent(item) {
      const a = (item && item.frs && item.frs.current) || [];
      return Array.isArray(a) ? a.filter(p => p && p.name && !p.suppressed_reason) : [];
    },
    frsSuppressed(item, reason) {
      const a = (item && item.frs && item.frs.current) || [];
      return Array.isArray(a) ? a.filter(p => p && p.suppressed_reason === reason) : [];
    },
    // FORMER OWNER / FORMER OPERATOR. Never current, so never in "who's behind this".
    frsHistory(item) {
      const a = (item && item.frs && item.frs.history) || [];
      return Array.isArray(a) ? a.filter(p => p && p.name) : [];
    },
    // PARENT COMPANY / PARENT OWNER. Evidence only — an FRS name affiliation can never make
    // a parent verified, and nothing inherits through it.
    frsParentCandidates(item) {
      const a = (item && item.frs && item.frs.parent_candidates) || [];
      return Array.isArray(a) ? a.filter(p => p && p.name) : [];
    },
    // An FRS affiliation with no END_DATE is NOT evidence that it is current: end dates are
    // populated on ~1.3% of Texas rows. Any date wording must say "from", never "since" or
    // "current".
    frsPeriod(p) {
      const s = (p && p.start_date) || '', e = (p && p.end_date) || '';
      if (s && e) return s + ' to ' + e;
      if (s) return 'recorded from ' + s;
      if (e) return 'ended ' + e;
      return '';
    },

    // Parties the filing states that the identity layer has NOT superseded. A TDLR "Owner"
    // resolved to a Property Owner would otherwise print twice — once bare, once with its
    // evidence — and the bare copy reads as a second, unsourced claim.
    filed(item) {
      const resolved = this.identity(item).map(p => norm(p.name));
      return this.list(item).filter(p =>
        !(p.role === 'Owner' && resolved.indexOf(norm(p.name)) !== -1));
    },
    // Internal state -> the words a homeowner reads. '' when the record carries no state
    // at all (an as-filed party), which renders no badge rather than an empty one.
    consumerLabel(v) { return CONSUMER_LABEL[String(v || '').toUpperCase()] || ''; },
    // Neutral class token, so no enum string reaches the markup.
    tone(v) { return CONSUMER_TONE[String(v || '').toUpperCase()] || ''; },
    // Which agency stated this, in a name a person recognises. Read from the evidence TEXT,
    // never from the URL — a hostname is exactly the technical detail this keeps off the card.
    sourceOrg(p) {
      const t = String((p && p.source) || '');
      for (const o of SOURCE_ORGS) if (o.re.test(t)) return o;
      return SOURCE_FALLBACK;
    },
    // The one evidence sub-line under a company name. Consumer words only.
    evidenceLine(p) {
      const label = this.consumerLabel(p && p.verification);
      if (!label) return '';
      if (label === 'Reported') return 'Reported in ' + this.sourceOrg(p).phrase;
      if (label === 'Not yet verified') return 'Not yet verified';
      const org = this.sourceOrg(p);              // Verified: the badge carries the word,
      return org.short ? 'Confirmed in ' + org.phrase : '';   // this line names the source
    },
    roleLabel(role, n) {
      const r = String(role || '');
      return (n > 1 ? (ROLE_PLURAL[r] || r + 's') : (ROLE_SINGULAR[r] || r));
    },
    // Resolved roles first, then anyone else the filing names, each role appearing ONCE with
    // all of its entities under it. A role with no party is simply not a group — the card
    // never prints "Developer — not yet verified" for a role no source mentions.
    groups(item) {
      const out = [], seen = Object.create(null);
      const push = (p, kind) => {
        const k = kind + '|' + p.role;
        if (!seen[k]) { seen[k] = { role: p.role, kind, rows: [] }; out.push(seen[k]); }
        seen[k].rows.push(p);
      };
      this.identity(item).forEach(p => push(p, 'resolved'));
      // FRS sits BELOW the identity layer in the hierarchy, so its rows are added after —
      // and only the ones the database left displayable. An FRS row that agrees with a
      // stronger source is not added again (the company would appear twice); one that
      // conflicts is not added at all (it is in the internal conflict register instead).
      this.frsCurrent(item).forEach(p => push(p, 'resolved'));
      this.filed(item).forEach(p => push(p, 'filed'));
      return out.map(g => Object.assign(g, { label: this.roleLabel(g.role, g.rows.length) }));
    },
    // The honest empty state. "Not yet available" — never "this property has no owner",
    // which would claim a search concluded that nobody owns it.
    EMPTY_MESSAGE: 'Company and ownership information is not yet available for this record.',
    parentEligible(role) { return PARENT_ROLES.indexOf(String(role || '')) !== -1; },
    // A city, county or state agency has no corporate parent, so the question does not
    // arise — printing "Parent company — not yet verified" under City of Austin would
    // invent an open question about a body that cannot have one.
    GOVERNMENT_ENTITY: /^(municipality|city|county|state|federal|government|public agency|district)$/i,
    // -> null            role cannot have a corporate parent (a person, a design firm)
    // -> {verified:true, name, …}   an authoritative relationship
    // -> {verified:false}           eligible, but nothing verified yet
    parent(p) {
      if (!p || !this.parentEligible(p.role)) return null;
      if (p.entity_type && this.GOVERNMENT_ENTITY.test(String(p.entity_type))) return null;
      const pa = p.parent;
      if (pa && pa.verification === 'verified' && pa.name) {
        return { verified: true, name: pa.name, source: pa.source, url: pa.url,
                 evidence_date: pa.evidence_date, retrieved_at: pa.retrieved_at,
                 attribution: pa.attribution || 'parent_company' };
      }
      return { verified: false };
    },
    // "…, FREMONT, California 94555" -> "Fremont, California". The party's town is
    // orientation; the full mailing address and phone stay in the record. '' when the
    // string has no recognisable city/state tail — never a guess.
    place(addr) {
      const m = /,\s*([A-Za-z .'-]+),\s*([A-Za-z .]{2,})\b[^,]*$/.exec(String(addr || ''));
      if (!m) return '';
      return m[1].trim().replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
             + ', ' + m[2].trim();
    },
    // One entity. The parent, when verified, is nested UNDERNEATH it — the direct company is
    // the fact the record establishes, and the parent hangs off it rather than replacing it
    // or floating as a sibling row that could be read as a second owner of the real estate.
    //
    // An UNVERIFIED parent prints nothing here. Repeating "Parent company — not yet verified"
    // under every company is noise that crowds out the relationships we do have; the open
    // question is still stated, once per company, inside Sources & verification.
    entityHTML(p) {
      const where = this.place(p.address);
      const par = this.parent(p);
      const label = this.consumerLabel(p.verification);
      const badge = label === 'Verified'
        ? ' <span class="pver verified">✓ Verified</span>' : '';
      const line = this.evidenceLine(p);
      // The legal name only earns a line when it differs from the name as filed —
      // repeating an identical string reads as two separate facts.
      const legal = (p.legal_name && norm(p.legal_name) !== norm(p.name))
        ? '<span class="pmeta">' + esc(p.legal_name) + '</span>' : '';
      let parentHTML = '';
      if (par && par.verified) {
        parentHTML = '<span class="pparent"><span class="parr" aria-hidden="true">↳</span> '
          + 'Parent company: <b>' + esc(par.name) + '</b>'
          + ' <span class="pver verified">✓ Verified</span></span>';
      }
      return '<div class="pent"><span class="pname"><b>' + esc(p.name) + '</b>' + badge + '</span>'
        + legal
        + (where ? '<span class="pmeta">' + esc(where) + '</span>' : '')
        + (line ? '<span class="pev ' + esc(this.tone(p.verification)) + '">' + esc(line) + '</span>' : '')
        + parentHTML + '</div>';
    },
    // The whole section body: one block per role, or the single honest empty line.
    groupsHTML(item) {
      const gs = this.groups(item);
      if (!gs.length) return '<p class="pempty">' + esc(this.EMPTY_MESSAGE) + '</p>';
      return gs.map(g => '<div class="prow"><span class="prole">' + esc(g.label) + '</span>'
        + '<span class="pents">' + g.rows.map(p => this.entityHTML(p)).join('') + '</span></div>').join('');
    },
    // Structured evidence for the Sources & verification disclosure — one entry per
    // relationship, plus one per parent question (answered or open). Consumer-facing fields
    // only: no company keys, no record ids, no internal state strings.
    evidenceEntries(list) {
      const out = [];
      (list || []).forEach(p => {
        if (!p) return;
        const org = this.sourceOrg(p);
        // A resolved role carries the source that states it. As-filed parties carry none —
        // their evidence IS the filing already linked at the top of the card.
        if (p.source) {
          out.push({
            role: this.roleLabel(p.role, 1), entity: p.name,
            status: this.consumerLabel(p.verification), tone: this.tone(p.verification),
            org: org.full, document: p.source, url: p.url || '',
            filed: p.evidence_date || '', retrieved: p.retrieved_at || ''
          });
        }
        const par = this.parent(p);
        if (!par) return;                            // role cannot have a corporate parent
        if (par.verified) {
          const porg = this.sourceOrg(par);
          out.push({
            role: 'Parent company of ' + String(this.roleLabel(p.role, 1)).toLowerCase(),
            entity: par.name, status: 'Verified', tone: 'verified',
            org: porg.full, document: par.source || '', url: par.url || '',
            filed: par.evidence_date || '', retrieved: par.retrieved_at || '',
            note: 'Corporate parent of ' + p.name + '. This relationship is about company '
                + 'ownership, not ownership of the property.'
          });
        } else if (p.source) {
          // Stated once, here, rather than under every company on the card.
          out.push({
            role: 'Parent company of ' + String(this.roleLabel(p.role, 1)).toLowerCase(),
            entity: p.name, status: 'Not yet verified', tone: 'unverified',
            org: '', document: '', url: '', filed: '', retrieved: '',
            note: 'No authoritative corporate record establishing a parent company for '
                + p.name + ' has been found. We do not infer one from shared people, shared '
                + 'investors, a similar name or news coverage.'
          });
        }
      });
      return out;
    },
    // Ownership & operator history — FORMER roles, kept strictly out of the current section.
    // An FRS row with no END_DATE is NOT evidence of being current (end dates are populated
    // on ~1.3% of Texas rows), so the wording never says "since" or "present".
    historyHTML(item) {
      const rows = this.frsHistory(item);
      if (!rows.length) return '';
      return '<div class="isec"><h4>Ownership &amp; operator history</h4><div class="plist">'
        + rows.map(p => '<div class="prow"><span class="prole">' + esc(p.role) + ' (former)</span>'
            + '<span class="pents"><div class="pent"><span class="pname"><b>' + esc(p.name) + '</b></span>'
            + '<span class="pev">' + esc('Recorded in EPA facility records'
                + (this.frsPeriod(p) ? ' — ' + this.frsPeriod(p) : '')) + '</span></div></span></div>').join('')
        + '</div><p class="ihint">Past relationships as the record states them. These are not '
        + 'current roles, and an entry without an end date is not evidence that it still applies.</p></div>';
    },

    // Evidence for the disclosure: FRS provenance for every displayed affiliation, the
    // parent CANDIDATES (never a verified parent), and the corroborating rows that agree
    // with a stronger source. Conflicting rows are deliberately absent — they are recorded
    // internally for review rather than shown as an unresolved contradiction.
    frsEvidenceEntries(item) {
      const out = [];
      const cite = (p, roleLabel, note) => ({
        role: roleLabel, entity: p.name,
        status: p.verification ? this.consumerLabel(p.verification) : 'Reported',
        tone: 'reported',
        org: 'U.S. Environmental Protection Agency — Facility Registry Service (FRS)',
        document: [
          'FRS registry ' + (p.registry_id || ''),
          p.affiliation_type ? 'affiliation: ' + p.affiliation_type : '',
          p.program ? 'reported by ' + p.program + (p.program_id ? ' ' + p.program_id : '') : '',
          p.interest_type ? 'interest: ' + p.interest_type : '',
          p.duns ? 'DUNS ' + p.duns : '', p.ein ? 'EIN ' + p.ein : '',
          p.state_business_id ? 'state business id ' + p.state_business_id : '',
          this.frsPeriod(p), p.source_file || ''
        ].filter(Boolean).join(' · '),
        url: p.url || '', filed: '', retrieved: p.retrieved_at || '', note: note || null
      });
      this.frsCurrent(item).forEach(p => out.push(cite(p, p.role)));
      this.frsSuppressed(item, 'agrees').forEach(p => out.push(cite(p, p.role + ' — also reported by',
        'A second source names the same company for this role. Shown once above.')));
      this.frsHistory(item).forEach(p => out.push(cite(p, 'Former ' + String(p.role).toLowerCase(),
        'A past relationship. An entry without an end date is not evidence that it still applies.')));
      this.frsParentCandidates(item).forEach(p => out.push(cite(p, 'Reported parent affiliation',
        'EPA records name this organization as a parent of the facility operator. HomeSignal '
        + 'treats that as a lead, not a verified corporate parent, and nothing about this '
        + 'company is inherited from it.')));
      return out;
    },

    // Shown once, when at least one relationship on the card is labelled Reported.
    REPORTED_EXPLAINER: 'Reported — this entity is named in an official filing for this '
      + 'property or project, but the relationship has not been independently confirmed '
      + 'against a stronger ownership record.'
  };

  const FAC_TONE_RANK = { alert: 0, watch: 1, progress: 2, info: 3, ok: 4 };
  HS.fac = {
    // §5 interpreted status: { status, line, tracking, caveat } — or null when the permit
    // status isn't on record yet (caller renders the honest "not yet confirmed" state).
    interpret(fenv) {
      const epa = fenv && fenv.epa;
      const m = epa && epa.permit_status ? FAC_STATUS[epa.permit_status] : null;
      if (!m) return null;
      const statute = ((epa.permits || []).map(p => p.statute).filter(Boolean))[0];
      const word = FAC_STATUTE_WORD[statute] || 'discharge';
      const tracking = (typeof epa.compliance_tracking_on === 'boolean') ? epa.compliance_tracking_on : m.tracking;
      return { status: epa.permit_status, line: m.line(word), tracking,
               caveat: tracking ? null : (m.caveat || FAC_TRACKING_OFF_CAVEAT) };
    },
    // Real enforcement/compliance facts, most serious first: [{text, tone}]. Nothing is
    // invented — each line exists only for a value the engine stored. The positive
    // "no recorded EPA violations" baseline renders ONLY while tracking is on (§5 rule).
    signals(fenv) {
      const out = [], epa = fenv && fenv.epa, tceq = fenv && fenv.tceq;
      if (epa) {
        const inv = epa.in_violation || [];
        if (inv.length) {
          const words = inv.map(c => FAC_VIOLATION_WORD[c] || String(c).toLowerCase());
          out.push({ text: inv.length + ' open ' + words.join(' & ') + ' violation' + (inv.length === 1 ? '' : 's') + (epa.action_year ? ' (' + epa.action_year + ')' : ''), tone: 'alert' });
        } else if (epa.snc) {
          out.push({ text: 'flagged for significant non-compliance (EPA)', tone: 'alert' });
        } else if (epa.quarters_nc > 0) {
          out.push({ text: epa.quarters_nc + ' of last 12 quarters out of compliance (EPA)' + (epa.action_year ? ', last action ' + epa.action_year : ''), tone: 'watch' });
        }
        if (epa.penalty_count > 0) out.push({ text: epa.penalty_count + ' penalt' + (epa.penalty_count === 1 ? 'y' : 'ies') + ' on record (EPA)', tone: 'alert' });
        if (epa.inspections > 0) out.push({ text: epa.inspections + ' inspection' + (epa.inspections === 1 ? '' : 's') + ' on record (EPA)', tone: 'info' });
      }
      if (tceq && tceq.programs && tceq.programs.length) {
        const seen = {}, sigs = [];
        tceq.programs.forEach(code => {
          const c = String(code || '').toUpperCase();
          for (const [re, [label, tone]] of FAC_TCEQ_PROGRAMS) {
            if (re.test(c)) { if (!seen[label]) { seen[label] = 1; sigs.push({ text: label, tone }); } return; }
          }
        });
        sigs.sort((a, b) => FAC_TONE_RANK[a.tone] - FAC_TONE_RANK[b.tone]);
        out.push(...sigs);
      }
      const interp = this.interpret(fenv);
      if (!out.length && interp && interp.tracking === true) {
        out.push({ text: 'no recorded EPA violations (compliance tracking on)', tone: 'ok' });
      }
      return out;
    },
    // Official drill-down links for the dossier's Source section — EPA ECHO DFR built from
    // the FRS registry id (the one EPA-link path), plus TCEQ Central Registry when matched.
    links(row) {
      const out = [], fenv = row.facility_env || {};
      const rid = row.registry_id ? String(row.registry_id).trim() : '';
      if (rid) out.push({ label: 'View EPA source record →', url: 'https://echo.epa.gov/detailed-facility-report?fid=' + encodeURIComponent(rid) });
      else if (row.source_ref) out.push({ label: 'View public record →', url: row.source_ref });
      if (fenv.tceq_rn) out.push({ label: 'TCEQ Central Registry (' + fenv.tceq_rn + ') →', url: fenv.tceq_url || 'https://www15.tceq.texas.gov/crpub/' });
      return out;
    }
  };
})();
