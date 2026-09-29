# Durable report snapshots — Order F (2026-09-30)

Plan: `docs/development-activity-plan-2026-09-30.md`, Order F, Step 6, Hard Rules 21 and 22.
SQL of record: `docs/report-snapshot.sql`. Engine-agnostic module:
`supabase/functions/_shared/report-snapshot.ts`.

## 1. What changed, in one paragraph

One SHA-256 field called `report_id` was doing two jobs and could do neither
(`docs/corporate-output-report-id-guarantee-2026-09-28.md`: not unique per issuance, not an order or
delivery id, cannot be reproduced by rerunning the address). It is now two things:

| | `report_id` | `content_hash` |
|---|---|---|
| What it is | a random UUID minted by the database when a snapshot is stored | SHA-256 (hex) of the stored report text |
| Unique per | issuance (one stored snapshot) | content (unchanged data gives the same value) |
| Derived from content | no | yes, and the database checks it |
| Used for | entitlement ledger, sharing, reopening, portfolio and history, audit trail, paid delivery | integrity and de-duplication |

Issuing the same content twice gives two `report_id`s and one `content_hash`. That is the property the old
identifier lacked, and it is pinned by a check that fails without it.

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- *Canonical truth path:* report engine (assembles content) → `_shared/report-snapshot.ts` (derives the body
  text and its hash) → `public.report_snapshot_issue` (the only writer) → `public.report_snapshot` → the consumers
  above (later units).
- *Decision owners:* the engine owns what the content is; the table owns the `content_hash` rule (a CHECK:
  `content_hash = sha256(body)`); the database default owns the `report_id`.
- *Shortcut check:* a scan of `lib/`, `scripts/`, `supabase/`, `partials/`, `bluesky/`, the root pages and every
  `docs/*.sql` finds the table named by its SQL of record only, the writer called from the shared module only,
  and `report_id` assigned by exactly two places, both the legacy NYC fingerprint sites named in §5.
  `test/report-snapshot-structure.test.mjs` fails if any of that grows.
- *Concurrency check:* no open PR or recent branch builds the same thing; no stored-report table, share link or
  entitlement code existed anywhere in the tree.

## 3. The design decisions, and why

- **`body` is `text`, not `jsonb`.** `jsonb` reorders keys and rewrites whitespace, so a stored `jsonb` could
  never hash back to `content_hash`. The text is the exact bytes the hash was taken over, which is what lets a
  stored report be reopened and re-verified byte for byte. The suite shows a body that `jsonb` would have
  reordered coming back unchanged.
- **The database checks the hash instead of trusting the caller.** `content_hash = sha256(body)` is a CHECK
  constraint. A wrong, truncated, upper-case or borrowed hash is refused. This is possible because the hash is
  taken over the stored text itself; it would not be if the hash were over an object the database cannot rebuild.
- **The hash is the same value as before, for the same data.** The body is the report with `report_id`,
  `generated_at` and `content_hash` removed, serialised with `JSON.stringify` in insertion order, which is the
  exact string the NYC engine always hashed. `test/report-snapshot.test.mjs` proves the new `content_hash`
  equals that engine's old `report_id` for the same input, on both the page engine and the API engine, so the
  retained concept is continuous and no shipped identifier changed meaning underneath a buyer.
- **The caller cannot choose the identity.** The writer has five arguments and none is an id or a time; the
  table has a default for each; `service_role` holds SELECT only, so it cannot INSERT around the writer.
- **A snapshot is immutable** (trigger, for every role including the owner). It is the record of what a customer
  was shown, so the permanent-history rule in CLAUDE.md applies to it.
- **Nothing is readable by an API role.** No grant to `anon` or `authenticated`, RLS on with no policy.

## 4. Proof

- `test/report_snapshot_pg` (disposable Postgres): 30 checks, hashes computed outside the database; the file
  applies twice with an identical definition; **23 prohibited mutations, all killed by a named check**.
- `test/report-snapshot.test.mjs`: 27 checks against a stand-in database that enforces the same three rules,
  including fail-closed behaviour (no envelope is ever built without a stored row) and 10 mutations of the
  module, each caught.
- `test/report-snapshot-structure.test.mjs`: 27 pins; eight mutations of the pins themselves each turned the
  test red.
- The workflow `report-snapshot-suite.yml` runs the database suite on Postgres 17 and holds no Supabase credential.

## 5. What this does NOT do (stated, not hidden)

- **Nothing calls the writer yet.** The report engine that would call it is Order G. Until then the table is
  empty and the module has no caller. That is deliberate: wiring a writer that stores a customer's address
  before there is an account, a quota or an authenticated caller would store data with no owner.
- **The legacy NYC page and API still print the fingerprint as `report_id`.** They are left untouched (founder
  ruling R6), and they describe it honestly (a fingerprint, not a receipt). The structural test names those two
  files as the only places allowed to assign a `report_id`, so a third cannot appear quietly.
- **No owner column.** Whose report it is depends on the account and evaluation tables that Order L creates; the
  column is added, additively, with that unit.
- **No retry idempotency.** Issuing twice stores two snapshots. Keying issue on a request key belongs with the
  credit ledger (plan Hard Rule 28), the thing that must not double-count.
- **No read path, share token or revocation** (Order J).
- **`inputs` will contain the address a brokerage typed.** The table is empty and locked, so nothing is stored
  today. When Order G starts writing to it there is a retention and privacy question that this file does not
  answer, and that the permanent-history rule and privacy pull in different directions on. It should be decided
  with Orders J and L, before the first real customer report is stored.
- **The hash is not a signature.** It is unkeyed, so anyone can edit a report and recompute it. What it proves
  is that a file is internally consistent, not who issued it. `envelopeMatchesItsHash` says exactly that.
- **Key order still matters for the hash.** It is `JSON.stringify` in insertion order, as before. Storing the
  text is what makes a stored report verifiable regardless; sorting keys would change every historical hash and
  is not done here.

## 6. Rollback

`docs/report-snapshot.sql` ends with the two statements that remove it. Rolling back **deletes stored reports**,
so it is only appropriate before the first real one is issued.
