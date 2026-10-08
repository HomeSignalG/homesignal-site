/* HomeSignal — anonymous interaction logging.
   The one implementation is HS.logEvent in lib/data.js (loaded on every page, and it
   also sets window.hsLogEvent). This file is kept only so an old <script> tag still
   works; it defines nothing of its own.

   History: until 2026-09-28 this file carried its own writer, which needed a
   window.hsClient that only acquisition.html ever created, and no public page
   loaded it. public.events received nothing after 2026-07-12. */
(function () {
  'use strict';
  if (typeof window.hsLogEvent !== 'function') {
    window.hsLogEvent = function (eventType, payload) {
      try { if (window.HS && typeof window.HS.logEvent === 'function') window.HS.logEvent(eventType, payload); } catch (e) {}
    };
  }
})();
