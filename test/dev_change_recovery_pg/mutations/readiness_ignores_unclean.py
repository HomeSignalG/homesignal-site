import sys
s = open(sys.argv[1]).read()
a = 'where g.reg <> all(_rp.unclean_regs)'
b = 'where true'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
