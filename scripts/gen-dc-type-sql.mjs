#!/usr/bin/env node
// Writes the data-centre NAME rules of public.map_site_is_datacenter_type (the `d` and `e` CTEs in
// docs/fix28-datacenter-zip-membership.sql) from lib/project-type.js, so the SQL copy is generated,
// never retyped. Then regenerates docs/dc-build-scope-apply-2026-11-13.sql's function from that file.
//
//   node scripts/gen-dc-type-sql.mjs          write both files
//   node scripts/gen-dc-type-sql.mjs --check  exit 1 if either file differs from what it would write
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'lib/project-type.js'), 'utf8');
const re = (name) => {
  const m = src.match(new RegExp('const ' + name + ' = /([\\s\\S]*?)/i;'));
  if (!m) throw new Error('could not read ' + name + ' from lib/project-type.js');
  return m[1];
};
// JS -> POSIX ARE, the same translation test/fix28-datacenter-membership.test.mjs checks.
const px = (s) => s.replace(/\(\?:/g, '(').replace(/\\b/g, '\\y').replace(/\\d/g, '[0-9]');
const q = (name) => "'" + px(re(name)).replace(/'/g, "''") + "'";

const block = `d as (
  select n.*,
         (not (n.nm ~* ${q('DATACENTER_SERVING_RE')}
               and n.nm ~* ${q('DATACENTER_COMPETING_RE')})
          and ((n.nm ~* ${q('DATACENTER_RE')}
                and not n.nm ~* ${q('DATACENTER_NOT_RE')})
               or (n.nm ~* ${q('COMPUTE_FACILITY_RE')}
                   and (not n.nm ~* ${q('DATACENTER_COMPETING_RE')}
                        or n.nm ~* ${q('COMPUTE_FACILITY_JOINED_RE')})))) as nm_dc
  from n
),
e as (
  select d.*,
         (d.nm_dc and d.nm ~* ${q('DC_BUILD_SCOPE_RE')}
                  and not d.nm ~* ${q('DC_EQUIPMENT_ONLY_RE')}) as dc_build
  from d
)`;

const recPath = join(root, 'docs/fix28-datacenter-zip-membership.sql');
const rec = readFileSync(recPath, 'utf8');
const i = rec.indexOf('d as (\n  select n.*,');
const j = rec.indexOf('\n)\nselect case', i);
if (i < 0 || j < 0) throw new Error('could not find the d/e CTEs in ' + recPath);
const recNew = rec.slice(0, i) + block + rec.slice(j + 2);

const fn = (t) => {
  const a = t.indexOf('create or replace function public.map_site_is_datacenter_type');
  return t.slice(a, t.indexOf('$function$;', a) + 11);
};
const appPath = join(root, 'docs/dc-build-scope-apply-2026-11-13.sql');
const app = readFileSync(appPath, 'utf8');
const appNew = app.replace(fn(app), fn(recNew));

if (process.argv.includes('--check')) {
  const stale = [[recPath, rec, recNew], [appPath, app, appNew]].filter(([, a, b]) => a !== b).map(([p]) => p);
  if (stale.length) { console.error('stale (run node scripts/gen-dc-type-sql.mjs): ' + stale.join(', ')); process.exit(1); }
  console.log('docs/fix28-datacenter-zip-membership.sql and the apply file match lib/project-type.js');
} else {
  writeFileSync(recPath, recNew);
  writeFileSync(appPath, appNew);
  console.log('wrote ' + recPath + ' and ' + appPath);
}
