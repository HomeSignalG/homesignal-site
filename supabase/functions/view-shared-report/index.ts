// view-shared-report — what a client who holds a share link may read (build step 8).
//
// Wiring only. The request logic is handler.ts, the reads are data.ts, the link's database call is _shared/share-reads.ts and the address read
// is _shared/private-subject.ts. This is the ONE Development Activity function deployed WITHOUT JWT verification: the client has no account,
// and the link's secret token is the only credential (deploy-edge-functions.yml passes --no-verify-jwt for it, and supabase/config.toml
// records verify_jwt = false). The handler therefore has no gate to lean on, and answers only a well-formed token that the database says is
// usable. Docs: docs/development-activity-report-engine-2026-09-30.md, "Step 8".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(makeHandler(makeDeps({ url, serviceKey }, (input, init) => fetch(input, init))));
