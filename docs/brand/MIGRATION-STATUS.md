# Jody migration — status (the ONE status document)

Updated in the same PR as each step. Do not create a second status file. HomeSignal remains the only active public identity.

| Step | Status | Evidence |
|---|---|---|
| 1 Brand contract | DONE, merged | site #1734 -> `a64df39`; artifact byte-identical (82 files); no push-triggered Pages run |
| 2 Dual-domain compatibility | DONE, deployed | site #1736 -> `11fd3d3`; ingest #653 -> `b074f81`; guard migration applied; see "Step 2 deployment record" |
| 3 Jody staging site | DONE, merged | site #1740 -> `5d769e3`; `jody-staging` ran green on a runner; nothing deployed |
| 4 SEO migration | tooling merged; real-snapshot parity PASSED (run 37971696362) | see Step 4 |
| 5 Zero-cost redirect | **Render Static Sites Free: LIVE HTTP PASS on the preview address (19/19, run 38443897406, `--query-order sorted` founder-approved 2026-10-13).** Netlify superseded. homesignal.net NOT pointed at it; apex/www, certificate and the GO LIVE re-run are still ahead | see Step 5 and "Step 5 addendum" |
| 6 Integration + rehearsal | engineering DONE: DNS audit (run 37978348576), Bluesky hold (ingest #655/#656), payment check from code, consolidated founder list; founder items open | `docs/brand/CUTOVER-CHECKLIST.md` top table |
| 7 Cutover | **GO LIVE PROCEEDING (founder, 2026-10-15). The committed contract is v2 / Jody-current (merged 2026-10-14, `9595e2e`); the build publishes as jodytracks.com. DNS, Render and Pages custom-domain steps are tracked in `CUTOVER-CHECKLIST.md` and are NOT recorded as done here.** Earlier status: NOT READY, NOT EXECUTED. G1 PASSED, G3 PASSED, G2 PASSED on the Render preview. Open: G2 on homesignal.net, G7 (counsel, auto-renew), G8 (founder GO LIVE). The activation machinery is built as a DRAFT PR and is inert (Step 16) | `docs/brand/CUTOVER-CHECKLIST.md` |
| 8 Email + Bluesky | Resend domain jodytracks.com VERIFIED (2026-10-10 18:41Z); nothing sent, no outreach, Bluesky untouched | see "Resend verified" below |
| 9 Search transition + monitoring | not started; IndexNow is HELD for Jody by a committed switch (`docs/brand/indexnow-jody-hold.json`, Step 16) | |
| 16 Cutover PR + audit | MERGED 2026-10-14 (`9595e2e`); the contract flip is live on `main`. Earlier: DRAFT PR open, NOT merged, inactive; query-string audit, activation rehearsal, competing-CTO audit done | see "Step 16" below |

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

**Decided for cutover (not built yet, Step 7):** the page-state baseline is fetched from the PUBLIC host before each build and a 404 means "seed, notify nothing". After cutover the Jody host has no baseline, so the first Jody build seeds and submits NOTHING - this is what keeps IndexNow quiet until the founder's Step 9 decision. `scripts/page_semantics.py`, `gen_zip_pages.py`, `gen_sitemap.py` and `indexnow.py` still hard-code `https://homesignal.net`; they move to a contract-derived host in the Step 7 cutover PR, which needs the GO LIVE. **[Superseded 2026-10-13: they already read the host from the contract through `scripts/brand_host.py` (byte-identical output); Step 16 adds the rest of the activation mechanism. Text above kept as the dated record.]**

## Step 5 - zero-cost redirect service (2026-10-09)

`scripts/build_redirect_site.py` builds a static folder for Netlify Free: ONE permanent catch-all `/* -> https://jodytracks.com/:splat 301!` (path and query preserved; a #fragment is kept by the browser across a 301, which matters for `#invite=` and `#share=` links), preceded by files that must keep answering on the old host with 200: `/.well-known/did.json` (copied byte-for-byte; `did:web:homesignal.net` is immutable), the Google ownership file, and a permissive `robots.txt` with no sitemap line. `scripts/verify_redirect_service.py` checks the rules by simulation and probes a live host with real HTTP (no redirect-following; 13 cases). `test/redirect-service.test.mjs`: 8 folder mutations and 4 broken stand-in services are refused.

**What is NOT proven:** Netlify's own behaviour. The simulator proves our rules, not the host. The first real proof is the probe against a `*.netlify.app` preview (no DNS needed) - a founder action, see the checklist.

**Hosting split (corrected):** Netlify carries ONLY the redirect and the DID document (tiny, no build minutes); the revenue site stays on GitHub Pages, so Netlify credit exhaustion cannot take the product down. See checklist section 3.

**Alternatives if Netlify Free is refused** (all zero-cost, none chosen silently): Cloudflare free plan redirect rule (needs the domain's nameservers moved - bigger DNS change); a registrar-level 301 forward if the registrar offers one free (cannot serve the DID file, so unsuitable alone). GitHub Pages cannot send a real 301.

**Hard constraint recorded:** do not change DNS for homesignal.net (the audit below shows its nameservers are Google-hosted, not Shopify; the registrar is Tucows) until the founder's GO LIVE; until then GitHub Pages keeps answering.

## Step 5 addendum - redirect provider replaced (2026-10-12)
Preferred: **Render Static Sites (Free)**; fallback: GitLab Pages. **Verdict: BLOCKED** (not rejected) on one live test. Full criteria table, labels and audit: `docs/brand/CUTOVER-CHECKLIST.md` section 3a.

| Item | Label |
|---|---|
| Render: 301, splat path preservation, rule not applied where a file exists, A/CNAME at a third-party DNS host | DOCUMENTATION VERIFIED (via search excerpts; render.com not fetchable from the sandbox) |
| Render: query-string preservation, `.well-known` dot-directory published, HTTPS apex/www, commercial use, free limits and charges | BLOCKED (docs silent, conflicting or not read) |
| GitLab Pages: 301, splat, files win, free custom domain, TXT verification | DOCUMENTATION VERIFIED; query preservation not stated (same gap) |
| Builder `--provider render`, committed `redirect-service/render/`, verifier Render interpreter, 19 cases, loop check, `--require-https`, 10 mutations + 6 failing live variants | OFFLINE PASS |
| Any real request to Render | BLOCKED (no account; none made) |
| Netlify | SUPERSEDED. Last attempt: `jody-redirect-verify` run 38278525831, failed at the deploy step (secret missing, inferred). |

G2 now reads "real-HTTP cases pass on Render, DID 200 with original bytes". **2026-10-13: PASS on the preview (run 38443897406, 19/19, sorted query order, DID byte-identical 200). Stays open for homesignal.net until the GO LIVE step 8 re-run.** Nothing points `homesignal.net` at any new host. Production DNS, the Jody cutover, payments and GO LIVE are untouched.

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


## Launch readiness (corrected 2026-10-09) - HISTORICAL, SUPERSEDED 2026-10-13 (see "Launch readiness (current)" under Step 16)
*Retained as the dated record. Its list of open gates is no longer current: G1 and G3 have since PASSED, G2 (Netlify) was replaced by the Render path, and G8 is the founder's GO LIVE, not Paddle.*
Verdict: **NOT READY. GO LIVE not executed.** Open gates: G1 (authoritative DNS control of homesignal.net), G2 (real-HTTP Netlify redirect + DID 200), G3 (Resend domain verified), G7 (auto-renew, counsel/trademark), G8 (Paddle). Payments are a separate gate and stay OFF: Paddle is the intended processor (sandbox approved for both domains); the Lemon Squeezy code is audited in `docs/brand/PADDLE-AUDIT.md` and is not activated. Live Paddle approval and working billing are separate gates. Production DNS, Jody activation and payments are unchanged.

## Evidence recorded 2026-10-10 (read-only runs from `main`)
**Resend records for jodytracks.com** (ingest run 38011246891, `resend-domain-records`, action=list): domain exists, `status=not_started`, receiving not enabled. sha256 prefixes of the live values equal those of the values in the checklist: DKIM `32247e2058267231`, MX value `ee89fd80a0081318`, SPF TXT `c313e30853f26faf`, rsend CNAME value `cc29fc1fd06e1461`. Names (`resend._domainkey`, `send` x2, `rsend`) and MX priority 10 match as printed. The hand-copied DKIM value is therefore exact. Records are NOT yet added at Infomaniak (status `not_started`).

**homesignal.net authority** (site run 38011245097, `jody-dns-authority`, no probe): the .net registry delegates to `ns-cloud-e1..e4.googledomains.com`; all four answer authoritatively (`aa`) with one SOA serial (1), so the zone is served consistently. Apex A `185.199.108.153` (GitHub Pages), `www` CNAME `homesignalg.github.io`, MX/SPF Proton, DMARC `p=none; rua=mailto:dmarc@homesignal.net`, and homesignal.net already has its own Resend `send` and `resend._domainkey` records. **Still UNPROVEN: which console edits this zone** (Shopify, Google Cloud DNS or another). A name server's name does not show that. Gate G1 stays open until a probe TXT added in Shopify's DNS console is observed on all four servers. **[Resolved 2026-10-10, run 38064380388: the probe was observed on all four. See Step 16.]**

## Resend verified for jodytracks.com (2026-10-10)
**PASS.** ingest run 38076820342 (`resend-domain-records`, `list`, from `main`, 18:41:56Z): domain `jodytracks.com` `status=verified`; DKIM TXT `resend._domainkey` verified (sha256 `32247e2058267231`), SPF MX `send` priority 10 verified (`ee89fd80a0081318`), SPF TXT `send` verified (`c313e30853f26faf`), CNAME `rsend` verified (`cc29fc1fd06e1461`). Capabilities: sending enabled, **receiving disabled**; open and click tracking off; region us-east-1.

**DNS evidence at 18:37Z** (site run 38076506706, `jody-dns-authority`): both Infomaniak authoritative servers (`nsany1`, `nsany2`) agree on all four records with one SOA serial, and Cloudflare 1.1.1.1, Google 8.8.8.8 and Quad9 9.9.9.9 return them. Root MX (`5 mta-gw.infomaniak.ch`), root SPF (`v=spf1 include:spf.infomaniak.ch -all`) and `_dmarc` (`v=DMARC1; p=reject;`) were unchanged on both servers.

**Timeline:** records added by the founder 2026-10-10; Resend `pending` from 16:19Z; `rsend` verified 16:51Z; the other three verified between 18:37Z and 18:41Z, about 2 h 20 min after the DNS was already correct on every server. The only action in between was repeated read-only `verify` calls; no DNS was changed.

**Not done, by instruction:** no customer email sent, no outreach activated, no website DNS change, no GO LIVE. The mailboxes are `info@jodytracks.com` and `contact@jodytracks.com` (contact@ = real-estate-agent outreach and free-report invitations); their existence cannot be verified from DNS. DMARC reporting is recommended, not required; the existing `p=reject` is unchanged.


## Step 16 - cutover machinery, query-string audit, competing-CTO audit (2026-10-13)

**Nothing was activated.** No DNS, Pages-domain, payment, outreach or IndexNow change was made, and the committed contract is still v1 / HomeSignal-current. A rehearsal that flips the contract in a throwaway copy proves what activation will do. Evidence labels: **OFFLINE** (our tests, no provider), **STAGING** (a real provider or database, not the production hosts), **GO-LIVE-ONLY** (cannot be shown before the founder's GO LIVE).

### Launch readiness (current)
| Gate | State | Evidence |
|---|---|---|
| G1 authoritative DNS control of homesignal.net | **PASSED** 2026-10-10 | `jody-dns-authority` run 38064380388 (probe `_jody-dnstest.homesignal.net`): `FOUND "ok"` on ns-cloud-e1, e2, e3 and e4, "probe present on 4 of 4 authoritative servers". The record's later absence is the intended cleanup, not a regression. |
| G2 real-HTTP redirect + DID 200 | **PASSED on the Render preview** (run 38443897406, 19/19, `--query-order sorted`). **OPEN for homesignal.net**: apex/www, certificate and the redirect/DID tests must be re-run against `https://homesignal.net` after DNS (GO-LIVE-ONLY). | see Step 5 addendum |
| G3 Resend domain verified | **PASSED** 2026-10-10 | ingest `resend-domain-records` run 38076820342: `jodytracks.com status=verified`; DKIM, SPF MX `send`, SPF TXT `send` and CNAME `rsend` each `verified`; sending enabled, receiving disabled. |
| G4 SEO parity | passed once (run 37971696362); **re-run on the day** | the Step 16 rehearsal (below) re-proves it for the activation path on a fixture |
| G5 flip PR builds clean as a draft | **Built as a draft, not merged** (Step 16 PR) | below |
| G6 Bluesky publish hold | mechanism built; set `hold: true` at GO LIVE step 1 | ingest `data/brand-publish-hold.json` |
| G7 counsel / registrar auto-renew | **OPEN (founder)** | no trademark search has been run; auto-renew not confirmed |
| G8 founder GO LIVE | **OPEN (founder)** | |
Verdict: **NOT READY for GO LIVE until G2-on-homesignal.net is run, G7 is cleared and the founder authorizes G8.** The former blockers G1 and G3 are removed. Payments are a separate project and are not a Jody gate.

### Query-string and fragment audit (both repositories)
Render sorts query keys stably (every byte of every pair kept). The founder accepted that for the preview verifier, which does not prove an application URL survives it, so every consumer was read.
**Result: no flow depends on raw query order. No production blocker from ordering.** One real defect was found elsewhere on the activation path (share-text allowlist) and is fixed in the draft PR.

| Flow | Verdict | Evidence |
|---|---|---|
| Digest footer unsubscribe `homesignal.net/unsubscribe?t=<token>` | PASS | single parameter read by name (`unsubscribe.html`, `URLSearchParams.get('t')`); `redirect-fragment-query.browser.test.mjs` sends the same token to the backend with and without extra/reordered parameters |
| One-click `List-Unsubscribe` header | PASS | targets the Supabase function directly, never homesignal.net (`digest.py` 379-384, 1666), so no 301 can turn the POST into a GET |
| Outreach unsubscribe `?c=&t=` | function PASS / link builder NOT VERIFIED | named reads; the token is `HMAC(contactId)` only (`outreach-unsubscribe/index.ts`). No link builder exists in the repository (outreach is inactive), so what a future email would contain is unverified |
| Shared-report links `#share=<43 chars>` | PASS (OFFLINE) | token is in the **fragment**: never sent to any server, so ordering cannot matter. Real Chromium: the fragment survives a Render-style 301 (no fragment in `Location`), the real `shared-report.html` posts the same token to its backend, then removes it from the address bar. The fragment surviving Render itself is browser behaviour, not shown against Render: NOT VERIFIED live |
| Evaluation invites `#invite=`, property hand-offs `#address=` / `#follow=` | PASS (OFFLINE) | same test, same mechanism |
| Authentication | PASS | sign-in is a 6-digit email code (`signInWithOtp` / `verifyOtp`): no callback or redirect URL, no query parameter. **Not a query issue but real:** the browser session lives in `localStorage` of one origin, so every returning user signs in once on jodytracks.com. Their data is server-side. Say so in the launch notice |
| Signed / HMAC-protected URLs | PASS | none sign a query string. Lemon billing: `HMAC(brokerageId)` travels in the processor's custom data, webhooks sign bodies, Svix webhooks sign bodies, storage signed URLs live on supabase.co |
| Property-watch e-mail | PASS | link is `WATCH_OPEN_URL`, no query, no token |
| Marketing / Bluesky `?zip=&utm_source=&utm_medium=&utm_campaign=` | PASS | read by name (`captureReferral`, `HS.parseZipParam`, `zipFromLocation`); only the stored `landing` string, an informational label, changes order. Repeated keys keep their order, so first-wins is unchanged |
| Share-by-text `share-text.html?u=&c=` in already-sent digests | **FAIL in a Jody build, FIXED in the draft PR** | named reads, but the Jody overlay rewrote the host allowlist to `jodytracks.com` alone, so `u=https://homesignal.net/...` from an old e-mail was refused (the button showed an error). The overlay now keeps both hosts (closed pair, not an open relay) |
| Existing indexed / stored URLs | PASS / NOT VERIFIED in Search Console | indexed pages are path-only (`/community/<zip>/`); `?zip=` map URLs are not in the sitemaps |

### The draft PR (inert until the contract changes)
Pieces, each with a test and a mutation check: a source-identity-aware overlay step in `pages.yml` (no-op while HomeSignal is current; keyed to the committed source identity, not to the contract, so activation cannot publish a HomeSignal-branded tree on the Jody host); the dual-host share allowlist; a Search Console slot (`docs/brand/search-console/`, empty, refuses a file that would not verify); contract **v2** accepted by the validator (the swap, nothing else; v1 stays frozen); the edge-function link and sender constants derived from the contract (`SHARE_PAGE`, `INVITE_PAGE`, `BILLING_PAGE`, `WATCH_*`; byte-identical under v1); and a committed IndexNow hold for any non-HomeSignal identity (`docs/brand/indexnow-jody-hold.json`, `hold: true`, fails closed, not consulted while HomeSignal is current).
**Activation is one reviewed data change**: the contract file becomes v2 (current `jody`, HomeSignal legacy/redirect-only) and its hash is re-recorded. There is no second pipeline: `pages.yml` is still the only workflow that deploys Pages.
**Rehearsal** (`test/cutover-rehearsal.test.mjs`, OFFLINE): flips the contract in a throwaway copy, runs `stage_site` -> `gen_zip_pages` -> `brand_stage` as `pages.yml` does, and proves the result is byte-identical to the already-proven Jody launch tree except the two files that hold page fingerprints (a fingerprint hashes the page's canonical URL, so it differs by host; the first Jody build seeds its own baseline, which is also why it announces nothing), with SEO parity otherwise exact, Jody-only hosts in sitemaps/robots/canonicals/page-state, IndexNow held, DID and mailboxes untouched.
**Not in the PR, deliberately:** server-delivered copy that says "HomeSignal" inside report bodies (`allowlist.ts` product name, `changes-since-report.ts`) and the digest/confirmation e-mail copy and sender names (ingest repo) - customer-facing wording needs the founder's and counsel's decision; the e-mail and Bluesky LINK bases in the ingest repo (separate repo, separate PR); Bluesky hashtags (`#HomeSignal.net`, founder-locked wording).

### Edge functions: deployed code versus `main` (read from production 2026-10-13, deployed source diffed against `origin/main`)
| Function (deployed version) | Same as `main`? | Consequence |
|---|---|---|
| `get-development-activity-report` v25, `manage-billing` v10 | identical | none |
| `development-activity-trial` v15 | differs in `_shared/evaluation-reads.ts` (archive/restore additions) | redeploy ships unreleased changes |
| `follow-development-report` v13, `manage-property-watch` v8, `run-property-watch` v9 | differ in `admin-gate.ts` (**still the old two-origin CORS list: jodytracks.com is refused**), `service-rest.ts`, `national-report.ts`, `report-snapshot.ts`, `evaluation-reads.ts` | on jodytracks.com their browser calls are blocked until redeployed, and redeploying also ships the other merged changes |
| `manage-shared-report` v8 | old two-origin list (read from the deployed `admin-gate.ts`) | same |
**These are a GO LIVE gate, not a code defect:** the owner of those merged changes must authorize deploying them, in the same window as the link-constant redeploy. Merging the Step 16 PR deploys nothing (functions deploy only by manual dispatch). Live free-evaluation limit read from the database: `evaluation_report_limit()` = **10**.

### Render: commercial use, limits, monitoring (documentation read through search excerpts; render.com is not reachable from the build sandbox, so the full pages are not quoted)
- **Commercial use of the free Hobby plan: NOT VERIFIED, and ambiguous.** Render's own pricing post calls Hobby "our free plan for personal projects". The Terms (last modified July 10, 2026) contain no free-tier commercial ban in the excerpts, mention "commercial purposes" only in the arbitration clause, and say Render may add usage limits or stop features without notice. The Acceptable Use Policy bars reselling and abuse; it says nothing about redirects. **The founder (or counsel) must read the live Terms and pricing page before relying on Hobby for a business redirect.** Fallback if refused: a paid Render Static Site, or the GitLab Pages alternate evaluated in section 3a.
- **Allowance:** 5 GB/month outbound bandwidth on Hobby, shared by every service in the workspace; 2 custom domains included; $0.15/GB overage only if a payment method is linked. **With no payment method, Render spins down the workspace's services until the next month** - redirects and the DID would go offline. No card was requested when the service was created, so there is no surprise bill but there is a hard stop. Render may also act on unusually high public traffic to a free service.
- **Order of magnitude (estimate, not measured):** a redirect response is a few hundred bytes of headers, so 5 GB is on the order of 10 million requests a month.
- **Design for a no-cost daily check (NOT activated; needs the founder's approval because it is a new scheduled job):** a `schedule:` trigger on `jody-redirect-verify` mode `probe` against `https://homesignal.net` with the same 19 cases. It uses no secret and costs only Actions minutes. A failure turns the run red, and GitHub e-mails the repository owner on a scheduled-workflow failure (no new service). It proves availability, 301, DID bytes and the Google token every day. It does **not** measure bandwidth. For bandwidth the no-cost options are: the founder reads Render's Metrics page weekly for the first month; or, if Render's API exposes bandwidth to a free workspace (NOT VERIFIED), a read-only API key stored as a GitHub secret (also a founder action). Alert thresholds if measured: warn at 3 GB, act at 4 GB.
- **The emergency fallback written in section 3 is wrong after GO LIVE.** "Repoint homesignal.net back to GitHub Pages" stops working once the Pages custom domain is `jodytracks.com`: Pages answers an unknown host with 404. A real fallback must be prepared before GO LIVE (a second redirect host with the DID file already deployed and verified, e.g. the GitLab Pages alternate), and the DNS values for it recorded. This is an open item, not a solved one.

### Commercial readiness (unchanged, verified)
Paddle remains the selected processor and is **not live**: no Paddle integration or live payment test has passed, and no checkout is ready. The free evaluation is **10 reports** (database `evaluation_report_limit()` = 10 read 2026-10-13; an older plan line that says 20 is superseded by the 2026-10-09 individual-agent model). The planned individual-agent product is **$79/month for 100 reports**; its checkout and entitlement are not implemented (`subscriptions` has 0 rows). Lemon Squeezy and the $9.99 annual alerts product are not activated and must not be.

### Competing-CTO verdict for the draft PR
**PASS for merging the draft PR as inert machinery** (every new path is a no-op while the contract is v1; the rehearsal proves the activated path offline). **BLOCKED for GO LIVE** on: G2 on homesignal.net, G7, G8, Render commercial-use confirmation, the edge-function deploy authorization, and a tested post-cutover fallback for the redirect host. Full table: section "Competing-CTO audit" in `docs/brand/CUTOVER-CHECKLIST.md`.

### The 31-step Jody checklist (consolidated 2026-10-13 from Steps 1-16, the founder table and the GO LIVE sequence; completed items are struck through)
**A. Foundations (engineering)**
1. ~~Brand contract v1 and pin (site #1734)~~
2. ~~Dual-origin backends and the database guard, deployed (site #1736, ingest #653)~~
3. ~~Jody staging build (site #1740)~~
4. ~~SEO-parity tooling and a real-snapshot PASS (run 37971696362)~~
5. ~~Redirect-service builder, simulator and verifier (site #1880, #1891)~~
6. ~~Redirect provider decision: Render replaces Netlify (section 3a)~~
7. ~~Render preview deployed, rule entered, 19/19 live PASS (G2 on the preview, run 38443897406)~~
8. ~~Bluesky publish-hold mechanism (ingest #655/#656)~~
9. ~~DNS and registration audit~~
10. ~~Resend domain jodytracks.com created and records read back~~
11. ~~Resend records added by the founder; domain verified (G3, run 38076820342)~~
12. ~~Shopify DNS authority proven: probe seen on 4 of 4 nameservers (G1, run 38064380388)~~
13. ~~Paddle code audit; payments stay off~~
**B. Step 16 (engineering)**
14. ~~Query-string and fragment audit across both repositories~~ (above)
15. ~~Cutover machinery built as a DRAFT PR, inert, not merged~~
16. ~~Activation rehearsal in a throwaway copy~~
**C. Founder-only prerequisites (open)**
17. Turn on auto-renew at Infomaniak (jodytracks.com) and Tucows (homesignal.net)
18. Counsel: trademark/name clearance for "Jody"/"JodyTracks"; read the Jody privacy and terms pages (G7)
19. Read Render's live Terms/pricing: confirm a business redirect on the free Hobby plan is allowed (or choose a paid plan)
20. Approve (or decline) the daily availability probe as a scheduled job
21. Read the current DNS TTLs in Shopify for the homesignal.net web records and lower them at least one old-TTL ahead of GO LIVE
22. Decide the Search Console method (DNS TXT for a Domain property, or commit the Google file into `docs/brand/search-console/`)
23. Authorize the edge-function deploy set (the merged-but-undeployed changes in the table above) and approve a prepared post-cutover fallback host
**D. GO LIVE (founder authorization, G8)**
24. Bluesky `hold: true`
25. Add homesignal.net and www as custom domains on the Render service; read back the DNS values
26. Add the jodytracks.com web records at Infomaniak
27. Set the GitHub Pages custom domain to jodytracks.com
28. Merge the contract-v2 PR; dispatch `pages`; wait for the jodytracks.com certificate; engineering polls TLS and content
29. Repoint homesignal.net at Render (Shopify "Edit DNS records" only), immediately after step 28 is green, to keep the window short
30. Redeploy the edge functions (origin list, link and sender constants); add `https://jodytracks.com` to Supabase Auth; re-run `jody-redirect-verify` against `https://homesignal.net` (G2 final) and the DID byte check; `hold: false`
**E. After launch**
31. Search Console verify + Change of Address, Bing Site Move; release the IndexNow hold only by a reviewed `hold: false`; 180 days of monitoring

## Step 16 final hardening: independent competing-CTO audit (2026-10-13)

Scope: site PR #1895 and ingest PR #663, both DRAFT, on the existing branches. Nothing merged, deployed, repointed or activated. G1 and G3 are not reopened.
Evidence labels: **LOCAL** (run in the build sandbox), **CI** (GitHub Actions on the PR head), **PREVIEW** (live HTTP against the Render preview), **PRODUCTION** (read-only reads of production state), **GO-LIVE-ONLY** (cannot be run before GO LIVE).

### A. Rule D dependency (EXTERNAL, not Jody's; not worked around)
- The `pages` build on `main` has failed on every scheduled run in every run listed from run 988 (2026-10-13 06:45Z) on at the step "Fetch the published Rule D plane": `fetched Rule D plane is stale (61.5h > 36h)`. PR #1895's `build` job fails at the same step (run 38452509854), before any file this PR touches.
- The producer (`refresh-development-seo-plane.yml`, homesignal-ingest) failed on its latest scheduled run (38352774380) with `RPC app_development_projects_for_zips ... 57014 statement timeout`. Owner: the Denton / Rule D recovery session (diagnostic PR homesignal-ingest#662, draft). **Jody does not modify the producer, the 36-hour threshold, the plane, Denton records or the gate, and opens no duplicate recovery PR.**
- Consequence for Jody: a GO LIVE build cannot pass until a fresh plane is published, because the cutover build goes through the same `pages` workflow. A red `build` job is an EXTERNAL BLOCKED result, never a PASS.
- **Evidence needed before Jody proceeds:** (1) a scheduled or dispatched producer run that publishes (`generated_at` younger than 36 h, the three objects with equal `generated_at`); (2) the normal `pages` build on `main` green on that fresh artifact; (3) then the full-national SEO parity re-run (section G) on that snapshot. Until then the PR's other finished checks (all green; `deploy` and `indexnow` are skipped because they need `build`) are the evidence, labelled as such.

### B. Confirmed defects fixed on the existing draft branches
| # | Severity | Defect | Evidence | Fix | Retest |
|---|---|---|---|---|---|
| D1 | HIGH | The watch e-mail sender follows the brand (`Jody <noreply@jodytracks.com>`) but carried no Reply-To; a domain verified at the mail provider says nothing about a person reading replies, so an agent's reply to a Jody watch e-mail would go to a mailbox that does not exist | `watch-email.ts` `WATCH_FROM`; `email-send.ts` sent five fields only | `REPLY_TO_BY_IDENTITY` in `scripts/gen-brand-origins.mjs` (homesignal `null`, jody `info@jodytracks.com`, customer support; corrected from `contact@` per the founder's mailbox assignments), generated `PUBLIC_REPLY_TO`, `reply_to` forwarded only when set | LOCAL `test/step16-outbound-email.test.mjs` 16 PASS: v1 body has EXACTLY the five fields it always had; v2 renders `info@`; `contact@` is refused as a reply destination; the REAL handler to the REAL sender to the provider request is run under v1 and under a Jody-generated copy, with a mutation that fails it |
| D2 | HIGH (SEO proof) | The "two expected fingerprint differences" were asserted only as "the hashes differ", which would also hide a real content change | `cutover-rehearsal` 2b2/3b; `seo_parity.py` reported the difference as a named problem | `seo_parity.host_derived_fingerprint_problems`: per page, tree A's written page with its build day restored and its origin mapped to Jody's must re-fingerprint (with the ONE `page_semantics.fingerprint`) to B's stored hash; a control re-fingerprints A unmapped first; a page failing either is named | LOCAL rehearsal 3b: 7 of 7 proven; control 7 of 7; 3b2 text change, 3b3 robots change, 3b4 canonical-path change each NOT excused; 3b5 unchanged copy passes |
| D3 | MED (docs) | The activation order put the Pages domain flip BEFORE the homesignal.net repoint, which leaves homesignal.net (and the permanent Bluesky DID document) answering 404 from the flip until the Shopify repoint, a gap of certificate-wait length | Pages serves any host other than its one custom domain with 404 | New dependency-ordered plan (CUTOVER-CHECKLIST "4b"): Render serves homesignal.net FIRST | documented; the gap that remains is characterized in "Rollback and downtime" |
| D4 | LOW (docs) | PR #1895 body and CUTOVER-CHECKLIST gave 30/27/31 for suites that run 31/26/30 | recounted | corrected in both | PR body updated |

### C. Findings not fixable inside this scope (recorded, owner named)
- **Four deployed edge functions are behind `main`** (table in section D). Owner: founder authorizes the deploy set; engineering deploys at GO LIVE.
- **Render free plan, commercial use: NOT VERIFIED.** The sandbox cannot reach render.com. Render's docs, as returned by search, advise against free instances for production; no commercial-use ban was found in them, and the Terms of Service text could not be read. Owner: founder (read the Terms) or choose a paid plan.
- **Render bandwidth exhaustion with no payment method SUSPENDS all Free services for the rest of the month** (docs.render.com/free, via search excerpt). That would take the redirects and the DID document offline. No hard cap can be set. Owner: founder decision plus the monitor in section F.
- **Remaining hardcoded `homesignal.net` customer-facing links in homesignal-ingest outside this PR's scope** (all still work through the 301): `outreach/social_sender.py` `LINK_URL`, `outreach/log_youtube_comment.py` example, `scripts/generate-social-drafts.js` default link and `scripts/screenshot-alert.js` `PAGE_URL` (legacy Box Elder drip). Outreach is gated off; these must be derived before OUTREACH READINESS is claimed.
- **No Paddle code exists.** Billing code (`lemon-billing.ts`, `development-activity-billing-webhook`, `manage-billing`) is Lemon Squeezy only. `manage-billing` fails closed (`not_set_up`) when the processor is unconfigured, which keeps the "$79/month" link from charging anyone. See section H.

### D. Deployed edge functions vs `main` (PRODUCTION read 2026-10-13; the source of each was compared against git)
All 30 database functions these four call exist in production (control: 1,087 public functions), so none depends on an unapplied migration. In every case the function-specific files (`index.ts`, `handler.ts`, `data.ts`) are unchanged since deploy; only shared modules drifted, and `main` equals the commit at which `get-development-activity-report` v25 (deployed 2026-10-12 15:51Z, one minute after #1851 merged) was built, so the same shared drift is already live in that sibling.
| Function | Deployed | Required Jody change | Other undeployed changes that ship (shared modules, vs the nearest `main` commit before deploy) | Tests | Rollback | Verdict |
|---|---|---|---|---|---|---|
| follow-development-report | v13, 2026-10-01 | `admin-gate` CORS now from `brand-origins.generated` (+ jodytracks.com) | `admin-gate` (78 lines), `national-report` (234), `changes-since-report` (54), `report-snapshot` (130), `report-rights.json` (245), `service-rest` (25), `project-type.generated` (11) | `follow-*`, `national-report`, `report-snapshot` suites | capture `get_edge_function` source (hash `ezbr_sha256 95ddabb1...`) before deploy | DEPLOY AT GO LIVE after founder reviews the list; not "one line" |
| manage-property-watch | v8, 2026-10-03 | same | `admin-gate` (15), `evaluation-reads` (127), `national-report` (68), `report-snapshot` (34), `service-rest` | watch, evaluation-reads | `ezbr fc245948...` | same |
| run-property-watch | v9, 2026-10-04 | same, plus step-8 redeploy for sender, Reply-To and link | as above | watch-email, run-property-watch | `ezbr a5d18d46...` | same |
| manage-shared-report | v8, 2026-10-03 | same, plus step-8 redeploy for `SHARE_PAGE` | `admin-gate`, `evaluation-reads` (127), `share-reads` (8), `service-rest` | share-link-functions | `ezbr a9e0cbc7...` | same |
- **Do not deploy by hand-patching one line**: the deploy path bundles the whole import closure, and a hand-built bundle would bypass the repo's tests. The smallest safe resolution is the founder authorizing the set above (all of it is merged, tested and already live in the sibling function) and engineering deploying through `deploy-edge-functions.yml`, which checks out the dispatched ref.
- **Rollback is NOT rehearsed.** The deployed source is retrievable (`get_edge_function` returns every file, hash-checkable against `ezbr_sha256`); redeploying it requires either a branch at the matching `main` commit dispatched through the same workflow, or the MCP deploy (about 30 KB payload ceiling, which these bundles exceed). Create and test that branch BEFORE the deploy.
- **Link-emitting functions needing the SECOND redeploy after the contract is v2** (their link and sender constants follow the contract only then): manage-shared-report, development-activity-trial, get-development-activity-report, manage-billing, development-activity-billing-webhook, run-property-watch.

### E. Outbound e-mail audit
| Sender | Where configured | Jody state | Verdict |
|---|---|---|---|
| Watch e-mail | `watch-email.ts` `WATCH_FROM` from the contract | `Jody <noreply@jodytracks.com>` + Reply-To `info@jodytracks.com` (D1) | OK once step 8 redeploys; domain verified (G3); mailbox `info@` exists (Infomaniak; customer support). `contact@` is agent outreach and is never a reply destination |
| Digest | `digest.py` `RESEND_FROM` env, secret `RESEND_FROM` in `digest.yml`, default `HomeSignal <notices@homesignal.net>` | the GitHub secret is not read from here; **it stays a HomeSignal sender until the founder changes the secret** | GO LIVE item: set deliberately, decide the display name; the digest copy names HomeSignal (identity-bound, unchanged) |
| Confirmation e-mail | `confirm-alerts` `RESEND_FROM` env, default `HomeSignal <notices@homesignal.net>` | same | same |
| Ops mail (`notify-signup`, `notify-health`) | `noreply@homesignal.net` to `hello@homesignal.net` (Proton) | unchanged | keep: depends on homesignal.net MX only, which the cutover does not touch |
- `UNSUBSCRIBE_PUBLIC_URL`: no override in any workflow; the default derives from the pin. One-click List-Unsubscribe POSTs go to the Supabase function URL, not to a domain we redirect.
- Not verified (needs a send, forbidden here): Resend acceptance of a Jody sender through the API, DMARC alignment on a real message, bounce handling. DNS-level authentication was verified by G3.
- Notifications generated before activation keep their homesignal.net links and keep working through the 301.

### F. Render reliability and a no-cost monitor (DESIGN ONLY; not activated)
- Facts: Hobby static sites are free; 5 GB/month bandwidth shared by the workspace; without a payment method, going over suspends all free services until the next month; no hard cap; commercial-use eligibility not confirmed.
- Independent of Render AND of GitHub Actions (Actions budget exhaustion has already stopped every workflow once, 2026-08-18): a check inside the existing pg_cron health monitor (`pipeline_health_tick`), reading with pg_net. It probes (1) `https://homesignal.net/` and `https://www.homesignal.net/`: status 301 and `Location` begins `https://jodytracks.com/`; (2) `https://homesignal.net/.well-known/did.json`: status 200 and the body hash equals the recorded constant; (3) the TLS handshake succeeding (pg_net failing on a certificate is the signal). Alert: the existing notify-health mail path to `hello@homesignal.net`, which depends only on the homesignal.net MX records.
- A second, weaker probe stays the existing `jody-redirect-verify` mode `probe` (Actions) for the full 19 cases; it would be dispatched, not scheduled, unless the founder approves.
- NOT assumed: Render exposes no bandwidth API that this design uses; the weekly founder check of the Render Metrics page stays manual. **NOT VERIFIED:** whether pg_net follows or reports redirects as needed (it must report the 301 itself); prototype it read-only before building.
- Recurrence is a new scheduled job: founder approval required.

### G. National SEO and data integrity
- Fixture rehearsal (7 generated pages) proves the mechanism, not the nation. The previous full-snapshot parity (run 37971696362, 35,284 HTML pages, 26,701 indexable on each identity, 56,807 matching sitemap URLs) was taken under the OVERLAY model; the activated model is proven equal to it on the fixture (byte-identical but the two fingerprint files), and the fingerprint difference is now proven host-derived (D2).
- NOT run, GO-LIVE-ONLY or Rule-D-blocked: a full-national parity on a fresh plane, with the new host proof, which also exercises project pages (whose as_of is held neutral in the fingerprint; the proof tries the build-day and neutral restorations and reports any page it cannot prove, rather than skipping it).
- Indexing safeguards unchanged: IndexNow stays held for any non-HomeSignal identity; Rule D / Rule F decisions are read from the document itself.

### H. Commercial readiness (four separate gates)
| Gate | Status | Evidence |
|---|---|---|
| Technical website readiness | NOT READY | blocked by the Rule D build failure (external) and the unproven homesignal.net apex/www/HTTPS/DID tests that need DNS |
| Free-evaluation readiness | CODE PRESENT, NOT ACCEPTED | live free limit 10 read from production earlier; trial functions use shared modules that are behind in four deployed functions (section D) |
| Paid-subscription readiness | NOT READY | no Paddle integration exists in code; Lemon Squeezy only; `manage-billing` returns `not_set_up` when unconfigured; Paddle Sandbox approval is not live approval; Lemon Squeezy and the $9.99 alerts product stay inactive |
| Outreach readiness | NOT READY | outreach links not derived (section C); outreach is gated off |

### I. The 31-step checklist: blocker owner of every open item (numbering unchanged; nothing newly crossed out)
Steps 14 to 16 remain struck through in the list above as DRAFT IMPLEMENTATION; this audit did not promote them to launch-ready. Step 15 and 16's offline equivalents pass; their production equivalents are listed here, not crossed out.
| Step | Blocker owner |
|---|---|
| 17 auto-renew | Founder action |
| 18 counsel clearance (G7) | Legal/commercial approval |
| 19 Render Terms / plan | Founder action (the sandbox cannot read render.com) |
| 20 approve or decline the monitor | Founder action |
| 21 TTLs | Founder action (read and lower); engineering supplies the exact records |
| 22 Search Console method | Founder action |
| 23 deploy-set authorization and a tested fallback host | Founder action (authorize, choose a provider); Jody engineering (rehearse rollback, verify standby) |
| 24-30 GO LIVE sequence | Jody engineering executes after G8; **blocked by the Rule D recovery session** for the `pages` build, and by 17-23 |
| 31 post-launch | Founder (consoles); Jody engineering (monitoring) |
| Fresh Rule D plane and a green `main` build | Rule D / Denton recovery session (EXTERNAL) |
| Full-national SEO parity with the host proof | Jody engineering, after the fresh plane |
| Paddle integration, checkout acceptance | Jody engineering to build, founder/Paddle for live approval (separate project) |
| Outreach link derivation | Jody engineering (before OUTREACH READINESS) |

### J. Verdicts (separate from GO LIVE)
- **Site PR #1895: PASS as inert draft machinery, with the Rule D `build` job EXTERNAL BLOCKED.** Not ready to merge until the producer recovers and the normal build is green on a fresh artifact.
- **Ingest PR #663: PASS** (all finished checks green on `ad39802`). Merge only at GO LIVE step A4, never before jodytracks.com serves HTTPS 200; coordinate `digest.py` with the delivery session.
- **GO LIVE: BLOCKED** (Rule D, section 4b exposures not accepted, Render commercial use unconfirmed, edge-function set unauthorized, no tested fallback, G7, G8).


### K. Reply-To routing corrected (founder, 2026-10-13): `info@jodytracks.com`
Mailbox assignments: `info@jodytracks.com` is customer support and the reply destination for property-watch notifications; `contact@jodytracks.com` is real-estate-agent marketing and outreach. The first hardening commit routed replies to `contact@`; corrected here. HomeSignal (v1) is unchanged: no `reply_to` key, sender `HomeSignal <noreply@homesignal.net>`. The sending domain, outreach and payments are untouched, and no e-mail was sent.

### L. Step 16 status
**Step 16 is ENGINEERING-COMPLETE as an inert draft** once this commit's checks pass (listed in the PR). **Production deployment readiness stays BLOCKED** by the external and founder items in sections A, C, D and I. Steps 1 to 16 of the list above keep their struck-through status; steps 17 to 31 are not crossed out, and neither G1/G3 nor the Render preview acceptance changed.

### M. Contract flip is live on `main`; what the tests check now (2026-10-15)
- **State.** `docs/brand/brand-contract.v1.json` is v2 with `current_identity: jody`. The daily sitemap run (`63da1e9`, 2026-10-15) was the first to emit `https://jodytracks.com/` URLs, because `gen_sitemap.py` takes its origin from the contract via `brand_host.py`. Founder confirmed 2026-10-15 that the switch was intended.
- **Why unit went red.** `test/brand-contract.test.mjs` checks 5c/4d still compared the sitemap and shipped files to the frozen v1 (HomeSignal) origin. PR CI passed at merge only because the sitemap was regenerated afterwards.
- **Root cause fixed upstream (#1950, `8b08023`).** The committed `sitemap.xml` is written with the SOURCE identity's origin again; `brand_stage.py` applies the public brand at build time. That is why the checks below read the BUILT sitemap, not the committed file.
- **Test fix.** Section 4/5 now stage the artifact, apply the same overlay `pages.yml` applies for `committed.current_identity`, and check the BUILT artifact against the committed contract's current origin: `CNAME` host (4e, 5a), sitemap URLs (5c), `robots.txt` Sitemap lines (5d), `index.html` canonical (5f), no unclassified overlay leftovers (4d2). The contract itself must still never ship (4b, 4d). The DID stays `did:web:homesignal.net` (5e): it is the immutable Bluesky identity.
- **`CNAME` in the repo stays `homesignal.net` on purpose.** The source tree is HomeSignal-branded and `brand_stage.py` rewrites it at build time; the built `CNAME` is `jodytracks.com` (4e). Editing the source file would make a contract revert leave a Jody `CNAME` behind. The Pages custom-domain setting and DNS are separate, founder-owned steps in the checklist.
- **Bluesky.** The account is now `@jodytracks.com`; the Bluesky icons on the contact and 404 pages link to `https://bsky.app/profile/jodytracks.com` (the shared footer stays at its six approved links). `did:web:homesignal.net` is unchanged.
