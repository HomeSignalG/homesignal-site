# Bluesky Posts — build status & reference

HomeSignal's Bluesky presence: an anti-fabrication post pipeline (draft →
approved → published) with an owner-only approval queue on **tab 11 of
`acquisition.html`**. This doc records what was built against the runbook of the
same name. Sister doc to `community-build-source-of-truth.md`.

## Prime directive (§0)
Every post is composed from a **real** content row (`alerts`/`meetings`) and
carries that row's official `source_url`. Facts come from the row's fields
verbatim; composition only phrases/slots/tags. A row with no `source_url` is
never postable — enforced at the schema (`source_url NOT NULL`), in the composer
(`composePost` throws), and in CI (`verify-bluesky`).

## What shipped (Phase 1: gov notices + upcoming meetings)
| Piece | Where | Notes |
|---|---|---|
| `social_posts` table + owner-RLS | `docs/social-posts.sql` (applied) | Supersedes the prior pipeline (renamed → `social_posts_legacy`, preserved). |
| Owner-only auth gate (§8) | already live | `acquisition.html` is behind email-OTP + `dashboard_admins` (= owner only). Tab-11 writes are owner-gated by the `social_posts` RLS. |
| Hashtag registry (§6) | `homesignal-ingest/bluesky/social-hashtag-registry.json` | Place + topic + action, ≤3, CamelCase, banned list. |
| Slot ladder (§5) | `homesignal-ingest/bluesky/social-slot-ladder.json` | Weekday [09:00,17:30,12:30,19:00,08:00], weekend 10:30, cap 5, quiet 08–20, min 150 min. |
| Composer | `homesignal-ingest/bluesky/lib/compose.mjs` | Verbatim facts, registry tags, exact graphemes via `Intl.Segmenter`, ≤300 clamp. |
| Generator (§3) | `homesignal-ingest/bluesky/generate.mjs` + `bluesky-generate.yml` (nightly) | Idempotent draft of gov notices + upcoming meetings with `source_url`. |
| Approve RPC | `hs_approve_social_post` (applied) | Owner-gated; assigns the slot server-side. Skip/Edit = owner-session RLS updates. |
| Tab 11 (§9) | `acquisition.html` | Live queue, `N/300` count, source verify link, Approve/Skip/Edit. Never posts, never holds the credential. |
| Publish worker (§7) | `homesignal-ingest/bluesky/publish-worker.mjs` + `bluesky-publish.yml` | The only place the App Password lives; posts due approved rows. |
| Verify (§10) | `homesignal-ingest/scripts/verify-bluesky.mjs` + `verify-bluesky.yml` | Asserts source_url, ≤300 graphemes, registry tags, slot rules. |

## Pending / deferred (not blocking)
- **Bluesky App Password** (owner secret `BSKY_HANDLE`/`BSKY_APP_PASSWORD`): unset →
  the worker logs "pending BSKY credential" and posts nothing. Set the secrets to go live.
- **Legal framing sign-off** (owner, once): drafting is internal (owner-only table);
  actual publishing waits on this + the credential.
- **Superseded legacy** (flagged): the `social-approve` edge function + the prior
  generator target the old schema and must be disabled/updated.
- **Phase 2 (local news), evergreen, video candy**: wired in the model, selection off.
