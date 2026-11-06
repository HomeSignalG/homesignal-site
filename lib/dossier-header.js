/* Development dossier pages (/development/<state>/<key>/) carry the site's header as static HTML
   and do not load the app shell. This script gives that header the shell's own behaviour for its
   three account buttons, without the shell:
   - Share: the device's share sheet where there is one, else the page link is copied.
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

  var share = d.getElementById('hs-share');
  if (share) {
    share.hidden = false;
    share.addEventListener('click', function () {
      var url = pageUrl(), title = d.title;
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {});
        return;
      }
      var done = function () {
        share.textContent = 'Link copied';
        setTimeout(function () { share.textContent = 'Share'; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link:', url); });
      } else {
        window.prompt('Copy this link:', url);
      }
    });
  }
})();
