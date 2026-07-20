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
    const s = item.impact_score != null ? item.impact_score : (item.confidence === 'High' ? 80 : 40);
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

  const arrow = dir => dir === 'down' ? '↓' : '↑';

  const tpl = {
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
        <div class="impacts">${tpl.impactChips(c.impacts)}</div>
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
        <div class="impacts">${tpl.impactChips(item.impacts || item.impact_dimensions)}</div>
      </div>`;
    },

    miniCardLink(item, lensLabel, href) {
      if (!href) return tpl.miniCard(item, lensLabel);
      return `
      <a class="card mini clickable card-link" href="${esc(href)}" style="border-left-color:${barColor(item)};display:block;text-decoration:none;color:inherit">
        <span class="lens"><span class="sw ${esc(item.lens || 'traffic')}"></span>${esc(lensLabel || item.category || '')}</span>
        <h3>${esc(item.title || item.name)}</h3>
        <p class="sowhat">${item.plain_language ? '<b>What it means for you:</b> ' + esc(item.plain_language) : esc(item.sowhat || '')}</p>
        <div class="impacts">${tpl.impactChips(item.impacts || item.impact_dimensions)}</div>
      </a>`;
    },

    // Phase-2 impact line content: when a resolved impact exists (shared
    // resolver, lib/impact-resolver.js) show level · score/100 · direction and
    // its grounded sentence; otherwise keep the Phase-1 deterministic sentence.
    // Everything else on the card is untouched (nothing removed or relocated).
    impactLineHTML(p) {
      const ir = p.impact_resolved;
      if (!ir) return esc((HS.projectImpact && HS.projectImpact(p)) || '');
      const lvl = ir.level.charAt(0).toUpperCase() + ir.level.slice(1);
      const dir = ir.direction.charAt(0).toUpperCase() + ir.direction.slice(1);
      return `<span class="ibadge ${esc(ir.level)}">${esc(lvl)} · ${ir.score | 0}/100</span>`
        + `<span class="idir ${esc(ir.direction)}">${esc(dir)}</span>`;
    },
    impactSentenceHTML(p) {
      const ir = p.impact_resolved;
      return ir ? `<p class="impactsentence">${esc(ir.sentence)}</p>` : '';
    },

    // clickable development project card
    devCard(p) {
      const statusClass = p.status === 'Active' ? 'active' : p.status === 'Approved' ? 'appr' : 'prop';
      return `
      <div class="card clickable" style="border-left-color:${barColor(p)}" onclick="location.href='development.html?id=${encodeURIComponent(p.id)}'">
        <span class="lens"><span class="sw ${esc(p.lens || 'value')}"></span>${esc(p.status)} · ${esc(p.dist || p.type)}</span>
        <h3>${esc(p.name)}</h3>
        <p class="impactline"><b>Impact:</b> ${tpl.impactLineHTML(p)}</p>
        ${tpl.impactSentenceHTML(p)}
        <p class="sowhat"><b>${p.sowhat_factual ? 'On the record:' : 'How it impacts you:'}</b> ${esc(p.sowhat || '')}</p>
        <div class="impacts">${tpl.impactChips(p.impact_dimensions)}</div>
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
