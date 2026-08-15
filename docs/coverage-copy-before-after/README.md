# Coverage-copy before/after — the review artifacts owed from the original approval

Rendered 2026-08-15 for founder review of the revived coverage-copy branch
(`claude/admiring-hawking-r8x2nl`, commit `4516897` of 2026-08-11, rebased onto `main`
`57f0185`). **These are the artifacts the original approval was conditioned on; no PR is
opened until they are reviewed.**

| File | Page | Tree |
|---|---|---|
| `development-99551-before.png` | Akiachak (99551), Bethel — Alaska | `main` @ `57f0185` |
| `development-99551-after.png`  | same | this branch |
| `development-87513-before.png` | Arroyo Hondo (87513), Taos County NM | `main` @ `57f0185` |
| `development-87513-after.png`  | same | this branch |

## What changed, in the copy itself

**Before (both ZIPs, identical):**
> Nothing on the public record near here yet
> We check county and permit records for this area continuously — new projects appear
> here the moment they're filed.

That claim is false on both pages: no registry entry reads Taos County at all, and
Bethel's only source is a statewide one. Nothing is "checked continuously" for either
county's own permit records.

**After — Bethel (99551):** names EPA FRS, names the one real statewide source
(Alaska Department of Transportation & Public Facilities), states plainly that the page
holds nothing, and owns the gap: *"building permits, zoning cases and hearing notices for
Bethel, Alaska. We have not identified a source that publishes them. That is a gap in
what we've found, not a finding about what's available."* Note "Bethel, Alaska" — never
"Bethel County", which does not exist (`lib/coverage-copy.js` NO_SUFFIX_STATES).

**After — Taos (87513):** same structure with **no** permit-source line, because the
198-entry registry has no NM source — the copy names nothing it cannot trace.

The AKDOT&PF line is the **self-clearing property working**: the branch's 2026-08-11
snapshot predated the statewide-DOT wires; regenerating
`lib/generated/county-sources.json` against the current registry (this branch, enforced
by `test/county-sources-parity.test.mjs`) changed what the Bethel page says with **zero
copy edits**.

## Provenance — inputs are real, render is offline

- **Data**: real rows read live from Supabase (`app_community_meta`, `app_changes`) on
  2026-08-15. Both ZIPs verified all-empty on the three gate counts —
  99551: dev 0 · fac 0 · civic 0 (8 Local News rows, correctly excluded);
  87513: dev 0 · fac 0 · civic 0 (6 Local News rows, correctly excluded).
- **Render**: Playwright/Chromium against a local static serve of each tree, at
  `development.html?zip=<zip>&demo=1`. The sandbox has no egress to Supabase, so
  supabase-js was replaced at the network layer with a stub query-builder serving those
  real rows verbatim; page code (shell, data layer, coverage-copy) ran unmodified.
  Zero page errors in all four renders.
- The `?demo=1` chrome (the "AR" avatar) is preview-only scaffolding
  (`config.js::DEMO_SESSION`), not part of the change under review.

Delete this directory when review is done if it shouldn't ship; it exists to make the
review reviewable, not to be product.
