-- Jeu de données des recettes « profiles-*.mjs » (lot P3) : une organisation « p3-banc-metiers », six établissements
-- (atelier véhicule, atelier appareil, restaurant, guichet, santé,
-- boutique) et des fiches réalistes. DONNÉES seulement : uniquement des
-- fonctions existantes (provision_organization, create_location,
-- switch_queue_profile, add_walkin, staff_queue_action) et quelques
-- UPDATE d'horodatages pour vieillir les fiches.
--   psql …/votretour_e2e -v ON_ERROR_STOP=1 -f profiles-seed.sql
-- (jamais votretour_verify : verify-db.sh l’efface et le banc partagé l’utilise).
-- Chaque recette le rejoue avant de commencer : il supprime puis recrée
-- l’organisation « p3-banc-metiers ».
begin;

do $$
declare
  v_user uuid := (select id from auth.users where email = 'owner@barberhouse.test');
  v_org jsonb;
  v_org_id uuid;
  v_loc jsonb;
  v_q uuid;
  v_loc_id uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid;
  r jsonb;
  e text;
  svc uuid;
begin
  -- Nettoyage d'un passage précédent.
  delete from public.organizations where slug = 'p3-banc-metiers';

  v_org := public.provision_organization(v_user, 'P3 Banc métiers', 'garage', null, 'shared', 'starter');
  v_org_id := (v_org -> 'organization' ->> 'id')::uuid;
  update public.organizations set onboarding_step = 'done' where id = v_org_id;

  ---------------------------------------------------------------- Garage
  v_loc := public.create_location(v_org_id, 'Garage des Tilleuls', 'garage', '12 rue des Tilleuls', '75011', 'Paris',
                                  'FR', 'Europe/Paris', null, 'shared', v_user, 'p3-garage-tilleuls');
  v_q := (v_loc -> 'queue' ->> 'id')::uuid;
  v_loc_id := (v_loc -> 'location' ->> 'id')::uuid;
  perform public.switch_queue_profile(v_q, 'vehicle', v_user);
  update public.queues set status = 'open' where id = v_q;
  update public.queues set is_default = true where id = v_q;
  insert into public.staff (organization_id, location_id, user_id, display_name, role_title, sort_order)
  values (v_org_id, v_loc_id, v_user, 'Julien', 'Chef d’atelier', 0) returning id into v_s1;
  insert into public.staff (organization_id, location_id, display_name, role_title, sort_order)
  values (v_org_id, v_loc_id, 'Samir', 'Mécanicien', 1) returning id into v_s2;

  -- 1. Peugeot 208 : en réparation, devis accordé, promesse 17 h, clés reçues.
  svc := (select id from public.services where location_id = v_loc_id and name = 'Freins');
  r := public.add_walkin(v_q, 'Camille', null, svc, v_user, v_s1,
        '{"registration":"AB-123-CD","country":"FR","model":"Peugeot 208","reasonText":"Bruit au freinage","stay":"away","keys":true}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'start_serving', v_user, v_s1, '{}');
  perform public.staff_queue_action(e, 'send_quote', v_user, v_s1, '{"amountCents":18400,"label":"Plaquettes + disques AV","notify":false}');
  update public.queue_entries
     set details = jsonb_set(details, '{quote}', details -> 'quote'
                   || jsonb_build_object('decision', 'accepted', 'decidedAt', to_jsonb(now() - interval '58 minutes'),
                                         'sentAt', to_jsonb(now() - interval '1 hour 40 minutes'))),
         joined_at = now() - interval '3 hours 40 minutes'
   where public_id = e;
  perform public.staff_queue_action(e, 'set_stage', v_user, v_s1, '{"stage":"in_repair","notify":false}');
  perform public.staff_queue_action(e, 'set_eta', v_user, v_s1,
    jsonb_build_object('readyEta', to_jsonb(date_trunc('hour', now()) + interval '3 hours')));
  update public.queue_entries set stage_changed_at = now() - interval '52 minutes' where public_id = e;

  -- 2. Renault Clio : vient d'être déposée.
  svc := (select id from public.services where location_id = v_loc_id and name = 'Vidange');
  r := public.add_walkin(v_q, 'Léa', null, svc, v_user, v_s1,
        '{"registration":"GH-907-TB","country":"FR","model":"Renault Clio","stay":"onsite"}');
  update public.queue_entries set joined_at = now() - interval '18 minutes', stage_changed_at = now() - interval '18 minutes'
   where public_id = r -> 'entry' ->> 'id';

  -- 3. Renault Twingo (ancien numéro FNI), déposée ce matin.
  svc := (select id from public.services where location_id = v_loc_id and name = 'Pneus');
  r := public.add_walkin(v_q, null, null, svc, v_user, v_s1,
        '{"registration":"1234 AB 75","country":"FR","model":"Renault Twingo","stay":"away","keys":true}');
  update public.queue_entries set joined_at = now() - interval '2 hours 5 minutes', stage_changed_at = now() - interval '2 hours 5 minutes'
   where public_id = r -> 'entry' ->> 'id';

  -- 4. Tesla Model 3 : diagnostic.
  svc := (select id from public.services where location_id = v_loc_id and name = 'Diagnostic');
  r := public.add_walkin(v_q, 'Thomas', null, svc, v_user, v_s2,
        '{"registration":"FX-482-KL","country":"FR","model":"Tesla Model 3","reasonText":"Voyant batterie 12 V"}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'start_serving', v_user, v_s2, '{}');
  update public.queue_entries set joined_at = now() - interval '1 hour 12 minutes', stage_changed_at = now() - interval '35 minutes',
         service_started_at = now() - interval '35 minutes'
   where public_id = e;

  -- 5. Citroën C3 : devis en attente de réponse.
  svc := (select id from public.services where location_id = v_loc_id and name = 'Autre');
  r := public.add_walkin(v_q, 'Hugo', null, svc, v_user, v_s2,
        '{"registration":"EZ-311-QA","country":"FR","model":"Citroën C3","reasonText":"Embrayage qui patine","keys":true}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'start_serving', v_user, v_s2, '{}');
  perform public.staff_queue_action(e, 'send_quote', v_user, v_s2, '{"amountCents":41250,"label":"Kit d’embrayage complet","notify":false}');
  update public.queue_entries
     set details = jsonb_set(details, '{quote,sentAt}', to_jsonb(now() - interval '42 minutes')),
         joined_at = now() - interval '5 hours 10 minutes', stage_changed_at = now() - interval '42 minutes'
   where public_id = e;

  -- 6. Volkswagen Golf : pièce commandée, depuis hier.
  svc := (select id from public.services where location_id = v_loc_id and name = 'Freins');
  r := public.add_walkin(v_q, 'Nadia', null, svc, v_user, v_s1,
        '{"registration":"DK-640-RS","country":"FR","model":"Volkswagen Golf","reasonText":"Capteur ABS avant gauche"}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'start_serving', v_user, v_s1, '{}');
  perform public.staff_queue_action(e, 'set_stage', v_user, v_s1, '{"stage":"waiting_parts","notify":false}');
  update public.queue_entries set joined_at = now() - interval '26 hours', stage_changed_at = now() - interval '20 hours'
   where public_id = e;

  -- 7. Toyota Yaris : prête.
  svc := (select id from public.services where location_id = v_loc_id and name = 'Vidange');
  r := public.add_walkin(v_q, 'Marc', null, svc, v_user, v_s2,
        '{"registration":"BN-275-MV","country":"FR","model":"Toyota Yaris","keys":true}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'start_serving', v_user, v_s2, '{}');
  perform public.staff_queue_action(e, 'set_stage', v_user, v_s2, '{"stage":"ready","notify":false}');
  update public.queue_entries set joined_at = now() - interval '4 hours', stage_changed_at = now() - interval '25 minutes',
         called_at = now() - interval '25 minutes'
   where public_id = e;

  -- 8. BMW Série 1 immatriculée en Allemagne : en réparation.
  svc := (select id from public.services where location_id = v_loc_id and name = 'Carrosserie');
  r := public.add_walkin(v_q, 'Jonas', null, svc, v_user, v_s2,
        '{"registration":"MAB1234","country":"other","model":"BMW Série 1","stay":"away"}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'start_serving', v_user, v_s2, '{}');
  perform public.staff_queue_action(e, 'set_stage', v_user, v_s2, '{"stage":"in_repair","notify":false}');
  update public.queue_entries set joined_at = now() - interval '28 hours', stage_changed_at = now() - interval '3 hours'
   where public_id = e;

  ---------------------------------------------------------------- Atelier appareil
  v_loc := public.create_location(v_org_id, 'PhoneFix République', 'phone_repair', '3 place de la République', '75003', 'Paris',
                                  'FR', 'Europe/Paris', null, 'shared', v_user, 'p3-phonefix');
  v_q := (v_loc -> 'queue' ->> 'id')::uuid;
  v_loc_id := (v_loc -> 'location' ->> 'id')::uuid;
  perform public.switch_queue_profile(v_q, 'device', v_user);
  update public.queues set status = 'open' where id = v_q;
  insert into public.staff (organization_id, location_id, user_id, display_name, role_title)
  values (v_org_id, v_loc_id, v_user, 'Inès', 'Technicienne') returning id into v_s1;

  svc := (select id from public.services where location_id = v_loc_id and name = 'Écran');
  r := public.add_walkin(v_q, 'Yanis', null, svc, v_user, v_s1,
        '{"deviceKind":"phone","model":"iPhone 13","reasonText":"Écran fissuré, tactile OK","accessories":["case"]}');
  update public.queue_entries set joined_at = now() - interval '25 minutes', stage_changed_at = now() - interval '25 minutes'
   where public_id = r -> 'entry' ->> 'id';

  svc := (select id from public.services where location_id = v_loc_id and name = 'Batterie');
  r := public.add_walkin(v_q, 'Chloé', null, svc, v_user, v_s1,
        '{"deviceKind":"phone","model":"Galaxy S22","accessories":["charger"]}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'start_serving', v_user, v_s1, '{}');
  update public.queue_entries set joined_at = now() - interval '1 hour 30 minutes', stage_changed_at = now() - interval '40 minutes'
   where public_id = e;

  svc := (select id from public.services where location_id = v_loc_id and name = 'Connecteur de charge');
  r := public.add_walkin(v_q, 'Paul', null, svc, v_user, v_s1,
        '{"deviceKind":"tablet","model":"iPad Air","reasonText":"Ne charge plus"}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'start_serving', v_user, v_s1, '{}');
  perform public.staff_queue_action(e, 'send_quote', v_user, v_s1, '{"amountCents":8900,"label":"Connecteur Lightning","notify":false}');
  update public.queue_entries set joined_at = now() - interval '3 hours', stage_changed_at = now() - interval '15 minutes'
   where public_id = e;

  svc := (select id from public.services where location_id = v_loc_id and name = 'Oxydation');
  r := public.add_walkin(v_q, 'Sarah', null, svc, v_user, v_s1,
        '{"deviceKind":"computer","model":"MacBook Air M1","reasonText":"Café renversé","accessories":["charger","box"]}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'start_serving', v_user, v_s1, '{}');
  perform public.staff_queue_action(e, 'set_stage', v_user, v_s1, '{"stage":"waiting_parts","notify":false}');
  update public.queue_entries set joined_at = now() - interval '2 days', stage_changed_at = now() - interval '1 day'
   where public_id = e;

  svc := (select id from public.services where location_id = v_loc_id and name = 'Caméra');
  r := public.add_walkin(v_q, 'Malik', null, svc, v_user, v_s1,
        '{"deviceKind":"phone","model":"iPhone 12","accessories":[]}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'start_serving', v_user, v_s1, '{}');
  perform public.staff_queue_action(e, 'set_stage', v_user, v_s1, '{"stage":"ready","notify":false}');
  update public.queue_entries set joined_at = now() - interval '5 hours', stage_changed_at = now() - interval '12 minutes',
         called_at = now() - interval '12 minutes'
   where public_id = e;

  ---------------------------------------------------------------- Restaurant
  v_loc := public.create_location(v_org_id, 'Chez Paul', 'restaurant', '8 rue de Charonne', '75011', 'Paris',
                                  'FR', 'Europe/Paris', null, 'shared', v_user, 'p3-chez-paul');
  v_q := (v_loc -> 'queue' ->> 'id')::uuid;
  v_loc_id := (v_loc -> 'location' ->> 'id')::uuid;
  perform public.switch_queue_profile(v_q, 'table', v_user);
  update public.queues set status = 'open' where id = v_q;
  insert into public.staff (organization_id, location_id, user_id, display_name, role_title)
  values (v_org_id, v_loc_id, v_user, 'Accueil', 'Hôte') returning id into v_s1;

  r := public.add_walkin(v_q, 'Karim', null, null, v_user, v_s1, '{"partySize":4,"seating":"any"}');
  update public.queue_entries set joined_at = now() - interval '31 minutes' where public_id = r -> 'entry' ->> 'id';
  r := public.add_walkin(v_q, 'Léa', null, null, v_user, v_s1, '{"partySize":2,"seating":"terrace"}');
  update public.queue_entries set joined_at = now() - interval '24 minutes' where public_id = r -> 'entry' ->> 'id';
  r := public.add_walkin(v_q, 'Martin', null, null, v_user, v_s1, '{"partySize":6,"seating":"indoor"}');
  update public.queue_entries set joined_at = now() - interval '19 minutes' where public_id = r -> 'entry' ->> 'id';
  r := public.add_walkin(v_q, 'Sofia', null, null, v_user, v_s1, '{"partySize":3,"seating":"any","needs":["highchair"]}');
  update public.queue_entries set joined_at = now() - interval '12 minutes' where public_id = r -> 'entry' ->> 'id';
  r := public.add_walkin(v_q, 'Hugo', null, null, v_user, v_s1, '{"partySize":2,"seating":"any"}');
  update public.queue_entries set joined_at = now() - interval '7 minutes' where public_id = r -> 'entry' ->> 'id';
  r := public.add_walkin(v_q, 'Diallo', null, null, v_user, v_s1, '{"partySize":8,"seating":"indoor","needs":["accessible"]}');
  update public.queue_entries set joined_at = now() - interval '3 minutes' where public_id = r -> 'entry' ->> 'id';
  -- Le premier groupe est appelé depuis deux minutes.
  r := public.add_walkin(v_q, 'Amélie', null, null, v_user, v_s1, '{"partySize":2,"seating":"terrace"}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'call', v_user, v_s1, '{"notify":false}');
  update public.queue_entries set joined_at = now() - interval '38 minutes', called_at = now() - interval '2 minutes'
   where public_id = e;

  ---------------------------------------------------------------- Guichet
  v_loc := public.create_location(v_org_id, 'Mairie du 11e — Accueil', 'admin_service', '12 place Léon-Blum', '75011', 'Paris',
                                  'FR', 'Europe/Paris', null, 'shared', v_user, 'p3-mairie');
  v_q := (v_loc -> 'queue' ->> 'id')::uuid;
  v_loc_id := (v_loc -> 'location' ->> 'id')::uuid;
  perform public.switch_queue_profile(v_q, 'desk', v_user);
  update public.queues set status = 'open' where id = v_q;
  insert into public.staff (organization_id, location_id, display_name, desk_label, sort_order)
  values (v_org_id, v_loc_id, 'Agent 1', 'Guichet 1', 0) returning id into v_s1;
  insert into public.staff (organization_id, location_id, user_id, display_name, desk_label, sort_order)
  values (v_org_id, v_loc_id, v_user, 'Agent 2', 'Guichet 2', 1) returning id into v_s2;
  insert into public.staff (organization_id, location_id, display_name, desk_label, sort_order)
  values (v_org_id, v_loc_id, 'Agent 3', 'Guichet 3', 2) returning id into v_s3;
  for i in 1..11 loop
    svc := (select id from public.services where location_id = v_loc_id
             and name = (array['Accueil', 'Dépôt de dossier', 'Retrait'])[1 + (i % 3)]);
    r := public.add_walkin(v_q, null, null, svc, v_user, null, '{}');
    update public.queue_entries set joined_at = now() - make_interval(mins => 40 - i * 3)
     where public_id = r -> 'entry' ->> 'id';
  end loop;
  -- Deux appels en cours : guichet 1 (depuis 6 min, commencé), guichet 3.
  perform public.desk_call_next(v_q, v_s1, v_user);
  perform public.staff_queue_action(
    (select public_id from public.queue_entries where queue_id = v_q and status = 'next' and staff_id = v_s1),
    'start_serving', v_user, v_s1, '{}');
  perform public.desk_call_next(v_q, v_s3, v_user);
  update public.queue_entries set called_at = now() - interval '1 minute' where queue_id = v_q and status = 'next';

  ---------------------------------------------------------------- Santé (guichet sensible)
  v_loc := public.create_location(v_org_id, 'Centre de santé Voltaire', 'health', '40 boulevard Voltaire', '75011', 'Paris',
                                  'FR', 'Europe/Paris', null, 'shared', v_user, 'p3-sante');
  v_q := (v_loc -> 'queue' ->> 'id')::uuid;
  v_loc_id := (v_loc -> 'location' ->> 'id')::uuid;
  perform public.switch_queue_profile(v_q, 'desk', v_user);
  update public.queues set status = 'open' where id = v_q;
  -- La santé est sensible : c'est l'activité de l'ORGANISATION qui la pose
  -- par défaut ; sur ce banc multi-métiers, on la pose sur la file.
  update public.queues set profile_options = profile_options || '{"sensitive":true,"review":false,"reviewDelayMinutes":null}',
         ticket_prefix = 'B'
   where id = v_q;
  insert into public.staff (organization_id, location_id, user_id, display_name, desk_label, sort_order)
  values (v_org_id, v_loc_id, v_user, 'Accueil', 'Box 1', 0) returning id into v_s1;
  insert into public.staff (organization_id, location_id, display_name, desk_label, sort_order)
  values (v_org_id, v_loc_id, 'Infirmerie', 'Salle 2', 1) returning id into v_s2;
  for i in 1..6 loop
    -- Prénoms saisis EXPRÈS : le poste ne doit jamais les afficher.
    r := public.add_walkin(v_q, (array['Albert','Brigitte','Chantal','Denis','Émile','Fanny'])[i], null,
                           (select id from public.services where location_id = v_loc_id order by sort_order limit 1),
                           v_user, null, '{}');
    update public.queue_entries set joined_at = now() - make_interval(mins => 30 - i * 4)
     where public_id = r -> 'entry' ->> 'id';
  end loop;
  perform public.desk_call_next(v_q, v_s2, v_user);

  ---------------------------------------------------------------- Boutique
  v_loc := public.create_location(v_org_id, 'Maison Lune', 'shop', '21 rue Oberkampf', '75011', 'Paris',
                                  'FR', 'Europe/Paris', null, 'shared', v_user, 'p3-maison-lune');
  v_q := (v_loc -> 'queue' ->> 'id')::uuid;
  v_loc_id := (v_loc -> 'location' ->> 'id')::uuid;
  perform public.switch_queue_profile(v_q, 'retail', v_user);
  update public.queues set status = 'open' where id = v_q;
  insert into public.staff (organization_id, location_id, user_id, display_name, role_title)
  values (v_org_id, v_loc_id, v_user, 'Zoé', 'Vendeuse') returning id into v_s1;
  svc := (select id from public.services where location_id = v_loc_id and name = 'Être conseillé');
  r := public.add_walkin(v_q, 'Clara', null, svc, v_user, null, '{}');
  update public.queue_entries set joined_at = now() - interval '9 minutes' where public_id = r -> 'entry' ->> 'id';
  r := public.add_walkin(v_q, 'Ludovic', null, svc, v_user, null, '{}');
  update public.queue_entries set joined_at = now() - interval '4 minutes' where public_id = r -> 'entry' ->> 'id';
  svc := (select id from public.services where location_id = v_loc_id and name = 'Retirer une commande');
  r := public.add_walkin(v_q, 'Anaïs', null, svc, v_user, null, '{"orderRef":"ML-20418"}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'set_stage', v_user, v_s1, '{"stage":"preparing","notify":false}');
  update public.queue_entries set joined_at = now() - interval '14 minutes' where public_id = e;
  r := public.add_walkin(v_q, 'Bastien', null, svc, v_user, null, '{"orderRef":"ML-20431"}');
  update public.queue_entries set joined_at = now() - interval '6 minutes' where public_id = r -> 'entry' ->> 'id';
  r := public.add_walkin(v_q, 'Inès', null, svc, v_user, null, '{"orderRef":"ML-20397"}');
  e := r -> 'entry' ->> 'id';
  perform public.staff_queue_action(e, 'set_stage', v_user, v_s1, '{"stage":"ready","notify":false}');
  update public.queue_entries set joined_at = now() - interval '22 minutes', called_at = now() - interval '5 minutes',
         stage_changed_at = now() - interval '5 minutes'
   where public_id = e;
end $$;

commit;

select o.slug, l.name, q.id, q.profile, q.profile_options
  from public.organizations o
  join public.locations l on l.organization_id = o.id
  join public.queues q on q.location_id = l.id
 where o.slug = 'p3-banc-metiers'
 order by l.created_at;
