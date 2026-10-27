#!/usr/bin/env python3
"""docs/youtube-engagement.sql on a disposable Postgres: the count tables, the 'youtube' channel splice and the
hs_youtube_engagement reader, against seeded rows whose right answer is known. Talks only to the database named by PG*
variables. stdlib only."""
import json, os, subprocess
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
CH = lambda *a: q1("select public.classify_channel(%s)" % ','.join('null' if x is None else "'%s'" % x for x in a))

psql(file=os.path.join(HERE, 'fixture.sql'))
attr = open(os.path.join(ROOT, 'docs/acquisition-attribution.sql')).read()
a = attr.index('create or replace function public.classify_channel'); b = attr.index('end $$;', a) + len('end $$;')
fn = attr[a:b]
ok(fn.count('youtube') >= 3, 'the cumulative record carries the youtube lines (the same ones this file splices)')
pre = '\n'.join(l for l in fn.split('\n') if 'youtube' not in l)
psql(pre)
ok(CH('youtube', 'video', None, None, '/') == 'other_tagged' and CH(None, None, None, 'www.youtube.com', '/') == 'other_referral',
   'control: before the change, YouTube is "other tagged" / "other referral"')

APPLY = os.path.join(ROOT, 'docs/youtube-engagement.sql')
rc, out = psql(file=APPLY, may_fail=True)
ok(rc == 0, 'the file applies in one transaction' + ('' if rc == 0 else ': ' + out[-400:]))
rc2, out2 = psql(file=APPLY, may_fail=True)
ok(rc2 == 0 and q1("select count(*) from regexp_matches(pg_get_functiondef('public.classify_channel(text,text,text,text,text)'::regprocedure), 'return ''youtube''', 'g')") == '2',
   'a second apply is a no-op (two youtube lines, not four)')
live = q1("select pg_get_functiondef('public.classify_channel(text,text,text,text,text)'::regprocedure)")
psql("drop function public.classify_channel(text,text,text,text,text)"); psql(fn)
ok(all(CH(*v) == e for v, e in [(('youtube', 'video', None, None, '/'), 'youtube'), ((None, None, None, 'www.youtube.com', '/'), 'youtube')]),
   'the cumulative record (docs/acquisition-attribution.sql) gives the same answers as the splice')
psql("drop function public.classify_channel(text,text,text,text,text)"); psql(pre); psql(file=APPLY)
cases = [(('youtube', 'video', 'impact-x', None, '/'), 'youtube'), ((None, None, None, 'www.youtube.com', '/x'), 'youtube'),
         ((None, None, None, 'm.youtube.com', '/'), 'youtube'), ((None, None, None, 'youtu.be', '/'), 'youtube'),
         ((None, None, None, 'notyoutube.com', '/'), 'other_referral'), ((None, None, None, 'youtube.com.evil.example', '/'), 'other_referral'),
         (('bluesky', 'social', 'shorts', None, '/'), 'bluesky_shorts'), ((None, None, None, 'bsky.app', '/'), 'bluesky_untagged'),
         (('saleshandy', 'email', 'x', None, '/'), 'saleshandy'), ((None, None, None, None, '/'), 'direct')]
bad = [(v, CH(*v), e) for v, e in cases if CH(*v) != e]
ok(not bad, 'YouTube links and referrers -> youtube; look-alike hosts and every other channel unchanged' + ('' if not bad else ': %s' % bad))

ok(q1("select relrowsecurity from pg_class where relname='youtube_video_metrics'") == 't'
   and q1("select relrowsecurity from pg_class where relname='youtube_channel_metrics'") == 't', 'both count tables have row security on')
ok(q1("select has_table_privilege('anon','public.youtube_video_metrics','select') or has_table_privilege('authenticated','public.youtube_channel_metrics','select')") == 'f',
   'visitors and signed-in users cannot read the count tables')
rc, out = psql("insert into public.youtube_video_metrics (video_id, views) values ('x', -1)", may_fail=True)
ok(rc != 0, 'a negative count is refused')

# seed: three public videos and one private; counts read before and inside the 30-day period
psql("""
insert into public.youtube_channel_videos values
  ('MAIN_OLD', 'https://www.youtube.com/watch?v=MAIN_OLD', 'Old main video', 'public', 'processed', now() - interval '60 days', 330),
  ('SHORT_NEW', 'https://www.youtube.com/watch?v=SHORT_NEW', 'New short', 'public', 'processed', now() - interval '2 days', 40),
  ('MAIN_NOBASE', 'https://www.youtube.com/watch?v=MAIN_NOBASE', 'Main, counted only recently', 'public', 'processed', now() - interval '45 days', 400),
  ('PRIVATE1', null, 'Scheduled', 'private', 'processed', null, 50);
insert into public.youtube_video_metrics (video_id, captured_at, views, likes, comments) values
  ('MAIN_OLD', now() - interval '30 days', 100, 4, 1), ('MAIN_OLD', now() - interval '45 days', 10, 0, 0), ('MAIN_OLD', now() - interval '1 hour', 160, 9, 3),
  ('SHORT_NEW', now() - interval '1 day', 20, 2, 0), ('SHORT_NEW', now() - interval '1 hour', 55, null, 0),
  ('MAIN_NOBASE', now() - interval '1 hour', 70, 3, 1);
insert into public.youtube_channel_metrics (captured_at, subscribers, views, videos) values
  (now() - interval '30 days', 10, 200, 2), (now() - interval '45 days', 1, 5, 1), (now() - interval '1 hour', 37, 285, 14);
""")
V = lambda n: f'bbbbbbbb-0000-4000-8000-{n:012d}'
U1, U2, UI = 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000009'
def touch(kind, sid, ch, content, internal=False, ago='30 minutes', vid=None):
    return f"('{kind}', '{sid}', '{vid or sid}', '{ch}', {('null' if content is None else repr(content))}, {str(internal).lower()}, now() - interval '{ago}')"
rows = [touch('visitor', V(1), 'youtube', None), touch('visitor', V(2), 'youtube', 'SHORT_NEW'), touch('visitor', V(3), 'youtube', 'SHORT_NEW'),
        touch('visitor', V(4), 'youtube', None, internal=True), touch('visitor', V(5), 'youtube', None, ago='40 days'),
        touch('visitor', V(6), 'bluesky_shorts', 'SHORT_NEW'),
        touch('account', U1, 'youtube', 'SHORT_NEW', vid=V(2)), touch('account', U2, 'google_organic', None, vid=V(6)),
        touch('account', UI, 'youtube', None, vid=V(1))]
psql("insert into public.acquisition_touch (subject_type, subject_id, visitor_id, channel, utm_content, is_internal, created_at) values " + ','.join(rows))
psql(f"""insert into public.analytics_exclusion values ('{UI}', 'admin');
insert into public.report_snapshot values ('cccccccc-0000-4000-8000-000000000001', now() - interval '10 minutes'), ('cccccccc-0000-4000-8000-000000000002', now() - interval '9 minutes');
insert into public.report_owner values ('cccccccc-0000-4000-8000-000000000001', '{U1}'), ('cccccccc-0000-4000-8000-000000000002', '{U2}');""")

rc, out = psql("select public.hs_youtube_engagement(30)", may_fail=True)
ok(rc != 0 and 'not authorized' in out, 'a caller who is not a dashboard admin is refused')
ok(q1("select has_function_privilege('anon','public.hs_youtube_engagement(int,boolean)','execute')") == 'f', 'anon cannot run the reader')
r = json.loads(q1("""set request.jwt.claims = '{"email":"founder@example.com"}'; select public.hs_youtube_engagement(30)"""))
c, s = r['channel'], r['summary']
ok(c['subscribers'] == 37 and c['views'] == 285 and c['subscribers_in_period'] == 27 and c['views_in_period'] == 85,
   f"channel: latest counts and the change since the period started ({c['subscribers']} subs, +{c['subscribers_in_period']})")
ok(s['videos'] == 3 and s['mains'] == 2 and s['shorts'] == 1 and s['published_in_period'] == 1,
   'public videos only; a Short is 3 minutes or less; one published in the period')
vv = {v['video_id']: v for v in r['videos']}
ok(vv['MAIN_OLD']['views'] == 160 and vv['MAIN_OLD']['views_in_period'] == 60 and vv['MAIN_OLD']['kind'] == 'main',
   'views in the period = latest minus the last read just before the period (an older read is not the baseline)')
ok(vv['SHORT_NEW']['views_in_period'] == 55 and vv['SHORT_NEW']['likes'] is None and vv['SHORT_NEW']['kind'] == 'short',
   'a video published inside the period starts from 0; a hidden like count stays null')
ok(vv['MAIN_NOBASE']['views'] == 70 and vv['MAIN_NOBASE']['views_in_period'] is None,
   'with no reading from before the period, "in this period" is unknown (null), never a guess')
ok('PRIVATE1' not in vv, 'a private (scheduled) video is not listed')
ok(s['visitors'] == 3 and s['registrations'] == 1 and s['reports'] == 1 and s['visitors_with_video_tag'] == 2,
   f"YouTube visits: {s['visitors']} visitors (internal and out-of-period excluded), {s['registrations']} registration (an excluded admin does not count), {s['reports']} report")
ok(vv['SHORT_NEW']['visitors'] == 2 and vv['MAIN_OLD']['visitors'] == 0, 'a tagged visit is credited to its video; a Bluesky visit with the same tag is not')
ok(any('Watch time' in u for u in r['unavailable']), 'it says what is not measured (watch time, impressions, traffic sources)')
r7 = json.loads(q1("""set request.jwt.claims = '{"email":"founder@example.com"}'; select public.hs_youtube_engagement(7)"""))
ok(r7['channel']['views_in_period'] is None and r7['videos'] and {v['video_id']: v for v in r7['videos']}['MAIN_OLD']['views_in_period'] is None,
   'a 7-day period with no reading from its start: in-period counts are unknown, not the all-time count')

print(f'\n{checks - fails}/{checks} passed')
raise SystemExit(1 if fails else 0)
