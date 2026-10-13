# Jody migration - cutover checklist and the founder's minimum actions

Status and verdict: `docs/brand/MIGRATION-STATUS.md` ("Launch readiness"). This file holds **only what needs the founder's own access**, in the order it is needed, plus the GO LIVE sequence and its gates.
Everything that can be done or checked by engineering is NOT on the founder's list; it is listed under "Engineering does this" so nothing is asked twice.
Nothing here has been done on the founder's behalf, and nothing is cleared legally by this file.

## 1. Founder actions, minimum, in the exact order needed

| # | You do this | Time | Why only you | What happens automatically afterwards |
|---|---|---|---|---|
| 1 | In the **Shopify DNS console for homesignal.net**, add one harmless TXT record (name `_jody-dnstest`, value `ok`) and tell me when it is saved | 1 min | Only your Shopify login can edit the zone. This is the one test that proves the console you edit really is authoritative. | I read it from every authoritative nameserver (`jody-dns-authority`, probe mode) and report FOUND / ABSENT. You then delete the record. |
| 2 | ✅ **DONE 2026-10-12 (proven):** Render service `homesignal-redirect-preview` deployed from branch `0-render-redirect-preview` (commit `c1eebb2`), rule `/*` -> `https://jodytracks.com/*` = Redirect confirmed from a screenshot, no card requested; live probe PASS (see 3a). ~~Netlify Free account + `NETLIFY_AUTH_TOKEN`~~ **SUPERSEDED 2026-10-12: Netlify access is unavailable; replaced by the Render path in section 3a.** Create a **Render** account (Free; **stop if it asks for a card**), then: New > Static Site > connect `HomeSignalG/homesignal-site`, **Branch** `render-redirect-preview` (a generated, redirect-files-only orphan branch), **Root Directory** left EMPTY, **Build Command** `echo no build`, **Publish Directory** `public`, **Auto-Deploy: No**, plan Free. Then Redirects/Rewrites tab: add ONE rule, Type **Redirect**, Source `/*`, Destination `https://jodytracks.com/*`. Send me the `https://<name>.onrender.com` address. | 10 min | Account and repo connection are yours. | I run `jody-redirect-verify` mode `probe` against that address (no secret needed): 19 real-HTTP cases incl. paths, queries, DID bytes, Google token, robots, HTTPS, loop check. Nothing points homesignal.net at it yet. |
| 3 | Turn on **auto-renew** at both registrars: Infomaniak (jodytracks.com, expires 2027-10-08) and the homesignal.net registrar (expires 2027-05-26) | 2 min | Registrar logins. A lapse of homesignal.net would break the redirect and the permanent Bluesky identity `did:web:homesignal.net`. | Nothing; expiry is re-read by `jody-dns-audit`. |
| 4 | At **Infomaniak DNS for jodytracks.com**, add the **4 Resend records in section 2 below** (copy-paste), (the two Infomaniak addresses **info@jodytracks.com** and **contact@jodytracks.com** already exist; **contact@** is for real-estate-agent outreach and free-report invitations; no further mailbox is needed) | 10 min | Infomaniak login. | `resend-domain-records` (action `verify`) and `jody-dns-authority` confirm all four records and Resend's status. Nothing sends until Resend reports the domain verified. |
| 5 | Counsel: a **trademark / name clearance** opinion for "Jody" / "JodyTracks", and a read of the Jody `privacy.html` and `terms.html`; decide the legal-entity text | your schedule | Cannot be done by engineering or represented as done. Blocks GO LIVE only. | I apply any copy changes counsel asks for. |
| 6 | **GO LIVE decision.** Then, in this order and only when I tell you each gate is green: (a) GitHub Settings > Pages for `homesignal-site`: set the custom domain to `jodytracks.com`; (b) Infomaniak DNS: the web records for jodytracks.com (values given at that moment); (c) Shopify DNS: repoint homesignal.net to the redirect service (values given at that moment) | ~30 min active, 30-90 min waiting for certificates | Console and settings access. | Section 4 sequence; I run every verification and the hold/unhold. |
| 7 | After GO LIVE: click **Verify** and then **Change of Address** in Google Search Console (I commit the verification file beforehand), **Site Move** in Bing, and choose the Bluesky handle | 15 min | Owner-only buttons in those consoles. | I run the monitoring below for 180 days. |

**Not on your list, on purpose:** confirming you own jodytracks.com (RDAP shows the registrar, and Paddle Sandbox has approved the domain for you); finding which console controls DNS (step 1 replaces it with a test); copying records out of the Resend dashboard (section 2); editing SPF (it is not edited at all, see section 2); a Lemon Squeezy dashboard check (wrong provider, see section 5); dragging the redirect folder onto Netlify (step 2 replaces it); deciding the hosting split (section 3 decides it).

**Paddle is not a Jody launch gate.** Billing stays off until Paddle live approval and a working Paddle integration pass their own gates (section 5).

## 2. Resend: the exact records for jodytracks.com (generated by Resend itself, 2026-10-09)

Read from the Resend account through the API (`resend-domain-records`); the domain was added to Resend (sending only, **receiving disabled**, region us-east-1). It sent nothing and changed no DNS.
`homesignal.net` is set up the same way in the same account (verified), which is why this is the right shape: **all four records live on `resend._domainkey`, `send` and `rsend`, none on the root.**
Root SPF (`v=spf1 include:spf.infomaniak.ch -all`), root MX (Infomaniak mail) and `_dmarc` (`v=DMARC1; p=reject;`) are **not touched**, so Infomaniak delivery is preserved.
**DMARC reporting (recommended, NOT a prerequisite):** `_dmarc` is `p=reject` with no `rua=`, so a misaligned email would be dropped with no trace. Resend verification does not depend on it and sending as `jodytracks.com` aligns via DKIM (`d=jodytracks.com`). The existing `p=reject` policy is **not changed**. If you want failure reports, add `rua=mailto:info@jodytracks.com` (an address that already exists; no new paid mailbox) after verification. Only change it if a real failure is observed.
DMARC alignment holds without root changes: Resend signs with `d=jodytracks.com` (DKIM, aligned) and its return path is `send.jodytracks.com` (SPF, relaxed-aligned subdomain).
Do **not** enable Resend "Receiving" for this domain: it would add a root MX record and break Infomaniak mail.
Names are relative to `jodytracks.com`; if the Infomaniak form wants a full name, append `.jodytracks.com`.

Record 1 - TXT, name:
```
resend._domainkey
```
Record 1 - value:
```
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCzlL1qLjNNcUc4ik5mqzumzoUBkX9NXughCVs1NvtPntFI7wtpcX/uMVEfbR3PjegO8sVgnwHdGse/JFTV8m1M3D5Xq9rHLNyVEdfua6tF5MEkcIQoidKc/2KfOuK4DYGy6H4A9methTyh/UbT2mpLvP6zmLCamW5OhIJc2GoYwwIDAQAB
```
Record 2 - MX, name:
```
send
```
Record 2 - priority:
```
10
```
Record 2 - value:
```
feedback-smtp.us-east-1.amazonses.com
```
Record 3 - TXT, name:
```
send
```
Record 3 - value:
```
v=spf1 include:amazonses.com ~all
```
Record 4 - CNAME, name:
```
rsend
```
Record 4 - value:
```
send.forge.rmta.net
```

Re-read before adding (the values come from Resend and I will re-print them if anything differs): run `resend-domain-records` (ingest) with `action=list`.

## 3. Hosting decision (corrected 2026-10-09; redirect provider REPLACED 2026-10-12, see 3a)

> **2026-10-12:** wherever this section says Netlify, read **Render Static Site (Free)** per section 3a. The revenue-site decision (GitHub Pages, no second pipeline) is unchanged and is the part that matters.

**The revenue site stays on GitHub Pages, and nothing revenue-bearing runs on Netlify.** Netlify carries only the redirect for homesignal.net and the immutable DID document.

- **jodytracks.com is served by the existing `homesignal-site` Pages pipeline** (the same repo, workflow and gates), after the brand contract flips and the Pages custom domain is changed to jodytracks.com. No new repository, no new cost, and the site is rebuilt by every mechanism that rebuilds it today (pushes, the ingest freshness dispatch, the daily schedule).
- **Why not a second, separately deployed Pages site:** it needs a second builder. The builder is not just `stage_site` + `gen_zip_pages`: it is the semantic baseline fetch, the Rule D plane, the build gates, the crawler proof, the IndexNow job and the page-state sitemap. Copying that into another repo creates a second truth path (this repo's "one canonical path" rule) and the two would drift. The alternative, extracting `pages.yml` into a reusable workflow called from a second repo, is a refactor of the production deploy pipeline and is not justified by the one benefit it buys (being able to pre-provision the jodytracks.com certificate before launch). A Pages project site also serves under `/<repo>/`, which breaks the site's root-relative links until a custom domain is attached, and an Actions-deployed site ignores a `CNAME` file, so the custom domain is a Settings action either way.
- **The price of this choice, stated:** the certificate for jodytracks.com can only be issued after DNS points at Pages, so GO LIVE has a **waiting window of up to about an hour** (step 6 in section 4) during which homesignal.net and jodytracks.com can both be unavailable or show a certificate warning. The Bluesky publish hold covers it. This window is documented, not hidden; the rollback is in section 4.
- **Netlify credit exhaustion is a real, structural risk** (a free plan has a monthly allowance; when it is spent the site can be paused). Netlify's pricing page cannot be reached from the build sandbox, so I do not quote its numbers. What bounds the damage: Netlify serves only tiny 301s and the DID file; a pause would break redirects for old links and make the feed generator's DID unresolvable until the next cycle, but **does not take the revenue site down**. Mitigations: the real-HTTP verifier doubles as a monitor (`jody-redirect-verify` mode `probe` against `https://homesignal.net`); a **daily scheduled run needs your approval at GO LIVE** because it is a new scheduled job; and the emergency fallback is to repoint homesignal.net back to GitHub Pages' addresses (Pages serves the DID file; it cannot 301).

## 3a. Redirect provider: Netlify REPLACED by Render Static Sites (2026-10-12)

**Why:** Netlify account access is unavailable. Nothing else about the plan moves: jodytracks.com stays on the existing GitHub Pages pipeline; homesignal.net stays at its registrar with Shopify-edited DNS; Proton MX, SPF, DKIM and DMARC are untouched; no new paid hosting.
**Preferred provider: Render Static Sites (Free). Verdict (2026-10-13): PASS on the preview address, 19/19 live cases under the founder-approved `--query-order sorted`** (was FAIL on strict key order; was BLOCKED before the live test). Still open: apex/www on homesignal.net, commercial-use terms, a bandwidth monitor. Historical verdict text follows: **BLOCKED, not rejected** - five critical requirements cannot be settled from documentation and need ONE live test that only a Render account can run (founder step 2). GitLab Pages is the documented fallback, evaluated below only because Render has unverifiable items.

Labels: **DOCUMENTATION VERIFIED** = stated in the provider's official documentation (read through search excerpts; `render.com` itself could not be fetched from the build sandbox, so quote-level verification of the pages is still owed) / **OFFLINE PASS** = our tests, no provider / **LIVE HTTP PASS** = real HTTP against the provider (none yet) / **BLOCKED** = cannot be established without the live test or a founder look.

| # | Requirement (Render Free) | Result | Evidence / what is missing |
|---|---|---|---|
| 1 | Permanent 301 | DOCUMENTATION VERIFIED + **LIVE HTTP PASS** | 10 redirect cases returned 301 on the Render preview, including the **root `/`** (the documented root restriction did not apply), `jody-redirect-verify` run 38329014182, 2026-10-13. |
| 2 | Exact path preservation | DOCUMENTATION VERIFIED + **LIVE HTTP PASS** | `/`, `/index.html`, `/community/84302/` and `/community/76227/` (with and without slash), sitemaps, `.png`, an unknown path: identical path at `https://jodytracks.com`. `jody-redirect-verify` run 38405046317 (19 cases, from `main` `ce9e32e`, 2026-10-13). |
| 3 | Arbitrary query-string preservation | **LIVE HTTP PASS under the approved `sorted` rule** (strict byte order: FAIL, accepted by the founder 2026-10-13) | Run 38443897406: `--query-order sorted`, 19/19. Render keeps every byte of every key=value pair (percent-encoding, empty values, duplicate-key order) and stably sorts the keys. Strict mode still fails by design; it stays the default for any other provider. |
| 4 | Existing files answer 200 (did.json, Google token, robots) | DOCUMENTATION VERIFIED (rule) / **LIVE HTTP PASS for did.json (200, bytes equal to the repo file) and robots.txt (200)** on the Render preview, PRE-RULE baseline, `jody-redirect-verify` run 38328698969 (2026-10-13). Google token: **LIVE HTTP PASS** in the 19-case run 38405046317; the redirect rule is now entered | Docs: a rule is not applied where a resource exists at the path, so no `200!` rule is needed. Whether the `.well-known` dot-directory is published is not in the docs - live probe only. |
| 5 | HTTPS on apex and www | **LIVE HTTP PASS for the onrender.com address** (TLS verified by the probe); apex/www on homesignal.net untested (not added, DNS untouched) | Not in the excerpts read. Render documents automatic www/apex companion redirects, so `www` may take two hops (www -> apex -> Jody); acceptable only if both are 301. Live. |
| 6 | Custom domains with Shopify-edited A/CNAME, no transfer | DOCUMENTATION VERIFIED | Apex: ALIAS/ANAME if offered, else A `216.24.57.1` (read the current value in the Render dashboard - do not trust this file); `www`: CNAME to the service's onrender.com name; remove AAAA (Render has no IPv6). Whether Shopify's DNS console accepts an apex A edit is still gate G1. |
| 7 | Commercial-use eligibility | **BLOCKED** (not stated in the pages read; founder to read Render's terms) | Not found in the excerpts. Founder must read Render's terms/pricing page. |
| 8 | Free limits, suspension, surprise charges | DOCUMENTATION VERIFIED (via search excerpts of render.com pricing/docs, 2026-10-13) | Hobby (free): static sites free; **5 GB/month outbound bandwidth**, extra **$0.15/GB** billed only if a payment method is linked; **with no payment method Render spins down the workspace's services until the next month** (a suspension would take the redirects AND the DID offline); **2 custom domains included** (apex + www fits), $0.25/month each beyond; 500 pipeline minutes. **Founder reported 2026-10-13: Render did NOT ask for a card.** So there is no surprise-bill exposure, but the other documented consequence applies: with no payment method, exceeding 5 GB/month spins the workspace down until next month, which would take the redirects and the DID offline. Needs monitoring (daily probe, founder approval for a new scheduled job) and a bandwidth check in the Render dashboard Metrics page. Open: whether the dashboard shows these limits for this workspace. |
| 9 | Scalability, monitoring | OFFLINE PASS (monitoring tool) | `jody-redirect-verify` mode `probe` is the monitor (no secret). A daily schedule is a new scheduled job and needs founder approval. A redirect response is a few hundred bytes; the founder's own bandwidth figure after launch decides if 5 GB is enough (estimate, not measured: on the order of 10 million redirects). |

**GitLab Pages (evaluated because Render has BLOCKED items; not selected):** DOCUMENTATION VERIFIED: `_redirects` supports 301 (default), splats, and existing files take priority; "Force (shadowing)" is unsupported but not needed; **query-parameter matching is unsupported (preservation not stated - same gap as Render)**; custom domains on Free; apex A record plus a `_gitlab-pages-verification-code` TXT record that must stay in place; Let's Encrypt can take up to an hour; remove AAAA and check CAA. Costs vs Render: needs a CI pipeline (a second deployment mechanism), one more DNS record to add to homesignal.net, and a possible account-verification step on Free that was NOT checked. It does not remove any BLOCKED item, so it is a fallback only if Render's live test fails.

**Our side (OFFLINE PASS, `test/redirect-service.test.mjs`, 44 checks, full offline suite 351 files green):** `scripts/build_redirect_site.py --provider render` writes `redirect-service/render/` (committed; a test fails if it drifts): `render.yaml` (one `redirect` route `/*` -> `https://jodytracks.com/*`, free static site, no build) OUTSIDE the publish directory, and `public/` holding only the byte-identical `.well-known/did.json`, the Google token and a permissive `robots.txt`. `scripts/verify_redirect_service.py` gained a Render rules interpreter with Render's documented precedence, 6 new cases (community/76227, map `?zip=76227`, shared-report and unsubscribe queries, encoded/duplicate params, Google token), a loop check and `--require-https`. 10 folder mutations and 6 live-probe failure variants (query stripped, query re-encoded, 302, loop, http, DID redirected) are each refused. Netlify output is unchanged byte for byte.

**LIVE HTTP: PARTIAL, one FAIL (query key order).** Full 19-case run 38405046317 on `main` `ce9e32e`: 17 pass (root, 301s, paths, HTTPS, DID byte-identical 200, Google token 200, robots 200, encoded/empty/duplicate values), 2 fail (key order only). Dashboard rule CONFIRMED from a screenshot (Source `/*`, Destination `https://jodytracks.com/*`, Action Redirect, 'Updated rules successfully.', 2026-10-12 7:47 PM CDT). Run 38329014182: 12 of 13 cases pass; the failing one is query-key re-ordering (row 3).  Preview service deployed 2026-10-12 19:43 CDT from branch `0-render-redirect-preview` commit `c1eebb2` (deploy succeeded). Pre-rule baseline above. Still BLOCKED: redirect rule not yet entered/shown, so root `/`, 301 status, path and query preservation, and the Google token are unproven. The 19-case verifier lives on PR #1880, and the workflow only runs from `main`. Run: `jody-redirect-verify`, mode `probe`, `base_url` = the onrender.com address. Pass criteria are exactly cases 3, 4, 5 and 8 above plus the 19 cases.

### Query-key re-ordering: DECIDED 2026-10-13 (founder: 'yes' to option 1). Options kept below as the record.
**Implemented:** `verify_redirect_service.py --query-order sorted` (default `exact` unchanged) expects the original pairs STABLE-sorted by key with every byte of every pair untouched; `jody-redirect-verify` has a `query_order` input (default exact). Offline: 10 stand-in probes, including a sorted service passing and, refused: stripped query, re-encoded value, dropped parameter, swapped duplicate-key order, changed value, 302, loop, plain http; 2 mutations of the helper caught. **LIVE HTTP under `sorted` is the next run and is NOT yet claimed.**

#### Original options (record)
1. **Accept the deterministic transformation, by changing what the verifier asserts, not by loosening it.** Expected Location = the original query with pairs STABLE-SORTED by key, every value byte identical. This still fails any dropped, re-encoded, merged or re-valued parameter. Smallest change, one new assertion plus a mutation test. Risk: any consumer that depends on parameter order (none found; unsubscribe and shared-report links are single-token or already alphabetical). Needs your approval because it changes a test expectation.
2. **Reject Render if exact byte order is mandatory.** Fallback: GitLab Pages, whose docs also do not state query preservation, so it needs the same live test and a GitLab account; or a redirect host that offers "preserve query string" (Cloudflare does, but needs nameservers moved: a bigger DNS change, previously rejected).
Recommendation: option 1, then add `?zip=` and `utm_*` order to the post-GO-LIVE monitor.

### Competing-CTO audit (what would make this architecture wrong)

| Risk | Finding | Control |
|---|---|---|
| Query strings dropped | Would break every unsubscribe, shared-report and map link in old emails and posts. A hard fail. | Live probe refuses it; if Render fails, fall to GitLab, do not ship. |
| DID fails | `did:web:homesignal.net` is immutable; a 404 on `.well-known/did.json` breaks the Bluesky feed generator. Dot-directory publishing is undocumented for Render. | Live probe compares served bytes to the repo file; homesignal.net is NOT repointed until it passes. |
| SEO loss | A temporary or chained redirect, or `www` taking two hops, weakens Search Console Change of Address. | 301-only assertion; `www` probed separately; Change of Address only after both pass. |
| Surprise cost | Custom-domain fee and bandwidth overage are billed to a card if one is on file; two domains (apex and www) may each count. | If Render demands a card or charges for the domains, this is BLOCKED against "no new paid hosting"; do not add a card to proceed. |
| Provider pause | A free-tier suspension would stop old links and the DID, not the revenue site. | Monitor via the probe; rollback below; GitLab is a pre-evaluated alternate. |
| DNS mistakes | Shopify's Connect / Verify / Set-as-primary actions can rewrite records. A stray AAAA breaks Render. | Edit only the apex A and `www` CNAME in "Edit DNS records"; MX, TXT, DKIM, `send` records untouched. |
| Accidental redeploy | The service builds from the public repo. | Dedicated orphan branch `render-redirect-preview` holding only `public/` + `render.yaml` + README (no site code, no Root Directory ambiguity: Render's docs do not say whether Publish Directory is relative to Root Directory, so the branch root IS the service root); Auto-Deploy: No; the folder never changes except by a reviewed, test-gated commit. A push under `redirect-service/` also re-runs the Pages build (harmless, identical artifact). |
| Rollback gap | After the Pages custom domain moves to jodytracks.com, restoring homesignal.net's old A/CNAME points it at a Pages site that no longer answers for that host. | Rollback of the OLD host is "repoint to Render" or revert the Pages custom domain first; recorded old values stay in section 4. Test the rollback order before GO LIVE. |
| Architecture that stays rejected | A meta-refresh or JS redirect on GitHub Pages (not a 301), a registrar forward (cannot serve the DID file), moving nameservers (a bigger DNS change). | Unchanged from MIGRATION-STATUS Step 5. |

## 4. GO LIVE sequence (executed only after your explicit approval; each gate is checked by engineering)

**Gates, all must be green before step 1 (engineering reports each with its run link):**

| Gate | Check | Status |
|---|---|---|
| G1 | `jody-dns-authority` probe record found on every authoritative nameserver of homesignal.net | needs founder step 1 |
| G2 | `jody-redirect-verify` real-HTTP cases pass on the redirect provider (**Render**, was Netlify), **including `/.well-known/did.json` answering 200 with the original bytes** | **PASS on the Render preview** (run 38443897406, 19/19, `--query-order sorted`, 2026-10-13). **Must be re-run against `https://homesignal.net` at GO LIVE step 8** (custom domains, certificate, www). Not yet claimed for homesignal.net. |
| G3 | Resend reports jodytracks.com `verified` (all four records) | needs founder step 4 |
| G4 | `jody-seo-parity` on a fresh snapshot: `ok: true` | passed once on 2026-10-09; re-run on the day |
| G5 | The contract-flip PR builds clean as a draft (not merged) | prepared at GO LIVE time |
| G6 | `data/brand-publish-hold.json` set to `hold: true` | at step 1 |
| G7 | Counsel clearance (section 1, step 5) | founder |
| G8 | Your explicit GO LIVE message | founder |

**Sequence and undo:**

| # | Action | Who | Undo |
|---|---|---|---|
| 1 | `hold: true` (Bluesky) | engineering PR | set `false` |
| 2 | Add `homesignal.net` and `www.homesignal.net` as custom domains on the persistent **Render** redirect service; read the exact DNS values Render shows for them at that moment (documented shape: apex A, `www` CNAME to the service's onrender.com name; no AAAA) | founder (dashboard) + engineering (reads values back) | remove the custom domains |
| 3 | Deploy the five site edge functions that still carry the old origin list | engineering | redeploy previous |
| 4 | jodytracks.com web records at Infomaniak | founder | delete the records |
| 5 | Pages custom domain -> `jodytracks.com`; merge the contract-flip PR | founder + engineering | set the domain back, revert the PR |
| 6 | Wait for the jodytracks.com certificate; engineering polls TLS + content from a runner | engineering | n/a |
| 7 | **Only once step 6 is green:** repoint homesignal.net at Render in the Shopify console. Use only "Edit DNS records"; do not use any Shopify "Connect", "Verify", "Set as primary" or "Remove" domain action, which can rewrite the records to Shopify storefront addresses | founder | restore the previous A/CNAME values (recorded before the change) |
| 8 | Wait for the homesignal.net certificate on Render; run `jody-redirect-verify` mode `probe` on `https://homesignal.net` (13 cases + DID 200) and the live parity checks | engineering | n/a |
| 9 | `hold: false` | engineering | set `true` |

The recorded pre-change values of homesignal.net DNS (2026-10-09): A `185.199.108.153`, `www` CNAME `homesignalg.github.io`, MX Proton, TXT SPF Proton + `protonmail-verification`, DKIM `resend._domainkey`, `send` MX/TXT for Resend. Steps 7 changes only the web records (A/CNAME); **MX, TXT, DKIM and `send` records stay exactly as they are.**

## 5. Payments: Paddle, not Lemon Squeezy (corrected)

The intended provider is **Paddle**. Both domains are approved for checkout and Apple Pay in **Paddle Sandbox**. The Lemon Squeezy code in this repo is the earlier implementation; it is **not activated and must not be**, and no other processor is substituted.
The audit of that code against what Paddle Billing requires is `docs/brand/PADDLE-AUDIT.md`. Summary: every provider shape is in one module (`_shared/lemon-billing.ts`), the database ledger is provider-neutral and needs one reviewed additive branch, and ten provider differences are listed to verify against real Sandbox events.
Gates, separate from Jody: (1) Paddle Sandbox build against captured payloads; (2) Paddle **live** website approval; (3) live billing switched on after a live test purchase. The Jody cutover changes none of these. The one coupling is the checkout return page constant (`BILLING_PAGE`), which moves to the Jody host together with the first Paddle checkout, not before.

## 6. Search consoles, Bluesky, Supabase (after GO LIVE unless stated)

- **Google Search Console / Bing**: verification files are committed by engineering before GO LIVE (the old `google59e1ae3ef6b75e3a.html` is for homesignal.net only and does not carry over); the founder clicks Verify, then Change of Address / Site Move. No IndexNow submission before jodytracks.com is live; the first Jody build seeds its baseline and submits nothing.
- **Bluesky**: `did:web:homesignal.net` is immutable and keeps resolving at `homesignal.net/.well-known/did.json` (the redirect service answers it with 200, verified in G2). The handle may stay `@homesignal-tracker.bsky.social` or be re-pointed to a jodytracks.com handle; that is a choice in the Bluesky app after GO LIVE. The publish hold is `data/brand-publish-hold.json`.
- **Supabase Auth**: add `https://jodytracks.com` to the Site URL / redirect allow-list and keep `https://homesignal.net`. Sign-in uses 6-digit email codes, so no magic-link breakage is expected; engineering does this at GO LIVE if the connector allows, otherwise it is one console edit.

## 7. Engineering does this (never asked of the founder)

Done: brand contract and pin; dual-origin backends and the database guard; Jody staging build and SEO parity (35,284 pages, identical indexable sets); redirect-service folder and offline simulator; Bluesky publish hold; DNS and registration audits; the origin-from-contract plumbing (live, byte-identical output); the Resend domain created with its records read back; the Paddle audit.
Ready and waiting on a founder input above: authoritative-DNS probe (step 1), real-HTTP redirect-provider verification (step 2, now Render), Resend verification (step 4).
At GO LIVE: the contract-flip PR, verification files, the five edge-function deploys, the Render custom domains, certificate polling, the redirect probe, parity checks, the hold, and 180 days of monitoring (Search Console coverage, redirect probe, sitemap parity, Bluesky and email delivery).

## 8. Not cleared, and not represented as cleared

- **Trademark / name clearance for "Jody" and "JodyTracks"**: no search has been run; engineering cannot check a trademark register.
- **Legal entity**: none is named in the Jody build and none has been invented; the footer legal text is unchanged from HomeSignal's.
- **Privacy and consent copy** that names the product was rewritten mechanically by the overlay and needs counsel's read.
