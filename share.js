/* HomeSignal — shared "Share this page" button.
   Loaded by every page so the logic lives in ONE place. Defines window.sharePage
   and injects the .nav-share styles once (page CSS variable names differ across
   pages, so the button styles itself with portable literal values). */
(function () {
  'use strict';

  // Inject the button styles once per document.
  if (!document.getElementById('nav-share-style')) {
    var css =
      '.nav-share{display:inline-flex;align-items:center;gap:6px;background:transparent;' +
      'border:1px solid rgba(0,0,0,.2);color:#3f3f46;padding:7px 13px;border-radius:8px;' +
      'font-family:inherit;font-size:13px;font-weight:500;line-height:1;cursor:pointer;' +
      'white-space:nowrap;-webkit-appearance:none;appearance:none;margin-left:auto;' +
      'transition:border-color .15s ease,color .15s ease}' +
      '.nav-share svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;' +
      'stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}' +
      '.nav-share:hover{border-color:rgba(0,0,0,.36);color:#18181b}' +
      '.nav-share:focus-visible{outline:2px solid #1f5130;outline-offset:2px}' +
      // keep nav items evenly spaced once .nav-share's margin-left:auto packs them
      '@media(min-width:721px){header .wrap,.be-nav-inner,body>nav{column-gap:28px}}' +
      '@media(max-width:720px){.nav-share{width:100%;justify-content:center;padding:12px;margin-left:0}}';
    var style = document.createElement('style');
    style.id = 'nav-share-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // Share the current page: native share sheet where available, else copy the link.
  window.sharePage = function sharePage() {
    var url = window.location.href;
    var title = document.title || 'HomeSignal';

    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function () { /* user cancelled */ });
      return;
    }

    function copied() {
      if (typeof window.showToast === 'function') {
        window.showToast('Link copied to clipboard');
      } else {
        try { window.alert('Link copied to clipboard'); } catch (e) { /* no-op */ }
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(copied, function () {
        window.prompt('Copy this link:', url);
      });
    } else {
      window.prompt('Copy this link:', url);
    }
  };
})();
