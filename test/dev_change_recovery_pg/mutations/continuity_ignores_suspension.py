import sys
s = open(sys.argv[1]).read()
a = 'and rd.lapsed_at is null and rd.ver = rc.ver'
b = 'and rd.ver = rc.ver'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
