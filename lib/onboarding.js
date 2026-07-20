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

  function zipLooksValid(zip) {
    return /^\d{5}$/.test(String(zip || '').trim());
  }

  function isRealSavedProperty(p) {
    return !!(p && !p.sample && !p.demo);
  }

  // Server-backed location: a real saved property OR a community follow from app_follows.
  // Never localStorage, URL ?zip=, or demo/sample data.
  function hasServerLocation(ctx) {
    ctx = ctx || {};
    if (isRealSavedProperty(ctx.activeProperty)) return true;
    var zips = ctx.serverFollowZips || [];
    for (var i = 0; i < zips.length; i++) {
      if (zipLooksValid(zips[i])) return true;
    }
    return false;
  }

  function needsOnboarding(session, ctx) {
    if (!session || session.demo) return false;
    if (!ctx || !ctx.hydrated) return false;
    return !hasServerLocation(ctx);
  }

  function addressLooksValid(addr) {
    var q = String(addr || '').trim();
    return q.length >= 8 && q.indexOf(' ') >= 0;
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

  function validCoords(lat, lng) {
    return typeof lat === 'number' && typeof lng === 'number'
      && !isNaN(lat) && !isNaN(lng)
      && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  function destinationHref(destKey, zip, navHref) {
    var d = DESTINATIONS[destKey];
    if (!d || !zipLooksValid(zip)) return null;
    return navHref ? navHref(d.page, String(zip).trim()) : (d.page + '?zip=' + encodeURIComponent(String(zip).trim()));
  }

  function isDuplicateDbError(err) {
    if (!err) return false;
    var code = err.code || (err.error && err.error.code);
    return code === '23505';
  }

  var api = {
    DESTINATIONS: DESTINATIONS,
    needsOnboarding: needsOnboarding,
    hasServerLocation: hasServerLocation,
    isRealSavedProperty: isRealSavedProperty,
    addressLooksValid: addressLooksValid,
    zipLooksValid: zipLooksValid,
    inputMode: inputMode,
    canContinue: canContinue,
    validCoords: validCoords,
    destinationHref: destinationHref,
    isDuplicateDbError: isDuplicateDbError
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.HSOnboarding = api;
})();
