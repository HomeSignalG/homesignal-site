import sys
s = open(sys.argv[1]).read()
a = 'and r.lapsed_at is null)\\n                         then'
b = 'and true)\\n                         then'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
