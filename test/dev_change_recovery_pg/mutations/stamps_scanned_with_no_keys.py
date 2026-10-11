import sys
s = open(sys.argv[1]).read()
a = '(coalesce(p_scan, false) or (select k.requested from k) > 0)'
b = 'true'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
