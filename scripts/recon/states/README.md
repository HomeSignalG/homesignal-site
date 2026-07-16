# Tier 1 / Tier 2 state recon target sets (2026-07-16)

One JSON file per state in the founder's wire order — the ROUND-1 catalog probes
(Socrata catalog API / ArcGIS Hub DCAT / CKAN package_search / ArcGIS Server roots)
for that state's modeled metros. Run via `recon-fetch.yml` (targets_file input) or
pg_net. Every entry is a PROBE CANDIDATE, never a wire: hits get follow-up rounds
(returnDistinctValues vocab, max-date freshness, column verification) and only
live-receipted, fresh, structured feeds are registered — one reversible
jurisdiction-registry entry each. Guessed conventional URLs are EXPECTED to 404;
the corrected-URL retry (org-scoped AGO search, Hub domains API) is part of the
method before any "no first-party source" verdict.

Tier 1 (recon + wire): 01 PA, 02 FL, 03 OH, 04 NJ, 05 CT, 06 MO, 07 TN, 08 OR,
09 WI, 10 IN, 11 NC, 12 VA, 13 NV, 14 GA, 15 LA, 16 NM, 17 KY
Tier 2 (facilities-floor first, permit recon opportunistic — never forced):
18 ME, 19 AL, 20 NH, 21 IA, 22 KS, 23 OK, 24 SC, 25 NE, 26 AR

PA note (founder-directed): Pittsburgh's WPRDC is CKAN (reuse sources/ckan.ts);
Philadelphia runs on Carto (phl.carto.com SQL API) — one new additive
sources/carto.ts connector, mirroring the CKAN/Socrata pattern.
