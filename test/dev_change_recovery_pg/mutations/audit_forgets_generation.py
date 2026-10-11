import sys
s = open(sys.argv[1]).read()
a = 'o.observed_at, _rec_cache_at, public.dev_change_recovery_rule_version()'
b = 'o.observed_at, null, public.dev_change_recovery_rule_version()'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
