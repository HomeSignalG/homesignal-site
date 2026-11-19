/* The site's Share box (#shareModal in partials/shell.html): its list of share targets and the
   grid built from it. ONE copy, used by shell.js on every app page and by the static development
   pages (lib/dossier-header.js), so both show the same Share box with the same targets.
   No inline handlers: a "Copy link" target carries data-hs-copy, and the page that shows the box
   handles that click (shell.js and dossier-header.js each listen on #shareGrid). */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});

  var TARGETS = [
    { t: 'Copy link', bg: 'var(--green)', ic: '⧉', fn: 'copy' },
    { t: 'Messages', bg: '#34c759', ic: '💬', same: true, u: function (u) { return 'sms:?&body=' + u; } },
    // mailto/sms are NOT opened with target=_blank: Brave (and others) open a blank tab when no mail app is registered.
    // `app` marks a link that hands off to an OS app, so a click with no handler can fall back to the web options below.
    { t: 'Email', bg: '#7c8a82', ic: '✉', same: true, app: true, u: function (u, x) { return 'mailto:?subject=' + x + '&body=' + u; } },
    { t: 'Gmail', bg: '#ea4335', ic: 'M', u: function (u, x) { return 'https://mail.google.com/mail/?view=cm&fs=1&su=' + x + '&body=' + u; } },
    { t: 'Outlook', bg: '#0078d4', ic: 'O', u: function (u, x) { return 'https://outlook.live.com/mail/0/deeplink/compose?subject=' + x + '&body=' + u; } },
    { t: 'Facebook', bg: '#1877f2', ic: 'f', u: function (u) { return 'https://www.facebook.com/sharer/sharer.php?u=' + u; } },
    { t: 'Nextdoor', bg: '#00b246', ic: '◍', u: function (u) { return 'https://nextdoor.com/sharekit/?source=share&body=' + u; } },
    { t: 'WhatsApp', bg: '#25d366', ic: '✆', u: function (u) { return 'https://wa.me/?text=' + u; } },
    { t: 'Telegram', bg: '#29a9eb', ic: '➤', u: function (u, x) { return 'https://t.me/share/url?url=' + u + '&text=' + x; } },
    { t: 'Signal', bg: '#3a76f0', ic: '◉', fn: 'copy' },
    { t: 'Reddit', bg: '#ff4500', ic: 'R', u: function (u, x) { return 'https://www.reddit.com/submit?url=' + u + '&title=' + x; } },
    { t: 'X', bg: '#111', ic: '𝕏', u: function (u, x) { return 'https://twitter.com/intent/tweet?url=' + u + '&text=' + x; } },
    { t: 'Bluesky', bg: '#1185fe', ic: '✦', u: function (u, x) { return 'https://bsky.app/intent/compose?text=' + x + '%20' + u; } },
    { t: 'LinkedIn', bg: '#0a66c2', ic: 'in', u: function (u) { return 'https://www.linkedin.com/sharing/share-offsite/?url=' + u; } }
  ];
  var TEXT = 'See what’s changing around a place you follow on HomeSignal';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  HS.SHARE_TARGETS = TARGETS;

  // The grid's HTML for one page URL. `text` is optional: a page with its own message (the
  // Development Activity Report's client link) passes it; every other caller gets the site's.
  HS.shareGridHTML = function (pageUrl, text) {
    var u = encodeURIComponent(pageUrl), x = encodeURIComponent(text || TEXT);
    return TARGETS.map(function (s) {
      var inner = '<span class="si" style="background:' + s.bg + '">' + s.ic + '</span>' + esc(s.t);
      if (s.u) return '<a class="sopt" href="' + esc(s.u(u, x)) + '"' + (s.same ? (s.app ? ' data-hs-app' : '') : ' target="_blank" rel="noopener"') + '>' + inner + '</a>';
      return '<button class="sopt" type="button" data-hs-copy>' + inner + '</button>';
    }).join('');
  };

  // Builds the same grid into an element with DOM calls (no HTML parsed). For a page whose own
  // rules forbid innerHTML: the Development Activity Report's client-link popup.
  HS.fillShareGridEl = function (el, pageUrl, text) {
    if (!el) return;
    var u = encodeURIComponent(pageUrl), x = encodeURIComponent(text || TEXT);
    while (el.firstChild) el.removeChild(el.firstChild);
    TARGETS.forEach(function (s) {
      var b = document.createElement(s.u ? 'a' : 'button');
      b.className = 'sopt';
      if (s.u) {
        b.href = s.u(u, x);
        if (!s.same) { b.target = '_blank'; b.rel = 'noopener'; }
        else if (s.app) b.setAttribute('data-hs-app', '');
      }
      else { b.type = 'button'; b.setAttribute('data-hs-copy', ''); }
      var i = document.createElement('span');
      i.className = 'si'; i.style.background = s.bg; i.textContent = s.ic;
      b.appendChild(i); b.appendChild(document.createTextNode(s.t));
      el.appendChild(b);
    });
  };

  // Email fallback. A click on an OS-app link (mailto:) with no mail app registered does nothing visible. If this page
  // is still focused and visible shortly after the click, no app took over: `onFallback` runs (the page says "copy the
  // link or use Gmail/Outlook"). Nothing is sent anywhere by this.
  HS.watchAppLinks = function (el, onFallback) {
    if (!el || !onFallback) return;
    el.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a[data-hs-app]');
      if (!a) return;
      setTimeout(function () {
        if (document.visibilityState === 'visible' && document.hasFocus()) onFallback(a);
      }, 1500);
    });
  };

  // Fills #shareGrid and #shareUrl for a page URL.
  HS.fillShareBox = function (pageUrl) {
    var grid = document.getElementById('shareGrid');
    var shown = document.getElementById('shareUrl');
    if (grid) grid.innerHTML = HS.shareGridHTML(pageUrl);
    if (shown) shown.textContent = String(pageUrl).replace(/^https?:\/\//, '');
  };

  // Copies the link and shows "Copied ✓" on the box's Copy button.
  HS.copyShareLink = function (pageUrl) {
    try { navigator.clipboard.writeText(pageUrl); } catch (e) { /* no clipboard: the link stays visible to copy */ }
    var b = document.getElementById('copyBtn');
    if (b) { b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = 'Copy'; }, 1800); }
  };
})();
