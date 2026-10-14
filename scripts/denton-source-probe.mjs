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

// ---------- FOCUS MODE (founder directive 2026-10-14): City of Denton pages -> backing ArcGIS, Frisco health, pointers ----------
const HEX = /\b[0-9a-f]{32}\b/g;
async function mineRefs(label, text, base, depth, seenIds, found) {
  const urls = new Set((text.match(/https?:\/\/[^"'\s<>\\)]+\/(?:Feature|Map)Server(?:\/\d+)?/gi) || []));
  for (const u of urls) found.layers.add(u);
  const frames = [...text.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => { try { return new URL(m[1], base).href; } catch { return null; } }).filter(Boolean);
  const arc = (text.match(/https?:\/\/[^"'\s<>\\)]*(?:arcgis\.com|maps\.cityofdenton|gis\.cityofdenton|cityofdenton\.com\/(?:maps|gis))[^"'\s<>\\)]*/gi) || []);
  console.log(`MINE ${label}: featureServer/MapServer urls=${[...urls].join(' ') || '-'} | iframes=${frames.join(' ') || '-'} | arcgis/map links=${[...new Set(arc)].slice(0, 12).join(' ') || '-'}`);
  for (const f of [...frames, ...arc]) { for (const m of f.matchAll(/(?:webmap|appid|id|layers)=([0-9a-f]{32})/gi)) found.ids.add(m[1]); }
  for (const id of (text.match(HEX) || [])) if (/arcgis|webmap|appid/i.test(text.slice(Math.max(0, text.indexOf(id) - 120), text.indexOf(id) + 40))) found.ids.add(id);
  if (depth < 1) for (const f of frames.filter((x) => !/youtube|vimeo|facebook|google\.com\/maps/i.test(x)).slice(0, 4)) { const r = await get(f); console.log(`  IFRAME ${f} -> HTTP ${r.status} ${r.bytes}B`); if (r.status === 200) await mineRefs('iframe ' + f, r.text, f, depth + 1, seenIds, found); }
}
async function walkItem(id, depth, found, seenIds) {
  if (seenIds.has(id) || depth > 3 || timeUp()) return; seenIds.add(id);
  const it = await jget(`https://www.arcgis.com/sharing/rest/content/items/${id}?f=json`);
  if (!it.json || it.json.error) { console.log(`ITEM ${id} -> ${it.status} ${it.json && it.json.error ? JSON.stringify(it.json.error).slice(0, 100) : ''}`); return; }
  const j = it.json; console.log(`ITEM ${id} type=${j.type} title=${JSON.stringify(j.title)} owner=${j.owner} org=${j.orgId} modified=${j.modified ? iso(new Date(j.modified)) : '?'} url=${j.url || '-'}`);
  found.items.push({ id, type: j.type, title: j.title, owner: j.owner, orgId: j.orgId, modified: j.modified ? iso(new Date(j.modified)) : null, url: j.url });
  if (j.url && /(Feature|Map)Server/i.test(j.url)) found.layers.add(j.url);
  const d = await jget(`https://www.arcgis.com/sharing/rest/content/items/${id}/data?f=json`);
  if (d.json && !d.json.error) {
    const t = JSON.stringify(d.json);
    for (const l of (d.json.operationalLayers || [])) { console.log(`  OPLAYER "${l.title}" ${l.layerType} ${l.url || '(itemId ' + l.itemId + ')'}`); if (l.url) found.layers.add(l.url); if (l.itemId) await walkItem(l.itemId, depth + 1, found, seenIds); }
    for (const u of (t.match(/https?:\/\/[^"'\s\\]+\/(?:Feature|Map)Server(?:\/\d+)?/gi) || [])) found.layers.add(u);
    if (j.type !== 'Web Map') for (const h of new Set(t.match(HEX) || [])) if (h !== id) await walkItem(h, depth + 1, found, seenIds);
  }
}
async function friscoHealth() {
  const base = 'https://maps.friscotexas.gov/gis/rest/services/Public/External_Planning_and_Zoning/MapServer/1';
  await probeLayer(base, 'frisco-active-building-permits (wired)', 'City of Frisco');
  const r = await jget(`${base}/query?${new URLSearchParams({ f: 'json', where: '1=1', outFields: 'Issued_Date,Permit_No,Type,Status,Address,Hyperlink', returnGeometry: 'false', resultRecordCount: '2000' })}`);
  const rows = ((r.json && r.json.features) || []).map((f) => f.attributes);
  const P = (s) => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])) : null; };
  const dated = rows.map((a) => ({ ...a, d: P(a.Issued_Date) })).filter((a) => a.d).sort((a, b) => b.d - a.d);
  const cnt = (y) => dated.filter((a) => a.d.getUTCFullYear() === y).length;
  const res = { rows: rows.length, exceededTransferLimit: !!(r.json && r.json.exceededTransferLimit), parsed_dates: dated.length, newest: dated[0] && iso(dated[0].d), oldest: dated.length && iso(dated[dated.length - 1].d), n2025: cnt(2025), n2026: cnt(2026), last365: dated.filter((a) => a.d >= D365).length, last90: dated.filter((a) => a.d >= new Date(NOW - 90 * 864e5)).length, statuses: [...new Set(rows.map((a) => a.Status))], types: Object.fromEntries([...new Set(rows.map((a) => a.Type))].map((t) => [t, rows.filter((a) => a.Type === t).length])), with_hyperlink: rows.filter((a) => a.Hyperlink).length, distinct_permit_no: new Set(rows.map((a) => a.Permit_No)).size, newest5: dated.slice(0, 5).map((a) => [iso(a.d), a.Permit_No, a.Type, a.Address, a.Hyperlink]) };
  out.frisco = res; console.log('FRISCO ' + JSON.stringify(res));
}
// City of Denton's own AGO org (Development Services GIS) -- found via public web search (discovery only), verified here.
const DENTON_AGO = 'https://services8.arcgis.com/OQPRCxZXJewOd2xW/ArcGIS/rest/services'; // candidate from web-search pointer; EYTIgi02HN6AuvRN was verified to be City of Pilot Point, NOT Denton
async function vocab(layerUrl) {
  const m = await jget(layerUrl + '?f=json'); if (!m.json || !m.json.fields) return;
  console.log(`FIELDS ${layerUrl}: ${m.json.fields.map((f) => f.name + ':' + f.type.replace('esriFieldType', '')).join(', ')}`);
  console.log(`  geom=${m.json.geometryType} oid=${m.json.objectIdField} maxRecordCount=${m.json.maxRecordCount} lastEdit=${m.json.editingInfo && m.json.editingInfo.lastEditDate ? iso(new Date(m.json.editingInfo.lastEditDate)) : '?'} desc=${JSON.stringify((m.json.description || '').slice(0, 300))} copyright=${JSON.stringify(m.json.copyrightText || '')}`);
  for (const f of m.json.fields.filter((f) => f.type === 'esriFieldTypeString' && /status|type|categor|stage|phase|class|kind|desc|review|zone|proc|name$/i.test(f.name) && !/addr|owner|applicant|email|phone|contact|agent|manager|staff/i.test(f.name)).slice(0, 8)) {
    const g = await jget(`${layerUrl}/query?${new URLSearchParams({ f: 'json', where: '1=1', groupByFieldsForStatistics: f.name, outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: f.name, outStatisticFieldName: 'n' }]), orderByFields: 'n DESC', resultRecordCount: '60' })}`);
    const rows = (g.json && g.json.features || []).map((x) => `${JSON.stringify(x.attributes[f.name])}=${x.attributes.n}`);
    console.log(`  VOCAB ${f.name} (${rows.length}${rows.length >= 60 ? '+' : ''}): ${rows.join(' | ').slice(0, 1800)}`);
  }
  const s = await jget(`${layerUrl}/query?${new URLSearchParams({ f: 'json', where: '1=1', outFields: '*', returnGeometry: 'true', outSR: '4326', resultRecordCount: '3', orderByFields: m.json.objectIdField ? m.json.objectIdField + ' DESC' : '' })}`);
  for (const x of (s.json && s.json.features || [])) console.log(`  SAMPLE ${JSON.stringify(x.attributes).slice(0, 900)} geom=${JSON.stringify(x.geometry).slice(0, 120)}`);
}
async function findDentonOrg() {
  console.log('=== FOCUS 1d: locate the CITY OF DENTON ArcGIS org (verify org name, never assume) ===');
  const orgs = new Map();
  const note = async (orgId, via) => { if (!orgId || orgs.has(orgId)) return; const p = await jget(`https://www.arcgis.com/sharing/rest/portals/${orgId}?f=json`); const name = p.json && p.json.name; const url = p.json && p.json.urlKey; orgs.set(orgId, { name, urlKey: url }); console.log(`ORG ${orgId} name=${JSON.stringify(name)} urlKey=${url} via=${via} ${name ? '' : 'HTTP ' + p.status + ' ' + JSON.stringify(p.json && p.json.error || '').slice(0, 80)}`); };
  for (const q of ['denton', 'dentontxgis', 'City of Denton']) {
    const u = await jget(`https://www.arcgis.com/sharing/rest/community/users?${new URLSearchParams({ f: 'json', num: '50', q })}`);
    for (const x of (u.json && u.json.results) || []) console.log(`USER q=${q} username=${x.username} fullName=${JSON.stringify(x.fullName)} orgId=${x.orgId}`);
    const g = await jget(`https://www.arcgis.com/sharing/rest/community/groups?${new URLSearchParams({ f: 'json', num: '50', q })}`);
    for (const x of (g.json && g.json.results) || []) console.log(`GROUP q=${q} title=${JSON.stringify(x.title)} owner=${x.owner} orgId=${x.orgId}`);
  }
  for (const q of ['Active Projects Denton', 'Denton development projects review', 'City of Denton site plans plats rezoning', 'Denton Development Services']) {
    const r = await jget(`https://www.arcgis.com/sharing/rest/search?${new URLSearchParams({ f: 'json', num: '50', q, sortField: 'modified', sortOrder: 'desc' })}`);
    for (const it of (r.json && r.json.results) || []) {
      const hay = `${it.title} ${it.owner} ${it.snippet} ${(it.tags || []).join(' ')}`.toLowerCase();
      if (!/denton/.test(hay) && !/denton/.test(String(it.url))) continue;
      await note(it.orgId, 'item ' + it.title);
      console.log(`ITEM q=${JSON.stringify(q)} "${it.title}" type=${it.type} owner=${it.owner} org=${JSON.stringify((orgs.get(it.orgId) || {}).name)} modified=${iso(new Date(it.modified))} url=${it.url}`);
    }
  }
  for (const [id, o] of orgs) if (/denton/i.test(o.name || '')) {
    const sr = await jget(`https://www.arcgis.com/sharing/rest/search?${new URLSearchParams({ f: 'json', num: '100', q: `orgid:${id} AND (type:"Feature Service" OR type:"Map Service")`, sortField: 'modified', sortOrder: 'desc' })}`);
    for (const it of (sr.json && sr.json.results) || []) console.log(`DENTON-ORG-ITEM ${id} "${it.title}" modified=${iso(new Date(it.modified))} url=${it.url}`);
  }
}
async function focusDenton() {
  // City of Denton's org (verified by group/item owners '*@cityofdenton.com_dentontxgis'); hosted services live on services.arcgis.com/9dTWrhPzuDPnUVXr
  console.log('=== FOCUS 1e: walk City of Denton Active Projects web app item -> web map -> layers ===');
  const found = { layers: new Set(), ids: new Set(), items: [] }; const seenIds = new Set();
  await walkItem('10e6a853d14e4576a2c63b781b649841', 0, found, seenIds);
  console.log(`DENTON-APP candidate layers: ${[...found.layers].join(' ') || 'none'}`);
  const done = new Set();
  for (const u of found.layers) {
    if (timeUp()) break; const m = u.match(/^(.*\/rest\/services\/.+?\/(?:Feature|Map)Server)(\/\d+)?$/i); if (!m) { console.log(`  skip non-service url ${u}`); continue; }
    const ls = m[2] ? [m[2].slice(1)] : ((await jget(m[1] + '?f=json')).json?.layers || []).map((l) => String(l.id));
    for (const id of ls) { const lu = `${m[1]}/${id}`; if (done.has(lu)) continue; done.add(lu); await probeLayer(lu, 'denton active projects app layer', 'City of Denton (dentontxgis)'); await vocab(lu); }
  }
  console.log('=== FOCUS 1f: list City of Denton hosted services ===');
  const LD = await listServices('https://services.arcgis.com/9dTWrhPzuDPnUVXr/ArcGIS/rest/services');
  console.log(`DENTON-HOSTED ${LD.err ? 'ERR ' + LD.err : LD.services.length + ' services'}: ${LD.services.map((s) => s.name + '/' + s.type).join(', ')}`);
  out.denton_hosted = LD.services.map((s) => `${s.name}/${s.type}`);
  let n = 0;
  for (const s of LD.services) {
    if (timeUp() || n >= 10) break; if (!/FeatureServer/.test(s.type)) continue;
    if (!/project|permit|plat|zon|case|plan|develop|site_?plan|annex|variance|subdiv|activity/i.test(s.name) || /survey123|template|storm|water|sewer|parcel_?view|hydrant/i.test(s.name)) continue;
    n++; const base = `${s.base}/${s.name}/${s.type}`; const m = await jget(base + '?f=json');
    for (const l of ((m.json && m.json.layers) || []).slice(0, 4)) { await probeLayer(`${base}/${l.id}`, s.name + '/' + l.name, 'City of Denton (dentontxgis)'); await vocab(`${base}/${l.id}`); }
  }
  return;
  console.log('=== FOCUS 1b: candidate AGO org OQPRCxZXJewOd2xW ===');
  const org = await jget('https://www.arcgis.com/sharing/rest/portals/OQPRCxZXJewOd2xW?f=json');
  console.log(`ORG HTTP ${org.status} name=${org.json && org.json.name} url=${org.json && org.json.urlKey} ${org.json && org.json.error ? JSON.stringify(org.json.error) : ''}`);
  const L = await listServices(DENTON_AGO);
  console.log(`DENTON-AGO ${L.err ? 'ERR ' + L.err : L.services.length + ' services'}: ${L.services.map((s) => s.name + '/' + s.type).join(', ')}`);
  out.denton_ago_services = L.services.map((s) => `${s.name}/${s.type}`);
  for (const s of L.services) {
    if (timeUp()) break; if (s.type !== 'FeatureServer' && s.type !== 'MapServer') continue;
    if (!/project|develop|permit|plat|zon|plan|case|annex|site|subdiv|rezon|activity|inspect/i.test(s.name)) continue;
    const base = `${s.base}/${s.name}/${s.type}`; const m = await jget(base + '?f=json');
    console.log(`SVC ${base} layers=${((m.json && m.json.layers) || []).map((l) => l.id + ':' + l.name).join(', ')} desc=${JSON.stringify(((m.json && m.json.serviceDescription) || '').slice(0, 200))}`);
    for (const l of ((m.json && m.json.layers) || [])) { await probeLayer(`${base}/${l.id}`, `${s.name}/${l.name}`, 'City of Denton (dentontxgis)'); await vocab(`${base}/${l.id}`); }
  }
  const ps = await jget('https://dentontxgis.maps.arcgis.com/sharing/rest/portals/self?f=json');
  console.log(`DENTONTXGIS portals/self HTTP ${ps.status} id=${ps.json && ps.json.id} name=${ps.json && ps.json.name} ${ps.json && ps.json.error ? JSON.stringify(ps.json.error).slice(0, 150) : ''}`);
  if (ps.json && ps.json.id) {
    const sr = await jget(`https://www.arcgis.com/sharing/rest/search?${new URLSearchParams({ f: 'json', num: '100', q: `orgid:${ps.json.id} AND (type:"Feature Service" OR type:"Map Service")`, sortField: 'modified', sortOrder: 'desc' })}`);
    for (const it of (sr.json && sr.json.results) || []) console.log(`DENTONTXGIS-ITEM "${it.title}" type=${it.type} modified=${iso(new Date(it.modified))} url=${it.url}`);
    out.dentontxgis_items = ((sr.json && sr.json.results) || []).map((it) => ({ title: it.title, url: it.url, modified: iso(new Date(it.modified)) }));
    const seenU = new Set();
    for (const it of ((sr.json && sr.json.results) || []).filter((x) => x.url && /project|develop|permit|plat|zon|case|activity|plan/i.test(x.title)).slice(0, 8)) {
      if (seenU.has(it.url) || timeUp()) continue; seenU.add(it.url);
      const mm = it.url.match(/^(.*)\/(FeatureServer|MapServer)(\/\d+)?$/); if (!mm) continue;
      const m2 = await jget(mm[1] + '/' + mm[2] + '?f=json');
      for (const l of ((m2.json && m2.json.layers) || [])) { await probeLayer(`${mm[1]}/${mm[2]}/${l.id}`, it.title + '/' + l.name, 'dentontxgis'); await vocab(`${mm[1]}/${mm[2]}/${l.id}`); }
    }
  }
  console.log('=== FOCUS 1c: skipped ===');
  return;
  console.log('=== FOCUS 1c: Denton County PlanningandZoning_GC "Present" layer ===');
  const cu = 'https://gis.dentoncounty.gov/arcgis/rest/services/PlanningandZoning_GC/MapServer/0';
  for (const p of [{ where: 'DateReceiv IS NOT NULL', outFields: 'PermitID,DateReceiv,PermitStat,PermitType', orderByFields: 'DateReceiv DESC', resultRecordCount: '5', returnGeometry: 'false' }, { where: "DateReceiv >= DATE '2024-01-01'", returnCountOnly: 'true' }]) {
    const r = await jget(`${cu}/query?${new URLSearchParams({ f: 'json', ...p })}`); console.log(`COUNTY-PRESENT ${JSON.stringify(p).slice(0, 80)} -> HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 700)}`);
  }
  const ff = 'https://maps.friscotexas.gov/gis/rest/services/Public/External_Planning_and_Zoning/MapServer';
  for (const id of [4, 5, 2, 9, 10]) await vocab(`${ff}/${id}`);
}
async function focus() {
  await focusDenton();
  const found = { layers: new Set(), ids: new Set(), items: [] }; const seenIds = new Set();
  console.log('=== FOCUS 1: City of Denton pages ===');
  for (const u of ['https://www.cityofdenton.com/241/Development-Project-Information', 'https://www.cityofdenton.com/1072/Development-Activity']) {
    const r = await get(u); console.log(`PAGE ${u} -> HTTP ${r.status} ${r.bytes}B ${r.error || ''}`);
    if (r.status !== 200) continue;
    console.log(`  text=${JSON.stringify(strip(r.text).slice(0, 700))}`);
    const links = [...r.text.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => [m[1], strip(m[2]).trim().slice(0, 70)]).filter(([h, t]) => /map|gis|arcgis|project|activity|permit|dashboard|data|report|download|csv|tracker|zoning|plat/i.test(h + t)).slice(0, 30);
    console.log(`  links=${JSON.stringify(links)}`);
    await mineRefs(u, r.text, u, 0, seenIds, found);
    for (const [h] of links) { if (/arcgis\.com|storymaps|experience|\/maps?\b|gis\./i.test(h)) { try { const a = new URL(h, u).href; const rr = await get(a); console.log(`  LINK ${a} -> HTTP ${rr.status} ${rr.bytes}B`); if (rr.status === 200) await mineRefs('link ' + a, rr.text, a, 1, seenIds, found); for (const m of a.matchAll(/[0-9a-f]{32}/g)) found.ids.add(m[0]); } catch {} } }
  }
  for (const id of [...found.ids]) await walkItem(id, 0, found, seenIds);
  console.log(`CANDIDATE LAYERS: ${[...found.layers].join(' ') || 'none'}`);
  for (const u of found.layers) {
    if (timeUp()) break;
    const m = u.match(/^(.*\/(?:Feature|Map)Server)(\/\d+)?$/i); if (!m) continue;
    if (m[2]) await probeLayer(u, 'city-of-denton candidate', 'City of Denton'); else await probeService({ base: m[1].replace(/\/[^/]+\/(?:Feature|Map)Server$/i, ''), name: m[1].replace(/^.*\/rest\/services\//i, '').replace(/\/(?:Feature|Map)Server$/i, ''), type: /FeatureServer/i.test(m[1]) ? 'FeatureServer' : 'MapServer' }, 'City of Denton');
  }
  out.denton_candidates = [...found.layers]; out.denton_items = found.items;
  console.log('=== FOCUS 2: Frisco health ==='); await friscoHealth();
  console.log('=== FOCUS 3: Denton County Civic Access (publisher + documented export/API only) ===');
  await probePortal('1_denton_county_civic_access', PORTALS[0][1]);
  for (const u of ['https://dentoncountytx-energovweb.tylerhost.net/apps/SelfService/robots.txt', 'https://www.dentoncounty.gov/', ]) { const r = await get(u); console.log(`CIVIC ${u} -> HTTP ${r.status} ${r.bytes}B ${JSON.stringify(strip(r.text).slice(0, 300))}`); }
  console.log('=== FOCUS 4: pointers (discovery/cross-check only) ===');
  for (const u of ['https://denton.myopentexas.org/development', 'https://physical-layer.com/permits/texas/denton-county']) {
    const r = await get(u); console.log(`POINTER ${u} -> HTTP ${r.status} ${r.bytes}B final=${r.finalUrl} ${r.error || ''}`);
    if (r.status === 200) { console.log(`  text=${JSON.stringify(strip(r.text).slice(0, 900))}`); const ext = [...r.text.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]).filter((h) => /denton|\.gov|\.us\/|arcgis|energov|etrakit|tylerhost|aspgov|opengov|civic/i.test(h)).slice(0, 20); console.log(`  outbound=${JSON.stringify([...new Set(ext)])}`); }
  }
  console.log(`DONE requests=${nreq} elapsed_s=${Math.round((Date.now() - T0) / 1000)}`);
  console.log('----- BEGIN DENTON PROBE JSON -----'); console.log(JSON.stringify(out)); console.log('----- END DENTON PROBE JSON -----');
}

// ---------- DENTON MODE: City of Denton Planning/Projects MapServer in depth + hosted permit/project views ----------
const DEN_MS = 'https://maps.cityofdenton.com/server/rest/services/Planning/Projects/MapServer';
async function denton() {
  const svc = await jget(DEN_MS + '?f=json');
  console.log(`DEN-SVC HTTP ${svc.status} layers=${((svc.json && svc.json.layers) || []).map((l) => l.id + ':' + l.name + (l.subLayerIds ? '[group]' : '')).join(' | ')} desc=${JSON.stringify(((svc.json && svc.json.serviceDescription) || '').slice(0, 300))} copyright=${JSON.stringify((svc.json && svc.json.copyrightText) || '')} caps=${svc.json && svc.json.capabilities} fmt=${svc.json && svc.json.supportedExtensions}`);
  out.den_layers = ((svc.json && svc.json.layers) || []).map((l) => `${l.id}:${l.name}`);
  const P = (v) => (v == null ? null : iso(new Date(v)));
  for (const l of ((svc.json && svc.json.layers) || [])) {
    if (timeUp()) break;
    const lu = `${DEN_MS}/${l.id}`;
    const meta = await jget(lu + '?f=json'); const j = meta.json || {};
    if (!j.fields || l.subLayerIds) { console.log(`DEN-LAYER ${l.id} "${l.name}" ${l.subLayerIds ? 'GROUP' : 'no fields'}`); continue; }
    const q = (p) => jget(`${lu}/query?${new URLSearchParams({ f: 'json', ...p })}`);
    const n = (await q({ where: '1=1', returnCountOnly: 'true' })).json;
    const c = async (w) => { const r = (await q({ where: w, returnCountOnly: 'true' })).json; return r && r.count != null ? r.count : 'ERR'; };
    const row = { id: l.id, name: l.name, total: n && n.count, sub_2025: await c("Submittal_Date >= DATE '2025-01-01'"), sub_2026: await c("Submittal_Date >= DATE '2026-01-01'"), stat_2025: await c("Status_Date >= DATE '2025-01-01'"), stat_2026: await c("Status_Date >= DATE '2026-01-01'"), visible_vals: null };
    const vis = await q({ where: '1=1', groupByFieldsForStatistics: 'Visible', outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]) });
    row.visible_vals = ((vis.json && vis.json.features) || []).map((f) => `${JSON.stringify(f.attributes.Visible)}=${f.attributes.n}`).join(' ');
    const dd = await q({ where: '1=1', outStatistics: JSON.stringify([{ statisticType: 'count_distinct', onStatisticField: 'Project_ID', outStatisticFieldName: 'dp' }, { statisticType: 'count', onStatisticField: 'Project_ID', outStatisticFieldName: 'np' }, { statisticType: 'max', onStatisticField: 'Date_Added', outStatisticFieldName: 'da' }]) });
    row.id_stats = dd.json && dd.json.features && dd.json.features[0] && dd.json.features[0].attributes; if (row.id_stats && row.id_stats.da) row.id_stats.da = P(row.id_stats.da);
    const s3 = await q({ where: '1=1', outFields: 'Project_ID,Project_Name,Project_Type,Status,Submittal_Date,Status_Date,Address,SimpleStatus,SimpleType,Visible,Property_ID', returnGeometry: 'true', outSR: '4326', orderByFields: 'Status_Date DESC', resultRecordCount: '3' });
    row.newest = ((s3.json && s3.json.features) || []).map((f) => { const a = f.attributes; const ring = f.geometry && f.geometry.rings && f.geometry.rings[0]; const cen = ring ? [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length].map((x) => +x.toFixed(5)) : null; return { id: a.Project_ID, name: a.Project_Name, type: a.Project_Type, status: a.Status, sub: P(a.Submittal_Date), statusDate: P(a.Status_Date), addr: a.Address, simple: a.SimpleStatus + '/' + a.SimpleType, visible: a.Visible, ring_centroid: cen }; });
    // geometry bounds + null-address share over all rows
    const all = await q({ where: '1=1', outFields: 'Project_ID,Address,Status,Project_Type', returnGeometry: 'true', outSR: '4326', resultRecordCount: '2000' });
    const fs = (all.json && all.json.features) || []; let minx = 9, maxx = -999, miny = 99, maxy = -99, ng = 0;
    for (const f of fs) { const r = f.geometry && f.geometry.rings; if (!r) { ng++; continue; } for (const ring of r) for (const [x, y] of ring) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); } }
    row.geom = { rows: fs.length, no_geometry: ng, bbox: [minx, miny, maxx, maxy].map((v) => +v.toFixed(4)), no_address: fs.filter((f) => !f.attributes.Address || !String(f.attributes.Address).trim()).length, dup_project_ids_in_layer: fs.length - new Set(fs.map((f) => f.attributes.Project_ID)).size };
    out['den_layer_' + l.id] = row; console.log('DEN-LAYER ' + JSON.stringify(row));
  }
  // cross-layer duplicate Project_IDs (same project in several stage layers?)
  const idsByLayer = {};
  for (const l of ((svc.json && svc.json.layers) || [])) { if (l.subLayerIds) continue; const r = await jget(`${DEN_MS}/${l.id}/query?${new URLSearchParams({ f: 'json', where: '1=1', outFields: 'Project_ID', returnGeometry: 'false', resultRecordCount: '2000' })}`); idsByLayer[l.id] = ((r.json && r.json.features) || []).map((f) => f.attributes.Project_ID); }
  const seen = new Map(); for (const [lid, ids] of Object.entries(idsByLayer)) for (const id of new Set(ids)) { if (!seen.has(id)) seen.set(id, []); seen.get(id).push(lid); }
  const multi = [...seen.entries()].filter(([, v]) => v.length > 1);
  console.log(`DEN-XLAYER distinct Project_IDs=${seen.size} appearing in >1 layer=${multi.length} sample=${JSON.stringify(multi.slice(0, 12))}`);
  console.log('=== DEN hosted candidates ===');
  const HB = 'https://services.arcgis.com/9dTWrhPzuDPnUVXr/arcgis/rest/services';
  for (const nm of ['Planning_Projects_view', 'All_Projects', 'ProjectPlanning', 'Active_Development_Public_View', 'RecentDevelopment', 'MajorProjectsunderdevelopment', 'New_Permits', 'All_Permits', 'Residential_Permits_New_view', 'Commerical_Permits_view']) {
    if (timeUp()) break;
    const m = await jget(`${HB}/${nm}/FeatureServer?f=json`);
    console.log(`HOSTED ${nm} HTTP ${m.status} ${m.json && m.json.error ? JSON.stringify(m.json.error).slice(0, 120) : (m.json && m.json.layers || []).map((l) => l.id + ':' + l.name).join(' | ')}`);
    for (const l of ((m.json && m.json.layers) || []).slice(0, 2)) { await probeLayer(`${HB}/${nm}/FeatureServer/${l.id}`, nm, 'City of Denton (dentontxgis)'); await vocab(`${HB}/${nm}/FeatureServer/${l.id}`); }
  }
  console.log(`DONE requests=${nreq} elapsed_s=${Math.round((Date.now() - T0) / 1000)}`);
  console.log('----- BEGIN DENTON PROBE JSON -----'); console.log(JSON.stringify(out)); console.log('----- END DENTON PROBE JSON -----');
}

async function denton2() {
  const gb = async (lu, f) => { const g = await jget(`${lu}/query?${new URLSearchParams({ f: 'json', where: '1=1', groupByFieldsForStatistics: f, outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]), orderByFields: 'n DESC', resultRecordCount: '300' })}`); return ((g.json && g.json.features) || []).map((x) => `${JSON.stringify(x.attributes[f])}=${x.attributes.n}`).join(' | '); };
  for (const id of [15, 9, 13, 5, 8, 12, 0, 1]) {
    if (timeUp()) break; const lu = `${DEN_MS}/${id}`;
    console.log(`V2-LAYER ${id}`);
    for (const f of ['Status', 'Project_Type', 'Project_LandUse', 'SimpleStatus', 'Current_Zoning']) console.log(`  V2 ${id} ${f}: ${(await gb(lu, f)).slice(0, 2200)}`);
    const nu = await jget(`${lu}/query?${new URLSearchParams({ f: 'json', where: 'Number_Of_Units IS NOT NULL', returnCountOnly: 'true' })}`); console.log(`  V2 ${id} units_nonnull=${nu.json && nu.json.count}`);
  }
  const s5 = await jget(`${DEN_MS}/15/query?${new URLSearchParams({ f: 'json', where: "Status_Date >= DATE '2026-09-01'", outFields: 'Project_ID,Project_Name,Project_Type,Status,Submittal_Date,Status_Date,Completion_Date,Project_Description,Address,Project_LandUse,Number_Of_Units,Number_Of_Lots,Property_ID', returnGeometry: 'false', resultRecordCount: '6', orderByFields: 'Status_Date DESC' })}`);
  for (const f of (s5.json && s5.json.features) || []) { const a = { ...f.attributes }; for (const k of ['Submittal_Date', 'Status_Date', 'Completion_Date']) if (a[k]) a[k] = iso(new Date(a[k])); console.log('  V2 SAMPLE15 ' + JSON.stringify(a).slice(0, 700)); }
  console.log('----- BEGIN DENTON PROBE JSON -----'); console.log('{}'); console.log('----- END DENTON PROBE JSON -----');
}

async function main() {
  if (process.env.PROBE_MODE === 'denton2') return denton2();
  if (process.env.PROBE_MODE === 'denton') return denton();
  if (process.env.PROBE_MODE === 'focus') return focus();
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
