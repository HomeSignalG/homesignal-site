// MAP 1 PROJECT LINK + PANEL — offline checks of lib/map1-project-panel.js and the SQL of record's shape.
// Run: node test/map1-project-panel.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : ''));
  if (!c) fails++;
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ctx = { URL, location: { href: 'https://jodytracks.com/map/20187/' } };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(read('lib/map1-project-panel.js'), ctx);
const HS = ctx.HS;

console.log('\n1. the link and its key');
ok(HS.map1ProjectParam('https://jodytracks.com/map/20187/?project=dcrec%3Acompute_atlas%7Cfacilities%7Cvint-hill') ===
  'dcrec:compute_atlas|facilities|vint-hill', '1a dcrec key read from the link');
ok(HS.map1ProjectParam('https://x/map/1/?project=nat:osm:way/225745958') === 'nat:osm:way/225745958', '1b nat key');
ok(HS.map1ProjectParam('https://x/map/1/?project=n5:arcgis:phoenix:T1') === 'n5:arcgis:phoenix:T1', '1c n5 key');
ok(HS.map1ProjectParam('https://x/map/1/?project=dc:72e54dc3-e448-4b68-8dca-cc3aac833850') === null,
  '1d an entity uuid is not a project key (it changes on merges)');
ok(HS.map1ProjectParam('https://x/map/1/?project=') === null && HS.map1ProjectParam('https://x/map/1/') === null, '1e absent or empty');
ok(HS.map1ProjectParam('https://x/map/1/?project=nat:%0Aevil') === null, '1f control characters refused');
const link = HS.map1ProjectLink('https://jodytracks.com/', '20187', 'dcrec:compute_atlas|facilities|vint-hill');
ok(link === 'https://jodytracks.com/map/20187/?project=dcrec%3Acompute_atlas%7Cfacilities%7Cvint-hill', '1g link shape', link);
ok(!/stages=|types=|regulatory=/.test(link), '1h the link carries no filter');
ok(HS.map1ProjectLink('https://jodytracks.com', '2018', 'n5:x') === null && HS.map1ProjectLink('https://jodytracks.com', '20187', 'bad') === null,
  '1i no link from a bad ZIP or key');

console.log('\n2. the key Map 1 draws a site under');
ok(HS.map1SiteMapKey({ record_kind: 'national_project', source_key: 'dc:72e5' }) === 'dc:72e5', '2a canonical data center');
ok(HS.map1SiteMapKey({ record_kind: 'national_project', source_key: 'osm:way/1' }) === 'osm:way/1', '2b OSM entry');
ok(HS.map1SiteMapKey({ zip_authoritative: true, zip_project_ref: 'arcgis:x:1' }) === 'n5:arcgis:x:1', '2c development record');
ok(HS.map1SiteMapKey({ scope: 'point', record_url: 'https://epa' }) === null, '2d an EPA facility gets no panel key');

console.log('\n3. the panel');
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
const dc = { record_kind: 'national_project', source_key: 'dc:1', label: 'CyrusOne <Vint Hill>', name: 'CyrusOne',
  location_text: 'Vint Hill, VA', source_name: 'Compute Atlas', record_url: 'https://news.example/a', url: 'https://news.example/a',
  raw_status: 'proposed', last_seen_at: '2026-09-26 13:53:39+00', location_precision: 'approximate_campus_area',
  quality_flags: ['PUBLISHER_APPROXIMATE'], publication_basis: 'canonical' };
const base = { esc, zip: '20187', kindLabel: 'Proposed data center' };
let h = HS.map1ProjectPanelHTML(dc, Object.assign({}, base, { docs: [], docsState: 'ok' }));
ok(h.includes('CyrusOne &#60;Vint Hill&#62;'), '3a the name is escaped');
ok(h.includes('Vint Hill, VA') && h.includes('ZIP 20187'), '3b location and ZIP');
ok(h.includes('Status on JODY') && h.includes('Proposed data center'), '3c the status in Map 1\'s own words');
ok(h.includes('Source last observed') && h.includes('Sep 26, 2026'), '3d last_seen_at is labelled as when the source last listed it');
ok(!/approved|decided|Decision date/i.test(h.replace(/Proposed data center/g, '')), '3e no approval or decision wording for a proposed listing');
ok(h.includes('third-party directory') && h.includes('not an official decision'), '3f a directory listing says what it is');
ok(h.includes('No official government document is on file'), '3g no official document is named as missing');
ok(h.includes('approximate location'), '3h the approximate location is named');
ok(h.includes('not live'), '3i the panel does not claim to be live');

const docs = [{ title: 'Rezoning application REZN-24-1', url: 'https://fauquiercounty.gov/doc.pdf', publisher: 'Fauquier County',
  doc_kind: 'application', doc_date: '2024-03-02', doc_date_label: 'Application filed', supports: 'The site and the use applied for.' }];
h = HS.map1ProjectPanelHTML(dc, Object.assign({}, base, { docs, docsState: 'ok' }));
ok(h.includes('https://fauquiercounty.gov/doc.pdf') && h.includes('Fauquier County') && h.includes('Application'), '3j an approved document is listed with its source');
ok(h.includes('Application filed') && h.includes('Mar 2, 2024'), '3k the document date carries the document\'s own label');
ok(!h.includes('No official government document is on file'), '3l an official document removes that open question');
ok(h.includes('Supports: The site and the use applied for.'), '3m what the document supports');

h = HS.map1ProjectPanelHTML(dc, Object.assign({}, base, { docs: null, docsState: 'failed' }));
ok(h.includes('could not be loaded') && !h.includes('No official government document is on file'), '3n a failed read is not "none"');
h = HS.map1ProjectPanelHTML(dc, Object.assign({}, base, { docs: [{ title: 'x', url: 'javascript:alert(1)', doc_kind: 'decision' }], docsState: 'ok' }));
ok(!h.includes('javascript:'), '3o only https links are drawn');

const permit = { zip_authoritative: true, zip_project_ref: 'arcgis:x:1', label: 'New warehouse', src: 'phoenix-building-permits',
  record_url: 'https://apps.phoenix.gov/p/1', file_date: '2026-05-01', date_kind: 'filed', scope: 'point' };
h = HS.map1ProjectPanelHTML(permit, Object.assign({}, base, { docs: [], docsState: 'ok' }));
ok(h.includes('Agency record') && !h.includes('No official government document is on file'),
  '3p an agency\'s own record counts as an official document');
ok(h.includes('Filed (agency record)') && h.includes('May 1, 2026'), '3q the filing date is labelled from date_kind');
h = HS.map1ProjectPanelHTML(null, { esc, zip: '20187', notOnMap: true });
ok(/not on JODY's map right now/.test(h) && h.includes('20187'), '3r a key the map does not draw says so');

console.log('\n4. the SQL of record');
const sql = read('docs/map1-project-link.sql');
ok(/NOT APPLIED TO PRODUCTION/.test(sql), '4a marked not applied');
ok(/map1_dc_zip_members\(c\.z\)/.test(sql), '4b a data center is drawn only if Map 1\'s own reader returns it');
ok(/geo\.n5_serving_membership/.test(sql), '4c a development record reads the serving generation');
ok(/record_key_rank < 2/.test(sql), '4d a singleton record key is never a project key');
ok(/before update or delete on public\.map1_project_document_decision/.test(sql) && /before update or delete on public\.map1_project_document\b/.test(sql),
  '4e documents and decisions are append-only');
ok(/c\.decision = 'approved'/.test(sql), '4f the public reader returns approved documents only');
ok(!/update\s+public\.(dc_|app_projects|national_dc_records)/i.test(sql), '4g nothing here changes a project');
ok(/grant execute on function public\.hs_map1_project_document_decide\(uuid, text, text\) to authenticated/.test(sql) &&
   /_hs_is_admin\(\)/.test(sql), '4h a decision needs a dashboard admin');
ok(!/to anon[^;]*map1_project_document_propose|map1_project_document_propose[^;]*to anon/.test(sql), '4i only the service role proposes');

console.log('\n5. the page');
const page = read('homesignalmap.html');
ok(page.indexOf('src="lib/map1-project-panel.js') > page.indexOf('src="lib/map.js'), '5a the module loads after lib/map.js');
ok(/focusPendingProject\(\);\n  \}/.test(page), '5b the focus runs after every render');
const reveal = page.slice(page.indexOf('function ppReveal'), page.indexOf('function focusPendingProject'));
ok(reveal.length > 50 && !/writeStagesToUrl|writeTypesToUrl|replaceState/.test(reveal), '5c revealing the project writes no filter into the address bar');
ok(/"\/map\/" \+ zip \+ "\?project=" \+ encodeURIComponent\(PP\.key\)/.test(page), '5d a moved project rewrites only the ZIP');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
