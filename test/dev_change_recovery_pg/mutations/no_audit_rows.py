import sys
s = open(sys.argv[1]).read()
a, b = 'from _dc_recovery r join _dc_obs o on o.identity_key = r.identity_key', 'from _dc_recovery r join _dc_obs o on false'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
