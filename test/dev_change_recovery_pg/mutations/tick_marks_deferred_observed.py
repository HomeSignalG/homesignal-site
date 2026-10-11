import sys
s = open(sys.argv[1]).read()
a, b = '_deferred := _deferred + 1; continue; end if;', '_deferred := _deferred + 1; end if;'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:60])
sys.stdout.write(s.replace(a, b))
