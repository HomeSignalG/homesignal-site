// HomeSignal — Premium waitlist capture contract (classic script, no build step).
//
// THE INVARIANT THIS FILE EXISTS TO HOLD:
//   HomeSignal only says "You're on the list" when HomeSignal has actually captured
//   the lead. Nothing here may report success from an absence of evidence.
//
// Why it is its own module rather than three lines inside shell.js: the defect it
// replaces was invisible precisely because it lived inside a DOM handler that nothing
// could execute offline. This module is pure — no DOM, no globals — so
// test/premium-waitlist-contract.test.mjs drives the SHIPPED code path directly.
//
// Canonical store: public.app_premium_waitlist. It is written ONLY through the
// hs_premium_waitlist_join RPC; the public roles hold no privilege on the table
// itself (see docs/premium-waitlist-capture.sql for why, with the probe receipts).
(function () {
  'use strict';

  var RPC = 'hs_premium_waitlist_join';
  var MAX_EMAIL = 320;
  var MAX_SOURCE = 200;

  // Deliberately permissive: this is a capture form, not an identity system. It
  // rejects what cannot be an address at all and leaves the rest to the server,
  // which applies the same rule again (the DB is the authority, not this file).
  var EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

  function normalizeEmail(raw) {
    if (raw == null) return null;
    var e = String(raw).trim().toLowerCase();
    if (!e || e.length > MAX_EMAIL || !EMAIL_RE.test(e)) return null;
    return e;
  }

  // A ZIP is passed on ONLY when it really is one. An unparseable value becomes
  // absent rather than guessed, and never blocks the signup.
  function normalizeZip(raw) {
    if (raw == null) return null;
    var z = String(raw).trim();
    return /^\d{5}$/.test(z) ? z : null;
  }

  function normalizeSource(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;
    return s.length > MAX_SOURCE ? s.slice(0, MAX_SOURCE) : s;
  }

  // The ZIP context of a signup, taken ONLY from what the URL itself states:
  // ?zip=NNNNN, or a /community/NNNNN/ document path. Deliberately NOT read from
  // the viewed-ZIP state, which falls back to HS_CONFIG.DEFAULT_ZIP — that default
  // is a sample, so sourcing from it would stamp every ZIP-less signup with 78617.
  // Absent stays absent.
  function zipFromLocation(loc) {
    loc = loc || {};
    var q = loc.search == null ? '' : String(loc.search);
    var m = q.match(/[?&]zip=(\d{5})(?:&|$)/);
    if (m) return m[1];
    var path = loc.pathname == null ? '' : String(loc.pathname);
    m = path.match(/\/community\/(\d{5})\/?$/);
    return m ? m[1] : null;
  }

  // Result vocabulary. `ok` is the ONLY thing a caller may branch success on.
  function fail(reason, detail) {
    return { ok: false, reason: reason, detail: detail == null ? null : String(detail) };
  }

  // Persist one Premium lead.
  //
  //   submit({ client, email, source, zip }) -> Promise<{ ok, reason?, detail?, email? }>
  //
  // THE THREE WAYS A SUPABASE CALL FAILS, all of which used to read as success:
  //   1. it throws                      -> caught below
  //   2. it resolves with { error }      -> PostgREST rejections do NOT throw
  //   3. it resolves with nothing usable -> a stub/!ready client returning undefined
  // Anything that is not an affirmative { error: null, data.ok === true } is a failure.
  function submit(opts) {
    opts = opts || {};
    var email = normalizeEmail(opts.email);
    if (!email) return Promise.resolve(fail('invalid_email'));

    var client = opts.client;
    if (!client || typeof client.rpc !== 'function') {
      return Promise.resolve(fail('client_unavailable'));
    }

    var args = {
      p_email: email,
      p_source: normalizeSource(opts.source),
      p_zip: normalizeZip(opts.zip)
    };

    var call;
    try {
      call = client.rpc(RPC, args);
    } catch (e) {
      return Promise.resolve(fail('network', (e && e.message) || e));
    }
    if (!call || typeof call.then !== 'function') return Promise.resolve(fail('no_result'));

    return Promise.resolve(call).then(function (res) {
      if (!res || typeof res !== 'object') return fail('no_result');
      if (res.error) {
        var code = res.error.code || '';
        // The server applies the same email rule; surface it as a field error so the
        // visitor is told to fix the address rather than shown a generic outage.
        if (code === '22023') return fail('invalid_email');
        return fail('rejected', res.error.message || code || 'unknown');
      }
      var data = res.data;
      // The RPC answers { ok: true, email } for a new lead AND for a repeat — the
      // shapes are identical on purpose, so the response cannot be used to discover
      // whether an address is already on the list.
      if (!data || data.ok !== true) return fail('no_result');
      return { ok: true, email: data.email || email };
    }, function (e) {
      return fail('network', (e && e.message) || e);
    });
  }

  var api = {
    RPC: RPC,
    normalizeEmail: normalizeEmail,
    normalizeZip: normalizeZip,
    normalizeSource: normalizeSource,
    zipFromLocation: zipFromLocation,
    submit: submit
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.HSPremiumWaitlist = api;
})();
