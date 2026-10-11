import sys
s = open(sys.argv[1]).read()
a = "rr.scope in (''expanded'', ''fallback'', ''failed'')"
b = "rr.scope in (''fallback'')"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
