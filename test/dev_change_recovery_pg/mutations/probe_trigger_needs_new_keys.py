import sys
s = open(sys.argv[1]).read()
a = '       or exists (select 1 from public.dev_change_scope_ready r where r.zip = p_zip and r.baseline_gen_seq is not null)\\n'
b = '\\n'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
