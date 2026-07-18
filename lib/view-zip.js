// HomeSignal viewed-ZIP resolution — pure helpers for shell boot + nav hrefs.
// Consumed by shell.js (browser) and test/navigation-zip.test.mjs (Node).
// NAV-01: preserve ZIP context across full-page shell navigation without
// overwriting the resident's saved myZip (localStorage).
(function () {
  function parseZipParam(search) {
    if (search == null || search === '') return null;
    try {
      var z = new URLSearchParams(String(search)).get('zip');
      return (z && /^\d{5}$/.test(z)) ? z : null;
    } catch (e) { return null; }
  }

  // Boot precedence for the ZIP the shell pages scope to:
  //   1. ?zip= on the current URL (explicit navigation / deep link)
  //   2. saved myZip (resident's chosen area — never overwritten by viewing)
  //   3. session viewZip (browsing context from this tab)
  //   4. DEFAULT_ZIP (Del Valle prototype)
  function resolveViewedZip(opts) {
    opts = opts || {};
    var def = opts.defaultZip || '78617';
    var urlZ = opts.urlZip;
    if (urlZ && /^\d{5}$/.test(String(urlZ))) return String(urlZ);
    var myZ = opts.myZip;
    if (myZ && /^\d{5}$/.test(String(myZ))) return String(myZ);
    var sesZ = opts.sessionViewZip;
    if (sesZ && /^\d{5}$/.test(String(sesZ))) return String(sesZ);
    return def;
  }

  function navHref(page, zip) {
    if (!page) return page;
    if (!zip || !/^\d{5}$/.test(String(zip))) return page;
    return page + '?zip=' + encodeURIComponent(String(zip));
  }

  // Shell nav targets whose content is scoped by ZIP (NAV-01).
  var ZIP_NAV_PAGES = ['today.html', 'dashboard.html', 'alerts.html', 'development.html', 'maps.html', 'community.html'];

  var api = { parseZipParam: parseZipParam, resolveViewedZip: resolveViewedZip, navHref: navHref, ZIP_NAV_PAGES: ZIP_NAV_PAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window.HS = window.HS || {}, api);
})();
