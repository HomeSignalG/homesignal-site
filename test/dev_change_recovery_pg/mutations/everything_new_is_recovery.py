import sys
s = open(sys.argv[1]).read()
a = 'where o.identity_key = any(_rp.stamped_keys);'
b = 'where o.identity_key = any(_rec_keys);'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
