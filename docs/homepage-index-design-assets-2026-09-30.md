# Homepage index design — visual implementation lock (2026-09-30)

This note records the founder-approved visual implementation for the revised `index.html`.

## 1. Development Activity report preview

Use the approved static asset:

`assets/home-report-example-desktop.webp` (+ `-mobile.webp` for phones)

It is a placeholder and may be revised later. Do not regenerate, redesign, or substitute legacy NYC/future-surroundings UI in the homepage implementation order.

## 2. Development map preview

Do **not** create a homepage map PNG/WebP.

Render the existing Map 1 product surface:

`homesignalmap.html?embed=1&preview=1&zip=75034`

The initial homepage sample is noninteractive at the host wrapper level, but it must retain Map 1's own **STATUS / PROJECT TYPE / REGULATORY RECORDS** controls, map key, markers, geography, and data. After a user searches, the same Map 1 iframe becomes interactive with the searched ZIP or resolved address.

There is one map implementation: `homesignalmap.html`.

**Revised 2026-10-12 (real example report):** the preview is the REAL report for 3999 Touraine Dr, Frisco, TX 75034, rendered by `lib/da-report-view.js` over the stored report body in `data/home-showcase/touraine-75034-report-body.json` (byte-identical to the production snapshot; md5 pinned). `node scripts/build-home-showcase-preview.mjs` builds both webp files and `data/home-showcase/preview-receipt.json`; `--check` is read-only and compares the rendered TEXT (font-independent) and asset sizes. It shows 4 of the 9 records (one per kind) and says so in the image. Verification screenshots: `docs/receipts/home-showcase/`. The ZIP-wide Map 1 sample now also uses Frisco 75034 (with live ZIP-specific records), matching the 3999 Touraine Dr report example; no fabricated development cards are hardcoded into the homepage.
