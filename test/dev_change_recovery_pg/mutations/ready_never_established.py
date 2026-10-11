import sys
s = open(sys.argv[1]).read()
a = 'from unnest(_rp.stamped_regs) as g(reg)'
b = "from unnest(''{}''::text[]) as g(reg)"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
