#!/usr/bin/env python3
# TEMPORARY read-only probe, pass 2: extract the City of Austin Open Data Terms of Use text. Public GET only.
import re, urllib.request, html
UA = {'User-Agent': 'HomeSignal-readonly-probe/1.0 (contact: hello@homesignal.net)'}
u = 'https://data.austintexas.gov/stories/s/Open-Data-Terms-of-Use/ranj-cccq/'
b = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read().decode('utf-8', 'replace')
print('GET', u, 'len', len(b))
t = re.sub(r'(?is)<(script|style|noscript)\b.*?</\1>', ' ', b)
t = re.sub(r'(?s)<[^>]+>', ' ', t)
t = re.sub(r'\s+', ' ', html.unescape(t)).strip()
print('TEXT len', len(t))
for kw in ('commercial', 'attribution', 'Public Domain', 'license', 'warrant', 'GIS'):
    for m in list(re.finditer(kw, t, flags=re.I))[:3]:
        a = max(0, m.start() - 300)
        print('--- [%s] ...%s' % (kw, t[a:m.start() + 700]))
i = t.find('Terms of Use', t.find('Terms of Use') + 20)
print('=== BODY from 2nd Terms of Use ===')
print(t[i:i + 7000])
