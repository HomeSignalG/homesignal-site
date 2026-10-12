import sys
s = open(sys.argv[1]).read()
a = "case when s.scope = ''expanded'' and s.complete then s.ver end,"
b = "case when s.scope = ''expanded'' and s.complete then ''-'' end,"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
