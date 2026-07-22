// HomeSignal shell orchestrator (classic script, no build step).
// Injects partials/shell.html into every page, wires the shared chrome (nav, mobile
// drawer, all 5 modals, search, share, topics, property switcher, follows, waitlist,
// contact/community-request), boots session + active-property state, then hands control
// to the page via HS.onReady(). Persistence: seed mode -> localStorage; supabase mode -> DB.
(function () {
  const HS = (window.HS = window.HS || {});
  const CFG = window.HS_CONFIG;
  const $ = (id) => document.getElementById(id);

  // view-zip helpers (canonical copy: lib/view-zip.js — keep in sync)
  if (!HS.resolveViewedZip) {
    HS.parseZipParam = function (search) {
      if (search == null || search === '') return null;
      try {
        const z = new URLSearchParams(String(search)).get('zip');
        return (z && /^\d{5}$/.test(z)) ? z : null;
      } catch (e) { return null; }
    };
    HS.parseZipFromAddress = function (str) {
      if (str == null || str === '') return null;
      const m = String(str).match(/(\d{5})(?:-\d{4})?\s*$/);
      return (m && /^\d{5}$/.test(m[1])) ? m[1] : null;
    };
    HS.resolveViewedZip = function (opts) {
      opts = opts || {};
      const def = opts.defaultZip || '78617';
      const urlZ = opts.urlZip;
      if (urlZ && /^\d{5}$/.test(String(urlZ))) return String(urlZ);
      const myZ = opts.myZip;
      if (myZ && /^\d{5}$/.test(String(myZ))) return String(myZ);
      const sesZ = opts.sessionViewZip;
      if (sesZ && /^\d{5}$/.test(String(sesZ))) return String(sesZ);
      return def;
    };
    HS.navHref = function (page, zip) {
      if (!page) return page;
      if (!zip || !/^\d{5}$/.test(String(zip))) return page;
      return page + '?zip=' + encodeURIComponent(String(zip));
    };
    HS.pageHref = function (page, opts) {
      if (!page) return page;
      opts = opts || {};
      const params = new URLSearchParams();
      const zip = opts.zip;
      if (zip && /^\d{5}$/.test(String(zip))) params.set('zip', String(zip));
      Object.keys(opts).forEach(k => {
        if (k === 'zip') return;
        const v = opts[k];
        if (v == null || v === '') return;
        params.set(k, String(v));
      });
      const qs = params.toString();
      return page + (qs ? '?' + qs : '');
    };
    HS.itemNavHref = function (it, zip) {
      if (!it) return null;
      zip = zip && /^\d{5}$/.test(String(zip)) ? String(zip) : null;
      if (it.type || it.record_kind === 'facility' || it._facility) {
        return HS.pageHref('development.html', { zip, id: it.id });
      }
      if (it.related_project_id) {
        return HS.pageHref('development.html', { zip, id: it.related_project_id });
      }
      if (it.window_closes_at != null) {
        try {
          const d = Math.ceil((new Date(it.window_closes_at) - new Date()) / 86400000);
          if (d >= 0) return HS.pageHref('alerts.html', { zip, band: 'open', id: it.id });
        } catch (e) { /* fall through */ }
      }
      if (it.id) return HS.pageHref('alerts.html', { zip, id: it.id });
      return null;
    };
    HS.meetingNavHref = function (m, zip, projectIds) {
      if (!m) return null;
      zip = zip && /^\d{5}$/.test(String(zip)) ? String(zip) : null;
      const rid = m.related_project_id;
      if (rid) {
        const isProject = projectIds
          ? projectIds.has(rid)
          : /^proj-/i.test(String(rid));
        if (isProject) return HS.pageHref('development.html', { zip, id: rid });
        return HS.pageHref('alerts.html', { zip, id: rid });
      }
      return HS.pageHref('alerts.html', { zip, category: 'Government & civic' });
    };
    HS.sanitizeSort = function (s) {
      return ({ impact: 1, status: 1, distance: 1, newest: 1 })[s] ? s : 'impact';
    };
    var DEV_STATUS_RANK = { 'Proposed': 0, 'On file': 0, 'Decided': 1, 'Approved': 2, 'Active': 3, 'Operating': 4, 'Built': 4 };
    var DEV_REVIEW_STAGE = /\breview\b|in review|under review|hearing|submitt|pending/;
    HS.devStatusSortRank = function (item) {
      var status = String((item && item.status) || (typeof item === 'string' ? item : ''));
      var base = DEV_STATUS_RANK[status];
      if (base != null) {
        if (status === 'Proposed' && item && item.stage && DEV_REVIEW_STAGE.test(String(item.stage).toLowerCase())) return 1;
        return base;
      }
      return 5;
    };
    HS.sanitizeLens = function (n) {
      n = parseInt(n, 10);
      return (n >= 0 && n <= 2 && !isNaN(n)) ? n : 0;
    };
    HS.ZIP_NAV_PAGES = ['today.html', 'dashboard.html', 'alerts.html', 'development.html', 'maps.html', 'homesignalmap.html', 'community.html'];
    HS.MAP_PAGES = ['maps.html', 'homesignalmap.html'];
    HS.hasViewedZipContext = function (opts) {
      opts = opts || {};
      if (!opts.urlZip) opts.urlZip = HS.parseZipParam(location.search);
      if (opts.myZip == null) opts.myZip = LS.get('myZip', null);
      if (opts.sessionViewZip == null) opts.sessionViewZip = SS.get('viewZip');
      const urlZ = opts.urlZip;
      if (urlZ && /^\d{5}$/.test(String(urlZ))) return true;
      const myZ = opts.myZip;
      if (myZ && /^\d{5}$/.test(String(myZ))) return true;
      const sesZ = opts.sessionViewZip;
      if (sesZ && /^\d{5}$/.test(String(sesZ))) return true;
      return false;
    };
  }

  // ------------------------------------------------------------------ state --
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem('hs:' + k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hs:' + k, JSON.stringify(v)); } catch (e) {} }
  };
  const SS = {
    get(k) { try { return sessionStorage.getItem('hs:' + k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) sessionStorage.removeItem('hs:' + k); else sessionStorage.setItem('hs:' + k, String(v)); } catch (e) {} }
  };
  function captureUrlViewZip() {
    const z = HS.parseZipParam(location.search);
    if (z) SS.set('viewZip', z);
    return z;
  }
  let _zip = HS.resolveViewedZip({
    urlZip: captureUrlViewZip(),
    myZip: LS.get('myZip', null),
    sessionViewZip: SS.get('viewZip'),
    defaultZip: CFG.DEFAULT_ZIP
  });
  const state = HS.state = {
    session: null,           // {user:{id,email}} or null
    properties: [],
    activePropId: LS.get('activeProp', null),
    follows: new Set(LS.get('follows', [])),
    dismissed: new Set(LS.get('dismissed', [])),
    topicPrefs: {},   // hydrated in boot() — server for signed-in, localStorage for anonymous
    get activeProperty() {
      // Never a demo/sample home — see lib/data.js::pickActiveProperty (config.js:14-20).
      return HS.pickActiveProperty(this.properties, this.activePropId);
    }
  };
  Object.defineProperty(state, 'zip', {
    get() { return _zip; },
    set(z) {
      if (z == null) return;
      z = String(z).trim();
      if (!/^\d{5}$/.test(z) || z === _zip) return;
      _zip = z;
      SS.set('viewZip', z);
      paintTopbar();
    },
    enumerable: true,
    configurable: true
  });

  // Has the visitor set their own area yet (a saved property OR a saved ZIP)?
  // Signed-in residents: server-backed only (hydrated properties + app_follows).
  // Anonymous visitors: localStorage myZip (unchanged).
  let _accountHydrated = false;
  let _serverFollowZips = [];
  HS.hasArea = function () {
    if (state.session && !state.session.demo && _accountHydrated) {
      const O = window.HSOnboarding;
      if (O) return O.hasServerLocation({ activeProperty: state.activeProperty, serverFollowZips: _serverFollowZips });
    }
    return !!(state.activeProperty || LS.get('myZip', null));
  };
  HS.serverFollowZips = function () { return _serverFollowZips.slice(); };
  // "Sample ZIP Code" labels appear only on the designated demo ZIP (DEFAULT_ZIP),
  // never because the visitor is signed out or has not saved an area yet.
  HS.isSampleZip = function (zip) {
    const z = (zip != null ? String(zip) : String(state.zip)).trim();
    return z === String(CFG.DEFAULT_ZIP);
  };
  HS.isSample = function () { return HS.isSampleZip(state.zip); };

  // The ONE formatter for a property's logged address ("13313 Coomes Dr, Del
  // Valle, TX 78617"). Built only from fields actually saved on the row —
  // absent parts stay absent, never guessed.
  HS.homeAddressLine = function (p) {
    if (!p) return '';
    const tail = [p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [p.address, tail].filter(Boolean).join(', ');
  };
  // Is this row the resident's OWN home (never a demo/sample property)?
  // app_properties rows are written with label:'home'; the seed's designated
  // home is tagged 'Your home' (pure-seed preview only). Live-demo rows carry
  // sample:true and are never presented as the visitor's own home.
  HS.isRealHome = function (p) {
    return !!(p && !p.sample && !p.demo
      && (p.label === 'home' || p.tag === 'home' || p.tag === 'Your home'));
  };
  // The active property IFF it's a real (non-sample) home located in the ZIP being
  // viewed — the ONE test for "may I anchor the map / pin 'Your home' here". Returns
  // null for a sample home, a home in a different ZIP, or none. Single source: maps /
  // dashboard + the shared where-line all call this (no per-page copies — guarded by
  // test/realhome.test.mjs).
  HS.realHome = function () {
    var p = state.activeProperty;
    return (p && HS.isRealHome(p) && p.zip === state.zip) ? p : null;
  };

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
    // First-time onboarding is non-dismissible — no Escape close.
  });

  // -------------------------------------------------- first-time onboarding -----------
  // Full-screen flow for signed-in residents with no server-saved home AND no
  // server-saved community follow. Completion is implicit once server location exists.
  let _onbSavedZip = null;
  let _onbOptin = null;
  let _onbSaving = false;
  let _onbTrap = null;

  function onboardingCtx() {
    return {
      hydrated: _accountHydrated,
      activeProperty: state.activeProperty,
      serverFollowZips: _serverFollowZips
    };
  }

  function clearAccountLocalState() {
    LS.set('myZip', null);
    LS.set('myCommunities', []);
    LS.set('activeProp', null);
    LS.set('accountUid', null);
    state.activePropId = null;
    _serverFollowZips = [];
  }

  function ensureAccountScope() {
    if (!state.session || state.session.demo) return;
    const uid = state.session.user.id;
    const cached = LS.get('accountUid', null);
    if (cached === uid) return;
    clearAccountLocalState();
    LS.set('accountUid', uid);
  }

  async function refreshServerFollowZips() {
    _serverFollowZips = [];
    if (CFG.DATA_SOURCE !== 'supabase' || !state.session || state.session.demo || !HS.sb) return;
    try {
      const res = await HS.sb().from('app_follows').select('target_id').eq('target_type', 'community');
      if (!res.error) _serverFollowZips = (res.data || []).map(r => String(r.target_id)).filter(z => /^\d{5}$/.test(z));
    } catch (e) { /* leave empty; onboarding may still proceed on next hydrate */ }
  }

  async function hydrateAccountLocation() {
    _accountHydrated = false;
    if (!state.session || state.session.demo) {
      state.properties = await HS.data.properties();
      _accountHydrated = true;
      return;
    }
    ensureAccountScope();
    await syncFollowsFromAccount();
    state.properties = await HS.data.properties();
    const validIds = new Set(state.properties.map(p => p.id));
    if (state.activePropId && !validIds.has(state.activePropId)) {
      state.activePropId = null;
      LS.set('activeProp', null);
    }
    if (!state.activePropId && state.properties[0]) {
      state.activePropId = state.properties[0].id;
      LS.set('activeProp', state.activePropId);
    }
    await refreshServerFollowZips();
    _accountHydrated = true;
  }

  function loadOnboardingLib() {
    if (window.HSOnboarding) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-hs-onboarding]')) {
        if (window.HSOnboarding) resolve(); else reject(new Error('onboarding script pending'));
        return;
      }
      const s = document.createElement('script');
      s.src = 'lib/onboarding.js';
      s.dataset.hsOnboarding = '1';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('onboarding script failed')); };
      document.head.appendChild(s);
    });
  }

  HS.needsOnboarding = function () {
    const O = window.HSOnboarding;
    if (!O) return false;
    return O.needsOnboarding(state.session, onboardingCtx());
  };

  function setOnboardingBusy(busy) {
    const overlay = onbEl('onboardingOverlay');
    if (overlay) overlay.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function showOnbRecovery(show) {
    const el = onbEl('onbRecovery');
    if (el) el.classList.toggle('hidden', !show);
  }

  function trapOnboardingFocus(e) {
    if (e.key !== 'Tab') return;
    const overlay = onbEl('onboardingOverlay');
    if (!overlay || overlay.hidden) return;
    const f = overlay.querySelectorAll('a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function lockOnboardingUi(lock) {
    document.body.classList.toggle('onboarding-lock', !!lock);
    if (lock) {
      _onbTrap = trapOnboardingFocus;
      document.addEventListener('keydown', _onbTrap);
    } else if (_onbTrap) {
      document.removeEventListener('keydown', _onbTrap);
      _onbTrap = null;
    }
  }

  function onbEl(id) { return document.getElementById(id); }
  function onbMsg(text, err) {
    const m = onbEl('onbMsg'); if (!m) return;
    m.textContent = text || '';
    m.classList.toggle('err', !!err);
  }

  function showOnbStep(step) {
    const steps = ['onbStepWelcome', 'onbStepLocation', 'onbStepDest'];
    steps.forEach(function (id) {
      const el = onbEl(id); if (!el) return;
      const active = id === step;
      el.hidden = !active;
      el.classList.toggle('onb-active', active);
      el.classList.remove('onb-exit');
    });
    const overlay = onbEl('onboardingOverlay');
    if (overlay) {
      const titles = { onbStepWelcome: 'onbWelcomeTitle', onbStepLocation: 'onbLocTitle', onbStepDest: 'onbDestTitle' };
      overlay.setAttribute('aria-labelledby', titles[step] || 'onbWelcomeTitle');
    }
    if (step === 'onbStepLocation') {
      setTimeout(function () {
        const a = onbEl('onbAddr'); if (a) a.focus();
      }, 320);
    } else {
      const titleId = { onbStepWelcome: 'onbWelcomeTitle', onbStepLocation: 'onbLocTitle', onbStepDest: 'onbDestTitle' }[step];
      const title = titleId ? onbEl(titleId) : null;
      if (title) setTimeout(function () { title.focus(); }, 320);
    }
  }

  function transitionOnbStep(fromId, toId) {
    const from = onbEl(fromId);
    if (from) from.classList.add('onb-exit');
    setTimeout(function () { showOnbStep(toId); }, 220);
  }

  function refreshOnbContinue() {
    const O = window.HSOnboarding; if (!O) return;
    const addr = (onbEl('onbAddr') && onbEl('onbAddr').value) || '';
    const zip = (onbEl('onbZip') && onbEl('onbZip').value) || '';
    const btn = onbEl('onbContinueBtn');
    if (btn) btn.disabled = _onbSaving || !O.canContinue(addr, zip);
    if (!_onbSaving) {
      onbMsg('');
      showOnbRecovery(false);
    }
    const unc = onbEl('onbUncovered'); if (unc) unc.classList.add('hidden');
  }

  async function persistCommunityFollow(zip) {
    const O = window.HSOnboarding;
    zip = String(zip || '').trim();
    if (!/^\d{5}$/.test(zip)) throw new Error('Enter a valid 5-digit ZIP code.');
    let meta = null;
    try { meta = await HS.data.community(zip); } catch (e) {}
    HS.followCommunity({ zip: zip, name: (meta && meta.name) || '', state: (meta && meta.state) || '' });
    if (CFG.DATA_SOURCE !== 'supabase' || !state.session || state.session.demo || !HS.sb) {
      _serverFollowZips = [...new Set(_serverFollowZips.concat([zip]))];
      return;
    }
    const res = await HS.sb().from('app_follows').insert({
      user_id: state.session.user.id, target_type: 'community', target_id: zip
    }).select();
    if (res.error && !(O && O.isDuplicateDbError(res.error))) {
      throw new Error('Could not save your community — please try again.');
    }
    await refreshServerFollowZips();
    if (!_serverFollowZips.includes(zip)) {
      throw new Error('Your community did not save — please try again.');
    }
    if (String(LS.get('myZip', null)) !== zip) {
      throw new Error('Your default ZIP did not update — please try again.');
    }
  }

  async function saveOnboardingAddress(addr) {
    const O = window.HSOnboarding;
    let m = null, unavailable = false;
    try {
      const r = await HS.sb().functions.invoke('geocode-address', { body: { address: addr } });
      if (r.error) unavailable = true;
      else m = (r.data && r.data.match) || null;
    } catch (e) { unavailable = true; }
    if (unavailable) throw new Error("The address service couldn't be reached — please try again in a minute.");
    if (!m || !m.zip) {
      throw new Error("We couldn't confirm that address against U.S. Census records — check the street, city and state, then try again.");
    }
    if (!O.validCoords(m.lat, m.lng)) {
      throw new Error("We couldn't confirm a valid location for that address — try again or enter your ZIP code instead.");
    }
    const row = {
      user_id: state.session.user.id,
      address: String(m.matchedAddress || '').split(',')[0],
      city: m.city || null, state: m.state || null, zip: m.zip,
      lat: m.lat, lng: m.lng, label: 'home'
    };
    const existing = (state.properties || []).find(p => HS.isRealHome(p));
    let saved = null;
    if (existing) {
      const upd = await HS.sb().from('app_properties').update(row)
        .eq('id', existing.id).eq('user_id', state.session.user.id).select().single();
      if (upd.error || !upd.data) throw new Error("Couldn't save your home — please try again.");
      saved = upd.data;
    } else {
      const ins = await HS.sb().from('app_properties').insert(row).select().single();
      if (ins.error || !ins.data) throw new Error("Couldn't save your home — please try again.");
      saved = ins.data;
    }
    LS.set('activeProp', saved.id);
    state.activePropId = saved.id;
    state.properties = await HS.data.properties();
    if (!state.properties.find(p => p.id === saved.id)) {
      throw new Error("Your home saved but could not be verified — please try again.");
    }
    if (await HS.data.isCovered(m.zip)) {
      await persistCommunityFollow(m.zip);
      _onbOptin = await HS.ensureAreaSubscribed(m.zip, false, true, true);
    }
    state.zip = m.zip;
    paintTopbar();
    return m.zip;
  }

  async function saveOnboardingZip(zip) {
    const covered = await HS.data.isCovered(zip);
    if (!covered) return { covered: false, zip: zip };
    await persistCommunityFollow(zip);
    _onbOptin = await HS.ensureAreaSubscribed(zip, false, true, true);
    paintTopbar();
    return { covered: true, zip: zip };
  }

  function paintOnbDestinations(zip) {
    const O = window.HSOnboarding; if (!O) return;
    const grid = onbEl('onbDestGrid'); if (!grid) return;
    const saved = onbEl('onbSavedZip'); if (saved) saved.textContent = zip;
    grid.innerHTML = '';
    Object.keys(O.DESTINATIONS).forEach(function (key) {
      const d = O.DESTINATIONS[key];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'onb-dest';
      btn.setAttribute('role', 'listitem');
      btn.setAttribute('aria-label', d.title + '. ' + d.desc);
      btn.innerHTML = '<span class="icon" aria-hidden="true">' + d.icon + '</span>'
        + '<span class="copy"><strong>' + HS.esc(d.title) + '</strong><span>' + HS.esc(d.desc) + '</span></span>';
      btn.onclick = function () { HS.finishOnboarding(key); };
      grid.appendChild(btn);
    });
  }

  HS.startOnboarding = function () {
    if (!HS.needsOnboarding()) return;
    const overlay = onbEl('onboardingOverlay'); if (!overlay) return;
    _onbSavedZip = null;
    _onbOptin = null;
    if (onbEl('onbAddr')) onbEl('onbAddr').value = '';
    if (onbEl('onbZip')) onbEl('onbZip').value = '';
    onbMsg('');
    const unc = onbEl('onbUncovered'); if (unc) unc.classList.add('hidden');
    showOnbRecovery(false);
    refreshOnbContinue();
    overlay.hidden = false;
    lockOnboardingUi(true);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    showOnbStep('onbStepWelcome');
  };

  HS.finishOnboarding = function (destKey) {
    const O = window.HSOnboarding;
    const zip = _onbSavedZip;
    if (!O || !zip) return;
    const href = O.destinationHref(destKey, zip, HS.navHref);
    if (!href) return;
    const overlay = onbEl('onboardingOverlay');
    if (overlay) {
      overlay.classList.remove('show');
      setTimeout(function () {
        overlay.hidden = true;
        lockOnboardingUi(false);
      }, 280);
    }
    if (_onbOptin) {
      try { sessionStorage.setItem('hs:areaOptin', JSON.stringify(_onbOptin)); } catch (e) {}
    }
    location.href = href;
  };

  HS.continueOnboarding = async function () {
    const O = window.HSOnboarding; if (!O) return;
    if (_onbSaving) return;
    const addr = (onbEl('onbAddr') && onbEl('onbAddr').value) || '';
    const zipInput = (onbEl('onbZip') && onbEl('onbZip').value) || '';
    const mode = O.inputMode(addr, zipInput);
    if (!mode) return;
    _onbSaving = true;
    const btn = onbEl('onbContinueBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    setOnboardingBusy(true);
    showOnbRecovery(false);
    onbMsg('');
    try {
      let savedZip = null;
      if (mode === 'address') {
        onbMsg('Confirming your address…');
        savedZip = await saveOnboardingAddress(addr.trim());
      } else {
        const z = zipInput.trim();
        onbMsg('Saving your ZIP…');
        const res = await saveOnboardingZip(z);
        if (!res.covered) {
          if (onbEl('onbUncoveredZip')) onbEl('onbUncoveredZip').textContent = z;
          onbEl('onbUncovered').classList.remove('hidden');
          onbMsg('This ZIP is not live yet — request it below or try another.', true);
          return;
        }
        savedZip = res.zip;
      }
      if (!O.hasServerLocation({ activeProperty: state.activeProperty, serverFollowZips: _serverFollowZips })) {
        throw new Error('Your location did not save completely — please try again.');
      }
      _onbSavedZip = savedZip;
      paintOnbDestinations(savedZip);
      transitionOnbStep('onbStepLocation', 'onbStepDest');
    } catch (e) {
      onbMsg((e && e.message) || 'Something went wrong — please try again.', true);
      showOnbRecovery(true);
    } finally {
      _onbSaving = false;
      setOnboardingBusy(false);
      if (btn) { btn.textContent = 'Continue'; }
      refreshOnbContinue();
    }
  };

  HS.submitOnboardingRequest = async function () {
    const el = onbEl('onbReqEmail'), e = el && el.value.trim();
    if (!e || e.indexOf('@') < 1) { if (el) { el.style.borderColor = '#c23b34'; el.focus(); } return; }
    if (el) el.style.borderColor = '';
    const row = { email: e, zip: (onbEl('onbUncoveredZip') && onbEl('onbUncoveredZip').textContent) || '' };
    const ref = HS.referralToken(); if (ref) row.source = ref;
    await persistEmail('community_requests', row);
    onbMsg('Request received — we will email you when your area goes live.');
    if (onbEl('onbUncovered')) onbEl('onbUncovered').classList.add('hidden');
  };

  function wireOnboarding() {
    const O = window.HSOnboarding;
    const welcomeBtn = onbEl('onbWelcomeBtn');
    if (welcomeBtn) welcomeBtn.onclick = function () { transitionOnbStep('onbStepWelcome', 'onbStepLocation'); };
    const cont = onbEl('onbContinueBtn');
    if (cont) cont.onclick = function () { HS.continueOnboarding(); };
    const addr = onbEl('onbAddr'), zip = onbEl('onbZip');
    if (addr) {
      addr.addEventListener('input', refreshOnbContinue);
      addr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && O && O.canContinue(addr.value, (onbEl('onbZip') && onbEl('onbZip').value) || '') && !_onbSaving) {
          e.preventDefault(); HS.continueOnboarding();
        }
      });
    }
    if (zip) {
      zip.addEventListener('input', refreshOnbContinue);
      zip.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && O && O.canContinue((onbEl('onbAddr') && onbEl('onbAddr').value) || '', zip.value) && !_onbSaving) {
          e.preventDefault(); HS.continueOnboarding();
        }
      });
    }
    const retry = onbEl('onbRetryBtn');
    if (retry) retry.onclick = function () { showOnbRecovery(false); HS.continueOnboarding(); };
    const zipInstead = onbEl('onbZipInsteadBtn');
    if (zipInstead) zipInstead.onclick = function () {
      if (onbEl('onbAddr')) onbEl('onbAddr').value = '';
      showOnbRecovery(false);
      onbMsg('Enter your ZIP code below, then press Continue.');
      if (onbEl('onbZip')) onbEl('onbZip').focus();
      refreshOnbContinue();
    };
    const req = onbEl('onbReqBtn');
    if (req) req.onclick = function () { HS.submitOnboardingRequest(); };
    const reqEmail = onbEl('onbReqEmail');
    if (reqEmail) reqEmail.addEventListener('keydown', function (e) { if (e.key === 'Enter') HS.submitOnboardingRequest(); });
  }

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
      if (confirm('Sign out?')) {
        clearAccountLocalState();
        HS.sb().auth.signOut().then(() => location.reload());
      }
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
        await hydrateTopicPrefs();
        await hydrateAccountLocation();
        HS.paintTopicCounts();
        paintTopbar();
        setTimeout(() => {
          HS.closeModal('authModal');
          const back = new URLSearchParams(location.search).get('return');
          if (HS.needsOnboarding && HS.needsOnboarding()) {
            HS.startOnboarding();
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
  // Switcher-modal path: pages compute their home-anchored data (pin, header
  // address, distances) once at load, so switching focus reloads the current
  // page to rebuild everything for the newly active home (same pattern as
  // saveHome). Only on an actual change — re-picking the active home just
  // closes the modal. Other selectProperty callers must NOT reload: property
  // cards navigate right after selecting, and property.html syncs the active
  // home during page load (a reload there would loop).
  HS.switchProperty = function (id) {
    const changed = id !== state.activePropId;
    HS.selectProperty(id);
    HS.closeModal('switcherModal');
    if (changed) location.reload();
  };
  function paintNavHrefs() {
    if (!HS.ZIP_NAV_PAGES || !HS.navHref) return;
    const zip = state.zip;
    const stamp = (a, base) => {
      if (!base || HS.ZIP_NAV_PAGES.indexOf(base) < 0) return;
      a.setAttribute('href', HS.navHref(base, zip));
    };
    const nav = document.getElementById('hs-nav');
    if (nav) {
      nav.querySelectorAll('a[href]').forEach(a => {
        stamp(a, (a.getAttribute('href') || '').split('?')[0]);
      });
    }
    // In-page map links (dashboard, today, cross-map switcher) reuse the same ZIP stamp.
    document.querySelectorAll('#hs-slot a[data-znav]').forEach(a => {
      stamp(a, a.getAttribute('data-znav'));
    });
  }
  function paintTopbar() {
    const p = state.activeProperty;
    if ($('locLabel')) {
      // A saved home is labeled AS the home ("Your home · <street>") — a bare
      // street line never said which address the app had on file. The full
      // logged address (street, city, state ZIP) rides in the hover tooltip.
      // A saved ZIP shows "ZIP <zip>"; otherwise the visitor is on the default
      // Del Valle sample, so flag it clearly.
      const myZip = LS.get('myZip', null);
      $('locLabel').textContent = p ? ((HS.isRealHome(p) ? 'Your home · ' : '') + p.address)
        : (myZip ? ('ZIP ' + myZip)
        : (HS.isSample()
          ? ((window.HS_SEED ? window.HS_SEED.community.name : '—') + ' (Sample Zip Code)')
          : ('ZIP ' + state.zip)));
      const locWrap = $('locLabel').closest('.loc');
      if (locWrap) locWrap.title = p
        ? ((HS.isRealHome(p) ? 'Your home: ' : '') + HS.homeAddressLine(p) + ' — tap to switch')
        : 'Tap to set your area';
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
    paintNavHrefs();
  }
  // -------------------------------------------- page-header context line ------
  // Say up front WHICH address (or area) the page is about, on every app page
  // with a .ph header — ONE shared injector (a new page gets it for free; a
  // page that must not carry it sets data-no-where on <body>). A real saved
  // property IN the viewed ZIP shows its full logged address; otherwise the
  // viewed area — never a demo/sample address presented as the visitor's own
  // (the same never-faked gate the maps use). Idempotent: pages that rebuild
  // their .ph dynamically (development.html) just call it again after painting.
  HS.paintWhereLine = async function () {
    try {
      const ph = document.querySelector('#hs-slot .ph');
      if (!ph || document.body.dataset.noWhere != null) return;
      let el = document.getElementById('phWhere');
      if (!el || !el.isConnected) {
        el = document.createElement('p');
        el.id = 'phWhere'; el.className = 'ph-where'; el.style.display = 'none';
        const h1 = ph.querySelector('h1');
        if (h1) h1.insertAdjacentElement('afterend', el); else ph.appendChild(el);
      }
      const p = HS.realHome();
      if (p) {
        const tag = HS.isRealHome(p) ? 'Your home' : (p.tag || p.label || 'Saved place');
        el.textContent = '⌂ ' + tag + ' · ' + HS.homeAddressLine(p);
      } else {
        let c = null;
        try { c = HS.data ? await HS.data.community(state.zip) : null; } catch (e) {}
        el.textContent = c ? ('◍ ' + c.name + (c.state ? ', ' + c.state : '')
          + (HS.isSample() ? ' — (Sample Zip Code)' : '')) : '';
      }
      el.style.display = el.textContent ? '' : 'none';
    } catch (e) { /* a missing context line must never break the page */ }
  };

  HS.openSwitcher = function () {
    const list = $('switcherList'); if (!list) return;
    $('switcherSub').textContent = "You're following " + state.properties.length + " saved place" +
      (state.properties.length === 1 ? '' : 's') + '.';
    list.innerHTML = state.properties.map(p => `
      <div class="swrow ${p.id === state.activePropId ? 'active' : ''}" onclick="HS.switchProperty('${p.id}')">
        <div class="miniscore">${p.score || ''}</div>
        <div class="pinfo"><div class="pt">${HS.esc(p.address)}</div>
          <div class="pa">${HS.esc(HS.isRealHome(p) ? 'Your home' : (p.tag || p.label))} · ${HS.esc(p.city)}, ${HS.esc(p.state)} ${HS.esc(p.zip)}</div></div>
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
  // "Add a home / area" entry points: a signed-in resident gets the Census-confirmed
  // home flow (private, owner-only rows); a signed-out visitor gets the no-login ZIP
  // box so the sample experience never dead-ends at a sign-in wall. Restores the
  // pre-#262 nudge behavior without weakening the privacy model (saving still needs auth).
  HS.addHome = function () {
    if (state.session && !state.session.demo) HS.openHome();
    else if (HS.openLoc) HS.openLoc();
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
        await HS.ensureAreaSubscribed(m.zip, true);   // register the digest floor (page reloads below)
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
      await HS.ensureAreaSubscribed(z, true);   // register the digest floor (redirect below)
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
      HS.ensureAreaSubscribed(zip, false);   // follow (no consent) + show the inline email opt-in card
    }
    paintTopbar();
    const strip = document.getElementById('dashCommunities') || document.getElementById('commStrip');
    if (strip) strip.innerHTML = HS.communitiesStripHTML();
  };

  // Bridge the app -> digest system. Following an area (save-home, ZIP lookup, or the
  // community Follow button) registers the resident in public.users/user_subscriptions
  // — the tables digest.py actually emails from — so "following your community" delivers
  // alerts instead of only updating app state (the CH-class gap: app rows but 0 digest
  // rows -> no email). The NARROW floor: development/land-use + hearings, but ONLY the
  // labels this community really carries (word-for-word from its cascaded
  // government_topics), so we never subscribe to a topic with no feed. Purely ADDITIVE
  // (subscribe_area_defaults, ON CONFLICT DO NOTHING) — it can never delete a topic the
  // user already chose (unlike signup_complete, which reconciles-to-exact). No silent
  // subscription: on success the resident sees a confirmation naming what they'll get.
  const AREA_DEFAULT_TOPICS = ['Planning, zoning & development', 'County Commission & county business'];
  // The exact wording the resident affirms when they tap "Email me these alerts" — stored
  // on the users row (marketing_consent_copy) as the audit trail of what they agreed to.
  const AREA_CONSENT_COPY = 'Email me new development & hearing alerts for this ZIP. No spam · unsubscribe anytime.';
  HS.ensureAreaSubscribed = async function (zip, willNavigate, suppressUi, throwOnError) {
    if (CFG.DATA_SOURCE !== 'supabase' || !state.session || state.session.demo || !HS.sb) return null;
    zip = String(zip || '').trim();
    if (!/^\d{5}$/.test(zip)) {
      if (throwOnError) throw new Error('Enter a valid 5-digit ZIP code.');
      return null;
    }
    let ct = null;
    try { ct = await HS.data.communityGovTopics(zip); } catch (e) {
      if (throwOnError) throw new Error('Could not load community topics — please try again.');
      return null;
    }
    if (!ct || !ct.rootId || !ct.labels) return null;
    const has = new Set(ct.labels);
    const labels = AREA_DEFAULT_TOPICS.filter(t => has.has(t));
    const subs = labels.map(t => ({ pipeline_type: 'government_notice', topic: t }));
    if (!subs.length) return null;   // community carries neither floor topic -> never a zero-sub row
    try {
      const r = await HS.sb().rpc('subscribe_area_defaults',
        HS.followRpcArgs(state.session.user.email, ct.rootId, zip, subs));
      if (r && r.error) {
        if (throwOnError) throw new Error(r.error.message || 'Could not save your alerts — please try again.');
        console.warn('area-subscribe', r.error);
        return null;
      }
    } catch (e) {
      if (throwOnError) throw new Error((e && e.message) || 'Could not save your alerts — please try again.');
      console.warn('area-subscribe', e);
      return null;
    }
    // Surface the inline email opt-in card. Reload/redirect callers stash a one-shot flag
    // boot() renders on the destination page; in-place callers render immediately.
    const info = { zip: zip, communityId: ct.rootId, topics: labels };
    if (!suppressUi) {
      if (willNavigate) { try { sessionStorage.setItem('hs:areaOptin', JSON.stringify(info)); } catch (e) {} }
      else HS.showAreaOptin(info);
    }
    return info;
  };
  // The inline EMAIL OPT-IN card — a persistent, deliberately-tapped affirmative (never a
  // disappearing toast, per the founder consent decision). Shown after a covered follow.
  // Tapping "Email me these alerts" is the ONLY action that sets marketing_consent.
  HS.showAreaOptin = function (info) {
    if (!info || !info.zip) return;
    let box = $('hsOptin');
    if (!box) { box = document.createElement('div'); box.id = 'hsOptin'; document.body.appendChild(box); }
    box.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:60;'
      + 'max-width:440px;width:calc(100% - 32px);background:#fff;border:1px solid #d9e2dc;border-radius:14px;'
      + 'box-shadow:0 8px 28px rgba(0,0,0,.18);padding:14px 16px;font:400 13.5px/1.4 var(--font,system-ui)';
    box.innerHTML =
      '<div style="font-weight:700;color:var(--ink,#12261d)">✓ Now following development &amp; hearings in ' + HS.esc(info.zip) + '</div>'
      + '<div id="optinSub" style="color:var(--ink-3,#5a6b63);margin:4px 0 10px">' + HS.esc(AREA_CONSENT_COPY) + '</div>'
      + '<div style="display:flex;gap:10px;align-items:center">'
      +   '<button type="button" id="optinYes" style="background:var(--green,#157a49);color:#fff;border:0;border-radius:9px;padding:8px 14px;font-weight:700;cursor:pointer">✉ Email me these alerts</button>'
      +   '<button type="button" id="optinNo" style="background:none;border:0;color:var(--ink-3,#5a6b63);cursor:pointer;font-size:12.5px">Not now</button>'
      + '</div>';
    $('optinYes').onclick = function () { HS.enableAreaEmail(info); };
    $('optinNo').onclick = function () { box.style.display = 'none'; box.innerHTML = ''; };
  };
  // The affirmative: the ONLY caller of enable_area_email_alerts, the ONLY writer of
  // marketing_consent. Sends the floor labels under the 'notices' key + the consent copy
  // + version for the audit trail. Additive server-side (never clobbers other topics).
  HS.enableAreaEmail = async function (info) {
    if (!info || !state.session || !HS.sb) return;
    const btn = $('optinYes'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    const topics = { notices: (info.topics || []).slice() };   // floor labels are government_notice -> 'notices'
    try {
      const r = await HS.sb().rpc('enable_area_email_alerts',
        HS.optinRpcArgs(state.session.user.email, info.communityId, info.zip, topics, CONSENT_VERSION, AREA_CONSENT_COPY));
      if (r && r.error) throw new Error(r.error.message || 'consent save failed');
    } catch (e) {
      console.warn('area-optin', e);
      if (btn) { btn.disabled = false; btn.textContent = '✉ Email me these alerts'; }
      const sub = $('optinSub'); if (sub) sub.textContent = "Couldn't save — please try again.";
      return;
    }
    const box = $('hsOptin');
    if (box) box.innerHTML = '<div style="font-weight:700;color:var(--ink,#12261d)">✓ Emailing you development &amp; hearings for '
      + HS.esc(info.zip) + '.</div><div style="color:var(--ink-3,#5a6b63);margin-top:4px">Unsubscribe anytime.</div>';
  };
  // Chip row of followed ZIP codes (+ an add button), reused across pages.
  HS.communitiesStripHTML = function (opts) {
    opts = opts || {};
    const list = HS.followedCommunities();
    const chips = list.map(c =>
      '<a class="wchip" href="' + HS.esc(HS.pageHref('community.html', { zip: c.zip })) + '" style="text-decoration:none">◍ ' +
      HS.esc(c.name || ('ZIP ' + c.zip)) + '</a>').join('');
    const emptyLabel = opts.zipLabels
      ? 'No ZIP codes yet.'
      : 'No communities yet.';
    const addLabel = opts.zipLabels ? '＋ Add a ZIP Code' : '＋ Add a zip code';
    const empty = list.length ? '' : '<span class="quiet" style="font-size:12.5px;margin-right:8px">' + emptyLabel + '</span>';
    return '<div class="chips">' + empty + chips +
      '<button class="wchip" type="button" onclick="HS.openLoc()" style="cursor:pointer;border-style:dashed">' + addLabel + '</button></div>';
  };

  // -------------------------------------------------- topic prefs (hydrate) -----
  // Signed-in: app_topic_prefs is source of truth; localStorage is a write-through
  // cache stamped with topicPrefsUid so a second account never inherits the first.
  // Anonymous: localStorage only until login, then server wins on hydrate.
  const util = HS.topicPrefsUtil;
  const TOPIC_PREF_CATS = util.TOPIC_PREF_CATS;
  function cacheTopicPrefs(prefs, userId) {
    LS.set('topicPrefs', prefs);
    if (userId) LS.set('topicPrefsUid', userId);
    else { try { localStorage.removeItem('hs:topicPrefsUid'); } catch (e) {} }
  }
  async function hydrateTopicPrefs() {
    const authenticated = CFG.DATA_SOURCE === 'supabase' && state.session && !state.session.demo && HS.sb;
    if (!authenticated) {
      state.topicPrefs = util.hydrateAnonymousPrefs(LS.get('topicPrefs', {}));
      return;
    }
    const uid = state.session.user.id;
    try {
      const res = await HS.sb().from('app_topic_prefs')
        .select('category, topics, share_consent')
        .eq('user_id', uid);
      if (res.error) throw res.error;
      state.topicPrefs = util.hydrateSignedInPrefs(res.data);
      cacheTopicPrefs(state.topicPrefs, uid);
    } catch (e) {
      console.warn('topic-prefs hydrate', e);
      state.topicPrefs = util.hydrateSignedInFailure();
      cacheTopicPrefs({}, uid);
    }
  }
  HS.paintTopicCounts = function () {
    TOPIC_PREF_CATS.forEach(k => {
      const n = util.topicCount(state.topicPrefs, k);
      const el = $('cc-' + k);
      if (el) el.textContent = n + ' topic' + (n === 1 ? '' : 's') + ' followed';
    });
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
    cacheTopicPrefs(state.topicPrefs, state.session && state.session.user && state.session.user.id);
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
    HS.paintTopicCounts();
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
    _serverFollowZips = rows.map(r => String(r.target_id)).filter(z => /^\d{5}$/.test(z));
    const local = HS.followedCommunities();
    const localZips = new Set(local.map(c => String(c.zip)));
    const acctZips = new Set(_serverFollowZips);
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
    if (_serverFollowZips.length) {
      LS.set('myZip', _serverFollowZips[0]);
      state.zip = _serverFollowZips[0];
    } else if (!LS.get('myZip', null) && local[0]) {
      LS.set('myZip', String(local[0].zip));
      state.zip = String(local[0].zip);
    }
    // push: local-only follows -> account
    for (const c of local) {
      if (!acctZips.has(String(c.zip))) {
        try { await HS.sb().from('app_follows').insert({ user_id: state.session.user.id, target_type: 'community', target_id: String(c.zip) }); } catch (e) {}
      }
    }
    await refreshServerFollowZips();
  }

  async function boot() {
    captureReferral();          // first-touch attribution, before anything can fail
    await injectShell();
    try { await loadOnboardingLib(); wireOnboarding(); } catch (e) { console.warn('onboarding', e); }
    await bootSession();
    await hydrateTopicPrefs();
    await hydrateAccountLocation();
    paintTopbar();
    HS.paintWhereLine();   // shared header context line (async, never blocks boot)
    buildShare();
    wireSearch();
    paintBell();
    // legacy deep link: /index.html?signin=1 (or any page) opens the sign-in modal
    if (!state.session && new URLSearchParams(location.search).get('signin') === '1') HS.openAuth();
    // One-shot: a covered save-home / ZIP lookup that navigated here left the email
    // opt-in card to render once the new page settled (follow ≠ consent — explicit tap).
    try {
      const optin = sessionStorage.getItem('hs:areaOptin');
      if (optin) { sessionStorage.removeItem('hs:areaOptin'); setTimeout(() => { try { HS.showAreaOptin(JSON.parse(optin)); } catch (e) {} }, 400); }
    } catch (e) {}
    if (HS.needsOnboarding && HS.needsOnboarding()) HS.startOnboarding();
    _resolveReady(HS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
