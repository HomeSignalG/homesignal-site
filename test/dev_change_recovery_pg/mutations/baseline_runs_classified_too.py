import sys
s = open(sys.argv[1]).read()
a = '  if not _baseline then\\n    select array_agg'
b = '  if true then\\n    select array_agg'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
