# Alerts SEO implementation — HALTED at the Step 8 architecture gate

**2026-09-04.** No implementation was performed. No file that runs in production was
edited. Production DB, content, feeds, workbooks, the live site and address/map behaviour
are all unchanged.

## The gate that failed

Step 5 and Step 9 of the implementation unit require that the **initial HTTP response** for
`community.html?zip=<zip>` carry ZIP-specific content, a ZIP-specific canonical/title/H1, and
the authoritative robots state — with Step 9 explicitly forbidding "ship initial `noindex`
and rely on JavaScript to remove it."

**The current deployment architecture cannot do this at all.**

## Exact technical reason

`homesignal.net` is served by **stock GitHub Pages**, measured rather than assumed:

| evidence | value |
|---|---|
| `server` | `GitHub.com` |
| `via` | `1.1 varnish` (GitHub's own Fastly cache) |
| `x-served-by` / `x-fastly-request-id` | present |
| `cf-ray` | **null** — no Cloudflare, no Worker, no proxy under this account's control |
| repo SSR config | **none** — no `wrangler.*`, `netlify.toml`, `vercel.json`, `_worker.js`, `_redirects`, `_headers` |
| deploy path | `CNAME` → `homesignal.net`; no Pages deploy workflow; merging to `main` publishes |

GitHub Pages is a **static file server**. It selects content by *path only* and **ignores the
query string entirely**. There is no server-side execution, no rewrite engine, and no
function hook. `?zip=` therefore cannot influence the bytes returned.

This is already proven end to end in `d4392d7`: **18 requests — six different ZIPs × (normal,
Googlebot smartphone, Googlebot desktop) — returned one byte-identical body**, md5
`e6e9053321f3ed2c371cb37217ec72f1`, carrying `noindex, nofollow`, an empty
`<template id="hs-content">` and 22 characters of visible text.

The site's three Supabase Edge Functions (`get-address-report`, `geocode-address`,
`edge-probe`) do not close this gap: they are JSON APIs on `*.supabase.co` called **from the
browser**, not a renderer for HTML on `homesignal.net`.

## Why every workaround is founder-level

| route | blocked by |
|---|---|
| Generate per-ZIP static paths (`/community/01001/…`) | **CLAUDE.md §0**, verbatim: *"**No per-community HTML files.** The one dynamic page `community.html` serves any community by `?id=`, `?community=<slug>`, or `?zip=`."* Repeated at `404.html:9` — *"No per-ZIP files … the canonical URL is `homesignalmap.html?zip=`."* Also on this unit's own DO-NOT list. |
| Serve the page from a Supabase Edge Function | needs a proxy in front of `homesignal.net` to keep the domain — i.e. the hosting change below |
| Migrate hosting (Cloudflare/Netlify/Vercel + SSR) | founder-level architecture change |

## Smallest proposed architecture change — ONE option, not a survey

> **Put a Cloudflare Worker in front of the existing GitHub Pages origin, on the
> `/community*` route only.**

- DNS for `homesignal.net` moves to Cloudflare (free tier); **origin stays GitHub Pages**,
  so the repo, the deploy path and every other page are untouched.
- One Worker on `/community*`: fetch the existing static shell from the Pages origin, read
  `?zip=`, read that ZIP's already-materialised Alerts rows, inject them into
  `<template id="hs-content">`, and set robots / canonical / `<title>` / description / H1.
  Stream the result.
- **§0 is preserved literally and in spirit.** No per-ZIP file is ever created; there is
  still exactly one dynamic page serving any community by `?zip=`. A Worker arguably makes
  `community.html` *more* faithful to §0's "one dynamic page" intent than the status quo,
  which only achieves it client-side.
- Adding a community stays pure data — the Worker reads the same read model, so a new ZIP is
  crawlable with zero engineering, which is §0's actual objective.
- Free tier covers 100k requests/day. The change is one DNS cutover plus one Worker script.

**This still requires founder authorization**: it introduces a vendor and moves DNS.

## Independently shippable without any architecture decision

Recorded so the founder can authorize it separately — **not implemented here**, because Step
8 halts the unit and Step 9 forbids shipping a JavaScript-only robots decision:

**The data contract + sitemap correction.** `app_community_meta.indexable_alerts`
(Rule F, computed in `app_refresh_zip` from `app_changes` and forward-meeting counts only),
plus pointing the `community.html?zip=` half of `scripts/gen_sitemap.py` at it. That needs no
SSR, because **`sitemap.xml` is a static file and can already be ZIP-specific.** It would stop
advertising the **5,153** pages that carry development substance but fewer than 3 Alerts items,
and start advertising the **526** that have Alerts substance and are not advertised today.

It does not, on its own, make any page crawlable — the initial HTML would still be empty and
still say `noindex`. It is a real but partial gain, and it is the founder's call whether to
take it before or with the Worker.

## Verdict

**C — FOUNDER ARCHITECTURE AUTHORIZATION REQUIRED.**
