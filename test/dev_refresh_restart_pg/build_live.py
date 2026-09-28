#!/usr/bin/env python3
"""Print CREATE FUNCTION for the LIVE public.dev_refresh_collect() (2026-09-28).

Live = docs/dev-refresh-collect-once-per-response.sql plus the two splices migration
20260927230313 (dev_refresh_echo_health_v1_collect) made, whose source file is in
neither repo. Refuses unless the rebuilt body fingerprints to production's
md5(prosrc), so the suite runs the function production runs.
"""
import hashlib, pathlib, re, sys

LIVE_MD5, LIVE_LEN = '790a61cb4b72e9b40a789be46cbc09a7', 14428
root = pathlib.Path(__file__).resolve().parents[2]
src = (root / 'docs/dev-refresh-collect-once-per-response.sql').read_text()
m = re.search(r'(create or replace function public\.dev_refresh_collect\(\).*?as \$function\$)(.*?)(\$function\$)', src, re.S)
head, body, tail = m.group(1), m.group(2), m.group(3)

SPLICES = [  # (anchor, replacement), each asserted to occur exactly once
    ("""else coalesce((select jsonb_agg(x order by o)
                                  from jsonb_array_elements(j->'sites') with ordinality t(x, o)
                                 where x ? 'registry_id'), '[]'::jsonb)
               end,""",
     """else public.dev_echo_merge_facility_sites(
                   coalesce((select jsonb_agg(x order by o)
                               from jsonb_array_elements(j->'sites') with ordinality t(x, o)
                              where x ? 'registry_id'), '[]'::jsonb),
                   coalesce((select jsonb_agg(x order by o)
                               from jsonb_array_elements(d.sites) with ordinality t(x, o)
                              where x ? 'registry_id'), '[]'::jsonb),
                   j)
               end,"""),
    ("paywall        = coalesce((j->>'paywall')::boolean, false),",
     """paywall        = coalesce((j->>'paywall')::boolean, false),
    echo           = case when j ? 'echo' then j->'echo' else d.echo end,
    cwa            = case when j ? 'cwa'  then j->'cwa'  else d.cwa  end,"""),
]
for a, r in SPLICES:
    if body.count(a) != 1:
        sys.exit(f'build_live: anchor found {body.count(a)} times: {a[:50]!r}')
    body = body.replace(a, r)
got = hashlib.md5(body.encode()).hexdigest()
if (got, len(body)) != (LIVE_MD5, LIVE_LEN):
    sys.exit(f'build_live: rebuilt body is {got} / {len(body)}, production is {LIVE_MD5} / {LIVE_LEN}')
print(head + body + tail + ';')
