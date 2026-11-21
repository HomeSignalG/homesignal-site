/* The site's Share box (#shareModal in partials/shell.html): its list of share targets and the
   grid built from it. ONE copy, used by shell.js on every app page and by the static development
   pages (lib/dossier-header.js), so both show the same Share box with the same targets.
   No inline handlers: a "Copy link" target carries data-hs-copy, and the page that shows the box
   handles that click (shell.js and dossier-header.js each listen on #shareGrid). */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});

  var TARGETS = [
    { t: 'Copy link', bg: '#157a49', ic: '', link: true, fn: 'copy' },
    { t: 'Messages', bg: '#34c759', ic: '💬', u: function (u) { return 'sms:?&body=' + u; } },
    { t: 'Email', bg: '#7c8a82', ic: '✉', u: function (u, x) { return 'mailto:?subject=' + x + '&body=' + u; } },
    // Web mail compose, for people with no mail app: the same private link goes only to the provider they click.
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

  // mailto: and sms: hand off to the person's own app. A new tab for them is left blank (Brave/Chrome
  // with no web handler), so only http(s) targets open in a new tab.
  function isWeb(h) { return /^https?:/i.test(h); }

  // The chain-link icon for "Copy link": two interlocking links, white strokes on the green
  // circle (a text glyph here was missing from many fonts and drew nothing).
  var LINK_PATHS = ['M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.7 1.7', 'M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.7-1.7'];
  var LINK_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    LINK_PATHS.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</svg>';
  function linkSvgEl() {
    var NS = 'http://www.w3.org/2000/svg', v = document.createElementNS(NS, 'svg');
    ['width:24', 'height:24', 'viewBox:0 0 24 24', 'fill:none', 'stroke:#fff', 'stroke-width:2.4', 'stroke-linecap:round', 'stroke-linejoin:round', 'aria-hidden:true', 'focusable:false']
      .forEach(function (a) { var k = a.split(':'); v.setAttribute(k[0], k.slice(1).join(':')); });
    LINK_PATHS.forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); v.appendChild(p); });
    return v;
  }

  // The grid's HTML for one page URL. `text` is optional: a page with its own message (the
  // Development Activity Report's client link) passes it; every other caller gets the site's.
  HS.shareGridHTML = function (pageUrl, text) {
    var u = encodeURIComponent(pageUrl), x = encodeURIComponent(text || TEXT);
    return TARGETS.map(function (s) {
      var inner = '<span class="si" style="background:' + s.bg + '">' + (s.link ? LINK_SVG : s.ic) + '</span>' + esc(s.t);
      if (s.u) { var h = s.u(u, x); return '<a class="sopt" href="' + esc(h) + '"' + (isWeb(h) ? ' target="_blank" rel="noopener"' : '') + '>' + inner + '</a>'; }
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
      if (s.u) { b.href = s.u(u, x); if (isWeb(b.href)) { b.target = '_blank'; b.rel = 'noopener'; } }
      else { b.type = 'button'; b.setAttribute('data-hs-copy', ''); }
      var i = document.createElement('span');
      i.className = 'si'; i.style.background = s.bg;
      if (s.link) i.appendChild(linkSvgEl()); else i.textContent = s.ic;
      b.appendChild(i); b.appendChild(document.createTextNode(s.t));
      el.appendChild(b);
    });
  };

  // A mailto: link does nothing visible when the browser has no mail app set for it. When the page keeps
  // the focus after a click, no app took over, so say so and offer the subject and message to copy.
  var MAIL_WAIT_MS = 1200;
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a.sopt[href^="mailto:"]') : null;
    if (!a) return;
    var left = false, mark = function () { left = true; };
    window.addEventListener('blur', mark); document.addEventListener('visibilitychange', mark);
    setTimeout(function () {
      window.removeEventListener('blur', mark); document.removeEventListener('visibilitychange', mark);
      if (left) return;
      var host = a.parentNode, note = host.parentNode.querySelector('.hs-mailto-note');
      var q = a.getAttribute('href').replace(/^mailto:\?/, '').split('&body='), subj, body;
      try { subj = decodeURIComponent(q[0].replace(/^subject=/, '')); body = decodeURIComponent(q[1] || ''); } catch (x) { return; }
      if (!note) {
        note = document.createElement('div'); note.className = 'hs-mailto-note';
        note.setAttribute('role', 'status'); note.style.cssText = 'margin:10px 0 0;font-size:13px;line-height:1.4';
        host.parentNode.insertBefore(note, host.nextSibling);
      }
      while (note.firstChild) note.removeChild(note.firstChild);
      note.appendChild(document.createTextNode('No email app opened. '));
      var b = document.createElement('button'); b.type = 'button'; b.textContent = 'Copy the email text';
      b.style.cssText = 'font:inherit;font-weight:600;background:none;border:0;padding:0;color:inherit;text-decoration:underline;cursor:pointer';
      b.addEventListener('click', function () {
        try { navigator.clipboard.writeText(subj + '\n\n' + body); } catch (x) { /* no clipboard */ }
        b.textContent = 'Copied ✓';
      });
      note.appendChild(b);
    }, MAIL_WAIT_MS);
  });

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
    // The Copy link tile says so too, in the grid itself (the icon is what people click).
    var tile = document.querySelector('#shareGrid .sopt[data-hs-copy]');
    if (tile && tile.lastChild && tile.lastChild.nodeType === 3 && !tile.getAttribute('data-hs-was')) {
      var was = tile.lastChild.nodeValue;
      tile.setAttribute('data-hs-was', was); tile.lastChild.nodeValue = 'Copied ✓';
      setTimeout(function () { tile.lastChild.nodeValue = was; tile.removeAttribute('data-hs-was'); }, 1800);
    }
    var b = document.getElementById('copyBtn');
    if (b) { b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = 'Copy'; }, 1800); }
  };
})();
