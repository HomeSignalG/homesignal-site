import sys
s = open(sys.argv[1]).read()
a = "is distinct from _rec_cache_at then"
b = "is distinct from _rec_cache_at and false then"
if s.count(a) < 1:
    sys.exit("anchor missing")
sys.stdout.write(s.replace(a, b))
