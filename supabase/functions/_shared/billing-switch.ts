// The checkout kill switch (founder, 2026-10-22). While HomeSignal Development Activity is a free evaluation, nothing is sold and the Terms say so.
// `false` makes manage-billing refuse every checkout (503 checkout_disabled) and report `disabled` in its status, whatever the payment processor's
// settings are. It is a committed constant, not an environment setting, so turning checkout back on is a reviewed code change plus a deploy, never a
// secret edit. It gates ONLY the start of a checkout: the plan status read and the webhook that records events for subscriptions that already exist are untouched.
export const CHECKOUT_ENABLED = false;

// The Paddle SANDBOX checkout switch (2026-11-14). Separate from the live one above, so a sandbox checkout can be opened for testing without ever opening a live one.
// It applies only to a deployment whose PADDLE_CHECKOUT_ENVIRONMENT is `sandbox`; a `live` deployment reads CHECKOUT_ENABLED and nothing else. `false` until the
// first Sandbox payment is to be made, then a reviewed change. Sandbox events are recorded test-mode and never grant, so this cannot open paid access.
export const PADDLE_SANDBOX_CHECKOUT_ENABLED = false;
