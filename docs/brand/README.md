# Brand / domain contract (Jody migration, Step 1)

**Status: INERT.** HomeSignal is the only active identity. Nothing shipped, served, deployed,
emailed, posted or signed reads this contract.

## What exists
| file | role |
|---|---|
| `docs/brand/brand-contract.v1.json` | THE authoritative contract: public brand fields only (key, display name, origin, state). |
| `docs/brand/brand-contract.v1.sha256` | sha256 of the canonical (key-sorted, whitespace-free) JSON. Detects edits and drift. |
| `test/lib/brand-contract.mjs` | Validator, canonicalizer, hash and `checkPin`. stdlib only. |
| `test/brand-contract.test.mjs` | Fail-closed suite (positive and negative controls). |

Operational secrets, provider settings and deployment controls are deliberately NOT fields.

## Ownership and cross-repository compatibility
`homesignal-site` owns the contract (it is the public identity, and its repo is public and already read by
`homesignal-ingest` CI). `homesignal-ingest` has **no change in Step 1**: it consumes nothing yet.

When an ingest consumer is authorized (a later step), it must NOT hand-copy values. It records a pin
`{contract_version, sha256}` and its CI fetches the contract at the **pinned site commit** and runs `checkPin`
(version first, then hash). A mismatch fails ingest CI before merge. There are no runtime calls between
repositories, and production never depends on an unmerged commit in the other repo. A contract change is
therefore: change the site contract + hash, merge, then bump each consumer's pin in its own PR.

## Why it cannot activate by accident
* It lives in `docs/` and `test/`, which `scripts/stage_site.py` (an allowlist) does not ship and which
  `pages.yml`'s push filter excludes (`!docs/**`, `!test/**`): merging this change starts **no** Pages deployment
  by push. (The existing 30-minute freshness schedule still runs, and publishes nothing unless the semantic
  page state differs.) Both facts are asserted by `test/brand-contract.test.mjs` §4 and §6.
* No toggle. In contract v1 the validator pins `homesignal` active and `jody` inactive; activation is a new
  `contract_version` plus a reviewed validator change, never a field flip.

## Controlled activation and rollback (design only, later steps)
Activation = contract v2 (validator permits the Jody-active state) merged first, then each consumer repointed in
its own reviewed, separately-deployed PR behind its own equivalence gates. Rollback = revert the consumer PRs
(or set the pin back to v1); v1 remains valid and HomeSignal remains the identity of record until then.
Identity-bound immutables (Bluesky DID `did:web:homesignal.net`, Supabase ids, `HS` identifiers, historical
records) are outside this contract and change only by explicit decision.
