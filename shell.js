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
    // The visitor's saved ZIP (their chosen area) wins over the Del Valle sample.
    zip: LS.get('myZip', null) || CFG.DEFAULT_ZIP,
    properties: [],
    activePropId: LS.get('activeProp', null),
    follows: new Set(LS.get('follows', [])),
    dismissed: new Set(LS.get('dismissed', [])),
    topicPrefs: LS.get('topicPrefs', {}),
    get activeProperty() {
      return this.properties.find(p => p.id === this.activePropId) || this.properties[0] || null;
    }
  };

  // Has the visitor set their own area yet (a saved property OR a saved ZIP)?
  // When false, the app is showing the Del Valle sample and labels say so.
  HS.hasArea = function () { return !!(state.activeProperty || LS.get('myZip', null)); };
  HS.isSample = function () { return !HS.hasArea(); };

  // ---------------------------------------------- referral (first-touch) ------
  // FIRST-TOUCH-WINS marketing attribution. When a visitor arrives with utm_*
  // params (e.g. from a Bluesky post link) OR an external referrer, remember it
  // once, in localStorage only — so a later conversion (area request, topic
  // follow, signup) can be credited to that first source. Never overwritten by a
  // later organic visit, never sent anywhere here (this is capture only; a
  // separate, schema-gated step stamps it onto the conversion row). No PII.
  function captureReferral() {
    try {
      if (LS.get('referral', null)) return;           // already have a first touch
      const q = new URLSearchParams(location.search);
      const src = q.get('utm_source');
      // Only record when there's a real signal: an explicit utm_source, or an
      // off-site referrer. Same-origin navigations are not a new "first touch".
      let refHost = '';
      try { refHost = document.referrer ? new URL(document.referrer).host : ''; } catch (e) {}
      const offsite = refHost && refHost !== location.host;
      if (!src && !offsite) return;
      LS.set('referral', {
        source:   src || (offsite ? refHost : null),
        medium:   q.get('utm_medium') || (src ? null : 'referral'),
        campaign: q.get('utm_campaign') || null,
        referrer: document.referrer || null,
        landing:  location.pathname + location.search,
        ts:       new Date().toISOString()
      });
    } catch (e) { /* attribution must never break the page */ }
  }
  // Read seam for the (later, schema-gated) conversion-stamp step.
  HS.referral = function () { return LS.get('referral', null); };
  // Compact provenance token for a conversion row's `source` column, alongside the
  // existing hand-set tokens ('homepage_zip', 'contact_page'). Prefixed 'ref:' so
  // analytics can tell referral-attributed rows from page-provenance rows at a
  // glance: "ref:bluesky/box-elder-meetings". Null when there's no first touch.
  HS.referralToken = function () {
    const r = HS.referral(); if (!r || !r.source) return null;
    const tok = 'ref:' + r.source + (r.campaign ? '/' + r.campaign : '');
    return tok.replace(/\s+/g, '_').slice(0, 120);
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
    if (e.key === 'Escape') ['topicsModal', 'premiumModal', 'shareModal', 'locModal', 'switcherModal', 'authModal', 'homeModal']
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
        // reflect the new session in the top bar without a full reload
        try { const s = await HS.sb().auth.getSession(); if (s && s.data && s.data.session) state.session = s.data.session; } catch (e) {}
        paintTopbar();
        setTimeout(() => {
          HS.closeModal('authModal');
          const back = new URLSearchParams(location.search).get('return');
          if (!LS.get('myZip', null)) {
            // brand-new account with no saved area -> onboard: ask for their ZIP
            HS.openLoc(true);
          } else {
            location.href = back ? decodeURIComponent(back) : location.pathname;
          }
        }, 700);
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
      // A saved home shows its address; a saved ZIP shows "ZIP <zip>"; otherwise
      // the visitor is on the default Del Valle sample, so flag it clearly.
      const myZip = LS.get('myZip', null);
      $('locLabel').textContent = p ? p.address
        : (myZip ? ('ZIP ' + myZip)
        : ((window.HS_SEED ? window.HS_SEED.community.name : '—') + ' (Sample Zip Code)'));
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

  // -------------------------------------------------- your home ---------------
  // The ONE writer of app_properties (nothing else in the app writes it).
  // Geocoder: the U.S. Census one-line locator — free, keyless, the same source
  // the engine uses server-side. HONESTY RULES:
  //   * only the geocoder's CONFIRMED match is saved, shown back to the resident
  //     for explicit confirmation first — never raw input, never a guessed point;
  //   * no match -> no save (an unpinnable address stays unpinned);
  //   * signed-in only (app_properties is RLS'd to the owner). Signed-out users
  //     get the sign-in modal — the nudge doubles as the signup prompt.
  let _homeMatch = null;
  HS.openHome = function () {
    if (CFG.DATA_SOURCE !== 'supabase') { if (HS.toast) HS.toast('Adding a home needs the live site.'); return; }
    if (!state.session || state.session.demo) {
      HS.openAuth();
      const sub = $('authSub');
      if (sub) sub.textContent = 'Sign in first — then add your home address to see what’s changing around it.';
      return;
    }
    _homeMatch = null;
    $('homeForm').classList.remove('hidden');
    $('homeConfirm').classList.add('hidden');
    $('homeDone').classList.add('hidden');
    $('homeConfirmMsg').textContent = '';
    $('homeMsg').textContent = 'Your address is stored on your account only — never shared, never public.';
    const a = $('homeAddr'); a.value = ''; a.style.borderColor = '';
    HS.openModal('homeModal');
    setTimeout(() => { if (a) a.focus(); }, 50);
  };
  HS.findHome = async function () {
    const el = $('homeAddr'), q = el.value.trim();
    if (q.length < 8 || q.indexOf(' ') < 0) { el.style.borderColor = '#c23b34'; el.focus(); return; }
    el.style.borderColor = '';
    $('homeMsg').textContent = 'Looking up the official address…';
    // Via the geocode-address edge function — the Census API sends no CORS
    // headers, so the browser can't call it directly (found live 2026-07-16:
    // a perfectly valid address failed for every visitor). The function
    // returns {match} or a 502 'geocoder_unavailable', so a service outage
    // and a genuine no-match get DIFFERENT honest messages.
    let m = null, unavailable = false;
    try {
      const r = await HS.sb().functions.invoke('geocode-address', { body: { address: q } });
      if (r.error) unavailable = true;
      else m = (r.data && r.data.match) || null;
    } catch (e) { unavailable = true; }
    if (unavailable) {
      $('homeMsg').textContent = "The address service couldn't be reached — please try again in a minute.";
      return;
    }
    if (!m || m.lat == null || m.lng == null || !m.zip) {
      $('homeMsg').textContent = "We couldn't confirm that address against U.S. Census records — check the street, city and state, then try again.";
      return;
    }
    _homeMatch = m;
    $('homeMatched').textContent = m.matchedAddress || q;
    $('homeForm').classList.add('hidden');
    $('homeConfirm').classList.remove('hidden');
  };
  HS.saveHome = async function () {
    const m = _homeMatch; if (!m || !state.session) return;
    $('homeConfirmMsg').textContent = 'Saving…';
    const row = {
      user_id: state.session.user.id,
      address: String(m.matchedAddress || '').split(',')[0],
      city: m.city || null, state: m.state || null, zip: m.zip,
      lat: m.lat, lng: m.lng, label: 'home'
    };
    let r = null;
    try { r = await HS.sb().from('app_properties').insert(row).select().single(); } catch (e) { r = { error: e }; }
    if (!r || r.error || !r.data) {
      $('homeConfirmMsg').textContent = "Couldn't save your home — please try again.";
      return;
    }
    LS.set('activeProp', r.data.id);
    // Focus the app on the home's area when it's covered (same follow the ZIP flow does).
    try {
      if (await HS.data.isCovered(m.zip)) {
        let meta = null; try { meta = await HS.data.community(m.zip); } catch (e) {}
        HS.followCommunity({ zip: m.zip, name: (meta && meta.name) || '', state: (meta && meta.state) || '' });
      }
    } catch (e) {}
    $('homeConfirm').classList.add('hidden');
    $('homeDone').classList.remove('hidden');
    setTimeout(() => location.reload(), 900);   // rebuild every tile/map with the real home
  };

  // -------------------------------------------------- location / community ----
  HS.openLoc = function (onboarding) {
    $('locForm').classList.remove('hidden');
    $('locRequest').classList.add('hidden');
    $('locDone').classList.add('hidden');
    const z = $('locZip'); z.value = ''; z.style.borderColor = '';
    // First-run onboarding right after sign-up gets welcoming, save-oriented copy.
    if ($('locModalTitle')) $('locModalTitle').textContent = onboarding ? "You're in — set your community" : 'Change your community';
    const sub = document.querySelector('#locModal .msub');
    if (sub) sub.textContent = onboarding
      ? "Enter your ZIP code to save your area and open what's changing around your home."
      : "Enter a ZIP code to open what's changing around that area.";
    HS.openModal('locModal');
    setTimeout(() => { if (z) z.focus(); }, 50);
  };
  HS.findCommunity = async function () {
    const el = $('locZip'), z = el.value.trim();
    if (!/^\d{5}$/.test(z)) { el.style.borderColor = '#c23b34'; el.focus(); return; }
    el.style.borderColor = '';
    const covered = await HS.data.isCovered(z);
    if (covered) {
      // Looking up a covered ZIP follows it: saves it to Your communities and makes
      // it the primary area, so the Del Valle sample stops showing everywhere.
      let meta = null; try { meta = await HS.data.community(z); } catch (e) {}
      HS.followCommunity({ zip: z, name: (meta && meta.name) || '', state: (meta && meta.state) || '' });
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
    // Referral stamp: carry the first-touch source onto the area-request row
    // (community_requests.source — same column submit-public-form stamps with
    // 'homepage_zip'). Only set when a first touch exists; absent stays absent.
    const row = { email: e, zip: $('reqZipLabel').textContent };
    const ref = HS.referralToken(); if (ref) row.source = ref;
    await persistEmail('community_requests', row);
    $('locRequest').classList.add('hidden');
    $('locDoneH').textContent = 'Request received';
    $('locDoneP').textContent = "We'll email you the moment " + $('reqZipLabel').textContent + ' is live on HomeSignal.';
    $('locDone').classList.remove('hidden');
  };

  // -------------------------------------------------- followed communities ----
  // The visitor's saved communities (shown on Dashboard + Communities). The primary
  // one is mirrored to myZip, which the whole app defaults to — that is what makes
  // the Del Valle sample disappear once anything is followed.
  HS.followedCommunities = function () { return LS.get('myCommunities', []); };
  HS.isFollowingCommunity = function (zip) {
    return HS.followedCommunities().some(c => String(c.zip) === String(zip));
  };
  HS.followCommunity = function (c) {
    if (!c || !c.zip) return;
    const zip = String(c.zip);
    const list = HS.followedCommunities();
    if (!list.some(x => String(x.zip) === zip)) {
      list.push({ zip: zip, name: c.name || '', state: c.state || '' });
      LS.set('myCommunities', list);
    }
    LS.set('myZip', zip); state.zip = zip;   // make it the primary area
    if (CFG.DATA_SOURCE === 'supabase' && state.session && !state.session.demo && HS.sb) {
      // .then() is required: supabase-js query builders are lazy and only send the
      // request when awaited/then'd. Fire-and-forget, but it MUST actually fire so the
      // follow reaches app_follows and shows on the Dashboard / other devices.
      try { HS.sb().from('app_follows').insert({ user_id: state.session.user.id, target_type: 'community', target_id: zip }).then(function () {}, function () {}); } catch (e) {}
    }
  };
  HS.unfollowCommunity = function (zip) {
    zip = String(zip);
    const list = HS.followedCommunities().filter(c => String(c.zip) !== zip);
    LS.set('myCommunities', list);
    if (String(LS.get('myZip', null)) === zip) {
      const next = list[0] ? String(list[0].zip) : null;
      LS.set('myZip', next); state.zip = next || CFG.DEFAULT_ZIP;
    }
    if (CFG.DATA_SOURCE === 'supabase' && state.session && !state.session.demo && HS.sb) {
      // .then() required — see followCommunity note; without it the delete never fires.
      try { HS.sb().from('app_follows').delete().match({ user_id: state.session.user.id, target_type: 'community', target_id: zip }).then(function () {}, function () {}); } catch (e) {}
    }
  };
  HS.toggleFollowCommunityBtn = function (btn) {
    const zip = btn.dataset.zip;
    if (HS.isFollowingCommunity(zip)) {
      HS.unfollowCommunity(zip);
      btn.textContent = '＋ Follow this community'; btn.classList.remove('following');
    } else {
      HS.followCommunity({ zip: zip, name: btn.dataset.name, state: btn.dataset.state });
      btn.textContent = '✓ Following'; btn.classList.add('following');
      if (HS.toast) HS.toast('Saved to your communities');
    }
    paintTopbar();
    const strip = document.getElementById('dashCommunities') || document.getElementById('commStrip');
    if (strip) strip.innerHTML = HS.communitiesStripHTML();
  };
  // Chip row of followed communities (+ an add button), reused across pages.
  HS.communitiesStripHTML = function () {
    const list = HS.followedCommunities();
    const chips = list.map(c =>
      '<a class="wchip" href="community.html?zip=' + encodeURIComponent(c.zip) + '" style="text-decoration:none">◍ ' +
      HS.esc(c.name || ('ZIP ' + c.zip)) + '</a>').join('');
    const empty = list.length ? '' : '<span class="quiet" style="font-size:12.5px;margin-right:8px">No communities yet.</span>';
    return '<div class="chips">' + empty + chips +
      '<button class="wchip" type="button" onclick="HS.openLoc()" style="cursor:pointer;border-style:dashed">＋ Add a community</button></div>';
  };

  // -------------------------------------------------- topic picker ------------
  // Category -> delivery pipeline (VERBATIM from the pre-promotion community.html /
  // topics.js — the word-for-word matching rule). `dev` has NO delivery pipeline:
  // those picks stay app-local prefs and are never sent to signup_complete.
  const CAT_TO_PIPELINE = { gov: 'government_notice', meetings: 'government_notice', news: 'news_alert' };
  // Shell category -> users.topics jsonb key (Option A shape digest.py reads).
  const CAT_TO_TOPICS_KEY = { gov: 'notices', meetings: 'meetings', news: 'news' };
  const CONSENT_VERSION = '2026-07-16';
  const CONSENT_COPY = "You'll be alerted about the topics you selected. No spam · Unsubscribe anytime.";
  let TCUR = null;
  HS.openTopics = async function (key) {
    TCUR = key;
    const cats = HS.data.topicCategories(), d = Object.assign({}, cats[key]);
    // Government categories render the LIVE community's labels (cascaded up the
    // chain), never the seed's — the popup must show this place's topics
    // word-for-word. Seed mode / unmodeled ZIP falls back to the seed list.
    if (CAT_TO_TOPICS_KEY[key] && key !== 'news' && HS.data.communityGovTopics) {
      try {
        const ct = await HS.data.communityGovTopics(state.zip);
        if (ct && ct.labels && ct.labels.length) d.items = ct.labels;
      } catch (e) { /* fall back to seed labels; save still anchors via its own lookup */ }
    }
    $('tmTitle').textContent = d.title; $('tmSub').textContent = d.sub; $('tmBadge').textContent = d.badge;
    $('tmEmail').textContent = state.session ? state.session.user.email : 'sign in to save';
    const saved = state.topicPrefs[key];
    // STRICT OPT-IN (founder decision 2026-07-16): a brand-new user starts with
    // every topic UNCHECKED — pre-ticked boxes are not valid consent. Only the
    // user's own previously-saved picks come back checked.
    const onSet = new Set(saved ? saved.topics : []);
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
    // THE signup write: users row + user_subscriptions via signup_complete — the
    // thing that makes digest emails actually deliver. FAIL LOUD: if it errors,
    // the modal shows the failure and never claims "Alerts saved" (topic_prefs
    // alone is app state, not a subscription).
    try {
      await persistSignup();
    } catch (e) {
      const m = $('tmCount');
      if (m) m.textContent = "Couldn't save your alerts — please try again. (" + ((e && e.message) || 'save error') + ')';
      return;
    }
    const cc = $('cc-' + TCUR); if (cc) cc.textContent = chips.length + ' topic' + (chips.length === 1 ? '' : 's') + ' followed';
    $('tmForm').classList.add('hidden');
    $('tmDoneMsg').textContent = "You'll be alerted about " + chips.length + ' ' + cats[TCUR].title.toLowerCase() + ' topic' + (chips.length === 1 ? '' : 's') + '.';
    $('tmDone').classList.remove('hidden');
  };
  // Build the COMPLETE desired subscription set across all deliverable categories
  // and reconcile it server-side via signup_complete (SECURITY DEFINER; the sole
  // writer of users + user_subscriptions — restores the path severed at the /app
  // promotion). Mirrors the pre-promotion community.html byte-for-byte in shape.
  async function persistSignup() {
    if (CFG.DATA_SOURCE !== 'supabase' || !state.session || state.session.demo) return;   // seed/demo: app-local only
    const email = state.session.user.email;
    const zip = String(state.zip || '').trim();
    if (!/^\d{5}$/.test(zip)) throw new Error('no valid ZIP on file — set your area first');
    const ct = await HS.data.communityGovTopics(zip);
    if (!ct || !ct.rootId) throw new Error('this ZIP has no community to subscribe to yet');
    const topics = {}, subs = [], seen = {};
    Object.keys(CAT_TO_PIPELINE).forEach(cat => {
      const picks = (state.topicPrefs[cat] && state.topicPrefs[cat].topics) || [];
      topics[CAT_TO_TOPICS_KEY[cat]] = picks;
      picks.forEach(t => {
        const k = CAT_TO_PIPELINE[cat] + ' ' + t;
        if (!seen[k]) { seen[k] = 1; subs.push({ pipeline_type: CAT_TO_PIPELINE[cat], topic: t }); }
      });
    });
    // data_licensing consent must NEVER silently downgrade: the live RPC overwrites
    // it on every upsert, so pass true if ANY stored category consent is true or the
    // checkbox is checked right now.
    const licensing = $('tmConsent').checked ||
      Object.keys(state.topicPrefs).some(k => state.topicPrefs[k] && state.topicPrefs[k].share_consent);
    const ref = HS.referral() || {};
    const args = {
      p_email: email, p_community_id: ct.rootId, p_zip_code: zip,
      p_topics: topics, p_consent_version: CONSENT_VERSION, p_subscriptions: subs,
      p_data_licensing_agreed: !!licensing, p_marketing_consent_copy: CONSENT_COPY,
      p_referral_source: ref.source || null, p_referral_campaign: ref.campaign || null
    };
    let r = await HS.sb().rpc('signup_complete', args);
    if (r.error && r.error.code === 'PGRST202') {
      // referral params not applied to the DB yet (migration pending) — retry with
      // the original 8-arg signature so signups keep working either deploy order.
      delete args.p_referral_source; delete args.p_referral_campaign;
      r = await HS.sb().rpc('signup_complete', args);
    }
    if (r.error) throw new Error(r.error.message || 'subscription save failed');
  }

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
      if (on) await HS.sb().from('app_follows').insert({ user_id: state.session.user.id, target_type: type, target_id: id });
      else await HS.sb().from('app_follows').delete().match({ user_id: state.session.user.id, target_type: type, target_id: id });
    } catch (e) { console.warn('follow', e); }
  }
  async function persistTopics(category, topics, consent) {
    if (CFG.DATA_SOURCE !== 'supabase' || !state.session) return;
    try {
      // Table is app_topic_prefs (phase1 schema) — the un-prefixed 'topic_prefs'
      // never existed, so this upsert had silently failed since the promotion.
      await HS.sb().from('app_topic_prefs').upsert({
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

  // Cross-device sync of followed communities. On a signed-in boot, merge the
  // account's app_follows(community) rows with the local list both ways: pull any
  // account follows this device hasn't seen (resolving each ZIP's name), and push
  // any local-only follows up to the account. RLS scopes app_follows to auth.uid().
  async function syncFollowsFromAccount() {
    if (CFG.DATA_SOURCE !== 'supabase' || !state.session || state.session.demo || !HS.sb) return;
    let rows;
    try {
      const res = await HS.sb().from('app_follows').select('target_id').eq('target_type', 'community');
      if (res.error) return; rows = res.data || [];
    } catch (e) { return; }
    const local = HS.followedCommunities();
    const localZips = new Set(local.map(c => String(c.zip)));
    const acctZips = new Set(rows.map(r => String(r.target_id)));
    // pull: account -> local (resolve the display name for ones we don't have)
    for (const r of rows) {
      const zip = String(r.target_id);
      if (!localZips.has(zip)) {
        let meta = null; try { meta = await HS.data.community(zip); } catch (e) {}
        local.push({ zip: zip, name: (meta && meta.name) || '', state: (meta && meta.state) || '' });
        localZips.add(zip);
      }
    }
    LS.set('myCommunities', local);
    if (!LS.get('myZip', null) && local[0]) { LS.set('myZip', String(local[0].zip)); state.zip = String(local[0].zip); }
    // push: local-only follows -> account
    for (const c of local) {
      if (!acctZips.has(String(c.zip))) {
        try { await HS.sb().from('app_follows').insert({ user_id: state.session.user.id, target_type: 'community', target_id: String(c.zip) }); } catch (e) {}
      }
    }
  }

  async function boot() {
    captureReferral();          // first-touch attribution, before anything can fail
    await injectShell();
    await bootSession();
    await syncFollowsFromAccount();
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
