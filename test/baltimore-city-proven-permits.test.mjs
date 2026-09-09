// Offline pin: baltimore-city-housing-permits keeps ONLY rows we can prove are
// tear-downs or new construction. The layer is every issued housing/building
// permit (roofs, HVAC, fences, paint, occupancy, events). Founder 2026-09-09:
// keep what you can prove — not include-all, not skip.
//
// THE HAZARD THIS FILE EXISTS TO PIN. Widening extra_where to CaseNumber LIKE
// 'BRCM%' or dropping the Description templates would dump ~23k combo-permit
// repairs onto Map 1 and count them as point development. Boston dropped Short
// Form for the same class; Baltimore City has no work-type column, so the keep
// list IS the filter.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const REG = JSON.parse(readFileSync(
  join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const E = (REG.arcgis || []).find((e) => e.registry_id === 'baltimore-city-housing-permits');
ok(!!E, 'the Baltimore city proven-keep entry exists');
if (!E) { console.log(`\n${fails} check(s) FAILED`); process.exit(1); }

ok(E.platform === 'arcgis', 'arcgis connector');
ok(E.service_url === 'https://baltegis.baltimorecity.gov/mapping/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3',
  'reads the city DHCD FeatureServer/3, not the county ledger');
ok(E.jurisdiction === 'City of Baltimore',
  'jurisdiction starts City of — county-sources copy can say city');

{
  const cov = E.coverage || [];
  ok(cov.some((c) => c.state === 'MD' && c.county === 'Baltimore'),
    'coverage includes MD/Baltimore (communities.county on city ZIP rows)');
  ok(cov.some((c) => c.state === 'MD' && c.county === 'Baltimore city'),
    'coverage includes MD/Baltimore city (monitor / Census independent-city label)');
  ok(!cov.some((c) => ['Howard', 'Harford', 'Anne Arundel'].includes(c.county)),
    'does not ride the county entry\'s Howard/Harford spillover');
}

ok(E.status_const === 'Issued', 'issuance ledger: status_const Issued');
ok(Array.isArray(E.status_to_bucket?.approved) && E.status_to_bucket.approved.includes('Issued'),
  'arcgis status_const resolves through approved (not the socrata bucket idiom)');
ok(E.use_type_const === 'Development' && !E.type_map,
  'use_type_const Development, no type_map — Description is free prose');
ok(!('type_source' in (E.column_map || {})),
  'does not map ExistingUse/ProposedUse as type — those are parcel use, not work class');
ok(E.spatial_zip_radius_mi === 3, 'no ZIP column -> 3-mile envelope');
ok(E.column_map.lat === '__lat' && E.column_map.lng === '__lng',
  'places by layer point geometry, not geocoded address');
ok(E.column_map.file_date === 'IssuedDate' && E.file_date_kind === 'issued',
  'recency and the page date are issuance');
ok(E.record_url_precision === 'dataset', 'no per-row URL — dataset precision, never a guessed Accela template');
ok(E.recency_days === 365, 'trailing year');

const w = E.extra_where || '';
ok(w.includes("CaseNumber LIKE 'BDEM%'"), 'keeps razing prefix BDEM');
ok(w.includes("CaseNumber LIKE 'DEM%'"), 'keeps legacy razing prefix DEM');
ok(w.includes("%---%NEW CONSTRUCTION%---%"), 'keeps dashed NEW CONSTRUCTION scope header');
ok(w.includes("CONSTRUCT NEW SFD"), 'keeps Construct New SFD');
ok(w.includes('CHILD APPLICATION'), 'keeps Accela CHILD Application new townhouses');
ok(w.includes('TOWNHOUSE') && w.includes('TOWNHOME') && w.includes("'%SFD%'"),
  'child-application clause requires townhouse/townhome/SFD');
ok(!w.includes("LIKE 'BRCM%'"), 'does NOT keep all one-and-two-family combo permits');
ok(!w.includes("LIKE 'BCCM%'"), 'does NOT keep all commercial/multifamily combo permits');
ok(!w.includes("LIKE 'BUSE%'") && !w.includes("LIKE 'BTEMP%'"),
  'does not keep occupancy or temporary-event prefixes');

ok(!JSON.stringify(E).includes("LIKE '%repair%"),
  'does not keyword-guess Description for repair — that is fabrication');

if (fails) { console.log(`\n${fails} check(s) FAILED`); process.exit(1); }
console.log('\nall checks passed');
