// run-property-watch — the daily check of every watched property (build step 9). Called by the database's scheduler (pg_cron through pg_net),
// never by a person and never by a page.
//
// Wiring only. The request logic is handler.ts, the reads are data.ts. JWT verification stays ON (supabase/config.toml) and the scheduler sends
// the project's public key, which the gateway accepts; the handler then requires the project's private SIGNUP_HOOK_SECRET in the
// `x-signup-secret` header, compared in constant time, and refuses everything when that secret is not configured. The same secret and the same
// mail provider the pipeline-health alert already uses (RESEND_API_KEY): one adapter, no second mail service.
// Docs: docs/development-activity-watch-2026-10-03.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import rights from '../_shared/report-rights.json' with { type: 'json' };
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const secret = Deno.env.get('SIGNUP_HOOK_SECRET') ?? '';
const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';

Deno.serve(makeHandler(makeDeps({ url, serviceKey, rights, secret, resendKey }, (input, init) => fetch(input, init))));
