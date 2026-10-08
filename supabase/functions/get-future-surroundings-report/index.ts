// Canonical NYC V1 Future Surroundings Report JSON API.
// Socrata-only. Does not import the consumer report engine or the Census proxy.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { capability, loadReport, validateApiRequest } from './allowlist.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method === 'GET') return json(capability());
  if (req.method !== 'POST') return json({ error: 'GET capability or POST { address, zip, radius_mi }' }, 405);
  try {
    const body = await req.json().catch(() => null);
    const reqn = validateApiRequest(body);
    if (!reqn.ok) return json({ error: reqn.error }, 400);
    const report = await loadReport(reqn.address || '', reqn.zip || '', reqn.radius_mi || 0.5);
    return json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'allowlist retrieve failed';
    return json({ error: message }, 502);
  }
});
