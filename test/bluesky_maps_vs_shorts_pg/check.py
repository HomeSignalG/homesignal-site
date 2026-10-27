#!/usr/bin/env python3
"""docs/bluesky-maps-vs-shorts.sql on a disposable Postgres: the classify_channel splice and the MAPS vs Shorts reader,
against seeded touches whose right answer is known. Talks only to the database named by PG* variables. stdlib only."""
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
fails = checks = 0
def ok(c, m):
    global fails, checks
    checks += 1; print(('PASS - ' if c else 'FAIL - ') + m); fails += 0 if c else 1
def psql(sql=None, file=None, may_fail=False):
    cmd = ['psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'] + (['-1', '-f', file] if file else ['-c', sql])
    r = subprocess.run(cmd, capture_output=True, text=True)
    if may_fail: return r.returncode, (r.stdout + r.stderr).strip()
    if r.returncode: print(r.stderr); raise SystemExit('psql failed: ' + (sql or file)[:200])
    return r.stdout.strip()
def q1(sql): out = psql(sql); return out.splitlines()[-1] if out else ''

psql(file=os.path.join(HERE, 'fixture.sql'))
attr = open(os.path.join(ROOT, 'docs/acquisition-attribution.sql')).read()
a = attr.index('create or replace function public.classify_channel'); b = attr.index('end $$;', a) + len('end $$;')
fn = attr[a:b]
pre = '\n'.join(l for l in fn.split('\n') if "if c = 'shorts'" not in l)
psql(pre)
ok(q1("select public.classify_channel('bluesky','social','shorts',null,'/')") == 'bluesky_other_tagged', 'control: before the change, shorts is just "other tagged"')

# seed: today in Los Angeles is the window; ids are fixed so per-post credit is checkable
M1, M2, V1 = '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'
U1, U2, U3, U4, UI = ['aaaaaaaa-0000-4000-8000-00000000000' + c for c in '12349']
psql(f"""
insert into public.social_posts (id, status, content_family, zip, evidence, published_at) values
  ('{M1}', 'published', 'MAPS', '98402', '{{"theme":"datacenter"}}', now() - interval '1 hour'),
  ('{M2}', 'published', 'MAPS', '98403', '{{}}', now() - interval '2 hours'),
  (gen_random_uuid(), 'approved', 'MAPS', '98404', '{{}}', null),
  (gen_random_uuid(), 'published', 'MAPS', '98405', '{{}}', now() - interval '60 days');
insert into public.video_bluesky_jobs (id, slug, file_key, status, published_at) values ('{V1}', 'emerson', 'short1', 'published', now() - interval '3 hours'),
  (gen_random_uuid(), 'emerson', 'short2', 'scheduled', null);
""")
APPLY = os.path.join(ROOT, 'docs/bluesky-maps-vs-shorts.sql')
rc, out = psql(file=APPLY, may_fail=True)
ok(rc == 0, 'the file applies in one transaction' + ('' if rc == 0 else ': ' + out[-400:]))
rc2, out2 = psql(file=APPLY, may_fail=True)
ok(rc2 == 0 and q1("select count(*) from regexp_matches(pg_get_functiondef('public.classify_channel(text,text,text,text,text)'::regprocedure), 'bluesky_shorts', 'g')") == '1',
   'a second apply is a no-op (one shorts line, not two)')
ok(q1("select public.classify_channel('bluesky','social','shorts',null,'/')") == 'bluesky_shorts', 'utm_campaign=shorts -> bluesky_shorts')
ok(q1("select string_agg(public.classify_channel(s,m,c,h,l), ',') from (values ('bluesky','social','maps',null,'/'),('bluesky','social','pierce-zip',null,'/'),(null,null,null,'bsky.app','/x'),('saleshandy','email','x',null,'/')) v(s,m,c,h,l)")
   == 'bluesky_maps_auto,bluesky_pierce_auto,bluesky_untagged,saleshandy', 'every other channel is unchanged')

def touch(kind, sid, ch, content, internal=False, ago='30 minutes', vid=None):
    vid = vid or sid
    return f"('{kind}', '{sid}', '{vid}', '{ch}', {('null' if content is None else repr(content))}, {str(internal).lower()}, now() - interval '{ago}')"
V = lambda n: f'bbbbbbbb-0000-4000-8000-{n:012d}'
rows = [touch('visitor', V(1), 'bluesky_maps_auto', M1), touch('visitor', V(2), 'bluesky_maps_auto', M1), touch('visitor', V(3), 'bluesky_pierce_auto', M2),
        touch('visitor', V(4), 'bluesky_maps_auto', None), touch('visitor', V(5), 'bluesky_shorts', V1), touch('visitor', V(6), 'bluesky_shorts', V1),
        touch('visitor', V(7), 'bluesky_shorts', V1, internal=True), touch('visitor', V(8), 'bluesky_untagged', None),
        touch('visitor', V(9), 'google_organic', None), touch('visitor', V(10), 'bluesky_shorts', V1, ago='40 days'),
        touch('visitor', V(11), 'bluesky_shorts', 'impact-abc12345'), touch('visitor', V(12), 'bluesky_shorts', 'impact-abc12345'),
        touch('visitor', V(13), 'bluesky_maps_auto', 'impact-abc12345'),
        touch('account', U1, 'bluesky_maps_auto', M1, vid=V(1)), touch('account', U2, 'bluesky_shorts', V1, vid=V(5)),
        touch('account', U3, 'google_organic', None, vid=V(9)), touch('account', U4, 'bluesky_shorts', 'impact-abc12345', vid=V(11)), touch('account', UI, 'bluesky_shorts', V1, vid=V(6))]
psql("insert into public.acquisition_touch (subject_type, subject_id, visitor_id, channel, utm_content, is_internal, created_at) values " + ','.join(rows))
psql(f"""insert into public.analytics_exclusion values ('{UI}', 'admin');
insert into public.report_snapshot values ('cccccccc-0000-4000-8000-000000000001', now() - interval '10 minutes'), ('cccccccc-0000-4000-8000-000000000002', now() - interval '9 minutes');
insert into public.report_owner values ('cccccccc-0000-4000-8000-000000000001', '{U1}'), ('cccccccc-0000-4000-8000-000000000002', '{U3}');""")

rc, out = psql("select public.hs_bsky_maps_vs_shorts(30)", may_fail=True)
ok(rc != 0 and 'not authorized' in out, 'a caller who is not a dashboard admin is refused')
r = json.loads(q1("""set request.jwt.claims = '{"email":"founder@example.com"}'; select public.hs_bsky_maps_vs_shorts(30)"""))
m, s = r['summary']['maps'], r['summary']['shorts']
ok(m['posts'] == 2 and s['posts'] == 1, f"posts published in the period: MAPS {m['posts']}, Shorts {s['posts']} (approved/scheduled and older posts are not counted)")
ok(m['visitors'] == 5 and s['visitors'] == 4, f"visitors: MAPS {m['visitors']} (maps + pierce, untagged-content included), Shorts {s['visitors']} (internal and out-of-period excluded)")
ok(m['registrations'] == 1 and s['registrations'] == 2, f"registrations: MAPS {m['registrations']}, Shorts {s['registrations']} (an excluded admin does not count)")
ok(m['reports'] == 1 and s['reports'] == 0, f"reports follow the account's first touch (MAPS {m['reports']}, Shorts {s['reports']}; the Google account's report is neither)")
ok(m['visitors_per_post'] == 2.5 and s['visitors_per_post'] == 4.0 and m['registrations_per_100_visitors'] == 20.0, 'per-post and per-visitor rates')
pp = {p['post_id']: p for p in r['posts']}
ok(pp[M1]['visitors'] == 2 and pp[M1]['registrations'] == 1 and pp[M1]['reports'] == 1 and pp[M2]['visitors'] == 1 and pp[V1]['visitors'] == 2,
   'each post is credited only with the visits that carried its own id')
ok(pp[M1]['label'] == '98402 · data center' and pp[V1]['label'] == 'emerson · short1', 'posts are labelled by ZIP / project and item')
bc = r['shorts_by_content']
ok(bc.get('impact-abc12345') == {'visitors': 2, 'registrations': 1, 'reports': 0} and bc.get(V1, {}).get('visitors') == 2,
   'video visits per tag: a story tag from a post made by hand, and a queued job id (a MAPS visit with the same tag is not counted)')
ok(r['untagged_bluesky_visitors'] == 1, 'untagged Bluesky visitors are shown apart from both kinds')
ok(any('YouTube' in u for u in r['unavailable']), 'the output says YouTube traffic is not measured')
ri = json.loads(q1("""set request.jwt.claims = '{"email":"founder@example.com"}'; select public.hs_bsky_maps_vs_shorts(30, true)"""))
ok(ri['summary']['shorts']['visitors'] == 5 and ri['summary']['shorts']['registrations'] == 3, 'include_internal adds the internal visitor and the excluded account back')
rc, out = psql("""set request.jwt.claims = '{"email":"founder@example.com"}'; select public.hs_bsky_maps_vs_shorts(0)""", may_fail=True)
ok(rc != 0 and '1..400' in out, 'a bad period is refused')
ok(q1("select has_function_privilege('anon', 'public.hs_bsky_maps_vs_shorts(int,boolean)', 'execute')") == 'f', 'anon cannot execute the reader')
print(f'\n{checks - fails}/{checks} checks passed'); sys.exit(1 if fails else 0)
