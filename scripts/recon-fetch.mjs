// recon-fetch.mjs — generic read-only recon prober for state-open source recon.
//
// Runs on a GitHub runner (which has egress; the build sandbox does not) as a stand-in
// for the pg_net probe pattern: it fetches a committed list of URLs and uploads the raw
// responses as a workflow artifact, so recon receipts (fresh-date probes, column
// verification, returnDistinctValues vocab checks) can be collected while the database
// is unavailable. READ-ONLY: GET/POST to public open-data endpoints only, no secrets,
// writes nothing to the repo.
//
// Usage: node scripts/recon-fetch.mjs <targets.json>
//   targets.json = [{ "id": "la-permits-fresh", "url": "https://…", "method"?, "body"?,
//                     "headers"? }]
// Output: results/<id>.body (response body, truncated at 2 MB) + results/summary.json
//   and a per-target summary line on stdout.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/recon-fetch.mjs <targets.json>'); process.exit(2); }
const targets = JSON.parse(readFileSync(file, 'utf8'));
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '30000', 10);
const MAX_BODY = 2 * 1024 * 1024;

mkdirSync('results', { recursive: true });
const summary = [];

for (const t of targets) {
  const started = Date.now();
  let status = 0, bytes = 0, note = '';
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const r = await fetch(t.url, {
      method: t.method || 'GET',
      body: t.body ? (typeof t.body === 'string' ? t.body : JSON.stringify(t.body)) : undefined,
      headers: { 'User-Agent': 'homesignal-recon/1.0', ...(t.headers || {}) },
      signal: ctl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    status = r.status;
    let body = await r.text();
    bytes = body.length;
    // csv_stats (additive): aggregate a large CSV on the runner BEFORE truncation, so
    // vocab receipts (distinct value counts, max dates) exist for files far over the
    // 2 MB body cap — e.g. San Diego's 14.9 MB approvals ledger. Read-only, prints only
    // aggregates into the log (the receipt channel), never the raw rows.
    if (t.csv_stats) {
      try {
        const rows = parseCsv(body);
        const header = rows.shift() || [];
        const idx = (name) => header.indexOf(name);
        const lines = [`rows=${rows.length}`];
        for (const col of t.csv_stats.max || []) {
          const i = idx(col);
          let max = '';
          if (i >= 0) for (const r2 of rows) { const v = (r2[i] || '').trim(); if (v > max) max = v; }
          lines.push(`max(${col})=${max || '(col missing or empty)'}`);
        }
        if (t.csv_stats.group_by && t.csv_stats.group_by.length) {
          const gi = t.csv_stats.group_by.map(idx);
          const counts = new Map();
          for (const r2 of rows) {
            const key = gi.map((i) => i >= 0 ? (r2[i] || '').trim() : '??').join(' | ');
            counts.set(key, (counts.get(key) || 0) + 1);
          }
          const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, t.csv_stats.top || 60);
          lines.push(`distinct(${t.csv_stats.group_by.join(' | ')}) — top ${top.length} of ${counts.size}:`);
          for (const [k, c] of top) lines.push(`  ${c}\t${k}`);
        }
        console.log(`----- CSV STATS ${t.id} -----\n${lines.join('\n')}\n----- END CSV STATS ${t.id} -----`);
        writeFileSync(`results/${t.id}.csvstats.txt`, lines.join('\n'));
      } catch (e) { console.log(`csv_stats failed for ${t.id}: ${String(e && e.message || e).slice(0, 200)}`); }
    }
    if (body.length > MAX_BODY) { body = body.slice(0, MAX_BODY); note = 'truncated'; }
    writeFileSync(`results/${t.id}.body`, body);
  } catch (e) {
    note = String(e && e.message || e).slice(0, 200);
  }
  const line = { id: t.id, url: t.url, status, bytes, ms: Date.now() - started, note };
  summary.push(line);
  console.log(`${t.id}\t${status}\t${bytes}b\t${line.ms}ms\t${note}`);
  // Print an excerpt into the job log too — the build sandbox can read logs via the
  // API but cannot reach the artifact blob store, so the log IS the receipt channel.
  try {
    const body = readFileSync(`results/${t.id}.body`, 'utf8');
    let excerpt;
    if (t.extract) {
      // Print only windows around regex matches — keeps huge catalog bodies out of the log.
      const re = new RegExp(t.extract, 'gi');
      const ctx = t.extract_context || 1500;
      const parts = [];
      let m; let n = 0;
      while ((m = re.exec(body)) && n++ < (t.extract_max || 10)) {
        parts.push(body.slice(Math.max(0, m.index - ctx), m.index + m[0].length + ctx));
        if (re.lastIndex === m.index) re.lastIndex++;
      }
      excerpt = parts.join(`\n===== NEXT MATCH =====\n`) || '(no extract matches)';
    } else {
      excerpt = body.slice(0, t.print_chars || parseInt(process.env.PRINT_BODY_CHARS || '5000', 10));
    }
    console.log(`----- BEGIN ${t.id} -----\n${excerpt}\n----- END ${t.id} -----`);
  } catch { /* fetch failed; nothing to print */ }
}

writeFileSync('results/summary.json', JSON.stringify(summary, null, 2));
console.log(`\n${summary.length} targets probed; results/ written`);

// Minimal RFC-4180 CSV parser (quotes, escaped quotes, embedded commas/newlines).
// Used only by the csv_stats aggregate above — read-only recon, no deps.
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
