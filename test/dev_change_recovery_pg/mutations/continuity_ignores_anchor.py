import sys
s = open(sys.argv[1]).read()
a = 'a.tick_at = rd.vat'
b = 'a.tick_at <> rd.vat'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
