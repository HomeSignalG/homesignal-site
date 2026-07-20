# Development impact system — Phase 2 (document-grounded impact analysis)

Phase 1 (`lib/impact.js`, PR #340) put a deterministic one-sentence Impact line
on development cards from `impact_dimensions`/metadata. Phase 2 grounds that
line in each project's **official source document** and adds a score, level,
direction, confidence, per-category results, and an evidence record — via a
two-stage pipeline that keeps AI judgment out of the number.

## Architecture

```
official record (source_ref: permit page / notice / filing / PDF)
   │  Stage 1 — homesignal-ingest/analyze_project_documents.py  (CI: impact-extract.yml)
   │  fetch (size/MIME/scheme caps) → text → LLM structured extraction (facts ONLY)
   │  → code-level validation + quote GROUNDING GATE → development_impact_analyses
   ▼
development_impact_analyses (public-read RLS; one row per document, keyed source_ref)
   │  Stage 2 — lib/impact-resolver.js (THE canonical deterministic scorer)
   │  batch: scripts/impact-score.mjs (CI: impact-score.yml) stores the BASE results
   ▼
development.html — joins analyses by source_ref, resolves per selected home
   (distance decay at render), renders "Impact: High · 82/100 · Negative" + sentence,
   sorts "Impact on me" via HS.impactSortCompare
```

Why a separate table: `app_refresh_zip()` **deletes and re-inserts**
`app_projects` on every refresh — anything stamped there is wiped. Analyses are
durable and versioned per document; one document serves every ZIP page that
shows it (at different distances), so the stored score is the **base**
(distance weight 1.0) and pages re-apply the decay bands.

## Stage 1 — extraction (facts only)

- Schema: nullable facts (`unit_count`, `square_feet`, `truck_trips_per_day`,
  `noise_sources[]`, `flood_control_features[]`, …) + `document_quotes[]`
  (`{page, text, supports}`) + `inferred_fields[]` (names of classified — not
  stated — values). **Absent facts stay null. Never inferred precision.**
- Security: the document is untrusted input — never executed, instructions
  inside it are ignored by prompt AND enforced in code: every quote must be a
  verbatim (whitespace-normalized) substring of the document or it is dropped
  (`validate_extraction`, tested with an injection fixture). 5 MB / 40-page /
  60k-char caps, MIME whitelist, http(s) only, 3-attempt cap, failures recorded
  (`fetch_failed` / `unreadable` / `rejected`) — invented output is never stored.
- Idempotent: unchanged doc sha256 + current `extract-v1` → skipped; hash
  change, version bump, or prior failure → re-extracted.

## Stage 2 — deterministic scoring (`impact-score-v1`)

- Category rules (traffic, noise, air, water, soil, light, flooding/drainage,
  utilities, recreation, neighborhood activity, visual character, construction
  disruption) map explicit facts to banded magnitudes with per-fact evidence;
  documented mitigation softens negatives; ≥100 acres scales footprint
  categories.
- **Score = magnitude, direction = sign**: flood control scores positive,
  industrial negative, mixed-use mixed. Base = 0.7·top + 0.3·second category.
- Distance decay (documented, testable): ≤0.5 mi ×1.0 · ≤1 ×0.9 · ≤2 ×0.75 ·
  ≤5 ×0.5 · ≤10 ×0.25 · >10 ×0.1. Levels: High 70–100, Medium 40–69, Low 0–39.
- Confidence: quantified+quoted ≈0.8–0.9 · descriptive ≈0.4–0.65 · metadata
  fallback ≤0.3 · unknown ≤0.15. Low confidence gates cautious sentence wording
  ("The available filing suggests…"). Fallback results are marked
  `analysis_basis='metadata_fallback'` and never pretend the filing was read.
- Sentence: one homeowner-plain sentence from the top 1–2 supported effects;
  never repeats the title, never claims undocumented effects.
- Sorting: score desc → confidence desc → distance asc → newest; a metadata
  fallback within 10 points of a document-grounded result never outranks it.

## Storage

`public.development_impact_analyses` — DDL: `docs/development-impact-analyses.sql`
(applied 2026-07-20, migration `development_impact_analyses`). RLS ON: public
select, service-role writes only. Carries doc hash/MIME/bytes, extracted facts,
extraction status/error/attempts/model/version, the scored field set
(score/level/direction/sentence/confidence/categories/evidence), scoring
version, timestamps, `analysis_basis`.

## Operations

- **Pilot / on-demand:** ingest `impact-extract.yml` (dry-run default; `refs`
  input = record URLs, one per line) → site `impact-score.yml`. Both manual —
  **no schedule and no bulk processing until the pilot output is reviewed.**
- Cards are never blocked: projects without an analysis row resolve through the
  conservative metadata fallback at render time.
- Tests: `test/impact-resolver.test.mjs`, `test/impact-card.test.mjs` (site),
  `tests/test_impact_extractor.py` (ingest). Phase-1 pins (`test/impact.test.mjs`)
  still pass — the Phase-1 sentence remains the no-analysis fallback.

## Known limits (logged, non-blocking)

- Many permit `record_url`s are dataset-precision (Boston/Philly/Chicago…) —
  those documents describe the dataset, not the single project, so they land in
  the fallback path by design.
- Category-specific distance treatment (corridors/watersheds/airsheds) is a
  later build; today one radial decay table serves all categories.
- Area-scope notices (`app_changes`) and meeting agenda packets are not yet in
  the extraction loop — the pilot covers `app_projects` development records.
