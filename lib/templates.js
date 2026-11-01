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

  // Place-context map heading. `kind` is the HOST's geography — Address-radius vs
  // ZIP-area — never inferred from the value (no regex, no digit count, no URL parse).
  // Unresolved / malformed values yield '' so the caller withholds the heading rather
  // than printing "See what is changing at undefined".
  HS.placeChangingHeading = function (kind, value) {
    var v = (value == null) ? '' : String(value).trim();
    if (!v) return '';
    var lower = v.toLowerCase();
    if (lower === 'undefined' || lower === 'null') return '';
    if (kind === 'address') return 'See what is changing at ' + v;
    if (kind === 'zip') return 'See what is changing in ' + v;
    return '';
  };

  // Canonical permit-status colors — THE one status→color mapping, used by every
  // surface (map pins via lib/map.js, card bars here, legends). Launch rule:
  // the same status is the same color on Dashboard, Maps, Alerts, and the
  // development pages — never re-derived per page.
  // `onfile` is the NEUTRAL — the colour a record gets when its source states no
  // lifecycle ("Lifecycle unknown"), and the swatch the type-shape legend rows use.
  // It was '#6b7f76', a desaturated GREEN, which put it in the SAME HUE FAMILY as
  // `operating`, so the two legend rows read as one colour at pin size (reported from
  // the live page, 2026-09-06). A neutral may not share a hue with a stage colour:
  // "the source states no lifecycle" and "operating now" are opposite claims and must
  // never look alike.
  //
  // Measured, CIEDE2000 (test/lifecycle-color-separation.test.mjs recomputes all of it):
  //                       operating   approved   proposed   facility   chroma  vs-white
  //   old  #6b7f76           22.2       33.6       35.6       34.3       9.5     4.27:1   lifecycle
  //                          19.6       22.2       31.6       34.3                        permit status
  //   new  #706468           33.5       28.8       32.0       26.8       5.6     5.66:1   lifecycle
  //                          37.8       25.7       31.2       26.8                        permit status
  // (the facility column is against the CURRENT purple; it was 26.7 against the old one,
  //  which moved for its own collision with `approved` — see lib/map.js FACILITY_HEX)
  // Every pair clears 25 on both surfaces, where the reported collision measured 22.2
  // and 19.6; chroma 5.6 keeps it reading as a warm grey rather than as a dim green.
  HS.statusHex = { proposed: '#c47a1a', approved: '#3f7fb0', operating: '#1f9d5c', onfile: '#706468' };
  // 'decided' browses as Proposed (the same rule as lib/project-type.js lifecycleKey and
  // lib/n5-radius.js n5BucketFromStatus — test/decided-lifecycle-parity.test.mjs holds the
  // three together). Without it a decided application's card bar fell through to the
  // impact-score heuristics below, while devCard() below claims it "keeps the Proposed styling".
  function statusKey(s) {
    s = String(s || '').toLowerCase();
    return (s === 'proposed' || s === 'decided') ? 'proposed'
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

  // THE FACILITY COUNT WHEN EPA DID NOT ANSWER (2026-10-23). One decision, read by Map 1's
  // counter and the ZIP page's strip. When EPA refuses a read, the refresh keeps the stored
  // facility list and holds development_reports.facilities_refreshed_at at the day it was last
  // written from a real EPA answer, so a stored count above zero is a count we confirmed on that
  // day. Show it with that date instead of hiding it. Measured 2026-10-23: of 2,045 flagged
  // pages, all 1,570 with a stored count above zero carry a held clock (older than the core
  // refresh) and all 475 with zero carry a clock equal to the core refresh, so a zero is never a
  // confirmed zero and stays a dash.
  //   opts.unavailable  development_reports.facilities_unavailable
  //   opts.count        the stored (or drawn) facility count
  //   opts.confirmedAt  development_reports.facilities_refreshed_at
  // Returns { mode: 'known' | 'dated' | 'unknown', count, confirmedOn } where confirmedOn is a
  // display date ('Sep 14, 2026') for mode 'dated' and '' otherwise.
  function facilityCount(opts) {
    opts = opts || {};
    const n = Number(opts.count);
    const count = Number.isFinite(n) && n > 0 ? n : 0;
    if (!opts.unavailable) return { mode: 'known', count, confirmedOn: '' };
    const on = count > 0 && opts.confirmedAt
      ? fmtDate(opts.confirmedAt, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    if (on && !/Invalid/.test(on)) return { mode: 'dated', count, confirmedOn: on };
    return { mode: 'unknown', count: null, confirmedOn: '' };
  }
  HS.facilityCount = facilityCount;

  const arrow = dir => dir === 'down' ? '↓' : '↑';

  // User-facing branding for the proprietary per-project score (presentation layer only).
  const QOL_IMPACT_SCORE_BRAND = 'Quality of Life Impact Score<sup>™</sup>';

  // ── CARD LINKS: WHERE A CARD OPENS AND WHAT KIND OF PAGE IT IS (founder, 2026-10-08) ──────────
  // Two rulings, one place. (1) A card whose URL is a DATASET or data feed (a city's permit
  // search page, an ArcGIS layer root, a SQL query URL) is labelled "Source data" so a resident
  // knows it is not a project page. The kind is NOT guessed from the URL: it is the connector's own
  // per-record `record_url_precision`, stored by app_refresh_zip in app_projects.provenance.url_precision.
  // Absent or unknown means NO label - the card claims nothing it cannot source.
  // (2) A Local News card whose stored URL is an api.weather.gov alert opens raw GeoJSON, and the API
  // forgets old alerts (a 2026-09-26 alert returned a 404 JSON error on 2026-10-08). NWS publishes no
  // readable page for one alert: on 2026-10-08, from the Supabase pg_net resolver, alerts.weather.gov did
  // not resolve, and an alert's own `web` field was only the weather.gov home page. So the card opens the
  // NWS forecast page for its ZIP, worded as THAT page. Measured 2026-10-08 on ZIP 90620: the page lists the
  // ZIP's current hazards (an Extreme Heat Warning) and not the Coastal Flood Advisory the card was about, so
  // the visible label says the page "may not list this alert". No valid ZIP means no link at all, never the
  // raw API URL. The stored source_ref is NOT touched (ingest dedupes on it).
  // scripts/gen_zip_pages.py renders the same link in the crawlable HTML by the same URL-host test;
  // test/card-link-kinds.test.mjs runs both classifiers on one URL list and pins the page and wording.
  const WEATHER_API_HOST = 'api.weather.gov';
  const WEATHER_ZIP_PAGE = 'https://forecast.weather.gov/zipcity.php?inputstring=';
  const SOURCE_DATA_LABEL = 'Source data';
  const WEATHER_LABEL = 'Weather.gov forecast for this ZIP (may not list this alert)';
  function hostOf(u) {
    try { return new URL(u).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return ''; }
  }
  function rawRecordUrl(item) {
    const u = String((item && (item.source_ref || item.record_url || item.url || item.source_url)) || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }
  function weatherZip(item) {
    const z = String((item && item.zip) || '').trim();
    return /^[0-9]{5}$/.test(z) ? z : '';
  }
  // A value placed inside a single-quoted JS string inside an inline onclick="..." attribute. esc() alone is NOT
  // enough: it leaves the single quote and the backslash alone, and the browser decodes HTML entities BEFORE
  // the script is parsed, so an entity is no escape either. JS-escape first, then HTML-escape the result.
  function jsStr(v) {
    return esc(String(v == null ? '' : v).replace(/[\\'\r\n\u2028\u2029]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    }));
  }

  const tpl = {
    qolImpactScoreBrand: QOL_IMPACT_SCORE_BRAND,
    impactChips(impacts) {
      return (impacts || []).map(i =>
        `<span class="ichip ${i.bad ? 'bad' : 'good'}"><span class="cd ${esc(i.k)}"></span>${esc(i.label)} <span class="ar">${arrow(i.dir)}</span></span>`
      ).join('');
    },

    windowPill(item) {
      // A cancelled meeting (alerts.html meetingAsChange) shows its badge, never a countdown.
      if (item && item.cancelled === true) return tpl.cancelledBadge(item);
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
      // The same one link decision as the ZIP-page cards (recordHref): a weather alert opens the readable NWS
      // forecast page for its ZIP, worded as that, or shows no Read button when its ZIP is unknown - never
      // the raw api.weather.gov feed. Every other record opens its own http(s) URL, as before.
      const href = tpl.recordHref(c);
      const wx = tpl.linkKind(c, href) === 'weather';
      const wxTip = 'Weather.gov forecast for ZIP ' + weatherZip(c) + ' (may not list this alert), opens in a new tab';
      const ref = href
        ? `<button class="btn" ${wx ? 'title="' + esc(wxTip) + '" aria-label="' + esc(wxTip) + '" ' : ''}onclick="window.open('${jsStr(href)}','_blank','noopener')">${wx ? 'Weather.gov forecast' : 'Read'} →</button>` : '';
      return ref + `<button class="btn ghost" onclick="HS.toggleFollow(this,'change','${jsStr(c.id)}')">Notify me</button>`;
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

    // The ONE place a record's link is read for a card. Only an http(s) URL the record itself
    // carries is ever used, and a record with no link stays a plain, non-interactive card. The
    // single exception is a weather alert (see the block above): its machine URL is swapped for
    // the readable NWS page for the card's ZIP, or for no link when the ZIP is unknown.
    recordHref(item) {
      const u = rawRecordUrl(item);
      if (u && hostOf(u) === WEATHER_API_HOST) {
        const z = weatherZip(item);
        return z ? WEATHER_ZIP_PAGE + z : '';
      }
      return u;
    },

    // What kind of page recordHref opens: 'weather' | 'dataset' | 'record'. 'dataset' only when the
    // engine's own stored precision says so; nothing is inferred from the URL.
    linkKind(item, href) {
      if (!href) return '';
      if (hostOf(rawRecordUrl(item)) === WEATHER_API_HOST) return 'weather';
      const pv = item && item.provenance;
      if (pv && typeof pv === 'object' && pv.url_precision === 'dataset') return 'dataset';
      return 'record';
    },

    // The small label that goes at the bottom of a linked card (a <span>, never a nested link: the whole card
    // is already an <a>). A plain record link shows no VISIBLE label, only a screen-reader hint that it opens in
    // a new tab. The arrow is decoration (aria-hidden); the hint is a space-led parenthetical so the card's own
    // text is read first and the kind of page is read last.
    linkNote(item, href) {
      const k = tpl.linkKind(item, href);
      const arrow = ' <span aria-hidden="true">\u2197</span>';
      if (k === 'dataset') {
        return '<span class="srclabel">' + SOURCE_DATA_LABEL + arrow
          + '<span class="sr-only"> (opens a data source page, not a project page, in a new tab)</span></span>';
      }
      if (k === 'weather') {
        return '<span class="srclabel wx">' + WEATHER_LABEL + arrow
          + '<span class="sr-only"> (opens the National Weather Service forecast for ZIP ' + esc(weatherZip(item)) + ' in a new tab)</span></span>';
      }
      if (k === 'record') return '<span class="sr-only"> (opens in a new tab)</span>';
      return '';
    },

    miniCardLink(item, lensLabel, href) {
      if (!href) return tpl.miniCard(item, lensLabel);
      return `
      <a class="card mini clickable card-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="border-left-color:${barColor(item)};display:block;text-decoration:none;color:inherit">
        <span class="lens"><span class="sw ${esc(item.lens || 'traffic')}"></span>${esc(lensLabel || item.category || '')}</span>
        <h3>${esc(item.title || item.name)}</h3>
        <p class="sowhat">${item.plain_language ? '<b>What it means for you:</b> ' + esc(item.plain_language) : esc(item.sowhat || '')}</p>
        <div class="impacts">${tpl.impactChips(item.impacts || item.impact_dimensions)}</div>
        ${tpl.linkNote(item, href)}
      </a>`;
    },

    impactScoreLine(p) {
      const val = (HS.impactScoreValue && HS.impactScoreValue(p.impact_score)) || '';
      const display = val || '—';
      return `<p class="impactline"><b>${QOL_IMPACT_SCORE_BRAND}:</b> ${esc(display)}</p>`;
    },

    // ── BROWSING CATEGORY LABEL (2026-09-20 decision-history contract) ─────────────
    // public.app_refresh_zip writes status 'Decided' for a record whose source stated a
    // decision. The bare word is unreadable on a card — it says a ruling happened and
    // hides WHICH category the application sits in, so a resident cannot tell a decided
    // proposal from a decided anything-else. This renders the BROWSING category first
    // and the decision second, which is the separation the contract requires:
    //   Proposed · decided
    // It deliberately does NOT name the outcome. `app_projects` carries no outcome word
    // today (only the 'Decided' status), and inventing "denied" from "decided" would be
    // the fabrication this whole workstream removes. The sourced outcome, its date and
    // its record link live on the Map 1 page, which reads the engine payload directly.
    // When the parked migration docs/decision-provenance-migration.sql is applied this
    // can read provenance.decision.outcome_label and say so here too.
    browsingStatusLabel(p) {
      const raw = String((p && p.status) || '').trim();
      if (raw.toLowerCase() !== 'decided') return raw;
      return 'Proposed · decided';
    },

    devImpactBlock(p) {
      return `<p class="impactline"><b>Impact:</b> ${esc((HS.projectImpact && HS.projectImpact(p)) || '')}</p>`
        + tpl.impactScoreLine(p);
    },

    // clickable development project card
    devCard(p) {
      const statusClass = p.status === 'Active' ? 'active' : p.status === 'Approved' ? 'appr' : 'prop';
      // A decided application keeps the Proposed styling (browsing category) and says so
      // in words — see browsingStatusLabel. Colour alone never carries the decision.
      const statusLabel = tpl.browsingStatusLabel(p);
      return `
      <div class="card clickable" style="border-left-color:${barColor(p)}" onclick="location.href='development.html?id=${encodeURIComponent(p.id)}'">
        <span class="lens"><span class="sw ${esc(p.lens || 'value')}"></span>${esc(statusLabel)} · ${esc(p.dist || p.type)}</span>
        <h3>${esc(p.name)}</h3>
        ${tpl.devImpactBlock(p)}
        <p class="sowhat"><b>${p.sowhat_factual ? 'On the record:' : 'How it impacts you:'}</b> ${esc(p.sowhat || '')}</p>
        <div class="impacts">${tpl.impactChips(p.impact_dimensions)}</div>
        <div class="foot">
          <div class="meta"><span style="color:var(--ink-3)">${esc(p.stage || '')}</span>${p.dist ? `<span class="dist">${esc(p.dist)}</span>` : ''}</div>
          <div class="actions"><span class="status ${statusClass}">${esc(statusLabel)}</span></div>
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

    // ONE "Cancelled" badge for every meeting surface (founder ruling 2026-10-19: a cancelled
    // public meeting stays listed and counted, and says so). The flag is m.cancelled, carried
    // from the database's is_cancelled computed field by lib/data.js; nothing here reads a
    // title to decide it.
    cancelledBadge(m) {
      return m && m.cancelled === true ? '<span class="mtg-cancelled">Cancelled</span>' : '';
    },

    // A cancelled meeting gets the badge INSTEAD of the "N days away" / "Today" countdown:
    // counting down to a meeting that will not happen would be a false prompt.
    meetingCountdown(m) {
      if (m && m.cancelled === true) return `<div class="au">${tpl.cancelledBadge(m)}</div>`;
      const d = daysUntil(m.window_closes_at || m.starts_at);
      return d != null && d >= 0 && d <= 10 ? `<div class="au">${d === 0 ? 'Today' : d + ' day' + (d === 1 ? '' : 's') + ' away'}</div>` : '';
    },

    meetingRow(m) {
      const when = fmtDate(m.starts_at) + ' · ' +
        new Date(m.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
      return `<div class="aw"><span class="ak"></span><div>
        <div class="at">${esc(m.title || m.body)}</div>
        <div class="ad">${esc(when)}${m.location ? ' · ' + esc(m.location) : ''}</div>
        ${tpl.meetingCountdown(m)}
      </div></div>`;
    },

    meetingRowLink(m, href) {
      if (!href) return tpl.meetingRow(m);
      const when = fmtDate(m.starts_at) + ' · ' +
        new Date(m.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
      return `<a class="aw aw-link" href="${esc(href)}">
        <span class="ak"></span><div>
        <div class="at">${esc(m.title || m.body)}</div>
        <div class="ad">${esc(when)}${m.location ? ' · ' + esc(m.location) : ''}</div>
        ${tpl.meetingCountdown(m)}
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

// ── SOURCE FRESHNESS (founder, 2026-11-01) ───────────────────────────────────────────────────
// One block, shown wherever development records are shown (Map 1, ZIP pages), that says for EACH
// development source three separate things:
//   1. the newest record date the source has published to us      (source-wide)
//   2. the last time a read of the source completed, anywhere       (source-wide)
//   3. whether THIS ZIP's own latest read of that source completed  (this ZIP only)
// Never one "stale"/"current" label for the page, and never "current" at all: a recent check says
// nothing about whether the source has newer records, so (1) is always shown beside (2). Data:
// public.source_freshness_for_zip (docs/source-freshness.sql). Universal: nothing here names a
// source except the reviewed coverage notes below.
(function () {
  const HS = (window.HS = window.HS || {});
  const esc = HS.esc;

  // REVIEWED COVERAGE NOTES. A limitation the source itself states, which the registry cannot say:
  // the registry's type_map describes how records are labelled, not what the publisher includes.
  // Every key must be a real registry_id (test/source-freshness.test.mjs). `noun` is how the
  // record is named in "Latest available <noun> record".
  HS.SOURCE_RECORD_SCOPE = {
    'portland-building-permits': {
      noun: 'Portland permit',
      scope: 'Residential building permits only',
      evidence: "The source is the City of Portland's 'Residential Building Permits' layer "
        + '(portlandmaps.com MapServer 89; dataset residential-building-permits). Commercial permits are not in it.'
    },
    // One programme published as two layers (points and lines); a reader needs to tell them apart.
    'oregon-dot-stip-projects': {
      name: 'ODOT Statewide Transportation Improvement Program (project points)',
      scope: 'State transportation projects only',
      evidence: 'ODOT STIP 2024-2027, layer 361 (points) of facs_stip/data_catalog on gis.odot.state.or.us (registry _receipts).'
    },
    // The five Oregon sources wired 2026-11-01 (#2487); limits stated by that PR's receipts and its session.
    'portland-neighborhood-contact-applications': {
      scope: 'Early notices before an application, not applications or decisions',
      evidence: "City of Portland open-data layer 1298 'Neighborhood Contact Applications': the notice a developer files "
        + 'before applying for a large building or land division (registry _receipts, #2487).'
    },
    'tigard-or-active-building-permits': {
      scope: 'Active permits only: new homes, additions, multifamily, commercial and demolition',
      evidence: "City of Tigard's active-permits layer, read with extra_where limited to those case types; trade, repair "
        + 'and finished permits are not in it (registry _receipts, #2487).'
    },
    'tigard-or-active-planning-cases': {
      scope: 'Active cases only; decided cases are not included',
      evidence: "City of Tigard's planning case layer; 'Decision Issued' cases are excluded (registry _receipts, #2487)."
    },
    'beaverton-or-site-development-permits': {
      scope: 'Commercial and subdivision site development permits only',
      evidence: "City of Beaverton's SD_Permits_Data, read for SDCOMM and SDSUB only; not building permits (registry _receipts, #2487)."
    },
    'eugene-or-current-capital-projects': {
      scope: 'City capital projects only, not private development',
      evidence: "City of Eugene's Current Projects layer: funded city transportation, stormwater, wastewater and parks work (registry _receipts, #2487)."
    },
    'oregon-dot-stip-projects-lines': {
      name: 'ODOT Statewide Transportation Improvement Program (project lines)',
      scope: 'State transportation projects only',
      evidence: 'ODOT STIP 2024-2027, layer 362 (lines) of facs_stip/data_catalog on gis.odot.state.or.us (registry _receipts).'
    }
  };

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  // 'YYYY-MM-DD' or an ISO timestamp -> 'October 1, 2026' (UTC calendar day; no clock time).
  HS.sourceFreshnessDate = function (v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v == null ? '' : v));
    if (!m) return '';
    const d = new Date(String(v).length > 10 ? v : (v + 'T00:00:00Z'));
    if (isNaN(d.getTime())) return '';
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  };

  // rows: source_freshness_for_zip output. labels: { registry_id: 'City of Portland' }.
  // Returns display entries; pure, so it is tested in Node.
  HS.sourceFreshnessEntries = function (rows, labels) {
    labels = labels || {};
    const list = (rows || []).filter((r) => r && r.registry_id).map((r) => {
      const meta = HS.SOURCE_RECORD_SCOPE[r.registry_id] || {};
      return {
        id: r.registry_id,
        label: labels[r.registry_id] || '',
        reviewedName: meta.name || '',
        noun: meta.noun || '',
        scope: meta.scope || '',
        newest: HS.sourceFreshnessDate(r.newest_record_date),
        ledgerRecords: Number(r.ledger_records) || 0,
        lastSuccess: HS.sourceFreshnessDate(r.last_success_at),
        zipState: r.zip_read_state || null,
        zipLastRead: HS.sourceFreshnessDate(r.zip_last_read_at),
        zipFailingSince: HS.sourceFreshnessDate(r.zip_failing_since)
      };
    });
    // Name precedence: a reviewed name; else the registry label; a source with no label is named by its
    // id read as words. Two sources with the same label on one page (e.g. two City of Portland datasets)
    // are told apart by the id's words that are not already in the label.
    const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const words = (id) => cap(id.replace(/-/g, ' '));
    const extra = (id, label) => {
      const have = new Set(String(label).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean));
      const rest = id.split('-').filter((w) => !have.has(w) && !/^[a-z]{2}$/.test(w));
      return rest.length ? rest.join(' ') : id.replace(/-/g, ' ');
    };
    const seen = {};
    list.forEach((e) => { const n = e.reviewedName || e.label; if (n) seen[n] = (seen[n] || 0) + 1; });
    list.forEach((e) => {
      if (e.reviewedName) { e.name = e.reviewedName; return; }
      e.name = !e.label ? words(e.id) : (seen[e.label] > 1 ? e.label + ' (' + extra(e.id, e.label) + ')' : e.label);
    });
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return list;
  };

  // The wording, one function. `hasZip`: the page is about one ZIP (else no ZIP line is written).
  HS.sourceFreshnessLines = function (e, hasZip) {
    const out = [];
    const noun = e.noun ? e.noun + ' ' : '';
    // No date: either we have not measured this source's records yet, or the records we hold carry only
    // planned dates (scheduled, estimated) or no stated date. Two different facts, said differently.
    out.push(e.newest
      ? 'Latest available ' + noun + 'record: ' + e.newest
      : 'Latest available ' + noun + 'record: ' + (e.ledgerRecords > 0
        ? "not shown, because this source's records do not state a filing or issue date"
        : 'not measured yet'));
    out.push('Last successful source check: ' + (e.lastSuccess || 'not recorded yet')
      + (hasZip ? ' (any ZIP)' : ''));
    if (hasZip) {
      if (e.zipState === 'complete') {
        out.push('This ZIP: last read of this source completed ' + e.zipLastRead);
      } else if (e.zipState === 'failing') {
        out.push('This ZIP: the latest read of this source did not complete'
          + (e.zipFailingSince ? ' (since ' + e.zipFailingSince + ')' : '')
          + '. Records shown here are from an earlier read.');
      } else if (e.zipState === 'not_reported') {
        out.push('This ZIP: the source did not report on its latest read.');
      } else if (e.zipState === 'retired') {
        out.push('This ZIP: this source is no longer read here.');
      } else {
        out.push('This ZIP: not read from this source.');
      }
    }
    return out;
  };

  HS.sourceFreshnessHTML = function (entries, opts) {
    opts = opts || {};
    if (!entries || !entries.length) return '';
    const hasZip = !!opts.zip;
    return '<div class="srcfresh" data-source-freshness="1" style="margin:14px 0;padding:12px 14px;border:1px solid var(--line,#e3e3e3);border-radius:10px;font-size:12.5px;line-height:1.5">'
      + '<div class="srcfresh-hd" style="font-weight:700;font-size:13px;margin-bottom:4px">' + esc(opts.title || 'About these development sources') + '</div>'
      + '<p class="srcfresh-note" style="margin:0 0 8px;color:var(--ink-3,#666)">Each source shows the newest record it has published and when we last read it. '
      + 'A recent check does not mean the source has newer records.</p>'
      + entries.map((e) => '<div class="srcfresh-row" style="margin-top:8px" data-source="' + esc(e.id) + '">'
        + '<div class="srcfresh-name"><b>' + esc(e.name) + '</b>'
        + (e.scope ? ' <span class="srcfresh-scope" style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:9px;background:#fff4d6;color:#7a5200;font-size:11.5px;font-weight:600">' + esc(e.scope) + '</span>' : '') + '</div>'
        + HS.sourceFreshnessLines(e, hasZip).map((l) => '<div class="srcfresh-line" style="color:var(--ink-2,#444)">' + esc(l) + '</div>').join('')
        + '</div>').join('')
      + '</div>';
  };

  // Fill `el`. Fails closed and silent: a missing reader or failed read renders nothing, never a
  // guessed date. ids: registry ids of the records the page shows.
  HS.mountSourceFreshness = async function (el, opts) {
    if (!el) return;
    opts = opts || {};
    const token = (el.__srcFreshToken = (el.__srcFreshToken || 0) + 1);
    el.innerHTML = '';
    if (!HS.data || !HS.data.sourceFreshness) return;
    let res = null;
    try { res = await HS.data.sourceFreshness(opts.zip || null, opts.ids || []); } catch (e) { res = null; }
    if (token !== el.__srcFreshToken || !res) return;   // a newer mount owns the element
    el.innerHTML = HS.sourceFreshnessHTML(HS.sourceFreshnessEntries(res.rows, res.labels),
      { zip: opts.zip || null, title: opts.title });
  };

  // registry ids of the development records a page shows (Map 1 sites / ZIP page projects).
  HS.sourceFreshnessIds = function (records) {
    const ids = {};
    (records || []).forEach((r) => {
      const id = r && (r.source_registry_id || r.registry_id || (r.zip_authoritative ? r.src : null));
      if (typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) ids[id] = 1;
    });
    return Object.keys(ids).sort().slice(0, 50);
  };
})();
