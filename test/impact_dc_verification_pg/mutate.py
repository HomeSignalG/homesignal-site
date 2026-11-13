#!/usr/bin/env python3
"""Prohibited regressions of docs/impact-dc-verification.sql. Each must make test/impact_dc_verification_pg/suite.sql fail.
Usage: mutate.py --list | mutate.py <name> <sql file>   (prints the mutated SQL; exit 2 when the anchor is missing)."""
import sys
M = {
  'topic_fires_on_score': ("if found and old_fp is not distinct from fp then", "if false then"),
  'document_trigger_noop': ("for r in select candidate_id from public.impact_dc_verification where result_project_key = pk loop",
                            "for r in select candidate_id from public.impact_dc_verification where false loop"),
  'detector_ignores_status': ("if now_f is distinct from r.result_facts then",
                              "if now_f->>'map_key' is distinct from r.result_facts->>'map_key' or now_f->>'state' <> 'found' or now_f->>'zip' is distinct from r.result_facts->>'zip' then"),
  'stale_ignores_invalidation': ("when v.invalidated_at is not null and v.invalidated_at >= v.last_success_run_started_at",
                                 "when false"),
  'link_ignores_staleness': ("'link_available', v.result is not null and cardinality(s.reasons) = 0 and",
                             "'link_available', v.result is not null and"),
  'reply_ignores_staleness': ("'reply_ready', v.result is not null and cardinality(s.reasons) = 0 and",
                              "'reply_ready', v.result is not null and"),
  'claim_running_twice': ("where v.status = 'queued' and v.next_attempt_at <= now()",
                          "where v.status in ('queued','running') and v.next_attempt_at <= now()"),
  'no_backoff': ("select case when p_attempts <= 1 then interval '5 minutes' else interval '30 minutes' end",
                 "select interval '0 minutes'"),
  'never_gives_up': ("when v.attempts + 1 >= 3 then 'gave_up'", "when v.attempts + 1 >= 99 then 'gave_up'"),
  'enqueue_restarts_running': ("  if v.status = 'running' then\n", "  if false then\n"),
  'rejected_not_retired': ("where candidate_id = new.id and status in ('queued', 'gave_up', 'done');",
                           "where false;"),
  'tick_dispatch_every_time': ("where dispatched_at > now() - interval '10 minutes'", "where false"),
  'max_age_ignored': ("select interval '48 hours'", "select interval '4800 hours'"),
  'failure_drops_result': ("set attempts = v.attempts + 1, last_error = p_error,",
                           "set attempts = v.attempts + 1, last_error = p_error, result = null,"),
  'state_points_any_class': ("       and e.superseded_by is null and e.classification = 'CONFIRMED_DC'\n      cross join lateral",
                             "       and e.superseded_by is null\n      cross join lateral"),
  'state_points_unresolved': ("     where ge.geography_status = 'RESOLVED' and ge.geometry_type = 'POINT' and z.zc in",
                              "     where ge.geometry_type = 'POINT' and z.zc in"),
  'state_points_any_state': ("             where z.level = 'zip' and upper(z.state) in (select s from st) and zc ~ '^[0-9]{5}$'),\n  -- each point",
                             "             where z.level = 'zip' and zc ~ '^[0-9]{5}$'),\n  -- each point"),
  'places_ignore_text': ("    when p_place ~ '^\\s*[^,]+,\\s*[A-Za-z]{2}\\s*$' then", "    when false then"),
  'zips_ignore_county_suffix': ("lower(regexp_replace(q.co, '\\s+(county|parish|borough|census area)$', '', 'i'))",
                                "lower(q.co)"),
  'reply_edit_no_link_flag': ("'link_changed', e.link_at_save is distinct from (v.result->'link'->>'url'),", "'link_changed', false,"),
  'reply_edits_mutable': ("  for each row execute function public.impact_dc_reply_edits_frozen();", "  for each row when (false) execute function public.impact_dc_reply_edits_frozen();"),
  'reply_save_no_admin': ("who text := public._hs_is_admin(); t text", "who text := 'anyone'; t text"),
}
if sys.argv[1] == '--list':
    print('\n'.join(M)); sys.exit(0)
a, b = M[sys.argv[1]]
s = open(sys.argv[2]).read()
if s.count(a) != 1: sys.exit(2)
print(s.replace(a, b))
