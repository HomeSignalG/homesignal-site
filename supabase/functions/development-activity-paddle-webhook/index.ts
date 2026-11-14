// development-activity-paddle-webhook — wiring only (logic: handler.ts; Paddle's shapes: _shared/paddle-billing.ts). JWT verification is OFF in supabase/config.toml
// because Paddle sends no JWT; the signature over the raw body is the gate. The settings below are read here and nowhere else; none is ever printed or logged.
// Secrets (set as Edge Function secrets, never in the repo): PADDLE_WEBHOOK_SECRET_LIVE / PADDLE_WEBHOOK_SECRET_SANDBOX (the notification destination's secret key)
// and PADDLE_PRICE_ID_LIVE / PADDLE_PRICE_ID_SANDBOX (the Professional monthly price, pri_...). An environment with either missing is not accepted.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';
import { withSafeLog } from '../_shared/safe-log.ts';

const e = (k: string) => Deno.env.get(k) ?? '';
const deps = makeDeps({
  url: e('SUPABASE_URL'), serviceKey: e('SUPABASE_SERVICE_ROLE_KEY'),
  live: { secret: e('PADDLE_WEBHOOK_SECRET_LIVE'), priceId: e('PADDLE_PRICE_ID_LIVE') },
  sandbox: { secret: e('PADDLE_WEBHOOK_SECRET_SANDBOX'), priceId: e('PADDLE_PRICE_ID_SANDBOX') },
}, (input, init) => fetch(input, init), () => Math.floor(Date.now() / 1000));

Deno.serve(withSafeLog('development-activity-paddle-webhook', makeHandler(deps), (line) => console.log(line), () => Date.now()));
