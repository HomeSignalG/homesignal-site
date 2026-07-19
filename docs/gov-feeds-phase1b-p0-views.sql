-- Phase 1B P0 — operational views (DOCS ONLY — do not auto-apply).

create or replace view public.v_feed_candidates_funnel as
select
  state,
  count(*) as candidate_count,
  min(state_entered_at) as oldest_entered,
  max(state_entered_at) as newest_entered
from public.feed_candidates
group by state
order by candidate_count desc;

comment on view public.v_feed_candidates_funnel is
  'Funnel counts by feed_candidates.state for operator dashboards.';

create or replace view public.v_feed_candidates_stuck as
select
  feed_id,
  community_id,
  state,
  status_reason,
  state_entered_at,
  now() - state_entered_at as time_in_state,
  blocked_by
from public.feed_candidates
where state not in ('active', 'superseded', 'abandoned')
  and state_entered_at < now() - interval '3 days'
order by state_entered_at asc;

comment on view public.v_feed_candidates_stuck is
  'Candidates in non-terminal states longer than 3 days.';

create or replace view public.v_active_meetings_feeds as
select
  f.feed_id,
  f.community_id,
  f.county,
  f.source,
  f.updated_at,
  c.state as candidate_state,
  c.title_verified_at
from public.feeds f
left join public.feed_candidates c on c.feed_id = f.feed_id
where f.active = true
  and f.target_table = 'meetings'
order by f.county, f.feed_id;

comment on view public.v_active_meetings_feeds is
  'Active meetings feeds with optional candidate registry join.';
