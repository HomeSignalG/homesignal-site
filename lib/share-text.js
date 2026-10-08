// Share-by-text hand-off — the pure half of share-text.html.
//
// WHY THIS PAGE EXISTS (2026-09-23). The digest email's "Messages" button used to be a
// bare `sms:?&body=…` link. Desktop webmail REMOVES non-web links: in Proton Mail the
// founder's test email rendered the Messages icon with NO link at all (right-click
// offered no "Copy Link"), so clicking it did nothing. Every other share button is an
// https:// link and survives. So the email now links HERE, over https, and this page
// makes the `sms:` hand-off from a real browser, where it is allowed.
//
// ⛔ NOT AN OPEN RELAY. The page never takes free message text from the URL. It builds
// the message itself from two inputs, both constrained:
//   u  the page being shared — must be https on homesignal.net, or the page refuses;
//   c  the community label  — plain characters only, capped, and optional.
// So nobody can use a homesignal.net link to pre-fill arbitrary text in a resident's
// Messages app. The message shape matches the email's own share text
// (homesignal-ingest digest_template.py::_share): "HomeSignal daily briefing — <c>".
(function (root) {
  'use strict';

  var ALLOWED_HOSTS = ['homesignal.net', 'www.homesignal.net'];
  var MAX_LABEL = 80;
  // Letters (any script), digits, spaces and the punctuation real community labels
  // use: "Salt Lake City / Millcreek (84106)", "St. Mary's County, MD".
  var LABEL_OK = /^[\p{L}\p{N} .,'()\/&-]+$/u;

  function safeUrl(raw) {
    if (!raw) return null;
    var u;
    try { u = new URL(String(raw)); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;
    if (ALLOWED_HOSTS.indexOf(u.hostname) === -1) return null;
    if (u.username || u.password || u.port) return null;
    return u.toString();
  }

  function safeLabel(raw) {
    var s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!s || s.length > MAX_LABEL || !LABEL_OK.test(s)) return '';
    return s;
  }

  // search: a location.search string ("?u=…&c=…"). Returns
  //   { ok:false } when the page URL is missing or not ours — the page then shows an
  //   error and offers NO Messages link; or
  //   { ok:true, pageUrl, text, message, smsHref }.
  function model(search) {
    var p = new URLSearchParams(search || '');
    var pageUrl = safeUrl(p.get('u'));
    if (!pageUrl) return { ok: false };
    var label = safeLabel(p.get('c'));
    var text = label ? 'HomeSignal daily briefing — ' + label : 'HomeSignal daily briefing';
    var message = text + ' ' + pageUrl;
    // `sms:?&body=` is the form both iOS and Android accept (same as share.js).
    var smsHref = 'sms:?&body=' + encodeURIComponent(message);
    return { ok: true, pageUrl: pageUrl, text: text, message: message, smsHref: smsHref };
  }

  function isPhone(ua) {
    return /iPhone|iPad|iPod|Android/i.test(String(ua || ''));
  }

  var api = { model: model, isPhone: isPhone, safeUrl: safeUrl, safeLabel: safeLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HSShareText = api;
})(typeof window !== 'undefined' ? window : this);
