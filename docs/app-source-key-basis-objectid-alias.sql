-- PARKED. NOT APPLIED. Production apply needs founder approval (docs/denton-workstream-b-2026-10-14.md section 5, approval A2).
--
-- public.app_source_key_basis: record that a source_key carries a compound-identity alias (<id>#<OBJECTID>) written by
-- the arcgis connector's identity_aliases_file option (sources/identity-aliases.ts). Without this, an alias key ends in
-- '#<digits>', matches no earlier branch, and is audited as 'source_id:other' - the provenance of the key would be lost.
--
-- WHAT CHANGES: one new WHEN branch, inserted between 'source_id:case_number' and 'source_id:row_id'. Nothing else. app_source_key
-- (the key itself) is NOT touched: it adopts source_id verbatim, so alias keys flow through unchanged. No column, no data, no DDL on tables.
-- WHO READS THE BASIS: scripts/n5_shard.py (UNRECOVERABLE_BASES = row_id, title(MUTABLE)); the new value is in neither list, i.e. an alias
-- key is RECOVERABLE (fetchable by identity), which is exactly right - scripts/n5_shard.py routes it through the same alias file.
--
-- SPLICED FROM THE LIVE BODY (claims rule 7), never retyped. Fail-closed on every precondition:
--   * the live body must fingerprint to the value READ 2026-10-14 (md5(prosrc) d1c77344bb482e18a49dfaefe208b013, 753 chars; the
--     body is committed as test/fixtures/identity-aliases/app_source_key_basis.live-2026-10-14.txt and its md5 is asserted equal);
--   * the anchor must occur EXACTLY ONCE;
--   * after the splice, excising the inserted text must reproduce the original md5 (one contiguous insertion, zero collateral).
-- Idempotent: if the branch is already present the file does nothing. Reversible: re-run the excision (rollback at the foot).
-- Function attributes (language sql, immutable, owner, grants) are carried by pg_get_functiondef and read back after.
--
-- The three literals below are what test/identity-alias-basis-sql.test.mjs extracts and proves against the committed live body.
do $splice$
declare
  v_anchor constant text := $a$        when btrim(el->>'source_id') ~ ':[0-9]+$'                             then 'source_id:row_id'$a$;
  v_insert constant text := $i$        when nullif(btrim(el->>'case_number'),'') is not null
             and btrim(el->>'source_id') like '%:'||btrim(el->>'case_number')||'#%' then 'source_id:case_number+objectid_alias'
$i$;
  v_md5_before constant text := 'd1c77344bb482e18a49dfaefe208b013';
  v_oid oid := 'public.app_source_key_basis(jsonb)'::regprocedure;
  v_src text;
  v_def text;
  v_new text;
  v_after text;
  v_acl_before text;
begin
  select prosrc into v_src from pg_proc where oid = v_oid;
  if position('objectid_alias' in v_src) > 0 then
    raise notice 'app_source_key_basis already carries the alias branch; nothing to do';
    return;
  end if;
  if md5(v_src) <> v_md5_before then
    raise exception 'DRIFT: live app_source_key_basis md5 % <> expected %; refusing to splice a body this file was not written against',
      md5(v_src), v_md5_before;
  end if;
  if (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'ANCHOR: the row_id branch does not occur exactly once in the live body';
  end if;
  select proacl::text into v_acl_before from pg_proc where oid = v_oid;
  v_def := pg_get_functiondef(v_oid);
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'ANCHOR: the row_id branch does not occur exactly once in the function definition';
  end if;
  v_new := replace(v_def, v_anchor, v_insert || v_anchor);
  execute v_new;
  select prosrc into v_after from pg_proc where oid = v_oid;
  if md5(replace(v_after, v_insert, '')) <> v_md5_before then
    raise exception 'SPLICE: excising the inserted branch does not reproduce the original body (md5 % <> %)',
      md5(replace(v_after, v_insert, '')), v_md5_before;
  end if;
  if (select proacl::text from pg_proc where oid = v_oid) is distinct from v_acl_before then
    raise exception 'GRANTS: privileges changed by the replace';
  end if;
  if public.app_source_key_basis('{"source_id":"arcgis:r:P1#12","case_number":"P1"}'::jsonb) <> 'source_id:case_number+objectid_alias' then
    raise exception 'BEHAVIOUR: an alias key is not classified as objectid_alias';
  end if;
  if public.app_source_key_basis('{"source_id":"arcgis:r:P1","case_number":"P1"}'::jsonb) <> 'source_id:case_number'
     or public.app_source_key_basis('{"source_id":"arcgis:r:77"}'::jsonb) <> 'source_id:row_id' then
    raise exception 'BEHAVIOUR: an existing classification changed';
  end if;
end
$splice$;

-- ROLLBACK: execute replace(pg_get_functiondef('public.app_source_key_basis(jsonb)'::regprocedure), <v_insert above>, '') and then assert
-- md5(prosrc) = 'd1c77344bb482e18a49dfaefe208b013'. The splice above already proves that excision reproduces the original byte for byte, so the
-- rollback is exact. Alias keys already stored simply read back as 'source_id:other' again (a label, not data).
