import sys
s = open(sys.argv[1]).read()
a, b = "when o.submitted_at is null or o.submitted_at > o.observed_at::date + 1 then ''undated_failed_closed''", "when o.submitted_at is null or o.submitted_at > o.observed_at::date + 1 then ''genuine_recent''"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
