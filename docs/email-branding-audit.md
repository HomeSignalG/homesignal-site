# Daily email ↔ website — branding & graphic consistency audit

**Date:** 2026-07-05 · **Scope:** the once-a-day subscriber email (`homesignal-ingest`
`digest_template.py`, rendered by `digest.py`) vs. the live site (`homesignal-site`).
**Trigger:** two user-reported defects — (1) the share button at the top of the email
does nothing, (2) the email logo does not match the site logo — plus a full sweep for
graphic consistency.

The email is a separate codebase: the template lives in **`homesignal-ingest`**
(`digest_template.py`); its icons are hosted PNGs in the public Supabase Storage
bucket `email-assets/icons` (Gmail strips inline `<svg>`). This audit compares that
email against this repo's canonical branding: `favicon.svg`, the per-page nav logo,
the `:root` color tokens, and `share.js`.

---

## Verdict

The email was already **mostly brand-consistent** — the palette and the 12-item share
row match the site token-for-token. Two real defects (both reported) and one cosmetic
nit were found and fixed:

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Header **share button is a dead tap** in Gmail | **Bug** | ✅ Fixed |
| 2 | **Logo asset is wrong** — invisible/off-brand on the green header | **Bug** | ✅ Fixed |
| 3 | Font stack missing `BlinkMacSystemFont` | Nit | ✅ Fixed |
| 4 | "Signal" wordmark accent differs in hue from the site nav | By design | Documented |

---

## 1. Header share button — dead tap in Gmail  *(reported)*

**Was:** the header share glyph linked to an **in-email fragment jump**,
`<a href="#share">`, intended to scroll to the share grid at the bottom.

**Why it failed:** Gmail (web **and** the mobile apps) strips `id`/`name` anchors and
rewrites in-message fragment links, so `href="#share"` resolves to nothing — the tap
does literally nothing for the majority of subscribers. Email can't run JS, so the
site's `share.js` popover (which is what makes the on-site Share button work) is not an
option inside the message. The template's own comment already admitted "Gmail web
ignores it."

**Fix** (`digest_template.py::_header`): the header button now links to the reader's
**community page** (`links["share_url"]`, e.g. `https://homesignal.net/box-elder.html`
or `…/community.html?zip=…`). That page carries the working `share.js` share sheet, so
the button now does something real in **every** client. The full in-email share grid
(12 one-tap share-intent links) still sits at the bottom of the email unchanged.

## 2. Logo — wrong asset for the green header  *(reported)*

**Site mark (canonical, `favicon.svg` + every page nav):** a **green `#1f5130`
rounded square** containing a **white** house glyph; wordmark `Home` (near-black) +
`Signal` (green).

**Email mockup intent** (`docs/homesignal-daily-email-mockup.html`, the design of
record): because the email header band is solid green, the mark is **inverted** — a
**white rounded square** (28px, radius 7) with a **green `#1f5130`** house glyph — so it
stays legible on green. The house glyph is the exact site path.

**The bug:** the committed/hosted `logo-home.png` was a **green house on a transparent
background with no white square**. On the green header band a green glyph on green is
nearly invisible, and it doesn't match the site mark — exactly the "logo doesn't match"
report. (It also contradicted the template's own `ICON_MANIFEST`.)

**Fix:** regenerated `assets/email-icons/logo-home.png` as the white-square + green-house
chip the mockup specifies (rasterized from the site's own house path, transparent
corners so the green band shows through the rounded corners). `ICON_MANIFEST["logo"]` was
corrected to describe the real design.

> **To go live** this PNG must be pushed to the Storage bucket the email reads from:
> run the **`upload-email-icons`** workflow (`workflow_dispatch`) in `homesignal-ingest`.
> The repo file is only the source; `ASSET_BASE` points at the bucket.

## 3. Font stack — missing `BlinkMacSystemFont`  *(nit)*

Site: `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif`.
Email `FONT` omitted `BlinkMacSystemFont`. Aligned to be byte-identical (only affects
older Blink; zero risk).

---

## What already matched (verified, no change needed)

- **Brand green** `#1f5130` — site `--green` == email `C_GREEN`. ✓
- **Accent blue** `#0c447c` — site `--tx-info` == email `C_BLUE` (links / benchmark
  section headers). ✓ (Not a rogue color — it's a real site token.)
- **Header "Signal" mint** `#9fe1cb` — matches the site token `--green-mid`
  (`community.html`); an on-brand light tint chosen for the dark green band. ✓ *(This is
  finding #4: it reads different from the nav's green "Signal", but it is a real brand
  token and green-on-green is impossible. Kept by design.)*
- **All 12 share-icon brand colors** — `share.js` `.ns-*` == email `SHARE_OPTIONS`,
  color-for-color and in the same order (copy, messages, email, facebook, nextdoor,
  whatsapp, telegram, signal, reddit, x, bluesky, linkedin). ✓
- **Layout tokens** — page bg `#eceef0`, hairline `#eef0f1`, stats ribbon `#16432a`,
  FREE badge green, CTA green — all consistent with the site's system.

---

## Files changed (in `homesignal-ingest`)

- `digest_template.py` — header share href → `share_url`; `FONT` +BlinkMacSystemFont;
  `ICON_MANIFEST["logo"]` + module docstring corrected.
- `assets/email-icons/logo-home.png` — regenerated (white chip + green house).

## To fully ship (both are in `homesignal-ingest`, not this repo)

1. Merge the `homesignal-ingest` branch — the **share-button** fix ships with the next
   daily send once on `main`.
2. Run the **`upload-email-icons`** workflow so the corrected **logo** reaches the live
   Storage bucket (the repo file alone doesn't update the running email).
