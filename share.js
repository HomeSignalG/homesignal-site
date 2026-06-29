/* HomeSignal — shared "Share this page" button + YouTube-style share popover.
   Loaded by every page so the logic lives in ONE place. Defines window.sharePage
   and injects the styles once. Page CSS variable names differ across pages, so the
   button/menu style themselves with portable literal values. */
(function () {
  'use strict';

  // ---- icons (single-path glyphs, white on a colored circle) ----
  var I = {
    messages: '<path d="M12 3C6.5 3 2 6.58 2 11c0 2.05.98 3.92 2.6 5.34-.13 1.3-.6 2.5-1.36 3.5 1.6-.2 3.06-.78 4.3-1.65 1.32.46 2.78.71 4.46.71 5.5 0 10-3.58 10-8s-4.5-8-10-8zm-4 9a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/>',
    whatsapp: '<path d="M12 2a10 10 0 0 0-8.6 15.06L2 22l5.07-1.33A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.1.81.83-3.02-.2-.31A8.2 8.2 0 1 1 12 20.2zm4.5-6.14c-.25-.12-1.47-.72-1.7-.8-.23-.09-.4-.13-.56.12-.17.25-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.85-.2-.48-.4-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"/>',
    fb: '<path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z"/>',
    x: '<path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.22-6.82-5.96 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12L17.08 19.77z"/>',
    bsky: '<path d="M5.5 4.3c2.4 1.8 5 5.5 6 7.5 1-2 3.6-5.7 6-7.5 1.7-1.3 4.5-2.3 4.5.9 0 .6-.4 5.2-.6 6-.7 2.6-3.3 3.2-5.7 2.8 4.1.7 5.2 3 2.9 5.3-4.3 4.4-6.2-1.1-6.7-2.5-.1-.3-.2-.5-.2-.3 0-.2-.1.1-.2 2.5-.5 1.4-2.4 6.9-6.7 2.5-2.3-2.3-1.2-4.6 2.9-5.3-2.4.4-5-.2-5.7-2.8C1.4 10.4 1 5.8 1 5.2c0-3.2 2.8-2.2 4.5-.9z"/>',
    email: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7l8-5.2V6H4v.8L12 12zm0 1.5L4 8.3V18h16V8.3l-8 5.2z"/>',
    reddit: '<path d="M22 12a2.04 2.04 0 0 0-3.46-1.46 10 10 0 0 0-5.27-1.67l.9-4.23 2.94.62a1.5 1.5 0 1 0 .16-1l-3.28-.7a.5.5 0 0 0-.59.38l-1 4.7a10 10 0 0 0-5.34 1.66 2.04 2.04 0 1 0-2.2 3.36c-.03.21-.05.43-.05.65 0 3.31 3.58 6 8 6s8-2.69 8-6c0-.22-.02-.44-.05-.65A2.04 2.04 0 0 0 22 12zM7 13.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm8.1 4.2c-.86.86-2.6.93-3.1.93-.5 0-2.24-.07-3.1-.93a.34.34 0 0 1 .48-.48c.54.54 1.7.73 2.62.73.92 0 2.08-.19 2.62-.73a.34.34 0 0 1 .48.48zM15.5 15a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>',
    pinterest: '<path d="M12 2a10 10 0 0 0-3.65 19.31c-.05-.82-.01-1.8.2-2.69l1.28-5.41s-.32-.64-.32-1.58c0-1.48.86-2.59 1.93-2.59.91 0 1.35.68 1.35 1.5 0 .91-.58 2.28-.88 3.55-.25 1.06.53 1.92 1.58 1.92 1.9 0 3.35-2 3.35-4.89 0-2.56-1.84-4.35-4.46-4.35-3.04 0-4.83 2.28-4.83 4.64 0 .92.35 1.9.79 2.44.09.1.1.19.07.3l-.3 1.21c-.05.2-.16.24-.36.15-1.35-.63-2.19-2.6-2.19-4.19 0-3.41 2.48-6.54 7.14-6.54 3.75 0 6.66 2.67 6.66 6.24 0 3.72-2.35 6.72-5.61 6.72-1.1 0-2.13-.57-2.48-1.24l-.67 2.57c-.24.94-.9 2.11-1.34 2.83A10 10 0 1 0 12 2z"/>',
    li: '<path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14zM8.34 18.34V9.9H5.67v8.44h2.67zM7 8.67a1.55 1.55 0 1 0 0-3.1 1.55 1.55 0 0 0 0 3.1zm11.34 9.67v-4.63c0-2.47-1.32-3.62-3.08-3.62-1.42 0-2.06.78-2.41 1.33V9.9h-2.67v8.44h2.67v-4.71c0-.25.02-.5.09-.68.2-.5.65-1.01 1.41-1.01 1 0 1.4.76 1.4 1.87v4.53h2.6z"/>'
  };

  // ---- styles ----
  if (!document.getElementById('nav-share-style')) {
    var css = [
      '.nav-share{display:inline-flex;align-items:center;gap:6px;background:transparent;',
      'border:1px solid rgba(0,0,0,.2);color:#3f3f46;padding:7px 13px;border-radius:8px;',
      'font-family:inherit;font-size:13px;font-weight:500;line-height:1;cursor:pointer;',
      'white-space:nowrap;-webkit-appearance:none;appearance:none;margin-left:auto;',
      'transition:border-color .15s ease,color .15s ease}',
      '.nav-share svg{width:15px;height:15px;flex-shrink:0}',
      '.nav-share>svg{stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
      '.nav-share:hover{border-color:rgba(0,0,0,.36);color:#18181b}',
      '.nav-share:focus-visible{outline:2px solid #1f5130;outline-offset:2px}',
      '.nav-share-pop{position:fixed;z-index:9999;background:#fff;border:1px solid rgba(0,0,0,.1);',
      'border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.2);padding:18px;width:340px;',
      'display:none;color:#18181b}',
      '.nav-share-pop.open{display:block}',
      '.nav-share-pop .nsh{margin:0 0 14px;font-size:15px;font-weight:600;text-align:center}',
      '.nav-share-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 4px}',
      '.nav-share-item{display:flex;flex-direction:column;align-items:center;gap:7px;padding:6px 2px;',
      'border:none;background:transparent;border-radius:10px;cursor:pointer;font:inherit;font-size:11px;',
      'color:#3f3f46;text-decoration:none;transition:background .12s ease}',
      '.nav-share-item:hover{background:#f4f4f5}',
      '.nav-share-item .ico{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;',
      'justify-content:center}',
      '.nav-share-item .ico svg{width:22px;height:22px;fill:#fff;stroke:none}',
      '.ns-messages .ico{background:#2cc84b}.ns-whatsapp .ico{background:#25d366}.ns-fb .ico{background:#1877f2}',
      '.ns-x .ico{background:#000}.ns-bsky .ico{background:#1185fe}.ns-email .ico{background:#5b7083}',
      '.ns-reddit .ico{background:#ff4500}.ns-pinterest .ico{background:#e60023}.ns-li .ico{background:#0a66c2}',
      '.nav-share-copy{display:flex;margin-top:16px;border:1px solid rgba(0,0,0,.14);border-radius:9px;overflow:hidden}',
      '.nav-share-copy input{flex:1;border:none;padding:10px 12px;font:inherit;font-size:12px;',
      'color:#3f3f46;background:#fafafa;min-width:0}',
      '.nav-share-copy input:focus{outline:none}',
      '.nav-share-copy button{border:none;background:#1f5130;color:#fff;padding:0 18px;font:inherit;',
      'font-size:12px;font-weight:600;cursor:pointer}',
      '.nav-share-back{position:fixed;inset:0;z-index:9998;background:transparent;display:none}',
      '.nav-share-back.open{display:block}',
      '@media(max-width:720px){.nav-share-pop{left:12px;right:12px;bottom:12px;top:auto!important;width:auto}',
      '.nav-share-back.open{background:rgba(0,0,0,.35)}}',
      '@media(min-width:721px){header .wrap,.be-nav-inner,body>nav{column-gap:28px}}',
      '@media(max-width:720px){.nav-share{width:100%;justify-content:center;padding:12px;margin-left:0}}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'nav-share-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  var pop, backdrop, copyInput;

  function toast(msg) {
    if (typeof window.showToast === 'function') { window.showToast(msg); return; }
    try { window.alert(msg); } catch (e) { /* no-op */ }
  }

  function copyText(text, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(msg); },
        function () { window.prompt('Copy:', text); });
    } else {
      window.prompt('Copy:', text);
    }
  }

  function targets(url, title) {
    var u = encodeURIComponent(url), t = encodeURIComponent(title);
    return [
      { key: 'messages', label: 'Messages', icon: I.messages, href: 'sms:?&body=' + t + '%20' + u, nav: true },
      { key: 'whatsapp', label: 'WhatsApp', icon: I.whatsapp, href: 'https://wa.me/?text=' + t + '%20' + u },
      { key: 'fb', label: 'Facebook', icon: I.fb, href: 'https://www.facebook.com/sharer/sharer.php?u=' + u },
      { key: 'x', label: 'X', icon: I.x, href: 'https://twitter.com/intent/tweet?text=' + t + '&url=' + u },
      { key: 'bsky', label: 'Bluesky', icon: I.bsky, href: 'https://bsky.app/intent/compose?text=' + t + '%20' + u },
      { key: 'email', label: 'Email', icon: I.email, href: 'mailto:?subject=' + t + '&body=' + t + '%20' + u, nav: true },
      { key: 'reddit', label: 'Reddit', icon: I.reddit, href: 'https://www.reddit.com/submit?url=' + u + '&title=' + t },
      { key: 'pinterest', label: 'Pinterest', icon: I.pinterest, href: 'https://pinterest.com/pin/create/button/?url=' + u + '&description=' + t },
      { key: 'li', label: 'LinkedIn', icon: I.li, href: 'https://www.linkedin.com/sharing/share-offsite/?url=' + u }
    ];
  }

  function closePop() {
    if (pop) pop.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  function buildPop() {
    backdrop = document.createElement('div');
    backdrop.className = 'nav-share-back';
    backdrop.addEventListener('click', closePop);

    pop = document.createElement('div');
    pop.className = 'nav-share-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Share this page');

    var head = document.createElement('div');
    head.className = 'nsh';
    head.textContent = 'Share this page';
    pop.appendChild(head);

    pop.grid = document.createElement('div');
    pop.grid.className = 'nav-share-grid';
    pop.appendChild(pop.grid);

    var copyWrap = document.createElement('div');
    copyWrap.className = 'nav-share-copy';
    copyInput = document.createElement('input');
    copyInput.readOnly = true;
    copyInput.setAttribute('aria-label', 'Page link');
    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', function () { copyText(copyInput.value, 'Link copied to clipboard'); });
    copyWrap.appendChild(copyInput);
    copyWrap.appendChild(copyBtn);
    pop.appendChild(copyWrap);

    document.body.appendChild(backdrop);
    document.body.appendChild(pop);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });
  }

  function openPop(btn) {
    if (!pop) buildPop();
    var url = window.location.href;
    var title = document.title || 'HomeSignal';
    copyInput.value = url;

    pop.grid.innerHTML = '';
    targets(url, title).forEach(function (tg) {
      var el;
      if (tg.copy != null) {
        el = document.createElement('button');
        el.type = 'button';
        el.addEventListener('click', function () { copyText(tg.copy, tg.msg); closePop(); });
      } else if (tg.nav) {
        el = document.createElement('a');
        el.href = tg.href;
        el.addEventListener('click', closePop);
      } else {
        el = document.createElement('a');
        el.href = tg.href; el.target = '_blank'; el.rel = 'noopener noreferrer';
        el.addEventListener('click', function (e) {
          e.preventDefault();
          window.open(tg.href, '_blank', 'noopener,noreferrer,width=600,height=640');
          closePop();
        });
      }
      el.className = 'nav-share-item ns-' + tg.key;
      el.innerHTML = '<span class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + tg.icon +
        '</svg></span><span>' + tg.label + '</span>';
      pop.grid.appendChild(el);
    });

    pop.classList.add('open');
    backdrop.classList.add('open');
    if (window.innerWidth > 720 && btn && btn.getBoundingClientRect) {
      var r = btn.getBoundingClientRect();
      pop.style.top = Math.round(r.bottom + 8) + 'px';
      pop.style.right = Math.round(window.innerWidth - r.right) + 'px';
      pop.style.left = 'auto';
    } else {
      pop.style.top = 'auto'; pop.style.left = ''; pop.style.right = '';
    }
  }

  // Public entry point — called from each button's onclick="sharePage()".
  window.sharePage = function sharePage(ev) {
    var btn = (ev && ev.currentTarget) ||
      (window.event && window.event.currentTarget) ||
      document.querySelector('.nav-share');
    if (pop && pop.classList.contains('open')) { closePop(); return; }
    openPop(btn);
  };
})();
