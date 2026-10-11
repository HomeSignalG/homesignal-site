# Homepage index design — visual implementation lock (2026-09-30)

This note records the founder-approved visual implementation for the revised `index.html`.

## 1. Development Activity report preview

Use the approved static asset:

`assets/home-development-activity-report-preview.webp`

It is a placeholder and may be revised later.

**Revised 2026-10-11:** the asset now shows the CURRENT three-column report (Development | Stage | Quality-of-Life Impact). It is not a drawing: `node scripts/build-home-report-preview.mjs` renders the real `lib/da-report-view.js` over a response from the real request handler (generic "Sample …" fixture rows, labelled "Illustrative sample"), crops the report header and the Nearby Development table, and writes the webp (1448x1241). Re-run it when the report table or the sample property changes; the `?v=` on the `<img>` src must be bumped with it. Do not regenerate, redesign, or substitute legacy NYC/future-surroundings UI in the homepage implementation order.

## 2. Development map preview

Do **not** create a homepage map PNG/WebP.

Render the existing Map 1 product surface:

`homesignalmap.html?embed=1&zip=78657`

The initial homepage sample is noninteractive at the host wrapper level, but it must retain Map 1's own **STATUS / PROJECT TYPE / REGULATORY RECORDS** controls, map key, markers, geography, and data. After a user searches, the same Map 1 iframe becomes interactive with the searched ZIP or resolved address.

There is one map implementation: `homesignalmap.html`.
