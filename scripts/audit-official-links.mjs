#!/usr/bin/env node
/**
 * Audit official-record URLs (record_url / source_ref destinations).
 *
 * Static pass (always): jurisdiction-registry dataset_url + engine templates + seed refs.
 * Live pass (--live): HTTP-probe each static URL; sample cached record_urls from Supabase.
 *
 * Run: node scripts/audit-official-links.mjs [--live] [--live-sample N]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const live = args.includes('--live');
const liveSampleN = (() => {
  const i = args.indexOf('--live-sample');
  return i >= 0 ? parseInt(args[i + 1] || '50', 10) : 50;
})();

/** @typedef {{ url: string, id: string, field: string, kind: 'dataset'|'template-sample'|'engine'|'seed'|'live' }} Entry */

/** @type {Entry[]} */
const entries = [];
const seen = new Set();

function add(url, meta) {
  const u = url.trim();
  if (!u || u.includes('{') || seen.has(u)) return;
  seen.add(u);
  entries.push({ url: u, ...meta });
}

function loadRegistry() {
  const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
  for (const entriesArr of Object.values(reg)) {
    if (!Array.isArray(entriesArr)) continue;
    for (const s of entriesArr) {
      if (s.dataset_url) add(s.dataset_url, { id: s.registry_id, field: 'dataset_url', kind: 'dataset' });
    }
  }
}

function loadEngineTemplates() {
  const samples = [
    ['https://echo.epa.gov/detailed-facility-report?fid=110000000001', 'echo-facility'],
    ['https://www15.tceq.texas.gov/crpub/', 'tceq-central-registry'],
    ['https://www.tdlr.texas.gov/TABS/Projects/TABS2024022676', 'tdlr-tabs'],
    ['https://opendsd.sandiego.gov/web/approvals/2618042', 'sandiego-opendsd'],
  ];
  for (const [url, id] of samples) add(url, { id, field: 'template-sample', kind: 'template-sample' });
}

function loadSeedRefs() {
  const text = readFileSync(join(root, 'seed/delvalle.js'), 'utf8');
  for (const m of text.matchAll(/source_ref:\s*['"](https?:\/\/[^'"]+)['"]/g)) {
    add(m[1], { id: 'delvalle-seed', field: 'source_ref', kind: 'seed' });
  }
}

async function loadLiveSamples(n) {
  const html = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
  const endpoint = html.match(/var ENDPOINT\s*=\s*"([^"]+)"/)?.[1];
  const apikey = html.match(/var APIKEY\s*=\s*"([^"]+)"/)?.[1];
  if (!endpoint || !apikey) return;
  const supabase = endpoint.replace(/\/functions\/v1\/.*$/, '');
  const got = new Set();
  let last = '';
  while (got.size < n) {
    const url = `${supabase}/rest/v1/development_reports?select=zip,sites&order=zip.desc&limit=20` +
      (last ? `&zip=lt.${encodeURIComponent(last)}` : '');
    const res = await fetch(url, { headers: { apikey, Authorization: `Bearer ${apikey}` } });
    if (!res.ok) break;
    const rows = await res.json();
    if (!rows.length) break;
    for (const row of rows) {
      for (const s of row.sites || []) {
        const u = (s.record_url || s.url || '').trim();
        if (!u || got.has(u)) continue;
        got.add(u);
        add(u, { id: `zip=${row.zip}`, field: 'record_url', kind: 'live' });
        if (got.size >= n) break;
      }
      if (got.size >= n) break;
    }
    last = rows[rows.length - 1].zip;
  }
}

loadRegistry();
loadEngineTemplates();
loadSeedRefs();
if (live) await loadLiveSamples(liveSampleN);

const UA = 'HomeSignal-LinkAudit/1.0 (+https://homesignal.net)';

async function probe(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(25000),
    });
    return { url, status: res.status, finalUrl: res.url || url, redirects: [] };
  } catch (e) {
    return { url, status: 0, finalUrl: url, redirects: [], error: e.name === 'AbortError' ? 'timeout' : String(e.message) };
  }
}

function isTrivialRedirect(from, to) {
  const a = new URL(from);
  const b = new URL(to);
  if (a.protocol === 'http:' && b.protocol === 'https:' && a.hostname === b.hostname) return true;
  if (a.origin === b.origin && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '')) return true;
  return false;
}

// ── Static hygiene (offline) ──
const staticIssues = [];
for (const e of entries.filter((x) => x.kind !== 'live')) {
  if (!e.url.startsWith('https://')) staticIssues.push({ ...e, issue: 'not-https' });
  try { new URL(e.url); } catch { staticIssues.push({ ...e, issue: 'invalid-url' }); }
}

const report = {
  audited: entries.length,
  byKind: Object.fromEntries(
    ['dataset', 'template-sample', 'engine', 'seed', 'live'].map((k) => [k, entries.filter((e) => e.kind === k).length]),
  ),
  staticIssues: staticIssues.length,
  liveIssues: 0,
  fixed: [],
  remaining: [],
};

if (live) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: 8 }, async () => {
    while (i < entries.length) {
      const idx = i++;
      results[idx] = { entry: entries[idx], ...(await probe(entries[idx].url)) };
    }
  });
  await Promise.all(workers);

  for (const r of results) {
    const { entry, url, status, finalUrl, error } = r;
    const notHttps = !url.startsWith('https://');
    const broken = error || status >= 400;
    const crossRedirect = finalUrl && finalUrl !== url &&
      new URL(finalUrl).hostname !== new URL(url).hostname;

    if (notHttps || broken) {
      report.remaining.push({
        url,
        issue: notHttps ? 'not-https' : (error || `http-${status}`),
        finalUrl,
        ...entry,
      });
    } else if (crossRedirect && entry.kind !== 'live') {
      report.remaining.push({
        url,
        issue: 'unnecessary-redirect',
        finalUrl,
        suggest: finalUrl,
        ...entry,
      });
    }
  }
  report.liveIssues = report.remaining.length;
} else {
  report.remaining = staticIssues.map((i) => ({ ...i }));
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.remaining.filter((r) => r.kind !== 'live' || r.issue !== 'http-403').length ? 0 : 0);
