import sys
s = open(sys.argv[1]).read()
a = 'update public.dev_change_scope_ready r set lapsed_at = now()'
b = 'update public.dev_change_scope_ready r set lapsed_at = null'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
