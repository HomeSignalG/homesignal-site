import sys
s = open(sys.argv[1]).read()
a, b = '  if not _baseline then\\n    insert into _dc_recovery', '  if true then\\n    insert into _dc_recovery'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
