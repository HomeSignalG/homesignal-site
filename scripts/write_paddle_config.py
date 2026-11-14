#!/usr/bin/env python3
"""Write Paddle's PUBLIC browser settings into the deployed artifact (paddle-config.js).

The environment and the client-side token are public by design, but they are DEPLOYMENT settings, not source: this reads them from the environment
(the Pages workflow passes the repository variables PADDLE_ENVIRONMENT and PADDLE_CLIENT_TOKEN) and never hard-codes them.

  both unset  -> leave the committed safe default (empty): Paddle.js is not loaded, checkout stays as the billing function reports it.
  both set    -> environment must be `live` or `sandbox`, the token must carry that environment's prefix (live_ / test_), and the file is rewritten.
  anything else (one set, a bad environment, a mismatched prefix, characters outside a token's alphabet) -> exit 1: the build FAILS LOUDLY rather than
  deploying a checkout that would silently point at the wrong Paddle account.
Usage: write_paddle_config.py --dir _site
"""
import argparse, json, os, re, sys

PREFIX = {'live': 'live_', 'sandbox': 'test_'}
TOKEN = re.compile(r'^(live|test)_[A-Za-z0-9]{20,80}$')


def render(environment: str, token: str) -> str:
    return ("// Written by scripts/write_paddle_config.py at build time from the PADDLE_ENVIRONMENT and PADDLE_CLIENT_TOKEN repository variables. Public by design.\n"
            "window.HS_PADDLE = " + json.dumps({'environment': environment, 'token': token}) + ";\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True)
    a = ap.parse_args(argv)
    env = os.environ.get('PADDLE_ENVIRONMENT', '').strip()
    tok = os.environ.get('PADDLE_CLIENT_TOKEN', '').strip()
    target = os.path.join(a.dir, 'paddle-config.js')
    if not os.path.exists(target):
        print('paddle-config.js is not in the artifact', file=sys.stderr); return 1
    if not env and not tok:
        print('paddle config: not set (the committed empty default stays; Paddle.js will not load)'); return 0
    if env not in PREFIX:
        print('paddle config: PADDLE_ENVIRONMENT must be "live" or "sandbox"', file=sys.stderr); return 1
    if not tok:
        print('paddle config: PADDLE_CLIENT_TOKEN is not set', file=sys.stderr); return 1
    if not TOKEN.match(tok) or not tok.startswith(PREFIX[env]):
        print('paddle config: the client token does not match environment "%s" (it must start with %s and be a client-side token)' % (env, PREFIX[env]), file=sys.stderr); return 1
    with open(target, 'w', encoding='utf-8') as f:
        f.write(render(env, tok))
    print('paddle config: written for environment %s (token prefix %s)' % (env, PREFIX[env]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
