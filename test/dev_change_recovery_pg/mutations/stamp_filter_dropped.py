import sys
s = open(sys.argv[1]).read()
a = "and d.el->>'scope_origin' = 'polygon_member'"
b = 'and true'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
