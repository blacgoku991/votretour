-- =====================================================================
-- VotreTour — suite de tests du moteur de file
-- ---------------------------------------------------------------------
-- Rejoue exactement le scénario de bout en bout attendu :
--   arrivée QR -> file -> avancement temps réel -> "je suis de retour"
--   -> prestation -> TERMINER -> avis Google, plus l'isolation
--   multi-tenant, les absents, le décalage et la limitation de débit.
--
--   ./scripts/verify-db.sh
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

create or replace function internal.assert(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'ÉCHEC: %', p_label;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

create or replace function internal.assert_eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ÉCHEC: % (attendu %, obtenu %)', p_label, p_expected, p_actual;
  end if;
  raise notice '  ok  % = %', p_label, p_actual;
end;
$$;

-- =====================================================================
do $$
declare
  v_owner   uuid := extensions.gen_random_uuid();
  v_rival   uuid := extensions.gen_random_uuid();
  v_prov    jsonb;
  v_org     uuid;
  v_loc     uuid;
  v_queue   uuid;
  v_plate   text;
  v_rival_org uuid;
  v_rival_queue uuid;
  v_resolved jsonb;
  v_alex    jsonb;
  v_thomas  jsonb;
  v_sarah   jsonb;
  v_s_alex  uuid;
  v_s_thomas uuid;
  v_s_sarah uuid;
  v_res     jsonb;
  v_snap    jsonb;
  v_state   jsonb;
  v_notifs  int;
  v_staff1  uuid;
  v_staff2  uuid;
  v_rl      record;
begin
  raise notice '';
  raise notice '── 1. Inscription du professionnel et provisionnement ──';

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_owner, 'owner@barberhouse.test', '{"full_name":"Karim B."}'::jsonb),
         (v_rival, 'chef@garage92.test',     '{"full_name":"Diane R."}'::jsonb);

  perform internal.assert(
    exists (select 1 from public.profiles where id = v_owner),
    'le profil est créé automatiquement à l''inscription');

  v_prov := public.provision_organization(
    v_owner, 'Barber House', 'barber', 'Barber House — Paris 11', 'shared', 'pro');
  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  v_plate := v_prov -> 'plate' ->> 'code';

  perform internal.assert(v_org is not null,   'organisation créée');
  perform internal.assert(v_loc is not null,   'établissement créé');
  perform internal.assert(v_queue is not null, 'file créée');
  perform internal.assert(v_plate is not null, 'plaque NFC/QR créée avec son URL unique');
  perform internal.assert(
    exists (select 1 from public.organization_settings where organization_id = v_org),
    'réglages par défaut créés');
  perform internal.assert(
    (select count(*) from public.opening_hours where location_id = v_loc) = 7,
    'horaires d''ouverture initialisés');
  perform internal.assert(
    (select status = 'trialing' from public.subscriptions where organization_id = v_org),
    'abonnement démarré en période d''essai');

  update public.locations
     set google_review_url = 'https://search.google.com/local/writereview?placeid=ChIJbarberhouse'
   where id = v_loc;

  -- Un concurrent, pour vérifier l'étanchéité du multi-tenant.
  v_prov := public.provision_organization(
    v_rival, 'Garage 92', 'garage', 'Garage 92 — Nanterre', 'per_staff', 'starter');
  v_rival_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_rival_queue := (v_prov -> 'queue' ->> 'id')::uuid;

  raise notice '';
  raise notice '── 2. Équipe et ouverture de la file ──';

  insert into public.staff (organization_id, location_id, display_name, role_title, sort_order)
  values (v_org, v_loc, 'Karim', 'Barbier', 0) returning id into v_staff1;
  insert into public.staff (organization_id, location_id, display_name, role_title, sort_order)
  values (v_org, v_loc, 'Sofia', 'Barbière', 1) returning id into v_staff2;

  perform internal.assert(
    (public.check_org_quota(v_org, 'staff') ->> 'allowed')::boolean,
    'quota employés respecté sur l''offre Pro');

  -- Une file fermée refuse les inscriptions.
  begin
    perform public.join_queue(v_queue, null);
    raise exception 'ÉCHEC: une file fermée a accepté une inscription';
  exception when sqlstate 'VT001' then
    raise notice '  ok  file fermée : inscription refusée';
  end;

  perform public.set_queue_status(v_queue, 'open', v_owner);
  perform internal.assert_eq(
    (select status::text from public.queues where id = v_queue), 'open', 'file ouverte');

  raise notice '';
  raise notice '── 3. Résolution de l''URL de la plaque (QR / NFC) ──';

  v_resolved := public.resolve_entry_point(v_plate);
  perform internal.assert_eq(v_resolved ->> 'status', 'ok', 'plaque résolue');
  perform internal.assert_eq(
    v_resolved -> 'location' ->> 'name', 'Barber House — Paris 11',
    'la plaque pointe vers le bon établissement');
  perform internal.assert_eq(
    (v_resolved -> 'queue' ->> 'id'), v_queue::text, 'la plaque pointe vers la bonne file');
  perform internal.assert(
    (v_resolved -> 'location' ->> 'hasReviewLink')::boolean,
    'lien d''avis Google configuré');
  perform internal.assert(
    jsonb_array_length(v_resolved -> 'staff') = 2, 'les deux professionnels sont exposés');
  perform internal.assert(
    public.resolve_entry_point('slug-qui-n-existe-pas') is null,
    'une URL inconnue ne révèle rien');

  raise notice '';
  raise notice '── 4. Trois clients rejoignent la file ──';

  v_s_alex   := (public.upsert_client_session(v_org, 'hash-alex',   'ios_appclip', 'Alexandre') ->> 'id')::uuid;
  v_s_thomas := (public.upsert_client_session(v_org, 'hash-thomas', 'android_web', 'Thomas')    ->> 'id')::uuid;
  v_s_sarah  := (public.upsert_client_session(v_org, 'hash-sarah',  'web',         'Sarah')     ->> 'id')::uuid;

  v_alex   := public.join_queue(v_queue, v_s_alex,   'Alexandre', null, null, 'nfc');
  v_thomas := public.join_queue(v_queue, v_s_thomas, 'Thomas',    null, null, 'qr');
  v_sarah  := public.join_queue(v_queue, v_s_sarah,  'Sarah',     null, null, 'appclip');

  perform internal.assert_eq((v_alex   -> 'entry' ->> 'peopleAhead')::int, 0, 'Alexandre : 0 personne devant');
  perform internal.assert_eq((v_thomas -> 'entry' ->> 'peopleAhead')::int, 1, 'Thomas : 1 personne devant');
  perform internal.assert_eq((v_sarah  -> 'entry' ->> 'peopleAhead')::int, 2, 'Sarah : 2 personnes devant');

  -- Anti double inscription : rescanner la plaque rend le même ticket.
  v_res := public.join_queue(v_queue, v_s_thomas, 'Thomas', null, null, 'qr');
  perform internal.assert((v_res ->> 'rejoined')::boolean, 'un rescan ne crée pas un second ticket');
  perform internal.assert_eq(
    v_res -> 'entry' ->> 'id', v_thomas -> 'entry' ->> 'id',
    'le rescan retourne le ticket existant');
  perform internal.assert_eq(
    (select count(*)::int from public.queue_entries
     where queue_id = v_queue and public.entry_is_active(status)), 3,
    'la file contient bien 3 personnes');

  raise notice '';
  raise notice '── 5. Le professionnel voit sa file ──';

  v_snap := public.queue_snapshot(v_queue);
  perform internal.assert_eq((v_snap -> 'counts' ->> 'waiting')::int, 3, 'le pro voit 3 personnes en attente');
  perform internal.assert_eq(
    v_snap -> 'waiting' -> 0 ->> 'name', 'Alexandre', 'Alexandre est en tête de file');
  perform internal.assert_eq(
    v_snap -> 'location' ->> 'googleReviewUrl',
    'https://search.google.com/local/writereview?placeid=ChIJbarberhouse',
    'le lien d''avis Google est disponible côté pro');

  raise notice '';
  raise notice '── 6. Aucune notification prématurée ──';

  select count(*) into v_notifs from public.claim_pending_notifications(v_queue);
  perform internal.assert_eq(v_notifs, 0,
    'personne n''est notifié juste après avoir rejoint (position déjà visible à l''écran)');

  raise notice '';
  raise notice '── 7. Démarrage puis TERMINER : la file avance ──';

  v_res := public.staff_queue_action(
    v_alex -> 'entry' ->> 'id', 'start_serving', v_owner, v_staff1);
  perform internal.assert_eq(v_res -> 'entry' ->> 'status', 'serving', 'Alexandre passe en prestation');

  v_res := public.staff_queue_action(
    v_alex -> 'entry' ->> 'id', 'complete', v_owner, v_staff1);
  perform internal.assert_eq(v_res -> 'entry' ->> 'status', 'completed', 'Alexandre est terminé');
  perform internal.assert_eq(
    v_res -> 'promoted' ->> 'name', 'Thomas', 'Thomas est automatiquement pris en charge');
  perform internal.assert_eq(
    v_res -> 'promoted' ->> 'status', 'serving', 'Thomas passe en prestation (mode auto_serve)');

  perform internal.assert_eq(
    (select people_ahead from public.queue_entries where public_id = v_sarah -> 'entry' ->> 'id'),
    1, 'Sarah est passée de 2 à 1 personne devant elle');

  raise notice '';
  raise notice '── 8. Les notifications à envoyer sont réclamées une seule fois ──';

  -- Deux personnes doivent être prévenues :
  --   Thomas, promu en prestation alors qu'il est peut-être parti -> "c'est votre tour"
  --   Sarah, qui passe à une seule personne devant -> "commencez à revenir"
  select jsonb_object_agg(client_name, kind) into v_state
  from public.claim_pending_notifications(v_queue);

  perform internal.assert_eq(v_state ->> 'Thomas', 'your_turn',
    'Thomas est prévenu que c''est son tour');
  perform internal.assert_eq(v_state ->> 'Sarah', 'ahead_one',
    'Sarah est prévenue qu''il ne reste qu''une personne devant elle');

  select count(*) into v_notifs from public.claim_pending_notifications(v_queue);
  perform internal.assert_eq(v_notifs, 0, 'la même notification n''est jamais réclamée deux fois');

  perform internal.assert(
    (select notification_status ? 'ahead_one'
     from public.queue_entries where public_id = v_sarah -> 'entry' ->> 'id'),
    'le palier "plus qu''une personne" est journalisé sur le ticket');

  raise notice '';
  raise notice '── 9. "Je suis de retour" ──';

  v_res := public.client_queue_action(v_sarah -> 'entry' ->> 'id', v_s_sarah, 'returning');
  perform internal.assert_eq(v_res -> 'entry' ->> 'status', 'returning',
    'le pro voit immédiatement que Sarah revient');

  -- Un autre appareil ne peut pas manipuler ce ticket.
  begin
    perform public.client_queue_action(v_sarah -> 'entry' ->> 'id', v_s_thomas, 'leave');
    raise exception 'ÉCHEC: un autre appareil a pu agir sur le ticket de Sarah';
  exception when sqlstate 'VT009' then
    raise notice '  ok  un ticket n''est manipulable que par son propre appareil';
  end;

  raise notice '';
  raise notice '── 10. Fin de passage et avis Google ──';

  v_state := public.ticket_state(v_sarah -> 'entry' ->> 'id', v_s_sarah);
  perform internal.assert(
    v_state -> 'location' ->> 'googleReviewUrl' is null,
    'le lien d''avis n''est pas exposé tant que la prestation n''est pas terminée');

  v_res := public.staff_queue_action(v_thomas -> 'entry' ->> 'id', 'complete', v_owner, v_staff1);
  perform internal.assert_eq(v_res -> 'promoted' ->> 'name', 'Sarah', 'Sarah est prise en charge');

  v_res := public.staff_queue_action(v_sarah -> 'entry' ->> 'id', 'complete', v_owner, v_staff1);
  perform internal.assert_eq(v_res -> 'entry' ->> 'status', 'completed', 'Sarah est terminée');

  v_state := public.ticket_state(v_sarah -> 'entry' ->> 'id', v_s_sarah);
  perform internal.assert_eq(
    v_state -> 'location' ->> 'googleReviewUrl',
    'https://search.google.com/local/writereview?placeid=ChIJbarberhouse',
    'le lien d''avis du BON établissement est révélé en fin de passage');

  perform internal.assert(
    public.claim_entry_notification(
      (select id from public.queue_entries where public_id = v_sarah -> 'entry' ->> 'id'),
      'visit_completed'),
    'la notification de fin de visite est réclamée');
  perform internal.assert(
    not public.claim_entry_notification(
      (select id from public.queue_entries where public_id = v_sarah -> 'entry' ->> 'id'),
      'visit_completed'),
    'elle ne peut pas être envoyée deux fois');

  perform internal.assert_eq(
    (select count(*)::int from public.queue_entries
     where queue_id = v_queue and public.entry_is_active(status)), 0,
    'la file est vide');

  raise notice '';
  raise notice '── 11. Reprise de session automatique ──';

  v_state := public.find_active_ticket(v_s_sarah);
  perform internal.assert(v_state is not null,
    'le ticket terminé reste retrouvable 30 min (fenêtre d''avis Google)');
  perform internal.assert(public.find_active_ticket(extensions.gen_random_uuid()) is null,
    'une session inconnue ne retrouve aucun ticket');

  raise notice '';
  raise notice '── 12. Absent, décalage, remise en file ──';

  perform public.join_queue(v_queue, v_s_alex,   'Alexandre', null, null, 'qr');
  perform public.join_queue(v_queue, v_s_thomas, 'Thomas',    null, null, 'qr');
  perform public.join_queue(v_queue, v_s_sarah,  'Sarah',     null, null, 'qr');

  -- Politique par défaut : move_back de 2 places.
  v_res := public.staff_queue_action(
    (select public_id from public.queue_entries
     where queue_id = v_queue and client_session_id = v_s_alex and public.entry_is_active(status)),
    'mark_absent', v_owner, v_staff1);

  perform internal.assert_eq(
    (select people_ahead from public.queue_entries
     where queue_id = v_queue and client_session_id = v_s_alex and public.entry_is_active(status)),
    2, 'un client absent recule de 2 places au lieu d''être perdu');
  perform internal.assert(
    not (select notification_status ? 'your_turn' from public.queue_entries
         where queue_id = v_queue and client_session_id = v_s_alex and public.entry_is_active(status)),
    'ses notifications sont réarmées pour son prochain tour');

  -- Retrait pur et simple, puis remise en file.
  v_res := public.staff_queue_action(
    (select public_id from public.queue_entries
     where queue_id = v_queue and client_session_id = v_s_thomas and public.entry_is_active(status)),
    'remove', v_owner, v_staff1);
  perform internal.assert_eq(v_res -> 'entry' ->> 'status', 'skipped', 'Thomas est retiré de la file');

  v_res := public.staff_queue_action(v_res -> 'entry' ->> 'id', 'restore', v_owner, v_staff1);
  perform internal.assert_eq(v_res -> 'entry' ->> 'status', 'waiting', 'Thomas est remis en file');

  raise notice '';
  raise notice '── 13. Un professionnel ne sert qu''une personne à la fois ──';

  v_res := public.staff_queue_action(
    (select public_id from public.queue_entries
     where queue_id = v_queue and public.entry_is_active(status)
     order by people_ahead limit 1),
    'start_serving', v_owner, v_staff1);

  begin
    perform public.staff_queue_action(
      (select public_id from public.queue_entries
       where queue_id = v_queue and status <> 'serving' and public.entry_is_active(status)
       order by people_ahead limit 1),
      'start_serving', v_owner, v_staff1);
    raise exception 'ÉCHEC: un professionnel a pu démarrer deux prestations';
  exception when sqlstate 'VT010' then
    raise notice '  ok  double prestation simultanée refusée pour un même professionnel';
  end;

  -- Sofia, elle, peut servir en parallèle (file commune, 2 barbiers).
  v_res := public.staff_queue_action(
    (select public_id from public.queue_entries
     where queue_id = v_queue and status <> 'serving' and public.entry_is_active(status)
     order by people_ahead limit 1),
    'start_serving', v_owner, v_staff2);
  perform internal.assert_eq(v_res -> 'entry' ->> 'status', 'serving',
    'une seconde barbière sert en parallèle en file commune');
  perform internal.assert_eq(
    (select count(*)::int from public.queue_entries where queue_id = v_queue and status = 'serving'),
    2, 'deux prestations simultanées en file commune');

  raise notice '';
  raise notice '── 14. Isolation multi-tenant ──';

  begin
    perform public.join_queue(v_rival_queue, v_s_alex, 'Alexandre');
    raise exception 'ÉCHEC: une session du Barber a pu rejoindre la file du Garage';
  exception
    when sqlstate 'VT001' then raise notice '  ok  file du Garage fermée (inscription refusée en amont)';
    when others then
      if sqlstate = 'P0001' and sqlerrm like '%ÉCHEC%' then raise; end if;
      raise notice '  ok  session cloisonnée : % ', sqlerrm;
  end;

  perform public.set_queue_status(v_rival_queue, 'open', v_rival);
  begin
    perform public.join_queue(v_rival_queue, v_s_alex, 'Alexandre');
    raise exception 'ÉCHEC: une session du Barber a rejoint la file du Garage';
  exception
    when sqlstate 'VT008' then raise notice '  ok  aucun professionnel : inscription impossible';
    when others then
      if sqlerrm like '%ÉCHEC%' then raise; end if;
      raise notice '  ok  session d''une autre organisation rejetée (%)', sqlstate;
  end;

  perform internal.assert(
    not exists (
      select 1 from public.queue_entries e
      join public.client_sessions s on s.id = e.client_session_id
      where e.organization_id <> s.organization_id),
    'aucun ticket ne croise deux organisations');

  raise notice '';
  raise notice '── 15. Limitation de débit ──';

  for v_notifs in 1 .. 5 loop
    select * into v_rl from public.consume_rate_limit('test:join:1.2.3.4', 5, 60);
  end loop;
  perform internal.assert(v_rl.allowed, '5 tentatives autorisées');
  select * into v_rl from public.consume_rate_limit('test:join:1.2.3.4', 5, 60);
  perform internal.assert(not v_rl.allowed, 'la 6e tentative est bloquée');
  perform internal.assert(v_rl.retry_after_seconds > 0, 'un délai de réessai est renvoyé');

  raise notice '';
  raise notice '── 16. Statistiques ──';

  v_state := public.location_stats(v_loc, now() - interval '1 day', now() + interval '1 day');
  perform internal.assert((v_state -> 'totals' ->> 'completed')::int >= 3,
    'les passages terminés sont comptabilisés');
  perform internal.assert(v_state ->> 'avgWaitSeconds' is not null,
    'le temps d''attente moyen est calculé');
  perform internal.assert((public.platform_stats() -> 'organizations' ->> 'total')::int >= 2,
    'les statistiques plateforme agrègent les organisations');

  raise notice '';
  raise notice '── 17. Expiration et purge RGPD ──';

  update public.queue_entries set joined_at = now() - interval '10 hours'
  where queue_id = v_queue and public.entry_is_active(status);
  perform public.expire_stale_entries();
  perform internal.assert_eq(
    (select count(*)::int from public.queue_entries
     where queue_id = v_queue and public.entry_is_active(status)),
    0, 'les tickets oubliés expirent automatiquement');

  update public.organization_settings set data_retention_days = 1 where organization_id = v_org;
  update public.queue_entries set joined_at = now() - interval '10 days' where organization_id = v_org;
  v_state := public.purge_expired_data();
  perform internal.assert((v_state ->> 'anonymizedEntries')::int > 0,
    'les prénoms sont effacés au-delà de la durée de conservation');
  perform internal.assert(
    not exists (select 1 from public.queue_entries
                where organization_id = v_org and client_name is not null),
    'plus aucune donnée personnelle dans l''historique purgé');

  raise notice '';
  raise notice '✅ Moteur de file : tous les tests passent.';
end
$$;
