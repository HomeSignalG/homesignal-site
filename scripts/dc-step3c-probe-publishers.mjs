#!/usr/bin/env node
// STEP 3C — WHAT CAN THE ORIGINAL PUBLISHERS SUPPLY TODAY? (read-only probe)
//
// Before any resident population is onboarded through the canonical evidence writer, this asks
// each ORIGINAL publisher -- not a HomeSignal table -- what it still publishes for the records
// residents see. It WRITES NOTHING: no evidence, no acquisition run, no registry row. It is the
// measurement that decides whether onboarding is possible, not the onboarding.
//
//   OpenStreetMap   Overpass `out meta center` by element id: version, changeset, timestamp,
//                   tags and geometry as OSM holds them NOW, plus the dataset's osm_base time.
//                   An element absent from the answer is absent from OSM today.
//   EPA FRS / ECHO  the ECHO detailed-facility service by registry id: whether the PUBLISHER
//                   carries an industry code. HomeSignal's own `type = datacenter` on these rows
//                   is NOT publisher evidence -- get-address-report stamps it from the facility
//                   NAME (supabase/functions/get-address-report/index.ts, classifyLayer) -- so
//                   the only publisher-native classification that could exist is NAICS/SIC.
//   permit portals  no network probe: the classifier inputs the ledger already carries show
//                   whether a record is a data centre by a PUBLISHER field (type_raw) or only by
//                   HomeSignal reading its NAME. Reported per record.
//
// Output is aggregate counts + fingerprints in the job log (the receipt channel).

import { shippedClassifier, readLedger } from './dc-step3c-reconcile.mjs';
import { createHash } from 'node:crypto';

const UA = 'HomeSignal-dc-step3c-probe/1.0 (+https://homesignal.net; read-only provenance probe)';
const md5 = (s) => createHash('md5').update(s).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── OSM ─────────────────────────────────────────────────────────────────────────────────
export function osmIdLists(keys) {
  const out = { node: [], way: [], relation: [] };
  for (const k of keys) {
    // national_dc_records.source_key is 'osm:<type>/<id>' (measured: 'osm:node/10537283366').
    const m = /^osm:(node|way|relation)\/(\d+)$/.exec(k);
    if (!m) throw new Error(`not an OSM element key: ${k}`);
    out[m[1]].push(m[2]);
  }
  return out;
}

export function classifyOsm(requestedKeys, elements) {
  const got = new Map(elements.map((e) => [`osm:${e.type}/${e.id}`, e]));
  const per = {};
  const tally = { requested: requestedKeys.length, returned: 0, absent_today: 0,
    still_tagged_data_center: 0, tag_no_longer_data_center: 0,
    with_version: 0, with_changeset: 0, with_timestamp: 0, with_geometry: 0 };
  for (const k of requestedKeys) {
    const e = got.get(k);
    if (!e) { per[k] = 'ABSENT_TODAY'; tally.absent_today++; continue; }
    tally.returned++;
    if (e.version != null) tally.with_version++;
    if (e.changeset != null) tally.with_changeset++;
    if (e.timestamp) tally.with_timestamp++;
    if ((e.lat != null && e.lon != null) || e.center) tally.with_geometry++;
    const t = e.tags || {};
    // The publisher's own classification: OSM's telecom=data_center (the key the national plane
    // was imported on) or building=data_center. Read from the tag, never from the name.
    if (t.telecom === 'data_center' || t.building === 'data_center') { per[k] = 'PRESENT_TAGGED_DATA_CENTER'; tally.still_tagged_data_center++; }
    else { per[k] = 'PRESENT_TAG_CHANGED'; tally.tag_no_longer_data_center++; }
  }
  return { per, tally };
}

async function overpass(ids) {
  const parts = [];
  if (ids.node.length) parts.push(`node(id:${ids.node.join(',')});`);
  if (ids.way.length) parts.push(`way(id:${ids.way.join(',')});`);
  if (ids.relation.length) parts.push(`relation(id:${ids.relation.join(',')});`);
  // `meta` and `tags` are BOTH verbosity levels and the LAST one wins: the first version of this
  // probe wrote `out meta center tags;`, which silently dropped version/changeset/timestamp and
  // reported 0 of 1,073 as carrying them. `out meta center;` already includes the tags.
  const q = `[out:json][timeout:180];(${parts.join('')});out meta center;`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
    });
    if (res.ok) return res.json();
    console.log(`  overpass attempt ${attempt}: HTTP ${res.status}`);
    if (res.status !== 429 && res.status < 500) throw new Error(`Overpass HTTP ${res.status}`);
    await sleep(30000 * attempt);
  }
  throw new Error('Overpass unavailable after 3 attempts');
}

// ── EPA ECHO ────────────────────────────────────────────────────────────────────────────
// STRUCTURAL, never a body regex. The first version matched /\b518210\b/ over the whole response,
// which also matches inside a decimal such as a latitude ("39.518210"), so its 54 was a lead, not a
// count. This walks the JSON and reads ONLY values sitting under a key whose name says NAICS, and
// separately proves the facility itself is in the answer (its registry id appears as a value).
export function naicsFromEcho(json, registryId) {
  const paths = new Set(); const codes = new Set(); let idSeen = false;
  const walk = (v, path, underNaics) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, path + '[]', underNaics)); return; }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, path + '.' + k, underNaics || /naics/i.test(k));
      return;
    }
    const str = String(v);
    if (str.trim() === String(registryId)) idSeen = true;
    if (underNaics) {
      paths.add(path);
      for (const m of str.match(/(?<![0-9.])\d{6}(?![0-9.])/g) || []) codes.add(m);
    }
  };
  walk(json, '$', false);
  return { idSeen, naicsPaths: [...paths].sort(), naicsCodes: [...codes].sort() };
}

async function echoFacility(registryId) {
  const url = `https://echodata.epa.gov/echo/dfr_rest_services.get_dfr?output=JSON&p_id=${encodeURIComponent(registryId)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) return { status: res.status };
  let json; try { json = await res.json(); } catch { return { status: res.status, unparseable: true }; }
  return { status: res.status, ...naicsFromEcho(json, registryId) };
}

// ── OSM deletion check ──────────────────────────────────────────────────────────────────
// An element Overpass does not return is either DELETED (the OSM API history ends in
// visible=false) or something else; only the publisher's own history distinguishes them.
async function osmHistory(key) {
  const m = /^osm:(node|way|relation)\/(\d+)$/.exec(key);
  const res = await fetch(`https://api.openstreetmap.org/api/0.6/${m[1]}/${m[2]}/history.json`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return { status: res.status };
  const j = await res.json();
  const els = j.elements || [];
  const last = els[els.length - 1] || {};
  return { status: res.status, versions: els.length, lastVisible: last.visible, lastVersion: last.version, lastTimestamp: last.timestamp };
}

// ── permit portals (ArcGIS / Socrata) ───────────────────────────────────────────────────
// The key is minted by the SHIPPED connectors (sources/arcgis.ts:500, sources/socrata.ts:580):
//   arcgis:<registry_id>:<identity_fields | case_number | rowId | title>
//   socrata:<domain>:<dataset_id>:<identity_fields | case_number | rowId | title>
// The dataset is resolved through the COMMITTED registry, never guessed, and the record is
// asked for by the publisher's own case-number column. A segment that matches no case number
// may be a row id (unstable on ArcGIS) or a TITLE -- a HomeSignal-derived identity, not native.
export function parsePermitKey(key) {
  let m = /^arcgis:([^:]+):(.+)$/.exec(key);
  if (m) return { platform: 'arcgis', registryId: m[1], seg: m[2] };
  m = /^socrata:([^:]+):([^:]+):(.+)$/.exec(key);
  if (m) return { platform: 'socrata', domain: m[1], datasetId: m[2], seg: m[3] };
  return null;
}

const cols = (c) => (c == null ? [] : Array.isArray(c) ? c : [c]);
const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const DC_TYPE = /data[^a-z]{0,3}(cent|hall)|hyperscale|server[^a-z]{0,3}farm/i;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) return { status: res.status };
  try { return { status: res.status, json: await res.json() }; } catch { return { status: res.status, unparseable: true }; }
}

async function probePermit(p, entry, layerMeta) {
  const cm = entry.column_map || {};
  const idf = entry.identity_fields;
  let where = null; let basis = null;
  if (idf && idf.length) {
    const parts = p.seg.split('|');
    if (parts.length === idf.length) { where = idf.map((f, i) => `${f}=${sqlLit(parts[i])}`).join(' AND '); basis = 'identity_fields'; }
  }
  const tries = where ? [[basis, where]] : cols(cm.case_number).map((c) => ['case_number', `${c}=${sqlLit(p.seg)}`]);
  if (/^\d+$/.test(p.seg)) tries.push(['row_id', p.platform === 'arcgis' ? `OBJECTID=${p.seg}` : `:id=${sqlLit(p.seg)}`]);
  for (const [b, w] of tries) {
    let r;
    if (p.platform === 'arcgis') {
      r = await getJson(`${entry.service_url}/query?where=${encodeURIComponent(w)}&outFields=*&returnGeometry=false&f=json`);
      const feats = r.json && r.json.features;
      if (r.json && r.json.error) return { outcome: 'QUERY_ERROR', detail: `${r.json.error.code} ${r.json.error.message || ''} ${(r.json.error.details || []).join(' ')}`.trim(), where: w };
      if (feats && feats.length) {
        const a = feats[0].attributes || {};
        const tsField = layerMeta && layerMeta.editFieldsInfo && layerMeta.editFieldsInfo.editDateField;
        return { outcome: 'PRESENT', basis: b, n: feats.length,
          typeValue: cols(cm.type_source).map((c) => a[c]).filter((x) => x != null).join(' | '),
          publisherTimestamp: tsField ? a[tsField] != null : false, version: false };
      }
    } else {
      r = await getJson(`https://${p.domain}/resource/${p.datasetId}.json?$select=${encodeURIComponent(':*,*')}&$where=${encodeURIComponent(w)}`);
      if (Array.isArray(r.json) && r.json.length) {
        const a = r.json[0];
        return { outcome: 'PRESENT', basis: b, n: r.json.length,
          typeValue: cols(cm.type_source).map((c) => a[c]).filter((x) => x != null).join(' | '),
          publisherTimestamp: a[':updated_at'] != null, version: a[':version'] != null };
      }
    }
    if (r.status !== 200) return { outcome: 'HTTP_' + r.status };
    await sleep(400);
  }
  return { outcome: 'NOT_FOUND_BY_NATIVE_ID' };
}

async function main() {
  const ledger = await readLedger();
  console.log('ledger rows read (control) ......', ledger.length);
  const isResidentDC = await shippedClassifier();
  const summary = {};

  // PROBE_ONLY=permits re-asks only the permit publishers (no OSM/EPA load when diagnosing).
  const only = process.env.PROBE_ONLY || '';
  if (!only || only === 'osm') {
  // ── OSM: the RESIDENT population only (reachable). ──
  const osmReach = ledger.filter((r) => r.source_population === 'osm' && r.resident_reachable).map((r) => r.record_key).sort();
  console.log('OSM resident-reachable keys .....', osmReach.length, md5(osmReach.join(',')));
  const ov = await overpass(osmIdLists(osmReach));
  const osm = classifyOsm(osmReach, ov.elements || []);
  console.log('OSM osm_base (publisher dataset time) ....', ov.osm3s && ov.osm3s.timestamp_osm_base);
  console.log('OSM tally', JSON.stringify(osm.tally));
  console.log('OSM verdict fingerprint .........', md5(Object.entries(osm.per).map(([k, v]) => `${k}=${v}`).sort().join(',')));
  const absent = Object.entries(osm.per).filter(([, v]) => v === 'ABSENT_TODAY').map(([k]) => k).sort();
  const hist = { asked: 0, deleted: 0, visible_but_absent: 0, http_fail: 0 };
  for (const k of absent) {
    hist.asked++;
    const h = await osmHistory(k);
    if (h.status !== 200) hist.http_fail++;
    else if (h.lastVisible === false) hist.deleted++;
    else hist.visible_but_absent++;
    await sleep(1000);
  }
  console.log('OSM absent-today history', JSON.stringify(hist));
  summary.osm = { records: osmReach.length, ...osm.tally, history: hist };
  }

  // ── Legacy: which resident records are DC by a PUBLISHER field vs only by NAME. ──
  const legacy = ledger.filter((r) => r.source_population !== 'osm');
  const basis = { facility: { total: 0 }, development: { total: 0 } };
  const epaIds = []; const permits = [];
  for (const r of legacy) {
    const v = isResidentDC(r);
    if (!v.dc) continue;
    const kind = r.source_population === 'legacy_facility' ? 'facility' : 'development';
    basis[kind].total++;
    const inputs = r.classifier_inputs || [];
    const byTypeRaw = inputs.some((i) => i.type_raw && DC_TYPE.test(i.type_raw));
    const byType = inputs.some((i) => i.type && (DC_TYPE.test(i.type) || /^data-?center$/i.test(i.type)));
    const byName = inputs.some((i) => i.name && DC_TYPE.test(i.name));
    const label = kind === 'facility'
      ? (byName ? 'type_stamped_by_homesignal_from_NAME' : 'type_only')
      : (byTypeRaw ? 'publisher_field_type_raw' : byType ? 'homesignal_bucket_type' : byName ? 'NAME_only' : 'other');
    basis[kind][label] = (basis[kind][label] || 0) + 1;
    if (kind === 'facility') epaIds.push(r.record_key.replace(/^epa_frs:/, ''));
    else permits.push({ key: r.record_key, storedTypeRawDC: byTypeRaw });
  }
  console.log('legacy DC basis', JSON.stringify(basis));

  if (!only || only === 'epa') {
  // ── EPA: ask the publisher about every resident facility, politely. ──
  const epa = { asked: 0, http_ok: 0, http_fail: 0, unparseable: 0, facility_present: 0, facility_absent: 0,
    with_naics_field: 0, naics_518210: 0, naics_other_only: 0, naics_field_empty: 0 };
  const naicsPaths = new Set(); const failures = {};
  for (const id of epaIds.sort()) {
    epa.asked++;
    try {
      const f = await echoFacility(id);
      if (f.status !== 200) { epa.http_fail++; failures[f.status] = (failures[f.status] || 0) + 1; }
      else if (f.unparseable) epa.unparseable++;
      else {
        epa.http_ok++;
        if (f.idSeen) epa.facility_present++; else epa.facility_absent++;
        f.naicsPaths.forEach((x) => naicsPaths.add(x));
        if (f.naicsPaths.length) epa.with_naics_field++;
        if (f.naicsCodes.includes('518210')) epa.naics_518210++;
        else if (f.naicsCodes.length) epa.naics_other_only++;
        else epa.naics_field_empty++;
      }
    } catch (e) { epa.http_fail++; failures[e.name] = (failures[e.name] || 0) + 1; }
    await sleep(1200);
  }
  console.log('EPA NAICS key paths', JSON.stringify([...naicsPaths].slice(0, 12)));
  console.log('EPA ECHO tally', JSON.stringify(epa), 'failures', JSON.stringify(failures));
  summary.epa = epa;
  }

  // ── Permits: resolve through the committed registry and ask for the exact record. ──
  const { readFileSync } = await import('node:fs');
  const reg = JSON.parse(readFileSync(new URL('../supabase/functions/get-address-report/jurisdiction-registry.json', import.meta.url), 'utf8'));
  const permitTally = {};
  const layerMetaCache = new Map();
  for (const pr of permits.sort((x, y) => (x.key < y.key ? -1 : 1))) {
    const p = parsePermitKey(pr.key);
    const cohort = p ? p.platform : 'unparsed';
    const t = (permitTally[cohort] ||= { records: 0, registry_unresolved: 0, present: 0, not_found_by_native_id: 0,
      http_or_query_error: 0, basis: {}, stored_type_raw_dc: 0, live_type_dc: 0, publisher_timestamp: 0, version: 0 });
    t.records++;
    if (pr.storedTypeRawDC) t.stored_type_raw_dc++;
    if (!p) { t.registry_unresolved++; continue; }
    const entry = p.platform === 'arcgis'
      ? reg.arcgis.find((e) => e.registry_id === p.registryId)
      : reg.socrata.find((e) => e.domain === p.domain && e.dataset_id === p.datasetId);
    if (!entry) { t.registry_unresolved++; continue; }
    let meta = null;
    if (p.platform === 'arcgis') {
      if (!layerMetaCache.has(entry.service_url)) layerMetaCache.set(entry.service_url, (await getJson(`${entry.service_url}?f=json`)).json || null);
      meta = layerMetaCache.get(entry.service_url);
    }
    let r;
    try { r = await probePermit(p, entry, meta); } catch (e) { r = { outcome: 'FETCH_' + e.name }; }
    if (r.outcome === 'PRESENT') {
      t.present++; t.basis[r.basis] = (t.basis[r.basis] || 0) + 1;
      if (DC_TYPE.test(r.typeValue || '')) t.live_type_dc++;
      if (r.publisherTimestamp) t.publisher_timestamp++;
      if (r.version) t.version++;
    } else if (r.outcome === 'NOT_FOUND_BY_NATIVE_ID') t.not_found_by_native_id++;
    else {
      t.http_or_query_error++; t.errors = t.errors || {}; t.errors[r.outcome] = (t.errors[r.outcome] || 0) + 1;
      // Named, so an error is diagnosable rather than a count: registry entry, the where clause, the publisher's message.
      console.log('  PERMIT ERROR', JSON.stringify({ key: pr.key, outcome: r.outcome, detail: r.detail, where: r.where, service: entry.service_url || entry.domain }));
    }
    await sleep(600);
  }
  console.log('PERMIT tally', JSON.stringify(permitTally));
  summary.permits = permitTally;

  // Repeated at the END so it survives a byte-capped log tail (the receipt channel).
  console.log('\n===== STEP 3C PROBE SUMMARY =====');
  console.log(JSON.stringify(summary));
  console.log('PROBE COMPLETE -- nothing was written.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('REFUSED: ' + e.message); process.exit(1); });
}
