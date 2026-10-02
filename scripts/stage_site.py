#!/usr/bin/env python3
"""Stage the GitHub Pages artifact — the PRODUCTION ARTIFACT CONTRACT.

This file is the single producer of the public artifact. `.github/workflows/pages.yml`
calls it instead of the `rsync -a --exclude ...` it used until Fix 19, and
`test/site-artifact-contract.test.mjs` executes THIS script and inspects the tree it
really wrote — so the guard and the producer cannot drift apart.

WHY IT IS AN ALLOWLIST (Fix 19, 2026-09-13)
-------------------------------------------
The rsync form shipped every repo file that was not named in six `--exclude` flags, so
a file shipped BECAUSE IT EXISTED. Nothing selected it and nothing would ever have
stopped. That is how the Phase 1 mockup reached production (Fix 18) and how 170 KB of
`CLAUDE.md` plus 704 KB of `QUEUE.md` became publicly readable — all measured live at
HTTP 200 with a 404 control.

A denylist fails OPEN: the next internal file ships unless somebody remembers to add a
flag. This contract fails CLOSED — a path ships only if it is named here, so a new
`internal-notes.md`, a new developer script and a new `.sql` dump are all excluded by
default, with no edit and nobody having to remember.

THE COST, STATED PLAINLY: a genuinely new public page must be added to ROOT_FILES, or it
will not ship. That is deliberate. §5 of the contract test fails when any shipped page
references a local asset the artifact does not contain, so a forgotten entry is a RED
BUILD, never a silent 404 in production.

NOT A DELETION. Every excluded file stays in the repository and stays useful there. The
defect is that they were SERVED.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

# ---------------------------------------------------------------------------
# THE CONTRACT. Everything below ships; everything else does not.
# ---------------------------------------------------------------------------

#: Root-level files that ship. Named individually ON PURPOSE — an extension rule would
#: readmit any future `internal-notes.txt` / `internal-dump.json` dropped at the root.
ROOT_FILES = (
    # GitHub Pages control files
    '.nojekyll',
    'CNAME',
    # pages
    '404.html',
    'about.html',
    'acquisition.html',
    'alerts.html',
    'box-elder.html',
    'community.html',
    'contact.html',
    'dashboard.html',
    'development-activity.html',
    'development.html',
    'eagle-mountain.html',
    'gov-archive.html',
    'homesignalmap.html',
    'how-it-works.html',
    'index.html',
    'maps.html',
    'my-alerts.html',
    'privacy.html',
    'properties.html',
    'property.html',
    'reports.html',
    # RETIRED FROM THE ARTIFACT 2026-10-01 (Development Activity Order H, first step). The legacy
    # browser-direct NYC report page, `future-surroundings-report.html`, is deliberately NOT named
    # here. It generates a report entirely in the visitor's browser against data.cityofnewyork.us,
    # so no HomeSignal server sees the request and no server-side quota could ever apply to it.
    # The plan allows one customer-facing generation path (Hard Rule 24). The file and its three
    # libraries stay in the repository untouched (ruling R6); only the SERVING stops, so the URL
    # is a plain 404. TO REVERSE: re-add the line  'future-surroundings-report.html',  here and
    # flip the pins in test/nyc-v1-report.test.mjs 5f and test/single-customer-generation-path.test.mjs P2.
    # Decision and receipt: docs/order-h-retire-legacy-generator-2026-10-01.md.
    'share-text.html',
    'terms.html',
    'today.html',
    'unsubscribe.html',
    # runtime styles + scripts
    'app.css',
    'communities.js',
    'config.js',
    'events.js',
    'hs-resolve.js',
    'share.js',
    'shell.js',
    'topics.js',
    # runtime data + media
    'topics.canon.json',
    'favicon.svg',
    'og-default.png',
    # crawler surface
    'robots.txt',
    'sitemap.xml',
    # Bluesky custom-feed generator identity (did:web:homesignal.net). The AppView resolves it
    # at https://homesignal.net/.well-known/did.json; content is pinned by
    # test/bsky-did-document.test.mjs and generated in homesignal-ingest by
    # bluesky/lib/feed-contract.mjs::didDocument().
    '.well-known/did.json',
    # Google Search Console ownership verification (HTML-file method, founder 2026-09-28).
    # Google re-checks it; removing it un-verifies homesignal.net.
    'google59e1ae3ef6b75e3a.html',
)

#: Directory trees that ship, each with the file extensions allowed inside it. A tree is
#: copied recursively, but only files whose suffix appears here are taken — so a `.sql`,
#: `.md`, `.py` or build-only `.mjs` dropped inside a shipped tree still does not ship.
#: (`lib/generated/` holds two runtime JSONs the browser fetches; the three
#: build-tooling artifacts — transitions.mjs, versions.mjs and transitions.sql — moved
#: to homesignal-ingest with their generator.)
TREES = {
    'lib': ('.js', '.json'),
    'partials': ('.html',),
    # .webp: the homepage's approved Development Activity report preview
    # (assets/home-development-activity-report-preview.webp, founder-approved in #1494).
    'assets': ('.js', '.css', '.png', '.svg', '.webp', '.woff2'),
    'seed': ('.js',),
}


def staged_paths(src: str) -> list[str]:
    """Return every repo-relative path the contract ships, sorted. Pure: no I/O writes."""
    out: list[str] = []

    for name in ROOT_FILES:
        if os.path.isfile(os.path.join(src, name)):
            out.append(name)

    for tree, suffixes in TREES.items():
        base = os.path.join(src, tree)
        if not os.path.isdir(base):
            continue
        for root, dirnames, filenames in os.walk(base):
            dirnames.sort()
            for fn in sorted(filenames):
                if not fn.endswith(suffixes):
                    continue
                rel = os.path.relpath(os.path.join(root, fn), src)
                out.append(rel.replace(os.sep, '/'))

    return sorted(out)


def stage(src: str, dest: str) -> list[str]:
    """Copy the contract from *src* into *dest*, creating parents. Returns what shipped."""
    paths = staged_paths(src)
    for rel in paths:
        target = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(target) or dest, exist_ok=True)
        shutil.copy2(os.path.join(src, rel), target)
    return paths


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--src', default='.', help='repository root (default: .)')
    ap.add_argument('--out', help='artifact directory to stage into')
    ap.add_argument('--list-only', action='store_true',
                    help='print the contract and write nothing')
    args = ap.parse_args()

    if args.list_only:
        for rel in staged_paths(args.src):
            print(rel)
        return 0

    if not args.out:
        ap.error('--out is required unless --list-only is given')

    os.makedirs(args.out, exist_ok=True)
    paths = stage(args.src, args.out)

    # An instrument must prove it ran: an empty stage is a broken contract, not a clean one.
    if not paths:
        print('ERROR: the artifact contract staged ZERO files', file=sys.stderr)
        return 1
    if 'index.html' not in paths:
        print('ERROR: index.html is missing from the staged artifact', file=sys.stderr)
        return 1

    print(f'staged {len(paths)} files into {args.out} under the Fix 19 artifact contract')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
