import sys
s = open(sys.argv[1]).read()
a = "case when s.reg is null or s.scope <> ''expanded'' or not s.complete then ''hold''"
b = "case when s.scope <> ''expanded'' or not s.complete then ''hold''"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
