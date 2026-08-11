// Phase 9E — offline guard over the §2 binary-integrity gate.
//
// Two things are pinned here:
//   1. the SQL of record carries the measured gate result, so a later session cannot
//      quietly restate "PDFs are unreadable" (9D's conclusion) after it stopped being true;
//   2. the gate script itself keeps the properties that make it a gate — it asserts bytes
//      against bytes, it fails the job when a control fails, and it holds no write
//      capability (no secrets, no DB endpoint) so acquisition can never become interpretation.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const { ok, equal } = assert;

const p9 = readFileSync(new URL('../docs/evidence-phase1-migration.sql', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../scripts/sec-pdf-gate.py', import.meta.url), 'utf8');
const wf = readFileSync(new URL('../.github/workflows/sec-pdf-gate.yml', import.meta.url), 'utf8');

// The doc is line-wrapped SQL comments; compare on flattened whitespace so re-wrapping a
// paragraph can never break a test that is about MEANING. (Same helper as 9A-9D.)
const norm = s => s.replace(/\n--\s*/g, ' ').replace(/\s+/g, ' ').trim();
const flat = norm(p9);
const has = (needle, n) => ok(flat.includes(norm(needle)), n);

// ── 1. the gate result is recorded, with its measurements ────────────────────────────
has('PHASE 9E (2026-08-11) — §2 BINARY-INTEGRITY GATE: PASSED', '9E section present');
has('126,786 == 126,786 bytes', '34-106074 byte equality recorded');
has('89,991 ==  89,991 bytes', 'IA-4857 byte equality recorded');
has('104,929 == 104,929 bytes', '34-80365 byte equality recorded');
has('c8f771c1eb0068b381099ccaf1e0819ef9fcdf6ca8b3daa0cb37f96487c125ef', '34-106074 sha256 recorded');
has('ca1595dcd58d963b63042d75a325c209f1474fa4bfeb116ac842e4a780de77b8', 'IA-4857 sha256 recorded');
has('e1639ce8bdc8f2e53e560f1948ffe03dea4d0cc210f47ac869aac4d4b629f544', '34-80365 sha256 recorded');

// ── 2. the self-caught instrument defect stays recorded ──────────────────────────────
// A gate that failed a document it had just proven intact is exactly the kind of thing a
// later session would "fix" by loosening a threshold. The reasoning has to survive.
has('The instrument was wrong, not the documents', 'gate defect recorded as an instrument defect');
has('binary_survived_vs_pgnet', 'byte-vs-byte check named in the record');
has('order_text_recovered', 'text-recovery check named in the record');

// ── 3. pg_net recovers ZERO order text — measured, not assumed ───────────────────────
has('pg_net recovers ZERO order text, not "a little"', 'the category-change claim is recorded');
has('net._http_response id 55807 / 55808 / 55809', 'the pg_net re-probe carries its request ids');

// ── 4. the two substantive findings ──────────────────────────────────────────────────
has('AN AP DOCUMENT IS NOT NECESSARILY AN ENFORCEMENT ACTION', 'procedural-document finding recorded');
has('counting AP DOCUMENTS as enforcement actions would inflate', 'the inflation risk is stated');
has('FOOTER ABSORPTION', 'the parser defect is recorded');
has('152 of 8,872 rows (1.7%) — EXACTLY ONE PER PAGE', 'footer defect carries its measurement');
has('THE ORDER’S OWN CAPTION IS AUTHORITATIVE OVER THE INDEX'.replace('’', "'"),
    'the repair rule is recorded');
has('NOT YET REPAIRED', 'the defect is logged as open, not implied fixed');
// Presence coverage must NOT be claimed damaged by a defect that does not touch it.
has('WHAT IT DOES NOT AFFECT: presence/absence coverage', 'blast radius is bounded honestly');

// ── 5. the gate script still measures the right pair ─────────────────────────────────
ok(/MIN_BYTE_RATIO_VS_PGNET\s*=\s*50\.0/.test(gate), 'byte-ratio floor is set');
ok(!/MIN_RATIO_VS_PGNET\s*=/.test(gate.replace(/MIN_BYTE_RATIO_VS_PGNET\s*=/g, '')),
   'the retired char-vs-byte threshold is gone, not merely renamed alongside');
ok(gate.includes('byte_ratio = downloaded / c["pgnet_retained"]'),
   'the integrity ratio is computed from DOWNLOADED BYTES, never from text length');

// ── 6. a gate must fail the job, or it attests to nothing ────────────────────────────
ok(gate.includes('GATE FAILED — do NOT proceed to large-scale acquisition'), 'failure message present');
ok(/return 1\b/.test(gate) && gate.includes('sys.exit(main())'), 'a failing gate exits non-zero');
ok(gate.includes('all_pass = all_pass and passed'), 'one failing control fails the whole gate');

// ── 7. acquisition holds NO write capability (§5, §17) ───────────────────────────────
// The runner acquires and proves; it does not interpret and it cannot write. This is
// enforced by the absence of any credential, not by convention.
equal(/secrets\./.test(wf), false, 'the gate workflow references no secrets at all');
ok(wf.includes('permissions:') && wf.includes('contents: read'), 'permissions are read-only');
equal(/SUPABASE|SERVICE_ROLE|ACCESS_TOKEN/i.test(gate), false,
      'the gate script names no credential and no DB endpoint');
equal(/schedule:/.test(wf), false, 'the gate is not scheduled (§18)');
ok(/timeout-minutes:\s*\d+/.test(wf), 'the job is time-bounded');

// ── 8. native text before OCR (§3) ───────────────────────────────────────────────────
ok(gate.includes('pdftotext'), 'native text extraction is the path taken');
ok(gate.includes('native_text_not_image_scan'),
   'an image scan is detected and surfaced rather than silently passing as extracted');

console.log('evidence-phase9e-pdf-gate: all checks passed');
