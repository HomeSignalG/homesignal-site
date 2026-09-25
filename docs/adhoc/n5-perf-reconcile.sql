set statement_timeout='110s';
explain (analyze, timing off, summary on)
with chunks as (select array_agg(z3::text) a from geo.n5_shard where generation_id='legacy-phase1-2026-09-01'),
ch as (select distinct k, length(k) len from chunks, unnest(chunks.a) k),
e as (select distinct x.source_key, x.zip from public.n5_expected_captured('phase1-2026-09-01') x),
keys as (select c.k chunk_key, e.source_key from e join ch c on c.len = 3 and c.k = left(e.zip, 3)),
res as (select distinct m.source_key from geo.zip_authoritative_membership m
         where m.generation_id='legacy-phase1-2026-09-01' and m.record_kind='development')
select c.k, count(k.source_key), count(k.source_key) filter (where rs.source_key is not null)
  from ch c left join keys k on k.chunk_key = c.k left join res rs on rs.source_key = k.source_key
 group by c.k;
