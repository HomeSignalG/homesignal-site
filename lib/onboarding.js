// HomeSignal first-time onboarding — pure helpers (no DOM). Consumed by shell.js and
// unit-tested directly (test/onboarding.test.mjs).
(function () {
  var DESTINATIONS = {
    development: {
      key: 'development',
      icon: '🗺',
      title: 'Development Map',
      desc: 'See what is being built near you.',
      page: 'homesignalmap.html'
    },
    qol: {
      key: 'qol',
      icon: '🌎',
      title: 'Quality of Life Map',
      desc: 'See impacts to air, water, noise, light, soil, and other environmental factors.',
      page: 'maps.html'
    },
    updates: {
      key: 'updates',
      icon: '🔔',
      title: 'Updates',
      desc: 'Government notices, meetings, and local news.',
      page: 'alerts.html'
    }
  };

  // Signed-in resident with no saved home AND no saved ZIP needs onboarding.
  function needsOnboarding(session, myZip, activeProperty) {
    if (!session || session.demo) return false;
    if (activeProperty) return false;
    if (myZip && /^\d{5}$/.test(String(myZip))) return false;
    return true;
  }

  function addressLooksValid(addr) {
    var q = String(addr || '').trim();
    return q.length >= 8 && q.indexOf(' ') >= 0;
  }

  function zipLooksValid(zip) {
    return /^\d{5}$/.test(String(zip || '').trim());
  }

  // Address is preferred when both are present.
  function inputMode(address, zip) {
    if (addressLooksValid(address)) return 'address';
    if (zipLooksValid(zip)) return 'zip';
    return null;
  }

  function canContinue(address, zip) {
    return !!inputMode(address, zip);
  }

  function destinationHref(destKey, zip, navHref) {
    var d = DESTINATIONS[destKey];
    if (!d || !zipLooksValid(zip)) return null;
    return navHref ? navHref(d.page, String(zip).trim()) : (d.page + '?zip=' + encodeURIComponent(String(zip).trim()));
  }

  var api = {
    DESTINATIONS: DESTINATIONS,
    needsOnboarding: needsOnboarding,
    addressLooksValid: addressLooksValid,
    zipLooksValid: zipLooksValid,
    inputMode: inputMode,
    canContinue: canContinue,
    destinationHref: destinationHref
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.HSOnboarding = api;
})();
