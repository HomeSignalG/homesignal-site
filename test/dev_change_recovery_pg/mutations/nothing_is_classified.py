import sys
s = open(sys.argv[1]).read()
a = "select c.identity_key, ''coverage_recovered'' from _dc_scopecls c where c.cls = ''recover'';"
b = "select c.identity_key, ''coverage_recovered'' from _dc_scopecls c where false;"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
