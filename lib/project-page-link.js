// Map 1 -> project page (/project/<registry_id>/<case>-<h8>/).
//
// The site build writes /community/<zip>/projects/pages.json for every ZIP that has project pages
// (scripts/gen_zip_pages.py project_page_index): { v:1, zip, pages: { <source_key>: <path> } }.
// This module reads that file and nothing else, so Map 1 links a record to its page only when the
// build published one; it never constructs or guesses a URL. A record's source_key is the id its
// pin already carries (zip_project_ref in ZIP mode, n5_source_key in address mode).
//
// No index, a failed read, or a key not in it: no link (the record keeps its official-record link).
(function (root) {
  var HS = root.HS = root.HS || {};
  var PATH_RE = /^\/project\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?[0-9a-f]{8}\/$/;
  var byZip = Object.create(null);     // zip -> { status: 'loading'|'ready'|'none', pages, promise }
  var listeners = [];

  function keyOf(s) {
    if (!s) return null;
    var k = s.zip_project_ref || s.n5_source_key || null;
    return k ? String(k) : null;
  }

  function pathFor(s) {
    var k = keyOf(s);
    if (!k) return null;
    for (var z in byZip) {
      var e = byZip[z];
      if (e.status === 'ready' && Object.prototype.hasOwnProperty.call(e.pages, k)) return e.pages[k];
    }
    return null;
  }

  // Validates the file: a wrong ZIP, a non-object or any unsafe path refuses the WHOLE file.
  function parse(zip, j) {
    if (!j || j.v !== 1 || j.zip !== zip || !j.pages || typeof j.pages !== 'object') return null;
    var out = Object.create(null);
    for (var k in j.pages) {
      if (!Object.prototype.hasOwnProperty.call(j.pages, k)) continue;
      var p = j.pages[k];
      if (typeof p !== 'string' || !PATH_RE.test(p)) return null;
      out[k] = p;
    }
    return out;
  }

  function load(zip, fetchImpl) {
    zip = String(zip || '');
    if (!/^\d{5}$/.test(zip)) return Promise.resolve(null);
    if (byZip[zip]) return byZip[zip].promise;
    var f = fetchImpl || (root.fetch && root.fetch.bind(root));
    var e = byZip[zip] = { status: 'loading', pages: Object.create(null) };
    e.promise = (f ? f('/community/' + zip + '/projects/pages.json', { credentials: 'omit' }) : Promise.reject(new Error('no fetch')))
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) {
        var pages = parse(zip, j);
        if (pages) { e.pages = pages; e.status = 'ready'; } else { e.status = 'none'; }
        listeners.forEach(function (fn) { try { fn(zip); } catch (_) {} });
        return e.status === 'ready' ? pages : null;
      })
      .catch(function () { e.status = 'none'; return null; });
    return e.promise;
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // " · Project page →" for a record with a published page, else "".
  function linkHTML(s) {
    var p = pathFor(s);
    return p ? " · <a class='pplink' href='" + esc(p) + "'>Project page →</a>" : '';
  }

  // A list row is drawn before the index may have landed: it carries an empty slot that is
  // filled when the index arrives (fill), so a slow read never costs the link.
  function slotHTML(s) {
    var k = keyOf(s);
    if (!k) return '';
    var now = linkHTML(s);
    return now || "<span class='ppslot' data-ppk='" + esc(k) + "'></span>";
  }

  function fill(rootEl) {
    var els = (rootEl || root.document).querySelectorAll('span.ppslot[data-ppk]');
    Array.prototype.forEach.call(els, function (el) {
      var h = linkHTML({ zip_project_ref: el.getAttribute('data-ppk') });
      if (h) { el.outerHTML = h; }
    });
  }

  function onLoad(fn) { listeners.push(fn); }

  function reset() { for (var z in byZip) delete byZip[z]; }

  HS.projectPages = {
    load: load, pathFor: pathFor, linkHTML: linkHTML, slotHTML: slotHTML, fill: fill,
    onLoad: onLoad, keyOf: keyOf, _parse: parse, _reset: reset, PATH_RE: PATH_RE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
