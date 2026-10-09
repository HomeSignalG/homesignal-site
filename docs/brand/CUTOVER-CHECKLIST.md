# Jody migration - cutover checklist and the founder's external actions

Status document: `docs/brand/MIGRATION-STATUS.md`. This file is the **single list of everything only the founder can do**, in order,
plus the engineering gates it unlocks. Nothing here has been done on the founder's behalf. Nothing is cleared legally by this file.

## A. Not cleared, and not represented as cleared
- **Trademark / name clearance for "Jody" and "JodyTracks".** No search has been run. Engineering has not checked, and cannot check, a
  trademark register. Get a clearance opinion before GO LIVE. (Founder / counsel)
- **Legal entity.** None is named anywhere in the Jody build and none has been invented. The footer legal text is unchanged from
  HomeSignal's. If the operating entity or its name changes, the Terms and Privacy pages need counsel.
- **Privacy and consent copy** that names the product (HomeSignal -> Jody) was rewritten mechanically by the overlay. Counsel should
  read the Jody `privacy.html` and `terms.html` before launch.

## B. Before any DNS change (all reversible, none touches homesignal.net)
1. **Netlify Free account.** Create it; drag the `homesignal-redirect-site` artifact (workflow `jody-redirect-site`) onto Netlify Drop. Send back the
   `*.netlify.app` address. Then run `python3 scripts/verify_redirect_service.py --base https://<it>.netlify.app --files <folder>`
   (or ask for it): 13 real-HTTP cases. This is the only proof of Netlify's own behaviour. No charge; if Netlify asks for a card, stop.
2. **jodytracks.com**: confirm you own it and where its DNS lives. Run workflow `jody-dns-audit` and read the log: it reports nameservers, MX, SPF, DMARC, DKIM,
   registrar and expiry for both domains.
3. **Where a site for jodytracks.com will be hosted.** GitHub Pages serves ONE custom domain per repo and homesignal.net holds it today.
   The Jody site therefore needs its own host: either a second Pages repo (free) or Netlify Free. Decision: founder. Engineering
   recommendation: Netlify Free for BOTH (Jody site on jodytracks.com, redirect site on homesignal.net) so one workflow publishes both; GitHub Pages stays
   the live host for homesignal.net until GO LIVE.

## C. Email (Step 6 gate; needed before Step 8)
4. **Resend**: add `jodytracks.com` as a sending domain; it shows the DKIM/SPF records. Add them at the DNS host of jodytracks.com.
5. **DMARC** `_dmarc.jodytracks.com`: start at `v=DMARC1; p=none; rua=mailto:<a mailbox you read>`; tighten after two clean weeks.
6. **Mailboxes** `hello@jodytracks.com` and `alerts@jodytracks.com` (receiving): create at the mail host. Infomaniak mail DNS records (MX/SPF) are a founder action.
7. Until all of 4-6 are verified, nothing sends from jodytracks.com. The overlay keeps every `@homesignal.net` address on the
   Jody site by design (`brand_stage.py` leaves mailboxes alone) so a resident never gets a dead mailbox.

## D. Payments
8. **Lemon Squeezy** (the billing processor in this repo): confirm the store allows the new domain; update the store's allowed domains, checkout
   success/redirect URLs and the webhook URL if it names the old host. Do not change the live webhook without a test event.
9. Receipt/branding strings in the store admin (product names, invoice header) are founder edits.

## E. Search consoles (Step 9; needs the new site live)
10. **Google Search Console**: verify `jodytracks.com` (DNS TXT or HTML file - the old domain's `google59e1ae3ef6b75e3a.html` does not carry over). After
    GO LIVE, use **Change of Address** from homesignal.net to jodytracks.com (requires 301s to be live and both properties verified).
11. **Bing Webmaster Tools**: add and verify jodytracks.com; use Site Move.
12. **IndexNow**: the Jody key file is created by the cutover PR; no submission before the new domain is live.

## F. Bluesky
13. The feed generator DID `did:web:homesignal.net` is **immutable** and keeps resolving at `homesignal.net/.well-known/did.json` (the redirect site serves it
    with 200). The handle `@homesignal-tracker.bsky.social` can stay or be re-pointed to a `jodytracks.com` handle by DNS TXT (`_atproto.<handle>`); handle change is a
    founder action in the Bluesky app and is Step 8. Before any switch, set `hold: true` in `data/brand-publish-hold.json` (ingest #655).

## G. Supabase and other service configuration (founder or a reviewed session, at GO LIVE)
14. **Supabase Auth**: Site URL / redirect allow-list - add `https://jodytracks.com` (keep `https://homesignal.net`). The app signs in with 6-digit email codes, so no
    magic-link breakage is expected, but the allow-list is the control.
15. **Edge function CORS**: already supports both origins (Step 2). Five site functions still carry the old list until their next normal deploy; they are only reached
    from a Jody browser after cutover, so deploy them in the cutover window (this is the one deployment that must happen before GO LIVE).

## H. GO LIVE (Step 7) - what changes, in order, and how to undo each
| # | Action | Who | Undo |
|---|---|---|---|
| 1 | `hold: true` in `data/brand-publish-hold.json` (Bluesky) | engineering PR | set `false` |
| 2 | deploy the Jody site to its host; verify on the host's own URL | engineering | n/a (not public) |
| 3 | cutover PR: build-time brand switches `BASE`/host in `page_semantics.py`, `gen_zip_pages.py`, `gen_sitemap.py`, `indexnow.py` to the contract's current identity; new contract version flips `jody` to active | engineering | revert PR |
| 4 | point jodytracks.com DNS at the Jody host | founder | repoint |
| 5 | point homesignal.net DNS at the redirect site (**the irreversible-in-practice step: crawlers and residents see 301s**) | founder | repoint DNS to GitHub Pages (301s are cached by browsers) |
| 6 | run `verify_redirect_service.py --base https://homesignal.net` and the live parity checks | engineering | n/a |
| 7 | `hold: false` | engineering | set `true` |

Keep 180 days of monitoring (Step 9): daily Search Console coverage, redirect probe, sitemap parity, Bluesky and email delivery.
