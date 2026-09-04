// Map 1 ZIP mode must serve AUTHORITATIVE development geography, not the legacy radius cache.
//
// THE DEFECT THIS PINS (measured 2026-09-04, docs/maps-coverage/N5-DELIVERY-GAP-ZIP-PAGE.md):
// production_geography_verified was 10,821, and none of those pages served authoritative
// geography — homesignalmap.html read public.development_reports, the 3-mile centroid-radius
// cache, and contained zero references to app_projects_for_zip. Across those ZIPs the cache
// served 1,363,148 development rows against 406,196 authoritative projects, wrong in BOTH
// directions: on a 150-ZIP sample 1,784 of 3,016 shown records lay outside the ZCTA and 228 of
// 1,460 authoritative projects were missing from the page.
//
// Two halves are asserted here, because either alone lets the defect back:
//   PART A  the pure transform (lib/data.js) — shape, the fields that must NOT be copied, and
//           the drop-with-disclosure rule for records that carry no official link.
//   PART B  the page's own source (homesignalmap.html) — that every branch of an authoritative
//           ZIP fails CLOSED, and that markers follow geography while cards follow projects.
// Run: node test/map1-authoritative-zip-delivery.test.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

function loadHS() {
  delete require.cache[require.resolve('../lib/data.js')];
  global.window = { HS_CONFIG: { DATA_SOURCE: 'supabase', DEFAULT_ZIP: '76104' }, HS: {} };
  require('../lib/data.js');
  return global.window.HS;
}
const HS = loadHS();

// A REAL producer record and the REAL cached site for the SAME project, both read out of
// production rather than invented, so the field map is checked against what actually ships.
// source_key arcgis:fort-worth-development-permits:HCLC-26-230, ZIP 76104.
const REC = {
  zip: '76104', lat: 32.7141741098097, lng: -97.3120814445688,
  name: 'Design Review 1215 COLVIN AVE', type: 'Development', status: 'Proposed',
  stage: 'Accepted', address: '1215 COLVIN AVE', type_raw: 'Design Review',
  date_kind: 'filed', submitted_at: '2026-08-25', developer: null, scope_text: null,
  source_key: 'arcgis:fort-worth-development-permits:HCLC-26-230',
  source_ref: 'https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/Permits/MapServer/0',
  registry_id: 'fort-worth-development-permits',
  provenance: { case_number: 'HCLC-26-230', jurisdiction: 'Fort Worth', source_class: 'arcgis',
                geo_precision: 'point', url_precision: 'dataset' },
  attributes_missing: false,
  _markers: [{ marker_seq: 1, lat: 32.7141741098097, lng: -97.3120814445688, marker_rule: 'point' }],
};
const CACHED_FACILITY = { scope: 'point', lat: 32.7, lng: -97.3, registry_id: '110000350000',
                          use_type: 'Industrial', record_url: 'https://echo.epa.gov/x' };
const CACHED_CIVIC = { scope: 'area', relevance: 'civic', title: 'Budget hearing',
                       record_url: 'https://example.gov/h' };
const CACHED_DEV_POINT = { scope: 'point', relevance: 'development', source_id: 'x:y:1',
                           lat: 32.9, lng: -97.9, record_url: 'https://example.gov/1' };
const CACHED_DEV_AREA  = { scope: 'area', relevance: 'development', source_id: 'x:y:2',
                           record_url: 'https://example.gov/2' };

console.log('A. the pure transform');
{
  const s = HS.authoritativeDevSite(REC);
  ok(s.title === 'Design Review 1215 COLVIN AVE' && s.label === s.title, 'A1 name -> title/label');
  ok(s.type === 'proposed' && s.bucket === 'proposed',
     'A2 status "Proposed" -> lifecycle type/bucket lowercased (drives the Proposed rail and dot colour)');
  ok(s.use_type === 'Development', 'A3 app_projects.type -> use_type (the classifier reads use_type)');
  ok(s.status_raw === 'Accepted', 'A4 stage -> status_raw');
  ok(s.record_url === REC.source_ref && s.url === REC.source_ref, 'A5 source_ref -> url + record_url');
  ok(s.case_number === 'HCLC-26-230' && s.jurisdiction === 'Fort Worth'
     && s.geo_precision === 'point' && s.record_url_precision === 'dataset' && s.source_class === 'arcgis',
     'A6 provenance.* unpacked to the fields the popup and the verifier read');
  ok(s.file_date === '2026-08-25' && s.file_date_kind === 'filed', 'A7 submitted_at/date_kind -> file_date');
  ok(s.source_id === REC.source_key && s.source_registry_id === 'fort-worth-development-permits',
     'A8 source_key -> source_id, registry_id -> source_registry_id');
  ok(s.scope === 'point' && s.relevance === 'development' && s.authoritative === true,
     'A9 stamped as an authoritative development point');

  // THE TWO FIELDS THAT MUST NOT BE COPIED.
  ok(!('registry_id' in s),
     'A10 registry_id is NEVER set — on this page frsRid(s) reads it and a value means "EPA facility", '
     + 'so copying it would relabel permits as facilities');
  ok(!('layer' in s),
     'A11 layer is not invented — use_type is checked before layer by the classifier, and the two other '
     + 'uses already fall back');

  // Anti-fabrication: no official link, no rendered site.
  const noUrl = HS.authoritativeDevSite(Object.assign({}, REC, { source_ref: null }));
  ok(noUrl === null, 'A12 a record with no source_ref is not rendered (record_url is mandatory)');
  ok(HS.authoritativeDevSite(null) === null, 'A13 a null record is not rendered');

  const multi = HS.authoritativeDevSite(Object.assign({}, REC, { _markers: [
    { marker_seq: 1, lat: 1, lng: 2 }, { marker_seq: 2, lat: 3, lng: 4 }, { marker_seq: 3, lat: null, lng: 5 }] }));
  ok(multi._markers.length === 2,
     'A14 markers with a non-numeric coordinate are dropped, the rest kept — never a fabricated point');
}

console.log('B. the splice — development replaced, everything else identical');
{
  const cached = [CACHED_DEV_POINT, CACHED_FACILITY, CACHED_DEV_AREA, CACHED_CIVIC];
  const out = HS.spliceAuthoritativeDevelopment(cached, [REC]);
  ok(out.projects === 1 && out.sites.filter(s => s.relevance === 'development').length === 1,
     'B1 one authoritative project in, one development card out');
  ok(out.replaced === 2, 'B2 BOTH cached development records were replaced — point AND area scope');
  ok(out.sites.includes(CACHED_FACILITY), 'B3 the facility object passes through BY IDENTITY, not rebuilt');
  ok(out.sites.includes(CACHED_CIVIC), 'B4 the civic item passes through by identity');
  ok(!out.sites.includes(CACHED_DEV_POINT) && !out.sites.includes(CACHED_DEV_AREA),
     'B5 no legacy radius development record survives the splice');
  ok(out.markers === 1, 'B6 marker count is reported from the authoritative marker arrays');

  const withUnlinkable = HS.spliceAuthoritativeDevelopment(cached,
    [REC, Object.assign({}, REC, { source_ref: null, source_key: 'k2' })]);
  ok(withUnlinkable.projects === 1 && withUnlinkable.unlinkable === 1,
     'B7 an unlinkable authoritative project is COUNTED, not silently dropped');
  ok(withUnlinkable.sites.filter(s => s.relevance === 'development').length === 1,
     'B8 …and it is still not rendered — disclosure never becomes fabrication');

  const empty = HS.spliceAuthoritativeDevelopment(cached, []);
  ok(empty.projects === 0 && empty.sites.filter(s => s.relevance === 'development').length === 0,
     'B9 authoritative MEASURED-ZERO serves zero development — the cache is not a fallback');
  ok(empty.sites.length === 2, 'B10 …while facilities and civic items remain');

  const nm = HS.dropUnmeasurableDevelopment(cached);
  ok(nm.removed === 2 && nm.sites.length === 2 && nm.sites.includes(CACHED_FACILITY),
     'B11 not_measured removes development and keeps facilities — a 3-mile circle is not the ZIP');
}

console.log('C. the page — every authoritative branch fails CLOSED');
{
  const page = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
  const zipLoad = page.slice(page.indexOf('GEO_STATE = null; GEO_NOTE = "";'),
                             page.indexOf('function render(data)'));
  ok(zipLoad.includes('app_zip_geography_state'),
     'C1 ZIP mode reads the geography state before deciding where development comes from');
  ok(zipLoad.includes('/rest/v1/rpc/app_projects_for_zip'),
     'C2 authoritative development comes from app_projects_for_zip — the same contract production '
     + 'verification gates on');
  ok(/\|\|\s*"pending"/.test(zipLoad),
     'C3 an unreadable state resolves to pending, never to authoritative');
  // The fail-closed rule, stated as: nothing inside the authoritative branch re-renders the cached
  // development records. Both the RPC catch and the not_measured branch must strip them.
  const authBranch = zipLoad.slice(zipLoad.indexOf('if(geoState !== "authoritative")'));
  ok((authBranch.match(/dropUnmeasurableDevelopment/g) || []).length >= 1
     && authBranch.includes('.catch(function(){'),
     'C4 the RPC failure path strips legacy development instead of falling back to it');
  ok(!/base\.sites\s*=\s*row\.sites/.test(authBranch),
     'C5 no path inside the authoritative branch restores the cached sites');
  ok(zipLoad.includes('spliceAuthoritativeDevelopment'), 'C6 the splice is what feeds render()');

  const markerLoop = page.slice(page.indexOf('siteMarkers = [];'), page.indexOf('applyFilter();'));
  ok(markerLoop.includes('s._markers && s._markers.length > 1'),
     'C7 a multi-marker authoritative project draws one marker per authoritative marker');
  ok(markerLoop.includes('siteMarkers.push({ m:m, bucket:bucketOf(s.type, s), s:s, ll:ll, seq:i })'),
     'C8 every marker entry carries its OWN true point, so the pixel fan cannot drag them together');
  ok(!markerLoop.includes('sites.push('), 'C9 drawing markers never adds cards');

  const counters = page.slice(page.indexOf('var AUTH_DEV ='), page.indexOf('$("cTot").textContent'));
  ok(/AUTH_DEV\s*\?\s*prop\.length/.test(counters),
     'C10 the Proposed counter is recomputed from the rendered set, not read from the stale cache');
  ok(counters.includes('cFac') === false,
     'C11 the facilities counter is left alone — facilities are out of scope of this change');
}

process.exit(fails ? 1 : 0);
