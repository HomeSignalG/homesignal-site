import sys
s = open(sys.argv[1]).read()
a = 'select p_zip, s.reg, s.ver, _rec_cache_at, p_run'
b = "select p_zip, s.reg, 'v1:A', _rec_cache_at, p_run"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
