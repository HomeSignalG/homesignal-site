import sys
s = open(sys.argv[1]).read()
a = 'not (_baseline or rc.identity_key is not null),\\n         (_baseline or rc.identity_key is not null),'
b = 'not _baseline,\\n         _baseline,'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
