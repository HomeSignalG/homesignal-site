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
    if (body.length > MAX_BODY) { body = body.slice(0, MAX_BODY); note = 'truncated'; }
    writeFileSync(`results/${t.id}.body`, body);
  } catch (e) {
    note = String(e && e.message || e).slice(0, 200);
  }
  const line = { id: t.id, url: t.url, status, bytes, ms: Date.now() - started, note };
  summary.push(line);
  console.log(`${t.id}\t${status}\t${bytes}b\t${line.ms}ms\t${note}`);
}

writeFileSync('results/summary.json', JSON.stringify(summary, null, 2));
console.log(`\n${summary.length} targets probed; results/ written`);
