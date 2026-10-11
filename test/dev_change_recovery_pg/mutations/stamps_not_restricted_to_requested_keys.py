import sys
s = open(sys.argv[1]).read()
a = "where x.sk = any(p_keys)), '{}'::text[])"
b = "where true), '{}'::text[])"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
