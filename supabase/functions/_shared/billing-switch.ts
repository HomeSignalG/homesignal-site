// The checkout kill switch (founder, 2026-10-22). While Paddle checkout is not approved and tested end to end (sandbox tests, Paddle live website approval, a live test purchase), nothing is sold.
// `false` makes manage-billing refuse every checkout (503 checkout_disabled) and report `disabled` in its status, whatever the payment processor's
// settings are. It is a committed constant, not an environment setting, so turning checkout back on is a reviewed code change plus a deploy, never a
// secret edit. It gates ONLY the start of a checkout: the plan status read and the webhook that records events for subscriptions that already exist are untouched.
export const CHECKOUT_ENABLED = false;
