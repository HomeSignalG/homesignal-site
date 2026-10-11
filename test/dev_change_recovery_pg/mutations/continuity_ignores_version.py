import sys
s = open(sys.argv[1]).read()
a = "(rc.scope = 'expanded' and rc.complete and rd.bgs is not null and rd.ver = rc.ver"
b = "(rc.scope = 'expanded' and rc.complete and rd.bgs is not null"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
