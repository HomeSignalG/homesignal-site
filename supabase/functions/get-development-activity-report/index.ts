// get-development-activity-report — the national HOMESIGNAL DEVELOPMENT ACTIVITY report (Development Activity plan, Order G).
//
// Wiring only. The request logic is handler.ts, the reads are data.ts, the composition is _shared/national-report.ts, and the
// rights registry (empty: nothing is cleared) is _shared/report-rights.json. JWT verification stays ON (supabase/config.toml)
// and the handler additionally requires a signed-in, allow-listed user: the anon key passes the gateway, so the gateway alone
// is not a gate. Docs: docs/development-activity-report-engine-2026-09-30.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import rights from '../_shared/report-rights.json' with { type: 'json' };
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';
import { withSafeLog } from '../_shared/safe-log.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// one fixed-text log line per request (name, status, milliseconds): _shared/safe-log.ts. Nothing from the request or the answer is ever logged.
Deno.serve(withSafeLog('get-development-activity-report', makeHandler(makeDeps({ url, serviceKey, rights }, (input, init) => fetch(input, init))), (line) => console.log(line), () => Date.now()));
