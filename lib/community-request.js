// HomeSignal — ZIP coverage-request capture contract (classic script, no build step).
//
// THE INVARIANT THIS FILE EXISTS TO HOLD:
//   HomeSignal only says "Request received" when HomeSignal has actually stored
//   the (email, ZIP) so the founder can email that person when the ZIP goes live.
//   Nothing here may report success from an absence of evidence.
//
// Why it is its own module rather than three lines inside shell.js: the defect it
// replaces was invisible precisely because it lived inside a DOM handler that nothing
// could execute offline. This module is pure — no DOM, no globals — so
// test/community-request-contract.test.mjs drives the SHIPPED code path directly.
//
// Canonical store: public.community_requests. It is written from the site ONLY
// through the hs_community_request_join RPC; the public roles hold no privilege
// on the table itself (see docs/community-requests-capture.sql).
(function () {
  'use strict';

  var RPC = 'hs_community_request_join';
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

  // A coverage request without a real ZIP is not a coverage request. Unparseable
  // values become absent rather than guessed — the caller then fails closed.
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

  function fail(reason, detail) {
    return { ok: false, reason: reason, detail: detail == null ? null : String(detail) };
  }

  // Persist one uncovered-ZIP request.
  //
  //   submit({ client, email, zip, source }) -> Promise<{ ok, reason?, detail?, email?, zip? }>
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

    var zip = normalizeZip(opts.zip);
    if (!zip) return Promise.resolve(fail('invalid_zip'));

    var client = opts.client;
    if (!client || typeof client.rpc !== 'function') {
      return Promise.resolve(fail('client_unavailable'));
    }

    var args = {
      p_email: email,
      p_zip: zip,
      p_source: normalizeSource(opts.source)
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
        var msg = (res.error.message || '').toLowerCase();
        if (code === '22023' && msg.indexOf('email') !== -1) return fail('invalid_email');
        if (code === '22023' && msg.indexOf('zip') !== -1) return fail('invalid_zip');
        if (code === '22023') return fail('invalid_email');
        return fail('rejected', res.error.message || code || 'unknown');
      }
      var data = res.data;
      if (!data || data.ok !== true) return fail('no_result');
      return { ok: true, email: data.email || email, zip: data.zip || zip };
    }, function (e) {
      return fail('network', (e && e.message) || e);
    });
  }

  var api = {
    RPC: RPC,
    normalizeEmail: normalizeEmail,
    normalizeZip: normalizeZip,
    normalizeSource: normalizeSource,
    submit: submit
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.HSCommunityRequest = api;
})();
