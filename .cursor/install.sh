#!/usr/bin/env bash
# HomeSignal site — Cloud Agent install script.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS MUST ACHIEVE (the acceptance gate)
# ─────────────────────────────────────────────────────────────────────────────
# A fresh agent, with ZERO manual steps, must be able to run:
#     node scripts/run-unit-tests.mjs --offline --min-files=75     -> 133/133
# That suite imports .ts files and relies on Node's native TypeScript
# type-stripping, which Node performs UNFLAGGED only from v22.18+.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS IS NOT A PATH EXPORT OR A ~/.bashrc LINE (measured, not assumed)
# ─────────────────────────────────────────────────────────────────────────────
# The gate command runs in a NON-INTERACTIVE shell. Bash does not read ~/.bashrc
# in non-interactive shells — Ubuntu's own stock ~/.bashrc says so on line 5:
#     # If not running interactively, don't do anything
#     [ -z "$PS1" ] && return
# Measured on a fresh container (2026-09-02), marker exported from ~/.bashrc:
#     bash -c  (non-interactive) -> <unset>     <- THE GATE SHELL
#     bash -lc (login)           -> <unset>
#     bash -ic (interactive)     -> yes
# So a ~/.bashrc PATH prepend cannot reach the gate, and `export PATH=...` inside
# this script dies with this script's process.
#
# THE RULE THAT FOLLOWS: environment state (PATH, rc files, shell exports) does not
# survive into a later independent shell. FILESYSTEM state does. So the Node
# selection is made durable as a SYMLINK IN A DIRECTORY THAT ALREADY PRECEDES the
# stale `node` on the default PATH — no rc file, no exported variable, no sudo
# unless the image leaves no writable directory ahead of the stale interpreter.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THE REQUIREMENT IS CHECKED BEFORE nvm IS LOOKED FOR
# ─────────────────────────────────────────────────────────────────────────────
# The previous revision hard-aborted (exit 1) when nvm was absent, EVEN ON A MACHINE
# THAT ALREADY HAD Node 22.22.2 on PATH — it never looked. That coupled the required
# gate to the presence of a version manager instead of to the actual requirement.
# Verified twice on 2026-09-02, by this session and by an independent fresh-agent run:
#     [install] FATAL: nvm not found at /root/.nvm ... ; exit 1   (node was v22.22.2)
# The requirement is "Node >= 22.18 resolvable by a non-interactive shell". nvm is one
# possible means to that end, never the test for it.
#
# ─────────────────────────────────────────────────────────────────────────────
# CONTRACT
# ─────────────────────────────────────────────────────────────────────────────
# IDEMPOTENT: safe to run repeatedly; every step is a no-op once satisfied.
# SELF-VERIFYING: the script ends by re-running the requirement in a shell shaped like
#   the gate's (clean env, DEFAULT PATH, non-interactive). It exits non-zero if that
#   shell does not resolve Node >= 22.18 — it never reports success it has not observed.
# FAILURE POLICY: Node is REQUIRED. The homesignal-ingest Python test deps and
#   Playwright/Chromium are OPTIONAL and best-effort; their failures are logged and
#   swallowed so a site-only build still succeeds.
set -uo pipefail

log()  { printf '[install] %s\n' "$*"; }
warn() { printf '[install][optional] %s\n' "$*" >&2; }

# The PATH as the agent gave it to us, BEFORE this script modifies anything. Every
# decision below — which node is stale, where a shim must go, and the final self-test —
# is made against THIS, because it is what the gate shell will get.
ORIG_PATH="$PATH"

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="$(dirname "$SITE_DIR")"

# ─────────────────────────────────────────────────────────────────────────────
# REQUIRED — Node >= 22.18, resolvable by a NON-INTERACTIVE shell
# ─────────────────────────────────────────────────────────────────────────────

# True when $1 (e.g. "v22.18.0") is >= 22.18. Pure shell, no external tools.
ver_ok() {
  local v="${1#v}" maj min rest
  maj="${v%%.*}"; rest="${v#*.}"; min="${rest%%.*}"
  case "$maj" in ''|*[!0-9]*) return 1 ;; esac
  case "$min" in ''|*[!0-9]*) return 1 ;; esac
  [ "$maj" -gt 22 ] && return 0
  [ "$maj" -lt 22 ] && return 1
  [ "$min" -ge 18 ]
}

# What a gate-shaped shell resolves: clean environment, DEFAULT PATH, non-interactive.
# `env -i` is what makes this a real test rather than a reflection of our own process.
gate_node() {
  env -i HOME="$HOME" PATH="$ORIG_PATH" bash -c 'command -v node >/dev/null 2>&1 && node --version' 2>/dev/null
}

# Absolute path of an adequate node, or empty. Searched in preference order.
find_good_node() {
  local c
  # 1) Whatever the default PATH already resolves — the cheapest possible answer.
  c="$(env -i PATH="$ORIG_PATH" bash -c 'command -v node' 2>/dev/null)"
  if [ -n "$c" ] && ver_ok "$("$c" --version 2>/dev/null)"; then echo "$c"; return 0; fi
  # 2) nvm-managed versions, highest first.
  for c in $(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v* 2>/dev/null | sort -Vr); do
    if [ -x "$c/bin/node" ] && ver_ok "$("$c/bin/node" --version 2>/dev/null)"; then
      echo "$c/bin/node"; return 0
    fi
  done
  # 3) Common system locations a base image may ship outside PATH order.
  for c in /opt/node*/bin/node /usr/local/bin/node /usr/bin/node; do
    if [ -x "$c" ] && ver_ok "$("$c" --version 2>/dev/null)"; then echo "$c"; return 0; fi
  done
  return 1
}

GOOD_NODE="$(find_good_node || true)"

# Nothing adequate on the machine yet — try to provision one. nvm first (present in the
# Cursor base image), then an official tarball into ~/.local (no sudo, no root).
if [ -z "$GOOD_NODE" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    log "No Node >=22.18 found; provisioning via nvm."
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh" && nvm install 22 >/dev/null 2>&1 || true
    GOOD_NODE="$(find_good_node || true)"
  fi
fi
if [ -z "$GOOD_NODE" ]; then
  log "No Node >=22.18 found and no nvm; downloading an official Node 22 build to ~/.local."
  NODE_TARBALL_VER="v22.22.2"
  ARCH="$(uname -m)"; case "$ARCH" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; esac
  TARGET="$HOME/.local/opt/node-${NODE_TARBALL_VER}-linux-${ARCH}"
  if [ ! -x "$TARGET/bin/node" ]; then
    mkdir -p "$HOME/.local/opt"
    URL="https://nodejs.org/dist/${NODE_TARBALL_VER}/node-${NODE_TARBALL_VER}-linux-${ARCH}.tar.xz"
    curl -fsSL --retry 3 "$URL" 2>/dev/null | tar -xJ -C "$HOME/.local/opt" 2>/dev/null || true
  fi
  [ -x "$TARGET/bin/node" ] && ver_ok "$("$TARGET/bin/node" --version 2>/dev/null)" && GOOD_NODE="$TARGET/bin/node"
fi

if [ -z "$GOOD_NODE" ]; then
  log "FATAL: could not find or provision Node >=22.18."
  log "       Tried: default PATH, nvm (\$NVM_DIR=${NVM_DIR:-$HOME/.nvm}), /opt /usr/local /usr, nodejs.org tarball."
  log "       The site unit suite needs >=22.18 for native TypeScript type-stripping."
  exit 1
fi
GOOD_VER="$("$GOOD_NODE" --version)"
GOOD_BIN="$(dirname "$GOOD_NODE")"
log "Node $GOOD_VER available at $GOOD_NODE."

# Is that already what a gate-shaped shell gets? If so there is nothing to shim.
GATE_VER="$(gate_node)"
if [ -n "$GATE_VER" ] && ver_ok "$GATE_VER"; then
  log "A non-interactive shell already resolves Node $GATE_VER — no shim needed."
else
  # Something older (or nothing) wins on the default PATH. Find the first writable
  # directory that comes BEFORE it, and put our symlinks there. Order matters: a
  # directory after the stale node would be shadowed exactly as nvm's bin is today.
  STALE="$(env -i PATH="$ORIG_PATH" bash -c 'command -v node' 2>/dev/null)"
  STALE_DIR="$([ -n "$STALE" ] && dirname "$STALE")"
  log "A non-interactive shell resolves ${GATE_VER:-no node}${STALE:+ ($STALE)} — installing a shim ahead of it."

  SHIM_DIR=""
  IFS=':' read -r -a _pathdirs <<< "$ORIG_PATH"
  for d in "${_pathdirs[@]}"; do
    [ -z "$d" ] && continue
    # Reached the stale interpreter without finding anywhere writable: stop, nothing
    # placed after this point could ever win.
    [ -n "$STALE_DIR" ] && [ "$d" = "$STALE_DIR" ] && break
    if [ -d "$d" ] && [ -w "$d" ]; then SHIM_DIR="$d"; break; fi
  done

  # No writable directory ahead of it. Escalate ONLY here, and only non-interactively
  # (`sudo -n`) so this can never hang a build waiting for a password.
  SHIM_SUDO=""
  if [ -z "$SHIM_DIR" ]; then
    for d in "${_pathdirs[@]}"; do
      [ -z "$d" ] && continue
      [ -n "$STALE_DIR" ] && [ "$d" = "$STALE_DIR" ] && break
      if [ -d "$d" ] && sudo -n test -w "$d" 2>/dev/null; then
        SHIM_DIR="$d"; SHIM_SUDO="sudo -n"
        log "No user-writable directory precedes $STALE_DIR; using $d via passwordless sudo."
        break
      fi
    done
  fi

  if [ -n "$SHIM_DIR" ]; then
    for b in node npm npx; do
      [ -e "$GOOD_BIN/$b" ] && $SHIM_SUDO ln -sfn "$GOOD_BIN/$b" "$SHIM_DIR/$b" 2>/dev/null || true
    done
    log "Linked node/npm/npx from $GOOD_BIN into $SHIM_DIR (precedes ${STALE_DIR:-<none>} on PATH)."
  else
    log "WARNING: no writable directory precedes ${STALE_DIR:-<none>} on PATH; the self-test below will say whether the gate can still pass."
  fi
fi

# Interactive convenience only. This is NOT what makes the gate pass (see the header) —
# it is here so a human opening a terminal gets the same Node the gate uses.
NODE_MARKER="# homesignal: prefer Node >=22.18 (site unit suite needs native TS type-stripping)"
if ! grep -qF "$NODE_MARKER" "$HOME/.bashrc" 2>/dev/null; then
  { printf '\n%s\n' "$NODE_MARKER"; printf 'export PATH="%s:$PATH"\n' "$GOOD_BIN"; } >> "$HOME/.bashrc"
  log "Added Node preference to ~/.bashrc (interactive shells only)."
else
  log "~/.bashrc already prefers this Node — no change."
fi

# ─────────────────────────────────────────────────────────────────────────────
# SELF-TEST — the script does not get to claim success it has not observed.
# Re-run the requirement in a shell shaped like the gate's: clean env, DEFAULT PATH
# (not ours), non-interactive. This is the whole point of the rewrite.
# ─────────────────────────────────────────────────────────────────────────────
FINAL_VER="$(gate_node)"
if [ -z "$FINAL_VER" ] || ! ver_ok "$FINAL_VER"; then
  log "FATAL (self-test): a non-interactive shell on the default PATH resolves ${FINAL_VER:-no node}, not >=22.18."
  log "       An adequate Node exists at $GOOD_NODE ($GOOD_VER) but the gate shell cannot reach it."
  log "       PATH as given to this script: $ORIG_PATH"
  log "       This needs a base-image change (a Dockerfile installing Node >=22.18 as the system node)."
  exit 1
fi
log "SELF-TEST PASS: a non-interactive shell on the default PATH resolves Node $FINAL_VER (>=22.18)."

# ─────────────────────────────────────────────────────────────────────────────
# OPTIONAL (best-effort) — homesignal-ingest Python test dependencies
# ─────────────────────────────────────────────────────────────────────────────
INGEST_REQ="$WORKSPACE_DIR/homesignal-ingest/requirements-test.txt"
if [ -f "$INGEST_REQ" ]; then
  if python3 -m pip install --user --quiet -r "$INGEST_REQ" 2>/dev/null; then
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
# The REQUIRED gate is the offline suite, which needs no browser. CI installs Playwright
# in the PARENT of the repo so Node resolves it by walking up, keeping the site repo free
# of node_modules/package.json — mirrored here. SKIP_PLAYWRIGHT=1 skips it.
if [ "${SKIP_PLAYWRIGHT:-0}" = "1" ]; then
  log "SKIP_PLAYWRIGHT=1 — skipping Playwright; the offline gate is unaffected."
else
  if ( cd "$WORKSPACE_DIR" 2>/dev/null || exit 1
       export PATH="$GOOD_BIN:$PATH"
       [ -f package.json ] || npm init -y >/dev/null 2>&1 || exit 1
       npm install --no-audit --no-fund playwright@1.56.0 >/dev/null 2>&1 || exit 1
       npx --yes playwright install chromium >/dev/null 2>&1 || exit 1 ); then
    log "Installed Playwright + Chromium for the browser unit suite."
  else
    warn "Playwright/Chromium not installed (the workspace parent may not be writable); the offline gate is unaffected."
  fi
fi

log "Install complete. Gate shell Node: $FINAL_VER."
log "Required gate:  node scripts/run-unit-tests.mjs --offline --min-files=75"
log "Full suite:     node scripts/run-unit-tests.mjs --min-files=80   (needs Playwright above)"
