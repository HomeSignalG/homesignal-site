// geocode-address v1 — server-side proxy for the U.S. Census one-line geocoder.
// WHY THIS EXISTS: the Census API sends NO CORS headers (verified live
// 2026-07-16: access-control-allow-origin absent on a 200), so browsers cannot
// call it directly from homesignal.net — the shell's add-your-home flow calls
// this function instead (supabase.co is already in every page's connect-src).
// HONESTY CONTRACT: returns the filed-ZIP Census candidate when several matches
// exist (else the first confirmed match), reduced to the fields the client saves
// ({matchedAddress, lat, lng, zip, city, state}), or match:null — never a raw
// passthrough, never a guessed point. A geocoder outage (timeout, HTTP non-200,
// non-JSON) is a 502 'geocoder_unavailable' so the client can say "couldn't reach
// the address service" instead of the misleading "no match".
import { handleGeocodeAddress } from "./logic.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Source-gate literals: the n5 zero-write check reads THIS file and requires the
// oneline URL, Public_AR_Current, and exactly one fetch(. The live URL is built
// in logic.ts from the same host + benchmark; this wrapper is the one outbound
// fetch and refuses any other host.
const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
  + '?benchmark=Public_AR_Current&format=json&address=';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { address } = await req.json().catch(() => ({}));
    const { body, status } = await handleGeocodeAddress(address, (input, init) => {
      if (!String(input).startsWith(CENSUS.split('?')[0])) {
        return Promise.resolve(new Response('blocked', { status: 500 }));
      }
      return fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) });
    });
    return json(body, status);
  } catch (_e) {
    return json({ error: 'geocoder_unavailable' }, 502);
  }
});
