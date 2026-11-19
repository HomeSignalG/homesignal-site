// national-8 (2026-11-19): Boulder audit, universal classification corrections (relevance-4). Texts are wording from the audited records; no place is named by the rule.
// Run: node test/report-quality-national8.test.mjs
globalThis.window = globalThis;
await import('../lib/project-type.js');
const M = await import('../supabase/functions/_shared/national-report.ts');
let fails = 0;
const ok = (c, n, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d)); } };
const R = (name, type_raw = 'Building Permit', typeKey = 'commercial') => M.relevance({ name, type_raw }, typeKey, null);
const out = (r) => (r.include ? r.basis : 'x:' + r.reason);
const cases = [
  ['parking garage concrete crack repairs and stair replacements, 5 story garage', 'Non-Residential', 'commercial', (r) => !r.include],
  ['Revision to fire rating of existing 3 story building walls', 'Mixed Use', 'commercial', (r) => !r.include || r.basis !== 'new_construction'],
  ['Interior alterations in existing warehouse and fulfillment space', 'Non-Residential', 'commercial', (r) => !r.include],
  ['Two-story amenity addition to existing fraternity houses', 'Building Permit', 'commercial', (r) => r.include && r.basis === 'addition'],
  ['Tenant buildout of existing office. No change of use and no change in square footage.', 'Building Permit', 'commercial', (r) => !r.include && r.reason === 'routine_work'],
  ['Renovation of existing office space; no change in use', 'Building Permit', 'commercial', (r) => !r.include],
  ['Demolition of interior office partitions', 'Building Permit', 'commercial', (r) => !r.include],
  ['Tenant finish of suite, no structural work, includes demolition of existing finishes', 'Building Permit', 'commercial', (r) => !r.include],
  ['Interior demolition and reconstruction of office space', 'Building Permit', 'commercial', (r) => !r.include],
  ['Pilates studio tenant finish and storefront work including demolition', 'Building Permit', 'commercial', (r) => !r.include],
  ['Construct a new three-story, 23-unit multifamily building', 'Building Permit', 'residential', (r) => r.include && r.basis === 'new_construction'],
  ['Bathroom water damage repair', 'Residential Building Permit', 'residential', (r) => !r.include],
  ['Like-for-like window replacements', 'Residential Building Permit', 'residential', (r) => !r.include],
  ['Addition of a 96 square foot balcony to existing house', 'Residential Building Permit', 'residential', (r) => r.include && r.basis === 'addition'],
  // controls: genuine changes survive
  ['Demolish the existing building to construct new 12 story hotel', 'Building Permit', 'commercial', (r) => r.include && r.basis === 'demolition'],
  ['Change of use from retail to restaurant', 'Building Permit', 'commercial', (r) => r.include && r.basis === 'change_of_use'],
  ['Change of use to office; no change in occupant load', 'Building Permit', 'commercial', (r) => r.include && r.basis === 'change_of_use'],
  ['Erect 4-story 40-unit apartment building', 'Building Permit', 'residential', (r) => r.include && r.basis === 'new_construction'],
];
for (const [t, tr, tk, f] of cases) { const r = R(t, tr, tk); ok(f(r), t.slice(0, 70) + ' -> ' + out(r), r); }
ok(M.RELEVANCE_RULE_VERSION === 'relevance-4', 'rule version');
// wording and share-box pins (the view and share-modal are read as source)
import { readFileSync } from 'node:fs';
const view = readFileSync(new URL('../lib/da-report-view.js', import.meta.url), 'utf8');
const share = readFileSync(new URL('../lib/share-modal.js', import.meta.url), 'utf8');
ok(/The official record does not specify a construction schedule or potential impacts on nearby properties\./.test(view) && !/states no schedule and no effect/.test(view), 'QoL wording replaced');
ok(/Coverage: This report reflects development activity identified within the property\\'s search radius/.test(view) && !/official source feed/.test(view), 'coverage wording replaced, no feed count');
ok(/data-da-overview="' \+ firstN/.test(view) && /data-da-type="' \+ esc\(typeKeyOf\(p\)\) \+ '" data-da-stage="' \+ \(stageKey\(p\)/.test(view), 'overview and history carry the Type and Stage filter hooks');
ok(/svg: 'M10\.6/.test(share) && /appLink\(h\) \? ''/.test(share), 'Copy link icon is an SVG; mailto/sms links open no new tab');
process.exit(fails ? 1 : 0);
