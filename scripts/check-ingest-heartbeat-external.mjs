#!/usr/bin/env node
// EXTERNAL ingest heartbeat check — runs in homesignal-site (PUBLIC, free Actions) so it survives
// whatever stops the private homesignal-ingest repo.
//
// Reads public.ingest_run_heartbeat with the PUBLIC ANON KEY. No PAT, no write key, no GitHub API.
// Evaluation logic and its self-tests: scripts/lib/ingest-heartbeat.mjs + test/ingest-heartbeat.test.mjs
//
// Exit 0 = healthy. Exit 1 = alarm (fails the scheduled workflow, which is the alarm channel).
import { evaluateHeartbeat, HEARTBEAT_THRESHOLD_HOURS } from './lib/ingest-heartbeat.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qwnnmljucajnexpxdgxr.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WORKFLOW = process.env.HEARTBEAT_WORKFLOW || 'ingest';

if (!SUPABASE_ANON_KEY) {
  console.error('FAIL: SUPABASE_ANON_KEY is not set — the check cannot run.');
  // ⚠️ EXIT 1, NOT 0. "Could not run" must never be reported as "healthy": that is the class where
  // a green check attests to nothing. An instrument has to prove it ran before its silence counts.
  process.exit(1);
}

const url = `${SUPABASE_URL}/rest/v1/ingest_run_heartbeat`
  + `?workflow=eq.${encodeURIComponent(WORKFLOW)}`
  + `&select=finished_at,run_id,rows_written`
  + `&order=finished_at.desc&limit=1`;

let rows;
try {
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!r.ok) {
    console.error(`FAIL: heartbeat read returned HTTP ${r.status} — ${await r.text()}`);
    process.exit(1);   // unreadable is an alarm, for the same reason as above
  }
  rows = await r.json();
} catch (e) {
  console.error(`FAIL: heartbeat read threw — ${e.message}`);
  process.exit(1);
}

const latest = Array.isArray(rows) && rows.length ? rows[0] : null;
const res = evaluateHeartbeat({
  now: new Date(),
  latestFinished: latest?.finished_at,
  thresholdHours: Number(process.env.HEARTBEAT_THRESHOLD_HOURS) || HEARTBEAT_THRESHOLD_HOURS,
});

console.log(`workflow=${WORKFLOW} state=${res.state} ${res.reason}`);
if (latest) console.log(`  newest run_id=${latest.run_id ?? '(none)'} rows_written=${latest.rows_written ?? '(none)'}`);

if (!res.ok) {
  // GitHub renders ::error:: at the top of the run AND in the failure email.
  console.log(`::error::homesignal-ingest heartbeat ${res.state}: ${res.reason}`);
  process.exit(1);
}
console.log('OK — the ingest pipeline reported a successful run inside the threshold.');
