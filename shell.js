// HomeSignal shell orchestrator (classic script, no build step).
// Injects partials/shell.html into every page, wires the shared chrome (nav, mobile
// drawer, all 5 modals, search, share, topics, property switcher, follows, waitlist,
// contact/community-request), boots session + active-property state, then hands control
// to the page via HS.onReady(). Persistence: seed mode -> localStorage; supabase mode -> DB.
(function () {
  const HS = (window.HS = window.HS || {});
  const CFG = window.HS_CONFIG;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ state --
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem('hs:' + k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hs:' + k, JSON.stringify(v)); } catch (e) {} }
  };
  const state = HS.state = {
    session: null,           // {user:{id,email}} or null
    zip: CFG.DEFAULT_ZIP,
    properties: [],
    activePropId: LS.get('activeProp', null),
    follows: new Set(LS.get('follows', [])),
    dismissed: new Set(LS.get('dismissed', [])),
    topicPrefs: LS.get('topicPrefs', {}),
    get activeProperty() {
      return this.properties.find(p => p.id === this.activePropId) || this.properties[0] || null;
    }
  };

  // ------------------------------------------------------------- ready gate --
  let _resolveReady;
  HS.ready = new Promise(r => (_resolveReady = r));
  HS.onReady = (fn) => HS.ready.then(fn);

  // -------------------------------------------------------------- modals -----
  let _lastFocus = null;
  HS.openModal = function (id) {
    const el = $(id); if (!el) return;
    _lastFocus = document.activeElement;
    el.classList.add('show');
    const f = el.querySelector('input,button,[tabindex]'); if (f) f.focus();
    el._trap = trapFocus(el);
    document.addEventListener('keydown', el._trap);
  };
  HS.closeModal = function (id) {
    const el = $(id); if (!el) return;
    el.classList.remove('show');
    if (el._trap) document.removeEventListener('keydown', el._trap);
    if (_lastFocus && _lastFocus.focus) _lastFocus.focus();
  };
  function trapFocus(el) {
    return function (e) {
      if (e.key !== 'Tab') return;
      const f = el.querySelectorAll('a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') ['topicsModal', 'premiumModal', 'shareModal', 'locModal', 'switcherModal', 'authModal']
      .forEach(HS.closeModal);
  });

  // ------------------------------------------------------------- mobile nav --
  HS.toggleMenu = function () {
    document.querySelector('.side').classList.toggle('open');
    $('sidebackdrop').classList.toggle('show');
  };
  function closeMenu() {
    const s = document.querySelector('.side'); if (s) s.classList.remove('open');
    const b = $('sidebackdrop'); if (b) b.classList.remove('show');
  }

  // -------------------------------------------------------------- session ----
  async function bootSession() {
    if ((CFG.DATA_SOURCE === 'supabase') && window.supabase) {
      try {
        const { data } = await HS.sb().auth.getSession();
        state.session = data && data.session ? data.session : null;
      } catch (e) { state.session = null; }
    }
    if (!state.session && CFG.DEMO_SESSION) {
      const u = (window.HS_SEED && window.HS_SEED.demoUser) || { id: 'demo', email: 'demo@homesignal.net', name: 'Demo', initials: 'DE' };
      state.session = { user: { id: u.id, email: u.email }, demo: true, name: u.name, initials: u.initials };
    }
  }
  HS.requireAuth = function (thenLabel) {
    if (state.session && !state.session.demo) return true;
    // open the in-page email sign-in / sign-up modal (no redirect)
    HS.openAuth();
    return false;
  };
  HS.onAvatar = function () {
    if (state.session && !state.session.demo) {
      if (confirm('Sign out?')) HS.sb().auth.signOut().then(() => location.reload());
    } else { HS.openAuth(); }
  };

  // -------------------------------------------------- sign in / sign up -------
  // Passwordless email code (Supabase OTP): enter email -> get a 6-digit code ->
  // verify. shouldCreateUser:true means the same flow signs up a new visitor and
  // signs in a returning one. On success we bounce to ?return= (or reload) so the
  // now-persisted Supabase session is picked up by bootSession().
  let _authStep = 'email', _authEmail = '';
  function authMsg(t, err) {
    const m = $('authMsg'); if (!m) return;
    m.textContent = t || ''; m.style.color = err ? '#c23b34' : '';
  }
  HS.openAuth = function () {
    _authStep = 'email'; _authEmail = '';
    const e = $('authEmail'), c = $('authCode'), b = $('authSubmitBtn');
    if (e) { e.value = ''; e.classList.remove('hidden'); }
    if (c) { c.value = ''; c.classList.add('hidden'); }
    if ($('authSub')) $('authSub').textContent = "Enter your email and we'll send you a 6-digit code — no password needed.";
    if (b) { b.textContent = 'Send me a code'; b.disabled = false; }
    if ($('authBackWrap')) $('authBackWrap').classList.add('hidden');
    if ($('authForm')) $('authForm').classList.remove('hidden');
    if ($('authDone')) $('authDone').classList.add('hidden');
    authMsg('New here? Entering your email creates your free account — no password, no spam.', false);
    HS.openModal('authModal');
    setTimeout(() => { if ($('authEmail')) $('authEmail').focus(); }, 50);
  };
  HS.authReset = function () { HS.openAuth(); };
  HS.authSubmit = async function () {
    if (!window.supabase) { authMsg('Sign-in is unavailable right now — please try again.', true); return; }
    const btn = $('authSubmitBtn');
    if (_authStep === 'code') {
      const code = ($('authCode').value || '').trim();
      if (code.length < 4) { authMsg('Enter the code from your email.', true); return; }
      btn.disabled = true; authMsg('Checking…', false);
      try {
        const r = await HS.sb().auth.verifyOtp({ email: _authEmail, token: code, type: 'email' });
        if (r.error) { authMsg(r.error.message, true); btn.disabled = false; return; }
        $('authForm').classList.add('hidden'); $('authDone').classList.remove('hidden');
        const back = new URLSearchParams(location.search).get('return');
        setTimeout(() => { location.href = back ? decodeURIComponent(back) : location.pathname; }, 700);
      } catch (e) { authMsg('Something went wrong — please try again.', true); btn.disabled = false; }
    } else {
      const email = ($('authEmail').value || '').trim();
      if (!email || email.indexOf('@') < 1) { authMsg('Please enter a valid email address.', true); return; }
      btn.disabled = true; authMsg('Sending your code…', false);
      try {
        const r = await HS.sb().auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } });
        if (r.error) { authMsg(r.error.message, true); btn.disabled = false; return; }
        _authEmail = email; _authStep = 'code';
        $('authEmail').classList.add('hidden'); $('authCode').classList.remove('hidden');
        $('authSub').textContent = 'We emailed a code to ' + email + '. Enter it below to finish.';
        btn.textContent = 'Verify & continue'; btn.disabled = false;
        $('authBackWrap').classList.remove('hidden');
        authMsg('', false);
        setTimeout(() => { $('authCode').focus(); }, 50);
      } catch (e) { authMsg('Something went wrong — please try again.', true); btn.disabled = false; }
    }
  };

  // -------------------------------------------------- active property / topbar
  HS.selectProperty = function (id) {
    state.activePropId = id; LS.set('activeProp', id);
    paintTopbar();
    document.dispatchEvent(new CustomEvent('hs:property', { detail: { id } }));
  };
  function paintTopbar() {
    const p = state.activeProperty;
    if ($('locLabel')) {
      // A signed-in subscriber viewing their own home shows their real address.
      // Everyone else is looking at the default prototype community (Del Valle,
      // 78617) as an EXAMPLE — flag it clearly as a sample ZIP so it is never
      // mistaken for the visitor's own area.
      $('locLabel').textContent = p ? p.address
        : ((window.HS_SEED ? window.HS_SEED.community.name : '—') + ' (Sample Zip Code)');
    }
    const av = $('hs-avatar');
    if (av) {
      av.textContent = state.session ? (state.session.initials ||
        (state.session.user.email || '?').slice(0, 2).toUpperCase()) : '··';
      // signed out -> hide the avatar and show the "Sign in" button instead
      av.style.display = state.session ? '' : 'none';
    }
    const signinBtn = $('hs-signin');
    if (signinBtn) signinBtn.style.display = state.session ? 'none' : '';
    const commNav = $('hs-nav-comm');
    if (commNav) commNav.setAttribute('href', 'community.html?zip=' + encodeURIComponent(state.zip));
  }
  HS.openSwitcher = function () {
    const list = $('switcherList'); if (!list) return;
    $('switcherSub').textContent = "You're following " + state.properties.length + " home" +
      (state.properties.length === 1 ? '' : 's') + '. Pick one to focus the app on it.';
    list.innerHTML = state.properties.map(p => `
      <div class="swrow ${p.id === state.activePropId ? 'active' : ''}" onclick="HS.selectProperty('${p.id}');HS.closeModal('switcherModal')">
        <div class="miniscore">${p.score || ''}</div>
        <div class="pinfo"><div class="pt">${HS.esc(p.address)}</div>
          <div class="pa">${HS.esc(p.tag || p.label)} · ${HS.esc(p.city)}, ${HS.esc(p.state)} ${HS.esc(p.zip)}</div></div>
        ${p.id === state.activePropId ? '<span class="chk">✓</span>' : ''}
      </div>`).join('');
    HS.openModal('switcherModal');
  };

  // -------------------------------------------------- location / community ----
  HS.openLoc = function () {
    $('locForm').classList.remove('hidden');
    $('locRequest').classList.add('hidden');
    $('locDone').classList.add('hidden');
    const z = $('locZip'); z.value = ''; z.style.borderColor = '';
    HS.openModal('locModal');
  };
  HS.findCommunity = async function () {
    const el = $('locZip'), z = el.value.trim();
    if (!/^\d{5}$/.test(z)) { el.style.borderColor = '#c23b34'; el.focus(); return; }
    el.style.borderColor = '';
    const covered = await HS.data.isCovered(z);
    if (covered) {
      location.href = 'community.html?zip=' + z;
    } else {
      $('reqZipLabel').textContent = z;
      $('locForm').classList.add('hidden');
      $('locRequest').classList.remove('hidden');
    }
  };
  HS.submitRequest = async function () {
    const el = $('reqEmail'), e = el.value.trim();
    if (!e || e.indexOf('@') < 1) { el.style.borderColor = '#c23b34'; el.focus(); return; }
    await persistEmail('community_requests', { email: e, zip: $('reqZipLabel').textContent });
    $('locRequest').classList.add('hidden');
    $('locDoneH').textContent = 'Request received';
    $('locDoneP').textContent = "We'll email you the moment " + $('reqZipLabel').textContent + ' is live on HomeSignal.';
    $('locDone').classList.remove('hidden');
  };

  // -------------------------------------------------- topic picker ------------
  let TCUR = null;
  HS.openTopics = function (key) {
    TCUR = key;
    const cats = HS.data.topicCategories(), d = cats[key];
    $('tmTitle').textContent = d.title; $('tmSub').textContent = d.sub; $('tmBadge').textContent = d.badge;
    $('tmEmail').textContent = state.session ? state.session.user.email : 'sign in to save';
    const saved = state.topicPrefs[key];
    const onSet = saved ? new Set(saved.topics) : new Set(d.on.map(i => d.items[i]));
    const g = $('tmGrid'); g.innerHTML = '';
    d.items.forEach(it => {
      const on = onSet.has(it);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tchip' + (on ? ' on' : '');
      b.innerHTML = '<span class="box">' + (on ? '✓' : '') + '</span><span>' + HS.esc(it) + '</span>';
      b.onclick = function () { const o = b.classList.toggle('on'); b.querySelector('.box').textContent = o ? '✓' : ''; updTCount(); };
      g.appendChild(b);
    });
    // consent ALWAYS defaults unchecked unless the user previously opted in (policy > mockup)
    $('tmConsent').checked = saved ? !!saved.share_consent : false;
    $('tmForm').classList.remove('hidden'); $('tmDone').classList.add('hidden');
    updTCount(); HS.openModal('topicsModal');
  };
  function updTCount() {
    const n = document.querySelectorAll('#tmGrid .tchip.on').length;
    $('tmCount').textContent = n + ' topic' + (n === 1 ? '' : 's') + ' selected';
  }
  HS.saveTopics = async function () {
    if (!HS.requireAuth('save-topics')) return;
    const chips = [...document.querySelectorAll('#tmGrid .tchip.on span:last-child')].map(s => s.textContent);
    const cats = HS.data.topicCategories();
    state.topicPrefs[TCUR] = { topics: chips, share_consent: $('tmConsent').checked };
    LS.set('topicPrefs', state.topicPrefs);
    await persistTopics(TCUR, chips, $('tmConsent').checked);
    const cc = $('cc-' + TCUR); if (cc) cc.textContent = chips.length + ' topic' + (chips.length === 1 ? '' : 's') + ' followed';
    $('tmForm').classList.add('hidden');
    $('tmDoneMsg').textContent = "You'll be alerted about " + chips.length + ' ' + cats[TCUR].title.toLowerCase() + ' topic' + (chips.length === 1 ? '' : 's') + '.';
    $('tmDone').classList.remove('hidden');
  };

  // -------------------------------------------------- premium waitlist --------
  HS.submitWaitlist = async function () {
    const el = $('premiumEmail'), e = el.value.trim();
    if (!e || e.indexOf('@') < 1) { el.style.borderColor = '#c23b34'; el.focus(); return; }
    await persistEmail('premium_waitlist', { email: e });
    $('premiumForm').classList.add('hidden');
    $('premiumDone').classList.remove('hidden');
  };

  // -------------------------------------------------- follows / watch ---------
  HS.toggleFollow = function (btn, type, id) {
    if (!HS.requireAuth('follow')) return;
    const key = type + ':' + id;
    if (state.follows.has(key)) { state.follows.delete(key); btn.textContent = btn.dataset.follow || 'Follow'; }
    else {
      state.follows.add(key);
      btn.dataset.follow = btn.textContent;
      btn.textContent = (type === 'property') ? 'Watching ✓' : 'Following ✓';
    }
    LS.set('follows', [...state.follows]);
    persistFollow(type, id, state.follows.has(key));
  };

  // -------------------------------------------------- share -------------------
  const SHARE = [
    { t: 'Copy link', bg: 'var(--green)', ic: '⧉', fn: 'copy' },
    { t: 'Messages', bg: '#34c759', ic: '💬', u: u => 'sms:?&body=' + u },
    { t: 'Email', bg: '#7c8a82', ic: '✉', u: (u, x) => 'mailto:?subject=' + x + '&body=' + u },
    { t: 'Facebook', bg: '#1877f2', ic: 'f', u: u => 'https://www.facebook.com/sharer/sharer.php?u=' + u },
    { t: 'Nextdoor', bg: '#00b246', ic: '◍', u: u => 'https://nextdoor.com/sharekit/?source=share&body=' + u },
    { t: 'WhatsApp', bg: '#25d366', ic: '✆', u: u => 'https://wa.me/?text=' + u },
    { t: 'Telegram', bg: '#29a9eb', ic: '➤', u: (u, x) => 'https://t.me/share/url?url=' + u + '&text=' + x },
    { t: 'Signal', bg: '#3a76f0', ic: '◉', fn: 'copy' },
    { t: 'Reddit', bg: '#ff4500', ic: 'R', u: (u, x) => 'https://www.reddit.com/submit?url=' + u + '&title=' + x },
    { t: 'X', bg: '#111', ic: '𝕏', u: (u, x) => 'https://twitter.com/intent/tweet?url=' + u + '&text=' + x },
    { t: 'Bluesky', bg: '#1185fe', ic: '✦', u: (u, x) => 'https://bsky.app/intent/compose?text=' + x + '%20' + u },
    { t: 'LinkedIn', bg: '#0a66c2', ic: 'in', u: u => 'https://www.linkedin.com/sharing/share-offsite/?url=' + u }
  ];
  function shareUrl() {
    // share the current page URL (centralized, like the live site's share.js)
    return HS.shareUrlOverride || location.href;
  }
  function buildShare() {
    const grid = $('shareGrid'); if (!grid) return;
    $('shareUrl').textContent = shareUrl().replace(/^https?:\/\//, '');
    const u = encodeURIComponent(shareUrl()), x = encodeURIComponent('See what’s changing around your home on HomeSignal');
    grid.innerHTML = SHARE.map((s, i) => {
      const href = s.u ? s.u(u, x) : '#';
      const tag = s.u ? 'a' : 'button';
      const attr = s.u ? `href="${href}" target="_blank" rel="noopener"` : `type="button" onclick="HS.copyLink()"`;
      return `<${tag} class="sopt" ${attr}><span class="si" style="background:${s.bg}">${s.ic}</span>${HS.esc(s.t)}</${tag}>`;
    }).join('');
  }
  HS.copyLink = function () {
    const t = shareUrl();
    try { navigator.clipboard.writeText(t); } catch (e) {}
    const b = $('copyBtn'); if (b) { b.textContent = 'Copied ✓'; setTimeout(() => (b.textContent = 'Copy'), 1800); }
  };

  // -------------------------------------------------- toast -------------------
  HS.toast = function (msg) {
    let t = $('hs-toast');
    if (!t) { t = document.createElement('div'); t.id = 'hs-toast'; t.className = 'hs-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800);
  };

  // -------------------------------------------------- search ------------------
  async function wireSearch() {
    const input = $('hs-search'), box = $('hs-search-results');
    if (!input || !box) return;
    const home = state.activeProperty;
    const [projects, changes] = await Promise.all([
      HS.data.projects(state.zip, home), HS.data.changes(state.zip, home)]);
    const idx = [
      ...projects.map(p => ({ label: p.name, sub: p.type, href: 'development.html?id=' + p.id })),
      ...changes.map(c => ({ label: c.title, sub: c.category, href: c.related_project_id ? 'development.html?id=' + c.related_project_id : 'alerts.html' })),
      ...state.properties.map(p => ({ label: p.address, sub: p.city + ', ' + p.state, href: 'property.html?id=' + p.id }))
    ];
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { box.classList.add('hidden'); return; }
      const hits = idx.filter(i => (i.label + ' ' + i.sub).toLowerCase().includes(q)).slice(0, 8);
      box.innerHTML = hits.map(h => `<a href="${h.href}"><b>${HS.esc(h.label)}</b><span>${HS.esc(h.sub)}</span></a>`).join('')
        || '<div class="empty">No matches</div>';
      box.classList.remove('hidden');
    });
    document.addEventListener('click', e => { if (!box.contains(e.target) && e.target !== input) box.classList.add('hidden'); });
  }

  // -------------------------------------------------- bell badge --------------
  async function paintBell() {
    const badge = $('hs-bell-badge'); if (!badge) return;
    const changes = await HS.data.changes(state.zip, state.activeProperty);
    const open = changes.filter(c => { const d = HS.daysUntil(c.window_closes_at); return d != null && d >= 0; }).length;
    if (open > 0) { badge.textContent = open; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }

  // -------------------------------------------------- persistence seam --------
  async function persistEmail(table, row) {
    if (CFG.DATA_SOURCE !== 'supabase') { LS.set('pending:' + table, [...(LS.get('pending:' + table, [])), row]); return; }
    try { await HS.sb().from(table).insert(row); } catch (e) { console.warn('persist', table, e); }
  }
  async function persistFollow(type, id, on) {
    if (CFG.DATA_SOURCE !== 'supabase' || !state.session) return;
    try {
      if (on) await HS.sb().from('follows').insert({ user_id: state.session.user.id, target_type: type, target_id: id });
      else await HS.sb().from('follows').delete().match({ user_id: state.session.user.id, target_type: type, target_id: id });
    } catch (e) { console.warn('follow', e); }
  }
  async function persistTopics(category, topics, consent) {
    if (CFG.DATA_SOURCE !== 'supabase' || !state.session) return;
    try {
      await HS.sb().from('topic_prefs').upsert({
        user_id: state.session.user.id, category, topics, share_consent: consent
      }, { onConflict: 'user_id,category' });
    } catch (e) { console.warn('topics', e); }
  }

  // -------------------------------------------------- boot --------------------
  async function injectShell() {
    const root = document.createElement('div');
    root.id = 'hs-app-root';
    const html = await fetch('partials/shell.html').then(r => r.text());
    root.innerHTML = html;
    // move page content (from <template id="hs-content">) into the slot
    const tpl = $('hs-content');
    const slot = root.querySelector('#hs-slot');
    if (tpl && slot) slot.appendChild(tpl.content.cloneNode(true));
    document.body.insertBefore(root, document.body.firstChild);
    $('sidebackdrop').addEventListener('click', closeMenu);
    // active nav
    const nav = document.body.dataset.nav;
    if (nav) { const a = document.querySelector('.nav a[data-nav="' + nav + '"]'); if (a) a.classList.add('on'); }
    // close menu on nav click (mobile)
    document.querySelectorAll('.nav a').forEach(a => a.addEventListener('click', closeMenu));
  }

  async function boot() {
    await injectShell();
    await bootSession();
    state.properties = await HS.data.properties();
    if (!state.activePropId && state.properties[0]) state.activePropId = state.properties[0].id;
    paintTopbar();
    buildShare();
    wireSearch();
    paintBell();
    // legacy deep link: /index.html?signin=1 (or any page) opens the sign-in modal
    if (!state.session && new URLSearchParams(location.search).get('signin') === '1') HS.openAuth();
    _resolveReady(HS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
