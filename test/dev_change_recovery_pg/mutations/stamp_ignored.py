import sys
s = open(sys.argv[1]).read()
a, b = "where d.el->>'scope_origin' = 'polygon_member'", 'where true'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
