import sys
s = open(sys.argv[1]).read()
a = 'when (select s.total from s) = 0 and exists ('
b = 'when false and exists ('
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
