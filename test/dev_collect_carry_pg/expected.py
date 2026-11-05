#!/usr/bin/env python3
"""Computes the PATCHED fingerprint of dev_refresh_collect SEPARATELY from the database: reads the ORIGINAL body
(a file, argv[1]), applies the migration's three replacements read out of the migration file itself, prints md5 and length.
Refuses unless the original fingerprints to the approved ORIGINAL and each anchor occurs exactly once."""
import hashlib, re, sys
root = __file__.rsplit('/test/', 1)[0]
mig = open(root + '/docs/dev-refresh-collect-carry-failed-sources.sql', encoding='utf-8').read()
def block(tag):
    m = re.search(r'\$' + tag + r'\$(.*?)\$' + tag + r'\$', mig, re.S)
    assert m, tag
    return m.group(1)
body = open(sys.argv[1], encoding='utf-8').read()
assert hashlib.md5(body.encode()).hexdigest() == '5afbb78376a080f2d9eb095335476a53' and len(body) == 16091, 'not the ORIGINAL body'
for i in (1, 2, 3):
    o, n = block('a%d' % i), block('b%d' % i)
    assert body.count(o) == 1, ('anchor', i, body.count(o))
    body = body.replace(o, n)
print(hashlib.md5(body.encode()).hexdigest(), len(body))
