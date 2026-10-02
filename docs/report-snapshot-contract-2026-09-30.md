# Durable report snapshots — Order F (2026-09-30)

Plan: `docs/development-activity-plan-2026-09-30.md`, Order F, Step 6, Hard Rules 21 and 22.
SQL of record: `docs/report-snapshot.sql`. Engine-agnostic module: `supabase/functions/_shared/report-snapshot.ts`.
**Privacy boundary (F2, founder decision 2026-09-29): `docs/report-private-context-contract-2026-09-30.md`.** Read it
with this file: the permanent table described here holds no customer-entered address, and that file says where it lives.

## 1. What changed, in one paragraph

One SHA-256 field called `report_id` was doing two jobs and could do neither
(`docs/corporate-output-report-id-guarantee-2026-09-28.md`: not unique per issuance, not an order or delivery id, cannot
be reproduced by rerunning the address). It is now two things:

| | `report_id` | `content_hash` |
|---|---|---|
| What it is | a random UUID minted by the database when a snapshot is stored | SHA-256 (hex) of the stored report text |
| Unique per | issuance (one stored snapshot) | content (unchanged data gives the same value) |
| Derived from content | no | yes, and the database checks it |
| Used for | entitlement ledger, sharing, reopening, portfolio and history, audit trail, paid delivery | integrity and de-duplication |

Issuing the same content twice gives two `report_id`s and one `content_hash`. That is the property the old
identifier lacked, and it is pinned by a check that fails without it.

**And the table holds only permanent intelligence.** A street address a brokerage typed is customer context, not
historical intelligence, so it is not in the body, not in the engine inputs and not in any column here. It lives in a
separate, deletable private context; the snapshot references it by an opaque id.

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- *Canonical truth path:* report engine (assembles the content) → `_shared/report-snapshot.ts` (derives the body and its
  hash, separates the private context) → `public.report_snapshot_issue` (the only writer) → `public.report_snapshot` (+
  `public.report_private_context`) → the consumers above (later units).
- *Decision owners:* the engine owns what the content is; the table owns the `content_hash` rule (a CHECK:
  `content_hash = sha256(body)`); the writer owns the `report_id` (`gen_random_uuid()` inside it — the column has no
  default and the writer has no argument for it); **the private context owns what counts as private, and the
  containment trigger reads it — there is no second list of private fields.**
- *Shortcut check:* a scan of `lib/`, `scripts/`, `supabase/`, `partials/`, `bluesky/`, the root pages and every
  `docs/*.sql` finds the table named by its SQL of record only (in code), the writer called from the shared module only,
  the private tables named by their SQL of record and the snapshot's only, and `report_id` assigned by exactly two
  places, both the legacy NYC fingerprint sites named in §5. The structural tests fail if any of that grows.
- *Concurrency check:* no open PR or recent branch builds the same thing; no stored-report table, share link or
  entitlement code existed anywhere in the tree.

## 3. The design decisions, and why

- **`body` is `text`, not `jsonb`.** `jsonb` reorders keys and rewrites whitespace, so a stored `jsonb` could never
  hash back to `content_hash`. The text is the exact bytes the hash was taken over, which is what lets a stored report
  be reopened and re-verified byte for byte. The suite shows a body that `jsonb` would have reordered coming back unchanged.
- **The database checks the hash instead of trusting the caller.** `content_hash = sha256(body)` is a CHECK constraint.
  A wrong, truncated, upper-case or borrowed hash is refused.
- **The hash algorithm is the one the NYC engine has always used, so the concept is retained.** The body is the
  content with `report_id`, `generated_at`, `content_hash` and `private_context_id` removed, serialised with
  `JSON.stringify` in insertion order. `report-snapshot.test.mjs` 1b/1c prove that hashing the legacy engine's whole
  report gives its own `report_id`. **That whole report is not issuable** (F2, `report-snapshot.test.mjs` section 2): it
  contains the typed address, the exact property point and per-record offsets. An engine issues its *intelligence*, so
  its `content_hash` will differ from any legacy `report_id` for the same address, by design.
- **The caller cannot choose the identity.** The writer has five arguments and none is an id, a time or a context id;
  `service_role` holds SELECT only, so it cannot INSERT around the writer.
- **A snapshot is immutable** (trigger, for every role including the owner). It is the record of what a customer was
  shown, so the permanent-history rule in CLAUDE.md applies to it.
- **Nothing is readable by an API role.** No grant to `anon` or `authenticated`, RLS on with no policy.
- **The writer creates the private context, its first need and the snapshot in one transaction.** If the containment
  trigger refuses the snapshot, all three are rolled back (`report_snapshot_pg` X04).

## 4. Proof

See `docs/report-private-context-contract-2026-09-30.md` §10 for the full inventory. In short: 66 database checks on
the snapshot and 52 on the private layer (hashes computed outside the database), both applying twice with an identical
definition, **105 prohibited mutations all killed by a named check**; the upgrade of the exact Order F table that is
live in production, and its refusal when a report is stored; 38 module checks and 23 module mutations; 87 structural
pins. The workflow `report-snapshot-suite.yml` runs both database harnesses on Postgres 17 and holds no Supabase credential.

## 5. What this does NOT do (stated, not hidden)

- **Nothing calls the writer yet.** The report engine that would call it is Order G. Until then the table is empty and
  the module has no caller. Wiring a writer that stores a customer's address before there is an account, a quota or an
  authenticated caller would store data with no owner.
- **The legacy NYC page and API still print the fingerprint as `report_id`.** They are left untouched (founder ruling
  R6), and they describe it honestly (a fingerprint, not a receipt). The structural test names those two files as the
  only places allowed to assign a `report_id`, so a third cannot appear quietly.
- **No owner column** on the snapshot or the private context. Whose report it is depends on the account and evaluation
  tables that Order L creates; the column is added, additively, with that unit.
- **No retry idempotency.** Issuing twice stores two snapshots. Keying issue on a request key belongs with the credit
  ledger (plan Hard Rule 28), the thing that must not double-count.
- **No read path, share token or revocation in THIS unit** (Order J). This unit fixes what the private read may return
  after a purge. The share-link primitive (token hash, expiry, revocation, the one resolve decision) is the next unit,
  J1, described in §8; J1 still has no read path and no caller, and Order J as a whole stays open.
- **The retention question is decided; its operation is not yet armed.** The 90-day rule, the purge and the audit are
  built and proven (`report-private-context-contract`); the purge batch is not scheduled, and what closes a `report`
  need is Orders J and L.
- **The hash is not a signature.** It is unkeyed, so anyone can edit a report and recompute it. What it proves is that a
  file is internally consistent, not who issued it. `envelopeMatchesItsHash` says exactly that.
- **Key order still matters for the hash.** It is `JSON.stringify` in insertion order, as before. Storing the text is
  what makes a stored report verifiable regardless; sorting keys would change every historical hash and is not done here.

## 6. Rollback

`docs/report-snapshot.sql` ends with the statements that remove it. Rolling back **deletes stored reports**, so it is
only appropriate before the first real one is issued. Roll back the snapshot file **before** `docs/report-private-context.sql`
(the foreign key points there).

## 7. Order F1 — superseded shape, and its production receipt

The production receipt below records the **first** version of this table (columns `inputs` and `property_key`,
writer `report_snapshot_issue(text,text,text,jsonb,text)`), applied 2026-09-29. **That shape is superseded by F2**:
`inputs` and `property_key` are removed, and the writer takes `(body, hash, version, engine_inputs, private)`. The
receipt is kept as the dated record of what was applied and verified then.

### Production receipt of F1 (2026-09-29 21:16Z)

Merged as #1475 (`76dca60`), all six checks green on the head. Applied with `apply_migration` as
`report_snapshot_f1_20260930` (ledger version `20260929211614`; ledger 616 → 617 rows).

Before the apply (read from production): no `report_snapshot` table, no `report_snapshot_*` function,
`server_encoding` UTF8, `gen_random_uuid()` and `sha256(bytea)` present.

Read back after:

- **The stored migration text is the file.** md5 of the stored statements `545d7d94977ce606e0524e0922b6a096`,
  equal to the md5 of `docs/report-snapshot.sql` on `main`.
- **Table:** exists, owner `postgres`, RLS on, 0 policies, ACL `{postgres=arwdDxtm/postgres,service_role=r/postgres}`,
  8 columns as specified (`body_bytes` generated stored).
- **Privileges, asked of the database (`has_table_privilege`):** `anon` and `authenticated` hold none of select,
  insert, update, delete, truncate; `service_role` holds select only.
- **Functions:** `report_snapshot_issue(text,text,text,jsonb,text)` is `security definer` with
  `search_path=public, pg_temp`; both functions are executable by `service_role` only (`has_function_privilege`
  false for `anon` and `authenticated`).
- **Constraints:** primary key plus the five checks (`hash_matches_body`, `body_is_object`, `version_named`,
  `inputs_object`, `key_named`). **Triggers:** `report_snapshot_no_update_delete`, `report_snapshot_no_truncate`.

**Behaviour on production, in a block that always rolls back** (the table is immutable, so a stored test row could
never be removed; the block ends by raising, and the result is read out of the error message). Expected hashes were
computed outside the database. All 13 results were as required: a valid issue returns a v4 `report_id` and a
`generated_at`; the same content issued twice gives a second `report_id` (2 rows, 1 distinct `content_hash`); a
multibyte body hashes as UTF-8; a wrong hash, an upper-case copy of the right hash and a non-object body are each
refused by the table; update, delete and truncate are each refused as immutable; the stored body equals the text sent
byte for byte (`body_bytes` 7). **Afterwards the table holds 0 rows.**

What this receipt does not show: the two API roles were checked through the database's own privilege functions,
not by calling the REST endpoint as each role; and nothing was run as `service_role`. Nothing calls the writer yet
(Order G), so no path exists by which either matters today.

## 8. Order J1 — the share-link primitive (2026-10-02, built, NOT applied, no caller)

### 8.1 What it is, in one paragraph

An opaque, revocable, optionally expiring link to ONE stored report (plan Step 7: share links use an opaque token, support
revocation, support optional expiry). A link is a random 256-bit token that exists only in the URL its owner hands out.
**The database never sees the token**: the caller hashes it and sends the hash, so a read of the two new tables yields no
usable link, and a link that is lost is revoked and reissued, never recovered. The unit is `docs/report-share.sql` (two
tables, one guard, three functions) plus `supabase/functions/_shared/report-share.ts` (mint a token, check its shape, hash
it). It has **no caller, no endpoint, no page, no URL shape and no client view**. Order J as a whole stays open: this is its
first unit, the way Order F was the first unit of the snapshot.

### 8.2 Pre-implementation statement (one canonical truth path)

- **Canonical truth path:** stored report `public.report_snapshot` (immutable, address-free) → `public.report_share` (a token
  hash, an optional expiry, a revocation, one row per link) and `public.report_share_resolve` → a later read-only client view
  (J2) that opens the snapshot BODY and nothing else.
- **Decision owners, each named once:** what the report IS is `report_snapshot` (this unit stores a reference to it and never
  reads it) · whether a link is usable is `report_share_resolve`, and nothing else decides ACTIVE, EXPIRED, REVOKED or UNKNOWN ·
  the share's identity is `gen_random_uuid()` inside `report_share_create` (no column default and no argument, so no caller
  chooses it) · what a hash looks like and what an expiry may be are the table's CHECK constraints, not a function's · what is
  private, and for how long, stays with the private layer, which this file does not name, read, open a need on or start a
  clock on · who may share or revoke is **not here** (see 8.5).
- **Shortcut check** (run 2026-10-02 on the tree this was built from, `6faedf4`): `grep -rIl report_share` over the repo
  matches only the files this unit adds or amends (the SQL, the suites, the workflow, the status doc; the module is named `report-share.ts`, which that pattern does not match, and the sibling `homesignal-ingest` checkout was searched separately: its token-hash code is unsubscribe, consent and confirm-alerts only, with no share or snapshot code);
  `grep -rIlE "share_token|shareToken|share_link|shareLink|token_sha256|revoked_at"` over `.sql/.js/.mjs/.ts/.html` finds one
  other file, `docs/epa-recovery-rpcs.sql`, which uses `revoked_at` for an unrelated EPA recovery token. No second share,
  token, revocation or link-expiry mechanism exists. The legacy NYC page's raw-address share URL is a different thing and is
  untouched (founder ruling R6).

### 8.3 Decisions taken (the audit's defaults; the founder may change any of them)

| Decision | Taken here |
|---|---|
| Default expiry | **None.** `report_share_create` takes an optional expiry and applies none. |
| Token | 32 bytes from the platform CSPRNG, written as 43 base64url characters; the hash is SHA-256 of the token's **characters** (not of the decoded bytes), so a re-encoding of the same bytes cannot be a second valid link. |
| What the audit records | Two event kinds, `created` and `revoked`. No actor, label, IP address, user agent, referrer or free text. Nothing records that a link was **opened**. |
| Who may share | Nobody, yet: `service_role` only, and nothing calls it. There is no owner column. |
| Does a share need an active private context | **No.** A share survives a purge of the report's private context and can be created against a report whose context was purged. |
| Expiry | Computed at read time; nothing writes when an expiry passes. |

### 8.4 The rules, and where each is held

1. **The token is never stored.** The table has a hash column and no token column; the column accepts only 64 lower-case hex
   digits, so a raw token (43 characters) cannot be stored by mistake.
2. **A hash is unique.** Creating twice with the same hash is refused (23505); the caller mints a new token.
3. **ACTIVE, EXPIRED, REVOKED, UNKNOWN** are the only four answers. A share is created active, becomes EXPIRED by the clock
   alone (`expires_at <= now()`, so the boundary instant is expired), and REVOKED by one explicit call.
4. **REVOKED beats EXPIRED.** A link that was revoked and then lapsed reads REVOKED.
5. **Only one update exists.** The guard trigger allows `revoked_at` from null to a time with every other column unchanged,
   and nothing else: an expiry can never be extended, shortened or cleared, and a revoke can never be undone. A share is
   never deleted and the table is never truncated. Revoking twice is a no-op that writes no second event; revoking a share
   that does not exist is an error, not a quiet false (a revoke that did nothing must never read as done).
6. **`report_share_resolve` returns a status and, only for ACTIVE, the `report_id`.** No body, no private-context handle, no
   address, no share_id, no timestamp. It writes nothing.
7. **Creating or revoking a share changes no row of the snapshot and nothing in the private layer.**
8. **The audit log is append-only** with a closed two-word vocabulary and no column that could hold text.
9. **Nothing is readable or writable by `anon` or `authenticated`.** `service_role` may select and may execute the three
   functions; it cannot insert, update or delete directly, so every share goes through them. RLS is on with no policy, and the
   functions are locked down by their own computed loop over `report\_share\_%` (the snapshot and private-layer loops do not
   match this prefix, so without it Supabase's default privileges would grant the new functions to `anon`).

### 8.5 What this does NOT do (stated, not hidden)

- **No owner.** There is no account, brokerage or entitlement table until Orders K and L, so there is no owner column and
  nothing stops any `service_role` caller sharing any `report_id`. That is acceptable only because nothing calls it. **The
  first endpoint must sit behind the admin gate**, and the owner column is added, additively, with Order L.
- **No read path.** What a client sees when a link opens, the URL shape, branding, disclosure, print or PDF, and rate limiting
  and replay control for token-bearing requests are later units. J2's URL design must keep the token out of anything sent to a
  third party (for example the fragment plus a no-referrer policy), because the report links out to official sources; that
  is a J2 requirement and is not decided here.
- **A lost link cannot be recovered.** By design: revoke it and issue another.
- **Nothing closes a report's private-context `report` need** (D-4 in the private-context contract) and nothing starts the
  90-day clock. Revoking every share is one candidate for "the report is inactive"; it is not decided and not built.
- **No caller of `issueSnapshot`.** Nothing stores a report yet, so there is nothing to share. Storing a real customer report
  stays off until the gates in `docs/report-private-context-contract-2026-09-30.md` are closed.

### 8.6 Founder decisions that remain open (the build does not depend on them)

1. **What makes a stored report inactive**, so its `report` need closes and the 90-day clock can start: a brokerage archive,
   revoking every share, or account closure. Until decided, a first real report's address is kept indefinitely.
2. **Whether a client who opens a link sees the subject address** (and the distances that depend on it) while the private
   context is active, or never. Recommended default: show while active, "address unavailable" after a purge.
3. **What client-view and engagement events may be recorded** (an open timestamp or count only, never IP or user agent),
   whether the client is told, and for how long they are kept. A privacy and legal call; it must not become surveillance.
4. **Free-text label policy.** The plan's own example label holds an address and a client surname, while the privacy contract
   refuses client identifiers. Confirm a label stays private, is purged with the context and is never copied into the audit.
5. **Print and PDF**: the browser print stylesheet over the same rendered view (no second renderer), or a server-generated
   PDF; and the default share expiry (none, or N days).

### 8.7 Applying it (a separate step with its own go; this change does not apply it)

`docs/report-share.sql` is additive and idempotent, refuses to run unless `public.report_snapshot` exists, and ends with the
statements that remove it. Apply it the way Orders F and F2 were applied: from the committed file, with the stored migration
text's md5 compared to the file's md5 afterwards, and a read-back of owner, RLS, privileges (asked of the database with
`has_table_privilege` and `has_function_privilege`), constraints and triggers. Rolling it back deletes every share and every
issued link stops working, so it is only appropriate before the first real share exists. Roll the share file back before
the snapshot file (the foreign key points there).

### 8.8 Proof

Run on a disposable Postgres, not on production. Hashes in the suite are computed outside the database.

- `test/report_share_pg` (`run.sh`, `suite.sql`, `mutate.py`): **52 checks** (L02b, added after the independent review, proves the event table's identity sequence is closed to anon, authenticated, service_role and PUBLIC); the file **applies twice with an identical
  definition fingerprint**; the snapshot, private-layer and need tables are fingerprinted before and after and **read
  UNTOUCHED**; the rollback is proven on a populated database; it **refuses without the snapshot table**; and **75 prohibited
  mutations are each killed by a named check** (the run fails on a survivor, a harness fault or a crash). Its checks include
  the expiry boundary at, one microsecond before and one microsecond after the instant; revoked beating expired; every
  other column change refused, including each one combined with a revoke; update, delete and truncate refused on both
  tables; `service_role` unable to insert directly; and a share resolving ACTIVE to the same address-free body, with the
  snapshot row unchanged, after a verified-privacy-request purge of the report's private context.
- `test/report-share.test.mjs`: **44 module checks** against a vector computed outside the module; and
  `test/report_share_module_mutants.py`: **23 mutants of the module**, each killed by a named check (a crash does not count).
- `test/report-share-structure.test.mjs`: **60 structural pins** on the SQL, the module and the harness (10c searches workflows, `data/` and script-like documents for a share function or its RPC route, so a caller that hides outside the code directories still turns a pin red); and
  `test/report_share_pin_mutants.py`: **73 mutations of the pins' own inputs**, each of which turns the named pin red.
- `test/report-snapshot-structure.test.mjs` now carries **47 pins**: pin 3's allow-list gained `docs/report-share.sql`, and
  new pin 3d asserts that file names `report_snapshot` exactly once, as the foreign-key reference, and never reads or writes
  the table.
- `.github/workflows/report-snapshot-suite.yml` runs the share harness on Postgres 17 and still refuses to hold a Supabase
  credential.

### 8.9 What was not exercised

- **Postgres 17.** The harness was run locally on Postgres 16; CI runs 17, and that run is unverified until it happens.
  (The one place the two differ, the table ACL's text form, is accepted in both forms by check L07.)
- **Nothing was run against production**, and nothing was run as a real `service_role` through the REST API: roles are
  asked through the database's own privilege functions.
- **No concurrency test.** Two concurrent revokes are argued from the row lock, not raced.
- **The hash is not a signature and the token is not authenticated further.** A holder of the token is the bearer; rate
  limiting and replay control are Order L's.
