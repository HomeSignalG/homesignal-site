#!/usr/bin/env python3
"""Print SQL that replaces the fixture's stub helper functions with the REAL ones from the SQL of record
(docs/dev-refresh-source-failure-guard.sql): dev_failed_sources, dev_truncated_sources, dev_reported_sources, dev_retired_sources.
A stub that always answers 'nothing failed' cannot tell a receipt suite anything about failures."""
import pathlib, re, sys
root = pathlib.Path(__file__).resolve().parents[2]
src = (root / 'docs/dev-refresh-source-failure-guard.sql').read_text()
NAMES = ['dev_failed_sources', 'dev_truncated_sources', 'dev_reported_sources', 'dev_retired_sources']
out = []
for n in NAMES:
    m = re.search(r'create or replace function public\.' + n + r'\(.*?\n\$(\w*)\$;', src, re.S)
    if not m:
        sys.exit(f'real_helpers: {n} not found in docs/dev-refresh-source-failure-guard.sql')
    out.append(m.group(0))
sys.stdout.write('\n'.join(f"drop function if exists public.{n}(jsonb);\ndrop function if exists public.{n}(text, jsonb);" for n in NAMES) + '\n\n' + '\n\n'.join(out) + '\n')
