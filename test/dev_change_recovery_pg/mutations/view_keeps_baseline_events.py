import sys
s = open(sys.argv[1]).read()
a, b = 'where not r.baseline and not e.is_baseline;', 'where not r.baseline;'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
