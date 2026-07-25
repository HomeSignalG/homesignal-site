# YouTube transcript fetch (Video Producer)

Fetches WebVTT captions for a YouTube URL via a gated Supabase Edge Function.

## Components

| Piece | Location |
|-------|----------|
| Edge function | `homesignal-ingest/supabase/functions/fetch-youtube-transcript/index.ts` |
| Client button | `homesignal-site/assets/acquisition-video-producer.js` |
| Snapshot button | `homesignal-ingest/dashboard/video_producer_tab.py` (next ingest publish) |

## Auth

- Caller must be logged in with a Supabase session.
- Email must exist in `public.dashboard_admins` (same gate as acquisition dashboard RPCs).
- Unauthenticated → 401; not allowlisted → 403.

## Deploy edge function

From `homesignal-ingest` with Supabase CLI authenticated:

```bash
supabase functions deploy fetch-youtube-transcript --project-ref qwnnmljucajnexpxdgxr
```

`verify_jwt = true` (see `supabase/config.toml`). The browser sends the operator JWT via `hsClient.functions.invoke`.

## Site deploy

Merge and deploy `homesignal-site` so `assets/acquisition-video-producer.js` is live on GitHub Pages.

The fetch button is injected by JS if the snapshot HTML does not yet include `#vp-fetch-transcript`.

## Usage (operators)

1. Paste a YouTube URL in **Step 1 — Source**.
2. Click **Fetch transcript from YouTube**.
3. Transcript appears in the paste box (WebVTT with timestamps).
4. Continue with **Analyze transcript** and the normal workflow.

## Limitations

- Only videos with captions/CC available on YouTube.
- Does not download the video file — upload source video separately.
- YouTube may change internals; monitor for fetch failures.
