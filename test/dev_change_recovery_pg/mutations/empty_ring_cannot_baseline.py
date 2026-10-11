import sys
s = open(sys.argv[1]).read()
a = "from _dc_scopesrc s where s.scope = ''expanded'' and s.complete"
b = "from _dc_scopesrc s where s.scope = ''expanded'' and s.complete and exists (select 1 from _dc_obs o where coalesce(o.registry_id, '''') = s.reg and o.identity_key = any(_rp.stamped_keys))"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
