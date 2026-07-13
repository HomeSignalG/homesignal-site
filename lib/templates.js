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

  // color a card's left bar from impact score / status
  function barColor(item) {
    if (item.status === 'Active') return 'var(--amber)';
    if (item.status === 'Approved') return 'var(--blue)';
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
      <div class="card" style="border-left-color:${barColor(c)}">
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

    // clickable development project card
    devCard(p) {
      const statusClass = p.status === 'Active' ? 'active' : p.status === 'Approved' ? 'appr' : 'prop';
      return `
      <div class="card clickable" style="border-left-color:${barColor(p)}" onclick="location.href='development.html?id=${encodeURIComponent(p.id)}'">
        <span class="lens"><span class="sw ${esc(p.lens || 'value')}"></span>${esc(p.status)} · ${esc(p.dist || p.type)}</span>
        <h3>${esc(p.name)}</h3>
        <p class="sowhat"><b>How it lands on you:</b> ${esc(p.sowhat || '')}</p>
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
    }
  };
  HS.tpl = tpl;
})();
