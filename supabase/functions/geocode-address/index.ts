// geocode-address v1 — server-side proxy for the U.S. Census one-line geocoder.
// WHY THIS EXISTS: the Census API sends NO CORS headers (verified live
// 2026-07-16: access-control-allow-origin absent on a 200), so browsers cannot
// call it directly from homesignal.net — the shell's add-your-home flow calls
// this function instead (supabase.co is already in every page's connect-src).
// HONESTY CONTRACT: returns ONLY the first confirmed match, reduced to the
// fields the client saves ({matchedAddress, lat, lng, zip, city, state}), or
// match:null — never a raw passthrough, never a guessed point. A geocoder
// outage is a 502 'geocoder_unavailable' so the client can say "couldn't reach
// the address service" instead of the misleading "no match".
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { address } = await req.json().catch(() => ({}));
    const q = String(address || '').trim().slice(0, 200);
    if (q.length < 8 || q.indexOf(' ') < 0) return json({ match: null });
    const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
      + '?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(q);
    const r = await fetch(u);
    if (!r.ok) return json({ error: 'geocoder_unavailable' }, 502);
    const j = await r.json();
    const m = j?.result?.addressMatches?.[0] ?? null;
    const match = (m && m.coordinates && m.addressComponents?.zip) ? {
      matchedAddress: m.matchedAddress || q,
      lat: m.coordinates.y, lng: m.coordinates.x,
      zip: m.addressComponents.zip,
      city: m.addressComponents.city || null,
      state: m.addressComponents.state || null,
    } : null;
    return json({ match });
  } catch (_e) {
    return json({ error: 'geocoder_unavailable' }, 502);
  }
});
