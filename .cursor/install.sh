#!/usr/bin/env bash
# HomeSignal site — Cloud Agent install script.
#
# ─────────────────────────────────────────────────────────────────────────────
# NODE VERSION — why it is selected here and not in environment.json
# ─────────────────────────────────────────────────────────────────────────────
# The homesignal-site unit suite (scripts/run-unit-tests.mjs) imports .ts files and
# depends on Node's native TypeScript type-stripping, which Node performs UNFLAGGED only
# from v22.18+ (the repo's own .github/workflows/unit-tests.yml pins Node 22 for exactly
# this reason). environment.json has NO field to select a Node version — verified against
# https://cursor.com/schemas/environment.schema.json, whose only base-image controls are
# build/image/snapshot. So the Node version is a property of the base image, and the
# Cursor default base image puts an OLDER `node` (v22.14, shipped at /exec-daemon) first
# on PATH, which shadows the newer nvm-managed Node.
#
# We therefore select Node at install time, using the least-invasive mechanism available:
#   (a) nvm — already present in the base image — ensures a Node 22 (>=22.18) is installed;
#   (b) its bin dir is prepended to PATH in the USER's own ~/.bashrc (no sudo, no /etc).
#       ~/.profile already sources ~/.bashrc, so login and interactive shells both get it.
#
# This is DELIBERATELY NOT a sudo-written /etc/profile.d shim. That root-level approach was
# used once during exploration and is a workaround; it is avoided here. If a future base
# image injects its old node so early that even the ~/.bashrc prepend is shadowed, the
# documented fallback is a custom Dockerfile that installs Node 22 as the system node — a
# base-image change to be made separately, still not a sudo shim.
#
# ─────────────────────────────────────────────────────────────────────────────
# CONTRACT
# ─────────────────────────────────────────────────────────────────────────────
# IDEMPOTENT: safe to run repeatedly. `nvm install 22` is a no-op once a 22.x is present;
# the ~/.bashrc line is added only when absent; pip/npm/playwright installs no-op when
# already satisfied.
#
# FAILURE POLICY: the only REQUIRED piece is Node for the site. Optional pieces — the
# homesignal-ingest Python test deps and Playwright/Chromium for the browser suite — are
# best-effort; their failures are logged and swallowed so a site-only build still succeeds.
set -uo pipefail

log()  { printf '[install] %s\n' "$*"; }
warn() { printf '[install][optional] %s\n' "$*" >&2; }

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="$(dirname "$SITE_DIR")"

# ─────────────────────────────────────────────────────────────────────────────
# REQUIRED — Node >= 22.18 for the homesignal-site unit suite
# ─────────────────────────────────────────────────────────────────────────────
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  log "FATAL: nvm not found at $NVM_DIR — cannot select Node >=22.18 for the site suite."
  exit 1
fi
# shellcheck disable=SC1090
. "$NVM_DIR/nvm.sh"

# Idempotent: installs the latest 22.x only if no 22.x is present yet.
nvm install 22 >/dev/null 2>&1 || true

# Resolve the highest installed v22 bin dir — never hardcode a patch version.
NODE22_BIN="$(ls -d "$NVM_DIR"/versions/node/v22.* 2>/dev/null | sort -V | tail -1)/bin"
if [ ! -x "$NODE22_BIN/node" ]; then
  log "FATAL: no nvm-managed Node 22 found after 'nvm install 22'."
  exit 1
fi
export PATH="$NODE22_BIN:$PATH"

NODE_VER="$(node --version)"
case "$NODE_VER" in
  v22.1[89]*|v22.[2-9][0-9]*|v2[3-9]*|v[3-9][0-9]*)
    log "Node $NODE_VER selected (>=22.18 — native TypeScript type-stripping)." ;;
  *)
    log "FATAL: selected Node $NODE_VER is < 22.18; the site unit suite needs >=22.18."
    exit 1 ;;
esac

# Durably prefer this Node in the user's shells (no sudo, no /etc). Idempotent via marker.
NODE_MARKER="# homesignal: prefer nvm Node >=22.18 (site unit suite needs native TS type-stripping)"
if ! grep -qF "$NODE_MARKER" "$HOME/.bashrc" 2>/dev/null; then
  {
    printf '\n%s\n' "$NODE_MARKER"
    printf 'export PATH="%s:$PATH"\n' "$NODE22_BIN"
  } >> "$HOME/.bashrc"
  log "Added Node PATH preference to ~/.bashrc (~/.profile already sources it)."
else
  log "~/.bashrc already prefers the nvm Node — no change."
fi
nvm alias default 22 >/dev/null 2>&1 || true

# ─────────────────────────────────────────────────────────────────────────────
# OPTIONAL (best-effort) — homesignal-ingest Python test dependencies
# ─────────────────────────────────────────────────────────────────────────────
# Present only when the ingest repo is checked out alongside the site (multi-repo
# workspace). A site-only build will not have it, and that is fine.
INGEST_REQ="$WORKSPACE_DIR/homesignal-ingest/requirements-test.txt"
if [ -f "$INGEST_REQ" ]; then
  if python3 -m pip install --user --quiet -r "$INGEST_REQ"; then
    log "Installed homesignal-ingest test deps (pytest, openpyxl)."
  else
    warn "Could not install homesignal-ingest test deps; 'pytest tests/' may be unavailable."
  fi
else
  log "homesignal-ingest not in this checkout — skipping its test deps (expected for a site-only build)."
fi

# ─────────────────────────────────────────────────────────────────────────────
# OPTIONAL (best-effort) — Playwright + Chromium for the FULL/browser unit suite
# ─────────────────────────────────────────────────────────────────────────────
# The REQUIRED gate is the offline suite (node scripts/run-unit-tests.mjs --offline),
# which needs no browser. The full suite additionally drives Chromium via Playwright.
# CI installs Playwright in the PARENT of the repo so Node resolves it by walking up,
# keeping the site repo free of node_modules/package.json — mirrored here.
# Set SKIP_PLAYWRIGHT=1 to skip (e.g. to keep install fast); the offline gate is unaffected.
if [ "${SKIP_PLAYWRIGHT:-0}" = "1" ]; then
  log "SKIP_PLAYWRIGHT=1 — skipping Playwright; the offline gate is unaffected."
else
  if (
      cd "$WORKSPACE_DIR" || exit 1
      [ -f package.json ] || npm init -y >/dev/null 2>&1 || exit 1
      npm install --no-audit --no-fund playwright@1.56.0 >/dev/null 2>&1 || exit 1
      npx --yes playwright install chromium >/dev/null 2>&1 || exit 1
    ); then
    log "Installed Playwright + Chromium for the browser unit suite."
  else
    warn "Playwright/Chromium not installed; the offline gate still runs. Full/browser suite unavailable."
  fi
fi

log "Install complete. Node $(node --version)."
log "Required gate:  node scripts/run-unit-tests.mjs --offline --min-files=75"
log "Full suite:     node scripts/run-unit-tests.mjs --min-files=80   (needs Playwright above)"
