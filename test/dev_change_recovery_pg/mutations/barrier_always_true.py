import sys
s = open(sys.argv[1]).read()
a, b = 'when (select d.refreshed_at from public.development_reports d where d.zip = p_zip) is null then true', 'when true then true'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
