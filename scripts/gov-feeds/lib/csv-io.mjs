import { readFileSync, writeFileSync } from 'node:fs';
import { CSV_COLUMNS, normalizeFeedRecord, validateFeedRecord } from './schema.mjs';

/** Minimal RFC-4180 CSV parser (no external deps). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function escapeCsvCell(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** @param {import('./schema.mjs').FeedRecord[]} records */
export function recordsToCsv(records) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of records) {
    const row = CSV_COLUMNS.map((col) => escapeCsvCell(r[col]));
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

/** @param {string} path */
export function readFeedsCsv(path) {
  const text = readFileSync(path, 'utf8');
  const table = parseCsv(text.trimEnd() + '\n');
  if (!table.length) return [];
  const header = table[0].map((h) => h.trim());
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`feeds.csv missing columns: ${missing.join(', ')}`);

  const records = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (!cells.length || cells.every((c) => !String(c).trim())) continue;
    /** @type {Record<string, string>} */
    const obj = {};
    for (const col of CSV_COLUMNS) {
      obj[col] = cells[header.indexOf(col)] ?? '';
    }
    const normalized = normalizeFeedRecord(obj);
    const errors = validateFeedRecord(normalized);
    if (errors.length) throw new Error(`row ${r + 1} (${normalized.feed_id}): ${errors.join('; ')}`);
    records.push(normalized);
  }
  return records;
}

/** @param {string} path @param {import('./schema.mjs').FeedRecord[]} records */
export function writeFeedsCsv(path, records) {
  writeFileSync(path, recordsToCsv(records), 'utf8');
}
