import sys
s = open(sys.argv[1]).read()
a = "when (select c.refreshed_at from c) is null       then 'cache_clock_missing'"
b = "when false       then 'cache_clock_missing'"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
