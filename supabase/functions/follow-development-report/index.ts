// follow-development-report — Changes Since Report and Follow for a stored Development Activity report.
//
// Wiring only. The request logic is handler.ts, the reads and the one write are data.ts, the reader is
// _shared/changes-since-report.ts, the gate is _shared/admin-gate.ts, and the source attribution file (credit lines only) is
// _shared/source-attribution.json. JWT verification stays ON (supabase/config.toml) and the handler additionally requires a signed-in,
// allow-listed user: the anon key passes the gateway, so the gateway alone is not a gate.
// Docs: docs/development-activity-follow-changes-2026-10-01.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import attribution from '../_shared/source-attribution.json' with { type: 'json' };
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(makeHandler(makeDeps({ url, serviceKey, attribution }, (input, init) => fetch(input, init))));
