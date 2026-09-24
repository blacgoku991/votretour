-- =====================================================================
-- Rangvia — profils métier : confidentialité, écran de salle, statistiques
-- (migration 0036, [SEC § 14.2] cas 1 à 8)
-- ---------------------------------------------------------------------
--   0. Parité walkin : le scénario du test 12 rejoué ; display_snapshot
--      (0036) rend EXACTEMENT le JSON attendu de 0031, écrit ici en clair,
--      clés et valeurs. Même sortie pour une file event.
--   1. Atelier véhicule : immatriculation masquée (3 derniers caractères),
--      ni plaque en clair, ni registrationKey, ni details, ni prénom, ni
--      modèle, ni motif, ni devis, ni note. tvRegistration = 'none' (et
--      'model_only') : aucune immatriculation, même masquée.
--   2. Guichet en santé : aucun prénom, même quand client_name est
--      renseigné, ni le motif. Toujours vrai si la file demande le prénom.
--   3. (le 0) walkin : mêmes prénoms et initiales, aucune note ni journal.
--   4. Purge : au-delà de la rétention, details = {}, registration_key,
--      claim_token_hash et client_name à null.
--   5. RLS : un membre d'une autre organisation ne lit ni les modèles de
--      messages ni les details ; anon ne lit rien.
--   6. Droits : display_snapshot, claim_entry, peek_claim, desk_call_next,
--      profile_stats et claim_entry_notification_key refusés à anon et à
--      authenticated.
--   7. details de plus de 2 Ko : violation de contrainte.
--   8. Aucun événement (étape comprise) ne contient l'immatriculation.
-- Plus : table, boutique et atelier appareil à l'écran ; profile_stats
-- (atelier, table, guichet, changement de profil) sans donnée personnelle.
--
-- Tout se joue dans une transaction annulée à la fin : la purge, les
-- dates reculées et les organisations d'essai ne restent pas en base.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

begin;

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

-- Toutes les clés d'objet présentes à n'importe quelle profondeur.
create or replace function internal.test_all_keys(p_doc jsonb)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct k order by k), '{}')
  from jsonb_path_query(p_doc, 'strict $.**') as j(v)
  cross join lateral jsonb_object_keys(case when jsonb_typeof(j.v) = 'object' then j.v else '{}'::jsonb end) as k;
$$;

-- Clés d'un objet, triées.
create or replace function internal.test_keys(p_obj jsonb)
returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_obj) as k;
$$;

-- Aucune des chaînes interdites dans le texte envoyé (comparaison
-- insensible à la casse : « maxime » trahirait autant que « Maxime »).
create or replace function internal.test_absent(p_text text, p_needles text[], p_label text)
returns void language plpgsql as $$
declare
  v_needle text;
begin
  foreach v_needle in array p_needles loop
    if position(lower(v_needle) in lower(p_text)) > 0 then
      raise exception 'ÉCHEC: % : « % » a fuité', p_label, v_needle;
    end if;
  end loop;
  raise notice '  ok  %', p_label;
end;
$$;

-- Clés qu'aucun écran de salle ne reçoit, quel que soit le profil.
create or replace function internal.test_forbidden_keys()
returns text[] language sql immutable as $$
  select array[
    'note', 'staffNote', 'notified', 'notificationStatus', 'clientSessionId', 'details',
    'registrationKey', 'model', 'reasonText', 'quote', 'amountCents', 'label', 'stay',
    'keys', 'readyEta', 'accessories', 'orderRef', 'serviceId', 'service', 'reason',
    'clientName', 'organizationId', 'locationId', 'claimPending', 'joinedAt', 'source',
    'peopleAhead', 'servingEntryId', 'userId', 'stage', 'stages'
  ];
$$;

-- Identifiants partagés entre les blocs (transaction uniquement).
create temp table p14 (k text primary key, v text not null) on commit drop;

-- =====================================================================
-- 0. Parité walkin : le scénario du test 12, et le JSON attendu en clair
-- =====================================================================
do $$
declare
  v_owner   uuid := extensions.gen_random_uuid();
  v_prov    jsonb;
  v_org     uuid;
  v_loc     uuid;
  v_queue   uuid;
  v_staff   uuid[] := '{}';
  v_sid     uuid;
  v_old     uuid;
  v_id      text;
  v_name    text;
  v_ids     text[] := '{}';   -- serving (Alexandre, Inès, Bruno, Chloé)
  v_thomas  text;
  v_wait    text[] := '{}';   -- les dix personnes en attente, dans l'ordre
  v_disp    jsonb;
  v_expect  jsonb;
  i         int;
  c_waiting constant text[] := array[
    'Sarah', 'Jean-Luc Picard', null, 'Émilie', 'Zoé Dupont — Paris',
    E'Léa Martin', '92 Studio', 'Иван Петров', 'Hugo', 'Ömer'
  ];
begin
  raise notice '';
  raise notice '══ Profils métier : confidentialité et écran de salle ══';
  raise notice '';
  raise notice '── 0. Parité walkin : 0036 rend exactement la sortie de 0031 ──';

  insert into auth.users (id, email) values (v_owner, 'p14-salon@profils.test');
  v_prov := public.provision_organization(
    v_owner, 'Salon Écran', 'barber', 'Salon Écran — Lyon 2', 'shared', 'pro');
  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  perform internal.assert_eq((select profile::text from public.queues where id = v_queue), 'walkin',
    'un barbier est en walkin');

  for i in 1..7 loop
    insert into public.staff (organization_id, location_id, display_name, sort_order, is_on_break)
    values (v_org, v_loc, (array['Karim','Sofia','Yanis','Nora','Malik','Lina','Théo'])[i], i, i = 3)
    returning id into v_sid;
    v_staff := v_staff || v_sid;
  end loop;
  insert into public.staff (organization_id, location_id, display_name, sort_order)
  values (v_org, v_loc, 'Ancien', 99) returning id into v_old;

  perform public.set_queue_status(v_queue, 'open', v_owner);

  foreach v_name in array array['Paul', 'Nadia'] loop
    v_id := public.add_walkin(v_queue, v_name, null, null, v_owner, null) -> 'entry' ->> 'id';
    perform public.staff_queue_action(v_id, 'start_serving', v_owner, v_staff[1]);
    perform public.staff_queue_action(v_id, 'complete', v_owner, v_staff[1]);
  end loop;

  v_sid := (public.upsert_client_session(v_org, 'hash-p14-alexandre', 'ios_appclip', 'Alexandre') ->> 'id')::uuid;
  v_id := public.join_queue(v_queue, v_sid, 'Alexandre', null, null, 'nfc') -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_id, 'start_serving', v_owner, v_staff[1]);
  perform public.staff_queue_action(v_id, 'note', v_owner, v_staff[1], '{"note":"NOTE-PRIVEE allergie au baume"}');
  v_ids := v_ids || v_id;
  v_id := public.add_walkin(v_queue, 'Inès', null, null, v_owner, null) -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_id, 'start_serving', v_owner, v_staff[2]);
  v_ids := v_ids || v_id;
  v_id := public.add_walkin(v_queue, 'Bruno', null, null, v_owner, null) -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_id, 'start_serving', v_owner, v_old);
  v_ids := v_ids || v_id;
  v_id := public.add_walkin(v_queue, 'Chloé', null, null, v_owner, null) -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_id, 'start_serving', v_owner, v_staff[4]);
  v_ids := v_ids || v_id;
  update public.staff set is_active = false where id = v_old;

  v_sid := (public.upsert_client_session(v_org, 'hash-p14-thomas', 'web', 'Thomas Martin') ->> 'id')::uuid;
  v_thomas := public.join_queue(v_queue, v_sid, 'Thomas Martin', null, null, 'qr') -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_thomas, 'call', v_owner, null);
  perform public.staff_queue_action(v_thomas, 'note', v_owner, null, '{"note":"NOTE-PRIVEE paie en espèces"}');
  foreach v_name in array c_waiting loop
    v_id := public.add_walkin(v_queue, v_name, null, null, v_owner, null) -> 'entry' ->> 'id';
    perform public.staff_queue_action(v_id, 'note', v_owner, null, '{"note":"NOTE-PRIVEE rappeler au 06 12 34 56 78"}');
    v_wait := v_wait || v_id;
  end loop;
  perform public.claim_pending_notifications(v_queue);

  -- Le JSON que 0031 envoyait pour ce scénario, écrit en clair : chaque
  -- clé, chaque valeur, chaque ordre. Rien de plus, rien de moins.
  v_expect := jsonb_build_object(
    'queue', jsonb_build_object('id', v_queue, 'status', 'open'),
    'location', jsonb_build_object('name', 'Salon Écran — Lyon 2'),
    'counts', jsonb_build_object(
      'active', 15, 'waiting', 10, 'serving', 4, 'upcoming', 11, 'completedToday', 2),
    'staff', jsonb_build_array(
      jsonb_build_object('id', v_staff[1], 'name', 'Karim', 'isOnBreak', false, 'isServing', true),
      jsonb_build_object('id', v_staff[2], 'name', 'Sofia', 'isOnBreak', false, 'isServing', true),
      jsonb_build_object('id', v_staff[3], 'name', 'Yanis', 'isOnBreak', true,  'isServing', false),
      jsonb_build_object('id', v_staff[4], 'name', 'Nora',  'isOnBreak', false, 'isServing', true),
      jsonb_build_object('id', v_staff[5], 'name', 'Malik', 'isOnBreak', false, 'isServing', false),
      jsonb_build_object('id', v_staff[6], 'name', 'Lina',  'isOnBreak', false, 'isServing', false)),
    'serving', jsonb_build_array(
      jsonb_build_object('id', v_ids[1], 'name', 'Alexandre', 'staffName', 'Karim'),
      jsonb_build_object('id', v_ids[2], 'name', 'Inès',      'staffName', 'Sofia'),
      jsonb_build_object('id', v_ids[3], 'name', 'Bruno',     'staffName', null)),
    'upcoming', jsonb_build_array(
      jsonb_build_object('id', v_thomas,  'called', true,  'initials', 'TM'),
      jsonb_build_object('id', v_wait[1], 'called', false, 'initials', 'S'),
      jsonb_build_object('id', v_wait[2], 'called', false, 'initials', 'JP'),
      jsonb_build_object('id', v_wait[3], 'called', false, 'initials', null),
      jsonb_build_object('id', v_wait[4], 'called', false, 'initials', 'É'),
      jsonb_build_object('id', v_wait[5], 'called', false, 'initials', 'ZD'),
      jsonb_build_object('id', v_wait[6], 'called', false, 'initials', 'LM'))
  );

  v_disp := public.display_snapshot(v_queue);
  if v_disp is distinct from v_expect then
    raise exception 'ÉCHEC: sortie walkin différente de 0031.% attendu : % % obtenu  : %',
      E'\n', v_expect, E'\n', v_disp;
  end if;
  raise notice '  ok  walkin : JSON identique à celui de 0031 (clés, valeurs, ordres)';
  perform internal.assert(not (v_disp ? 'profile'), 'walkin : aucune clé profile');
  perform internal.test_absent(v_disp::text, array['NOTE-PRIVEE', 'Thomas', 'Sarah', 'Picard', 'Chloé'],
    'walkin : ni note, ni prénom de la file d''attente, ni quatrième prestation');

  -- Une file event rend la même chose (le module Événements a son écran).
  update public.queues set profile = 'event' where id = v_queue;
  perform internal.assert(public.display_snapshot(v_queue) = v_expect,
    'event : JSON identique à celui de 0031');
  update public.queues set profile = 'walkin' where id = v_queue;

  insert into p14 values ('salon_loc', v_loc::text), ('salon_queue', v_queue::text);
end
$$;

-- =====================================================================
-- 1 et 8. Atelier véhicule : l'immatriculation ne sort que masquée
-- =====================================================================
do $$
declare
  v_owner  uuid := extensions.gen_random_uuid();
  v_prov   jsonb;
  v_org    uuid;
  v_loc    uuid;
  v_queue  uuid;
  v_tech   uuid;
  v_sid    uuid;
  v_freins uuid;
  v_vidange uuid;
  v_v      text[] := '{}';
  v_disp   jsonb;
  v_cols   jsonb;
  v_text   text;
  v_mode   text;
  v_secret constant text[] := array[
    'AB123CD', 'AB-123-CD', 'ab 123-cd', 'AB-123', '1234 AB 75', '1234AB75', 'GH-456-JK', 'GH456JK',
    'LM-789-NP', 'LM789NP', 'XY-321-ZT', 'XY321ZT',
    'Peugeot', 'Clio', 'Tesla', 'Zoe', 'Twingo',
    'Maxime', 'Juliette', 'Octave', 'Rose', 'Anatole',
    'MOTIF-SECRET', 'DEVIS-SECRET', 'NOTE-PRIVEE', 'Freins', 'Vidange', 'Plaquettes'
  ];
begin
  raise notice '';
  raise notice '── 1. Atelier véhicule : immatriculation masquée, rien d''autre ──';

  insert into auth.users (id, email) values (v_owner, 'p14-garage@profils.test');
  v_prov := public.provision_organization(
    v_owner, 'P14 Garage Martin', 'garage', 'Garage Martin — Nanterre', 'shared', 'pro');
  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  perform internal.assert_eq((select profile::text from public.queues where id = v_queue), 'vehicle',
    'un garage est en vehicle');
  perform internal.assert_eq((select profile_options ->> 'tvRegistration' from public.queues where id = v_queue),
    'masked', 'écran : immatriculation masquée par défaut');
  perform public.set_queue_status(v_queue, 'open', v_owner);
  insert into public.staff (organization_id, location_id, display_name)
  values (v_org, v_loc, 'Technicien Karim') returning id into v_tech;
  select id into v_freins from public.services where location_id = v_loc and name = 'Freins';
  select id into v_vidange from public.services where location_id = v_loc and name = 'Vidange';

  -- V1 : déposé par le client lui-même (téléphone), avec motif libre.
  v_sid := (public.upsert_client_session(v_org, 'hash-p14-maxime', 'web', 'Maxime') ->> 'id')::uuid;
  v_v := v_v || (public.join_queue(v_queue, v_sid, 'Maxime', null, v_freins, 'qr', null,
    '{"registration":"ab 123-cd","model":"Peugeot 208","reasonText":"bruit MOTIF-SECRET","stay":"away"}')
    -> 'entry' ->> 'id');
  -- V2 à V5 : fiches créées par la réception.
  v_v := v_v || (public.add_walkin(v_queue, 'Juliette', null, v_freins, v_owner, v_tech,
    '{"registration":"1234 AB 75","model":"Renault Clio","keys":true}') -> 'entry' ->> 'id');
  v_v := v_v || (public.add_walkin(v_queue, 'Octave', null, v_vidange, v_owner, v_tech,
    '{"registration":"GH-456-JK","model":"Tesla Model 3"}') -> 'entry' ->> 'id');
  v_v := v_v || (public.add_walkin(v_queue, 'Rose', null, null, v_owner, v_tech,
    '{"registration":"LM-789-NP","model":"Renault Zoe"}') -> 'entry' ->> 'id');
  v_v := v_v || (public.add_walkin(v_queue, 'Anatole', null, null, v_owner, v_tech,
    '{"registration":"XY-321-ZT","model":"Renault Twingo"}') -> 'entry' ->> 'id');

  -- Une fiche dans chaque colonne, plus un véhicule rendu aujourd'hui.
  perform public.staff_queue_action(v_v[1], 'set_stage', v_owner, v_tech, '{"stage":"diagnosis"}');
  perform public.staff_queue_action(v_v[1], 'send_quote', v_owner, v_tech,
    '{"amountCents":18400,"label":"Plaquettes DEVIS-SECRET"}');
  perform public.staff_queue_action(v_v[1], 'note', v_owner, v_tech, '{"note":"NOTE-PRIVEE client pressé"}');
  perform public.client_queue_action(v_v[1], v_sid, 'quote_accept', '{"quoteN":1}');
  perform public.staff_queue_action(v_v[2], 'set_stage', v_owner, v_tech, '{"stage":"in_repair"}');
  perform public.staff_queue_action(v_v[3], 'set_stage', v_owner, v_tech, '{"stage":"ready"}');
  perform public.staff_queue_action(v_v[5], 'set_stage', v_owner, v_tech, '{"stage":"ready"}');
  perform public.staff_queue_action(v_v[5], 'complete', v_owner, v_tech);

  perform internal.assert(
    (select registration_key from public.queue_entries where public_id = v_v[1]) = 'AB123CD'
      and (select details ->> 'model' from public.queue_entries where public_id = v_v[1]) = 'Peugeot 208',
    'le poste du pro a bien la plaque et le modèle (sinon le test ne prouverait rien)');

  v_disp := public.display_snapshot(v_queue);
  v_text := v_disp::text;
  v_cols := v_disp -> 'workshop' -> 'columns';

  perform internal.assert_eq(internal.test_keys(v_disp),
    array['counts','location','profile','queue','serving','staff','upcoming','workshop'], 'clés de premier niveau');
  perform internal.assert_eq(v_disp ->> 'profile', 'vehicle', 'profile = vehicle');
  perform internal.assert(
    v_disp -> 'staff' = '[]'::jsonb and v_disp -> 'serving' = '[]'::jsonb and v_disp -> 'upcoming' = '[]'::jsonb,
    'listes nominatives de 0031 vides (l''écran d''avant P5 reste cohérent, sans nom)');
  perform internal.assert_eq(internal.test_keys(v_disp -> 'counts'),
    array['active','completedToday','serving','upcoming','waiting'], 'compteurs de 0031 présents');
  perform internal.assert_eq(internal.test_keys(v_disp -> 'workshop'), array['columns','today'], 'clés du bloc atelier');
  perform internal.assert_eq(
    (select array_agg(c ->> 'key' order by n) from jsonb_array_elements(v_cols) with ordinality as t(c, n)),
    array['intake','workshop','waiting','ready'], 'quatre colonnes, dans l''ordre du planning');
  perform internal.assert_eq(
    (select array_agg((c ->> 'total')::int order by n) from jsonb_array_elements(v_cols) with ordinality as t(c, n)),
    array[1, 1, 1, 1], 'une fiche par colonne');
  perform internal.assert_eq(internal.test_keys(v_cols -> 0 -> 'items' -> 0),
    array['deviceKind','id','registration','since','ticketNo'], 'clés d''une ligne d''atelier');
  perform internal.assert_eq(v_cols -> 0 -> 'items' -> 0 ->> 'registration', '••-••9-NP', 'à prendre en charge : ••-••9-NP');
  perform internal.assert_eq(v_cols -> 1 -> 'items' -> 0 ->> 'registration', '•••• •B 75', 'en atelier (FNI) : •••• •B 75');
  perform internal.assert_eq(v_cols -> 2 -> 'items' -> 0 ->> 'registration', '••-••3-CD', 'devis ou pièce : ••-••3-CD');
  perform internal.assert_eq(v_cols -> 3 -> 'items' -> 0 ->> 'registration', '••-••6-JK', 'prêt : ••-••6-JK');
  perform internal.assert_eq(v_cols -> 3 -> 'items' -> 0 ->> 'id', v_v[3], 'prêt : la bonne fiche');
  perform internal.assert_eq(v_disp -> 'workshop' -> 'today',
    jsonb_build_object('received', 5, 'handedOver', 1), 'reçus et rendus aujourd''hui');

  perform internal.assert(position('••-••3-CD' in v_text) > 0, 'le texte contient ••-••3-CD');
  perform internal.test_absent(v_text, v_secret,
    'ni plaque en clair, ni prénom, ni modèle, ni motif, ni devis, ni note');
  perform internal.assert(not (internal.test_all_keys(v_disp) && internal.test_forbidden_keys()),
    'aucune clé details, registrationKey, model, quote, note… à aucune profondeur');
  perform internal.assert(not ('name' = any (internal.test_all_keys(v_disp - 'location'))),
    'aucune clé name hors du nom de l''établissement');
  perform internal.assert(
    position(v_org::text in v_text) = 0 and position(v_loc::text in v_text) = 0
      and position(v_sid::text in v_text) = 0,
    'ni l''organisation, ni l''établissement, ni la session du client');

  -- tvRegistration : 'none' et 'model_only' ne montrent AUCUNE plaque, et
  -- jamais le modèle (décision du propriétaire).
  foreach v_mode in array array['none', 'model_only'] loop
    update public.queues
       set profile_options = profile_options || jsonb_build_object('tvRegistration', v_mode)
     where id = v_queue;
    v_disp := public.display_snapshot(v_queue);
    v_text := v_disp::text;
    perform internal.assert(
      position('•' in v_text) = 0 and position('3-CD' in v_text) = 0 and position('6-JK' in v_text) = 0
        and not exists (
          select 1 from jsonb_array_elements(v_disp -> 'workshop' -> 'columns') c,
                        jsonb_array_elements(c -> 'items') it
          where it -> 'registration' <> 'null'::jsonb),
      format('tvRegistration = %s : aucune immatriculation, même masquée', v_mode));
    perform internal.test_absent(v_text, v_secret, format('tvRegistration = %s : ni modèle ni prénom', v_mode));
  end loop;
  update public.queues
     set profile_options = profile_options || '{"tvRegistration":"masked"}'
   where id = v_queue;

  raise notice '';
  raise notice '── 8. Journal : aucun événement ne porte l''immatriculation ──';
  perform internal.assert(
    (select count(*) from public.queue_events where queue_id = v_queue and event_type = 'stage') >= 9,
    'les événements d''étape existent (sinon le test ne prouverait rien)');
  perform internal.test_absent(
    (select string_agg(payload::text || coalesce(entry_public_id, ''), ' ') from public.queue_events where queue_id = v_queue),
    array['AB123CD', 'AB-123-CD', 'ab 123-cd', '1234 AB 75', '1234AB75', 'GH-456-JK', 'LM-789-NP', 'XY-321-ZT',
          'Peugeot', 'Clio', 'Tesla'],
    'aucun événement (étape, devis, inscription…) ne contient la plaque ni le modèle');
  perform internal.assert(
    not exists (select 1 from public.queue_events
                where queue_id = v_queue and event_type = 'stage'
                  and exists (select 1 from jsonb_object_keys(payload) k
                              where k not in ('from', 'to', 'notify', 'realigned'))),
    'un événement d''étape ne porte que from, to, notify (et realigned)');

  insert into p14 values
    ('garage_org', v_org::text), ('garage_loc', v_loc::text), ('garage_queue', v_queue::text),
    ('garage_owner', v_owner::text), ('garage_tech', v_tech::text),
    ('v1', v_v[1]), ('v2', v_v[2]), ('v3', v_v[3]), ('v4', v_v[4]), ('v5', v_v[5]);
end
$$;

-- =====================================================================
-- Atelier appareil : numéro de dossier et pictogramme, jamais le modèle
-- =====================================================================
do $$
declare
  v_owner uuid := extensions.gen_random_uuid();
  v_prov  jsonb;
  v_queue uuid;
  v_id    text;
  v_disp  jsonb;
  v_item  jsonb;
begin
  raise notice '';
  raise notice '── Atelier appareil : dossier et type d''appareil seulement ──';
  insert into auth.users (id, email) values (v_owner, 'p14-phone@profils.test');
  v_prov := public.provision_organization(v_owner, 'P14 PhoneFix', 'phone_repair', 'PhoneFix Lille', 'shared', 'pro');
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  perform public.set_queue_status(v_queue, 'open', v_owner);
  v_id := public.add_walkin(v_queue, 'Salomé', null, null, v_owner, null,
    '{"deviceKind":"phone","model":"iPhone 13 mini"}') -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_id, 'set_stage', v_owner, null, '{"stage":"ready"}');

  v_disp := public.display_snapshot(v_queue);
  v_item := v_disp -> 'workshop' -> 'columns' -> 3 -> 'items' -> 0;
  perform internal.assert_eq(v_disp ->> 'profile', 'device', 'profile = device');
  perform internal.assert_eq(v_item ->> 'ticketNo', '0001', 'dossier 0001');
  perform internal.assert_eq(v_item ->> 'deviceKind', 'phone', 'pictogramme : téléphone');
  perform internal.assert(v_item -> 'registration' = 'null'::jsonb, 'aucune immatriculation en atelier appareil');
  perform internal.test_absent(v_disp::text, array['iPhone', 'Salomé'], 'ni le modèle ni le prénom');
  perform internal.assert(not (internal.test_all_keys(v_disp) && internal.test_forbidden_keys()),
    'aucune clé interdite');
end
$$;

-- =====================================================================
-- 2. Guichet : jamais de prénom, en santé comme ailleurs
-- =====================================================================
do $$
declare
  v_owner  uuid := extensions.gen_random_uuid();
  v_prov   jsonb;
  v_org    uuid;
  v_loc    uuid;
  v_queue  uuid;
  v_desk3  uuid;
  v_box2   uuid;
  v_sid    uuid;
  v_ids    text[] := '{}';
  v_disp   jsonb;
  v_text   text;
  v_row    jsonb;
  v_pass   int;
  i        int;
  v_names  constant text[] := array['Bernadette', 'Gérard', 'Yolande', 'Firmin', 'Clotilde'];
begin
  raise notice '';
  raise notice '── 2. Guichet (santé) : un numéro et un guichet, jamais un prénom ──';
  insert into auth.users (id, email) values (v_owner, 'p14-sante@profils.test');
  v_prov := public.provision_organization(
    v_owner, 'P14 Centre de prélèvements', 'health', 'Laboratoire Gambetta', 'shared', 'pro');
  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  perform internal.assert(
    (select profile = 'desk' and (profile_options ->> 'sensitive')::boolean from public.queues where id = v_queue),
    'santé : desk + sensitive');
  perform public.set_queue_status(v_queue, 'open', v_owner);
  insert into public.staff (organization_id, location_id, display_name, desk_label, sort_order)
  values (v_org, v_loc, 'Poste Martine', 'Guichet 3', 1) returning id into v_desk3;
  insert into public.staff (organization_id, location_id, display_name, sort_order)
  values (v_org, v_loc, 'Box 2', 2) returning id into v_box2;

  for i in 1..5 loop
    v_sid := (public.upsert_client_session(v_org, 'hash-p14-sante-' || i, 'web', v_names[i]) ->> 'id')::uuid;
    v_ids := v_ids || (public.join_queue(v_queue, v_sid, v_names[i], null,
      (select id from public.services where location_id = v_loc order by sort_order limit 1), 'qr')
      -> 'entry' ->> 'id');
  end loop;
  -- Le prénom est FORCÉ en base : la garantie ne doit pas dépendre de ce
  -- que join_queue accepte ou non en santé.
  update public.queue_entries e
     set client_name = v_names[array_position(v_ids, e.public_id)] || '-SECRET'
   where e.queue_id = v_queue;
  perform internal.assert(
    (select count(*) from public.queue_entries where queue_id = v_queue and client_name like '%-SECRET') = 5,
    'client_name renseigné sur les cinq tickets');

  perform public.desk_call_next(v_queue, v_desk3, v_owner);
  perform public.desk_call_next(v_queue, v_box2, v_owner);
  perform public.staff_queue_action(v_ids[1], 'start_serving', v_owner, v_desk3);
  perform public.staff_queue_action(v_ids[1], 'complete', v_owner, v_desk3);
  perform public.staff_queue_action(v_ids[2], 'recall', v_owner, v_box2);

  for v_pass in 1..2 loop
    if v_pass = 2 then
      -- Même si la file demande le prénom et n'est plus « sensible ».
      update public.queues
         set ask_client_name = true,
             profile_options = profile_options || '{"sensitive":false}'
       where id = v_queue;
    end if;
    v_disp := public.display_snapshot(v_queue);
    v_text := v_disp::text;
    perform internal.assert_eq(internal.test_keys(v_disp),
      array['counts','desks','location','profile','queue','serving','staff','upcoming'],
      format('passe %s : clés de premier niveau', v_pass));
    perform internal.test_absent(v_text,
      array['SECRET', 'Bernadette', 'Gérard', 'Yolande', 'Firmin', 'Clotilde', 'Accueil', 'Poste Martine'],
      format('passe %s : aucun prénom, aucun motif', v_pass));
    perform internal.assert(not (internal.test_all_keys(v_disp) && internal.test_forbidden_keys())
                              and not ('name' = any (internal.test_all_keys(v_disp - 'location'))),
      format('passe %s : aucune clé de nom ni clé interdite', v_pass));
  end loop;

  perform internal.assert_eq(internal.test_keys(v_disp -> 'desks'), array['counts','current','recent'],
    'clés du tableau d''appel');
  perform internal.assert_eq(internal.test_keys(v_disp -> 'desks' -> 'current' -> 0),
    array['calledAt','deskLabel','id','ticketNo'], 'clés d''un appel');
  perform internal.assert(
    exists (select 1 from jsonb_array_elements(v_disp -> 'desks' -> 'current') c
            where c ->> 'ticketNo' = 'A-002' and c ->> 'deskLabel' = 'Box 2'),
    'appel en cours : A-002 → Box 2 (repli sur le nom de la fiche)');
  perform internal.assert(
    exists (select 1 from jsonb_array_elements(v_disp -> 'desks' -> 'current') c
            where c ->> 'ticketNo' = 'A-003' and c ->> 'deskLabel' = 'Guichet 3'),
    'Terminer au guichet 3 appelle le suivant au même guichet : A-003 → Guichet 3');
  perform internal.assert(
    exists (select 1 from jsonb_array_elements(v_disp -> 'desks' -> 'recent') c
            where c ->> 'ticketNo' = 'A-001' and c ->> 'deskLabel' = 'Guichet 3'),
    'derniers appels : A-001 → Guichet 3');
  perform internal.assert_eq(v_disp -> 'desks' -> 'counts',
    jsonb_build_object('waiting', 2, 'called', 2, 'servedToday', 1), 'compteurs du guichet');

  insert into p14 values ('health_loc', v_loc::text), ('desk3', v_desk3::text);
end
$$;

-- =====================================================================
-- Restaurant : « Table prête », numéro et couverts
-- =====================================================================
do $$
declare
  v_owner uuid := extensions.gen_random_uuid();
  v_prov  jsonb;
  v_loc   uuid;
  v_queue uuid;
  v_karim text;
  v_lea   text;
  v_nemo  text;
  v_num   text;
  v_disp  jsonb;
  v_row   jsonb;
begin
  raise notice '';
  raise notice '── Restaurant : tables prêtes ──';
  insert into auth.users (id, email) values (v_owner, 'p14-resto@profils.test');
  v_prov := public.provision_organization(v_owner, 'P14 Chez Paul', 'restaurant', 'Chez Paul', 'shared', 'pro');
  v_loc   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  perform public.set_queue_status(v_queue, 'open', v_owner);

  v_karim := public.add_walkin(v_queue, 'Karim', null, null, v_owner, null, '{"partySize":4,"seating":"terrace"}') -> 'entry' ->> 'id';
  v_lea   := public.add_walkin(v_queue, 'Léa', null, null, v_owner, null, '{"partySize":2,"needs":["highchair"]}') -> 'entry' ->> 'id';
  v_nemo  := public.add_walkin(v_queue, 'Némo', null, null, v_owner, null) -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_karim, 'call', v_owner, null);

  v_disp := public.display_snapshot(v_queue);
  v_row := v_disp -> 'tables' -> 'ready' -> 0;
  perform internal.assert_eq(v_disp ->> 'profile', 'table', 'profile = table');
  perform internal.assert_eq(internal.test_keys(v_disp -> 'tables'), array['counts','ready'], 'clés du bloc table');
  perform internal.assert_eq(v_row, jsonb_build_object(
      'id', v_karim, 'ticketNo', null, 'name', 'Karim', 'partySize', 4,
      'calledAt', v_row -> 'calledAt'),
    'Table prête : Karim · 4 (file sans numéro : le prénom que l''accueil appelle)');
  perform internal.assert_eq(v_disp -> 'tables' -> 'counts', jsonb_build_object(
      'groupsWaiting', 2, 'coversWaiting', 3, 'groupsCalled', 1,
      'groupsSeatedToday', 0, 'coversSeatedToday', 0),
    'deux groupes, trois couverts en attente (un groupe sans taille compte pour un)');
  perform internal.test_absent(v_disp::text, array['Léa', 'Némo', 'terrace', 'highchair'],
    'ni les prénoms de l''attente, ni les préférences');

  -- Numérotée, la file n'envoie plus que le numéro.
  update public.queues set profile_options = profile_options || '{"numbering":true}' where id = v_queue;
  v_num := public.add_walkin(v_queue, 'Zacharie', null, null, v_owner, null, '{"partySize":6}') -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_karim, 'complete', v_owner, null);
  perform public.staff_queue_action(v_num, 'call', v_owner, null);
  v_disp := public.display_snapshot(v_queue);
  v_row := v_disp -> 'tables' -> 'ready' -> 0;
  perform internal.assert(v_row ->> 'ticketNo' = 'A-001' and v_row -> 'name' = 'null'::jsonb
                            and (v_row ->> 'partySize')::int = 6,
    'file numérotée : A-001 · 6, sans prénom');
  perform internal.test_absent(v_disp::text, array['Zacharie', 'Karim'], 'aucun prénom dès qu''un numéro existe');
  perform internal.assert_eq(
    (v_disp -> 'tables' -> 'counts' ->> 'coversSeatedToday')::int, 4, 'Karim installé : 4 couverts aujourd''hui');

  -- File sensible sans numéro : les initiales seulement. Et une taille de
  -- groupe illisible (écrite hors de clean_details) ne fige pas l'écran :
  -- le groupe compte pour un couvert.
  update public.queues
     set profile_options = profile_options || '{"numbering":false,"sensitive":true}'
   where id = v_queue;
  perform public.staff_queue_action(v_lea, 'call', v_owner, null);
  update public.queue_entries set details = '{"partySize":"beaucoup"}' where public_id = v_nemo;
  v_disp := public.display_snapshot(v_queue);
  perform internal.assert(
    exists (select 1 from jsonb_array_elements(v_disp -> 'tables' -> 'ready') r
            where r ->> 'id' = v_lea and r ->> 'name' = 'L' and (r ->> 'partySize')::int = 2),
    'file sensible : L · 2, les initiales seulement');
  perform internal.test_absent(v_disp::text, array['Léa', 'Némo', 'beaucoup'], 'file sensible : aucun prénom');
  perform internal.assert_eq((v_disp -> 'tables' -> 'counts' ->> 'coversWaiting')::int, 1,
    'taille illisible : l''écran répond, le groupe compte pour un couvert');

  insert into p14 values ('resto_loc', v_loc::text);
end
$$;

-- =====================================================================
-- Boutique : commandes prêtes, fin du numéro de commande seulement
-- =====================================================================
do $$
declare
  v_owner uuid := extensions.gen_random_uuid();
  v_prov  jsonb;
  v_queue uuid;
  v_order text;
  v_disp  jsonb;
begin
  raise notice '';
  raise notice '── Boutique : commandes prêtes ──';
  insert into auth.users (id, email) values (v_owner, 'p14-shop@profils.test');
  v_prov := public.provision_organization(v_owner, 'P14 Boutique', 'shop', 'Boutique Oberkampf', 'shared', 'pro');
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  perform public.set_queue_status(v_queue, 'open', v_owner);
  v_order := public.add_walkin(v_queue, 'Capucine', null, null, v_owner, null,
    '{"orderRef":"CMD-2026-88731"}') -> 'entry' ->> 'id';
  perform public.add_walkin(v_queue, 'Hector', null, null, v_owner, null);
  perform public.staff_queue_action(v_order, 'set_stage', v_owner, null, '{"stage":"preparing"}');
  perform public.staff_queue_action(v_order, 'set_stage', v_owner, null, '{"stage":"ready"}');

  v_disp := public.display_snapshot(v_queue);
  perform internal.assert_eq(v_disp ->> 'profile', 'retail', 'profile = retail');
  perform internal.assert_eq(internal.test_keys(v_disp -> 'pickup'), array['calls','counts','ready'], 'clés du bloc boutique');
  perform internal.assert_eq(v_disp -> 'pickup' -> 'ready' -> 0 ->> 'orderTail', '8731', 'commande prête : n° …8731');
  perform internal.assert_eq(v_disp -> 'pickup' -> 'counts',
    jsonb_build_object('waiting', 1, 'preparing', 0, 'ready', 1), 'compteurs de la boutique');
  perform internal.test_absent(v_disp::text, array['CMD-2026', '88731', 'Capucine', 'Hector'],
    'ni le numéro de commande entier, ni un prénom');
end
$$;

-- =====================================================================
-- 7. details de plus de 2 Ko : refusé par la contrainte
-- =====================================================================
do $$
declare
  v_big jsonb;
begin
  raise notice '';
  raise notice '── 7. details plafonné à 2 Ko ──';
  -- Texte peu compressible (empreintes md5) : la taille mesurée est la vraie.
  select jsonb_build_object('model', string_agg(md5(i::text), '')) into v_big from generate_series(1, 80) i;
  begin
    update public.queue_entries set details = v_big
     where public_id = (select v from p14 where k = 'v4');
    raise exception 'ÉCHEC: details de % octets accepté', pg_column_size(v_big);
  exception when check_violation then
    raise notice '  ok  details de % octets : violation de contrainte', pg_column_size(v_big);
  end;
end
$$;

-- =====================================================================
-- Statistiques par profil
-- =====================================================================
do $$
declare
  v_garage_loc uuid := (select v from p14 where k = 'garage_loc')::uuid;
  v_garage_q   uuid := (select v from p14 where k = 'garage_queue')::uuid;
  v_v1  uuid := (select id from public.queue_entries where public_id = (select v from p14 where k = 'v1'));
  v_v3  uuid := (select id from public.queue_entries where public_id = (select v from p14 where k = 'v3'));
  v_v5  uuid := (select id from public.queue_entries where public_id = (select v from p14 where k = 'v5'));
  v_owner uuid := extensions.gen_random_uuid();
  v_prov  jsonb;
  v_loc   uuid;
  v_queue uuid;
  v_id    text;
  v_stats jsonb;
  v_block jsonb;
  v_text  text;
  i       int;
begin
  raise notice '';
  raise notice '── Statistiques par profil ──';

  -- Atelier : V5 déposé il y a 3 h, prêt il y a 1 h, rendu maintenant.
  update public.queue_entries set joined_at = now() - interval '3 hours' where id = v_v5;
  update public.queue_events set created_at = now() - interval '3 hours'
   where entry_id = v_v5 and event_type = 'stage' and payload ->> 'to' = 'received';
  update public.queue_events set created_at = now() - interval '1 hour'
   where entry_id = v_v5 and event_type = 'stage' and payload ->> 'to' = 'ready';
  -- V3 prêt depuis 25 h et jamais venu le chercher.
  update public.queue_entries set stage_changed_at = now() - interval '25 hours' where id = v_v3;
  -- V1 a reçu au moins une notification (joignable).
  insert into public.notification_deliveries (organization_id, queue_entry_id, kind, status)
  select organization_id, id, 'quote_ready', 'sent' from public.queue_entries where id = v_v1;

  v_stats := public.profile_stats(v_garage_loc, now() - interval '1 day', now() + interval '1 minute');
  v_block := v_stats -> 'byProfile' -> 'vehicle';
  perform internal.assert_eq(internal.test_keys(v_stats), array['byProfile','range'], 'clés de profile_stats');
  perform internal.assert_eq(internal.test_keys(v_stats -> 'byProfile'), array['vehicle'], 'un bloc : vehicle');
  perform internal.assert_eq((v_block ->> 'dropped')::int, 5, 'cinq véhicules déposés');
  perform internal.assert_eq((v_block ->> 'handedOver')::int, 1, 'un rendu');
  -- Premiers « prêt » : V3 (0 s) et V5 (7 200 s) : médiane 3 600 s.
  perform internal.assert_eq((v_block ->> 'medianDropToReadySeconds')::numeric, 3600::numeric,
    'délai médian du dépôt à « prêt »');
  perform internal.assert_eq((v_block ->> 'medianReadyToPickupSeconds')::numeric, 3600::numeric,
    'délai médian de « prêt » au rendu');
  perform internal.assert_eq((v_block -> 'medianSecondsByStage' ->> 'ready')::numeric, 3600::numeric,
    'temps médian à l''étape « prêt » (intervalles fermés seulement)');
  perform internal.assert_eq(v_block -> 'quote', jsonb_build_object(
      'sent', 1, 'accepted', 1, 'declined', 0, 'acceptanceRate', 100.0, 'medianDecisionSeconds', 0),
    'devis : envoyé, accepté');
  perform internal.assert_eq((v_block ->> 'readyNotCollected24h')::int, 1, 'un véhicule prêt depuis plus de 24 h');
  perform internal.assert_eq((v_block ->> 'reachableRate')::numeric, 20.0, 'joignables : 1 sur 5');
  perform internal.assert_eq(v_block -> 'byReason' -> 0 ->> 'name', 'Freins', 'premier motif : Freins');
  perform internal.assert_eq((v_block -> 'byReason' -> 0 ->> 'count')::int, 2, 'Freins : deux véhicules');
  perform internal.test_absent(v_stats::text,
    array['AB-123-CD', 'AB123CD', 'Peugeot', 'Maxime', 'Juliette', 'DEVIS-SECRET', 'MOTIF-SECRET'],
    'statistiques : ni plaque, ni modèle, ni prénom, ni devis');

  -- Un barbier n'a pas de bloc : location_stats reste sa seule source.
  v_stats := public.profile_stats((select v from p14 where k = 'salon_loc')::uuid);
  perform internal.assert_eq(v_stats -> 'byProfile', '{}'::jsonb, 'barbier : aucun bloc de profil');
  perform internal.assert(public.profile_stats(extensions.gen_random_uuid()) is null, 'établissement inconnu : null');

  -- Restaurant : Karim (4 couverts) installé.
  v_block := public.profile_stats((select v from p14 where k = 'resto_loc')::uuid,
                                  now() - interval '1 day', now() + interval '1 minute') -> 'byProfile' -> 'table';
  perform internal.assert(
    (v_block ->> 'groupsSeated')::int = 1 and (v_block ->> 'coversSeated')::int = 4,
    'restaurant : un groupe installé, quatre couverts');
  perform internal.assert_eq(
    (select array_agg(b ->> 'size' order by n) from jsonb_array_elements(v_block -> 'medianWaitByPartySize') with ordinality t(b, n)),
    array['1-2','3-4','5-6','7+'], 'attente médiane par taille de groupe');

  -- Guichet : débit par guichet, sous son libellé public.
  v_block := public.profile_stats((select v from p14 where k = 'health_loc')::uuid,
                                  now() - interval '1 day', now() + interval '1 minute') -> 'byProfile' -> 'desk';
  perform internal.assert_eq(v_block -> 'byDesk' -> 0 ->> 'label', 'Guichet 3', 'guichet : « Guichet 3 »');
  perform internal.assert_eq((v_block ->> 'recalls')::int, 1, 'un rappel');
  perform internal.test_absent(v_block::text, array['SECRET', 'Bernadette'], 'guichet : aucun prénom');

  -- Changement de profil : les passages d'avant ne deviennent pas des
  -- véhicules. Un barbier sert deux clients, puis essaie le poste garage.
  insert into auth.users (id, email) values (v_owner, 'p14-essai@profils.test');
  v_prov := public.provision_organization(v_owner, 'P14 Essai', 'barber', 'Essai Montreuil', 'shared', 'pro');
  v_loc   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  perform public.set_queue_status(v_queue, 'open', v_owner);
  for i in 1..2 loop
    v_id := public.add_walkin(v_queue, 'Client ' || i, null, null, v_owner, null) -> 'entry' ->> 'id';
    perform public.staff_queue_action(v_id, 'start_serving', v_owner, null);
    perform public.staff_queue_action(v_id, 'complete', v_owner, null);
  end loop;
  update public.queue_entries set joined_at = now() - interval '2 hours' where queue_id = v_queue;
  perform public.switch_queue_profile(v_queue, 'vehicle', v_owner);
  perform public.add_walkin(v_queue, 'Nouveau', null, null, v_owner, null, '{"registration":"AA-001-AA"}');
  v_block := public.profile_stats(v_loc, now() - interval '1 day', now() + interval '1 minute') -> 'byProfile' -> 'vehicle';
  perform internal.assert_eq((v_block ->> 'dropped')::int, 1,
    'après changement de profil : seuls les tickets inscrits depuis comptent');
end
$$;

-- =====================================================================
-- 4. Purge : l'immatriculation part avec le prénom
-- =====================================================================
do $$
declare
  v_owner uuid := (select v from p14 where k = 'garage_owner')::uuid;
  v_tech  uuid := (select v from p14 where k = 'garage_tech')::uuid;
  v_queue uuid := (select v from p14 where k = 'garage_queue')::uuid;
  v_live  text := (select v from p14 where k = 'v4');
  v_id    text;
  v_row   public.queue_entries;
begin
  raise notice '';
  raise notice '── 4. Purge : details, immatriculation, jeton et prénom ──';
  v_id := public.add_walkin(v_queue, 'Philémon', null, null, v_owner, v_tech,
    '{"registration":"QR-555-ST","model":"Citroën C3"}') -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_id, 'set_claim', v_owner, v_tech,
    jsonb_build_object('tokenHash', encode(extensions.digest('p14-jeton', 'sha256'), 'hex'), 'ttlMinutes', 60));
  perform public.staff_queue_action(v_id, 'set_stage', v_owner, v_tech, '{"stage":"ready"}');
  perform public.staff_queue_action(v_id, 'complete', v_owner, v_tech);
  -- Le jeton est reposé en base : la purge doit l'effacer, quel que soit
  -- le chemin qui l'aurait laissé.
  update public.queue_entries
     set claim_token_hash = encode(extensions.digest('p14-jeton', 'sha256'), 'hex'),
         claim_expires_at = now() + interval '1 hour',
         completed_at = now() - interval '400 days',
         joined_at = now() - interval '401 days'
   where public_id = v_id;
  -- Un véhicule ENCORE à l'atelier, inscrit il y a longtemps : intouchable.
  update public.queue_entries set joined_at = now() - interval '400 days' where public_id = v_live;

  select * into v_row from public.queue_entries where public_id = v_id;
  perform internal.assert(v_row.registration_key = 'QR555ST' and v_row.claim_token_hash is not null
                            and v_row.client_name = 'Philémon' and v_row.details <> '{}'::jsonb,
    'avant la purge : plaque, jeton, prénom et details présents');

  perform public.purge_expired_data();

  select * into v_row from public.queue_entries where public_id = v_id;
  perform internal.assert_eq(v_row.details, '{}'::jsonb, 'details vidé');
  perform internal.assert(v_row.registration_key is null, 'registration_key effacée');
  perform internal.assert(v_row.claim_token_hash is null and v_row.claim_expires_at is null, 'jeton de suivi effacé');
  perform internal.assert(v_row.client_name is null and v_row.client_session_id is null, 'prénom et session effacés');
  select * into v_row from public.queue_entries where public_id = v_live;
  perform internal.assert(v_row.registration_key = 'LM789NP' and v_row.client_name = 'Rose',
    'un véhicule encore en atelier n''est pas anonymisé');
end
$$;

-- =====================================================================
-- 5. RLS : chacun chez soi, anon nulle part
-- =====================================================================
do $$
declare
  v_org     uuid := (select v from p14 where k = 'garage_org')::uuid;
  v_loc     uuid := (select v from p14 where k = 'garage_loc')::uuid;
  v_queue   uuid := (select v from p14 where k = 'garage_queue')::uuid;
  v_owner   uuid := (select v from p14 where k = 'garage_owner')::uuid;
  v_rival   uuid := extensions.gen_random_uuid();
  v_n       int;
  v_role    text;
begin
  raise notice '';
  raise notice '── 5. RLS : modèles de messages et details ──';
  insert into auth.users (id, email) values (v_rival, 'p14-rival@profils.test');
  perform public.provision_organization(v_rival, 'P14 Garage Rival', 'garage', 'Rival Puteaux', 'shared', 'pro');
  insert into public.message_templates (organization_id, location_id, profile, key, label, body)
  values (v_org, v_loc, 'vehicle', 'retard', 'Retard', 'Votre véhicule sera prêt demain matin.');

  -- Témoin : le professionnel du garage lit ses modèles et ses fiches.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.message_templates where organization_id = v_org;
  reset role;
  perform internal.assert_eq(v_n, 1, 'témoin : le garage lit son modèle');
  set local role authenticated;
  select count(*) into v_n from public.queue_entries where queue_id = v_queue and details ? 'registration';
  reset role;
  perform internal.assert(v_n >= 4, 'témoin : le garage lit les details de ses fiches');

  -- Un membre d'une autre organisation : rien.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_rival, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.message_templates where organization_id = v_org;
  reset role;
  perform internal.assert_eq(v_n, 0, 'un autre garage ne lit pas les modèles');
  set local role authenticated;
  select count(*) into v_n from public.queue_entries where queue_id = v_queue;
  reset role;
  perform internal.assert_eq(v_n, 0, 'un autre garage ne lit ni les fiches ni leurs details');
  set local role authenticated;
  select count(*) into v_n from public.queue_ticket_counters;
  reset role;
  perform internal.assert_eq(v_n, 0, 'un autre garage ne lit pas les compteurs des autres');

  -- anon : refus, ou rien.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  foreach v_role in array array['public.message_templates', 'public.queue_entries', 'public.queue_ticket_counters'] loop
    begin
      set local role anon;
      execute format('select count(*) from %s', v_role) into v_n;
      reset role;
      perform internal.assert_eq(v_n, 0, format('anon ne lit rien dans %s', v_role));
    exception when insufficient_privilege then
      reset role;
      raise notice '  ok  anon : lecture de % refusée', v_role;
    end;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- =====================================================================
-- 6. Droits : jamais appelables depuis le navigateur
-- =====================================================================
do $$
declare
  v_fn   text;
  v_role text;
begin
  raise notice '';
  raise notice '── 6. Droits ──';
  foreach v_fn in array array[
    'public.display_snapshot(uuid)',
    'public.profile_stats(uuid,timestamptz,timestamptz)',
    'public.claim_entry(text,uuid)',
    'public.peek_claim(text)',
    'public.desk_call_next(uuid,uuid,uuid)',
    'public.claim_entry_notification_key(uuid,text)'
  ] loop
    perform internal.assert(
      has_function_privilege('service_role', v_fn, 'execute')
        and not has_function_privilege('anon', v_fn, 'execute')
        and not has_function_privilege('authenticated', v_fn, 'execute'),
      format('%s : service_role seulement', v_fn));
  end loop;

  foreach v_fn in array array[
    'public.display_snapshot(uuid)',
    'public.profile_stats(uuid,timestamptz,timestamptz)'
  ] loop
    perform internal.assert(
      (select prosecdef and proconfig @> array['search_path=public, internal, extensions']
         from pg_proc where oid = v_fn::regprocedure),
      format('%s : security definer, search_path figé', v_fn));
  end loop;

  foreach v_fn in array array[
    'internal.display_workshop(public.queues,timestamptz)',
    'internal.display_tables(public.queues,timestamptz)',
    'internal.display_desks(public.queues,timestamptz)',
    'internal.display_pickup(public.queues,timestamptz)',
    'internal.display_desk_label(uuid,uuid)',
    'internal.profile_stats_entries(uuid,public.queue_profile,timestamptz,timestamptz)',
    'internal.profile_stats_workshop(uuid,public.queue_profile,timestamptz,timestamptz)'
  ] loop
    perform internal.assert(
      not has_function_privilege('anon', v_fn, 'execute')
        and not has_function_privilege('authenticated', v_fn, 'execute'),
      format('%s : fermée au navigateur', v_fn));
  end loop;

  -- Et l'appel réel est refusé.
  foreach v_role in array array['anon', 'authenticated'] loop
    begin
      execute format('set local role %I', v_role);
      perform public.profile_stats(extensions.gen_random_uuid());
      raise exception 'ÉCHEC: % a exécuté profile_stats', v_role;
    exception when insufficient_privilege then
      raise notice '  ok  profile_stats refusée pour %', v_role;
    end;
    reset role;
    begin
      execute format('set local role %I', v_role);
      perform public.display_snapshot(extensions.gen_random_uuid());
      raise exception 'ÉCHEC: % a exécuté display_snapshot', v_role;
    exception when insufficient_privilege then
      raise notice '  ok  display_snapshot refusée pour %', v_role;
    end;
    reset role;
  end loop;

  raise notice '';
  raise notice '✅ Profils métier (confidentialité, écran, statistiques) : tous les tests passent.';
end
$$;

rollback;
