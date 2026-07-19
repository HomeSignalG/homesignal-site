# Candidate INSERT SQL files

Committed, reviewable SQL for new `public.feeds` rows.

**Requirements (enforced by `insert-gov-feed-candidate` workflow):**

- Path: `docs/candidates/*.sql` only
- `active=false` in VALUES
- `ON CONFLICT (feed_id) DO NOTHING` — never upsert/deactivate production
- No `UPDATE … active=true` in insert files (use separate activate SQL)

Generate:

```bash
node scripts/gov-feeds/build-candidate-sql.mjs \
  --in results/gov-feed-discovery.json \
  --out docs/candidates/<county>-insert.sql
```
