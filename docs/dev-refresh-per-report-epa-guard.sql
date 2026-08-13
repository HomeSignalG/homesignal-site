-- PER-REPORT EPA HEALTH — close the last path by which an EPA failure becomes an
-- authoritative zero. (2026-08-13)
--
-- WHAT WAS STILL WRONG, after the 2026-08-09 and 2026-08-11 guards.
--   `dev_refresh_collect` decided whether a zero was trustworthy from `epa_ok`, a GLOBAL
--   two-point health probe (`public.epa_frs_probes`: sheridan-rural r=3, atlanta-dense r=1).
--   That is a PROXY for the question actually being asked, which is per-ZIP: "did EPA answer
--   for THIS report?" The proxy is wrong in the exact case FRS actually fails —
--   DENSITY-DEPENDENTLY. The process limit bites dense ZIPs and spares rural ones, so:
--
--     global probe says HEALTHY  +  this ZIP's FRS read failed  →  facilities:0 written with
--     facilities_unavailable = FALSE  →  a page that states "0 EPA facilities" as fact when
--     HomeSignal never got an answer.
--
--   Measured live 2026-08-13 while writing this: the two probe targets DISAGREED repeatedly
--   inside one hour (21:30 atlanta ok / sheridan "Failure when receiving data from the peer";
--   21:45 sheridan ok / atlanta HTTP 429). A single global boolean cannot describe that.
--
-- THE FIX. The engine (v23, sources/epa-frs.ts) now reports what happened for THIS request in
-- the report body as `epa.ok`. The guard reads it and ANDs it with the global probe:
--
--     effective health = epa_ok (global probe)  AND  j->'epa'->>'ok' (this report)
--
--   Either one saying "not ok" is enough to refuse an authoritative zero. Fail-closed in both
--   directions, and strictly MORE conservative than before — it can only ever protect more rows.
--
-- BACKWARD COMPATIBLE BY CONSTRUCTION. A payload with no `epa` key coalesces to TRUE, so until
-- the engine deploys, behaviour is byte-identical to today's (global probe only). No flag day.
--
-- WHAT THIS DOES NOT DO. It does not turn every zero into an error. `epa.ok` describes
-- RETRIEVAL only: EPA answering with rows that `looksIndustrial()` then drops is still ok:true
-- and still caches as a legitimate 0 (St. Louis 63118 is the live example). Genuinely empty
-- rural ZIPs keep working exactly as they do now.
--
-- APPLIED AS AN ANCHORED PATCH, not a retyped function body. The live definition is read with
-- pg_get_functiondef, each anchor must appear EXACTLY ONCE verbatim, and the script raises
-- rather than patch blind. Retyping the body by hand is how a migration silently drops a clause.

do $mig$
declare
  src text;
  anchor text;
  repl text;
  hits int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'dev_refresh_collect' and n.nspname = 'public';
  if src is null then
    raise exception 'public.dev_refresh_collect() not found — refusing to patch nothing';
  end if;

  -- Idempotence: if the per-report term is already present, this migration has run.
  if position($chk$j->'epa'$chk$ in src) > 0 then
    raise notice 'per-report EPA guard already applied — no change';
    return;
  end if;

  ------------------------------------------------------------------------------------------
  -- (1) the FLAG. Which zeros are honest ("0 facilities") vs unknown ("—, unavailable").
  ------------------------------------------------------------------------------------------
  anchor := $a$when not epa_ok then true$a$;
  hits := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if hits <> 1 then
    raise exception 'flag anchor found % times (expected exactly 1) — refusing to patch blind', hits;
  end if;
  repl := $r$when not (epa_ok and coalesce((j->'epa'->>'ok')::boolean, true)) then true$r$;
  src := replace(src, anchor, repl);

  ------------------------------------------------------------------------------------------
  -- (2) the REFUSAL. Never overwrite a row that HAS facilities with a zero we do not trust.
  --     This is the last-known-good preservation clause.
  ------------------------------------------------------------------------------------------
  anchor := $a$(not epa_ok or d.refreshed_at >= now() - interval '7 days')$a$;
  hits := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if hits <> 1 then
    raise exception 'refusal anchor found % times (expected exactly 1) — refusing to patch blind', hits;
  end if;
  repl := $r$(not (epa_ok and coalesce((j->'epa'->>'ok')::boolean, true)) or d.refreshed_at >= now() - interval '7 days')$r$;
  src := replace(src, anchor, repl);

  execute src;
  raise notice 'per-report EPA guard applied to public.dev_refresh_collect()';
end
$mig$;

-- ── VERIFY (run after applying; both must be true) ────────────────────────────────────────
-- select
--   position($$j->'epa'$$ in pg_get_functiondef(oid)) > 0            as reads_per_report_epa,
--   (length(pg_get_functiondef(oid))
--    - length(replace(pg_get_functiondef(oid), $$j->'epa'$$, ''))) / length($$j->'epa'$$) = 2
--                                                                   as both_sites_patched
-- from pg_proc where proname = 'dev_refresh_collect';
