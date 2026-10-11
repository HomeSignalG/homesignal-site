import sys
s = open(sys.argv[1]).read()
a = "or (b.registry_id = '' and b.scope = 'lost')"
b = 'or false'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
