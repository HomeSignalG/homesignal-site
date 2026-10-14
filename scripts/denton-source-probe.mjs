#!/usr/bin/env node
// Denton Step 6 source probe. READ-ONLY, GET only, no login, no forms, no auth bypass.
// Honest UA, robots.txt checked per host (a Disallow match skips the fetch and says so),
// polite delay between requests, hard internal deadline. Output = job log only.
const UA = 'HomeSignal-source-probe/1.0 (+https://homesignal.net; read-only verification of public government sources; hello@homesignal.net)';
const DELAY_MS = 1500, TIMEOUT_MS = 25000, DEADLINE_MS = 13 * 60 * 1000;
const T0 = Date.now(), NOW = new Date(), D365 = new Date(NOW - 365 * 864e5);
const iso = (d) => d.toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { generated_at: NOW.toISOString(), ua: UA, portals: {}, arcgis: { hosts: {}, ago_items: [], layers: [] } };
let last = 0, nreq = 0;
const robots = new Map();
const timeUp = () => Date.now() - T0 > DEADLINE_MS;

function parseRobots(txt) {
  const groups = []; let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.replace(/#.*/, '').trim(); if (!l) continue;
    const m = l.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if ((k === 'disallow' || k === 'allow') && cur) cur.rules.push([k, v]);
  }
  return groups;
}
function allowed(groups, path) {
  const g = groups.find((x) => x.agents.some((a) => a && a !== '*' && 'homesignal-source-probe'.includes(a))) || groups.find((x) => x.agents.includes('*'));
  if (!g) return true;
  let best = null;
  for (const [k, v] of g.rules) {
    if (!v) continue;
    const re = new RegExp('^' + v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || v.length > best[1].length)) best = [k, v];
  }
  return !best || best[0] === 'allow';
}
async function raw(url, opts = {}) {
  const wait = DELAY_MS - (Date.now() - last); if (wait > 0) await sleep(wait);
  last = Date.now(); nreq++;
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: opts.accept || '*/*' }, redirect: 'follow', signal: ac.signal });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ctype: r.headers.get('content-type') || '', finalUrl: r.url, bytes: buf.length, text: buf.toString('utf8', 0, Math.min(buf.length, 3000000)) };
  } catch (e) { return { status: 0, error: String((e.cause && (e.cause.code || e.cause.message)) || e.message), text: '', bytes: 0 }; }
  finally { clearTimeout(t); }
}
async function robotsFor(u) {
  const o = new URL(u);
  if (!robots.has(o.origin)) {
    const r = await raw(o.origin + '/robots.txt');
    const ok = r.status === 200 && !/<html/i.test(r.text.slice(0, 300));
    const rec = { status: r.status, groups: ok ? parseRobots(r.text) : [], snippet: r.status === 200 ? r.text.slice(0, 400).replace(/\s+/g, ' ') : '' };
    robots.set(o.origin, rec);
    console.log(`ROBOTS ${o.origin} -> HTTP ${r.status}${r.error ? ' ' + r.error : ''} groups=${rec.groups.length} :: ${rec.snippet.slice(0, 220)}`);
  }
  return robots.get(o.origin);
}
async function get(url, opts) {
  const o = new URL(url); const rb = await robotsFor(url);
  if (!allowed(rb.groups, o.pathname + o.search)) { console.log(`SKIP robots-disallow ${url}`); return { status: -1, robotsDisallowed: true, text: '', bytes: 0 }; }
  return raw(url, opts);
}
const jget = async (url) => { const r = await get(url, { accept: 'application/json' }); try { r.json = JSON.parse(r.text); } catch { r.json = null; } return r; };

// ---------- portals 1-5 : landing page + robots + terms only; no forms, no search POSTs ----------
const PORTALS = [
  ['1_denton_county_civic_access', 'https://dentoncountytx-energovweb.tylerhost.net/apps/SelfService'],
  ['2_city_of_denton_etrakit', 'https://dntn-trk.aspgov.com/eTRAKiT/'],
  ['3_little_elm_development_portal', 'https://www.littleelm.gov/1428/Development-Portal'],
  ['4_argyle_community_development', 'https://argyletx.com/150/Community-Development'],
  ['5_sanger_development_services', 'https://www.sangertexas.org/165/Development-Services'],
];
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
async function probePortal(key, url) {
  const rec = { url }; out.portals[key] = rec;
  const r = await get(url); rec.status = r.status; rec.final_url = r.finalUrl; rec.ctype = r.ctype; rec.bytes = r.bytes; rec.error = r.error; rec.robots_disallowed = !!r.robotsDisallowed;
  const rb = robots.get(new URL(url).origin); rec.robots_status = rb && rb.status; rec.robots_snippet = rb && rb.snippet;
  if (r.status === 200) {
    const html = r.text, txt = strip(html);
    rec.title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
    rec.signals = {
      captcha: /recaptcha|hcaptcha|captcha/i.test(html), login_wall: /(sign in|log ?in) (to|required)|please (sign|log) ?in/i.test(txt),
      spa_shell: /<app-root|ng-app|id="root"|__NEXT_DATA__|angular/i.test(html) && txt.length < 1500,
      mentions_open_data: /open ?data|data portal|arcgis|gis (data|map)|download.{0,30}(csv|data)|export/i.test(txt),
      mentions_permit_search: /permit|inspection|plan review|application|case search|search (for )?(permits|records)/i.test(txt),
    };
    const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => [m[1], strip(m[2]).trim().slice(0, 80)]);
    const abs = (h) => { try { return new URL(h, r.finalUrl || url).href; } catch { return null; } };
    rec.interesting_links = links.filter(([h, t]) => /permit|plat|zoning|planning|gis|map|data|report|inspect|energov|etrakit|portal|agenda|development|subdivision|site.?plan|terms|disclaimer|privacy|api/i.test(h + ' ' + t)).map(([h, t]) => [abs(h), t]).filter((x) => x[0]).slice(0, 40);
    const terms = rec.interesting_links.find(([h, t]) => /terms|disclaimer|legal|acceptable/i.test(h + ' ' + t));
    if (terms && new URL(terms[0]).origin === new URL(url).origin) {
      const tr = await get(terms[0]); const tt = strip(tr.text);
      rec.terms = { url: terms[0], status: tr.status, automated_access_mentions: [...tt.matchAll(/.{0,120}\b(scrap\w*|crawl\w*|robot\w*|automated|bot|spider|harvest\w*|bulk)\b.{0,160}/gi)].slice(0, 5).map((m) => m[0].trim()) };
    } else rec.terms = { note: 'no same-origin terms/disclaimer link found on landing page' };
    rec.text_sample = txt.slice(0, 500);
  }
  console.log(`PORTAL ${key} HTTP ${rec.status} ${rec.error || ''} final=${rec.final_url} title=${JSON.stringify(rec.title)} signals=${JSON.stringify(rec.signals)}`);
  console.log(`  terms=${JSON.stringify(rec.terms)}`);
  console.log(`  links=${JSON.stringify((rec.interesting_links || []).slice(0, 15))}`);
  console.log(`  text=${JSON.stringify(rec.text_sample)}`);
}

// ---------- 6 : ArcGIS ----------
const DEN_BBOX = [-97.4, 32.9, -96.8, 33.45];
const TOWNS = ['denton county', 'city of denton', 'lewisville', 'flower mound', 'frisco', 'the colony', 'little elm', 'argyle', 'sanger', 'corinth', 'lake dallas', 'highland village', 'prosper', 'aubrey', 'pilot point', 'krum', 'justin', 'northlake', 'trophy club', 'roanoke', 'ponder', 'denton, tx', 'denton tx', 'bartonville', 'copper canyon', 'double oak', 'hickory creek', 'shady shores', 'oak point', 'providence village', 'cross roads', 'celina'];
const REL = /permit|plat|zon|site ?plan|development|subdivision|planning|case|building|inspection|project|construction|land ?use|annex|variance|rezon/i;
const NOISE = /septic|ossf|floodplain|utility|water|sewer|sign|hydrant|address point|centerline|precinct|election|voting|school district/i;
const SEED_HOSTS = [
  'https://gis.dentoncounty.gov/arcgis/rest/services', 'https://maps.friscotexas.gov/gis/rest/services',
  'https://gis.cityofdenton.com/arcgis/rest/services', 'https://maps.cityofdenton.com/arcgis/rest/services',
  'https://gis.cityoflewisville.com/arcgis/rest/services', 'https://maps.cityoflewisville.com/arcgis/rest/services',
  'https://gis.flower-mound.com/arcgis/rest/services', 'https://gis.littleelm.gov/arcgis/rest/services',
  'https://gis.thecolonytx.gov/arcgis/rest/services', 'https://gis.highlandvillage.org/arcgis/rest/services',
];
async function listServices(base, folder = '', depth = 0) {
  const url = `${base}${folder ? '/' + folder : ''}?f=json`;
  const r = await jget(url);
  if (!r.json || r.json.error) return { err: r.status + (r.json && r.json.error ? ' ' + JSON.stringify(r.json.error).slice(0, 120) : r.error ? ' ' + r.error : ''), services: [] };
  let services = (r.json.services || []).map((s) => ({ name: s.name, type: s.type, base }));
  if (depth < 2 && !timeUp()) for (const f of r.json.folders || []) { if (/^(utilities|system|hosted)$/i.test(f)) continue; const sub = await listServices(base, folder ? folder + '/' + f : f, depth + 1); services = services.concat(sub.services); }
  return { services, version: r.json.currentVersion };
}
const dateFields = (fields) => fields.filter((f) => f.type === 'esriFieldTypeDate' || f.type === 'esriFieldTypeDateOnly');
const errTxt = (x) => `ERR ${x.json && x.json.error ? JSON.stringify(x.json.error).slice(0, 90) : x.status}`;
async function probeLayer(layerUrl, label, orgName) {
  if (timeUp()) return;
  const m = await jget(layerUrl + '?f=json'); const j = m.json;
  if (!j || j.error || !j.fields) { out.arcgis.layers.push({ layer_url: layerUrl, label, status: m.status, error: j && j.error ? JSON.stringify(j.error).slice(0, 160) : m.error || 'no fields' }); console.log(`LAYER-ERR ${layerUrl} ${m.status} ${j && j.error ? JSON.stringify(j.error).slice(0, 100) : ''}`); return; }
  const fields = j.fields, dates = dateFields(fields);
  const strDates = fields.filter((f) => f.type === 'esriFieldTypeString' && /date|issue|receiv|filed|applic|submit|approv|final/i.test(f.name + f.alias));
  const idf = fields.filter((f) => /permit.?(no|num|id)|case.?(no|num|id)|project.?(no|num|id)|app.?(no|num|id)|record.?(no|id)|^id$|number|plat.?(no|id)/i.test(f.name)).map((f) => f.name);
  const urlf = fields.filter((f) => /url|link|hyper|web|href/i.test(f.name + f.alias)).map((f) => f.name);
  const ai = j.advancedQueryCapabilities || {};
  const rec = { layer_url: layerUrl, name: j.name, label, org: orgName, geometryType: j.geometryType, capabilities: j.capabilities, maxRecordCount: j.maxRecordCount, supportsPagination: ai.supportsPagination, supportsStatistics: ai.supportsStatistics, objectIdField: j.objectIdField, id_like_fields: idf, url_like_fields: urlf, date_fields: dates.map((f) => f.name), string_date_candidates: strDates.map((f) => f.name), lastEditDate: j.editingInfo && j.editingInfo.lastEditDate ? iso(new Date(j.editingInfo.lastEditDate)) : undefined, description: (j.description || '').slice(0, 200), copyright: (j.copyrightText || '').slice(0, 160), fieldNames: fields.map((f) => f.name).slice(0, 60) };
  const q = (p) => jget(`${layerUrl}/query?${new URLSearchParams({ f: 'json', ...p })}`);
  const tot = await q({ where: '1=1', returnCountOnly: 'true' });
  rec.total_count = tot.json && tot.json.count != null ? tot.json.count : errTxt(tot);
  rec.by_date = {};
  for (const f of dates.slice(0, 4)) {
    const d = {};
    const st = await q({ where: '1=1', outStatistics: JSON.stringify([{ statisticType: 'max', onStatisticField: f.name, outStatisticFieldName: 'mx' }, { statisticType: 'min', onStatisticField: f.name, outStatisticFieldName: 'mn' }]) });
    const a = st.json && st.json.features && st.json.features[0] && st.json.features[0].attributes;
    if (a && a.mx != null) { d.max = iso(new Date(a.mx)); d.min = a.mn != null ? iso(new Date(a.mn)) : null; }
    else {
      const o = await q({ where: `${f.name} IS NOT NULL`, outFields: f.name, orderByFields: `${f.name} DESC`, resultRecordCount: '1', returnGeometry: 'false' });
      const v = o.json && o.json.features && o.json.features[0] && o.json.features[0].attributes[f.name];
      d.max = v != null ? iso(new Date(v)) : errTxt(st); d.max_via = 'orderBy';
    }
    const c = await q({ where: `${f.name} >= DATE '${iso(D365)}'`, returnCountOnly: 'true' });
    d.count_last_365d = c.json && c.json.count != null ? c.json.count : errTxt(c);
    rec.by_date[f.name] = d;
  }
  const s = await q({ where: '1=1', outFields: '*', resultRecordCount: '1', returnGeometry: 'false', ...(j.objectIdField ? { orderByFields: `${j.objectIdField} DESC` } : {}) });
  const sa = s.json && s.json.features && s.json.features[0] && s.json.features[0].attributes;
  if (sa) {
    rec.sample_newest_oid = {};
    for (const k of [...(j.objectIdField ? [j.objectIdField] : []), ...idf, ...urlf, ...strDates.map((f) => f.name), ...dates.map((f) => f.name)].slice(0, 14)) rec.sample_newest_oid[k] = dates.some((f) => f.name === k) && sa[k] ? iso(new Date(sa[k])) : sa[k];
  }
  out.arcgis.layers.push(rec);
  const bd = Object.entries(rec.by_date).map(([k, v]) => `${k}: max=${v.max} min=${v.min} n365=${v.count_last_365d}`).join(' | ');
  console.log(`LAYER ${layerUrl} "${j.name}" geom=${j.geometryType} total=${rec.total_count} pag=${rec.supportsPagination} stats=${rec.supportsStatistics} oid=${j.objectIdField} ids=${idf.join(',')} urls=${urlf.join(',')} strDates=${strDates.map((f) => f.name).join(',')} :: ${bd}`);
  if (rec.sample_newest_oid) console.log(`  sample=${JSON.stringify(rec.sample_newest_oid).slice(0, 400)}`);
}
async function probeService(svc, orgName) {
  const base = `${svc.base}/${svc.name}/${svc.type}`;
  const m = await jget(base + '?f=json');
  if (!m.json || m.json.error) { console.log(`SVC-ERR ${base} ${m.status} ${m.json && m.json.error ? JSON.stringify(m.json.error).slice(0, 100) : ''}`); return; }
  const layers = (m.json.layers || []).concat(m.json.tables || []);
  for (const l of layers) {
    if (timeUp()) return;
    const nm = `${svc.name} / ${l.name}`;
    if (!REL.test(nm) || (NOISE.test(nm) && !/permit|plat|zon|site ?plan|development|subdivision|planning/i.test(nm))) { out.arcgis.layers.push({ layer_url: `${base}/${l.id}`, name: l.name, skipped: 'name not permit/plat/zoning/planning-like' }); continue; }
    await probeLayer(`${base}/${l.id}`, nm, orgName);
  }
}

async function main() {
  for (const [k, u] of PORTALS) { if (timeUp()) break; await probePortal(k, u); }
  console.log('=== ARCGIS REST DIRECTORIES ===');
  const seen = new Set();
  for (const base of SEED_HOSTS) {
    if (timeUp()) break;
    const L = await listServices(base);
    out.arcgis.hosts[base] = { err: L.err, n_services: L.services.length, version: L.version, names: L.services.map((s) => `${s.name}/${s.type}`).slice(0, 150) };
    console.log(`HOST ${base} -> ${L.err ? 'ERR ' + L.err : L.services.length + ' services (v' + L.version + ')'}`);
    if (L.err) continue;
    console.log(`  services: ${L.services.map((s) => s.name + '/' + s.type).join(', ').slice(0, 1500)}`);
    for (const s of L.services) {
      if (timeUp()) break;
      if (!/MapServer|FeatureServer/.test(s.type)) continue;
      if (!REL.test(s.name) && !/dev|permit|plan|zon|plat/i.test(s.name)) continue;
      const key = s.base + s.name + s.type; if (seen.has(key)) continue; seen.add(key);
      await probeService(s, base);
    }
  }
  console.log('=== ARCGIS ONLINE ITEM SEARCH (Denton-area, extent/name-filtered) ===');
  const qs = ['Denton County permits', 'Denton County plats', 'Denton County development', 'City of Denton permits', 'Lewisville permits', 'Flower Mound permits', 'Little Elm permits', 'The Colony permits', 'Corinth Highland Village Lake Dallas permits', 'Argyle Sanger Aubrey Pilot Point development', 'Denton zoning cases', 'Denton site plan subdivision', 'Frisco Prosper Celina permits', 'Trophy Club Northlake Roanoke Justin permits'];
  const items = new Map(); const orgCache = new Map();
  for (const q of qs) {
    if (timeUp()) break;
    const r = await jget(`https://www.arcgis.com/sharing/rest/search?${new URLSearchParams({ f: 'json', num: '60', sortField: 'modified', sortOrder: 'desc', q: `(${q}) AND (type:"Feature Service" OR type:"Map Service")` })}`);
    const res = r.json && r.json.results; console.log(`AGO q=${JSON.stringify(q)} -> HTTP ${r.status} ${res ? res.length + ' results' : 'none ' + (r.error || '')}`);
    for (const it of res || []) {
      const ex = it.extent;
      const inBox = ex && ex[0] && ex[1] && ex[0][0] < DEN_BBOX[2] && ex[1][0] > DEN_BBOX[0] && ex[0][1] < DEN_BBOX[3] && ex[1][1] > DEN_BBOX[1] && (ex[1][0] - ex[0][0]) < 3;
      const hay = `${it.title} ${it.snippet} ${(it.tags || []).join(' ')} ${it.owner} ${it.accessInformation}`.toLowerCase();
      if (!(inBox || TOWNS.some((t) => hay.includes(t)))) continue;
      if (!REL.test(`${it.title} ${(it.tags || []).join(' ')}`)) continue;
      items.set(it.id, it);
    }
  }
  for (const it of items.values()) {
    let org = orgCache.get(it.orgId);
    if (org === undefined && it.orgId && !timeUp()) { const p = await jget(`https://www.arcgis.com/sharing/rest/portals/${it.orgId}?f=json`); org = (p.json && p.json.name) || null; orgCache.set(it.orgId, org); }
    out.arcgis.ago_items.push({ id: it.id, title: it.title, owner: it.owner, orgId: it.orgId, org, type: it.type, url: it.url, modified: it.modified ? iso(new Date(it.modified)) : null, snippet: (it.snippet || '').slice(0, 120) });
    console.log(`AGO-ITEM "${it.title}" owner=${it.owner} org=${JSON.stringify(org)} modified=${it.modified ? iso(new Date(it.modified)) : '?'} url=${it.url}`);
  }
  let n = 0;
  for (const it of [...items.values()].sort((a, b) => b.modified - a.modified)) {
    if (timeUp() || n >= 25 || !it.url) continue;
    const m = it.url.match(/^(.*\/rest\/services)\/(.+?)\/(FeatureServer|MapServer)(\/\d+)?$/); if (!m) continue;
    const key = m[1] + m[2] + m[3]; if (seen.has(key)) continue; seen.add(key); n++;
    const org = orgCache.get(it.orgId) || it.owner;
    if (m[4]) await probeLayer(it.url, it.title, org); else await probeService({ base: m[1], name: m[2], type: m[3] }, org);
  }
  console.log(`DONE requests=${nreq} elapsed_s=${Math.round((Date.now() - T0) / 1000)} deadline_hit=${timeUp()}`);
  console.log('----- BEGIN DENTON PROBE JSON -----'); console.log(JSON.stringify(out)); console.log('----- END DENTON PROBE JSON -----');
}
main().catch((e) => { console.log('FATAL ' + e.stack); console.log('----- BEGIN DENTON PROBE JSON -----'); console.log(JSON.stringify(out)); console.log('----- END DENTON PROBE JSON -----'); process.exit(1); });
