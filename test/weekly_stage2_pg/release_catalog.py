"""What files 8 and 9 change in the database catalog, checked object by object (DISPOSABLE database only).

    release_catalog.py --snapshot <out.json>        every weekly table, sequence, view, function and trigger in public
    release_catalog.py --diff <1-7.json> <1-9.json> requires exactly the delta below; prints it; exit 1 otherwise

The required delta, 1-7 -> 1-9:
  * new tables: exactly NEW_TABLES; each has row security on, no privilege for public, anon or authenticated, and an
    *_append_only trigger calling weekly_append_only;
  * new sequences (their bigserial ids): no privilege for public, anon or authenticated;
  * new functions: exactly NEW_FUNCTIONS; each SECURITY DEFINER with search_path=public; anon and public cannot execute;
    authenticated can execute exactly the hs_* ones, and each of those calls _hs_is_admin(); the render export is
    service_role only;
  * changed functions: exactly REPLACED (file 9), with owner, privileges, SECURITY DEFINER and settings unchanged;
  * every other weekly object identical, privileges included: the earlier isolation is untouched.
"""
import json
import subprocess
import sys

NEW_TABLES = {"weekly_edition_sequences", "weekly_edition_approvals", "weekly_edition_topic_events"}
NEW_FUNCTIONS = {
    "weekly_edition_sequence_problems(bigint)", "weekly_edition_sequence_digest(bigint)", "weekly_edition_video(uuid)",
    "hs_weekly_edition_sequence_set(uuid,jsonb)", "hs_weekly_edition_sequence_approve(uuid,text)", "hs_weekly_edition_video(uuid)",
    "weekly_edition_render_export(uuid)", "weekly_edition_topics(uuid)", "hs_weekly_edition_add_topic(uuid,text)",
    "hs_weekly_edition_topics(uuid)", "weekly_edition_candidates(uuid)"}
REPLACED = {"_wk_lead_assign(uuid,uuid,text)", "weekly_lead_request_text(uuid,uuid,text)",
            "hs_weekly_lead_send_to_research(uuid,uuid,text)", "hs_weekly_edition_link_version(uuid,uuid)"}
SERVICE_ONLY = {"weekly_edition_render_export(uuid)"}

Q = r"""
select jsonb_build_object(
 'relations', (select jsonb_object_agg(c.relname, jsonb_build_object('kind', c.relkind, 'rls', c.relrowsecurity,
     'acl', (select coalesce(jsonb_agg(a::text order by a::text), '[]') from unnest(c.relacl) a),
     'anon', case when c.relkind in ('r','v') then has_table_privilege('anon', c.oid, 'select,insert,update,delete')
                  when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'usage,select,update') end,
     'authenticated', case when c.relkind in ('r','v') then has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')
                  when c.relkind = 'S' then has_sequence_privilege('authenticated', c.oid, 'usage,select,update') end,
     'def', case when c.relkind = 'v' then md5(pg_get_viewdef(c.oid)) end,
     'columns', (select md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum))
                 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
     'triggers', (select coalesce(jsonb_object_agg(t.tgname, p.proname), '{}') from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                  where t.tgrelid = c.oid and not t.tgisinternal)))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','v','S') and c.relname like 'weekly\_%'),
 'functions', (select jsonb_object_agg(p.proname || '(' || coalesce((select string_agg(format_type(t, null), ',' order by o)
       from unnest(p.proargtypes) with ordinality x (t, o)), '') || ')',
     jsonb_build_object('secdef', p.prosecdef, 'config', p.proconfig, 'owner', pg_get_userbyid(p.proowner),
       'acl', (select coalesce(jsonb_agg(a::text order by a::text), '[]') from unnest(p.proacl) a),
       'public', has_function_privilege('public', p.oid, 'execute'),
       'anon', has_function_privilege('anon', p.oid, 'execute'),
       'authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
       'service_role', has_function_privilege('service_role', p.oid, 'execute'),
       'admin_check', position('_hs_is_admin()' in p.prosrc) > 0,
       'body', md5(p.prosrc)))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'weekly\_%' or p.proname like '\_wk\_%' or p.proname like 'hs\_weekly\_%'))
)::text
"""


def snapshot(out):
    r = subprocess.run(["psql", "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", Q], capture_output=True, text=True, check=True)
    open(out, "w").write(r.stdout.strip() + "\n")


def diff(a_path, b_path):
    a, b = json.load(open(a_path)), json.load(open(b_path))
    bad, lines = [], []
    ra, rb = a["relations"], b["relations"]
    new_rel = set(rb) - set(ra)
    if set(ra) - set(rb):
        bad.append("relations removed: %s" % sorted(set(ra) - set(rb)))
    new_tables = {k for k in new_rel if rb[k]["kind"] == "r"}
    if new_tables != NEW_TABLES:
        bad.append("new tables are %s, expected %s" % (sorted(new_tables), sorted(NEW_TABLES)))
    for k in sorted(new_rel):
        x = rb[k]
        if x["kind"] == "r":
            ok = (x["rls"] and not x["anon"] and not x["authenticated"]
                  and not any(e.startswith("=") or e.startswith("anon=") or e.startswith("authenticated=") for e in x["acl"])
                  and x["triggers"].get(k + "_append_only") == "weekly_append_only")
            lines.append("  new table %s: rls %s, anon %s, authenticated %s, append-only trigger %s" %
                         (k, x["rls"], x["anon"], x["authenticated"], x["triggers"].get(k + "_append_only")))
            if not ok:
                bad.append("new table %s is not isolated and append-only" % k)
        elif x["kind"] == "S":
            lines.append("  new sequence %s: anon %s, authenticated %s" % (k, x["anon"], x["authenticated"]))
            if x["anon"] or x["authenticated"]:
                bad.append("new sequence %s is usable by anon or authenticated" % k)
        else:
            bad.append("unexpected new relation %s (kind %s)" % (k, x["kind"]))
    for k in sorted(set(ra) & set(rb)):
        if ra[k] != rb[k]:
            bad.append("existing relation %s changed: %s" % (k, sorted(f for f in ra[k] if ra[k][f] != rb[k].get(f))))
    fa, fb = a["functions"], b["functions"]
    if set(fa) - set(fb):
        bad.append("functions removed: %s" % sorted(set(fa) - set(fb)))
    new_f = set(fb) - set(fa)
    if new_f != NEW_FUNCTIONS:
        bad.append("new functions are %s, expected %s" % (sorted(new_f), sorted(NEW_FUNCTIONS)))
    for k in sorted(new_f & NEW_FUNCTIONS):
        x = fb[k]
        admin = k.startswith("hs_weekly_")
        ok = (x["secdef"] and x["config"] == ["search_path=public"] and not x["public"] and not x["anon"]
              and x["authenticated"] == admin and (not admin or x["admin_check"])
              and (x["service_role"] if k in SERVICE_ONLY else True))
        lines.append("  new function %s: definer %s, %s, authenticated %s, anon %s, admin check %s%s" % (
            k, x["secdef"], x["config"], x["authenticated"], x["anon"], x["admin_check"],
            ", service_role %s" % x["service_role"] if k in SERVICE_ONLY else ""))
        if not ok:
            bad.append("new function %s has the wrong security" % k)
    changed = {k for k in set(fa) & set(fb) if fa[k] != fb[k]}
    if changed != REPLACED:
        bad.append("changed functions are %s, expected exactly %s" % (sorted(changed), sorted(REPLACED)))
    for k in sorted(changed & REPLACED):
        other = sorted(f for f in fa[k] if f != "body" and fa[k][f] != fb[k][f])
        lines.append("  replaced function %s: body changed; owner, privileges, definer and settings %s" % (k, "unchanged" if not other else "CHANGED " + str(other)))
        if other:
            bad.append("replaced function %s changed more than its body: %s" % (k, other))
    print("\n".join(lines))
    print("unchanged: %d existing relations, %d existing functions" % (len(set(ra) & set(rb)), len(set(fa) & set(fb)) - len(changed)))
    for x in bad:
        print("FAIL:", x)
    return 1 if bad else 0


if __name__ == "__main__":
    if sys.argv[1] == "--snapshot":
        snapshot(sys.argv[2])
    elif sys.argv[1] == "--diff":
        sys.exit(diff(sys.argv[2], sys.argv[3]))
    else:
        sys.exit(__doc__)
