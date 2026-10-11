import sys
s = open(sys.argv[1]).read()
a = "where d.el->>'scope_origin' = 'polygon_member'"
b = 'where true'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
