// The label/activity table inside lib/residential-qualify.js is GENERATED from the registry's
// own column_map.title column NAMES. This re-derives it and fails on any drift, so the shipped
// browser table can never disagree with jurisdiction-registry.json — the same drift control the
// SQL generator gives the vocabulary.
//
// Run: node test/residential-name-kind.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
global.window = { HS: {} };
await import('../lib/residential-qualify.js');
const shipped = global.window.HS.RESIDENTIAL_VOCABULARY.name_kind_label;
const { deriveTable, nameKindFor } = await import('../scripts/residential-name-kind.mjs');
const derived = deriveTable(new URL('../supabase/functions/get-address-report/jurisdiction-registry.json',
                                    import.meta.url).pathname);

const derivedLabel = Object.keys(derived).filter((k) => derived[k] === 'label').sort();
const shippedLabel = Object.keys(shipped).sort();
const missing = derivedLabel.filter((k) => !shipped[k]);
const extra = shippedLabel.filter((k) => derived[k] !== 'label');
ok(missing.length === 0, '1: every label-kind registry is in the shipped table — missing: ' + (missing.join(', ') || 'none'));
ok(extra.length === 0, '2: the shipped table carries no family the registry does not call label — extra: ' + (extra.join(', ') || 'none'));
ok(shippedLabel.length > 40, '3: the table is populated (' + shippedLabel.length + ' families) — an empty table would silently disable the place-name rule');

// Proven load-bearing in BOTH directions, so the classifier cannot be a rubber stamp.
ok(nameKindFor({ column_map: { title: ['PLAN_TITLE'] } }) === 'label', '4: a plan-title-only family is label');
ok(nameKindFor({ column_map: { title: ['permittypemapped', 'description'] } }) === 'activity',
  '5: a family with a description column is activity');
ok(nameKindFor({ column_map: { title: ['ProjectType', 'ParcelAddress'] } }) === 'activity',
  '6: a class column plus an address is activity — the class is real evidence');
ok(nameKindFor({ column_map: {} }) === 'label',
  '7: no title mapping at all is label — unknown text must never be read as activity');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
