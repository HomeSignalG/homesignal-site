/* Development dossier pages (/development/<state>/<key>/) carry the site's header as static HTML
   and do not load the app shell. This script gives that header the shell's own behaviour for its
   three account buttons, without the shell:
   - Share: opens the site's own Share box (#shareModal), the same targets and copy as every
     other page, from lib/share-modal.js.
   - Sign in / account: a signed-in visitor (a stored Supabase session in this browser) sees the
     same initials avatar the shell shows, linking to My Places; anyone else sees "Sign in", which
     opens the site's sign-in and comes back to this page.
   It reads only this browser's own session entry and sends nothing anywhere. */
(function () {
  'use strict';
  var d = document;

  function session() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!/^sb-[a-z0-9]+-auth-token$/.test(k || '')) continue;
        var s = JSON.parse(localStorage.getItem(k) || 'null');
        if (s && s.currentSession) s = s.currentSession;
        if (s && (s.refresh_token || s.access_token) && s.user) return s;
      }
    } catch (e) { /* storage blocked: treat as signed out */ }
    return null;
  }

  function initials(s) {
    var m = (s.user && s.user.user_metadata) || {};
    if (m.initials) return String(m.initials).slice(0, 2).toUpperCase();
    return String((s.user && s.user.email) || '?').slice(0, 2).toUpperCase();
  }

  function pageUrl() {
    var c = d.querySelector('link[rel="canonical"]');
    return (c && c.href) || location.href.split('#')[0];
  }

  var s = session();
  var signin = d.getElementById('hs-signin');
  var av = d.getElementById('hs-avatar');
  if (s && av) {
    av.textContent = initials(s);
    av.hidden = false;
    if (signin) signin.hidden = true;
  }

  // Share opens the site's own Share box (#shareModal, built by the page from partials/shell.html),
  // filled by lib/share-modal.js, the same file the app shell uses.
  var share = d.getElementById('hs-share');
  var box = d.getElementById('shareModal');
  var HS = window.HS || {};
  if (share && box && HS.fillShareBox) {
    share.hidden = false;
    var close = function () {
      box.classList.remove('show');
      d.removeEventListener('keydown', onKey);
      share.focus();
    };
    var onKey = function (e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var f = box.querySelectorAll('a[href],button:not([disabled])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    share.addEventListener('click', function () {
      HS.fillShareBox(pageUrl());
      box.classList.add('show');
      var c = box.querySelector('.mclose');
      if (c) c.focus();
      d.addEventListener('keydown', onKey);
    });
    box.addEventListener('click', function (e) {
      if (e.target === box || (e.target.closest && e.target.closest('.mclose'))) { close(); return; }
      var copy = e.target.closest && e.target.closest('#copyBtn, #shareGrid [data-hs-copy]');
      if (copy) { e.preventDefault(); HS.copyShareLink(pageUrl()); }
    });
  }
})();
