/* HomeSignal — anonymous, best-effort interaction logging for acquisition data.
   INVISIBLE to the user: no UI, no personal info. Writes one row per event to the
   Supabase `events` table (INSERT-only for the browser; see docs/events-setup.sql).

   Never throws and never blocks the UI — if the table/grant isn't set up yet, or the
   network fails, the event is silently dropped. Reuses the page's window.hsClient. */
(function () {
  'use strict';

  function sessionId() {
    try {
      var s = localStorage.getItem('hs_sid');
      if (!s) {
        s = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem('hs_sid', s);
      }
      return s;
    } catch (e) { return 'anon'; }
  }

  // The 5-digit ZIP the page is scoped to, so behavior can be rolled up per ZIP.
  // Pages are built by ZIP; resolve it once and remember it for the session so
  // later events on ZIP-less URLs (e.g. detail modals) still attribute correctly.
  // Order: explicit override -> ?zip= param -> remembered ZIP for this session.
  function currentZip(payload) {
    try {
      var z = (payload && payload.zip_code) || window.HS_ZIP;
      if (!z) {
        var m = location.search.match(/[?&]zip=(\d{5})/);
        if (m) z = m[1];
      }
      if (!z) { try { z = localStorage.getItem('hs_zip'); } catch (e) {} }
      if (z && /^\d{5}$/.test(String(z))) {
        try { localStorage.setItem('hs_zip', String(z)); } catch (e) {}
        return String(z);
      }
    } catch (e) {}
    return null;
  }

  // hsLogEvent(eventType, { topic, pipeline_type, community_id, alert_id, zip_code })
  window.hsLogEvent = function (eventType, payload) {
    try {
      var c = window.hsClient;
      if (!c || typeof c.from !== 'function') return; // client not ready -> drop silently
      var row = {
        session_id: sessionId(),
        event_type: String(eventType || '').slice(0, 64),
        page_url: location.href,
        topic: (payload && payload.topic) || null,
        pipeline_type: (payload && payload.pipeline_type) || null,
        community_id: (payload && payload.community_id) || (window.COMMUNITY_ID || null),
        alert_id: (payload && payload.alert_id) || null,
        zip_code: currentZip(payload)
      };
      var q = c.from('events').insert([row]);
      if (q && typeof q.then === 'function') q.then(function () {}, function () {});
    } catch (e) { /* never surface analytics errors */ }
  };
})();
