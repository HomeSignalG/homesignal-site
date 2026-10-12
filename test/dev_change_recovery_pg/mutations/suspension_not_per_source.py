import sys
s = open(sys.argv[1]).read()
a = "not exists (select 1 from _dc_scopesrc s where s.reg = r.registry_id and s.scope = ''expanded'' and s.complete)"
b = "not exists (select 1 from _dc_scopesrc s where s.scope = ''expanded'' and s.complete)"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
