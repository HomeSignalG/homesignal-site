import sys
s = open(sys.argv[1]).read()
a, b = "(_baseline or (rc.identity_key is not null and rc.outcome <> ''genuine_recent''))", '_baseline'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
