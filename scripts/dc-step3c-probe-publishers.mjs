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
    const m = /^(node|way|relation)\/(\d+)$/.exec(k);
    if (!m) throw new Error(`not an OSM element key: ${k}`);
    out[m[1]].push(m[2]);
  }
  return out;
}

export function classifyOsm(requestedKeys, elements) {
  const got = new Map(elements.map((e) => [`${e.type}/${e.id}`, e]));
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
  const q = `[out:json][timeout:180];(${parts.join('')});out meta center tags;`;
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
async function echoFacility(registryId) {
  const url = `https://echodata.epa.gov/echo/dfr_rest_services.get_dfr?output=JSON&p_id=${encodeURIComponent(registryId)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) return { status: res.status };
  const body = await res.text();
  const naics = [...new Set((body.match(/\b\d{6}\b(?=[^0-9])/g) || []).filter((c) => /^(5182|5415|5191|2211|5171|5179)/.test(c)))];
  const hasNaicsBlock = /NAICS/i.test(body);
  return { status: res.status, bytes: body.length, naicsBlock: hasNaicsBlock, naics518210: /\b518210\b/.test(body), relevantCodes: naics };
}

async function main() {
  const ledger = await readLedger();
  console.log('ledger rows read (control) ......', ledger.length);
  const isResidentDC = await shippedClassifier();

  // OSM: the RESIDENT population only (reachable), plus the full table as a control.
  const osmReach = ledger.filter((r) => r.source_population === 'osm' && r.resident_reachable).map((r) => r.record_key).sort();
  console.log('OSM resident-reachable keys .....', osmReach.length, md5(osmReach.join(',')));
  const ov = await overpass(osmIdLists(osmReach));
  const osm = classifyOsm(osmReach, ov.elements || []);
  console.log('OSM osm_base (publisher dataset time) ....', ov.osm3s && ov.osm3s.timestamp_osm_base);
  console.log('OSM tally', JSON.stringify(osm.tally));
  const vf = Object.entries(osm.per).map(([k, v]) => `${k}=${v}`).sort().join(',');
  console.log('OSM verdict fingerprint .........', md5(vf));
  const sampleAbsent = Object.entries(osm.per).filter(([, v]) => v !== 'PRESENT_TAGGED_DATA_CENTER').slice(0, 12);
  console.log('OSM non-tagged sample', JSON.stringify(sampleAbsent));

  // Legacy: which resident records are a data centre by a PUBLISHER field vs only by NAME.
  const legacy = ledger.filter((r) => r.source_population !== 'osm');
  const basis = { facility: { total: 0 }, development: { total: 0 } };
  const epaIds = [];
  for (const r of legacy) {
    const v = isResidentDC(r);
    if (!v.dc) continue;
    const kind = r.source_population === 'legacy_facility' ? 'facility' : 'development';
    basis[kind].total++;
    const inputs = r.classifier_inputs || [];
    const DC = /data[^a-z]{0,3}(cent|hall)|hyperscale|server[^a-z]{0,3}farm/i;
    const byTypeRaw = inputs.some((i) => i.type_raw && DC.test(i.type_raw));
    const byType = inputs.some((i) => i.type && (DC.test(i.type) || /^data-?center$/i.test(i.type)));
    const byName = inputs.some((i) => i.name && DC.test(i.name));
    const label = kind === 'facility'
      ? (byName ? 'type_stamped_by_homesignal_from_NAME' : 'type_only')
      : (byTypeRaw ? 'publisher_field_type_raw' : byType ? 'homesignal_bucket_type' : byName ? 'NAME_only' : 'other');
    basis[kind][label] = (basis[kind][label] || 0) + 1;
    if (kind === 'facility') epaIds.push(r.record_key.replace(/^epa_frs:/, ''));
  }
  console.log('legacy DC basis', JSON.stringify(basis));

  // EPA: ask the publisher about every resident facility, politely (1 request / 1.2 s).
  const epa = { asked: 0, http_ok: 0, http_fail: 0, with_naics_block: 0, naics_518210: 0, other_relevant: 0 };
  const failures = {};
  for (const id of epaIds.sort()) {
    epa.asked++;
    try {
      const f = await echoFacility(id);
      if (f.status === 200) {
        epa.http_ok++;
        if (f.naicsBlock) epa.with_naics_block++;
        if (f.naics518210) epa.naics_518210++;
        else if (f.relevantCodes.length) epa.other_relevant++;
      } else { epa.http_fail++; failures[f.status] = (failures[f.status] || 0) + 1; }
    } catch (e) { epa.http_fail++; failures[e.name] = (failures[e.name] || 0) + 1; }
    await sleep(1200);
  }
  console.log('EPA ECHO tally', JSON.stringify(epa), 'failures', JSON.stringify(failures));
  console.log('\nPROBE COMPLETE -- nothing was written.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('REFUSED: ' + e.message); process.exit(1); });
}
