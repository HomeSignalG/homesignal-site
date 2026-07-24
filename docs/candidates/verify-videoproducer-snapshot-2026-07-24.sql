-- Rollout verification: acquisition dashboard snapshot includes Video Producer tab.
-- Read-only. Safe to run once after ingest publish (tabs=11).
select
  slug,
  updated_at,
  payload->'meta'->>'snapshot' as snapshot,
  (select count(*)::int from jsonb_object_keys(payload->'tabs')) as tab_count,
  (select array_agg(k order by k) from jsonb_object_keys(payload->'tabs') as k) as tab_keys,
  length(payload->'tabs'->>'videoproducer') as videoproducer_bytes,
  (payload->'tabs'->>'videoproducer' ilike '%<script%') as videoproducer_has_script_tag,
  (length(payload->'tabs'->>'videoproducer') >= 6000) as videoproducer_meets_min_bytes,
  (payload->'tabs' ? 'exec')
    and (payload->'tabs' ? 'feed')
    and (payload->'tabs' ? 'projects')
    and (payload->'tabs' ? 'outreach')
    and (payload->'tabs' ? 'engagement')
    and (payload->'tabs' ? 'website')
    and (payload->'tabs' ? 'tags')
    and (payload->'tabs' ? 'alertperf')
    and (payload->'tabs' ? 'homeowners')
    and (payload->'tabs' ? 'acquisition')
    and (payload->'tabs' ? 'videoproducer') as all_required_tabs_present
from public.dashboard_snapshots
where slug = 'acquisition';
