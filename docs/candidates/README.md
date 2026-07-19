# Candidate INSERT SQL files

Committed, reviewable SQL for new `public.feeds` rows (`active=false`).

Phase 1A ships **no production candidate files** — generate with:

```bash
node scripts/gov-feeds/build-candidate-sql.mjs --in results/gov-feed-discovery.json --out docs/candidates/<county>-insert.sql
```

Apply via the `insert-gov-feed-candidate` workflow (manual dispatch).
