// Offline invariant: EVERY connector STAMPS what its date MEANS, and the default is "filed".
//
// WHY. One unlabelled `.fdate` slot on the page was carrying four different semantics at once —
// filed (most permit ledgers), issued (bentonville ISSUED), scheduled/estimated start (fdot
// StartDate, lexington EstimatedStartDate) and decided (anne-arundel + dallas, substituted by the
// materializer's coalesce(file_date, decision_date)). A resident reading "Mar 2026" cannot tell
// which. docs/accuracy-audit-2026-08.md §F3 + §G1.
//
// This test pins piece (a) of the fix: the meaning is DECLARED per registry entry and carried on
// every emitted record, defaulting to "filed" so no entry needs editing to keep today's behaviour.
// It deliberately does NOT assert that any particular entry is correctly classified — that is
// piece (b), a per-entry judgment against the live layer, and a checker that guessed would be the
// exact failure this whole audit is about.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'supabase/functions/get-address-report/sources');
const registryPath = join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json');

const KINDS = ['filed', 'issued', 'scheduled', 'estimated', 'decided'];
// The five platform arrays index.ts actually binds. `opendatasoft` is staged data with no
// connector (the registry's own _opendatasoft_readme says so), so it has nothing to emit.
const LIVE_CONNECTORS = ['arcgis', 'socrata', 'ckan', 'csv', 'carto'];

const failures = [];

// 1. Every live connector emits the field, defaulting to "filed".
for (const name of LIVE_CONNECTORS) {
  const src = readFileSync(join(srcDir, `${name}.ts`), 'utf8');
  if (!src.includes('file_date_kind: entry.file_date_kind ?? "filed"')) {
    failures.push(`${name}.ts does not stamp file_date_kind with the "filed" default`);
  }
  // The emit must sit on the same record literal as file_date, or it would ride a different object.
  const iDate = src.indexOf('file_date: isoDay(');
  const iKind = src.indexOf('file_date_kind: entry.file_date_kind');
  if (iDate < 0 || iKind < 0 || iKind < iDate || iKind - iDate > 200) {
    failures.push(`${name}.ts: file_date_kind is not emitted alongside file_date`);
  }
}

// 2. The connector directory has no live connector this test forgot about — otherwise the check
//    would pass by not looking (an instrument must prove it ran over what it claims to cover).
const indexSrc = readFileSync(join(root, 'supabase/functions/get-address-report/index.ts'), 'utf8');
for (const name of readdirSync(srcDir)) {
  const m = /^([a-z0-9-]+)\.ts$/.exec(name);
  if (!m || name.includes('.test.')) continue;
  const id = m[1];
  if (LIVE_CONNECTORS.includes(id) || ['geo-fence', 'geo-input', 'tceq-cr', 'tdlr-tabs'].includes(id)) continue;
  if (indexSrc.includes(`}).${id} ?? []`)) {
    failures.push(`sources/${id}.ts is bound in index.ts but not covered by this test`);
  }
}

// 3. Any entry that DOES declare a kind must use a value the page can label.
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
let declared = 0;
for (const platform of [...LIVE_CONNECTORS, 'opendatasoft']) {
  for (const entry of registry[platform] || []) {
    if (!('file_date_kind' in entry)) continue;
    declared += 1;
    if (!KINDS.includes(entry.file_date_kind)) {
      failures.push(`${entry.registry_id}: file_date_kind "${entry.file_date_kind}" is not one of ${KINDS.join('|')}`);
    }
  }
}

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log(`file_date_kind: ${LIVE_CONNECTORS.length} connectors stamp it, default "filed"; ${declared} entr${declared === 1 ? 'y declares' : 'ies declare'} an explicit kind.`);
