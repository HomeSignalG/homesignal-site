// manage-shared-report — a brokerage's agent makes, lists and withdraws the private client links to its own stored reports (build step 8).
//
// Wiring only. The request logic is handler.ts, the reads are data.ts, every link call is _shared/share-reads.ts and the gate is
// _shared/admin-gate.ts. JWT verification stays ON (supabase/config.toml), and the handler additionally requires a real signed-in user: the
// anon key passes the gateway, so the gateway alone is not a gate. The client who OPENS a link is view-shared-report, never this function.
// Docs: docs/development-activity-report-engine-2026-09-30.md, "Step 8".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(makeHandler(makeDeps({ url, serviceKey }, (input, init) => fetch(input, init))));
