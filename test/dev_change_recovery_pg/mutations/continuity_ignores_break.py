import sys
s = open(sys.argv[1]).read()
a = 'and rd.bgs >= rc.break_seq and rd.bgs <= rc.gen_seq) as continuous'
b = 'and rd.bgs <= rc.gen_seq) as continuous'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
