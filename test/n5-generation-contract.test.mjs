// n5-generation-contract.test.mjs — the N5 freshness contract, pinned structurally.
//
// These are STRUCTURAL pins, and that is deliberate: the objects they protect live in the
// database and the sandbox has no egress to it, so a behavioural suite here would be a
// suite that cannot run. What can be pinned offline is the SHAPE of the producer — which
// contract it reads, which joins gate eligibility, and whether generation identity is
// carried — and every defect this workstream found was a shape defect.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const shard = readFileSync('scripts/n5_shard.py', 'utf8');
const orch  = readFileSync('scripts/n5_orchestrate.py', 'utf8');
const ddl   = readFileSync('docs/n5-generation-contract.sql', 'utf8');

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };

// ── §1 ELIGIBILITY: n5_accepted_source may classify, never exclude ───────────────────
// Founder ruling D-1. The INNER JOIN here silently removed an entire registry
// (baltimore-city-housing-permits, 3,018 rows) from geography the moment the source
// catalogue grew past the list.
ok(!/\n\s*join\s+geo\.n5_accepted_source/i.test(shard),
  '§1a n5_shard.py must not INNER JOIN geo.n5_accepted_source — that is an eligibility gate');
ok(/left\s+join\s+geo\.n5_accepted_source/i.test(shard),
  '§1b the LEFT JOIN must remain: treatment is still read, it just cannot exclude');
ok(/coalesce\(a\.treatment,\s*'UNCLASSIFIED'\)/.test(shard),
  '§1c an unknown treatment must become an explicit UNCLASSIFIED, never NULL-by-accident');

// COORDINATES ARE NOT ELIGIBILITY. 59,620 live development rows carry no lat/lng and are
// still in scope; geometry is resolved downstream.
ok(!/n5_expected_input[\s\S]{0,400}?lat\s+is\s+not\s+null/i.test(ddl),
  '§1d the canonical contract must not require coordinates');

// ── §2 THE LIVE/CAPTURED DISTINCTION — the defect caught mid-build ───────────────────
// n5_expected_input(cutoff) is evaluated ONCE, at capture time. Reconciliation of an
// already-captured generation must read n5_expected_captured(snapshot_id). Querying the
// live table at an old cutoff is not time travel: app_projects is delete-and-reinsert, so
// created_at is rewritten (measured: 170,929 vs 166,526 on one bucket).
// ⚠️ ASSERT THE QUERY, NOT A LOG LINE. The first version of this check was a bare
// /n5_expected_captured/ and a mutation that swapped both real query sites to the LIVE
// contract still passed, because the say("freeze basis", ...) message mentions the name.
// A test that a string appears somewhere in a file is not a test of what the file does.
const capturedCalls = (shard.match(/n5_expected_captured\(\{lit\(SNAPSHOT\)\}\)/g) || []).length;
ok(capturedCalls >= 2,
  `§2a both freeze query sites must read the CAPTURED contract (found ${capturedCalls})`);
ok(!/n5_expected_input\(\{lit\(/.test(shard),
  '§2a2 the builder must never evaluate the LIVE contract — that is capture-time only');
ok(!/preservation\.app_project_identity[\s\S]{0,200}?left\(i\.zip,3\)/.test(shard),
  '§2b the freeze must not re-express the predicate beside the contract');
ok(/n5_expected_input\(\{lit\(cutoff\)\}\)/.test(orch),
  '§2c capture — and only capture — evaluates the LIVE contract');
ok(/n5_expected_captured\(\{lit\(snapshot_id\)\}\)/.test(orch),
  '§2d the shard manifest derives from the CAPTURE, not the live table');

// ── §3 GENERATION IDENTITY: required, verified, never inferred ───────────────────────
ok(/GENERATION\s*=\s*os\.environ\.get\("GENERATION",\s*""\)/.test(shard),
  '§3a GENERATION has no default — an absent identity must not silently become one');
ok(/if not GENERATION:\s*\n\s*raise SystemExit/.test(shard),
  '§3b a missing generation fails closed before any write');
ok(/state.*!=\s*"BUILDING"[\s\S]{0,200}raise SystemExit/.test(shard),
  '§3c refuse to write shards into a generation that is not open');
ok(/snapshot_id.*!=\s*SNAPSHOT[\s\S]{0,200}raise SystemExit/.test(shard),
  '§3d refuse a generation whose snapshot conflicts with SNAPSHOT');
// Every shard-state statement carries the generation. A single un-scoped one lets a
// restart resume the wrong build.
for (const m of shard.match(/geo\.n5_shard[\s\S]{0,260}?;/g) || []) {
  if (!/snapshot_id=\{lit\(SNAPSHOT\)\}/.test(m)) continue;
  ok(/generation_id=\{lit\(GENERATION\)\}/.test(m),
    `§3e every shard-state statement must be generation-scoped: ${m.slice(0, 90)}…`);
}

// ── §4 THE ORCHESTRATOR NEVER ACTIVATES BY ITSELF ───────────────────────────────────
// Worker completion is not reconciliation success; reconciliation success is not
// activation. `activate` is its own explicit mode and nothing else may call the gate.
const bodies = ['mode_work', 'mode_ready', 'mode_reconcile', 'mode_open'];
for (const fn of bodies) {
  const body = (orch.split(`def ${fn}(`)[1] || '').split('\ndef ')[0];
  ok(!/n5_generation_activate/.test(body),
    `§4a ${fn} must never call the activation gate`);
  ok(!/state='ACTIVE'/.test(body),
    `§4b ${fn} must never set ACTIVE directly`);
}
ok(/def mode_activate\(\)[\s\S]{0,400}n5_generation_activate/.test(orch),
  '§4c activation goes through the database gate, not through application logic');

// ── §5 DUPLICATE INVOCATION AND RESUME ──────────────────────────────────────────────
ok(/n5_claim_shard/.test(orch),
  '§5a shards are claimed atomically, not selected then updated');
ok(/`open` is not a resume/.test(orch) || /already exists/.test(orch),
  '§5b open must refuse an existing generation rather than orphan its shards');
ok(/MAX_SHARDS/.test(orch) && /MAX_SECONDS/.test(orch),
  '§5c every invocation is bounded');
ok(/raise SystemExit\(f"STOP: shard \{z3\} exited/.test(orch),
  '§5d a failed shard stops the run — the orchestrator does not paper over it');

// ── §6 THE CONTRACT DOCUMENT STATES ITS OWN INVARIANTS ──────────────────────────────
ok(/ACTIVE_LEGACY/.test(ddl),
  '§6a the pre-contract generation is named, not silently called ACTIVE');
ok(/refusing a vacuous pass/i.test(ddl),
  '§6b a reconciliation covering zero records must not read as clean');

console.log(`n5-generation-contract: ${n} checks passed`);
