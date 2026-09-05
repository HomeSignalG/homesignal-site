#!/usr/bin/env python3
"""The EXISTING Regulated-facility eligibility predicate, DERIVED from shipped source.

WHY THIS FILE EXISTS, AND WHY IT PARSES RATHER THAN TRANSCRIBES.

Map 1's Regulated facility Type has exactly one source (EPA FRS) and exactly one
NON-GEOGRAPHIC eligibility rule, and that rule is
`supabase/functions/get-address-report/index.ts::looksIndustrial`. Replacing the
centroid-radius ZIP population with whole-ZIP membership must not change WHICH
facilities qualify - only which ZIP they belong to. So the national build has to
apply the very same predicate, in Python, on a runner.

Hand-copying the two token sets into this file would be exactly the failure the
repo already paid for twice (CLAUDE.md claims-discipline rules 7 and 8): a
reflowed list drops entries, the drop is invisible in review, and the result is a
*differently defined facility universe* that still looks plausible. So the token
sets are NOT typed here. They are parsed out of index.ts at import time, and the
parse FAILS CLOSED - a shape change raises rather than yielding a short list.

What is genuinely reimplemented is only the 5-line evaluation order of
looksIndustrial. `test/frs-eligibility-parity.test.mjs` is the differential proof
that this reimplementation agrees with the shipped one, evaluated from the shipped
source text, over every include token, every exclude token, adversarial names and
a real FRS name sample - required 0 mismatches.

RADIUS IS NOT ELIGIBILITY. DISTANCE IS NOT ELIGIBILITY. MAX_FACILITIES IS NOT
ELIGIBILITY. Those three live in facilitySites()'s retrieval, are deliberately
absent here, and are what the whole-ZIP build exists to remove.
"""
import os
import re

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                      "supabase", "functions", "get-address-report", "index.ts")

# The shipped tokenizer, verbatim: index.ts:146
#   new Set((name.toLowerCase().match(/[a-z]+/g) || []))
_TOKEN_RE = re.compile(r"[a-z]+")

_STR_RE = re.compile(r'"([^"\\]*)"')


def _block(src, opener, closer):
    """The source text between `opener` and the first `closer` after it.

    Fails closed on both halves: a missing opener and a missing closer each raise,
    so a rename or a reflow in index.ts stops this build instead of silently
    producing a shorter token set.
    """
    i = src.find(opener)
    if i < 0:
        raise SystemExit(f"STOP: index.ts no longer contains {opener!r}")
    j = src.find(closer, i + len(opener))
    if j < 0:
        raise SystemExit(f"STOP: index.ts {opener!r} block is unterminated")
    return src[i + len(opener):j]


def _parse(path=ENGINE):
    src = open(path, encoding="utf-8").read()

    # LAYER_KEYWORDS: [string, string[]][] — each entry is ["<layer>", ["w", ...]].
    # The layer NAME is the first string of the entry and is NOT an include token;
    # only the inner list contributes. Parsed per entry rather than by flattening
    # every quoted string in the block, which would wrongly admit the layer names.
    layers_src = _block(src, "const LAYER_KEYWORDS: [string, string[]][] = [", "\n];")
    layer_words = []
    for entry in re.finditer(r'\[\s*"([^"]+)"\s*,\s*\[([^\]]*)\]\s*\]', layers_src):
        layer_words.extend(_STR_RE.findall(entry.group(2)))
    if not layer_words:
        raise SystemExit("STOP: LAYER_KEYWORDS parsed to zero words")

    # INCLUDE = new Set([ ...LAYER_KEYWORDS.flatMap(...).filter(w => !w.includes(" ")), "…" ])
    # The spread is reproduced structurally (single-word layer keywords only), and
    # the literal tail is taken from the block's own quoted strings. The spread line
    # itself carries the quoted " " of `.includes(" ")`, which is dropped by the
    # same single-word filter the shipped code applies.
    include_src = _block(src, "const INCLUDE = new Set([", "\n]);")
    include = {w for w in layer_words if " " not in w}
    include |= {s for s in _STR_RE.findall(include_src) if s and " " not in s}

    exclude_src = _block(src, "const EXCLUDE = new Set([", "\n]);")
    exclude = {s for s in _STR_RE.findall(exclude_src) if s}

    # Fail closed on an implausibly small parse. These floors are not the expected
    # sizes (which may legitimately grow); they are "the parse clearly worked".
    if len(include) < 30 or len(exclude) < 30:
        raise SystemExit(f"STOP: eligibility parse looks truncated — "
                         f"include={len(include)} exclude={len(exclude)}")
    if include & exclude:
        raise SystemExit(f"STOP: token in both sets: {sorted(include & exclude)}")
    return include, exclude


INCLUDE, EXCLUDE = _parse()


def tokenize(name):
    return set(_TOKEN_RE.findall((name or "").lower()))


def looks_industrial(name):
    """index.ts:147-153, same order: EXCLUDE veto, then the data-center literal, then INCLUDE.

    The order is load-bearing and is asserted by the parity test: a name carrying
    BOTH an exclude token and 'data center' is REJECTED, because the veto runs first.
    """
    low = (name or "").lower()
    t = tokenize(name)
    for w in t:
        if w in EXCLUDE:
            return False
    if "data center" in low or "datacenter" in t:
        return True
    for w in t:
        if w in INCLUDE:
            return True
    return False


if __name__ == "__main__":
    print(f"include tokens {len(INCLUDE)}")
    print(f"exclude tokens {len(EXCLUDE)}")
