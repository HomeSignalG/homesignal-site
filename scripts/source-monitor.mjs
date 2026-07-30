// source-monitor.mjs — nightly automated source monitor for the development tracker.
//
// WHAT IT DOES (runs on a GitHub runner, which has egress; the build sandbox does not):
//   1. RE-PROBES every source in scripts/source-monitor-targets.json `reprobe[]` — the
//      sources docs/source-registry.md rejected as dead/stale/frozen/blocked/broken.
//   2. DISCOVERS candidate permit/land-use feeds for facility-floor jurisdictions by
//      walking the official first-party catalogs in `discovery[]` (ArcGIS service roots,
//      Socrata catalogs, DCAT feeds, CKAN catalogs).
//   3. AUTO-WIRES any candidate whose shape the existing generic connectors already
//      handle (ArcGIS FeatureServer / Socrata) AND that passes the FAIL-CLOSED gate
//      below — by appending a jurisdiction-registry.json entry. No human step.
//   4. FLAGS (never guesses) any live source whose shape the connectors do NOT handle
//      (CKAN datasets, vendor portals — Accela/eTRAKiT/CitizenServe/OpenGov/Tyler
//      EnerGov/CivicPlus — polygon-only layers, layers without a native ZIP column…)
//      into docs/source-monitor-report.md with what connector work it needs.
//   5. APPENDS a dated run report (re-probed / auto-wired / flagged + a dev-backed-ZIP
//      snapshot so the next run shows the delta).
//
// THE FAIL-CLOSED AUTO-WIRE GATE (v18 anti-fabrication is absolute):
//   • Host must be on the target's human-pinned `hosts` allowlist (kills the documented
//     lookalike trap: "Building_Permits" hits that were Brampton, ON / Atlanta, GA data).
//   • coverage (state/county) is inherited verbatim from the human-pinned target — never
//     derived from data.
//   • POINT geometry + Query capability (ArcGIS) required.
//   • A native ZIP column (lexicon fields.zip) required — address-embedded ZIPs need a
//     human-crafted zip_where_template, so they are FLAGGED, not wired.
//   • A date column required, newest record within FRESH_DAYS — a frozen archive is
//     re-probed again tomorrow, never wired.
//   • A status column required. Distinct statuses are enumerated LIVE (groupBy) and
//     mapped ONLY through scripts/source-lexicon.json — every mapping there was
//     human-approved in an existing registry entry. Unknown statuses are NOT guessed:
//     they are simply not in the entry, so the connector excludes those rows and surfaces
//     them in its run report. Gate: ≥1 status maps to proposed/approved AND lexicon-known
//     statuses cover ≥ MIN_STATUS_COVERAGE of live rows (else FLAG for a human).
//   • A type column required, with ≥1 lexicon-known include type; the wired entry scopes
//     rows AT SOURCE to the lexicon-known types (extra_where IN (...)) so noise permit
//     types (garage sales, re-roofs, signs…) never land. Unknown types are not included.
//   • record_url: per-record link when a URL-ish column exists, else the official layer /
//     dataset landing page with record_url_precision:'dataset' (the Provo precedent).
//   • Every wired entry carries _wired_by + _receipts (live counts, newest date, run id).
//
// Usage:  node scripts/source-monitor.mjs [--dry-run]
//   --dry-run: probe + report to stdout only; write NOTHING (no registry change, no report append).
// Env: FRESH_DAYS (default 400), MIN_STATUS_COVERAGE (default 0.6), TIMEOUT_MS (default 25000).

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import {
  firstColOf, windowClause, andWhere, windowLabel, renderBytes, differenceCategory,
  unresolvedIndex, UNRESOLVED_VOLUME_BOUND,
} from './lib/status-drift.mjs';

const DRY = process.argv.includes('--dry-run');
// Gate-validation mode (DRY-RUN ONLY): probe targets even when a registry entry already
// exists, so the full auto-wire entry builder runs against a known-good live layer and its
// output can be compared to the human-approved entry. Never combined with a real write.
const INCLUDE_WIRED = DRY && process.argv.includes('--include-wired');
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const TARGETS_PATH = `${ROOT}/scripts/source-monitor-targets.json`;
const LEXICON_PATH = `${ROOT}/scripts/source-lexicon.json`;
const REGISTRY_PATH = `${ROOT}/supabase/functions/get-address-report/jurisdiction-registry.json`;
const REPORT_PATH = `${ROOT}/docs/source-monitor-report.md`;

const FRESH_DAYS = parseInt(process.env.FRESH_DAYS || '400', 10);
const MIN_STATUS_COVERAGE = parseFloat(process.env.MIN_STATUS_COVERAGE || '0.6');
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '25000', 10);
const NAME_PATTERN = /permit|planning|zoning|zone case|development|land.?use|plat|subdivision/i;
// Catalog noise that matches NAME_PATTERN but is never a development-permit feed.
const NAME_EXCLUDE = /food|garage sale|alarm|animal|health|fire hydrant|inspection|sidewalk|right.?of.?way|parade|special event|alcohol|tobacco|septic|well permit/i;
const MAX_SERVICES_PER_ROOT = 60;
const MAX_CANDIDATES_PER_TARGET = 10;
const RUN_ID = new Date().toISOString();

const targets = JSON.parse(readFileSync(TARGETS_PATH, 'utf8'));
const lexicon = JSON.parse(readFileSync(LEXICON_PATH, 'utf8'));
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));

// ---------------------------------------------------------------- helpers

async function jget(url, { asText = false } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'homesignal-source-monitor/1.0' } });
      clearTimeout(t);
      if (r.status >= 500 && attempt === 0) { await sleep(3000); continue; }
      const text = await r.text();
      if (!r.ok) return { ok: false, status: r.status, text: text.slice(0, 200) };
      if (asText) return { ok: true, status: r.status, text };
      try { return { ok: true, status: r.status, json: JSON.parse(text) }; }
      catch { return { ok: false, status: r.status, text: 'non-JSON response' }; }
    } catch (e) {
      if (attempt === 0) { await sleep(3000); continue; }
      return { ok: false, status: 0, text: String(e.cause?.code || e.name || e).slice(0, 120) };
    }
  }
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };
const hostAllowed = (u, hosts) => hosts.includes(hostOf(u));
const daysAgo = (ms) => (Date.now() - ms) / 86400000;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const pick = (fieldNames, candidates) => candidates.find((c) => fieldNames.includes(c)) || null;

// Map a verbatim live value through the lexicon. Fail-closed: not listed → null.
function bucketOf(status) {
  const s = String(status).trim();
  for (const bucket of ['proposed', 'approved', 'operating', 'exclude']) {
    if (lexicon.status_to_bucket[bucket].some((v) => v.toLowerCase() === s.toLowerCase())) return bucket;
  }
  return null;
}
function useTypeOf(type) {
  const s = String(type).trim();
  for (const ut of Object.keys(lexicon.type_include)) {
    if (lexicon.type_include[ut].some((v) => v.toLowerCase() === s.toLowerCase())) return ut;
  }
  return null;
}
function vendorOf(url) {
  const u = url.toLowerCase();
  for (const [vendor, prints] of Object.entries(lexicon.vendor_fingerprints)) {
    if (prints.some((p) => u.includes(p))) return vendor;
  }
  return null;
}
const alreadyWired = (url, datasetId) => !INCLUDE_WIRED && (
  (registry.arcgis || []).some((e) => e.service_url === url) ||
  (registry.socrata || []).some((e) => e.dataset_id && e.dataset_id === datasetId));
// Never probe the same endpoint twice in one run (a service can be listed at the root AND
// inside a folder, or appear in both reprobe and discovery).
const probedUrls = new Set();
const seenBefore = (key) => probedUrls.has(key) ? true : (probedUrls.add(key), false);

// ---------------------------------------------------------------- ArcGIS probing

async function arcgisGroupBy(layerUrl, field, extraWhere) {
  const where = encodeURIComponent(extraWhere || '1=1');
  const stats = encodeURIComponent(JSON.stringify([{ statisticType: 'count', onStatisticField: field, outStatisticFieldName: 'n' }]));
  const r = await jget(`${layerUrl}/query?where=${where}&groupByFieldsForStatistics=${encodeURIComponent(field)}&outStatistics=${stats}&f=json`);
  if (!r.ok || r.json.error) return null;
  return (r.json.features || []).map((f) => ({ value: f.attributes[field], n: f.attributes.n ?? f.attributes.N ?? 0 }));
}

// Distinct values, VERBATIM. Needed because ArcGIS groupBy statistics can CASE-FOLD the
// returned value (the Denver standing answer: groupBy said UPPERCASE, the layer stores mixed
// case), which would make an exact-match drift check report false positives every night.
// groupBy is still used for the counts; anything it flags is confirmed against this first.
async function arcgisDistinct(layerUrl, field, extraWhere) {
  const where = encodeURIComponent(extraWhere || '1=1');
  const r = await jget(`${layerUrl}/query?where=${where}&outFields=${encodeURIComponent(field)}&returnDistinctValues=true&returnGeometry=false&f=json`);
  if (!r.ok || r.json.error) return null;
  return (r.json.features || []).map((f) => f.attributes[field]);
}

// ── live status-domain readers for the non-arcgis/socrata families ──────────────
// Each mirrors what its connector actually fetches, so a value flagged here is a value the
// connector would really see and really drop. Any of them returning null means "could not
// read" → reported as unreachable, never as drift.

// CKAN: the same datastore_search_sql action the connector pages with (sources/ckan.ts).
async function ckanStatusCounts(entry, field) {
  const where = entry.extra_where ? ` WHERE ${entry.extra_where}` : '';
  const sql = `SELECT "${field}" AS v, COUNT(*) AS n FROM "${entry.resource_id}"${where} GROUP BY "${field}"`;
  const r = await jget(`${entry.base_url}/api/3/action/datastore_search_sql?sql=${encodeURIComponent(sql)}`);
  if (!r.ok || r.json?.success !== true) return null;
  return (r.json.result?.records || []).map((x) => ({ value: x.v, n: parseInt(x.n, 10) || 0 }));
}

// Carto: raw SQL over the same table the connector SELECTs (sources/carto.ts).
async function cartoStatusCounts(entry, field) {
  const where = entry.extra_where ? ` WHERE ${entry.extra_where}` : '';
  const sql = `SELECT ${field} AS v, count(*) AS n FROM ${entry.table}${where} GROUP BY ${field}`;
  const r = await jget(`${entry.sql_url}?q=${encodeURIComponent(sql)}`);
  if (!r.ok || r.json?.error) return null;
  return (r.json.rows || []).map((x) => ({ value: x.v, n: parseInt(x.n, 10) || 0 }));
}

// Opendatasoft: a facet read returns the distinct values + counts without pulling rows.
async function odsStatusCounts(entry, field) {
  const r = await jget(`${entry.base_url}/api/records/1.0/search/?dataset=${encodeURIComponent(entry.dataset_id)}` +
    `&rows=0&facet=${encodeURIComponent(field)}`);
  if (!r.ok || !r.json) return null;
  const grp = (r.json.facet_groups || []).find((g) => g.name === field);
  if (!grp) return [];
  return (grp.facets || []).map((f) => ({ value: f.name, n: f.count ?? 0 }));
}

// CSV: no query API — download the file and count the status column, applying the SAME
// include_types / recency projection the connector applies at parse time (sources/csv.ts),
// so rows the connector never processes cannot register as drift.
function parseCsvRows(text) {
  const out = []; let i = 0; const n = text.length;
  while (i < n) {
    const row = [];
    for (;;) {
      if (text[i] === '"') {
        let s = ++i, field = '';
        for (;;) {
          const q = text.indexOf('"', i);
          if (q < 0) { field += text.slice(s); i = n; break; }
          if (text[q + 1] === '"') { field += text.slice(s, q + 1); i = s = q + 2; continue; }
          field += text.slice(s, q); i = q + 1; break;
        }
        row.push(field);
      } else {
        let e = i;
        while (e < n && text[e] !== ',' && text[e] !== '\n' && text[e] !== '\r') e++;
        row.push(text.slice(i, e)); i = e;
      }
      if (text[i] === ',') { i++; continue; }
      break;
    }
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
    if (row.length > 1 || row[0] !== '') out.push(row);
  }
  return out;
}
// `window`: 'in' → rows the connector fetches; 'out' → rows it never sees (older than the
// recency cutoff, or with an unparseable/absent date — csv.ts drops both). include_types is
// applied to BOTH, because it is not part of the recency window: a type the connector never
// ingests is out of scope entirely, not "latent".
async function csvStatusCounts(entry, field, window = 'in') {
  const r = await jget(entry.url, { asText: true });
  if (!r.ok || !r.text) return null;
  const rows = parseCsvRows(r.text);
  if (rows.length < 2) return null;
  const hIdx = new Map(rows[0].map((h, idx) => [String(h).trim(), idx]));
  const sIdx = hIdx.get(field);
  if (sIdx == null) return null;
  const typeCol = Array.isArray(entry.column_map?.type_source) ? entry.column_map.type_source[0] : entry.column_map?.type_source;
  const tIdx = typeCol ? hIdx.get(typeCol) : undefined;
  const include = entry.include_types ? new Set(entry.include_types.map((t) => String(t).trim())) : null;
  const dateCol = Array.isArray(entry.column_map?.file_date) ? entry.column_map.file_date[0] : entry.column_map?.file_date;
  const dIdx = dateCol ? hIdx.get(dateCol) : undefined;
  const cutoff = entry.recency_days > 0 ? Date.now() - entry.recency_days * 86400000 : null;
  // No window exists (no recency_days, or no date column to apply it to) ⇒ the whole dataset
  // IS in-window and there is no out-of-window half at all.
  const windowed = cutoff != null && dIdx != null;
  if (window === 'out' && !windowed) return [];
  const tally = new Map();
  for (let k = 1; k < rows.length; k++) {
    const row = rows[k];
    if (include && tIdx != null) { if (!include.has(String(row[tIdx] ?? '').trim())) continue; }
    if (windowed) {
      const d = new Date(String(row[dIdx] ?? '').trim());
      const fresh = !isNaN(d.getTime()) && d.getTime() >= cutoff;
      if (window === 'in' ? !fresh : fresh) continue;
    }
    const v = String(row[sIdx] ?? '').trim();
    tally.set(v, (tally.get(v) ?? 0) + 1);
  }
  return [...tally].map(([value, n]) => ({ value, n }));
}

async function arcgisMaxDate(layerUrl, dateField) {
  const stats = encodeURIComponent(JSON.stringify([{ statisticType: 'max', onStatisticField: dateField, outStatisticFieldName: 'mx' }]));
  const r = await jget(`${layerUrl}/query?where=1%3D1&outStatistics=${stats}&f=json`);
  if (!r.ok || r.json.error) return null;
  const mx = r.json.features?.[0]?.attributes?.mx ?? r.json.features?.[0]?.attributes?.MX;
  return typeof mx === 'number' ? mx : (mx ? Date.parse(mx) : null);
}

/** Probe one ArcGIS layer and evaluate the auto-wire gate. Returns a result object. */
async function probeArcgisLayer(url, target) {
  const meta = await jget(`${url}?f=json`);
  if (!meta.ok) return { result: 'unreachable', evidence: `HTTP ${meta.status} ${meta.text || ''}`.trim() };
  if (meta.json.error) return { result: 'error', evidence: `service error ${meta.json.error.code}: ${String(meta.json.error.message || '').slice(0, 120)}` };
  const m = meta.json;
  if (!m.fields) return { result: 'not-a-layer', evidence: `no fields[] — ${m.mapName || m.serviceDescription ? 'service root, not a layer' : 'unrecognized shape'}` };

  const fieldNames = m.fields.map((f) => f.name);
  // esriFieldTypeDateOnly is the newer temporal type (e.g. Detroit BSEED's issued_date) —
  // recognizing only esriFieldTypeDate made those layers read as "no date column".
  const dateFields = m.fields.filter((f) => f.type === 'esriFieldTypeDate' || f.type === 'esriFieldTypeDateOnly').map((f) => f.name);
  const geom = m.geometryType || '(none)';
  const info = { name: m.name || '', geom, rows: null };

  if (geom !== 'esriGeometryPoint') {
    return { result: 'flag', shape: `${geom} geometry`, evidence: `layer "${info.name}" is ${geom}`, needs: 'point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point' };
  }
  if (!/Query/i.test(m.capabilities || '')) return { result: 'error', evidence: `no Query capability (capabilities="${m.capabilities}")` };

  const statusField = pick(fieldNames, lexicon.fields.status);
  const typeField = pick(fieldNames, lexicon.fields.type);
  const zipField = pick(fieldNames, lexicon.fields.zip);
  const dateField = pick(dateFields, lexicon.fields.date) || dateFields[0] || null;
  const caseField = pick(fieldNames, lexicon.fields.case);
  const titleField = pick(fieldNames, lexicon.fields.title);
  const addressField = pick(fieldNames, lexicon.fields.address);

  if (!dateField) return { result: 'flag', shape: 'no date column', evidence: `fields: ${fieldNames.slice(0, 12).join(', ')}…`, needs: 'a human to identify the temporal column (none of the lexicon date candidates present)' };
  const maxMs = await arcgisMaxDate(url, dateField);
  if (maxMs == null) return { result: 'error', evidence: `max(${dateField}) query failed` };
  const newest = new Date(maxMs).toISOString().slice(0, 10);
  if (daysAgo(maxMs) > FRESH_DAYS) return { result: 'still-stale', evidence: `newest ${dateField} = ${newest} (> ${FRESH_DAYS}d old)` };

  if (!statusField) return { result: 'flag', shape: 'no status column', evidence: `fresh (newest ${newest}) but no lexicon status column among: ${fieldNames.slice(0, 15).join(', ')}`, needs: 'a human to map the status semantics (San Antonio-style dataset-level status needs a judgment call)' };
  if (!zipField) return { result: 'flag', shape: 'no native ZIP column', evidence: `fresh (newest ${newest}); address field: ${addressField || 'none'}`, needs: 'a human-crafted zip_where_template (ZIP embedded in a text field is never auto-guessed)' };
  if (!typeField) return { result: 'flag', shape: 'no type column', evidence: `fresh (newest ${newest})`, needs: 'a human to scope noise types (auto-wire requires an at-source type filter)' };

  const statuses = await arcgisGroupBy(url, statusField);
  if (!statuses || !statuses.length) return { result: 'error', evidence: `groupBy ${statusField} failed or empty` };
  const types = await arcgisGroupBy(url, typeField);
  if (!types || !types.length) return { result: 'error', evidence: `groupBy ${typeField} failed or empty` };

  const totalRows = statuses.reduce((a, s) => a + s.n, 0);
  const known = statuses.filter((s) => s.value != null && bucketOf(s.value));
  const knownRows = known.reduce((a, s) => a + s.n, 0);
  const activeKnown = known.filter((s) => ['proposed', 'approved'].includes(bucketOf(s.value)));
  const unknownVals = statuses.filter((s) => s.value != null && !bucketOf(s.value)).map((s) => `${s.value} (${s.n})`);
  const includedTypes = types.filter((t) => t.value != null && useTypeOf(t.value));

  if (!activeKnown.length || knownRows / Math.max(totalRows, 1) < MIN_STATUS_COVERAGE) {
    return {
      result: 'flag', shape: 'statuses unknown to the lexicon',
      evidence: `fresh (newest ${newest}); lexicon maps ${knownRows}/${totalRows} rows; unmapped: ${unknownVals.slice(0, 12).join('; ') || '(none — but no proposed/approved statuses)'}`,
      needs: 'a human to extend scripts/source-lexicon.json with these VERBATIM statuses (only from a human-approved mapping)',
    };
  }
  if (!includedTypes.length) {
    return {
      result: 'flag', shape: 'types unknown to the lexicon',
      evidence: `fresh (newest ${newest}); live types: ${types.slice(0, 12).map((t) => `${t.value} (${t.n})`).join('; ')}`,
      needs: 'a human to extend the lexicon type_include lists with the development-relevant VERBATIM types',
    };
  }

  // ---- gate PASSED → build the registry entry (fail-closed maps only) ----
  const statusToBucket = { proposed: [], approved: [], operating: [], exclude: [] };
  for (const s of known) statusToBucket[bucketOf(s.value)].push(String(s.value));
  for (const b of Object.keys(statusToBucket)) if (!statusToBucket[b].length) delete statusToBucket[b];
  const typeMap = {};
  for (const t of includedTypes) typeMap[String(t.value)] = useTypeOf(t.value);
  const inList = includedTypes.map((t) => `'${String(t.value).replace(/'/g, "''")}'`).join(',');

  const entry = {
    registry_id: slug(`${target.jurisdiction}-${info.name || 'permits'}`),
    platform: 'arcgis',
    service_url: url,
    dataset_url: url,
    jurisdiction: target.jurisdiction,
    coverage: [target.coverage],
    column_map: {
      ...(titleField ? { title: titleField } : { title: [typeField, ...(addressField ? [addressField] : [])] }),
      status_raw: statusField,
      type_source: typeField,
      file_date: dateField,
      ...(addressField ? { address: addressField } : {}),
      zip: zipField,
      lat: '__lat',
      lng: '__lng',
      ...(caseField ? { case_number: caseField } : {}),
    },
    extra_where: `${typeField} IN (${inList})`,
    type_map: typeMap,
    status_to_bucket: statusToBucket,
    incremental_field: dateField,
    recency_days: 365,
    record_url_precision: 'dataset',
    _wired_by: `source-monitor (auto) ${RUN_ID}`,
    _receipts: `Auto-wired by source-monitor ${RUN_ID}: layer "${info.name}" probed live — point geometry, native ZIP column ${zipField}, newest ${dateField}=${newest}, ${totalRows} rows; ${known.length} statuses mapped via the human-approved lexicon (${knownRows}/${totalRows} rows), ${unknownVals.length} statuses left unmapped→excluded-at-source-of-truth (${unknownVals.slice(0, 8).join('; ') || 'none'}); ${includedTypes.length} lexicon-known types kept at source via extra_where, others dropped. record_url falls back to the official layer (precision dataset).`,
  };
  return { result: 'wire', entry, evidence: `newest ${newest}; ${totalRows} rows; ${known.length} lexicon statuses (${Math.round((knownRows / Math.max(totalRows, 1)) * 100)}% coverage); ${includedTypes.length} lexicon types` };
}

// ---------------------------------------------------------------- Socrata probing

async function probeSocrataResource(domain, datasetId, target) {
  const view = await jget(`https://${domain}/api/views/${datasetId}.json`);
  if (!view.ok) return { result: view.status === 404 ? 'still-dead' : 'unreachable', evidence: `views API HTTP ${view.status}` };
  const cols = (view.json.columns || []).map((c) => c.fieldName);
  const updatedMs = (view.json.rowsUpdatedAt || view.json.viewLastModified || 0) * 1000;
  const newest = updatedMs ? new Date(updatedMs).toISOString().slice(0, 10) : 'unknown';
  if (!updatedMs || daysAgo(updatedMs) > FRESH_DAYS) return { result: 'still-stale', evidence: `rowsUpdatedAt = ${newest} (> ${FRESH_DAYS}d old)` };

  const statusField = pick(cols, lexicon.fields.status);
  const typeField = pick(cols, lexicon.fields.type);
  const zipField = pick(cols, lexicon.fields.zip);
  const dateField = pick(cols, lexicon.fields.date);
  const caseField = pick(cols, lexicon.fields.case);
  const titleField = pick(cols, lexicon.fields.title);
  const addressField = pick(cols, lexicon.fields.address);
  const latField = cols.includes('latitude') ? 'latitude' : null;
  const lngField = cols.includes('longitude') ? 'longitude' : null;

  const missing = [
    !statusField && 'status', !typeField && 'type', !zipField && 'native ZIP',
    !dateField && 'date', !(latField && lngField) && 'lat/lng columns',
  ].filter(Boolean);
  if (missing.length) {
    return { result: 'flag', shape: `socrata resource missing: ${missing.join(', ')}`, evidence: `updated ${newest}; columns: ${cols.slice(0, 15).join(', ')}…`, needs: 'a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)' };
  }
  const gq = await jget(`https://${domain}/resource/${datasetId}.json?$select=${statusField},count(*) as n&$group=${statusField}&$limit=100`);
  if (!gq.ok) return { result: 'error', evidence: `status groupBy failed HTTP ${gq.status}` };
  const statuses = gq.json.map((r) => ({ value: r[statusField], n: parseInt(r.n, 10) || 0 }));
  const tq = await jget(`https://${domain}/resource/${datasetId}.json?$select=${typeField},count(*) as n&$group=${typeField}&$limit=200`);
  if (!tq.ok) return { result: 'error', evidence: `type groupBy failed HTTP ${tq.status}` };
  const types = tq.json.map((r) => ({ value: r[typeField], n: parseInt(r.n, 10) || 0 }));

  const totalRows = statuses.reduce((a, s) => a + s.n, 0);
  const known = statuses.filter((s) => s.value != null && bucketOf(s.value));
  const knownRows = known.reduce((a, s) => a + s.n, 0);
  const activeKnown = known.filter((s) => ['proposed', 'approved'].includes(bucketOf(s.value)));
  const unknownVals = statuses.filter((s) => s.value != null && !bucketOf(s.value)).map((s) => `${s.value} (${s.n})`);
  const includedTypes = types.filter((t) => t.value != null && useTypeOf(t.value));

  if (!activeKnown.length || knownRows / Math.max(totalRows, 1) < MIN_STATUS_COVERAGE) {
    return { result: 'flag', shape: 'statuses unknown to the lexicon', evidence: `updated ${newest}; lexicon maps ${knownRows}/${totalRows} rows; unmapped: ${unknownVals.slice(0, 12).join('; ')}`, needs: 'a human to extend scripts/source-lexicon.json (VERBATIM values only)' };
  }
  // The Socrata connector has NO at-source type scoping (unlike arcgis extra_where), so an
  // unmapped type would land on pages as use_type:'unclassified' noise. Fail closed: auto-wire
  // only when lexicon-known types cover (nearly) all rows; otherwise a human scopes it.
  const typeRows = types.reduce((a, t) => a + t.n, 0);
  const includedTypeRows = includedTypes.reduce((a, t) => a + t.n, 0);
  if (!includedTypes.length || includedTypeRows / Math.max(typeRows, 1) < 0.95) {
    return { result: 'flag', shape: 'types not fully lexicon-known (socrata has no at-source type filter)', evidence: `updated ${newest}; lexicon covers ${includedTypeRows}/${typeRows} rows; live types: ${types.slice(0, 12).map((t) => `${t.value} (${t.n})`).join('; ')}`, needs: 'a human to extend the lexicon type_include lists, or scope the dataset (socrata entries cannot drop noise types at source)' };
  }

  const statusToBucket = { proposed: [], approved: [], operating: [], exclude: [] };
  for (const s of known) statusToBucket[bucketOf(s.value)].push(String(s.value));
  for (const b of Object.keys(statusToBucket)) if (!statusToBucket[b].length) delete statusToBucket[b];
  const typeMap = {};
  for (const t of includedTypes) typeMap[String(t.value)] = useTypeOf(t.value);

  const entry = {
    registry_id: slug(`${target.jurisdiction}-${view.json.name || datasetId}`),
    platform: 'socrata',
    domain,
    dataset_id: datasetId,
    dataset_url: `https://${domain}/d/${datasetId}`,
    jurisdiction: target.jurisdiction,
    coverage: [target.coverage],
    column_map: {
      ...(titleField ? { title: titleField } : { title: [typeField, ...(addressField ? [addressField] : [])] }),
      status_raw: statusField, type_source: typeField, file_date: dateField,
      ...(addressField ? { address: addressField } : {}),
      zip: zipField, lat: latField, lng: lngField,
      ...(caseField ? { case_number: caseField } : {}),
    },
    type_map: typeMap,
    status_to_bucket: statusToBucket,
    incremental_field: dateField,
    recency_days: 365,
    record_url_precision: 'dataset',
    _wired_by: `source-monitor (auto) ${RUN_ID}`,
    _receipts: `Auto-wired by source-monitor ${RUN_ID}: "${view.json.name}" (${datasetId}) — updated ${newest}, ${totalRows} rows; ${known.length} lexicon-known statuses (${knownRows}/${totalRows} rows), unmapped→excluded: ${unknownVals.slice(0, 8).join('; ') || 'none'}; ${includedTypes.length} lexicon-known types scoped at source.`,
  };
  return { result: 'wire', entry, evidence: `updated ${newest}; ${totalRows} rows; ${known.length} lexicon statuses; ${includedTypes.length} lexicon types` };
}

// ---------------------------------------------------------------- catalog walkers (discovery)

async function walkArcgisRoot(target, findings) {
  const root = await jget(`${target.url}?f=json`);
  if (!root.ok || root.json.error) { findings.push(row(target, 'unreachable', `root HTTP ${root.status} ${root.text || ''}`)); return; }
  const services = [...(root.json.services || [])];
  for (const folder of (root.json.folders || []).slice(0, 15)) {
    const f = await jget(`${target.url}/${folder}?f=json`);
    if (f.ok && !f.json.error) services.push(...(f.json.services || []));
    if (services.length >= MAX_SERVICES_PER_ROOT) break;
  }
  const interesting = services.filter((s) => NAME_PATTERN.test(s.name) && !NAME_EXCLUDE.test(s.name)).slice(0, MAX_CANDIDATES_PER_TARGET);
  if (!interesting.length) { findings.push(row(target, 'no-candidates', `${services.length} services listed; none match the permit/land-use pattern`)); return; }
  let probed = 0;
  for (const svc of interesting) {
    const svcUrl = `${target.url}/${svc.name}/${svc.type}`;
    const sMeta = await jget(`${svcUrl}?f=json`);
    if (!sMeta.ok || sMeta.json.error) { findings.push(row(target, 'error', `${svc.name}: HTTP ${sMeta.status}`)); continue; }
    const layers = (sMeta.json.layers || []).filter((l) => !NAME_EXCLUDE.test(l.name || '')).slice(0, 6);
    for (const layer of layers) {
      if (probed++ >= MAX_CANDIDATES_PER_TARGET) return;
      const layerUrl = `${svcUrl}/${layer.id}`;
      if (seenBefore(layerUrl) || alreadyWired(layerUrl)) continue;
      if (!hostAllowed(layerUrl, target.hosts)) continue;
      const res = await probeArcgisLayer(layerUrl, target);
      findings.push(row({ ...target, id: `${target.id} → ${svc.name}/${layer.name}` }, res.result, res.evidence, res, layerUrl));
    }
  }
  if (!probed) findings.push(row(target, 'no-candidates', `${interesting.length} permit-pattern service(s) but every layer was filtered, duplicate, or already wired`));
}

async function walkSocrataCatalog(target, findings) {
  const url = `https://${target.domain}/api/catalog/v1?q=permit&only=datasets&limit=20&search_context=${target.domain}`;
  const r = await jget(url);
  if (!r.ok) { findings.push(row(target, r.status === 404 || r.status === 0 ? 'still-dead' : 'unreachable', `catalog HTTP ${r.status} ${r.text || ''}`)); return; }
  const own = (r.json.results || []).filter((d) => (d.metadata?.domain || '') === target.domain);
  if (!own.length) { findings.push(row(target, 'no-candidates', `catalog reachable but 0 first-party datasets for q=permit (${(r.json.results || []).length} federated hits ignored — the Plano trap)`)); return; }
  let emitted = 0;
  for (const d of own.slice(0, MAX_CANDIDATES_PER_TARGET)) {
    const id = d.resource?.id;
    if (!id || seenBefore(`socrata:${target.domain}:${id}`) || alreadyWired(null, id)) continue;
    if (!NAME_PATTERN.test(d.resource?.name || '') || NAME_EXCLUDE.test(d.resource?.name || '')) continue;
    const res = await probeSocrataResource(target.domain, id, target);
    findings.push(row({ ...target, id: `${target.id} → ${d.resource.name} (${id})` }, res.result, res.evidence, res));
    emitted++;
  }
  if (!emitted) findings.push(row(target, 'no-candidates', `${own.length} first-party dataset(s) for q=permit but none matched the permit/land-use pattern (or all duplicate/already wired)`));
}

async function walkDcat(target, findings) {
  const r = await jget(target.url);
  if (!r.ok) { findings.push(row(target, 'unreachable', `DCAT HTTP ${r.status} ${r.text || ''}`)); return; }
  const datasets = (r.json.dataset || []).filter((d) => NAME_PATTERN.test(d.title || '') && !NAME_EXCLUDE.test(d.title || ''));
  if (!datasets.length) { findings.push(row(target, 'no-candidates', `${(r.json.dataset || []).length} datasets; none match the permit/land-use pattern`)); return; }
  let probed = 0;
  for (const d of datasets.slice(0, MAX_CANDIDATES_PER_TARGET)) {
    const dist = (d.distribution || []).map((x) => x.accessURL || x.downloadURL || '').filter(Boolean);
    const esri = dist.find((u) => /(FeatureServer|MapServer)(\/\d+)?(\?|$)/.test(u));
    if (!esri) {
      const vendor = dist.map(vendorOf).find(Boolean);
      findings.push(row({ ...target, id: `${target.id} → ${d.title}` }, vendor ? 'flag' : 'no-candidates',
        vendor ? `vendor portal (${vendor}) — no open-data API distribution` : 'no ArcGIS/Socrata distribution',
        vendor ? { result: 'flag', shape: `vendor portal: ${vendor}`, needs: `a ${vendor} connector (generic connectors handle ArcGIS + Socrata only)` } : undefined));
      continue;
    }
    if (probed++ >= MAX_CANDIDATES_PER_TARGET) return;
    const layerUrl = /\/\d+(\?|$)/.test(esri) ? esri.replace(/\?.*$/, '') : `${esri.replace(/\/?(\?.*)?$/, '')}/0`;
    if (seenBefore(layerUrl) || alreadyWired(layerUrl)) continue;
    if (!hostAllowed(layerUrl, target.hosts)) { findings.push(row({ ...target, id: `${target.id} → ${d.title}` }, 'skipped', `host ${hostOf(layerUrl)} not on the target allowlist`)); continue; }
    const res = await probeArcgisLayer(layerUrl, target);
    findings.push(row({ ...target, id: `${target.id} → ${d.title}` }, res.result, res.evidence, res, layerUrl));
  }
}

async function walkCkan(target, findings) {
  const r = await jget(`${target.url}/api/3/action/package_search?q=permit&rows=10`);
  if (!r.ok || !r.json.success) { findings.push(row(target, 'unreachable', `CKAN HTTP ${r.status}`)); return; }
  const hits = (r.json.result?.results || []).filter((d) => NAME_PATTERN.test(d.title || '') && !NAME_EXCLUDE.test(d.title || ''));
  if (!hits.length) { findings.push(row(target, 'no-candidates', `CKAN reachable; 0 permit/land-use datasets`)); return; }
  findings.push(row(target, 'flag', `CKAN catalog with ${hits.length} permit-pattern dataset(s): ${hits.slice(0, 5).map((h) => h.title).join('; ')}`,
    { result: 'flag', shape: 'CKAN catalog', needs: 'a CKAN connector (generic connectors handle ArcGIS + Socrata only) — or wire the dataset directly if a distribution exposes an ArcGIS/Socrata API' }));
}

// ---------------------------------------------------------------- dev-backed snapshot

async function devBackedSnapshot() {
  try {
    const cfg = readFileSync(`${ROOT}/config.js`, 'utf8');
    const grab = (n) => (cfg.match(new RegExp(`${n}\\s*:\\s*'([^']+)'`)) || [])[1];
    const base = grab('SUPABASE_URL'), key = grab('SUPABASE_ANON_KEY');
    if (!base || !key) return null;
    const zips = new Set();
    for (let page = 0; page < 100; page++) {
      const r = await fetch(`${base}/rest/v1/app_projects?select=zip&record_kind=eq.development&limit=1000&offset=${page * 1000}`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!r.ok) return null;
      const rows = await r.json();
      rows.forEach((x) => zips.add(x.zip));
      if (rows.length < 1000) break;
    }
    return zips.size;
  } catch { return null; }
}

// ---------------------------------------------------------------- run

function row(target, result, evidence, res, url) {
  return { id: target.id, jurisdiction: target.jurisdiction, result, evidence: evidence || '', res, url };
}

const findings = [];
const wired = [];

// Phase 1 — re-probe rejected sources
for (const t of targets.reprobe) {
  let res;
  if (t.kind === 'arcgis-layer') {
    if (!hostAllowed(t.url, t.hosts)) { findings.push(row(t, 'skipped', 'host not on allowlist')); continue; }
    seenBefore(t.url);
    res = alreadyWired(t.url) ? { result: 'already-wired', evidence: 'registry entry exists' } : await probeArcgisLayer(t.url, t);
    findings.push(row(t, res.result, res.evidence, res, t.url));
  } else if (t.kind === 'socrata-resource') {
    seenBefore(`socrata:${t.domain}:${t.dataset_id}`);
    res = alreadyWired(null, t.dataset_id) ? { result: 'already-wired', evidence: 'registry entry exists' } : await probeSocrataResource(t.domain, t.dataset_id, t);
    findings.push(row(t, res.result, res.evidence, res));
  } else if (t.kind === 'socrata-catalog') {
    await walkSocrataCatalog(t, findings);
  }
}

// Phase 2 — discovery for facility-floor jurisdictions
for (const t of targets.discovery) {
  if (t.kind === 'arcgis-root') await walkArcgisRoot(t, findings);
  else if (t.kind === 'socrata-catalog') await walkSocrataCatalog(t, findings);
  else if (t.kind === 'dcat') await walkDcat(t, findings);
  else if (t.kind === 'ckan-catalog') await walkCkan(t, findings);
}

// Phase 3 — wire what passed the gate (append registry entries)
for (const f of findings) {
  if (f.res?.result === 'wire' && f.res.entry) {
    const list = f.res.entry.platform === 'arcgis' ? (registry.arcgis = registry.arcgis || []) : (registry.socrata = registry.socrata || []);
    if (!list.some((e) => e.registry_id === f.res.entry.registry_id) || INCLUDE_WIRED) {
      if (!INCLUDE_WIRED) list.push(f.res.entry);
      wired.push(f.res.entry.registry_id);
      if (DRY) console.log(`\n--- entry the gate built for ${f.res.entry.registry_id} (dry-run, not written) ---\n${JSON.stringify(f.res.entry, null, 2)}\n`);
    }
  }
}
if (wired.length && !DRY) writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 1) + '\n');

// Phase 3.5 — STATUS-DOMAIN DRIFT across the WHOLE registry.
//
// An unmapped status is the one soft-fail that DROPS a record: the connectors exclude it
// (it cannot be bucketed) and only count it in their run report. verify-development already
// fails on that report, but it drives a bounded RUN_REPORT_SAMPLE of ZIPs through the live
// engine (3 by default) out of thousands, so an unmapped status on a quiet county can sit
// undetected indefinitely — that is exactly how the Fort Worth / Provo drops (2026-07-29
// TX/UT sweep) stayed invisible. This check is per-ENTRY instead of per-ZIP: one live
// distinct-value read per registry entry, diffed against its own status_to_bucket, so
// EVERY entry is covered every night regardless of which ZIPs get sampled.
//
// Values are compared EXACTLY after trim — the connectors do `lookup.get(statusRaw)` on a
// trimmed string with no case folding, so a case difference is a real miss, not noise.
// Blank/null is not drift: the connectors count it as blank_status and fail closed.
async function statusDomainDrift() {
  const out = [];
  // EVERY connector family with a status column, not just the two big ones. Shipping a
  // completeness gate that itself covers only part of the surface would recreate exactly the
  // partial-sampling gap this check exists to close (founder decision, 2026-07-29).
  const families = [
    ['arcgis', registry.arcgis || []],
    ['socrata', registry.socrata || []],
    ['ckan', registry.ckan || []],
    ['csv', registry.csv || []],
    ['carto', registry.carto || []],
    ['opendatasoft', registry.opendatasoft || []],
  ];
  for (const [family, entries] of families) {
    for (const e of entries) {
      const field = e.column_map?.status_raw;
      // status_const entries have no status column to drift (bucket is assigned in code).
      if (!field || e.status_const) continue;
      const mapped = new Set();
      for (const b of ['proposed', 'approved', 'operating', 'exclude']) {
        for (const v of (e.status_to_bucket?.[b] || [])) mapped.add(String(v).trim());
      }
      if (!mapped.size) continue;                       // nothing declared → not a drift signal

      // Read the SAME domain twice: once inside the connector's window, once outside it.
      const readDomain = async (invert) => {
        const win = windowClause(family, e, invert);
        // An entry with no window has no out-of-window half — say so rather than re-reading
        // the same rows and reporting them twice under two different tiers.
        if (invert && !win && family !== 'csv') return e.recency_days > 0 ? null : [];
        const where = andWhere(e.extra_where, win);
        if (family === 'arcgis') {
          const rows = await arcgisGroupBy(e.service_url, field, where);
          return rows ? rows.map((r) => ({ value: r.value, n: r.n })) : null;
        }
        if (family === 'socrata') {
          const w = where ? `&$where=${encodeURIComponent(where)}` : '';
          const r = await jget(`https://${e.domain}/resource/${e.dataset_id}.json` +
            `?$select=${encodeURIComponent(field)},count(*) as n&$group=${encodeURIComponent(field)}&$limit=2000${w}`);
          return (r.ok && Array.isArray(r.json)) ? r.json.map((x) => ({ value: x[field], n: parseInt(x.n, 10) || 0 })) : null;
        }
        if (family === 'ckan')   return ckanStatusCounts({ ...e, extra_where: where }, field);
        if (family === 'carto')  return cartoStatusCounts({ ...e, extra_where: where }, field);
        if (family === 'csv')    return csvStatusCounts(e, field, invert ? 'out' : 'in');
        // opendatasoft has NO connector (`sources/opendatasoft.ts` does not exist), so there
        // is no "what the connector fetches" to mirror. Facets cannot be windowed either.
        if (family === 'opendatasoft') return invert ? [] : odsStatusCounts(e, field);
        return null;
      };

      let inLive = null, outLive = null;
      try { inLive = await readDomain(false); } catch { inLive = null; }
      try { outLive = await readDomain(true); } catch { outLive = null; }
      if (!inLive) { out.push({ registry_id: e.registry_id, family, field, unreachable: true, inWindow: [], outWindow: [], notes: [], unresolved: [] }); continue; }

      const mappedKeys = [...mapped];
      const unresolved = unresolvedIndex(e);
      const inTotal = inLive.reduce((s, v) => s + (v.n || 0), 0);

      // Confirm arcgis groupBy values verbatim before reporting (groupBy can CASE-FOLD).
      // Scoped to the SAME window the counts came from, or the confirmation would answer a
      // different question than the probe — the exact Rule 13 trap this pass exists to fix.
      let presentIn = null;
      if (family === 'arcgis') {
        const verbatim = await arcgisDistinct(e.service_url, field, andWhere(e.extra_where, windowClause(family, e)));
        if (!verbatim) { out.push({ registry_id: e.registry_id, family, field, unreachable: true, inWindow: [], outWindow: [], notes: [], unresolved: [] }); continue; }
        presentIn = new Set(verbatim.filter((v) => v != null).map((v) => String(v).trim()));
      }

      const notes = [], gating = [], latent = [], unresolvedHits = [];
      const classify = (list, isIn) => {
        for (const v of (list || [])) {
          if (v.value == null || String(v.value).trim() === '') continue;   // blank → blank_status, fails closed
          const val = String(v.value).trim();
          if (mapped.has(val)) continue;
          if (isIn && presentIn && !presentIn.has(val)) continue;           // groupBy case-fold artefact
          const diff = differenceCategory(val, mappedKeys);
          if (diff) { notes.push({ value: val, n: v.n, window: isIn ? 'in' : 'out', ...diff }); continue; }
          const u = unresolved.get(val);
          if (u) { unresolvedHits.push({ value: val, n: v.n, window: isIn ? 'in' : 'out', ...u }); continue; }
          (isIn ? gating : latent).push({ value: val, n: v.n });
        }
      };
      classify(inLive, true);
      classify(outLive, false);
      gating.sort((a, b) => b.n - a.n); latent.sort((a, b) => b.n - a.n);

      // The escape hatch is BOUNDED. status_unresolved suppresses the gate for a value whose
      // meaning no one could establish — but if those records are more than 5% of what the
      // connector actually fetches, that is not an edge case, it is a mapping failure hiding
      // behind the hatch, and it gates anyway.
      const unresolvedIn = unresolvedHits.filter((u) => u.window === 'in').reduce((s, u) => s + (u.n || 0), 0);
      const unresolvedShare = inTotal > 0 ? unresolvedIn / inTotal : 0;
      const boundBreached = unresolvedShare > UNRESOLVED_VOLUME_BOUND;

      if (gating.length || latent.length || notes.length || unresolvedHits.length) {
        out.push({
          registry_id: e.registry_id, family, field, unreachable: false,
          window: windowLabel(family, e), outWindowReadable: outLive != null,
          inWindow: gating, outWindow: latent, notes, unresolved: unresolvedHits,
          inTotal, unresolvedIn, unresolvedShare, boundBreached,
        });
      }
    }
  }
  return out;
}
const drift = await statusDomainDrift();
// ONLY tier 1 (in-window unmapped) and a breached unresolved-volume bound fail the run.
// Out-of-window values and difference-category notes are reported, never gated: the connector
// cannot fetch them today, so failing on them would red the run nightly for history.
const driftReal = drift.filter((d) => !d.unreachable && (d.inWindow.length || d.boundBreached));
const driftLatent = drift.filter((d) => !d.unreachable && d.outWindow.length);
const driftNotes = drift.filter((d) => !d.unreachable && d.notes.length);
const driftUnresolved = drift.filter((d) => !d.unreachable && d.unresolved.length);
const driftChecked = ['arcgis', 'socrata', 'ckan', 'csv', 'carto', 'opendatasoft']
  .flatMap((f) => registry[f] || [])
  .filter((e) => e.column_map?.status_raw && !e.status_const &&
    ['proposed', 'approved', 'operating', 'exclude'].some((b) => (e.status_to_bucket?.[b] || []).length)).length;

// Phase 4 — report
const snapshot = await devBackedSnapshot();
let prevSnapshot = null;
if (existsSync(REPORT_PATH)) {
  const prev = readFileSync(REPORT_PATH, 'utf8').match(/Dev-backed ZIPs snapshot: \*\*(\d+)\*\*/g);
  if (prev?.length) prevSnapshot = parseInt(prev[prev.length - 1].match(/(\d+)/)[1], 10);
}
const flagged = findings.filter((f) => f.result === 'flag');
const section = [
  ``,
  `## Run ${RUN_ID}${DRY ? ' (dry-run — nothing written)' : ''}`,
  ``,
  `- Sources re-probed: **${targets.reprobe.length}** · discovery targets walked: **${targets.discovery.length}** · candidates evaluated: **${findings.length}**`,
  `- Auto-wired: ${wired.length ? wired.map((w) => `**${w}**`).join(', ') : '**none**'}`,
  `- Flagged new shapes (connector work needed — never guessed): **${flagged.length}**`,
  `- Dev-backed ZIPs snapshot: **${snapshot ?? 'unavailable'}**${prevSnapshot != null && snapshot != null ? ` (Δ ${snapshot - prevSnapshot >= 0 ? '+' : ''}${snapshot - prevSnapshot} vs last run)` : ''}`,
  wired.length ? `- Newly wired entries land on pages after the next engine deploy + nightly refresh (09:00 UTC); the NEXT run's snapshot shows their delta.` : null,
  ``,
  `| target | result | evidence |`,
  `|---|---|---|`,
  ...findings.map((f) => `| ${f.id} | ${f.result} | ${String(f.evidence).replace(/\|/g, '\\|').slice(0, 300)} |`),
  ...(flagged.length ? [``, `### Flagged shapes — what connector work each needs`, ...flagged.map((f) => `- **${f.id}** — ${f.res?.shape || 'unrecognized shape'}: ${f.res?.needs || ''}`)] : []),
  // Status-domain drift: an unmapped status DROPS records, so it is reported first-class and
  // fails the run (the workflow greps STATUS_DRIFT=1 after committing this report).
  ``,
  `### Status-domain drift — unmapped statuses DROP records`,
  `- Registry entries checked: **${driftChecked}** · **gating** (in-window unmapped or volume bound breached): **${driftReal.length}** · unreachable: **${drift.filter((d) => d.unreachable).length}**`,
  `- Every probe below applies that entry's OWN \`extra_where\` + \`recency_days\` + status field, so it asks the question the connector asks (Rule 13). The scope tested is printed with each entry.`,
  ...(driftReal.length
    ? [
      ``,
      `#### Tier 1 — IN-WINDOW unmapped · **these gate the run** (records the connector fetches and drops today)`,
      ``,
      `| registry_id | status field | window scope probed | unmapped value(s) — records dropped |`,
      `|---|---|---|---|`,
      ...driftReal.map((d) => `| ${d.registry_id} | ${d.field} | ${String(d.window).replace(/\|/g, '\\|').slice(0, 160)} | ${
        d.inWindow.map((m) => `\`${String(m.value).replace(/\|/g, '\\|')}\` (${m.n})`).join(', ').slice(0, 300) || '—'
      }${d.boundBreached ? ` · ⚠️ status_unresolved holds ${d.unresolvedIn}/${d.inTotal} in-window records (${(d.unresolvedShare * 100).toFixed(1)}%) — over the ${(UNRESOLVED_VOLUME_BOUND * 100).toFixed(0)}% bound, so the hatch no longer suppresses the gate` : ''} |`),
      ``,
      `Fix: add each value verbatim to that entry's \`status_to_bucket\`. Never normalize or re-case — the connectors match exactly after trim. If a value's meaning cannot be established from the publisher, put it in \`status_unresolved\` (with \`first_seen\`, \`records_at_first_seen\` and the question asked) rather than guessing a bucket.`,
    ]
    : [`- **No in-window unmapped statuses anywhere in the registry.** Nothing gates.`]),
  ...(driftLatent.length
    ? [
      ``,
      `#### Tier 2 — OUT-OF-WINDOW unmapped · non-failing (latent: outside \`recency_days\`, so the connector cannot fetch them today)`,
      ``,
      `Map these anyway where the domain is bounded and enumerable — a \`recency_days\` widening or one re-issued historical record is all it takes to pull them in. They do not gate.`,
      ``,
      `| registry_id | status field | value(s) (records outside the window) |`,
      `|---|---|---|`,
      ...driftLatent.map((d) => `| ${d.registry_id} | ${d.field} | ${d.outWindow.map((m) => `\`${String(m.value).replace(/\|/g, '\\|')}\` (${m.n})`).join(', ').slice(0, 400)} |`),
    ]
    : []),
  ...(driftNotes.length
    ? [
      ``,
      `#### Tier 3 — difference categories · non-failing`,
      ``,
      `| registry_id | live value (byte-level) | registry key (byte-level) | category | resolves in production? |`,
      `|---|---|---|---|---|`,
      ...driftNotes.flatMap((d) => d.notes.map((nt) => `| ${d.registry_id} | \`${renderBytes(nt.value).replace(/\|/g, '\\|')}\` | \`${renderBytes(nt.key).replace(/\|/g, '\\|')}\` | ${nt.category} | ${nt.resolves ? 'yes — case-folded lookup matches it' : '**NO — interior whitespace is not collapsed, so the record is still DROPPED**'} |`)),
      ``,
      `\`·\` marks a space. A case-only difference resolves via the case-insensitive lookup; a whitespace-only difference does **not** — \`resolveNormalized\` trims and case-folds but never collapses interior runs, so the registry key must be corrected to the publisher's exact bytes.`,
    ]
    : []),
  ...(driftUnresolved.length
    ? [
      ``,
      `#### status_unresolved — known values with no established meaning · non-failing below the ${(UNRESOLVED_VOLUME_BOUND * 100).toFixed(0)}% volume bound`,
      ``,
      `These are **not** bucketed and their records are still dropped, fail-closed. Listing one only records that a human looked and could not attribute a meaning — never that it is safe.`,
      ``,
      `| registry_id | value | in-window records | share of fetched | first seen | records at first seen | what was asked, and of whom |`,
      `|---|---|---|---|---|---|---|`,
      ...driftUnresolved.flatMap((d) => d.unresolved.map((u) => `| ${d.registry_id} | \`${String(u.value).replace(/\|/g, '\\|')}\` | ${u.window === 'in' ? u.n : `0 (out-of-window: ${u.n})`} | ${d.inTotal ? ((u.window === 'in' ? u.n : 0) / d.inTotal * 100).toFixed(2) + '%' : 'n/a'} | ${u.first_seen || '—'} | ${u.records_at_first_seen ?? '—'} | ${String(u.asked || '—').replace(/\|/g, '\\|').slice(0, 220)} |`)),
    ]
    : []),
].filter((x) => x !== null).join('\n') + '\n';

if (!DRY) appendFileSync(REPORT_PATH, section);
console.log(section);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, section);
console.log(`${DRY ? '[dry-run] ' : ''}done: ${wired.length} wired, ${flagged.length} flagged, ${findings.length} findings, ${driftReal.length} status-drift.`);
if (wired.length) console.log('REGISTRY_CHANGED=1');
// Grep-able marker (same idiom as REGISTRY_CHANGED). The workflow fails the run on this
// AFTER committing the report, so the evidence lands even though the run goes red. Printed
// last so it is never confused with a per-target line.
if (driftReal.length) console.log('STATUS_DRIFT=1');
