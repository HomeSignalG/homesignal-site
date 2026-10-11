import sys
s = open(sys.argv[1]).read()
a, b = "else ''historical_backlog'' end", "else ''genuine_recent'' end"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
