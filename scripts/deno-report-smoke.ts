// scripts/deno-report-smoke.ts. Run with NO permissions (no --allow-* flag). Imports only modules with no top-level Deno.* calls
// (verified by grep: handler.ts, _shared/*.ts, sources/source-dates.ts). Never imports an index.ts (those call Deno.serve).
import { makeHandler as dar } from '../supabase/functions/get-development-activity-report/handler.ts';
import { makeHandler as fol } from '../supabase/functions/follow-development-report/handler.ts';
import { makeHandler as wat } from '../supabase/functions/run-property-watch/handler.ts';
import { verification, FRESHNESS_RULE } from '../supabase/functions/_shared/national-report.ts';
import { sourceDatesOf, dateBasisOf } from '../supabase/functions/_shared/record-dates.ts';
import { categoryCoverage, COVERAGE_CATEGORIES_RULE } from '../supabase/functions/_shared/coverage-categories.ts';
import { sourceDatesField } from '../supabase/functions/get-address-report/sources/source-dates.ts';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fails++; };
// handlers answer a CORS preflight before touching any dependency, so an empty deps object proves nothing was reached
for (const [n, h] of [['get-development-activity-report', dar], ['follow-development-report', fol], ['run-property-watch', wat]] as const) {
  const r = await (h as (d: unknown) => (q: Request) => Promise<Response>)({})(new Request('https://x.invalid/', { method: 'OPTIONS', headers: { origin: 'https://jodytracks.com' } }));
  ok(r.status === 200 || r.status === 204, n + ' answers a preflight with no dependency touched');
}
ok(FRESHNESS_RULE === 'freshness-2' && COVERAGE_CATEGORIES_RULE === 'coverage-categories-2', 'rule versions');
ok(dateBasisOf('record_created') === 'record_created' && dateBasisOf('x') === 'unstated', 'date basis vocabulary');
ok(sourceDatesOf({ source_dates: { updated: '2026-11-19' } }, '2026-11-20')?.updated === '2026-11-19', 'a real source date is carried');
ok(sourceDatesOf({ source_dates: { updated: '9999-01-01' } }, '2026-11-20') === null, 'a sentinel date is dropped');
const old = verification({ kind: 'filed', date: '2024-01-01' }, 'permitted', [], '2026-11-20', { basis: 'record_created' });
ok(old?.reason === 'creation_only', 'creation date alone does not clear verify');
ok(verification({ kind: 'filed', date: '2024-01-01' }, 'permitted', [], '2026-11-20', { basis: 'record_created', statusUpdated: '2026-11-01' }) === null, 'a status-update date does');
const cc = categoryCoverage([{ state: 'UT', county: 'Utah' }] as never, []);
ok(cc.not_connected.length === 0 && cc.not_established.length === 4, 'no applicable source: nothing claimed missing');
ok(JSON.stringify(sourceDatesField({ a: 1 }, { source_updated: 'a' } as never, (r: any, k: any) => r[k], () => '2026-11-19')) === '{"source_dates":{"updated":"2026-11-19"}}', 'connector helper');
Deno.exit(fails ? 1 : 0);
