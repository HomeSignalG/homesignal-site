import sys
s = open(sys.argv[1]).read()
a = 'from _dc_recovery r join _dc_obs o on o.identity_key = r.identity_key'
b = 'from _dc_recovery r join _dc_obs o on false'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
