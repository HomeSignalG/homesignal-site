// development-activity-trial — join a brokerage's Development Activity trial, and read one's own trial (build step 5c).
//
// Wiring only. The request logic is handler.ts, the reads are data.ts, every trial call is _shared/evaluation-reads.ts and the gate
// is _shared/admin-gate.ts. JWT verification stays ON (supabase/config.toml), and the handler additionally requires a real signed-in
// user: the anon key passes the gateway, so the gateway alone is not a gate.
// Docs: docs/development-activity-report-engine-2026-09-30.md, "Step 5c".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(makeHandler(makeDeps({ url, serviceKey }, (input, init) => fetch(input, init))));
