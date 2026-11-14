// Paddle's PUBLIC browser settings for this deployment: the environment and the client-side token. Both are public by design (Paddle.js needs them in the browser) and neither is a secret.
// This committed file is the SAFE DEFAULT: empty, so Paddle.js is not loaded and checkout stays as the billing function reports it. The Pages build (.github/workflows/pages.yml, step
// "Write Paddle public config") replaces it in the deployed artifact from the repository variables PADDLE_ENVIRONMENT (live | sandbox) and PADDLE_CLIENT_TOKEN, and fails the build if the
// token's prefix does not match the environment (live_ for live, test_ for sandbox). Nothing here ever grants access: payment fulfilment is the signed webhook alone.
window.HS_PADDLE = { environment: '', token: '' };
