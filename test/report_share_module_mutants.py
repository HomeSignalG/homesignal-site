#!/usr/bin/env python3
"""Prohibited mutations of supabase/functions/_shared/report-share.ts. Each MUST make test/report-share.test.mjs exit non-zero.

Run:  python3 test/report_share_module_mutants.py
It edits the module in place, runs the test, and ALWAYS restores the original (even on error or ^C).
An anchor that does not match exactly once is a harness failure, never a pass. Exit 1 if any mutation survives.
(Manual: CI runs the node tests, not this loop.)
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / 'supabase/functions/_shared/report-share.ts'
TEST = ROOT / 'test/report-share.test.mjs'

RE_HEAD = "'^[A-Za-z0-9_-]{'"
RE_TAIL = "+ '}$')"
ENCODE = "new TextEncoder().encode(token)"
GUARD = "  if (!isWellFormedToken(token)) throw new Error('hashShareToken: not a well-formed share token');\n"
TYPEOF = "typeof token === 'string' && TOKEN_RE.test(token)"
PAD = ".padStart(2, '0')"
RNG = "  crypto.getRandomValues(bytes);"
B64FIX = ".replace(/\\+/g, '-').replace(/\\//g, '_')"
PADDING = ".replace(/=+$/, '')"

MUTATIONS = {
    # ---- the randomness ---------------------------------------------------------------------------------------------
    'weak_rng': [(RNG, "  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);")],
    'rng_not_called': [(RNG, "  void bytes;")],
    'half_the_bytes_random': [(RNG, "  crypto.getRandomValues(bytes.subarray(0, 16));")],
    'short_token_16_bytes': [("SHARE_TOKEN_BYTES = 32", "SHARE_TOKEN_BYTES = 16")],
    'wrong_length_constant': [("SHARE_TOKEN_LENGTH = 43", "SHARE_TOKEN_LENGTH = 44")],
    # ---- the encoding ---------------------------------------------------------------------------------------------------
    'standard_alphabet': [(B64FIX, "")],
    'padding_kept': [(PADDING, "")],
    # ---- the hash ----------------------------------------------------------------------------------------------------------
    'hash_over_lowercased_token': [(ENCODE, "new TextEncoder().encode(token.toLowerCase())")],
    'hash_of_token_plus_newline': [(ENCODE, "new TextEncoder().encode(token + '\\n')")],
    'hash_of_the_decoded_bytes': [(ENCODE, "Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0))")],
    'hash_upper_case_hex': [(PAD, PAD + ".toUpperCase()")],
    'hash_without_zero_pad': [(PAD, "")],
    'hash_algorithm_sha1': [("'SHA-256'", "'SHA-1'")],
    'hash_does_not_validate': [(GUARD, "")],
    # ---- well-formedness ------------------------------------------------------------------------------------------------------
    'accepts_padding': [(RE_HEAD, "'^[A-Za-z0-9_=-]{'")],
    'accepts_standard_alphabet': [(RE_HEAD, "'^[A-Za-z0-9_+/-]{'")],
    'accepts_shorter': [(RE_HEAD, "'^[A-Za-z0-9_-]{1,'")],
    'accepts_longer': [(RE_TAIL, "+ ',}$')")],
    'not_anchored_at_start': [(RE_HEAD, "'[A-Za-z0-9_-]{'")],
    'not_anchored_at_end': [(RE_TAIL, "+ '}')")],
    'accepts_any_type': [(TYPEOF, "TOKEN_RE.test(token as string)")],
    'everything_is_well_formed': [(TYPEOF, "true")],
    # ---- the module does exactly three things ----------------------------------------------------------------------------------------
    'extra_export_builds_a_url': [("export async function hashShareToken", "export function shareUrl(t: string) { return 'https://example.invalid/s/' + t; }\n\nexport async function hashShareToken")],
}


def run():
    """(exit code, how many NAMED checks failed). A mutant that only crashes the test (a syntax error, an uncaught throw)
    exits non-zero too, but names nothing, so it is reported as a crash rather than counted as a clean kill."""
    r = subprocess.run(['node', str(TEST)], cwd=ROOT, capture_output=True, text=True)
    return r.returncode, sum(1 for line in r.stdout.splitlines() if line.startswith('FAIL — '))


def main():
    original = MODULE.read_text()
    if run() != (0, 0):
        print('HARNESS — the unmutated module does not pass its test')
        return 2
    survived = harness = 0
    try:
        for name, edits in MUTATIONS.items():
            text = original
            for old, new in edits:
                if text.count(old) != 1:
                    print('HARNESS  %s — anchor matched %d time(s), expected 1' % (name, text.count(old)))
                    harness += 1
                    break
                if old == new:
                    print('HARNESS  %s — the mutation changes nothing' % name)
                    harness += 1
                    break
                text = text.replace(old, new)
            else:
                MODULE.write_text(text)
                code, named = run()
                if code != 0 and named > 0:
                    print('KILLED   %s — %d named check(s) failed' % (name, named))
                elif code != 0:
                    print('CRASHED  %s — the test errored without failing a named check (not accepted as a kill)' % name)
                    harness += 1
                else:
                    print('SURVIVED %s — the module test cannot see this regression' % name)
                    survived += 1
    finally:
        MODULE.write_text(original)
    print('%d mutation(s), %d survived, %d harness failure(s)' % (len(MUTATIONS), survived, harness))
    return 1 if (survived or harness) else 0


if __name__ == '__main__':
    sys.exit(main())
