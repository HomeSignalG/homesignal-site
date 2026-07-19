import { readFileSync, writeFileSync } from 'node:fs';
import {
  FEEDS_CSV_COLUMNS,
  FEEDS_CSV_KNOWN_COLUMNS,
  FEEDS_CSV_REQUIRED_COLUMNS,
  canonicalCsvColumn,
  isKnownFeedsCsvColumn,
} from './production-contract.mjs';
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

/** @param {import('./schema.mjs').FeedRecord[]} records @param {string[]} [columns] */
export function recordsToCsv(records, columns = CSV_COLUMNS) {
  const lines = [columns.join(',')];
  for (const r of records) {
    const row = columns.map((col) => escapeCsvCell(r[col]));
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Read feeds.csv with quarantine-by-row validation.
 * Unknown header columns produce warnings and are ignored (sync continues).
 *
 * @param {string} path
 * @returns {{
 *   rows: import('./schema.mjs').FeedRecord[],
 *   quarantined: Array<{ row: number, feed_id: string, errors: string[] }>,
 *   warnings: string[],
 *   header: string[],
 *   rawHeader: string[],
 * }}
 */
export function readFeedsCsv(path) {
  const text = readFileSync(path, 'utf8');
  const table = parseCsv(text.trimEnd() + '\n');
  if (!table.length) return { rows: [], quarantined: [], warnings: [], header: [], rawHeader: [] };

  const rawHeader = table[0].map((h) => String(h ?? '').trim());
  const header = rawHeader.map((h) => canonicalCsvColumn(h));
  const warnings = [];

  const missing = FEEDS_CSV_REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new Error(`feeds.csv missing required columns: ${missing.join(', ')}`);
  }

  const known = new Set(FEEDS_CSV_KNOWN_COLUMNS);
  for (let i = 0; i < rawHeader.length; i++) {
    const raw = rawHeader[i];
    if (!raw) continue;
    const canonical = header[i];
    if (!isKnownFeedsCsvColumn(canonical)) {
      warnings.push(`unknown CSV column ignored: ${JSON.stringify(raw)}`);
    }
  }

  const records = [];
  /** @type {Array<{ row: number, feed_id: string, errors: string[] }>} */
  const quarantined = [];

  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (!cells.length || cells.every((c) => !String(c).trim())) continue;

    /** @type {Record<string, string>} */
    const obj = {};
    const presentColumns = [];
    for (let c = 0; c < header.length; c++) {
      const col = header[c];
      if (!col || !known.has(col)) continue;
      const val = cells[c] ?? '';
      if (String(val).trim() !== '') presentColumns.push(col);
      obj[col] = val;
    }

    const feed_id = String(obj.feed_id || '').trim() || `(row ${r + 1})`;

    try {
      const normalized = normalizeFeedRecord(obj, { presentColumns });
      const errors = validateFeedRecord(normalized, { columnsPresent: presentColumns });
      if (errors.length) {
        quarantined.push({ row: r + 1, feed_id, errors });
        continue;
      }
      records.push(normalized);
    } catch (err) {
      quarantined.push({ row: r + 1, feed_id, errors: [err instanceof Error ? err.message : String(err)] });
    }
  }

  return { rows: records, quarantined, warnings, header, rawHeader };
}

/** @param {string} path @param {import('./schema.mjs').FeedRecord[]} records */
export function writeFeedsCsv(path, records) {
  writeFileSync(path, recordsToCsv(records), 'utf8');
}

/** @param {Array<{ row: number, feed_id: string, errors: string[] }>} quarantined */
export function formatQuarantineReport(quarantined) {
  if (!quarantined.length) return 'Quarantined rows: 0';
  const lines = [`Quarantined rows: ${quarantined.length}`, ''];
  for (const q of quarantined) {
    lines.push(`  row ${q.row} (${q.feed_id}): ${q.errors.join('; ')}`);
  }
  return lines.join('\n');
}

/** @param {string[]} warnings */
export function formatCsvWarnings(warnings) {
  if (!warnings.length) return 'CSV warnings: 0';
  return ['CSV warnings:', ...warnings.map((w) => `  ${w}`)].join('\n');
}
