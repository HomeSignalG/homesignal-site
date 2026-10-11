import sys
s = open(sys.argv[1]).read()
a = "return jsonb_build_object(''status'', ''deferred'', ''reason'', _rp.reason, ''zip'', p_zip);"
b = "return jsonb_build_object(''status'', ''deferred'', ''zip'', p_zip);"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
