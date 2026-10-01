// ECHO / CWA OUTCOMES MUST LAND ON THE ZIP ROW, AND A FAILED CALL MUST NOT WIPE ENV.
//
// WHY THIS FILE EXISTS. sources/echo-cwa.ts now returns echo/cwa on the report
// body, but that is worthless if collect throws them away and copies incoming
// facilities verbatim. The SQL of record (docs/dev-refresh-echo-health.sql)
// persists the outcomes, merges last-known-good env.epa when ok:false, and
// names the wipe-signature ZIPs without firing a refresh.
//
// CI has no database. Shape is pinned against the SQL of record. Semantics of
// the merge are driven here — the same truth table as preserveStoredEnv.
//
// Run: node test/dev-refresh-echo-health.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/dev-refresh-echo-health.sql'), 'utf8');
const collectOnce = readFileSync(join(root, 'docs/dev-refresh-collect-once-per-response.sql'), 'utf8');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

// ── persist ────────────────────────────────────────────────────────────────
ok(/add column if not exists echo jsonb/.test(sql) && /add column if not exists cwa jsonb/.test(sql),
  'development_reports gains echo and cwa jsonb columns');
ok(/echo           = case when j \? 'echo' then j->'echo' else d\.echo end/.test(sql),
  'collect stores j->echo when present and keeps the stored value when the key is missing');
ok(/cwa            = case when j \? 'cwa'  then j->'cwa'  else d\.cwa  end/.test(sql),
  'collect stores j->cwa the same way');
ok(/coalesce\(\(_j->'echo'->>'ok'\)::boolean, true\)/.test(sql),
  'a payload with no echo key defaults to ok (pre-v25 reports stay byte-identical)');

// ── merge wiring ───────────────────────────────────────────────────────────
ok(/dev_echo_merge_facility_sites/.test(sql) && /dev_echo_apply_stored_epa/.test(sql),
  'the merge is a named function, not inlined five times');
ok(/else public\.dev_echo_merge_facility_sites\(/.test(sql),
  'the collect else-branch (payload facilities) goes through the merge');
ok(/pg_get_functiondef/.test(sql) && /hits <> 1 then/.test(sql),
  'collect is patched from the live body; a missing anchor raises');
ok(/echo health collect patch already applied/.test(sql),
  're-applying the collect patch is a no-op');

// The parked once-per-response body still has the raw else-branch — this file
// is the overlay, not a silent rewrite of that document.
ok(/else coalesce\(\(select jsonb_agg\(x order by o\)/.test(collectOnce),
  'control — the older collect-of-record still shows the unmerged else-branch');

// ── worklist ───────────────────────────────────────────────────────────────
ok(/v_echo_wipe_candidates/.test(sql) && /facilities_unavailable/.test(sql),
  'the wipe view keys on FRS-available + ≥5 facilities + zero env.epa');
ok(/01610/.test(sql) && /27518/.test(sql) && /78723/.test(sql) && /10560/.test(sql),
  'the named whole-call failures are on the queue helper');
{
  const start = sql.indexOf('create or replace function public.dev_echo_queue_wipe_retries');
  const end = sql.indexOf('comment on function public.dev_echo_queue_wipe_retries');
  const body = start >= 0 && end > start ? sql.slice(start, end) : '';
  ok(body.length > 0 && !/http_post/.test(body) && !/dev_refresh_fire_targets/.test(body),
    'the queue helper body does not fire (no http_post / fire_targets)');
}
ok(/revoke all on public\.v_echo_wipe_candidates from public, anon, authenticated/.test(sql),
  'the wipe view is not a public Data API surface');

// ── merge semantics (driven, not read) ─────────────────────────────────────
const ECHO_KEYS = ['in_violation', 'snc', 'quarters_nc', 'inspections', 'action_year', 'penalty_count', 'current_as_of'];
const CWA_KEYS = ['permits', 'permit_status', 'compliance_tracking_on'];

function applyStored(site, storedEpa, echoOk, cwaOk) {
  if (!storedEpa) return site;
  const env = { ...(site.env || {}) };
  const epa = { ...(env.epa || {}) };
  let copied = false;
  if (!echoOk) {
    for (const k of ECHO_KEYS) {
      if (epa[k] == null && storedEpa[k] != null) { epa[k] = storedEpa[k]; copied = true; }
    }
  }
  if (!cwaOk) {
    for (const k of CWA_KEYS) {
      if (epa[k] == null && storedEpa[k] != null) { epa[k] = storedEpa[k]; copied = true; }
    }
  }
  if (!copied) return site;
  return { ...site, env: { ...env, link_type: env.link_type || 'geo_matched', epa } };
}

function merge(incoming, stored, report) {
  const echoOk = report.echo && typeof report.echo.ok === 'boolean' ? report.echo.ok : true;
  const cwaOk = report.cwa && typeof report.cwa.ok === 'boolean' ? report.cwa.ok : true;
  const byId = new Map();
  for (const s of stored) {
    const id = String(s.registry_id || '').trim();
    if (id && s.env && s.env.epa) byId.set(id, s.env.epa);
  }
  return incoming.map((s) => {
    if (echoOk && cwaOk) return s;
    return applyStored(s, byId.get(String(s.registry_id || '').trim()), echoOk, cwaOk);
  });
}

const stored = [{
  registry_id: '110000000001',
  env: { epa: { in_violation: ['CAA'], current_as_of: '2026-08-01', permit_status: 'Effective', compliance_tracking_on: true } },
}];
const incoming = [{ registry_id: '110000000001', label: 'Fixture' }];

{
  const out = merge(incoming, stored, { echo: { ok: false }, cwa: { ok: false } });
  ok(out[0].env.epa.in_violation[0] === 'CAA' && out[0].env.epa.permit_status === 'Effective',
    'failed ECHO+CWA restore both halves from the store');
}
{
  const out = merge(incoming, stored, { echo: { ok: true, matched: 0 }, cwa: { ok: true, matched: 0 } });
  ok(!out[0].env,
    'a successful empty answer does not resurrect stored env');
}
{
  const out = merge(incoming, stored, {});
  ok(!out[0].env,
    'a pre-v25 payload with no echo key does not merge (coalesce ok)');
}
{
  const fresh = [{
    registry_id: '110000000001',
    env: { epa: { in_violation: ['RCRA'], current_as_of: '2026-09-27' } },
  }];
  const out = merge(fresh, stored, { echo: { ok: true }, cwa: { ok: false } });
  ok(out[0].env.epa.in_violation[0] === 'RCRA' && out[0].env.epa.permit_status === 'Effective',
    'ECHO success + CWA failure keeps this-run compliance and fills permit fields');
}
{
  const other = [{ registry_id: '110000000099', label: 'Neighbor' }];
  const out = merge(other, stored, { echo: { ok: false }, cwa: { ok: true } });
  ok(!out[0].env, 'restore is keyed on registry id — a neighbor does not inherit');
}

console.log(fails === 0 ? '\nALL PASS — dev-refresh-echo-health' : `\n${fails} FAILURE(S) — dev-refresh-echo-health`);
process.exit(fails === 0 ? 0 : 1);
