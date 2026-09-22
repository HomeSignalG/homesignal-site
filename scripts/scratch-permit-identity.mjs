// SCRATCH (never merge). Per-record permit identity for the Step 3C receipt, using the SHIPPED
// classifier and ledger reader copied verbatim from #1306's head. Makes NO publisher request.
import { readLedger, shippedClassifier } from './dc-step3c-reconcile.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const reg = JSON.parse(readFileSync(new URL('../supabase/functions/get-address-report/jurisdiction-registry.json', import.meta.url), 'utf8'));
const ledger = await readLedger();
const isDC = await shippedClassifier();
const dev = ledger.filter((r) => r.source_population === 'legacy_development');
const dc = dev.filter((r) => isDC(r).dc).sort((a, b) => (a.record_key < b.record_key ? -1 : 1));
console.log('ledger', ledger.length, 'dev', dev.length, 'dev DC (control: must be 92)', dc.length);
const DC_TYPE = /data[^a-z]{0,3}(cent|hall)|hyperscale|server[^a-z]{0,3}farm/i;
const groups = {};
const lines = [];
for (const r of dc) {
  const k = r.record_key;
  let m = /^arcgis:([^:]+):(.+)$/.exec(k), plat, ds, seg, entry;
  if (m) { plat = 'arcgis'; ds = m[1]; seg = m[2]; entry = reg.arcgis.find((e) => e.registry_id === ds); }
  else if ((m = /^socrata:([^:]+):([^:]+):(.+)$/.exec(k))) { plat = 'socrata'; ds = `${m[1]}/${m[2]}`; seg = m[3]; entry = reg.socrata.find((e) => e.domain === m[1] && e.dataset_id === m[2]); }
  else { plat = 'UNPARSED'; ds = '?'; seg = k; }
  const cm = (entry && entry.column_map) || {};
  const idCol = entry && entry.identity_fields ? `identity_fields(${entry.identity_fields.join('|')})` : `case_number(${[].concat(cm.case_number || []).join('|') || 'NONE'})`;
  const inputs = r.classifier_inputs || [];
  const nativeDC = inputs.some((i) => i.type_raw && DC_TYPE.test(i.type_raw));
  const g = (groups[`${plat}|${ds}`] ||= { publisher: entry ? entry.jurisdiction : '?', id_column: idCol, service: entry ? (entry.service_url || entry.dataset_url) : '?', n: 0, native_dc_type: 0, name_only: 0 });
  g.n++; nativeDC ? g.native_dc_type++ : g.name_only++;
  lines.push(`${k}\t${plat}\t${ds}\t${seg}\t${idCol}\t${nativeDC ? 'PUBLISHER_TYPE_DC' : 'HOMESIGNAL_NAME_ONLY'}\t${(inputs[0] && inputs[0].type_raw) || ''}`);
}
console.log('permit key fingerprint', dc.length, createHash('md5').update(dc.map((r) => r.record_key).join(',')).digest('hex'));
console.log('BY DATASET', JSON.stringify(groups));
console.log('----- PER RECORD (key, platform, dataset, native id value, id column, DC basis, publisher type) -----');
for (const l of lines) console.log(l);
