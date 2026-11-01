// TEMPORARY, read-only: verifies the 3101 Western Ave sample report's sources from a runner (which has egress).
// Census geocode, each official link, the agency's own record (status, coordinates), and each dataset's own metadata.
// Prints everything to the job log. Writes nothing. Removed before merge.
import { readFileSync } from 'node:fs';
const T = JSON.parse(readFileSync(new URL('./western-targets.json', import.meta.url)));
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; JODY-source-verify/1.0)' };
async function get(url, opts = {}) {
  const t0 = Date.now();
  try { const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(30000), ...opts }); const body = await r.text(); return { status: r.status, url: r.url, body, ms: Date.now() - t0 }; }
  catch (e) { return { status: 0, error: String(e).slice(0, 200), body: '', ms: Date.now() - t0 }; }
}
const out = (k, v) => console.log(k + ' ' + JSON.stringify(v));
// 1. geocode, exactly the request geocode-address makes
const CENSUS = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?benchmark=Public_AR_Current&vintage=Current_Current&layers=Incorporated%20Places&format=json&address=';
for (const a of ['3101 Western Ave, Seattle, WA 98121']) {
  const g = await get(CENSUS + encodeURIComponent(a));
  try { const m = JSON.parse(g.body).result.addressMatches; out('GEOCODE', { a, n: m.length, matches: m.map((x) => ({ addr: x.matchedAddress, lat: x.coordinates.y, lng: x.coordinates.x, side: x.tigerLine && x.tigerLine.side })) }); }
  catch { out('GEOCODE_FAIL', { a, status: g.status, err: g.error, head: g.body.slice(0, 200) }); }
}
// 2. dataset metadata (Socrata views API)
for (const [host, id] of [['data.seattle.gov', '76t5-zqzr'], ['data.seattle.gov', 'ht3q-kdvx'], ['data.wa.gov', 'mmcb-z6jf']]) {
  const m = await get(`https://${host}/api/views/${id}.json`);
  try { const j = JSON.parse(m.body); out('DATASET', { host, id, name: j.name, attribution: j.attribution, attributionLink: j.attributionLink, owner: j.owner && j.owner.displayName, agency: (j.metadata && j.metadata.custom_fields) || null, rowsUpdatedAt: j.rowsUpdatedAt ? new Date(j.rowsUpdatedAt * 1000).toISOString() : null, columns: (j.columns || []).map((c) => c.fieldName) }); }
  catch { out('DATASET_FAIL', { host, id, status: m.status, err: m.error }); }
}
// 3. the agency's own rows
const ids = (ds) => T.filter((t) => t.ds === ds).map((t) => t.id);
const q = async (host, ds, col, list) => {
  const where = col + ' in(' + list.map((s) => "'" + s + "'").join(',') + ')';
  const r = await get(`https://${host}/resource/${ds}.json?$limit=500&$where=` + encodeURIComponent(where));
  try { return JSON.parse(r.body); } catch { out('ROWS_FAIL', { ds, status: r.status, head: r.body.slice(0, 300) }); return []; }
};
for (const [host, ds, col] of [['data.seattle.gov', '76t5-zqzr', 'permitnum'], ['data.seattle.gov', 'ht3q-kdvx', 'permitnum']]) {
  const rows = await q(host, ds, col, ids(ds));
  out('ROWCOUNT', { ds, asked: ids(ds).length, got: rows.length });
  for (const r of rows) out('ROW', { ds, id: r.permitnum, statuscurrent: r.statuscurrent, applieddate: r.applieddate, issueddate: r.issueddate, address: r.originaladdress1, lat: r.latitude, lng: r.longitude, link: r.link && r.link.url ? r.link.url : r.link, desc_len: (r.description || '').length, description: r.description });
}
{
  const rows = await q('data.wa.gov', 'mmcb-z6jf', 'sepanumber', ids('mmcb-z6jf'));
  out('ROWCOUNT', { ds: 'mmcb-z6jf', asked: ids('mmcb-z6jf').length, got: rows.length });
  for (const r of rows) out('SEPA', r);
}
// 4. each official link
for (const t of T) {
  const r = await get(t.url);
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(r.body) || [])[1];
  out('LINK', { id: t.id, status: r.status, final: r.url, ms: r.ms, bytes: r.body.length, title: title ? title.replace(/\s+/g, ' ').trim().slice(0, 120) : null, id_in_body: r.body.includes(t.id), err: r.error });
}
console.log('DONE');
