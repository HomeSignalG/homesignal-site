import sys
s = open(sys.argv[1]).read()
a = "and f.kind in ('fetch_failed', 'truncated')"
b = "and f.kind = 'fetch_failed'"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
