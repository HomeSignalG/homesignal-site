#!/usr/bin/env node
// EXTERNAL ingest heartbeat check — runs in homesignal-site (PUBLIC, free Actions) so it survives
// whatever stops the private homesignal-ingest repo.
//
// Reads the newest heartbeat time with the PUBLIC ANON KEY through rpc/ingest_heartbeat_latest
// (docs/ingest-heartbeat-latest.sql). The anon key cannot read the table itself since the
// 2026-09-26 lockdown. No PAT, no write key, no GitHub API.
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

const url = `${SUPABASE_URL}/rest/v1/rpc/ingest_heartbeat_latest`;

let latestFinished;
try {
  const r = await fetch(url, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
               'Content-Type': 'application/json' },
    body: JSON.stringify({ p_workflow: WORKFLOW }),
  });
  if (!r.ok) {
    console.error(`FAIL: heartbeat read returned HTTP ${r.status} — ${await r.text()}`);
    process.exit(1);   // unreadable is an alarm, for the same reason as above
  }
  latestFinished = await r.json();   // a timestamp string, or null when no run is recorded
} catch (e) {
  console.error(`FAIL: heartbeat read threw — ${e.message}`);
  process.exit(1);
}

const res = evaluateHeartbeat({
  now: new Date(),
  latestFinished: typeof latestFinished === 'string' ? latestFinished : null,
  thresholdHours: Number(process.env.HEARTBEAT_THRESHOLD_HOURS) || HEARTBEAT_THRESHOLD_HOURS,
});

console.log(`workflow=${WORKFLOW} state=${res.state} ${res.reason}`);

if (!res.ok) {
  // GitHub renders ::error:: at the top of the run AND in the failure email.
  console.log(`::error::homesignal-ingest heartbeat ${res.state}: ${res.reason}`);
  process.exit(1);
}
console.log('OK — the ingest pipeline reported a successful run inside the threshold.');
