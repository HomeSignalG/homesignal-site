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
    { t: 'Messages', bg: '#34c759', ic: '💬', u: function (u) { return 'sms:?&body=' + u; } },
    { t: 'Email', bg: '#7c8a82', ic: '✉', u: function (u, x) { return 'mailto:?subject=' + x + '&body=' + u; } },
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

  // The grid's HTML for one page URL.
  HS.shareGridHTML = function (pageUrl) {
    var u = encodeURIComponent(pageUrl), x = encodeURIComponent(TEXT);
    return TARGETS.map(function (s) {
      var inner = '<span class="si" style="background:' + s.bg + '">' + s.ic + '</span>' + esc(s.t);
      if (s.u) return '<a class="sopt" href="' + esc(s.u(u, x)) + '" target="_blank" rel="noopener">' + inner + '</a>';
      return '<button class="sopt" type="button" data-hs-copy>' + inner + '</button>';
    }).join('');
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
