import sys
s = open(sys.argv[1]).read()
a, b = "when o.submitted_at >= o.observed_at::date - public.dev_change_recovery_news_days() then ''genuine_recent''", "when o.submitted_at <= o.observed_at::date - public.dev_change_recovery_news_days() then ''genuine_recent''"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
