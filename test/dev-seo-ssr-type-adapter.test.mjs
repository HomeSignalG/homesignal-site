#!/usr/bin/env node
// Rule D SSR Type labels come from HS.canonicalProjectType(row).label.
//
// That function is the canonical Development Type for an app_projects row
// and deliberately does not read type_raw (Map 1 permit_class). SSR must
// not render classifyProjectType, and must not create a separate SEO
// interpretation of type_raw.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadAuthority,
  annotateEntity,
} from '../scripts/annotate-dev-seo-ssr.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const ok = (c, name, detail) => {
  if (c) { pass++; console.log('PASS — ' + name); }
  else { fail++; console.error('FAIL — ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
};

const adapterSrc = readFileSync(join(root, 'scripts', 'annotate-dev-seo-ssr.mjs'), 'utf8');
const genSrc = readFileSync(join(root, 'scripts', 'gen_zip_pages.py'), 'utf8');
const HS = loadAuthority();

ok(adapterSrc.includes('const typeInfo = HS.canonicalProjectType(row)'),
  'adapter assigns HS.canonicalProjectType(row)');
ok(adapterSrc.includes('const lifecycle = HS.canonicalLifecycle(row)'),
  'adapter assigns HS.canonicalLifecycle(row)');
ok(adapterSrc.includes('typeInfo.label'),
  'adapter renders typeInfo.label');
ok(adapterSrc.includes('lifecycle.label'),
  'adapter renders lifecycle.label');
ok(!/classifyProjectType\(row\)/.test(adapterSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
  'adapter does not render HS.classifyProjectType(row)');
ok(!adapterSrc.includes('canonicalProjectType({ type: row.type, name: row.name })'),
  'adapter does not project the row down to { type, name }');
ok(!/const CATEGORY_REGISTRY|const TYPE_EXACT|const KEYWORD_RULES|const NAME_RULES/.test(adapterSrc),
  'adapter does not redeclare the classifier');
ok(genSrc.includes('annotate-dev-seo-ssr.mjs') && genSrc.includes('type_label'),
  'generator consumes adapter labels, not ingest-classified strings');
ok(!/LIFECYCLE_LABELS|canonicalTypeLabel|function lifecycleKey/.test(genSrc),
  'generator does not copy project-type.js rules');

function ssrType(row) {
  return annotateEntity(HS, row).type_label || '';
}
function ssrLife(row) {
  return annotateEntity(HS, row).lifecycle_label || '';
}

const PARITY = [
  { type: 'Data center', name: 'Campus building 7', status: 'Proposed', label: 'Data center' },
  { type: 'Industrial', name: 'Lot 4 warehouse', status: 'Approved', label: 'Industrial' },
  { type: 'Residential', name: 'Northgate Apartments Phase 1', status: 'Proposed', label: 'Residential' },
  { type: 'Roads & infrastructure', name: 'Main Street reconstruction', status: 'Approved', label: 'Roads & infrastructure' },
  { type: 'Commercial', name: 'Retail pad at 3500 SH 130', status: 'Proposed', label: 'Commercial' },
  { type: 'civic', name: 'County building annex', status: 'Operating', label: 'Civic & public' },
  { type: 'unclassified', name: 'Generic lot improvement', status: 'On file', label: 'Other project' },
];

for (const row of PARITY) {
  const canon = HS.canonicalProjectType(row);
  ok(canon && canon.label === row.label,
    `canonicalProjectType(${row.label}) = ${row.label}`,
    canon && canon.label);
  ok(ssrType(row) === canon.label,
    `SSR Type == HS.canonicalProjectType(row).label for ${row.label}`,
    ssrType(row));
}

{
  const lifeRow = { type: 'Residential', name: 'Northgate Apartments Phase 1', status: 'Proposed' };
  const life = HS.canonicalLifecycle(lifeRow);
  ok(ssrLife(lifeRow) === life.label,
    'SSR lifecycle == HS.canonicalLifecycle(row).label',
    ssrLife(lifeRow));
}

{
  // type_raw must NOT change the public SSR Type when it disagrees with
  // canonicalProjectType (Map 1 permit_class, site test 4j).
  const full = {
    type: 'Utility',
    type_raw: 'Data Center',
    name: 'Building 7 shell',
    status: 'Proposed',
  };
  const canon = HS.canonicalProjectType(full);
  ok(canon && canon.label !== 'Data center',
    'canonicalProjectType ignores type_raw Data Center',
    canon && canon.label);
  ok(ssrType(full) === canon.label,
    'SSR Type follows canonicalProjectType, not type_raw',
    ssrType(full));
  ok(ssrType(full) !== 'Data center',
    'SSR Type is not a type_raw override of Data center');
}

{
  const named = {
    type: 'unclassified',
    name: 'Del Valle High School',
    status: 'Proposed',
  };
  const canon = HS.canonicalProjectType(named);
  ok(canon && canon.label === 'Civic & public',
    'canonical name rule: unclassified + school name → Civic & public');
  ok(ssrType(named) === canon.label,
    'SSR follows the existing canonical name rule');
}

console.log(fail ? `\n${fail} FAILURE(S), ${pass} passed` : `\nALL PASS (${pass})`);
process.exit(fail ? 1 : 0);
