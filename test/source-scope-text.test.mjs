// SOURCE WORK DESCRIPTIONS (column_map.scope_text), 2026-11-02, founder "agree do all": the sources whose records the report could not judge
// because the title never read their description column now carry it as `scope_text`, which the relevance rule already reads.
// The sampled values below are verbatim from the publishers' own layers, read through pg_net on 2026-11-02.
// Run: node test/source-scope-text.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let fails = 0, total = 0;
const ok = (c, name, detail) => { total++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 600)); } };

const S = await import('../supabase/functions/get-address-report/sources/scope-text.ts');
const M = await import('../supabase/functions/_shared/national-report.ts');
const bumb = 'Temporary installation of mobile stage   3 Geodesic Domes and skateboard half pipe for Bumbershoot 2026.  Installation will be open to the public from 9/5-9/6  load in will start 9/1 and all structures will be removed by 9/8.';

// ---- 1. the helper -----------------------------------------------------------------------------------------------------------------
{
  ok(S.scopeTextOf('  SMPR:   Kitchen\r\n remodel ', 'x') === 'SMPR: Kitchen remodel', '1a whitespace and line breaks collapse');
  ok(S.scopeTextOf('Dept:Planning User:nancy.tyler - ', 'x') === 'Dept:Planning -', '1b an account name ("User: …") is never kept', S.scopeTextOf('Dept:Planning User:nancy.tyler - ', 'x'));
  ok(!/@/.test(S.scopeTextOf('New home GC email on app: office@example.com call', 'x')), '1c an email address is never kept');
  ok(S.scopeTextOf('Residential', 'residential') === null && S.scopeTextOf('', 'a') === null && S.scopeTextOf(null, 'a') === null
    && S.scopeTextOf({ a: 1 }, 'a') === null && S.scopeTextOf('   ', 'a') === null, '1d empty, non-text, or a copy of the title is dropped');
  const long = ('word ').repeat(200), cut = S.scopeTextOf(long, 'x');
  ok(cut.length <= S.SCOPE_TEXT_CAP + 1 && cut.endsWith('…') && !/wor…$/.test(cut) && S.SCOPE_TEXT_CAP === 300, '1e a long description is cut at a word, at 300 characters, and says so', cut.length);
  const kept = S.scopeTextOf(bumb, 'Commercial ' + bumb);
  ok(kept && /removed by 9\/8/.test(kept) && S.scopeTextOf('Kitchen remodel', 'RESI Kitchen remodel') === null,
    '1g a description longer than the 120-character label is kept even when the title is the same text (Seattle Bumbershoot); one the label already shows is dropped');
  ok(JSON.stringify(S.scopeField('Change in Use', 'Commercial Building')) === '{"scope_text":"Change in Use"}' && JSON.stringify(S.scopeField(null, 'a')) === '{}',
    '1f scopeField spreads { scope_text } or nothing');
}

// ---- 2. every connector carries it the same way ------------------------------------------------------------------------------------
{
  for (const f of ['arcgis', 'socrata', 'ckan', 'csv', 'carto']) {
    const src = read('supabase/functions/get-address-report/sources/' + f + '.ts');
    ok(/import \{ scopeField \} from "\.\/scope-text\.ts";/.test(src) && (src.match(/\.\.\.scopeField\(readCol\(row, cm\.scope_text\), title\),/g) || []).length === 1,
      '2 ' + f + ': reads column_map.scope_text once, through the shared helper');
  }
  const soc = read('supabase/functions/get-address-report/sources/socrata.ts');
  ok(/scope_text\?: ColumnRef;/.test(soc), '2b ColumnMap declares scope_text');
  ok(/scope_text/.test(read('docs/dev-change-ledger.sql').split('\n').find((l) => /retrieval and scoring noise/.test(l)) || ''),
    '2c the change ledger does not judge scope_text, so a new description creates no change events');
}

// ---- 3. the registry: the six sources, and any projection lists the column -------------------------------------------------------
{
  const reg = JSON.parse(read('supabase/functions/get-address-report/jurisdiction-registry.json'));
  const want = { 'seattle-building-permits': 'description', 'seattle-land-use-permits': 'description', 'wa-ecology-sepa-register': 'proposaldescription', 'brunswick-county-permits': 'Description', 'durham-building-permits': 'DESCRIPTION', 'cleveland-issued-building-permits': 'WORK_DESCRIPTION',
    'sioux-falls-building-permits': 'WORKCLASS', 'san-jose-permits': 'WORKDESC', 'arlington-issued-permits': 'WORKDESC' };
  const all = ['socrata', 'arcgis', 'ckan', 'csv', 'carto'].flatMap((k) => reg[k] || []);
  const got = Object.fromEntries(all.filter((e) => e.column_map && e.column_map.scope_text).map((e) => [e.registry_id, e.column_map.scope_text]));
  ok(Object.entries(want).every(([k, v]) => got[k] === v), '3a the nine sources read their own description column', got);
  const missing = all.filter((e) => e.column_map && e.column_map.scope_text && Array.isArray(e.out_fields)
    && ![].concat(e.column_map.scope_text).every((c) => e.out_fields.includes(c))).map((e) => e.registry_id);
  ok(missing.length === 0, '3b a source that projects its columns (out_fields) also fetches its description column', missing);
  ok(!Object.values(got).some((c) => /COMMENT|NOTE|CONDITION|CONTRACTOR|APPLICANT|OWNER/i.test([].concat(c).join())),
    '3c no source reads a comments, notes, conditions or party column as its description (those carry emails and names)', got);
}

// ---- 4. the relevance rule judges these records now (real sampled values) ---------------------------------------------------------
{
  const rel = (name, type_raw, scope_text, tk, reg) => M.relevance({ name, type_raw, scope_text, registry_id: reg }, tk);
  const brNew = rel('Residential', 'Residential', 'New Home Stories: 1 Foundation Type: Stem Wall w/Slab Sq. Ft. Under Roof: 3854 Bedrooms: 3', 'residential', 'brunswick-county-permits');
  const before = M.relevance({ name: 'Residential', type_raw: 'Residential', registry_id: 'brunswick-county-permits' }, 'residential');
  ok(!before.include && before.reason === 'not_established' && brNew.include && brNew.basis === 'new_construction', '4a a Brunswick new home could not be judged from its title; with its description it is new construction', [before, brNew]);
  ok(rel('RESI', 'RESI', 'SMPR: Kitchen remodel', 'residential', 'durham-building-permits').reason === 'routine_work', '4b a Durham kitchen remodel is routine work');
  const cu = rel('Commercial Building', 'Commercial Building', 'Change in Use', 'commercial', 'sioux-falls-building-permits');
  ok(cu.include && cu.basis === 'change_of_use' && M.RELEVANCE_RULE_VERSION === 'relevance-2', '4c "Change in Use" (Sioux Falls) is a change of use (relevance-2)', cu);
  ok(rel('Single-Family', 'Single-Family', 'Demolition', 'residential', 'arlington-issued-permits').basis === 'demolition', '4d an Arlington demolition is listed as one');
  ok(rel('Apartment', 'Apartment', 'Additions/Alterations', 'residential', 'san-jose-permits').basis === 'addition', '4e a San Jose apartment addition is listed as one');
  ok(!rel('Single-Family', 'Single-Family', 'Sub-Trades Only', 'residential', 'san-jose-permits').include, '4f trade-only work stays out');
  const t = M.temporaryTiming({ name: ('Commercial ' + bumb).slice(0, 120), scope_text: S.scopeTextOf(bumb, 'Commercial ' + bumb) }, '2026-11-02', true);
  ok(t.status === 'ended' && t.end === '2026-09-08', '4g with its description, Seattle\'s Bumbershoot permit is judged on its documented window: ended (not "timing not captured")', t);
}

console.log(`\n${total - fails} passed, ${fails} failed of ${total}`);
process.exit(fails ? 1 : 0);
