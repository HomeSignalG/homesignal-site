import sys
s = open(sys.argv[1]).read()
a = "case when s.reg is null or s.scope <> ''expanded'' or not s.complete"
b = 'case when s.reg is null or false or not s.complete'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
