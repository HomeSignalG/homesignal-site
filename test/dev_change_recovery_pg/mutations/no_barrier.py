import sys
s = open(sys.argv[1]).read()
a, b = 'if not _baseline and not public.dev_change_materialization_current(p_zip) then', 'if false then'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
