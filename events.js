/* HomeSignal — anonymous, best-effort interaction logging for acquisition data.
   INVISIBLE to the user: no UI, no personal info. Writes one row per event to the
   Supabase `events` table (INSERT-only for the browser; see docs/events-setup.sql).

   Never throws and never blocks the UI. When an event can't be written it is still
   dropped (no retry/queue here — deliberate), but the drop is now COUNTED per-path in
   a durable localStorage tally so the undercount is measurable instead of guessed.
   Read it in any browser console:  hsEventDrops()
     -> { client_not_ready, insert_error, exception, total, since }
   NOTE: this tally is PER-BROWSER (localStorage). Cross-visitor aggregation needs a
   server sink (a count beacon or a `dropped_before` column) — intentionally deferred.
   Reuses the page's window.hsClient. */
(function () {
  'use strict';

  // ---- drop accounting -----------------------------------------------------
  // Each silent-drop path below bumps one bucket so we can size the loss rather
  // than confirm-it-exists. Durable across reloads; every access is wrapped so the
  // accounting can never itself throw or block a log call.
  var DROP_KEY = 'hs_evt_drops';
  var drops = { client_not_ready: 0, insert_error: 0, exception: 0, total: 0, since: null };
  try {
    var saved = JSON.parse(localStorage.getItem(DROP_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      ['client_not_ready', 'insert_error', 'exception', 'total'].forEach(function (k) {
        if (typeof saved[k] === 'number') drops[k] = saved[k];
      });
      drops.since = saved.since || null;
    }
  } catch (e) {}
  function bumpDrop(path) {
    try {
      if (!drops.since) drops.since = new Date().toISOString();
      drops[path] = (drops[path] || 0) + 1;
      drops.total += 1;
      try { localStorage.setItem(DROP_KEY, JSON.stringify(drops)); } catch (e) {}
    } catch (e) { /* accounting must never break logging */ }
  }
  // Queryable surface — returns a snapshot copy so a caller can't mutate the tally.
  window.hsEventDrops = function () { var o = {}; for (var k in drops) o[k] = drops[k]; return o; };

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
      if (!c || typeof c.from !== 'function') { bumpDrop('client_not_ready'); return; } // client not ready -> counted drop
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
      // insert() RESOLVES with {error} on RLS/constraint/4xx and only REJECTS on a
      // network failure — count both, so neither kind of failure is silent.
      if (q && typeof q.then === 'function') {
        q.then(function (r) { if (r && r.error) bumpDrop('insert_error'); },
               function () { bumpDrop('insert_error'); });
      }
    } catch (e) { bumpDrop('exception'); } // sync throw building/sending the row -> counted drop
  };
})();
