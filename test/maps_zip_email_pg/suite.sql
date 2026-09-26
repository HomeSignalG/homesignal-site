-- Executable checks for the "What is changing in my zip code?" email stream, run by
-- run.sh against a DISPOSABLE database after fixture.sql + the shipped migration(s).
-- Output: one line per check, "Mnn|what it proves|t" (t = holds, f = broken).
-- Delivery checks (D*) run only when run.sh applied the ingest delivery migration.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create temp table _r (id text primary key, label text not null, ok boolean not null);

-- Who the suite is, for the consent writer's JWT check.
set request.jwt.claims = '{"email":"resident@example.com"}';

-- ------------------------------------------------------------- the vocabulary
insert into _r select 'M01', 'the catalog carries exactly one active maps topic, in the founder''s words',
  (select count(*) = 1 and bool_and(active) and min(topic) = 'What is changing in my zip code?'
     from public.alert_topic_catalog where stream = 'maps');

do $$ begin
  begin
    insert into public.user_subscriptions (user_id, community_id, topic, stream, origin)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000c001',
            'County Commission & county business', 'bogus', 'explicit');
    insert into _r values ('M02', 'an unknown stream is still refused on user_subscriptions', false);
  exception when check_violation or foreign_key_violation then
    insert into _r values ('M02', 'an unknown stream is still refused on user_subscriptions', true);
  end;
end $$;

-- --------------------------------------------------------------- the sign-up
-- The Map 1 tap: the ZIP community, one maps topic, alert consent only, the Bluesky referral.
select public.enable_area_email_alerts(
  p_email => 'resident@example.com',
  p_community_id => '00000000-0000-0000-0000-0000000097a2',
  p_zip_code => '97702',
  p_topics => '{"maps":["What is changing in my zip code?"]}'::jsonb,
  p_consent_version => '2026-09-25',
  p_marketing_consent_copy => 'We''ll email you when HomeSignal posts about what''s changing in this ZIP code. No spam · Unsubscribe anytime.',
  p_marketing_consent => false,
  p_referral_source => 'bluesky',
  p_referral_campaign => 'maps') \gset maps_

insert into _r select 'M03', 'the tap files a NEW identity on the ZIP community, alert consent on, marketing OFF',
  exists (select 1 from public.users u
           where u.email = 'resident@example.com'
             and u.community_id = '00000000-0000-0000-0000-0000000097a2'
             and u.zip_code = '97702'
             and u.alert_email_consent and not u.unsubscribed
             and not u.marketing_consent and u.marketing_consent_at is null
             and u.marketing_consent_copy is null
             and u.alert_email_consent_copy like 'We''ll email you when HomeSignal posts%');

insert into _r select 'M04', 'the Bluesky first touch is recorded on the new identity',
  exists (select 1 from public.users u
           where u.community_id = '00000000-0000-0000-0000-0000000097a2'
             and u.referral_source = 'bluesky' and u.referral_campaign = 'maps');

insert into _r select 'M05', 'the maps selection is explicit, and its generated pipeline_type is maps (not NULL)',
  exists (select 1 from public.user_subscriptions s
           join public.users u on u.id = s.user_id
          where u.community_id = '00000000-0000-0000-0000-0000000097a2'
            and s.stream = 'maps' and s.origin = 'explicit'
            and s.topic = 'What is changing in my zip code?' and s.pipeline_type = 'maps');

insert into _r select 'M06', 'the resident''s COUNTY identity is untouched: marketing kept, notices kept, no maps row there',
  (select u.marketing_consent and u.alert_email_consent
     from public.users u where u.id = '00000000-0000-0000-0000-0000000000a1')
  and (select count(*) from public.user_subscriptions s
        where s.user_id = '00000000-0000-0000-0000-0000000000a1' and s.stream = 'notices') = 1
  and not exists (select 1 from public.user_subscriptions s
                   where s.user_id = '00000000-0000-0000-0000-0000000000a1' and s.stream = 'maps');

insert into _r select 'M07', 'delivery sees it: digest_recipients carries the ZIP identity with topics {"maps":[...]}',
  exists (select 1 from public.digest_recipients d
           where d.community_id = '00000000-0000-0000-0000-0000000097a2'
             and d.topics = '{"maps":["What is changing in my zip code?"]}'::jsonb);

insert into _r select 'M08', 'no marketing consent was logged for the maps tap (contract F: alert consent is separate)',
  not exists (select 1 from public.consent_log l
               join public.users u on u.id = l.user_id
              where u.community_id = '00000000-0000-0000-0000-0000000097a2'
                and l.consent_type = 'email_marketing');

-- A maps pick on a COUNTY can never be matched to a post: refused, not stored.
do $$ begin
  begin
    perform public.enable_area_email_alerts(
      p_email => 'resident@example.com',
      p_community_id => '00000000-0000-0000-0000-00000000c001',
      p_zip_code => '97702',
      p_topics => '{"maps":["What is changing in my zip code?"]}'::jsonb,
      p_consent_version => '2026-09-25', p_marketing_consent_copy => 'x',
      p_marketing_consent => false);
    insert into _r values ('M09', 'a maps selection on a county community is REFUSED', false);
  exception when check_violation then
    insert into _r values ('M09', 'a maps selection on a county community is REFUSED', true);
  end;
end $$;

-- A second ZIP for the same email is its OWN identity: the county grain's
-- one-zip_code-per-county overwrite cannot reach it.
select public.enable_area_email_alerts(
  p_email => 'resident@example.com',
  p_community_id => '00000000-0000-0000-0000-0000000097a1',
  p_zip_code => '97701',
  p_topics => '{"maps":["What is changing in my zip code?"]}'::jsonb,
  p_consent_version => '2026-09-25', p_marketing_consent_copy => 'x',
  p_marketing_consent => false,
  p_referral_source => 'google', p_referral_campaign => 'other') \gset second_

insert into _r select 'M10', 'two ZIPs for one email are two identities, each keeping its own ZIP',
  (select count(*) from public.users u
    where u.email = 'resident@example.com'
      and u.community_id in ('00000000-0000-0000-0000-0000000097a2','00000000-0000-0000-0000-0000000097a1')) = 2
  and exists (select 1 from public.users where community_id = '00000000-0000-0000-0000-0000000097a2' and zip_code = '97702')
  and exists (select 1 from public.users where community_id = '00000000-0000-0000-0000-0000000097a1' and zip_code = '97701');

-- Tapping again is idempotent and additive: nothing is deleted, the first touch stays.
select public.enable_area_email_alerts(
  p_email => 'resident@example.com',
  p_community_id => '00000000-0000-0000-0000-0000000097a2',
  p_zip_code => '97702',
  p_topics => '{"maps":["What is changing in my zip code?"]}'::jsonb,
  p_consent_version => '2026-09-25', p_marketing_consent_copy => 'x',
  p_marketing_consent => false,
  p_referral_source => 'google', p_referral_campaign => 'other') \gset again_

insert into _r select 'M11', 'a repeat tap is idempotent: one maps row, first-touch referral kept',
  (select count(*) from public.user_subscriptions s
    join public.users u on u.id = s.user_id
   where u.community_id = '00000000-0000-0000-0000-0000000097a2' and s.stream = 'maps') = 1
  and exists (select 1 from public.users u
               where u.community_id = '00000000-0000-0000-0000-0000000097a2'
                 and u.referral_source = 'bluesky' and u.referral_campaign = 'maps');

-- A false tap on an identity that ALREADY has marketing consent must not revoke it.
select public.enable_area_email_alerts(
  p_email => 'resident@example.com',
  p_community_id => '00000000-0000-0000-0000-00000000c001',
  p_zip_code => '97702',
  p_topics => '{"notices":["County Commission & county business"]}'::jsonb,
  p_consent_version => '2026-09-25', p_marketing_consent_copy => 'x',
  p_marketing_consent => false) \gset keep_

insert into _r select 'M12', 'p_marketing_consent=false never REVOKES marketing consent already given',
  (select marketing_consent and marketing_consent_copy = 'alerts copy'
     from public.users where id = '00000000-0000-0000-0000-0000000000a1');

insert into _r select 'M12b', 'the writer stays ADDITIVE: a notices-only tap leaves the meetings selection in place',
  exists (select 1 from public.user_subscriptions
           where user_id = '00000000-0000-0000-0000-0000000000a1'
             and stream = 'meetings' and origin = 'explicit');

-- Existing callers (six named arguments) are unchanged: marketing consent is granted.
set request.jwt.claims = '{"email":"other@example.com"}';
select public.enable_area_email_alerts(
  p_email => 'other@example.com',
  p_community_id => '00000000-0000-0000-0000-00000000c001',
  p_zip_code => '97701',
  p_topics => '{"notices":["County Commission & county business"]}'::jsonb,
  p_consent_version => '2026-07-16',
  p_marketing_consent_copy => 'Email me new development & hearing alerts for this ZIP.') \gset legacy_

insert into _r select 'M13', 'an existing six-argument call still grants marketing consent (default unchanged)',
  exists (select 1 from public.users where email = 'other@example.com'
           and marketing_consent and marketing_consent_at is not null
           and marketing_consent_copy = 'Email me new development & hearing alerts for this ZIP.')
  and exists (select 1 from public.consent_log where email = 'other@example.com'
               and consent_type = 'email_marketing' and agreed);

-- The caller must be who they say they are.
reset request.jwt.claims;
do $$ begin
  begin
    perform public.enable_area_email_alerts(
      p_email => 'resident@example.com',
      p_community_id => '00000000-0000-0000-0000-0000000097a2', p_zip_code => '97702',
      p_topics => '{"maps":["What is changing in my zip code?"]}'::jsonb,
      p_consent_version => 'v', p_marketing_consent_copy => 'x', p_marketing_consent => false);
    insert into _r values ('M14', 'an unauthenticated call is refused', false);
  exception when others then
    insert into _r values ('M14', 'an unauthenticated call is refused',
                           sqlerrm like '%authenticated session%');
  end;
end $$;

-- ------------------------------------------------------------ the signature
insert into _r select 'M15', 'the old six-argument signature is gone (no ambiguous overload for PostgREST)',
  to_regprocedure('public.enable_area_email_alerts(text,uuid,text,jsonb,text,text)') is null
  and to_regprocedure('public.enable_area_email_alerts(text,uuid,text,jsonb,text,text,boolean,text,text)') is not null;

insert into _r select 'M16', 'the new signature is executable by authenticated (the Map 1 caller)',
  has_function_privilege('authenticated',
    'public.enable_area_email_alerts(text,uuid,text,jsonb,text,text,boolean,text,text)', 'EXECUTE');

-- ------------------------------------------------------------ the integrity view
insert into _r select 'M17', 'alert_subscription_integrity reports the maps ZIP-scope guard (=1)',
  (select maps_zip_scope_trigger = 1 from public.alert_subscription_integrity);

insert into _r select 'M18', 'the view kept its earlier columns and its security_invoker option',
  (select event_key_columns_declared = 2 and consent_requires_subscription_triggers = 2
     from public.alert_subscription_integrity)
  and exists (select 1 from pg_class
               where oid = 'public.alert_subscription_integrity'::regclass
                 and reloptions @> array['security_invoker=true']);

-- ------------------------------------------------------------ delivery half
select to_regprocedure('public.alert_confirmation_claim(uuid)') is not null
   and exists (select 1 from pg_proc p
                where p.oid = 'public.alert_confirmation_claim(uuid)'::regprocedure
                  and 'streams' = any (p.proargnames)) as delivery_applied \gset

\if :delivery_applied
  do $$ begin
    begin
      insert into public.email_deliveries (user_id, item_type, item_id)
      values ('00000000-0000-0000-0000-0000000000a1', 'social_post', gen_random_uuid());
      insert into _r values ('D01', 'the delivery ledger accepts a social_post item', true);
    exception when check_violation then
      insert into _r values ('D01', 'the delivery ledger accepts a social_post item', false);
    end;
    begin
      insert into public.email_deliveries (user_id, item_type, item_id)
      values ('00000000-0000-0000-0000-0000000000a1', 'bogus', gen_random_uuid());
      insert into _r values ('D02', 'the delivery ledger still refuses an unknown item type', false);
    exception when check_violation then
      insert into _r values ('D02', 'the delivery ledger still refuses an unknown item type', true);
    end;
  end $$;

  insert into public.alert_confirmations (id, user_id, epoch, community_id, zip_code)
  select '00000000-0000-0000-0000-0000000c0f01', u.id, 1, u.community_id, u.zip_code
    from public.users u where u.community_id = '00000000-0000-0000-0000-0000000097a2';
  insert into public.alert_confirmations (id, user_id, epoch, community_id, zip_code)
  values ('00000000-0000-0000-0000-0000000c0f02', '00000000-0000-0000-0000-0000000000a1', 1,
          '00000000-0000-0000-0000-00000000c001', '97702');

  insert into _r select 'D03', 'the claim reports streams {maps} for the Map 1 sign-up',
    (select outcome = 'claimed' and streams = array['maps']
       from public.alert_confirmation_claim('00000000-0000-0000-0000-0000000c0f01'));
  insert into _r select 'D04', 'the claim reports streams {meetings,notices} for the county identity',
    (select outcome = 'claimed' and streams = array['meetings','notices']
       from public.alert_confirmation_claim('00000000-0000-0000-0000-0000000c0f02'));
  insert into _r select 'D05', 'a second claim of the same confirmation is already_claimed (idempotency kept)',
    (select outcome = 'already_claimed' and streams is null
       from public.alert_confirmation_claim('00000000-0000-0000-0000-0000000c0f01'));
  insert into _r select 'D06', 'the claim stays service_role only',
    not has_function_privilege('anon', 'public.alert_confirmation_claim(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.alert_confirmation_claim(uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.alert_confirmation_claim(uuid)', 'EXECUTE');
\else
  insert into _r values ('D00', 'SKIP: the ingest delivery migration was not applied', true);
\endif

select id || '|' || label || '|' || case when ok then 't' else 'f' end from _r order by id;
