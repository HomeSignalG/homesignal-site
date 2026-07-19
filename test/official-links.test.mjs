// Official-record link hygiene — offline registry/seed checks + optional live HTTP probe.
// Run: node test/official-links.test.mjs
// Live: OFFICIAL_LINKS_LIVE=1 node test/official-links.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const ENGINE_TEMPLATES = [
  'https://echo.epa.gov/detailed-facility-report?fid=110000000001',
  'https://www15.tceq.texas.gov/crpub/',
  'https://www.tdlr.texas.gov/TABS/Projects/TABS2024022676',
  'https://opendsd.sandiego.gov/web/approvals/2618042',
];

/** Collect user-facing record-link URLs from jurisdiction-registry.json */
function registryDatasetUrls() {
  const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
  const out = [];
  for (const arr of Object.values(reg)) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      if (s.dataset_url) out.push({ id: s.registry_id, url: s.dataset_url });
    }
  }
  return out;
}

function seedSourceRefs() {
  const text = readFileSync(join(root, 'seed/delvalle.js'), 'utf8');
  return [...text.matchAll(/source_ref:\s*['"](https?:\/\/[^'"]+)['"]/g)].map((m) => m[1]);
}

// ── Offline: every static official-record URL must be absolute HTTPS ──
const datasetUrls = registryDatasetUrls();
ok(datasetUrls.length >= 40, `registry exposes ${datasetUrls.length} dataset_url record fallbacks`);
for (const { id, url } of datasetUrls) {
  ok(url.startsWith('https://'), `dataset_url https: ${id}`);
  ok(!url.includes('{'), `dataset_url has no template placeholder: ${id}`);
  try { new URL(url); ok(true, `dataset_url parseable: ${id}`); }
  catch { ok(false, `dataset_url parseable: ${id}`); }
}

for (const url of ENGINE_TEMPLATES) {
  ok(url.startsWith('https://'), `engine template https: ${url.split('/')[2]}`);
}

const seedRefs = [...new Set(seedSourceRefs())];
ok(seedRefs.length >= 8, `delvalle seed has ${seedRefs.length} unique source_ref URLs`);
for (const url of seedRefs) {
  ok(url.startsWith('https://'), `seed source_ref https: ${url}`);
}

// Known obsolete URLs must not reappear in shipped config.
const banned = [
  'http://www.texastransparency.org',
  'geohub.cityoftacoma.org/datasets/',
  'www.austintexas.gov/department/planning',
  'www.austintexas.gov/airport',
];
const allStatic = [
  ...datasetUrls.map((d) => d.url),
  ...ENGINE_TEMPLATES,
  ...seedRefs,
  readFileSync(join(root, 'supabase/functions/get-address-report/index.ts'), 'utf8'),
  readFileSync(join(root, 'homesignalmap.html'), 'utf8'),
].join('\n');
for (const b of banned) {
  ok(!allStatic.includes(b), `obsolete pattern absent: ${b}`);
}

ok(allStatic.includes('https://data.tacoma.gov/datasets/tacoma::accela-permit-data-tacoma'),
  'Tacoma dataset_url uses canonical data.tacoma.gov hub page');
ok(allStatic.includes('https://www.austintexas.gov/planning'),
  'Austin planning seed uses /planning');
ok(allStatic.includes('https://www.flyaustin.com/'),
  'Austin airport seed uses flyaustin.com');

// ── Optional live probe of static URLs (CI/nightly or manual) ──
if (process.env.OFFICIAL_LINKS_LIVE === '1') {
  const UA = 'HomeSignal-LinkAudit/1.0 (+https://homesignal.net)';
  const probe = async (url) => {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(25000),
    }).catch(() => null);
    if (res && res.status < 400) return res.status;
    const get = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(25000),
    }).catch(() => null);
    return get ? get.status : 0;
  };

  const liveTargets = [
    ...datasetUrls.map((d) => ({ label: d.id, url: d.url })),
    ...ENGINE_TEMPLATES.map((url) => ({ label: 'engine', url })),
    ...seedRefs.map((url) => ({ label: 'seed', url })),
  ];

  console.log(`\nLive-probing ${liveTargets.length} static official-record URLs…`);
  for (const { label, url } of liveTargets) {
    const status = await probe(url);
    // ArcGIS service roots and Carto SQL bases may 403/400 to anonymous HEAD — dataset landing pages should 2xx.
    const softFail = status === 403 && url.includes('/arcgis/rest/services/');
    ok(status > 0 && (status < 400 || softFail), `live ${status || 'ERR'} ${label}: ${url}`);
  }
}

if (fails) { console.error('\n' + fails + ' failed'); process.exit(1); }
console.log('\nAll official-links assertions passed.');
