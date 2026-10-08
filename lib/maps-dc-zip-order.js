// maps-dc-zip-order.js — the founder's ordered ZIP list for MAPS · Data Center Theme.
//
// ONE JOB: turn an uploaded CSV into a validated, ORDERED list of ZIP strings, and turn a
// stored list back into a CSV. It decides nothing about eligibility, drafts, approval,
// scheduling or publishing — those contracts are frozen and live elsewhere.
//
// ROW POSITION IS PRIORITY. There is no priority column and one must never be required:
// the first data row is founder priority #1. If a file happens to carry extra columns they
// are IGNORED and the founder is told so, because silently reading someone's "priority"
// column would let a second ordering compete with the row order that is the actual product.
//
// ⚠️ ZIP IS A STRING, ALWAYS. 07446 must survive as "07446". The single most likely way for
// this feature to corrupt data is a spreadsheet: Excel opens a ZIP column as a NUMBER and
// writes 7446 back out. This module therefore REJECTS a 4-digit value with an explanatory
// error rather than zero-padding it. Padding would be a guess — 7446 could equally be a
// truncated 74460 — and the contract forbids substituting another ZIP. An error the founder
// can act on beats a plausible wrong ZIP that reaches a draft.
(function () {
  var HS = (typeof window !== 'undefined')
    ? (window.HS = window.HS || {})
    : (globalThis.HS = globalThis.HS || {});

  // EXPLICIT, DOCUMENTED CEILING — never a hidden parser or database limit. The generator
  // reads these ZIPs one REST round-trip each, so the list is a work order, not a corpus.
  // 500 is far above any plausible founder batch and is surfaced as a readable error.
  HS.MAPS_DC_ZIP_ORDER_MAX = 500;

  var HEADER = 'zip';

  /** Strip a UTF-8 BOM, which Excel writes and which would make the header !== 'zip'. */
  function stripBom(s) {
    return String(s == null ? '' : s).replace(/^﻿/, '');
  }

  /**
   * Unwrap one CSV cell. Handles the quoting a spreadsheet actually emits:
   *   "07446"      quoted text
   *   ="07446"     Excel's force-text formula form
   *   '07446       Excel's leading-apostrophe text marker
   * It does NOT change the digits — only removes packaging.
   */
  function unwrapCell(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (v.slice(0, 2) === '="' && v.slice(-1) === '"') v = v.slice(2, -1);
    else if (v.charAt(0) === '"' && v.charAt(v.length - 1) === '"' && v.length >= 2) {
      v = v.slice(1, -1).replace(/""/g, '"');
    }
    if (v.charAt(0) === "'") v = v.slice(1);
    return v.trim();
  }

  /** Split one CSV line into cells, honouring double-quoted fields containing commas. */
  function splitLine(line) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (inQ) {
        if (ch === '"' && line.charAt(i + 1) === '"') { cur += '""'; i++; }
        else if (ch === '"') { inQ = false; cur += ch; }
        else cur += ch;
      } else if (ch === '"') { inQ = true; cur += ch; }
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  /**
   * Parse and validate an uploaded ordered-ZIP CSV.
   *
   * Returns { ok, zips, errors, warnings, dataRows }.
   *   zips     — ordered ZIP strings; index 0 is founder priority #1. [] when !ok.
   *   errors   — every problem found, not just the first, so one upload fixes one round.
   *   warnings — non-fatal notes (e.g. ignored extra columns, skipped blank rows).
   *
   * NOTHING IS SILENTLY DROPPED, REORDERED OR SUBSTITUTED. A file with any malformed ZIP
   * is rejected whole rather than partially accepted: a partial accept would shift every
   * later founder priority number, which is exactly the renumbering the contract forbids.
   */
  HS.parseZipOrderCsv = function (text) {
    var errors = [], warnings = [], zips = [];
    // A trailing newline terminates the last record; it is not a blank row and must not be
    // reported as one, or every well-formed file grows a spurious warning.
    var src = stripBom(text).replace(/[\r\n]+$/, '');

    if (!String(src).trim()) {
      return { ok: false, zips: [], errors: ['The file is empty.'], warnings: warnings, dataRows: 0 };
    }

    var lines = String(src).split(/\r\n|\r|\n/);
    // The header is the first line that has any content; leading blank lines are packaging.
    var h = 0;
    while (h < lines.length && !lines[h].trim()) h++;
    if (h >= lines.length) {
      return { ok: false, zips: [], errors: ['The file is empty.'], warnings: warnings, dataRows: 0 };
    }

    var headerCells = splitLine(lines[h]).map(unwrapCell);
    var first = headerCells[0] ? headerCells[0].toLowerCase() : '';
    if (first !== HEADER) {
      errors.push('The first column must be headed "zip". Found "'
        + (headerCells[0] || '(nothing)') + '". Download the template for the exact format.');
      return { ok: false, zips: [], errors: errors, warnings: warnings, dataRows: 0 };
    }
    if (headerCells.length > 1) {
      var extra = headerCells.slice(1).filter(function (c) { return c !== ''; });
      if (extra.length) {
        // Named, not silent — especially if one of them is a "priority" column, which this
        // feature deliberately does not read.
        warnings.push('Ignored extra column(s): ' + extra.join(', ')
          + '. Row order is priority — no priority column is used.');
      }
    }

    var seen = {}, dataRows = 0, blanks = 0;
    for (var i = h + 1; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) { blanks++; continue; }                 // blank rows safely ignored
      var cells = splitLine(line);
      var v = unwrapCell(cells[0]);
      if (v === '') { blanks++; continue; }                      // a row of only commas
      dataRows++;
      var rowNo = i + 1;                                         // 1-based file line, for the founder

      if (!/^[0-9]{5}$/.test(v)) {
        if (/^[0-9]{1,4}$/.test(v)) {
          errors.push('Line ' + rowNo + ': "' + v + '" is not 5 digits. A spreadsheet has '
            + 'probably removed a leading zero — format the column as Text and re-save. '
            + 'HomeSignal will not guess the missing digit.');
        } else {
          errors.push('Line ' + rowNo + ': "' + v + '" is not a valid 5-digit ZIP.');
        }
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(seen, v)) {
        errors.push('Line ' + rowNo + ': ZIP ' + v + ' appears more than once (already at '
          + 'position ' + seen[v] + '). Each ZIP may appear once.');
        continue;
      }
      seen[v] = zips.length + 1;
      zips.push(v);
    }

    if (blanks) warnings.push('Skipped ' + blanks + ' blank row(s).');

    if (!errors.length && !zips.length) {
      errors.push('No ZIP codes found. The file has a "zip" header but no rows under it.');
    }
    if (zips.length > HS.MAPS_DC_ZIP_ORDER_MAX) {
      errors.push('This list has ' + zips.length + ' ZIPs. The maximum is '
        + HS.MAPS_DC_ZIP_ORDER_MAX + '. Split it into smaller uploads.');
    }

    var ok = errors.length === 0;
    return { ok: ok, zips: ok ? zips : [], errors: errors, warnings: warnings, dataRows: dataRows };
  };

  /** The blank template. No fake project data, no city/state, no priority column. */
  HS.zipOrderTemplateCsv = function () {
    return 'zip\n64155\n20166\n55405\n';
  };

  /**
   * Serialize the CURRENT persisted list back to CSV, in founder order.
   * Quoted so a spreadsheet opens the column as text and the leading zero survives the
   * round trip that produced it — download, edit, re-upload has to be lossless.
   */
  HS.zipOrderToCsv = function (zips) {
    var out = 'zip\n';
    for (var i = 0; i < (zips || []).length; i++) out += '"' + zips[i] + '"\n';
    return out;
  };

  /** Ordered ZIPs -> rows for public.maps_dc_zip_order. Position is 1-based. */
  HS.zipOrderRecords = function (zips, uploadedAt) {
    var rows = [];
    for (var i = 0; i < (zips || []).length; i++) {
      rows.push({ founder_position: i + 1, zip: zips[i], uploaded_at: uploadedAt || new Date().toISOString() });
    }
    return rows;
  };
})();
