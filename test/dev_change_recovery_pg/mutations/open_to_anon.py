import sys
s = open(sys.argv[1]).read()
a, b = "execute format('grant execute on function %s to service_role', f.sig);", "execute format('grant execute on function %s to service_role, anon', f.sig);"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
