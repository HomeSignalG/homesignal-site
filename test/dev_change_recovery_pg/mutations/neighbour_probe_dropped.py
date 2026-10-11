import sys
s = open(sys.argv[1]).read()
a = 'or exists (select 1 from _dc_obs o join public.dev_change_recovery rr on rr.identity_key = o.identity_key) then'
b = 'or false then'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
