# What `report_id` actually guarantees (2026-09-28)

The checkpoint recorded Step 5 as "Durable `report_id` tied to data state". "Durable" is
the wrong word and it flatters the mechanism. This file states what the identifier does and
does not do, measured rather than described. Nothing about the sold report's scope changes
here; the verdict remains **NOT YET** and signed paid pilots remain **0**.

## The mechanism

`report_id` is the SHA-256, in hex, of `JSON.stringify(report)` after `report_id` and
`generated_at` are removed. Both implementations do the same thing: `canonicalize` in
`lib/nyc-v1-report.js` and in
`supabase/functions/get-future-surroundings-report/allowlist.ts`.

## What it does guarantee

**A buyer can check it themselves, with no HomeSignal code.** Take the downloaded JSON
exactly as delivered, parse it, delete `report_id` and `generated_at`, serialize it again,
and SHA-256 the result. That reproduces the printed value. Verified.

**It changes when the content changes.** A moved publisher dataset version changes it. A
record appearing or disappearing from the radius changes it. Verified in both directions.

So it answers one question honestly: *are these two files the same report?*

## What it does not guarantee, and must not be sold as

**It is not unique per issuance.** `generated_at` is excluded from the hash, and
`retrieved_at` does not reach the hashed content whenever the publisher's dataset versions
are present, which is the normal case. Two reports built minutes or months apart from
unchanged data carry the **same** `report_id`. Verified. It identifies a data state, not a
transaction, not a purchase, and not a delivery. It cannot be used as an order number, and
a second report with a familiar id is not evidence of a duplicate sale.

**It cannot be reproduced by re-running the address later.** The report is a read of live
views. `data_state.window_start` is computed relative to the day of the read, so it moves
every day on its own, and the DOB views move under it independently. Running the same
address tomorrow produces a different `report_id` even if nothing near the property
changed. Verified. A buyer who asks "why doesn't my report regenerate?" is not seeing a
bug, and nobody should tell them the id makes the report reproducible.

**It is not a signature and proves nothing about who issued the file.** It is an unkeyed
hash over content the holder possesses. Anyone can edit a report, recompute the hash over
their edit, and produce a file that verifies perfectly. What verification establishes is
that a file is internally consistent — not that HomeSignal produced it, not that the
publisher's records said this, and not that the file is unaltered relative to what was
delivered. Nothing in the product should be worded to suggest tamper-evidence.

**Verification is over the bytes as delivered, not over the object.** The serialization is
`JSON.stringify` in insertion order, which is not a canonical form in the RFC 8785 sense.
Re-serializing the same object with its keys in a different order yields a different hash.
Verified. In practice `JSON.parse` in JavaScript and `json.loads` in Python both preserve
key order, so the check above works with ordinary tools; but the guarantee is about the
file, not about any object that happens to be equal to it.

## The option not taken

Sorting keys before hashing would remove the last caveat and make the id independent of
serialization order. It was not done here. It would change every `report_id` the product
has ever produced, which is a behaviour change to a shipped identifier and outside the
scope fixed at authorisation for this checkpoint. Recording the caveat is not a substitute
for fixing it, and this paragraph is not a decision that it should stay — it is a statement
that the choice is open and unmade.

## Where this is said to the buyer

The report page prints the identifier with a one-line statement of what it is for, so the
page does not imply durability or provenance it does not have. The checkpoint's Step 5 line
no longer says "Durable".
