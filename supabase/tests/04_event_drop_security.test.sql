-- =====================================================================
-- Rangvia — sécurité et invariants Event / Drop
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

do $$
declare
  v_owner uuid := extensions.gen_random_uuid();
  v_rival uuid := extensions.gen_random_uuid();
  v_prov jsonb;
  v_org uuid;
  v_loc uuid;
  v_queue uuid;
  v_rival_queue uuid;
  v_event uuid;
  v_s1 uuid;
  v_s2 uuid;
  v_s3 uuid;
  v_join1 jsonb;
  v_join2 jsonb;
  v_join3 jsonb;
  v_entry1 uuid;
  v_entry2 uuid;
  v_entry3 uuid;
  v_wave record;
  v_hash text;
  v_pass uuid;
  v_res jsonb;
  v_expired int;
begin
  raise notice '';
  raise notice '── Event / Drop : isolation et laissez-passer ──';

  insert into auth.users (id, email)
  values
    (v_owner, 'event-owner@test.local'),
    (v_rival, 'event-rival@test.local');

  v_prov := public.provision_organization(
    v_owner, 'Event Shop Test', 'event', 'Event Shop Paris', 'shared', 'pro'
  );
  v_org := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;

  v_prov := public.provision_organization(
    v_rival, 'Rival Event', 'event', 'Rival Event Paris', 'shared', 'pro'
  );
  v_rival_queue := (v_prov -> 'queue' ->> 'id')::uuid;

  -- Le trigger multi-tenant doit bloquer toute association queue/org croisée.
  begin
    insert into public.event_campaigns (
      organization_id, location_id, queue_id, name, status, created_by
    ) values (
      v_org, v_loc, v_rival_queue, 'Event pirate', 'draft', v_owner
    );
    raise exception 'ÉCHEC: création Event multi-tenant acceptée';
  exception when others then
    if sqlerrm like 'ÉCHEC:%' then raise; end if;
    raise notice '  ok  Event multi-tenant refusé';
  end;

  insert into public.event_campaigns (
    organization_id, location_id, queue_id, name, status,
    wave_size, pass_valid_minutes, grace_minutes, created_by, started_at
  ) values (
    v_org, v_loc, v_queue, 'Drop Sécurisé', 'live',
    1, 10, 5, v_owner, now()
  ) returning id into v_event;

  perform public.set_queue_status(v_queue, 'open', v_owner);

  v_s1 := (public.upsert_client_session(v_org, 'event-client-1', 'ios_appclip', 'Client 1') ->> 'id')::uuid;
  v_s2 := (public.upsert_client_session(v_org, 'event-client-2', 'web', 'Client 2') ->> 'id')::uuid;
  v_s3 := (public.upsert_client_session(v_org, 'event-client-3', 'web', 'Client 3') ->> 'id')::uuid;

  v_join1 := public.join_queue(v_queue, v_s1, 'Client 1', null, null, 'appclip');
  v_join2 := public.join_queue(v_queue, v_s2, 'Client 2', null, null, 'qr');
  v_join3 := public.join_queue(v_queue, v_s3, 'Client 3', null, null, 'nfc');

  select id into v_entry1 from public.queue_entries where public_id = v_join1 -> 'entry' ->> 'id';
  select id into v_entry2 from public.queue_entries where public_id = v_join2 -> 'entry' ->> 'id';
  select id into v_entry3 from public.queue_entries where public_id = v_join3 -> 'entry' ->> 'id';

  -- Une vague de 1 ne doit émettre qu'un seul laissez-passer.
  select * into v_wave from public.issue_event_wave(v_event, v_owner, 1);
  if v_wave.entry_id is distinct from v_entry1 then
    raise exception 'ÉCHEC: la première vague n''a pas appelé la tête de file';
  end if;

  -- La RPC ne renvoie jamais de bearer brut. Seul un hash aléatoire de
  -- 256 bits reste en base et les liens d'accès sont signés côté serveur.
  select id, token_hash into v_pass, v_hash
  from public.event_access_passes
  where queue_entry_id = v_entry1 and event_id = v_event;

  if v_hash is null or length(v_hash) <> 64 or v_hash ~ '[^0-9a-f]' then
    raise exception 'ÉCHEC: secret de pass Event mal stocké';
  end if;
  if to_jsonb(v_wave) ? 'raw_token' then
    raise exception 'ÉCHEC: issue_event_wave expose encore un bearer brut';
  end if;
  raise notice '  ok  aucun bearer brut ne quitte PostgreSQL';
  if (select status::text from public.queue_entries where id = v_entry1) <> 'notified' then
    raise exception 'ÉCHEC: ticket appelé non marqué notified';
  end if;

  -- Rejouer une vague ne doit pas émettre un second pass au même client.
  select * into v_wave from public.issue_event_wave(v_event, v_owner, 1);
  if v_wave.entry_id is distinct from v_entry2 then
    raise exception 'ÉCHEC: second appel n''a pas sauté le pass déjà actif';
  end if;
  if (select count(*) from public.event_access_passes where event_id = v_event and queue_entry_id = v_entry1) <> 1 then
    raise exception 'ÉCHEC: double pass créé pour le même ticket';
  end if;
  raise notice '  ok  un seul pass par ticket et par Event';

  -- Numéro de vague : une émission = une vague. Les deux vagues de ce
  -- test partagent la transaction ; on décale la seconde d'une minute.
  update public.event_access_passes set issued_at = issued_at + interval '1 minute'
  where event_id = v_event and queue_entry_id = v_entry2;
  if public.event_pass_wave(v_event, (select issued_at from public.event_access_passes
       where event_id = v_event and queue_entry_id = v_entry1)) <> 1
     or public.event_pass_wave(v_event, (select issued_at from public.event_access_passes
       where event_id = v_event and queue_entry_id = v_entry2)) <> 2 then
    raise exception 'ÉCHEC: numéro de vague faux';
  end if;
  raise notice '  ok  le numéro de vague d''un pass est compté en base';

  -- Validation du premier pass : atomique et à usage unique.
  v_res := public.redeem_event_pass(v_hash, v_owner);
  if v_res ->> 'status' <> 'redeemed' then
    raise exception 'ÉCHEC: pass valide non accepté';
  end if;
  if (select status::text from public.event_access_passes where id = v_pass) <> 'redeemed' then
    raise exception 'ÉCHEC: pass non persisté redeemed';
  end if;
  if (select status::text from public.queue_entries where id = v_entry1) <> 'completed' then
    raise exception 'ÉCHEC: entrée validée non terminée';
  end if;

  v_res := public.redeem_event_pass(v_hash, v_owner);
  if v_res ->> 'status' <> 'already_redeemed' then
    raise exception 'ÉCHEC: rejeu du pass non détecté';
  end if;
  raise notice '  ok  pass à usage unique : rejeu détecté';

  -- Le deuxième pass expire et libère automatiquement la file.
  update public.event_access_passes
     set grace_until = now() - interval '1 minute'
   where event_id = v_event and queue_entry_id = v_entry2;

  select coalesce(sum(x.expired), 0)::int into v_expired
  from public.expire_event_passes() x;

  if v_expired < 1 then
    raise exception 'ÉCHEC: pass Event expiré non traité';
  end if;
  if (select status::text from public.queue_entries where id = v_entry2) <> 'absent' then
    raise exception 'ÉCHEC: pass expiré bloque encore la file';
  end if;
  raise notice '  ok  expiration retire automatiquement l''absent de la file';

  -- Stock épuisé : annule uniquement les personnes encore actives et ferme.
  perform * from public.close_event_campaign(v_event, v_owner, 'sold_out');

  if (select status from public.event_campaigns where id = v_event) <> 'sold_out' then
    raise exception 'ÉCHEC: Event non passé en sold_out';
  end if;
  if (select status::text from public.queues where id = v_queue) <> 'closed' then
    raise exception 'ÉCHEC: file Event non fermée';
  end if;
  if (select status::text from public.queue_entries where id = v_entry3) <> 'cancelled' then
    raise exception 'ÉCHEC: personne restante non annulée à stock épuisé';
  end if;
  raise notice '  ok  stock épuisé ferme proprement tous les accès restants';

  -- Les fonctions critiques ne doivent jamais être exécutables par anon.
  begin
    execute 'set local role anon';
    perform public.issue_event_wave(v_event, v_owner, 1);
    execute 'reset role';
    raise exception 'ÉCHEC: anon a pu appeler issue_event_wave';
  exception when insufficient_privilege then
    execute 'reset role';
    raise notice '  ok  anon ne peut pas émettre de pass Event';
  end;

  begin
    execute 'set local role anon';
    perform public.event_pass_wave(v_event, now());
    execute 'reset role';
    raise exception 'ÉCHEC: anon a pu compter les vagues d''un Event';
  exception when insufficient_privilege then
    execute 'reset role';
    raise notice '  ok  anon ne peut pas compter les vagues d''un Event';
  end;
end
$$;
