# Plan: customer-facing HomeSignal -> JODY (2026-11-26). Plan only; nothing here is implemented.

## What already exists (read before changing anything)
* `docs/brand/brand-contract.v1.json` defines two identities: `homesignal` (display "HomeSignal", homesignal.net)
  and `jody` (display **"Jody"**, jodytracks.com, state active). The committed contract is v2 / Jody-current
  (`docs/brand/MIGRATION-STATUS.md`); the build publishes as jodytracks.com.
* `scripts/brand_stage.py` rewrites the staged tree at build time: display name `HomeSignal` -> `Jody`, the two-tone
  wordmark, hosts, the tagline, the support mailbox. The source keeps "HomeSignal" so the homesignal.net build stays
  byte-identical. It fails the build when an unclassified "HomeSignal" string remains (`brand_stage.py:253`) and
  keeps an explicit list of things that must NOT change (file paths, `@homesignal.net` mailboxes, `did:web:homesignal.net`,
  the GitHub org, JS globals such as `window.HomeSignalVideoProducer`, the Supabase project).
* Inventory of "HomeSignal" in this repo (case-insensitive, counted by `grep -o`): `*.html` 268 (terms 35,
  development-map 33, development-activity-reports 25, index 15, privacy 14, 404 14), `lib/*.js` 123,
  `scripts/*.py` 193, `scripts/*.mjs` 95, `supabase/functions` 88, `partials` 7, `data` 4. Most script hits are
  comments, test fixtures and generator copy that the overlay already rewrites.

## Decision needed first: the name's casing
The contract says "Jody"; the request says "JODY"; other copy says "JODY Tracks". The overlay emits "Jody".
Pick one, record it in the contract, and make every surface derive from it. Hand-editing source to "JODY" (as an
earlier commit on #3143 did, now reverted) produces mixed casing next to the overlay's "Jody".

## Approach: one source of truth, no per-string edits
1. **Contract first.** Add the final display string and its legal variants (wordmark, "<Name> Tracks", possessive)
   to `brand-contract.v1.json` and regenerate its sha256. All text then comes from `brand_stage.py` (display) and
   `gen_zip_pages.py` via a `BRAND` constant read from `brand_host.py`, replacing ~60 literals in the generator.
2. **Classify every hit** with a committed script (`scripts/brand_inventory.py`) into: `display` (rewrite),
   `identifier` (keep: CSS classes, storage keys, JS globals, DB/RPC names), `url` (keep until the redirect decision),
   `mailbox` (keep until a Jody mailbox exists), `legal` (counsel, below), `internal` (comments, docs, tests).
   The build already fails on unclassified hits; extend the keep-list instead of editing around it.
3. **Customer copy that is not a plain substitution**: terms.html, privacy.html, billing and consent wording are
   legal text and locked wording. Counsel review before any change; do not run a global replace there.
4. **Outbound surfaces** (email templates, edge-function copy, Bluesky text, reports, PDFs) are a separate unit with
   their own gates (`docs/email-branding-audit.md`, ingest `brand/brand-contract.pin.json`, publish hold). Not in
   the site build.
5. **Preserve**: file paths (identical-path migration), `homesignal.net` redirects and DNS, `did:web:homesignal.net`,
   Supabase project/function/table names, RPC contracts, cache keys, the `@homesignal.net` mailboxes, and every URL
   in the sitemaps.

## IndexNow, without bypassing it
* A display-name change alters the visible text of about 12,700 ZIP pages plus city, project, guide and map pages,
  so the fingerprint (`scripts/page_semantics.py`) moves for all of them. The mass-change hold must fire and stay.
  Do not add the name to the fingerprint's ignore list and do not edit the baseline.
* Rehearse on a throwaway copy: run the build with the new contract against the previous live baseline and read
  `delta.changed` (expected: nearly all pages) and `delta.submit`. Record the count in the PR.
* Release deliberately: `indexnow-resubmit` with `allow_mass_change=true` after the founder approves the
  rehearsal numbers. The Jody host's own baseline seeds on first build (`docs/brand/indexnow-jody-hold.json`,
  `hold: false` since 2026-10-15), so confirm which host the rename ships on before deciding the count.
* Sitemap `lastmod` moves only with the fingerprint, so a rename will refresh every `lastmod`. Say so in the PR;
  do not suppress it.
* Rollout order: contract + generator constant behind the existing overlay -> rehearsal receipt -> merge ->
  one deploy -> verify `verify-zip-pages-live` and the leak check -> only then the resubmit.

## Tests to add
A brand-leak test over the generated output (no customer-visible "HomeSignal" outside the keep-list), a casing test
(one spelling everywhere), a no-op test for the homesignal identity (byte-identical build), and the existing IndexNow
delta tests extended with a rename fixture asserting the hold trips.

## Not in scope here
DNS, Search Console, mailboxes, payment processor copy, Bluesky/YouTube profile text, and the ingest repo.
