# MAPS · Data Center Theme — the capture map-state policy (`dc-map-state@1`)

**Status: CODE IMPLEMENTED AND PUSHED. NOT MERGED, NOT DEPLOYED, MIGRATION NOT APPLIED,
NO IMAGE REGENERATED. Nothing was approved, scheduled, published or sent.**

## 1. The defect, and what actually caused it

The founder's screenshot of the Mesa capture (ZIP 85212, draft
`78ee8931-c114-4824-9a29-32f6b50b38c2`, project `055e0472-fa71-44ca-b5af-614d315f86b1`,
source key `socrata:data.mesaaz.gov:dzpk-hxfb:PMT26-01256`, 7232 E ELLIOT RD, image
`maps/85212/055e0472-fa71-44ca-b5af-614d315f86b1-1rogcesrz9hd.png`, captured
`2026-09-20T20:47:37.227Z`) shows every status on, Data center the only project type, and
**Regulatory facilities incorrectly ON**.

`applyDataCenterTypeFilter` operated `#mapkeyShapes .typechip` **and nothing else**. No
status control was touched and `#regToggleBox` was never read, so the published picture
carried whatever those two dimensions happened to be when the page finished loading. A
screenshot of a filter panel is a claim about WHICH RECORDS ARE ON SCREEN; three dimensions
decide that, and only one was stated.

🔑 **A SECOND FAULT IS VISIBLE IN THE STORED EVIDENCE AND WAS NOT IN THE BRIEF.**
`type_filter_before` is **byte-identical** to `type_filter_after` — `datacenter:true` and six
`false` — which no freshly-loaded page can produce. `lib/map.js` persists the category filter
in `sessionStorage` (`hs.map.categoryFilters`) and the capture job reuses **one** browser
context for every draft in a run, so that "before" is the PREVIOUS draft's leftover state.
The consequence lands on the ORDINARY MAPS capture that follows a theme capture: it sets no
filters at all and was being photographed through the previous draft's Data-center-only view.
Closed by clearing that key in an `addInitScript` on the capture's own throwaway context.

## 2. What shipped

| file | change |
|---|---|
| `lib/maps-capture-policy.js` (new) | the one versioned policy: all four STATUS controls on, Data center the only PROJECT TYPE, REGULATORY off. Page-half + evidence validator + copy. |
| `lib/maps-capture-binding.js` | the policy version rides in the capture key **for governed posts only**; boundness additionally requires complete, self-consistent measured evidence. |
| `scripts/maps-social-image.mjs` | injects the policy, applies it, re-verifies at the shutter, writes `evidence.visual.capture_policy`, attaches **conditionally**, clears the session bleed. |
| `acquisition.html` | image cache keyed on id **+ image path**; accurate policy-staleness copy; loads the policy module with a content cache key. |
| `homesignal-ingest/supabase/migrations/20260921120000_…sql` | the server guard, inside `social_posts_publication_guard`. **Parked — not applied.** |

The policy is applied **through the real controls** (`.checked` + a `change` event, which runs
the page's own `setStage` / `setType` / `setRegulatory` → `applyFilter`) under condition-based
bounded waits. It fails closed on a missing or duplicated control, a status set the policy was
never reasoned about, a handler that does not take, a target no longer drawn, or a map that
will not settle.

⚠️ **THE EVIDENCE ATTESTS THE CONTROLS AND THE DRAWN LAYER — IT IS NOT A DIGEST OF THE PNG,
and no claim of that kind is made anywhere.** What it removes is the class of approval where
the evidence is missing, legacy, malformed or contradictory.

## 3. Affected population, measured (2026-09-21)

| | count |
|---|---:|
| project-backed Data Center Theme rows | **8** (all `draft`) |
| …carrying an image, i.e. due for replacement | **7** |
| …carrying an image WITH current policy evidence | **0** |
| approved or published rows in the whole table | **0** |
| absence posts (unaffected) | 2 |
| ordinary MAPS rows (unaffected) | 32, of which **4** carry an image |
| ALERTS rows (unaffected) | 173 |

**Blast radius on ordinary MAPS captures is ZERO, measured on the real rows** rather than
argued: all 4 ordinary MAPS drafts with an image derive `theme=null`, are ungoverned, and
their keys keep the same 11-field `v1|…` shape with no policy segment.

## 4. Release sequence

1. **Server first, then client.** The client gate lives in a page a browser can cache, so a
   stale `acquisition.html` keeps the old rule. Applying the migration first closes that
   window; shipping the client first leaves it open exactly as wide as it is today. **No
   guard is weakened at any point** — the client change only ever ADDS blocking, so there is
   no temporary bypass to create, and none is introduced for rollout convenience.
2. **Cache invalidation** is already in the diff: `lib/maps-capture-policy.js?v=b9e57bde` and
   `lib/maps-capture-binding.js?v=c32f73f5` are content hashes, pinned by
   `test/lib-cache-keys.test.mjs`.
3. **Temporary fail-closed behaviour is expected and correct:** the moment the client ships,
   all 7 imaged Data Center drafts report `WAITING_CAPTURE` and Approve is blocked. The
   dashboard says why, and says explicitly that the draft has NOT changed.
4. ⚠️ **THE CAPTURE WORKFLOW IS ENABLED AND ON A 6-HOUR CRON** (`.github/maps-social-capture`
   = `capture-enabled`, `cron: '25 */6 * * *'`, default `--limit 8`) — **confirmed, not
   changed.** So the first scheduled fire after the merge would pick up **all 7** at once
   rather than the Mesa canary alone. To keep the canary first, dispatch
   `maps-social-image` manually with
   `ids=78ee8931-c114-4824-9a29-32f6b50b38c2` **before** a scheduled fire lands, or merge
   just after a fire to maximise the window. Both need separate authorization.
5. **Canary = Mesa only**, then the four post-capture checks in §5 below, then bounded
   batches. No full-ZIP crawl, no queue reset, no mass evidence rewrite.
6. **Rollback** is `git revert` of the client commit. It restores the previous gate; it does
   **not** relabel any stale image as valid, because nothing in the rollback writes evidence.
   A capture taken under `dc-map-state@1` keeps its own object path and its own record. If
   the migration has been applied and the client is reverted, the server guard still blocks —
   which is the safe direction.

## 5. What to verify after an authorized Mesa recapture

1. The intended code and assets are actually deployed (not merely merged).
2. Recapture **only** `78ee8931-c114-4824-9a29-32f6b50b38c2`, through the existing workflow.
3. Inspect the real private-bucket image.
4. Verify: the four status boxes checked, Data center checked, every other type unchecked,
   Regulatory facilities **unchecked**; the target's popup names the Mesa permit; the marker
   is drawn; a **new** object path; `evidence.visual.capture_policy` present and compliant.
5. Refresh the dashboard: the new image displays and Approve unlocks only after it paints.
6. Re-read the draft and compare business fields and unrelated evidence against the
   pre-capture snapshot.
7. Confirm no approval, scheduling or publication occurred.

## 6. Concurrency note (Rule #0a), reconciled not absorbed

The Mesa row moved **revision 1 → 2** during this session (`updated_at`
`2026-09-20 23:01:03Z` → `2026-09-21 00:07:31Z`). Cause identified before anything was
written: a **text-only recompose** under the 2026-09-20 MAPS hashtags ruling — `post_text`
now ends `#datacenter #Mesa #HomeSignal.net` and the `hashtags` column is populated. The
image path, `capture_key`, `captured_at` and approval state are all unchanged.

That is this change's own conditional-attach case, live: the old code read a draft, spent a
minute in a browser, and then wrote `evidence` back **whole from its stale snapshot** with no
precondition. Whether that specific write would have lost anything depends on whether
`evidence` moved in the recompose, which cannot be determined after the fact — the point is
that nothing was stopping it. The new attach carries `status=eq.draft` and
`revision=eq.<observed>` in the WHERE clause and reports SKIPPED (stale) instead.

## 7. Known limits, stated rather than buried

- **The server guard validates stored row data, not pixels.** Anyone who can write the row
  can write a compliant-looking blob. RLS is the control there: `social_posts` has RLS on
  with a single owner-email policy, so `anon`/`authenticated` cannot reach it despite the
  broad default table grants. Not a release blocker; recorded because the grant list looks
  alarming on its own.
- **Client and server decide theme membership differently** — the browser derives it live
  from Map 1's classifier, SQL reads the `evidence.theme` stamp (a byte-verbatim port,
  parity-tested in `homesignal-ingest`). `HS.mapsDcCapturePolicyApplies` takes the **union**
  so the client's governed set is a SUPERSET of the server's; there is no row the server
  would police and the dashboard would wave through.
- **An upload precedes the guarded attach**, so a refused attach leaves an unreferenced
  object in the private bucket. Harmless — nothing reads the bucket except through
  `image_bucket_path` — and the alternative (attach first) would name an object that does not
  exist yet.
- **`--ids` bypasses the retry clock, never boundness.** A compliant capture is not
  re-photographed even when named explicitly.
