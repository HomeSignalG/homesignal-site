// MAPS (ALL THEMES) ZIP ORDER — offline proof of the dashboard + SQL halves.
// Run: node test/maps-zip-order.test.mjs
//
// The Maps list is a SECOND, independent copy of the Data Center ZIP order
// (test/maps-dc-zip-order.test.mjs covers that one, and must keep passing unchanged).
// The CSV parser is shared (lib/maps-dc-zip-order.js) — one contract for both lists.
import { readFileSync } from 'node:fs';

const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const strip = (src) => src
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1 ')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
const DASH = strip(rd('../acquisition.html'));
const SQL = rd('../docs/maps-zip-order.sql');
const SQLC = SQL.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const DCSQL = rd('../docs/maps-dc-zip-order.sql');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m); } };

// ── 1 · SEPARATE STORAGE ─────────────────────────────────────────────────────────────
ok(/create table if not exists public\.maps_zip_order\b/.test(SQLC), 'own table public.maps_zip_order');
ok(!/maps_dc_zip_order/.test(SQLC), 'the Maps SQL never references the Data Center table');
ok(/PRIMARY KEY \(founder_position\)/.test(SQLC) && /zip ~ '\^\[0-9\]\{5\}\$'/.test(SQLC)
  && /UNIQUE \(zip\)/.test(SQLC), 'order is the primary key; ZIP is 5-digit text and unique');
ok(/enable row level security/.test(SQLC) && /revoke all on public\.maps_zip_order from anon/.test(SQLC),
  'RLS on, anon revoked');
ok(/'sdsutca@proton\.me'/.test(SQLC) && /raise exception 'not authorized'/.test(SQLC), 'founder-only gate');
ok(/delete from public\.maps_zip_order where true;[\s\S]*with ordinality/i.test(SQLC), 'replace is one transactional clear + ordered insert');
ok(/function public\.hs_set_maps_zip_order\(p_zips text\[\]\)/.test(SQLC), 'own setter RPC');
ok(/function public\.hs_request_maps_generation\(\)/.test(SQLC)
  && /function public\.hs_maps_generation_status\(\)/.test(SQLC), 'own generate + status RPCs');
ok(/create table if not exists public\.maps_generation_request/.test(SQLC)
  && !/maps_dc_generation_request/.test(SQLC), 'own request log (cool-off is independent of the Data Center button)');

// ── 2 · THE DISPATCH ─────────────────────────────────────────────────────────────────
ok(/bluesky-generate-maps\.yml\/dispatches/.test(SQLC), 'dispatches the EXISTING generator workflow');
ok(/'maps_order', 'true'/.test(SQLC), 'sends maps_order=true');
ok(/'zips', ''/.test(SQLC), 'zips stays blank (a list would defeat the founder ordering)');
ok(/if _zips = 0 then[\s\S]*?raise exception/.test(SQLC), 'an empty list refuses instead of starting a national scan');
ok(/APPLY ORDER|BEFORE this file is applied/.test(SQL), 'the ingest-first apply order is documented in the file');

// ── 3 · THE DASHBOARD ────────────────────────────────────────────────────────────────
ok(/table: 'maps_zip_order'/.test(DASH) && /setRpc: 'hs_set_maps_zip_order'/.test(DASH)
  && /genRpc: 'hs_request_maps_generation'/.test(DASH) && /statusRpc: 'hs_maps_generation_status'/.test(DASH),
  'the Maps scope uses only its own table and RPCs');
ok(/table: 'maps_dc_zip_order'/.test(DASH) && /setRpc: 'hs_set_maps_dc_zip_order'/.test(DASH)
  && /genRpc: 'hs_request_maps_dc_generation'/.test(DASH), 'the Data Center scope is unchanged');
ok(/var _zipOrderMaps = \{/.test(DASH) && /var _zipGenMaps = \{/.test(DASH), 'Maps has its own in-memory list and run state');
ok(/visible: function\(\)\{ return _bskyFamily==='MAPS' && !_bskyTheme; \}/.test(DASH), 'Maps panel shows under All Maps only');
ok(/visible: function\(\)\{ return _bskyFamily==='MAPS' && _bskyTheme==='datacenter'; \}/.test(DASH),
  'Data Center panel still shows under the Data Center theme only');
ok(/if\(!zipOrderVisible\(\)\)\{ host\.innerHTML=''; return; \}/.test(DASH), 'nothing renders in any other view (ALERTS untouched)');
ok(!/hs_set_maps_dc_zip_order|maps_dc_zip_order/.test(DASH.slice(DASH.indexOf("key: 'maps'"), DASH.indexOf('function zipOrderScope'))),
  'the Maps scope block never names a Data Center identifier');
ok(/sc\.setRpc/.test(DASH) && /sc\.genRpc/.test(DASH) && /sc\.statusRpc/.test(DASH) && /from\(sc\.table\)/.test(DASH),
  'the shared panel code takes every table/RPC from the active scope, never a literal');
ok(/fileTpl: 'maps-zip-order-template\.csv'/.test(DASH) && /fileCur: 'maps-zip-order\.csv'/.test(DASH),
  'Maps downloads are named apart from the Data Center ones');

// ── 4 · THE PANEL STILL CANNOT CHANGE A POST ─────────────────────────────────────────
const panel = DASH.slice(DASH.indexOf('var _zipOrder ='), DASH.indexOf('async function refreshBluesky'));
ok(panel.length > 1500, 'panel slice located');
ok(!/social_posts|hs_approve_social_post|scheduled_slot|image_bucket_path|\.update\(/.test(panel),
  'it never reads/writes posts, approves, schedules or touches images');

// ── 5 · THE DATA CENTER SQL FILE IS UNTOUCHED ────────────────────────────────────────
ok(/maps_dc_zip_order/.test(DCSQL) && !/maps_zip_order\b/.test(DCSQL.replace(/maps_dc_zip_order/g, '')),
  'docs/maps-dc-zip-order.sql still describes only its own table');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
