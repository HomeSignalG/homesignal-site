import sys
s = open(sys.argv[1]).read()
a = "''coverage_recovered'' from _dc_obs o where o.identity_key = any(_rp.stamped_keys);"
b = "''coverage_recovered'' from _dc_obs o where o.identity_key = any(_rp.stamped_keys) and o.submitted_at < current_date - 45;"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
