# Jody migration — status (the ONE status document)

Updated in the same PR as each step. Do not create a second status file. HomeSignal remains the only active public identity.

| Step | Status | Evidence |
|---|---|---|
| 1 Brand contract | DONE, merged | site #1734 -> `a64df39`; artifact byte-identical (82 files); no push-triggered Pages run |
| 2 Dual-domain compatibility | DONE, deployed | site #1736 -> `11fd3d3`; ingest #653 -> `b074f81`; guard migration applied; see "Step 2 deployment record" |
| 3 Jody staging site | DONE, merged | site #1740 -> `5d769e3`; `jody-staging` ran green on a runner; nothing deployed |
| 4 SEO migration | tooling merged; real-snapshot parity PASSED (run 37971696362) | see Step 4 |
| 5 Zero-cost redirect | built + proven by simulation only; real-HTTP provider test workflow written (`jody-redirect-verify`), needs a Netlify token | see Step 5 |
| 6 Integration + rehearsal | engineering DONE: DNS audit (run 37978348576), Bluesky hold (ingest #655/#656), payment check from code, consolidated founder list; founder items open | `docs/brand/CUTOVER-CHECKLIST.md` top table |
| 7 Cutover | NOT READY: gates G1/G2/G3/G7/G8 open (see Launch readiness); needs founder GO LIVE | `docs/brand/CUTOVER-CHECKLIST.md` |
| 8 Email + Bluesky | not started | |
| 9 Search transition + monitoring | not started | |

## Step 2 — what "supported" means, decided from the inventory (2026-10-09)
Supported = the backend accepts the Jody origin where it ENFORCES an origin. Nothing is activated.

| Component | Finding | Decision |
|---|---|---|
| Site edge functions (Development Activity, reports, billing, watch, share) | one allowlist: `_shared/admin-gate.ts` | DONE in this PR: derived from the contract (`scripts/gen-brand-origins.mjs`) |
| Site public-read functions (`get-address-report`, `geocode-address`, ...) | `Access-Control-Allow-Origin: *`, no allowlist | no change needed |
| Outbound email/report links (`BILLING_PAGE`, `SHARE_PAGE`, `INVITE_PAGE`, `WATCH_*`) | emit homesignal.net | unchanged until Step 8 (pinned by test) |
| Shipped runtime (`lib/share-text.js` host check, `gen_zip_pages.py`/`page_semantics.py` `BASE`, `indexnow.py` `HOST`) | single-origin, change public bytes | Steps 3-4 (build-time brand); changing them now would alter the live artifact |
| Ingest edge functions (`submit-public-form`, `social-approve`, `fetch-youtube-transcript`) | origin allowlists | DONE: ingest #653, deployed 2026-10-09 |
| Ingest DB Map 1 destination guard | pins `https://homesignal.net/homesignalmap.html?zip=` | DONE: migration applied 2026-10-09 |
| Bluesky URL generation (`generate-maps.mjs`, `generate.mjs`) | emits homesignal.net | Step 8, after the DB guard accepts both |

Deploy note: edge functions deploy only by manual dispatch of `deploy-edge-functions.yml`; merging does not deploy them.

## Step 2 deployment record (2026-10-09)

- **DB guard**: `public.hs_maps_universal_violations` body md5 `0d73e1b8...` -> `eb97581d5f8c49db49942b2b83c9c188` (applied through the drift-guarded migration; volatility stable, not security definer, unchanged). Checked live on a real MAPS row: homesignal.net accepted, jodytracks.com accepted, `jodytracks.com.evil.io`, another path and `http://` each refused; all 98 stored MAPS rows still 0 violations. Rollback body: ingest `tests/dual_origin_guard_pg/live_body_0d73e1b8.txt`.
- **Edge functions redeployed** (only ones whose last deploy was after every other pending change, so the deploy shipped this change alone): `development-activity-trial` v14, `manage-billing` v10, `view-shared-report` v10 (site); `fetch-youtube-transcript` v12, `social-approve` v12, `submit-public-form` v20 (ingest). Deployed source read back with the three-origin list.
- **Deliberately NOT redeployed**: `follow-development-report`, `manage-property-watch`, `manage-shared-report`, `run-property-watch`, `get-development-activity-report` have other merged-but-undeployed changes (#1640, #1703, #1704, #1706, #1717); deploying them now would ship those unreviewed for release. They pick up the Jody origin on their next normal deploy. No browser on jodytracks.com exists until Step 3, so nothing is blocked.
- Not verifiable from the build sandbox: live CORS preflights (the agent proxy has no egress to Supabase; probes returned 403 for every origin including the control, so they are not evidence). Verification was by deployed-source read-back.

## Step 3 - Jody staging build (2026-10-09)

**How:** one rewrite step over the artifact `stage_site.py` already produces - `scripts/brand_stage.py`, driven by the brand contract. The source tree and the live `pages.yml` are untouched (pinned: the live deploy does not call it). `--identity homesignal` is a verified no-op (byte-identical).

**What it rewrites for Jody:** public origin (canonicals, og, sitemaps, JSON-LD), shipped host allowlists, the display name (including the two-tone `Home<span>Signal</span>` wordmark -> `Jo<span>dy</span>`), the tagline "Know what's coming." (home title, og/twitter title, footer).

**What it deliberately keeps:** file paths (identical-path migration, Step 4); `@homesignal.net` mailboxes (no Jody mailbox until Step 6); `did:web:homesignal.net`; the Supabase project; repo/CSS/storage identifiers. Share/invite link validators accept BOTH origins, because the server still emits homesignal.net links until Step 8.

**Staging safety (`--staging`):** every page noindex, `robots.txt` = Disallow all, no sitemaps, no `CNAME`, no IndexNow key, and the old domain's Google verification file is dropped. Built by `.github/workflows/jody-staging.yml` (manual, uploads an artifact, deploys nothing).

**Proof:** `test/brand-stage.test.mjs` (38 checks incl. negative controls: an unclassified `HomeSignalFoo` fails, a tree with nothing to rewrite fails; 6 mutations killed) and `test/jody-staging.browser.test.mjs` (Chromium: Jody title/canonical/noindex, no visible "HomeSignal", footer tagline, no added page error versus the unrewritten tree).

**A defect the proof caught:** the first noindex injection matched `<header` as if it were `<head`, writing a meta tag into the shared header. Fixed and pinned (2e1).

**Not done / by design:** no legal entity is named anywhere (none invented); footer legal text is as before. Visual design review of the Jody wordmark/logo mark is a founder item (the SVG mark is unchanged). Full per-ZIP document generation is exercised in the Step 4 parity run, not here.

## Step 4 - SEO migration tooling (2026-10-09)

`scripts/seo_parity.py` compares the HomeSignal tree with the Jody **launch** tree (brand overlay without `--staging`) built from ONE generation, so the data snapshot is frozen by construction. It proves: identical document paths (only the old domain's Google verification token may be absent), identical robots directive and canonical PATH per page, identical non-empty indexable set, identical sitemap path/lastmod sets with hosts moved, identical `robots.txt` rules, no reference to the old origin in the Jody tree, identical page-state fingerprints. `test/seo-parity.test.mjs`: parity on a fixture generation (36 pages, 14 indexable, 18 sitemap urls) plus 14 injected defects, empty trees and a staging tree - each refused. `jody-seo-parity.yml` runs the same comparison on a real generation from the live read model (manual, deploys nothing, notifies nobody).

Rule D / Rule F are untouched: the overlay never reads or changes the plane, and robots directives are asserted equal page by page.

**Real-snapshot result (2026-10-09, `jody-seo-parity` run 37971696362 on `main` `793c508`, one generation from the live read model + published Rule D plane):** `ok: true`, 0 problems. 35,284 HTML pages; **26,701 indexable in the HomeSignal tree and 26,701 in the Jody tree (identical sets)**; 6 sitemap files, **56,807 urls on each side** with identical path/lastmod sets; 29,097 page-state fingerprints identical; 35,344 vs 35,343 files (the one absent file is the old domain's Google verification token, the only allowed difference). The overlay is applied to a copy of the same generation, so this proves the migration's effect, not data drift. Reproduce: dispatch `jody-seo-parity`.

**Decided for cutover (not built yet, Step 7):** the page-state baseline is fetched from the PUBLIC host before each build and a 404 means "seed, notify nothing". After cutover the Jody host has no baseline, so the first Jody build seeds and submits NOTHING - this is what keeps IndexNow quiet until the founder's Step 9 decision. `scripts/page_semantics.py`, `gen_zip_pages.py`, `gen_sitemap.py` and `indexnow.py` still hard-code `https://homesignal.net`; they move to a contract-derived host in the Step 7 cutover PR, which needs the GO LIVE.

## Step 5 - zero-cost redirect service (2026-10-09)

`scripts/build_redirect_site.py` builds a static folder for Netlify Free: ONE permanent catch-all `/* -> https://jodytracks.com/:splat 301!` (path and query preserved; a #fragment is kept by the browser across a 301, which matters for `#invite=` and `#share=` links), preceded by files that must keep answering on the old host with 200: `/.well-known/did.json` (copied byte-for-byte; `did:web:homesignal.net` is immutable), the Google ownership file, and a permissive `robots.txt` with no sitemap line. `scripts/verify_redirect_service.py` checks the rules by simulation and probes a live host with real HTTP (no redirect-following; 13 cases). `test/redirect-service.test.mjs`: 8 folder mutations and 4 broken stand-in services are refused.

**What is NOT proven:** Netlify's own behaviour. The simulator proves our rules, not the host. The first real proof is the probe against a `*.netlify.app` preview (no DNS needed) - a founder action, see the checklist.

**Hosting split (corrected):** Netlify carries ONLY the redirect and the DID document (tiny, no build minutes); the revenue site stays on GitHub Pages, so Netlify credit exhaustion cannot take the product down. See checklist section 3.

**Alternatives if Netlify Free is refused** (all zero-cost, none chosen silently): Cloudflare free plan redirect rule (needs the domain's nameservers moved - bigger DNS change); a registrar-level 301 forward if the registrar offers one free (cannot serve the DID file, so unsuitable alone). GitHub Pages cannot send a real 301.

**Hard constraint recorded:** do not change DNS for homesignal.net (the audit below shows its nameservers are Google-hosted, not Shopify; the registrar is Tucows) until the founder's GO LIVE; until then GitHub Pages keeps answering.

## Step 6 - DNS and registration audit (2026-10-09, `jody-dns-audit` run 37978348576, read-only, from a GitHub runner)

| | jodytracks.com | homesignal.net |
|---|---|---|
| Registrar | Infomaniak Network SA | Tucows Domains Inc. |
| Registered / expires | 2026-10-08 / **2027-10-08** | 2026-05-26 / **2027-05-26** |
| Registry status | client transfer prohibited | client transfer + update prohibited |
| Nameservers (DNS host) | `nsany1/2.infomaniak.com` | `ns-cloud-e1..4.googledomains.com` (Google-hosted DNS) |
| A / AAAA / www | **none - does not resolve** (curl: could not resolve host) | A `185.199.108.153`, `www` CNAME `homesignalg.github.io` (GitHub Pages, HTTP 200) |
| MX | `mta-gw.infomaniak.ch` (Infomaniak mail) | Proton (`mail`/`mailsec.protonmail.ch`) |
| SPF | `v=spf1 include:spf.infomaniak.ch -all` | `v=spf1 include:_spf.protonmail.ch ~all` |
| DMARC | `v=DMARC1; p=reject;` (no `rua`) | `v=DMARC1; p=none; rua=mailto:dmarc@homesignal.net` |
| DKIM seen (selectors tried: resend google default selector1 selector2 k1 s1 s2 mail) | none | `resend._domainkey` present |
| CAA | none | none |

**What this changes (corrections to earlier assumptions):**
1. **Who controls homesignal.net DNS is UNRESOLVED, not settled.** The founder reports Shopify shows the domain as Shopify-managed with editable DNS, and the Shopify Admin API agrees it is the primary domain. Public lookups show Tucows as registrar and Google nameservers, which does not prove Shopify's console is inactive. The earlier claim "not in Shopify" is WITHDRAWN. Decisive test: add a probe TXT in the Shopify DNS console and observe it at the delegated nameservers (`jody-dns-authority` workflow). Until then no GO LIVE DNS edit is specified for a provider.
2. **jodytracks.com is registered, current and held at Infomaniak (registered yesterday), with working Infomaniak mail DNS and no web records.** I cannot verify from here that the founder's account is the registrant; RDAP shows the registrar, not the owner.
3. **Mail is already configured at Infomaniak for jodytracks.com**, and the two addresses are `info@jodytracks.com` and `contact@jodytracks.com` (contact@ = real-estate-agent outreach and free-report invitations). Both already exist; no new mailbox is needed. Existence is not verifiable from DNS.
4. **Resend needs four records and NO change to the root SPF.** Resend's SPF/return-path live on the `send` subdomain (MX + TXT), plus a DKIM TXT at `resend._domainkey` and a `rsend` CNAME. Root SPF, MX and DMARC stay as they are, so Infomaniak mail is untouched. The earlier "add Resend to the root SPF" instruction is WITHDRAWN. Exact values: checklist section 2 (domain created in Resend, receiving disabled; values compared by sha256 in the `resend-domain-records` workflow).
5. Both domains expire within 13 months; turn on auto-renew for both (a lapse of homesignal.net would break the redirect AND the immutable `did:web:homesignal.net`).
6. Proton MX on homesignal.net means existing `@homesignal.net` mailboxes keep working after the redirect; the redirect service must not touch MX records (it only needs the web A/CNAME records).

Not verified: who the registrant is, which servers actually serve homesignal.net's zone, Infomaniak mailbox existence, Netlify's real behaviour.


## Launch readiness (corrected 2026-10-09)
Verdict: **NOT READY. GO LIVE not executed.** Open gates: G1 (authoritative DNS control of homesignal.net), G2 (real-HTTP Netlify redirect + DID 200), G3 (Resend domain verified), G7 (auto-renew, counsel/trademark), G8 (Paddle). Payments are a separate gate and stay OFF: Paddle is the intended processor (sandbox approved for both domains); the Lemon Squeezy code is audited in `docs/brand/PADDLE-AUDIT.md` and is not activated. Live Paddle approval and working billing are separate gates. Production DNS, Jody activation and payments are unchanged.

## Evidence recorded 2026-10-10 (read-only runs from `main`)
**Resend records for jodytracks.com** (ingest run 38011246891, `resend-domain-records`, action=list): domain exists, `status=not_started`, receiving not enabled. sha256 prefixes of the live values equal those of the values in the checklist: DKIM `32247e2058267231`, MX value `ee89fd80a0081318`, SPF TXT `c313e30853f26faf`, rsend CNAME value `cc29fc1fd06e1461`. Names (`resend._domainkey`, `send` x2, `rsend`) and MX priority 10 match as printed. The hand-copied DKIM value is therefore exact. Records are NOT yet added at Infomaniak (status `not_started`).

**homesignal.net authority** (site run 38011245097, `jody-dns-authority`, no probe): the .net registry delegates to `ns-cloud-e1..e4.googledomains.com`; all four answer authoritatively (`aa`) with one SOA serial (1), so the zone is served consistently. Apex A `185.199.108.153` (GitHub Pages), `www` CNAME `homesignalg.github.io`, MX/SPF Proton, DMARC `p=none; rua=mailto:dmarc@homesignal.net`, and homesignal.net already has its own Resend `send` and `resend._domainkey` records. **Still UNPROVEN: which console edits this zone** (Shopify, Google Cloud DNS or another). A name server's name does not show that. Gate G1 stays open until a probe TXT added in Shopify's DNS console is observed on all four servers.
