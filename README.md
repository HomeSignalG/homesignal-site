# Render redirect preview (homesignal.net -> jodytracks.com)

GENERATED from `homesignal-site` by `scripts/build_redirect_site.py --provider render`. Do not edit by hand: the source branch's test
(`test/redirect-service.test.mjs`) fails if this content differs from a fresh build.

Render fields (dashboard, Static Site, Free):

| Field | Value |
|---|---|
| Branch | `render-redirect-preview` |
| Root Directory | (leave EMPTY) |
| Build Command | `echo no build` |
| Publish Directory | `public` |
| Auto-Deploy | No |

Redirects/Rewrites tab: ONE rule, Type Redirect, Source `/*`, Destination `https://jodytracks.com/*`.
`render.yaml` is the machine-readable record of that rule; a dashboard-created site does not read it.
