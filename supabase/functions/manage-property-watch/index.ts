// manage-property-watch — a brokerage's agent starts, lists and stops watching the property of one of its own stored reports (build step 9).
//
// Wiring only. The request logic is handler.ts, the reads are data.ts, every watch call is _shared/watch-reads.ts and the gate is
// _shared/admin-gate.ts. JWT verification stays ON (supabase/config.toml), and the handler additionally requires a real signed-in user: the
// anon key passes the gateway, so the gateway alone is not a gate. The daily check itself is run-property-watch, never this function.
// Docs: docs/development-activity-report-engine-2026-09-30.md, "Step 9".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(makeHandler(makeDeps({ url, serviceKey }, (input, init) => fetch(input, init))));
