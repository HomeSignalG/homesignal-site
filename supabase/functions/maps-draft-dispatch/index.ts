// maps-draft-dispatch — the "Create drafts" button's server half.
//
// ONE JOB: let the OWNER, from the Acquisition Dashboard, run the MAPS > Data Center Theme
// generator over the ZIP order they just uploaded. It decides nothing about eligibility,
// composition, themes, approval, scheduling or publishing. It dispatches
// homesignal-ingest/.github/workflows/bluesky-generate-maps.yml and returns.
//
// WHY A DISPATCH AND NOT A PORT. The generator is bluesky/generate-maps.mjs plus four libs
// (maps-eligibility, maps-datacenter, founder-zip-order, the composer). Re-implementing any
// of that here would create a SECOND copy of the 45-day window, the status gate, the
// trade-noise rules and the theme classifier — two implementations that drift, which is the
// failure this codebase has paid for repeatedly. Dispatching runs the one shipped generator,
// byte for byte, so the button can never disagree with a manual run.
//
// THE BROWSER NEVER HOLDS A CREDENTIAL. The page calls this function with the owner's own
// session JWT; the GitHub token lives only in this function's environment. Same posture as
// the dashboard's own header promise ("never posts and never holds the credential").
//
// Deploy: Actions -> deploy-edge-functions -> function = maps-draft-dispatch
// (deployed WITH JWT verification — it must never be --no-verify-jwt).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const OWNER_REPO = 'HomeSignalG/homesignal-ingest';
const WORKFLOW = 'bluesky-generate-maps.yml';
const REF = 'main';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const SB_URL = Deno.env.get('SUPABASE_URL') || '';
  const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const PAT = (Deno.env.get('GITHUB_ACTIONS_PAT') || '').trim();
  // FAIL CLOSED, and say WHICH thing is missing. An unset owner address must never mean
  // "let anyone through"; it means the function is misconfigured and refuses.
  const OWNER_EMAIL = (Deno.env.get('MAPS_OWNER_EMAIL') || '').trim().toLowerCase();
  if (!OWNER_EMAIL) {
    return json({ ok: false, error: 'MAPS_OWNER_EMAIL is not set — refusing to authorize anyone.' }, 500);
  }

  // ── 1. WHO IS ASKING ────────────────────────────────────────────────────────────────
  // Platform JWT verification only proves the token is a valid Supabase JWT — ANY signed-in
  // user has one. It does not prove this is the owner, so the identity is checked here too.
  const auth = req.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return json({ ok: false, error: 'Sign in to the dashboard first.' }, 401);
  }
  const asCaller = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  const email = (userData?.user?.email || '').trim().toLowerCase();
  if (userErr || !email) {
    return json({ ok: false, error: 'Could not read your session. Sign in again.' }, 401);
  }
  if (email !== OWNER_EMAIL) {
    return json({ ok: false, error: 'not authorized' }, 403);
  }

  // ── 2. WHAT IS BEING ASKED ──────────────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const apply = body.apply === true;                       // default DRY, never inferred true
  const limitRaw = Number(body.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 20;

  // ── 3. THE GUARD THAT MATTERS ───────────────────────────────────────────────────────
  // The generator enters FOUNDER-CURATED mode only when `zips` is blank AND an ordered list
  // exists. Blank `zips` with an EMPTY table is not a no-op — it falls through to a NATIONAL
  // traversal that reads the whole app_projects corpus (~24 minutes of runner time, measured;
  // an earlier one was cancelled at a 15-minute cap). A button must not be able to start that
  // by accident, so the list is checked BEFORE dispatching, not after.
  const asService = SB_SERVICE
    ? createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } })
    : asCaller;
  const { count, error: countErr } = await asService
    .from('maps_dc_zip_order')
    .select('zip', { count: 'exact', head: true });
  if (countErr) {
    return json({ ok: false, error: `Could not read the ZIP order: ${countErr.message}` }, 500);
  }
  if (!count) {
    return json({
      ok: false,
      error: 'No ZIP order is stored. Upload a CSV first — dispatching with an empty list '
        + 'would start a nationwide scan instead of your ordered run.',
    }, 409);
  }

  // ── 4. DISPATCH THE ONE SHIPPED GENERATOR ───────────────────────────────────────────
  if (!PAT) {
    return json({
      ok: false,
      error: 'GITHUB_ACTIONS_PAT is not set on this function, so the generator cannot be '
        + 'started. Add a fine-grained token with Actions: write on ' + OWNER_REPO + '.',
    }, 503);
  }
  const gh = await fetch(
    `https://api.github.com/repos/${OWNER_REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAT}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'homesignal-maps-draft-dispatch',
      },
      // `zips` is deliberately EMPTY: a non-empty value would take the --zips path, which
      // ignores the founder order entirely and re-applies the per-jurisdiction cap.
      body: JSON.stringify({
        ref: REF,
        inputs: { apply: apply ? 'true' : 'false', limit: String(limit), zips: '' },
      }),
    },
  );

  // A dispatch returns 204 with no body, so there is no run id to hand back. Say that
  // plainly rather than inventing one; the page reports progress from the draft count.
  if (gh.status === 204) {
    return json({ ok: true, dispatched: true, mode: apply ? 'apply' : 'dry_run', zips: count });
  }
  const detail = (await gh.text()).slice(0, 400);
  if (gh.status === 401 || gh.status === 403) {
    return json({
      ok: false,
      error: `GitHub refused the token (HTTP ${gh.status}). It is expired or lacks `
        + `Actions: write on ${OWNER_REPO}.`,
      detail,
    }, 502);
  }
  return json({ ok: false, error: `GitHub returned HTTP ${gh.status}`, detail }, 502);
});
