# Development Activity U02 — one report engine (2026-09-29)

Legacy technical names are unchanged: `future-surroundings-report.html`, `get-future-surroundings-report`, `lib/nyc-v1-*.js`.

## What changed

The page and the edge function now run the same report engine.

- **Before:** the page ran `lib/nyc-v1-report.js` (assembly) and `lib/nyc-v1-soda.js` (the four NYC Open Data queries). The edge function ran a 733-line TypeScript re-implementation of both (`allowlist.ts`), kept in step by comments and a few `report_id` comparisons.
- **After:** `allowlist.ts` is 73 lines and holds only what is specific to the API: request validation and the capability document. It loads the engine through `engine.ts`, which imports two generated copies of the `lib/` files from `supabase/functions/get-future-surroundings-report/engine/`.

| | |
|---|---|
| Canonical truth path | NYC Open Data views → `lib/nyc-v1-soda.js` (queries) + `lib/nyc-v1-report.js` (assembly) → page and API |
| Decision owner | `HSNycV1.assembleReport` and `HSNycV1Soda.loadReport` |
| Second path removed | the TypeScript copies of address matching, the four record queries, row shaping, `canonicalize`, `sha256Hex`, `assembleReport`, `loadReport` |

Change the engine in `lib/`, run `node scripts/sync-fsr-engine.mjs`, commit both. `test/fsr-engine-one-source.test.mjs` (92 checks, in the required `unit` check) fails if the copy is stale, if the function grows report logic of its own, or if the two entries stop agreeing.

## Measured

A 21-scenario corpus (`test/lib/fsr-engine-corpus.mjs`) runs through each entry in its own process, with time frozen and NYC Open Data stubbed: hits, a withdrawn filing, statuses, a same job as filing and permit, sixty permits against the cap of fifty, undated and future rows, a miss, an ambiguous match, a capped candidate read, a matched point with unusable coordinates, three address shapes, four radii, and three publisher failures. Every request URL and every report, including `report_id`, is compared.

| Comparison | Result |
|---|---|
| Page entry vs API entry, tree at `8d58d10` (before) | 20 of 21 identical. The one difference is below. |
| Page entry, before vs after | 20 of 21 identical |
| API entry, before vs after | 20 of 21 identical |
| Page entry vs API entry, after | 21 of 21 identical |
| API entry under real Deno 2.9.6 vs Node 22 | 21 of 21 identical, `report_id` included (`crypto.subtle` in Deno, `require('crypto')` in Node) |
| `deno check` on `index.ts` | passes |
| Offline gate `run-unit-tests.mjs --offline --min-files=75` | 266 of 266 files (265 before, plus the new suite) |
| `nyc-v1-report`, `fsr-scale`, `fsr-audience.browser` | 119, 89, 47 checks, all passing |
| Mutations of the new suite | 12 of 12 killed, each verified to apply |

The 12 mutations: a stray byte in the copy; the copy alone drifting on `ROW_CAP`; the coordinate guard removed from both; a local `fetch`, a second `parseBuyerAddress` and a `$select` literal added to `allowlist.ts`; a new file in the function directory; the capability dataset order changed; a DOM reference added; the API wrapper changing a default radius; the request clamp changed; `engine.ts` no longer loading the SODA copy.

## The one deliberate difference

A matched AddressPoint can carry geometry with no usable coordinates. Before, the two surfaces disagreed:

- **Page:** a `TypeError` ("Cannot read properties of null (reading 'lat')") shown as the status message.
- **API:** an `ok` report with no property and no nearby records, which reads as "nothing near this address" when the location was never determined.

A single engine has to pick one. It now refuses with one clear error on both surfaces (`the matching AddressPoint has no usable coordinates`). That is the fail-closed choice: an unknown location is not an empty neighborhood. Scenario `matched_point_with_unusable_coordinates` pins it. The API is undeployed, so no production caller saw the old behavior.

## The bundling spike

Question from the reconciliation record: can the Supabase CLI bundle a shared file into the function?

Measured with the real CLI (2.118.0, installed from npm into a scratch directory), pointed at a local mock of the Management API through a profile file, so no project was contacted. Three throwaway functions, each importing a file from a different place, deployed with `--use-api`:

| Import | Files the CLI uploaded |
|---|---|
| a file inside the function directory | `supabase/functions/<fn>/index.ts`, `supabase/functions/<fn>/engine/spike.js` |
| `supabase/functions/_shared/` | `.../index.ts`, `supabase/functions/_shared/spike.js` |
| `../../../lib/` (outside `supabase/functions`) | `.../index.ts`, `lib/spike-shared.js` |

So the API route does collect a file from outside `supabase/functions`. The deploy workflow passes no `--use-api`. In the sandbox the Docker daemon is not running, and the CLI printed `WARNING: Docker is not running` and used this route. A GitHub runner normally has a running Docker daemon, so the workflow's default there is presumably Docker bundling, which this could not exercise. Whether the server bundles the uploaded outside file was not exercised either.

**Decision:** keep the engine copy inside the function directory. That layout is what `get-address-report` already deploys through this workflow, and it needs nothing from either bundling route to be true. The first real deploy of this function (U13) is the place to prove the outside import and, if it works, delete `engine/` and `scripts/sync-fsr-engine.mjs`.

## Not verified

- The function has not been deployed and was not run inside Supabase's edge runtime. Deno 2.9.6 is the nearest thing available here.
- The Docker bundling route and server-side bundling of a file outside `supabase/functions` (above).
- The live page at homesignal.net, and print/PDF output.

## Noticed, not changed

- `capability()` returns `signed_paid_pilots: 0` and `verdict: 'NOT YET'` to any caller of `GET`. It is behind `verify_jwt = true`, so it is not a customer surface, but it is internal bookkeeping in an API response. Kept byte-for-byte here; it belongs with U13 (the commercial API).
- The page's failure status still reads "Could not retrieve the allowlisted NYC Open Data views." (`future-surroundings-report.html`, the `.catch` in the run handler). That is engineering wording on a customer page and is a U05 layout item.
- `sha256Hex` in the engine returns the string `unsigned` if neither `require('crypto')` nor `crypto.subtle` exists. Both runtimes here have one, so it is unreachable today, but a `report_id` of `unsigned` would be silent. Worth a guard when U12 separates `report_id` from `content_hash`.
