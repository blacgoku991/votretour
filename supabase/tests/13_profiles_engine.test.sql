-- =====================================================================
-- Rangvia — suite de tests du moteur des profils métier (0032 à 0037)
-- ---------------------------------------------------------------------
-- Rejoue les 17 cas de conception (atelier, guichet, table, avis
-- différé, messages…) et vérifie les garanties de non-régression :
--   * une file créée avant 0033 reste walkin ;
--   * join_queue accepte toujours les 7 arguments d'aujourd'hui, nommés
--     (forme exacte de server/queue.ts) comme positionnels ;
--   * create_location donne à chaque activité le profil attendu, et
--     n'ajoute rien à un barbier ;
--   * en walkin, chaque clé JSON ajoutée porte une valeur neutre ;
--   * switch_queue_profile se contrôle sous verrou de file : lancé en
--     même temps qu'une inscription, il perd proprement (VT017) ; un
--     aller-retour de profil rétablit le poste d'avant ;
--   * deux rattachements simultanés du même QR : un seul gagne ; un devis
--     renvoyé pendant que le client accepte l'ancien : accord refusé ;
--   * l'écran TV (queue_snapshot par défaut) ne reçoit aucune information
--     métier ; au guichet, le prénom n'est pas demandé par défaut ;
--     review = false coupe vraiment l'avis ;
--   * la purge RGPD ne touche jamais un ticket en cours, et compte la
--     rétention d'un ticket à étape depuis sa fin ;
--   * en boutique, une commande suivie reste suivie quand elle repasse en
--     attente (pas de 23505).
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

-- Depuis 0042, une file naît toujours au passage : le métier est attribué
-- ensuite par l'équipe Rangvia (switch_queue_profile, via l'action
-- super-admin). Ce test exerce le moteur de chaque métier : il provisionne
-- comme un commerçant, puis installe le métier de l'activité exactement
-- comme create_location le faisait en 0037 (réglages par défaut du métier
-- et motifs, sans ligne de journal : la file n'a « quitté » aucun métier).
create or replace function internal.test_provision_metier(
  p_user_id       uuid,
  p_org_name      text,
  p_activity      public.activity_type default 'other',
  p_location_name text default null,
  p_queue_mode    public.queue_mode default 'shared',
  p_plan_code     text default 'starter'
) returns jsonb
language plpgsql
as $$
declare
  v_prov    jsonb := public.provision_organization(
    p_user_id, p_org_name, p_activity, p_location_name, p_queue_mode, p_plan_code);
  v_profile public.queue_profile := internal.default_profile(p_activity);
  v_queue   public.queues;
begin
  if v_prov -> 'queue' ->> 'id' is not null and v_profile <> 'walkin' then
    perform internal.apply_profile_defaults((v_prov -> 'queue' ->> 'id')::uuid, v_profile, p_activity);
    perform internal.seed_default_services((v_prov -> 'location' ->> 'id')::uuid, v_profile);
    select * into v_queue from public.queues where id = (v_prov -> 'queue' ->> 'id')::uuid;
    v_prov := jsonb_set(v_prov, '{queue,profile}', to_jsonb(v_queue.profile::text));
    v_prov := jsonb_set(v_prov, '{queue,mode}', to_jsonb(v_queue.mode::text));
  end if;
  return v_prov;
end;
$$;


-- Identifiants partagés entre les blocs (session psql uniquement).
create temp table p13 (k text primary key, v text not null);

-- =====================================================================
do $$
declare
  v_owner    uuid := extensions.gen_random_uuid();
  v_rival    uuid := extensions.gen_random_uuid();
  v_act      public.activity_type;
  v_prov     jsonb;
  v_expected text;
  v_queue    public.queues;
  v_q        jsonb := '{}'::jsonb;   -- activité -> file
  v_l        jsonb := '{}'::jsonb;   -- activité -> établissement
  v_o        jsonb := '{}'::jsonb;   -- activité -> organisation
  v_rival_org uuid;
  v_barber   uuid;
  v_garage   uuid;
  v_auto     uuid;
  v_device   uuid;
  v_resto    uuid;
  v_desk     uuid;
  v_health   uuid;
  v_shop     uuid;
  v_old      uuid;
  v_k1       uuid;
  v_k2       uuid;
  v_tech     uuid;
  v_g1       uuid;
  v_g2       uuid;
  v_s        uuid[] := array[]::uuid[];
  v_rival_s  uuid;
  v_res      jsonb;
  v_state    jsonb;
  v_keys     text[];
  v_v1       text;
  v_v2       text;
  v_v3       text;
  v_v4       text;
  v_v5       text;
  v_v6       text;
  v_d        text[] := array[]::text[];
  v_t        text[] := array[]::text[];
  v_w        text;
  v_x        text;
  v_id       uuid;
  v_n        int;
  v_hash1    text := encode(extensions.digest('p13-jeton-1', 'sha256'), 'hex');
  v_hash2    text := encode(extensions.digest('p13-jeton-2', 'sha256'), 'hex');
  v_hash3    text := encode(extensions.digest('p13-jeton-3', 'sha256'), 'hex');
  i          int;
begin
  raise notice '';
  raise notice '══ Profils métier : moteur ══';

  insert into auth.users (id, email) values
    (v_owner, 'p13-owner@profils.test'),
    (v_rival, 'p13-rival@profils.test');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 1. Provisionnement : chaque activité reçoit son profil ──';

  for v_act in select unnest(enum_range(null::public.activity_type)) loop
    -- Tableau attendu écrit ici en clair, indépendamment du moteur.
    v_expected := case v_act::text
      when 'garage' then 'vehicle'      when 'auto_center' then 'vehicle'
      when 'phone_repair' then 'device' when 'aftersales' then 'device'
      when 'restaurant' then 'table'
      when 'counter' then 'desk'        when 'admin_service' then 'desk'
      when 'health' then 'desk'
      when 'shop' then 'retail'
      when 'event' then 'event'
      else 'walkin'
    end;
    -- 'per_staff' demandé partout : seuls walkin et event le gardent.
    v_prov := internal.test_provision_metier(
      v_owner, 'P13 ' || v_act::text, v_act, 'P13 ' || v_act::text || ' Centre', 'per_staff', 'pro');
    select * into v_queue from public.queues where id = (v_prov -> 'queue' ->> 'id')::uuid;
    if v_queue.profile::text is distinct from v_expected
       or v_prov -> 'queue' ->> 'profile' is distinct from v_expected then
      raise exception 'ÉCHEC: % donne le profil % (attendu %)', v_act, v_queue.profile, v_expected;
    end if;
    if (v_expected in ('walkin', 'event')) <> (v_queue.mode = 'per_staff') then
      raise exception 'ÉCHEC: % : mode % inattendu', v_act, v_queue.mode;
    end if;
    v_q := v_q || jsonb_build_object(v_act::text, v_queue.id);
    v_l := v_l || jsonb_build_object(v_act::text, v_queue.location_id);
    v_o := v_o || jsonb_build_object(v_act::text, v_queue.organization_id);
  end loop;
  raise notice '  ok  create_location donne le profil attendu pour les % activités',
    (select count(*) from unnest(enum_range(null::public.activity_type)));

  v_barber := (v_q ->> 'barber')::uuid;
  v_garage := (v_q ->> 'garage')::uuid;
  v_auto   := (v_q ->> 'auto_center')::uuid;
  v_device := (v_q ->> 'phone_repair')::uuid;
  v_resto  := (v_q ->> 'restaurant')::uuid;
  v_desk   := (v_q ->> 'counter')::uuid;
  v_health := (v_q ->> 'health')::uuid;
  v_shop   := (v_q ->> 'shop')::uuid;

  -- Cas 1 : un barbier obtient exactement ce qu'il obtenait avant.
  select * into v_queue from public.queues where id = v_barber;
  perform internal.assert_eq(v_queue.profile::text, 'walkin', 'barbier : profil walkin');
  perform internal.assert_eq(v_queue.advance_mode::text, 'auto_serve', 'barbier : avancement automatique');
  perform internal.assert_eq(v_queue.entry_ttl_minutes, 240, 'barbier : durée de vie 240 min');
  perform internal.assert_eq(v_queue.absent_policy::text, 'move_back', 'barbier : absent reculé');
  perform internal.assert_eq(v_queue.profile_options, '{}'::jsonb, 'barbier : aucune option de profil');
  perform internal.assert(v_queue.ask_client_name and not v_queue.client_name_required
                          and not v_queue.allow_service_choice and not v_queue.allow_staff_choice,
    'barbier : réglages client identiques aux valeurs par défaut');
  perform internal.assert_eq(
    (select count(*)::int from public.services where location_id = v_queue.location_id), 0,
    'barbier : aucune prestation créée');

  -- Cas 2 : garage, restaurant, santé.
  select * into v_queue from public.queues where id = v_garage;
  perform internal.assert_eq(v_queue.mode::text, 'shared', 'garage : file commune');
  perform internal.assert_eq(v_queue.entry_ttl_minutes, 10080, 'garage : durée de vie 7 jours');
  perform internal.assert_eq(
    (select count(*)::int from public.services where location_id = v_queue.location_id), 7,
    'garage : 7 motifs par défaut');
  perform internal.assert(
    (v_queue.profile_options ->> 'registrationRequired')::boolean
    and v_queue.profile_options ->> 'tvRegistration' = 'masked'
    and (v_queue.profile_options ->> 'quotes')::boolean,
    'garage : immatriculation requise, écran TV masqué, devis en ligne actifs');

  select * into v_queue from public.queues where id = v_resto;
  perform internal.assert(v_queue.client_name_required, 'restaurant : prénom obligatoire');
  perform internal.assert_eq((v_queue.profile_options ->> 'reviewDelayMinutes')::int, 75,
    'restaurant : avis Google différé de 75 min');
  perform internal.assert_eq(v_queue.absent_policy::text, 'remove', 'restaurant : groupe absent retiré');

  select * into v_queue from public.queues where id = v_health;
  perform internal.assert((v_queue.profile_options ->> 'sensitive')::boolean, 'santé : option sensitive');
  perform internal.assert(
    v_queue.profile_options ? 'reviewDelayMinutes'
    and jsonb_typeof(v_queue.profile_options -> 'reviewDelayMinutes') = 'null'
    and not (v_queue.profile_options ->> 'review')::boolean,
    'santé : aucune demande d''avis par défaut');
  perform internal.assert(not v_queue.ask_client_name, 'santé : prénom jamais demandé');

  perform internal.assert(
    not ((select profile_options from public.queues where id = (v_q ->> 'admin_service')::uuid) ->> 'review')::boolean,
    'service administratif : pas d''avis par défaut');
  -- [SEC § 3.4] : au guichet, on appelle un numéro ; le prénom n'est pas
  -- demandé par défaut (minimisation).
  perform internal.assert(
    not exists (select 1 from public.queues
                where id in ((v_q ->> 'counter')::uuid, (v_q ->> 'admin_service')::uuid, v_health)
                  and (ask_client_name or client_name_required)),
    'guichet (comptoir, administration, santé) : prénom ni demandé ni obligatoire par défaut');
  perform internal.assert(
    not exists (select 1 from public.queues
                where id in (v_garage, (v_q ->> 'phone_repair')::uuid, v_resto, v_shop)
                  and not ask_client_name),
    'hors guichet : le prénom reste demandé');
  perform internal.assert_eq(
    (select count(*)::int from public.services where location_id = (v_l ->> 'shop')::uuid), 3,
    'boutique : 3 motifs par défaut');
  perform internal.assert_eq(
    (select count(*)::int from public.services where location_id = (v_l ->> 'event')::uuid), 0,
    'événement : aucune prestation ajoutée');

  -- Garantie n° 1 : une file créée avant 0033 (insertion sans profil,
  -- comme toute ligne existante) est walkin, sans option.
  insert into public.queues (organization_id, location_id, name)
  values ((v_o ->> 'barber')::uuid, (v_l ->> 'barber')::uuid, 'File d''avant les profils')
  returning id into v_old;
  perform internal.assert(
    (select profile = 'walkin' and profile_options = '{}'::jsonb and ticket_prefix = 'A'
     from public.queues where id = v_old),
    'une file existante reste walkin, sans option ni rattrapage');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 2. Rétrocompatibilité des appels (walkin) ──';

  perform public.set_queue_status(v_barber, 'open', v_owner);
  insert into public.staff (organization_id, location_id, display_name)
  values ((v_o ->> 'barber')::uuid, (v_l ->> 'barber')::uuid, 'Karim') returning id into v_k1;
  insert into public.staff (organization_id, location_id, display_name)
  values ((v_o ->> 'barber')::uuid, (v_l ->> 'barber')::uuid, 'Sofia') returning id into v_k2;
  -- File par professionnel : on revient en file commune pour ce scénario.
  update public.queues set mode = 'shared' where id = v_barber;

  for i in 1 .. 4 loop
    v_s := v_s || ((public.upsert_client_session(
      (v_o ->> 'barber')::uuid, 'p13-barber-' || i, 'web', null) ->> 'id')::uuid);
  end loop;

  -- Cas 3 : 7 arguments positionnels (ancien appel des tests 01 à 07).
  v_res := public.join_queue(v_barber, v_s[1], 'Alex', null, null, 'qr', null);
  perform internal.assert(v_res -> 'entry' ->> 'id' is not null, 'join_queue à 7 arguments positionnels');
  perform internal.assert(
    (select details = '{}'::jsonb and stage is null and ticket_no is null and registration_key is null
     from public.queue_entries where public_id = v_res -> 'entry' ->> 'id'),
    'walkin : aucune information métier, aucune étape, aucun numéro');

  -- 7 arguments nommés : forme exacte de server/queue.ts.
  v_res := public.join_queue(
    p_queue_id => v_barber,
    p_client_session_id => v_s[2],
    p_client_name => 'Bruno',
    p_staff_id => null,
    p_service_id => null,
    p_source => 'qr'::public.entry_source,
    p_plate_id => null
  );
  perform internal.assert_eq((v_res -> 'entry' ->> 'peopleAhead')::int, 1,
    'join_queue à 7 arguments nommés (server/queue.ts)');
  v_w := v_res -> 'entry' ->> 'id';

  -- add_walkin à 6 arguments nommés : forme exacte de server/queue.ts.
  v_res := public.add_walkin(
    p_queue_id => v_barber,
    p_client_name => 'Chloé',
    p_staff_id => null,
    p_service_id => null,
    p_actor_user_id => v_owner,
    p_actor_staff_id => null
  );
  perform internal.assert_eq(v_res -> 'entry' ->> 'name', 'Chloé', 'add_walkin à 6 arguments nommés');

  begin
    perform public.join_queue(v_barber, v_s[3], 'Dan', null, null, 'qr', null, '{"model":"x"}'::jsonb);
    raise exception 'ÉCHEC: une information métier a été acceptée en walkin';
  exception when sqlstate 'VT015' then
    raise notice '  ok  walkin : toute information métier est refusée (VT015)';
  end;

  -- Clés ajoutées : valeurs neutres en walkin.
  v_res := (select internal.entry_json_client(e) from public.queue_entries e where e.public_id = v_w);
  perform internal.assert(
    v_res ->> 'profile' = 'walkin' and v_res -> 'stage' = 'null'::jsonb
    and v_res -> 'stageChangedAt' = 'null'::jsonb and v_res -> 'ticketNo' = 'null'::jsonb
    and v_res -> 'details' = '{}'::jsonb and v_res -> 'deskLabel' = 'null'::jsonb
    and v_res -> 'readyEta' = 'null'::jsonb,
    'entry_json_client walkin : profile walkin, le reste null ou {}');
  v_res := (select internal.entry_json_staff(e) from public.queue_entries e where e.public_id = v_w);
  perform internal.assert(
    v_res -> 'stage' = 'null'::jsonb and v_res -> 'details' = '{}'::jsonb
    and v_res -> 'ticketNo' = 'null'::jsonb and v_res -> 'registrationKey' = 'null'::jsonb
    and v_res -> 'claimPending' = 'false'::jsonb and v_res -> 'deskLabel' = 'null'::jsonb
    and v_res ? 'note' and v_res ? 'notified',
    'entry_json_staff walkin : clés d''origine présentes, ajouts neutres');
  v_state := public.ticket_state(v_w, v_s[2]);
  perform internal.assert(
    v_state -> 'queue' ->> 'profile' = 'walkin'
    and v_state -> 'queue' -> 'publicOptions' = '{}'::jsonb
    and v_state -> 'location' -> 'todayHours' = 'null'::jsonb
    and v_state -> 'stages' = '[]'::jsonb and v_state -> 'otherTickets' = '[]'::jsonb,
    'ticket_state walkin : ajouts neutres');
  v_state := public.queue_snapshot(v_barber);
  perform internal.assert(
    v_state -> 'queue' ->> 'profile' = 'walkin'
    and v_state -> 'queue' -> 'profileOptions' = '{}'::jsonb
    and v_state -> 'counts' -> 'byStage' = '{}'::jsonb
    and v_state -> 'counts' -> 'coversWaiting' = 'null'::jsonb
    and v_state -> 'staff' -> 0 -> 'deskLabel' = 'null'::jsonb,
    'queue_snapshot walkin : ajouts neutres');
  v_state := public.resolve_entry_point((select slug from public.locations where id = (v_l ->> 'barber')::uuid));
  perform internal.assert(
    v_state -> 'queue' ->> 'profile' = 'walkin' and v_state -> 'queue' -> 'publicOptions' = '{}'::jsonb,
    'resolve_entry_point walkin : ajouts neutres');
  select array_agg(k order by k) into v_keys from jsonb_object_keys(public.public_queue_state(v_barber)) k;
  perform internal.assert_eq(v_keys,
    array['at', 'closedEntries', 'entries', 'mode', 'queueId', 'serving', 'status', 'waiting'],
    'public_queue_state : clés inchangées, aucune donnée métier');

  -- Cas 6 : un barbier ne sert toujours qu'un client à la fois.
  perform public.staff_queue_action(
    (select public_id from public.queue_entries where queue_id = v_barber and client_name = 'Alex'),
    'start_serving', v_owner, v_k1);
  begin
    perform public.staff_queue_action(v_w, 'start_serving', v_owner, v_k1);
    raise exception 'ÉCHEC: un barbier a démarré deux prestations';
  exception when sqlstate 'VT010' then
    raise notice '  ok  walkin : double prestation toujours refusée (VT010)';
  end;

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 3. Atelier véhicule : dépôt ──';

  perform public.set_queue_status(v_garage, 'open', v_owner);
  perform public.set_queue_status(v_auto, 'open', v_owner);
  insert into public.staff (organization_id, location_id, display_name)
  values ((v_o ->> 'garage')::uuid, (v_l ->> 'garage')::uuid, 'Marc') returning id into v_tech;
  for i in 1 .. 8 loop
    v_s := v_s || ((public.upsert_client_session(
      (v_o ->> 'garage')::uuid, 'p13-garage-' || i, 'web', null) ->> 'id')::uuid);
  end loop;
  -- v_s[5] à v_s[12] : sessions du garage.

  -- Cas 4.
  begin
    perform public.join_queue(v_garage, v_s[5], null, null, null, 'qr', null,
      '{"model":"Peugeot 208"}'::jsonb);
    raise exception 'ÉCHEC: dépôt sans immatriculation accepté';
  exception when sqlstate 'VT015' then
    raise notice '  ok  dépôt sans immatriculation refusé (VT015)';
  end;
  begin
    perform public.join_queue(v_garage, v_s[5], null, null, null, 'qr', null,
      '{"registration":"AB-123-CD","code":"1234"}'::jsonb);
    raise exception 'ÉCHEC: un champ hors liste blanche a été stocké';
  exception when sqlstate 'VT015' then
    raise notice '  ok  champ inconnu (code de déverrouillage) refusé (VT015)';
  end;
  begin
    perform public.join_queue(v_garage, v_s[5], null, null, null, 'qr', null,
      '{"registration":"AB-123-CD","keys":true}'::jsonb);
    raise exception 'ÉCHEC: le client a posé un champ réservé au garage';
  exception when sqlstate 'VT015' then
    raise notice '  ok  le client ne pose pas les champs réservés au garage (VT015)';
  end;

  v_res := public.join_queue(v_garage, v_s[5], null, null, null, 'qr', null,
    '{"registration":"ab 123-cd","model":"  Peugeot   208 ","stay":"away"}'::jsonb);
  v_v1 := v_res -> 'entry' ->> 'id';
  perform internal.assert(
    (select registration_key = 'AB123CD' and stage = 'received' and status = 'waiting'
            and details ->> 'registration' = 'AB-123-CD' and details ->> 'model' = 'Peugeot 208'
     from public.queue_entries where public_id = v_v1),
    'dépôt : AB123CD normalisé, affiché AB-123-CD, étape reçu, en attente');
  perform internal.assert_eq((v_res -> 'entry' ->> 'peopleAhead')::int, 0, 'premier véhicule : personne devant');
  perform internal.assert_eq(v_res -> 'entry' ->> 'profile', 'vehicle', 'entry_json_client : profil vehicle');

  v_v2 := public.join_queue(v_garage, v_s[6], 'Inès', null, null, 'qr', null,
    '{"registration":"AA-001-AA","model":"Clio"}'::jsonb) -> 'entry' ->> 'id';
  v_v3 := public.join_queue(v_garage, v_s[7], null, null, null, 'nfc', null,
    '{"registration":"BB-002-BB","model":"Zoé","reasonText":"bruit au freinage"}'::jsonb) -> 'entry' ->> 'id';

  -- Écran TV : tant que le kiosque lit queue_snapshot (avant le lot T0),
  -- aucune information métier ne doit en sortir par défaut.
  v_state := public.queue_snapshot(v_garage);
  perform internal.assert(
    v_state::text !~* '(AB-?123-?CD|AA-?001|BB-?002|Peugeot|freinage)'
    and v_state -> 'waiting' -> 0 -> 'details' = '{}'::jsonb
    and v_state -> 'waiting' -> 0 -> 'registrationKey' = 'null'::jsonb,
    'queue_snapshot par défaut (kiosque TV) : ni immatriculation, ni modèle, ni motif');
  v_res := public.queue_snapshot(v_garage, true);
  perform internal.assert(
    v_res::text like '%AB-123-CD%' and v_res::text like '%AB123CD%' and v_res::text like '%bruit au freinage%',
    'queue_snapshot(…, p_include_details => true) : le poste du garage voit la fiche complète');
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v_state -> 'waiting' -> 0) k;
  perform internal.assert(
    v_keys = (select array_agg(k order by k) from jsonb_object_keys(v_res -> 'waiting' -> 0) k),
    'mêmes clés avec ou sans informations métier : seules les valeurs sont neutralisées');

  -- Ancien appel (application N-1, ancien App Clip) sur une file atelier :
  -- valide, fiche sans information métier que le garage complétera.
  v_res := public.join_queue(v_auto,
    (public.upsert_client_session((v_o ->> 'auto_center')::uuid, 'p13-auto-1', 'ios_appclip', null) ->> 'id')::uuid,
    'Paul', null, null, 'appclip', null);
  perform internal.assert(
    (select details = '{}'::jsonb and stage = 'received' from public.queue_entries
     where public_id = v_res -> 'entry' ->> 'id'),
    'atelier : un appel à 7 arguments reste valide (retour arrière possible)');

  -- Cas 7 (début) : un dépôt n'est jamais « c'est votre tour ».
  select count(*) into v_n from public.claim_pending_notifications(v_garage);
  perform internal.assert_eq(v_n, 0, 'dépôts en attente : aucune notification, même en tête');

  -- Cas 5 : deux véhicules en atelier chez le même technicien.
  perform public.staff_queue_action(v_v2, 'set_stage', v_owner, v_tech, '{"stage":"diagnosis"}');
  v_res := public.staff_queue_action(v_v3, 'set_stage', v_owner, v_tech, '{"stage":"diagnosis"}');
  perform internal.assert_eq(
    (select count(*)::int from public.queue_entries where queue_id = v_garage and status = 'serving'), 2,
    'deux véhicules en diagnostic pour un même technicien, sans VT010');
  v_res := public.staff_queue_action(v_v1, 'start_serving', v_owner, v_tech);
  perform internal.assert(
    v_res -> 'entry' ->> 'status' = 'serving' and v_res -> 'entry' ->> 'stage' = 'diagnosis',
    '« Prendre en charge » un troisième : en diagnostic, l''étape suit le statut');

  -- Cas 7 (suite) : « prêt » sur le troisième seulement.
  select count(*) into v_n from public.claim_pending_notifications(v_garage);
  perform internal.assert_eq(v_n, 0, 'véhicules en atelier : aucune notification de position');
  v_res := public.staff_queue_action(v_v3, 'set_stage', v_owner, v_tech, '{"stage":"ready","notify":true}');
  perform internal.assert_eq(v_res -> 'entry' ->> 'status', 'next', '« Prêt » : statut appelé (next)');
  select count(*) filter (where c.entry_public_id = v_v3 and c.kind = 'your_turn'), count(*)
    into v_n, i
  from public.claim_pending_notifications(v_garage) c;
  perform internal.assert(v_n = 1 and i = 1, 'your_turn réclamé pour le véhicule prêt, et lui seul');
  select count(*) into v_n from public.claim_pending_notifications(v_garage);
  perform internal.assert_eq(v_n, 0, 'et une seule fois');

  -- Cas 8.
  v_res := public.staff_queue_action(v_v3, 'complete', v_owner, v_tech);
  perform internal.assert(
    v_res -> 'entry' ->> 'status' = 'completed' and v_res -> 'promoted' = 'null'::jsonb,
    '« Rendu au client » : terminé, personne n''est promu');

  -- Cas 9.
  begin
    perform public.staff_queue_action(v_v2, 'set_stage', v_owner, v_tech, '{"stage":"teleportation"}');
    raise exception 'ÉCHEC: étape inconnue acceptée';
  exception when sqlstate 'VT006' then
    raise notice '  ok  étape inconnue refusée (VT006)';
  end;
  begin
    perform public.staff_queue_action(v_w, 'set_stage', v_owner, v_k1, '{"stage":"ready"}');
    raise exception 'ÉCHEC: une étape a été posée en walkin';
  exception when sqlstate 'VT006' then
    raise notice '  ok  walkin : aucune étape (VT006)';
  end;
  perform public.staff_queue_action(v_v2, 'set_stage', v_owner, v_tech, '{"stage":"ready"}');
  select count(*) into v_n from public.claim_pending_notifications(v_garage) c where c.entry_public_id = v_v2;
  perform internal.assert_eq(v_n, 1, 'Inès : « prêt », prévenue');
  v_res := public.staff_queue_action(v_v2, 'set_stage', v_owner, v_tech, '{"stage":"in_repair"}');
  perform internal.assert(
    v_res -> 'entry' ->> 'status' = 'serving' and not ((v_res -> 'entry' -> 'notified') ? 'your_turn'),
    'retour « prêt » → « en réparation » : autorisé, your_turn réarmé');
  perform public.staff_queue_action(v_v2, 'set_stage', v_owner, v_tech, '{"stage":"ready"}');
  select count(*) into v_n from public.claim_pending_notifications(v_garage) c where c.entry_public_id = v_v2;
  perform internal.assert_eq(v_n, 1, 'le « prêt » suivant prévient de nouveau, une fois');
  perform public.staff_queue_action(v_v2, 'set_stage', v_owner, v_tech, '{"stage":"in_repair"}');
  perform public.staff_queue_action(v_v2, 'set_stage', v_owner, v_tech, '{"stage":"ready","notify":false}');
  select count(*) into v_n from public.claim_pending_notifications(v_garage) c where c.entry_public_id = v_v2;
  perform internal.assert_eq(v_n, 0, '« prêt » sans « Prévenir » : aucun envoi');
  perform internal.assert(
    (select stage_changed_at is not null and notification_status ->> 'your_turn' = 'silenced'
     from public.queue_entries where public_id = v_v2),
    'le choix « ne pas prévenir » est journalisé');
  perform internal.assert(
    jsonb_array_length(public.ticket_state(v_v2, v_s[6]) -> 'stages') = 7,
    'ticket_state.stages : le rail du client suit chaque étape (reçu compris)');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 4. Devis en ligne ──';

  -- Cas 10.
  begin
    perform public.staff_queue_action(v_v1, 'send_quote', v_owner, v_tech,
      '{"amountCents":184.5,"label":"Plaquettes"}');
    raise exception 'ÉCHEC: montant non entier accepté';
  exception when sqlstate 'VT015' then
    raise notice '  ok  montant de devis invalide refusé (VT015)';
  end;
  v_res := public.staff_queue_action(v_v1, 'send_quote', v_owner, v_tech,
    '{"amountCents":18400,"label":"Plaquettes + disques AV"}');
  perform internal.assert(
    v_res -> 'entry' ->> 'stage' = 'quote_pending'
    and (v_res -> 'entry' -> 'details' -> 'quote' ->> 'amountCents')::int = 18400
    and v_res -> 'entry' -> 'details' -> 'quote' -> 'decision' = 'null'::jsonb
    and (v_res -> 'entry' -> 'notified' ->> 'quote_count')::int = 1,
    'devis envoyé : étape « devis à valider », décision en attente, clé quote:1');
  v_state := public.ticket_state(v_v1, v_s[5]) -> 'entry' -> 'details' -> 'quote';
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v_state) k;
  perform internal.assert_eq(v_keys, array['amountCents', 'decision', 'label', 'n', 'sentAt'],
    'le client voit le devis réduit à numéro, montant, libellé, décision et heure d''envoi');

  -- Anti-hameçonnage : aucun lien dans un libellé que le client accepte.
  begin
    perform public.staff_queue_action(v_v1, 'send_quote', v_owner, v_tech,
      '{"amountCents":100,"label":"Payez sur bit.ly/garage"}');
    raise exception 'ÉCHEC: un lien a été accepté dans le libellé du devis';
  exception when sqlstate 'VT015' then
    raise notice '  ok  libellé de devis avec une adresse web : refusé (VT015)';
  end;

  -- Devis modifié pendant que le client décide : son accord porte sur le
  -- devis qu'il a lu, jamais sur le nouveau montant.
  v_res := public.staff_queue_action(v_v1, 'send_quote', v_owner, v_tech,
    '{"amountCents":19900,"label":"Plaquettes + disques AV + main-d''œuvre"}');
  perform internal.assert(
    (v_res -> 'entry' -> 'details' -> 'quote' ->> 'n')::int = 2
    and (v_res -> 'entry' -> 'notified' ->> 'quote_count')::int = 2,
    'devis renvoyé : numéro 2, clé quote:2');
  begin
    perform public.client_queue_action(v_v1, v_s[5], 'quote_accept', '{"quoteN":1}');
    raise exception 'ÉCHEC: accord du devis 1 reporté sur le devis 2';
  exception when sqlstate 'VT006' then
    raise notice '  ok  accord d''un devis remplacé entre-temps : refusé (VT006)';
  end;

  begin
    perform public.client_queue_action(v_v1, v_s[6], 'quote_accept');
    raise exception 'ÉCHEC: un autre téléphone a accepté le devis';
  exception when sqlstate 'VT009' then
    raise notice '  ok  seul le téléphone du dépôt décide du devis (VT009)';
  end;
  begin
    perform public.staff_queue_action(v_v1, 'update_details', v_owner, v_tech,
      '{"details":{"quote":{"amountCents":1,"label":"x","decision":"accepted"}}}');
    raise exception 'ÉCHEC: le garage a fabriqué un accord';
  exception when sqlstate 'VT015' then
    raise notice '  ok  le garage ne peut pas écrire la décision du client (VT015)';
  end;
  v_res := public.client_queue_action(v_v1, v_s[5], 'quote_accept', '{"quoteN":2}');
  perform internal.assert(
    (select details -> 'quote' ->> 'decision' = 'accepted' and details -> 'quote' ? 'decidedAt'
            and (details -> 'quote' ->> 'amountCents')::int = 19900
     from public.queue_entries where public_id = v_v1),
    'accord du client enregistré et horodaté, sur le devis qu''il a lu');
  begin
    perform public.client_queue_action(v_v1, v_s[5], 'quote_decline');
    raise exception 'ÉCHEC: une seconde décision a été acceptée';
  exception when sqlstate 'VT006' then
    raise notice '  ok  une seule décision par devis (VT006)';
  end;
  perform internal.assert_eq(
    (select count(*)::int from public.queue_events e
     join public.queue_entries q on q.id = e.entry_id
     where q.public_id = v_v1 and e.event_type = 'quote_decision'), 1,
    'la décision est tracée dans l''historique');
  begin
    perform public.staff_queue_action(
      (select public_id from public.queue_entries where queue_id = v_barber and client_name = 'Chloé'),
      'send_quote', v_owner, v_k1, '{"amountCents":100,"label":"x"}');
    raise exception 'ÉCHEC: un devis a été envoyé hors atelier';
  exception when sqlstate 'VT006' then
    raise notice '  ok  pas de devis hors atelier (VT006)';
  end;
  begin
    perform public.client_queue_action(v_v1, v_s[5], 'leave');
    raise exception 'ÉCHEC: un dépôt a été annulé depuis le téléphone';
  exception when sqlstate 'VT006' then
    raise notice '  ok  un dépôt ne s''annule pas depuis le téléphone (VT006)';
  end;
  v_res := public.client_queue_action(v_v1, v_s[5], 'unfollow');
  perform internal.assert(
    (select client_session_id is null and public.entry_is_active(status)
     from public.queue_entries where public_id = v_v1),
    '« Ne plus suivre » : l''appareil est détaché, la fiche reste active');

  -- Promesse de délai.
  v_res := public.staff_queue_action(v_v2, 'set_eta', v_owner, v_tech,
    jsonb_build_object('readyEta', now() + interval '2 days'));
  perform internal.assert(
    (public.ticket_state(v_v2, v_s[6]) -> 'entry' ->> 'readyEta') is not null,
    'promesse de délai visible par le client');
  begin
    perform public.staff_queue_action(v_v2, 'set_eta', v_owner, v_tech,
      jsonb_build_object('readyEta', now() - interval '1 hour'));
    raise exception 'ÉCHEC: promesse dans le passé acceptée';
  exception when sqlstate 'VT015' then
    raise notice '  ok  promesse de délai dans le passé refusée (VT015)';
  end;

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 5. QR de suivi (étiquette de clé) ──';

  -- Cas 11.
  v_res := public.add_walkin(v_garage, 'Yanis', null, null, v_owner, v_tech,
    '{"registration":"CD-456-EF","model":"Clio","keys":true}'::jsonb);
  v_v4 := v_res -> 'entry' ->> 'id';
  perform internal.assert(
    (v_res -> 'entry' -> 'details' ->> 'keys')::boolean and v_res -> 'entry' ->> 'stage' = 'received',
    'ajout par le garage : clés reçues notées, étape reçu');
  v_res := public.staff_queue_action(v_v4, 'set_claim', v_owner, v_tech,
    jsonb_build_object('tokenHash', v_hash1, 'ttlMinutes', 60));
  perform internal.assert((v_res -> 'entry' ->> 'claimPending')::boolean
                          and not (v_res::text like '%' || v_hash1 || '%'),
    'jeton posé : le poste voit « en attente », jamais le hash');
  v_state := public.peek_claim(v_hash1);
  perform internal.assert(
    v_state ->> 'registrationMasked' = '••-••6-EF' and v_state ->> 'model' = 'Clio'
    and v_state::text not like '%CD-456%' and v_state::text not like '%Yanis%',
    'aperçu : immatriculation masquée, ni plaque en clair ni prénom');

  v_rival_org := (internal.test_provision_metier(
    v_rival, 'P13 Concurrent', 'garage', 'P13 Concurrent Centre') -> 'organization' ->> 'id')::uuid;
  v_rival_s := (public.upsert_client_session(v_rival_org, 'p13-rival-1', 'web', null) ->> 'id')::uuid;
  perform internal.assert(public.claim_entry(v_hash1, v_rival_s) is null,
    'session d''une autre organisation : refus');
  v_res := public.claim_entry(v_hash1, v_s[8]);
  perform internal.assert(
    v_res -> 'entry' ->> 'id' = v_v4
    and (select client_session_id = v_s[8] and claim_token_hash is null
         from public.queue_entries where public_id = v_v4),
    'rattachement : la fiche suit ce téléphone, le jeton est effacé');
  perform internal.assert(public.claim_entry(v_hash1, v_s[9]) is null, 'second usage du jeton : refus');
  perform internal.assert(public.peek_claim(v_hash1) is null, 'jeton utilisé : plus d''aperçu');
  begin
    perform public.staff_queue_action(v_v4, 'set_claim', v_owner, v_tech,
      jsonb_build_object('tokenHash', v_hash2));
    raise exception 'ÉCHEC: jeton posé sur une fiche déjà suivie';
  exception when sqlstate 'VT006' then
    raise notice '  ok  fiche déjà suivie : pas de nouveau jeton (VT006)';
  end;

  v_v5 := public.add_walkin(v_garage, null, null, null, v_owner, v_tech,
    '{"registration":"EE-555-EE"}'::jsonb) -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_v5, 'set_claim', v_owner, v_tech,
    jsonb_build_object('tokenHash', v_hash2, 'ttlMinutes', 30));
  update public.queue_entries set claim_expires_at = now() - interval '1 minute' where public_id = v_v5;
  perform internal.assert(public.claim_entry(v_hash2, v_s[9]) is null, 'jeton expiré : refus');
  perform internal.assert(public.peek_claim(v_hash2) is null, 'jeton expiré : aucun aperçu');

  v_v6 := public.add_walkin(v_garage, null, null, null, v_owner, v_tech,
    '{"registration":"FF-666-FF"}'::jsonb) -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_v6, 'set_claim', v_owner, v_tech,
    jsonb_build_object('tokenHash', v_hash3));
  update public.queue_entries set client_session_id = v_s[10] where public_id = v_v6;
  perform internal.assert(public.claim_entry(v_hash3, v_s[11]) is null, 'fiche déjà rattachée : refus');
  perform internal.assert(public.claim_entry('pas-un-hash', v_s[11]) is null, 'jeton mal formé : refus');

  -- Un téléphone qui suit deux véhicules : l'unicité par session ne
  -- s'applique pas aux fiches à étape.
  perform public.staff_queue_action(v_v5, 'set_claim', v_owner, v_tech,
    jsonb_build_object('tokenHash', encode(extensions.digest('p13-jeton-4', 'sha256'), 'hex')));
  perform internal.assert(
    public.claim_entry(encode(extensions.digest('p13-jeton-4', 'sha256'), 'hex'), v_s[8]) is not null,
    'un même téléphone suit un second véhicule');
  perform internal.assert_eq(
    jsonb_array_length(public.ticket_state(v_v4, v_s[8]) -> 'otherTickets'), 1,
    'ticket_state.otherTickets : l''autre véhicule est proposé');

  -- Mise à jour de la fiche par le garage.
  v_res := public.staff_queue_action(v_v4, 'update_details', v_owner, v_tech,
    '{"details":{"registration":"ef 789 gh","model":null}}');
  perform internal.assert(
    (select registration_key = 'EF789GH' and not (details ? 'model') and (details ->> 'keys')::boolean
     from public.queue_entries where public_id = v_v4),
    'fiche corrigée : clé de recherche recalculée, champ retiré, le reste conservé');

  -- Jamais d'immatriculation dans l'historique d'étapes ni de jeton.
  perform internal.assert_eq(
    (select count(*)::int from public.queue_events ev
     where ev.queue_id = v_garage
       and (ev.payload::text ~* '(AB-?123|CD-?456|EF-?789|AA-?001|BB-?002)'
            or ev.payload::text like '%' || v_hash1 || '%')),
    0, 'queue_events : ni immatriculation, ni jeton');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 6. Guichet : numéros et appels par guichet ──';

  -- Cas 12.
  perform public.set_queue_status(v_desk, 'open', v_owner);
  insert into public.staff (organization_id, location_id, display_name, desk_label)
  values ((v_o ->> 'counter')::uuid, (v_l ->> 'counter')::uuid, 'Amélie', 'Guichet 1') returning id into v_g1;
  insert into public.staff (organization_id, location_id, display_name, desk_label)
  values ((v_o ->> 'counter')::uuid, (v_l ->> 'counter')::uuid, 'Hugo', 'Guichet 2') returning id into v_g2;

  for i in 1 .. 4 loop
    v_id := (public.upsert_client_session((v_o ->> 'counter')::uuid, 'p13-desk-' || i, 'web', null) ->> 'id')::uuid;
    if i = 4 then
      -- Changement de jour simulé : le compteur d'hier ne compte plus.
      update public.queue_ticket_counters set scope_day = scope_day - 1 where queue_id = v_desk;
    end if;
    v_d := v_d || (public.join_queue(v_desk, v_id, null) -> 'entry' ->> 'id');
  end loop;
  perform internal.assert_eq(
    (select array_agg(ticket_no order by joined_at, sort_order) from public.queue_entries where queue_id = v_desk),
    array[1, 2, 3, 1], 'numéros 1, 2, 3 puis retour à 1 le lendemain');
  perform internal.assert_eq(
    public.ticket_state(v_d[1], (select client_session_id from public.queue_entries where public_id = v_d[1]))
      -> 'entry' ->> 'ticketNo', 'A-001', 'le client voit « A-001 »');

  v_res := public.desk_call_next(v_desk, v_g1, v_owner);
  perform internal.assert(v_res -> 'entry' ->> 'id' = v_d[1], 'guichet 1 appelle A-001');
  v_res := public.desk_call_next(v_desk, v_g2, v_owner);
  perform internal.assert(v_res -> 'entry' ->> 'id' = v_d[2], 'guichet 2 appelle A-002');
  perform internal.assert_eq(
    (select count(*)::int from public.queue_entries where queue_id = v_desk and status = 'next'), 2,
    'deux appels simultanés, un par guichet');
  begin
    perform public.desk_call_next(v_desk, v_g1, v_owner);
    raise exception 'ÉCHEC: second appel au même guichet';
  exception when sqlstate 'VT010' then
    raise notice '  ok  second appel au guichet 1 avant Terminer : refusé (VT010)';
  end;
  begin
    perform public.staff_queue_action(v_d[3], 'call', v_owner, v_g1, jsonb_build_object('staffId', v_g1));
    raise exception 'ÉCHEC: second appelé au guichet 1';
  exception when sqlstate 'VT010' then
    raise notice '  ok  « Appeler » refuse aussi un second appelé au même guichet (VT010)';
  end;

  -- Tour dû seulement à l'appel : les deux appelés, pas la tête de file.
  perform internal.assert(
    not exists (
      select 1 from public.claim_pending_notifications(v_desk) c
      where c.kind = 'your_turn' and c.status not in ('next', 'serving')),
    'guichet : « c''est votre tour » seulement une fois appelé');

  v_res := public.staff_queue_action(v_d[1], 'complete', v_owner, v_g1);
  perform internal.assert(
    v_res -> 'promoted' ->> 'id' = v_d[3] and v_res -> 'promoted' ->> 'status' = 'next'
    and (v_res -> 'promoted' ->> 'staffId')::uuid = v_g1,
    'Terminer au guichet 1 appelle le suivant au guichet 1');
  perform internal.assert_eq(
    internal.entry_json_client((select e from public.queue_entries e where e.public_id = v_d[3])) ->> 'deskLabel',
    'Guichet 1', 'le client voit « Guichet 1 »');

  -- Santé : jamais de prénom.
  perform public.set_queue_status(v_health, 'open', v_owner);
  v_res := public.join_queue(v_health,
    (public.upsert_client_session((v_o ->> 'health')::uuid, 'p13-sante-1', 'web', null) ->> 'id')::uuid,
    'Martine');
  perform internal.assert(
    (select client_name is null from public.queue_entries where public_id = v_res -> 'entry' ->> 'id'),
    'santé : le prénom envoyé n''est pas stocké');
  perform public.staff_queue_action(v_res -> 'entry' ->> 'id', 'complete', v_owner, null);
  perform internal.assert(
    not public.claim_entry_notification(
      (select id from public.queue_entries where public_id = v_res -> 'entry' ->> 'id'), 'visit_completed'),
    'santé : aucune demande d''avis à la fin de la visite');

  -- Service administratif : review = false agit vraiment. Ni « Merci » avec
  -- le lien d'avis (claim_entry_notification), ni lien sur l'écran de fin,
  -- même si l'établissement a renseigné son lien Google.
  update public.locations set google_review_url = 'https://g.page/r/p13-mairie/review'
   where id = (v_l ->> 'admin_service')::uuid;
  perform public.set_queue_status((v_q ->> 'admin_service')::uuid, 'open', v_owner);
  v_id := (public.upsert_client_session((v_o ->> 'admin_service')::uuid, 'p13-mairie-1', 'web', null) ->> 'id')::uuid;
  v_res := public.join_queue((v_q ->> 'admin_service')::uuid, v_id, null);
  perform public.staff_queue_action(v_res -> 'entry' ->> 'id', 'complete', v_owner, null);
  perform internal.assert(
    not public.claim_entry_notification(
      (select id from public.queue_entries where public_id = v_res -> 'entry' ->> 'id'), 'visit_completed'),
    'service administratif : aucune demande d''avis à la fin du passage');
  perform internal.assert(
    public.ticket_state(v_res -> 'entry' ->> 'id', v_id) -> 'location' -> 'googleReviewUrl' = 'null'::jsonb,
    'service administratif : aucun lien d''avis sur l''écran de fin');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 7. Restaurant : couverts, appel, avis différé ──';

  -- Cas 13.
  perform public.set_queue_status(v_resto, 'open', v_owner);
  for i in 1 .. 3 loop
    v_s := v_s || ((public.upsert_client_session(
      (v_o ->> 'restaurant')::uuid, 'p13-resto-' || i, 'web', null) ->> 'id')::uuid);
  end loop;
  -- v_s[13] à v_s[15] : sessions du restaurant.
  begin
    perform public.join_queue(v_resto, v_s[13], 'Karim', null, null, 'qr', null, '{"partySize":0}'::jsonb);
    raise exception 'ÉCHEC: 0 couvert accepté';
  exception when sqlstate 'VT015' then
    raise notice '  ok  0 couvert refusé (VT015)';
  end;
  begin
    perform public.join_queue(v_resto, v_s[13], 'Karim', null, null, 'qr', null, '{"partySize":21}'::jsonb);
    raise exception 'ÉCHEC: 21 couverts acceptés';
  exception when sqlstate 'VT015' then
    raise notice '  ok  21 couverts refusés (VT015)';
  end;
  begin
    perform public.join_queue(v_resto, v_s[13], 'Karim', null, null, 'qr', null, '{"partySize":13}'::jsonb);
    raise exception 'ÉCHEC: plus que le maximum en ligne accepté';
  exception when sqlstate 'VT015' then
    raise notice '  ok  au-delà de 12 couverts en ligne : refusé (VT015)';
  end;
  begin
    perform public.join_queue(v_resto, v_s[13], null, null, null, 'qr', null, '{"partySize":4}'::jsonb);
    raise exception 'ÉCHEC: groupe sans prénom accepté';
  exception when sqlstate 'VT009' then
    raise notice '  ok  restaurant : prénom obligatoire (VT009)';
  end;

  v_t := v_t || (public.join_queue(v_resto, v_s[13], 'Karim', null, null, 'qr', null,
    '{"partySize":4,"seating":"terrace","needs":["highchair"]}'::jsonb) -> 'entry' ->> 'id');
  v_t := v_t || (public.join_queue(v_resto, v_s[14], 'Lina', null, null, 'qr', null,
    '{"partySize":2}'::jsonb) -> 'entry' ->> 'id');
  v_t := v_t || (public.join_queue(v_resto, v_s[15], 'Omar', null, null, 'qr', null,
    '{"partySize":6}'::jsonb) -> 'entry' ->> 'id');

  perform internal.assert(
    not exists (select 1 from public.claim_pending_notifications(v_resto) c where c.kind = 'your_turn'),
    'le premier groupe n''apprend pas « table prête » avant l''appel');
  v_res := public.staff_queue_action(v_t[3], 'call', v_owner, null);
  perform internal.assert_eq(v_res -> 'entry' ->> 'status', 'next',
    'table libre pour 6 : le 3ᵉ groupe est appelé avant le 1ᵉʳ');
  perform internal.assert(
    exists (select 1 from public.claim_pending_notifications(v_resto) c
            where c.entry_public_id = v_t[3] and c.kind = 'your_turn'),
    'le groupe appelé apprend que sa table est prête');
  v_res := public.staff_queue_action(v_t[3], 'complete', v_owner, null);
  perform internal.assert(
    v_res -> 'entry' ->> 'status' = 'completed' and v_res -> 'promoted' = 'null'::jsonb,
    '« Installer » depuis l''appel : terminé, sans promotion');
  v_state := public.queue_snapshot(v_resto) -> 'counts';
  perform internal.assert(
    (v_state ->> 'coversWaiting')::int = 6 and (v_state ->> 'coversSeatedToday')::int = 6,
    'compteurs : 6 couverts en attente, 6 installés');

  -- Cas 16 et avis différé.
  v_id := (select id from public.queue_entries where public_id = v_t[3]);
  perform internal.assert(not public.claim_entry_notification(v_id, 'visit_completed'),
    '« Installer » : pas d''avis au moment où l''on s''assoit');
  update public.queue_entries set completed_at = now() - interval '70 minutes' where id = v_id;
  perform internal.assert(not public.claim_entry_notification(v_id, 'visit_completed'),
    'à 70 min pour un délai de 75 : toujours rien');
  perform internal.assert(
    not exists (select 1 from public.claim_due_review_notifications() c where c.entry_id = v_id),
    'à 70 min, le cron ne réclame rien');
  perform internal.assert(
    not ((select notification_status from public.queue_entries where id = v_id) ? 'visit_completed'),
    'le journal n''est pas marqué avant l''heure');
  update public.queue_entries set completed_at = now() - interval '80 minutes' where id = v_id;
  perform internal.assert_eq(
    (select count(*)::int from public.claim_due_review_notifications() c
     where c.entry_id = v_id and c.kind = 'visit_completed'), 1,
    'à 80 min, le cron réclame l''avis');
  perform internal.assert_eq(
    (select count(*)::int from public.claim_due_review_notifications() c where c.entry_id = v_id), 0,
    'une seule fois');
  perform internal.assert(not public.claim_entry_notification(v_id, 'visit_completed'),
    'et l''appel immédiat devient un non-événement');

  -- Avis désactivé par le restaurateur : le cron ne le réclame pas non plus.
  v_x := public.join_queue(v_resto,
    (public.upsert_client_session((v_o ->> 'restaurant')::uuid, 'p13-resto-4', 'web', null) ->> 'id')::uuid,
    'Nora', null, null, 'qr', null, '{"partySize":2}'::jsonb) -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_x, 'call', v_owner, null);
  perform public.staff_queue_action(v_x, 'complete', v_owner, null);
  update public.queues set profile_options = profile_options || '{"review":false}'::jsonb where id = v_resto;
  update public.queue_entries set completed_at = now() - interval '80 minutes' where public_id = v_x;
  perform internal.assert(
    not exists (select 1 from public.claim_due_review_notifications() c where c.entry_public_id = v_x)
    and not public.claim_entry_notification(
      (select id from public.queue_entries where public_id = v_x), 'visit_completed'),
    'review = false : ni avis différé par le cron, ni avis immédiat');
  update public.queues set profile_options = profile_options || '{"review":true}'::jsonb where id = v_resto;

  -- Délai d'avis borné en base (0 à 240 min, entier, ou null) : une valeur
  -- aberrante arrêterait le cron de toutes les organisations.
  begin
    update public.queues set profile_options = profile_options || '{"reviewDelayMinutes":100000000000}'::jsonb
     where id = v_resto;
    raise exception 'ÉCHEC: délai d''avis démesuré accepté';
  exception when check_violation then
    raise notice '  ok  délai d''avis hors bornes : refusé par la contrainte';
  end;
  begin
    update public.queues set profile_options = profile_options || '{"reviewDelayMinutes":"75"}'::jsonb
     where id = v_resto;
    raise exception 'ÉCHEC: délai d''avis en texte accepté';
  exception when check_violation then
    raise notice '  ok  délai d''avis qui n''est pas un nombre : refusé par la contrainte';
  end;

  -- Walkin : jamais par le cron (l'avis part tout de suite, comme avant).
  v_id := (select id from public.queue_entries where queue_id = v_barber and client_name = 'Alex');
  perform public.staff_queue_action(
    (select public_id from public.queue_entries where id = v_id), 'complete', v_owner, v_k1);
  update public.queue_entries set completed_at = now() - interval '80 minutes' where id = v_id;
  perform internal.assert(
    not exists (select 1 from public.claim_due_review_notifications() c where c.entry_id = v_id),
    'walkin : jamais réclamé par le cron des avis');
  perform internal.assert(public.claim_entry_notification(v_id, 'visit_completed'),
    'walkin : l''avis part immédiatement, comme avant');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 8. Messages et rappels ──';

  -- Cas 17.
  perform public.staff_queue_action(v_v2, 'message', v_owner, v_tech);
  begin
    perform public.staff_queue_action(v_v2, 'message', v_owner, v_tech);
    raise exception 'ÉCHEC: deux messages en moins de 30 s';
  exception when sqlstate 'VT016' then
    raise notice '  ok  deux messages à moins de 30 s : refusé (VT016)';
  end;
  for i in 2 .. 10 loop
    update public.queue_entries
       set notification_status = notification_status
         || jsonb_build_object('custom_last_at', to_jsonb(now() - interval '31 seconds'))
     where public_id = v_v2;
    perform public.staff_queue_action(v_v2, 'message', v_owner, v_tech);
  end loop;
  perform internal.assert_eq(
    (select (notification_status ->> 'custom_count')::int from public.queue_entries where public_id = v_v2),
    10, 'dix messages envoyés, clés custom:1 à custom:10');
  update public.queue_entries
     set notification_status = notification_status
       || jsonb_build_object('custom_last_at', to_jsonb(now() - interval '31 seconds'))
   where public_id = v_v2;
  begin
    perform public.staff_queue_action(v_v2, 'message', v_owner, v_tech);
    raise exception 'ÉCHEC: onzième message accepté';
  exception when sqlstate 'VT016' then
    raise notice '  ok  onzième message : refusé (VT016)';
  end;

  for i in 1 .. 3 loop
    perform public.staff_queue_action(v_d[2], 'recall', v_owner, v_g2);
  end loop;
  begin
    perform public.staff_queue_action(v_d[2], 'recall', v_owner, v_g2);
    raise exception 'ÉCHEC: quatrième rappel accepté';
  exception when sqlstate 'VT006' then
    raise notice '  ok  quatrième rappel : refusé (VT006)';
  end;
  begin
    perform public.staff_queue_action(v_d[4], 'recall', v_owner, v_g2);
    raise exception 'ÉCHEC: rappel d''un client non appelé';
  exception when sqlstate 'VT006' then
    raise notice '  ok  on ne rappelle qu''un client appelé (VT006)';
  end;
  perform internal.assert(public.claim_entry_notification_key(
    (select id from public.queue_entries where public_id = v_d[2]), 'recall:3'),
    'clé recall:3 réclamée');
  perform internal.assert(not public.claim_entry_notification_key(
    (select id from public.queue_entries where public_id = v_d[2]), 'recall:3'),
    'et une seule fois');
  begin
    perform public.claim_entry_notification_key(
      (select id from public.queue_entries where public_id = v_d[2]), 'Recall 3!');
    raise exception 'ÉCHEC: clé de journal libre acceptée';
  exception when sqlstate 'VT015' then
    raise notice '  ok  clé de journal mal formée : refusée (VT015)';
  end;

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 9. Expiration ──';

  -- Cas 14.
  update public.queue_entries
     set joined_at = now() - interval '3 days', stage_changed_at = now() - interval '1 hour'
   where public_id = v_v2;
  update public.queue_entries set joined_at = now() - interval '5 hours'
   where public_id = v_w;
  perform public.expire_stale_entries();
  perform internal.assert(
    (select public.entry_is_active(status) from public.queue_entries where public_id = v_v2),
    'véhicule déposé il y a 3 jours, étape changée il y a 1 h : toujours en cours');
  perform internal.assert_eq(
    (select status::text from public.queue_entries where public_id = v_w), 'expired',
    'walkin inscrit il y a 5 h (240 min) : expiré, comme avant');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 10. Boutique : une commande suivie reste suivie ──';

  -- Un téléphone attend un conseil (ticket sans étape) ET suit une
  -- commande rattachée par QR (ticket à étape). La commande ne doit jamais
  -- redevenir un ticket sans étape : elle retomberait sous l'index « une
  -- place active par téléphone » et l'action du vendeur échouerait (23505).
  perform public.set_queue_status(v_shop, 'open', v_owner);
  v_id := (public.upsert_client_session((v_o ->> 'shop')::uuid, 'p13-shop-1', 'web', null) ->> 'id')::uuid;
  v_w := public.join_queue(v_shop, v_id, 'Zoé') -> 'entry' ->> 'id';
  v_x := public.add_walkin(v_shop, null, null, null, v_owner, null, '{"orderRef":"1234"}'::jsonb) -> 'entry' ->> 'id';
  perform internal.assert(
    (select stage is null from public.queue_entries where public_id = v_x),
    'commande saisie par le vendeur : sans étape tant qu''elle n''est pas en préparation');
  perform public.staff_queue_action(v_x, 'set_stage', v_owner, null, '{"stage":"preparing"}');
  perform public.staff_queue_action(v_x, 'set_claim', v_owner, null,
    jsonb_build_object('tokenHash', encode(extensions.digest('p13-jeton-shop', 'sha256'), 'hex')));
  perform internal.assert(
    public.claim_entry(encode(extensions.digest('p13-jeton-shop', 'sha256'), 'hex'), v_id) is not null,
    'le téléphone qui attend un conseil rattache aussi sa commande');

  v_res := public.staff_queue_action(v_x, 'defer', v_owner, null);
  perform internal.assert(
    v_res -> 'entry' ->> 'status' = 'waiting' and v_res -> 'entry' ->> 'stage' = 'preparing',
    '« Décaler » la commande : en attente, toujours « en préparation », sans erreur');
  v_res := public.staff_queue_action(v_x, 'call', v_owner, null);
  perform internal.assert(
    v_res -> 'entry' ->> 'status' = 'next' and v_res -> 'entry' ->> 'stage' = 'ready',
    '« Commande prête » : appelée, étape prête');
  v_res := public.staff_queue_action(v_x, 'mark_absent', v_owner, null, '{"policy":"move_back"}');
  perform internal.assert(
    v_res -> 'entry' ->> 'status' = 'waiting' and v_res -> 'entry' ->> 'stage' = 'preparing',
    'absente, reculée : de nouveau en attente, étape conservée');
  perform public.staff_queue_action(v_x, 'remove', v_owner, null);
  v_res := public.staff_queue_action(v_x, 'restore', v_owner, null);
  perform internal.assert(
    v_res -> 'entry' ->> 'status' = 'waiting' and v_res -> 'entry' ->> 'stage' = 'preparing',
    'retirée puis remise en file : étape conservée, sans erreur');
  perform internal.assert(
    (select count(*) = 2 and bool_and(public.entry_is_active(status))
     from public.queue_entries where client_session_id = v_id and queue_id = v_shop),
    'le téléphone suit toujours son conseil et sa commande');
  perform internal.assert(
    (select status = 'serving' and stage is null from public.queue_entries where public_id = v_w),
    'le conseil suit la file : la commande en attente ne lui passe pas devant');
  perform public.staff_queue_action(v_x, 'complete', v_owner, null);
  perform public.staff_queue_action(v_w, 'complete', v_owner, null);

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 11. Changement de profil ──';

  -- Cas 15.
  begin
    perform public.switch_queue_profile(v_resto, 'desk', v_owner);
    raise exception 'ÉCHEC: changement de profil avec des groupes en attente';
  exception when sqlstate 'VT017' then
    raise notice '  ok  file non vide : « Terminez ou videz la file » (VT017)';
  end;
  perform public.staff_queue_action(v_t[1], 'remove', v_owner, null);
  perform public.staff_queue_action(v_t[2], 'remove', v_owner, null);
  v_res := public.switch_queue_profile(v_resto, 'desk', v_owner);
  select * into v_queue from public.queues where id = v_resto;
  perform internal.assert(
    (v_res ->> 'changed')::boolean and v_queue.profile = 'desk'
    and (v_queue.profile_options ->> 'numbering')::boolean
    and not (v_queue.profile_options ? 'partyMax')
    and (v_res ->> 'servicesCreated')::int = 3,
    'file vide : passage en guichet, réglages et motifs par défaut');
  perform internal.assert(
    exists (select 1 from public.audit_logs
            where action = 'queue.profile_changed' and target_id = v_resto::text
              and metadata ->> 'from' = 'table' and metadata ->> 'to' = 'desk'),
    'changement tracé dans audit_logs');
  v_res := public.switch_queue_profile(v_resto, 'table', v_owner);
  perform internal.assert(
    (select profile = 'table' and (profile_options ->> 'reviewDelayMinutes')::int = 75
     from public.queues where id = v_resto)
    and (v_res ->> 'servicesCreated')::int = 0,
    'retour arrière possible, sans dupliquer les motifs');
  perform internal.assert(
    (v_res ->> 'settingsRestored')::boolean and (v_res ->> 'servicesRetired')::int = 3
    and not exists (select 1 from public.services where location_id = (v_l ->> 'restaurant')::uuid and is_active),
    'retour au restaurant : réglages d''avant rétablis, motifs du guichet retirés');

  -- Un vrai aller-retour : un barbier qui essaie le profil garage puis
  -- revient retrouve exactement son poste (probe D de la relecture).
  v_id := (v_q ->> 'hair_salon')::uuid;
  update public.queues
     set mode = 'per_staff', absent_policy = 'remove', entry_ttl_minutes = 600,
         allow_staff_choice = true, advance_mode = 'call_next', ask_client_name = false
   where id = v_id;
  v_res := public.switch_queue_profile(v_id, 'vehicle', v_owner);
  perform internal.assert(
    not (v_res ->> 'settingsRestored')::boolean and (v_res ->> 'servicesCreated')::int = 7
    and (select mode = 'shared' and entry_ttl_minutes = 10080 from public.queues where id = v_id),
    'coiffure → garage : réglages et motifs par défaut du garage');
  -- Un motif retouché par le professionnel lui appartient : on le garde.
  -- (Tout ce test tient dans une transaction, où now() ne bouge pas : on
  -- recule created_at pour simuler une retouche faite plus tard.)
  update public.services set price_cents = 4900, created_at = created_at - interval '1 minute'
   where location_id = (v_l ->> 'hair_salon')::uuid and name = 'Vidange';
  v_res := public.switch_queue_profile(v_id, 'walkin', v_owner);
  select * into v_queue from public.queues where id = v_id;
  perform internal.assert(
    (v_res ->> 'settingsRestored')::boolean
    and v_queue.profile = 'walkin' and v_queue.profile_options = '{}'::jsonb
    and v_queue.mode = 'per_staff' and v_queue.absent_policy = 'remove'
    and v_queue.entry_ttl_minutes = 600 and v_queue.allow_staff_choice
    and v_queue.advance_mode = 'call_next' and not v_queue.ask_client_name,
    'garage → coiffure : le poste d''avant est rétabli à l''identique');
  perform internal.assert(
    (v_res ->> 'servicesRetired')::int = 6
    and (select array_agg(name) = array['Vidange'] from public.services
         where location_id = (v_l ->> 'hair_salon')::uuid and is_active),
    'les 6 motifs de garage intacts sont retirés, le motif retouché est gardé');
  perform internal.assert(
    exists (select 1 from public.audit_logs
            where action = 'queue.profile_changed' and target_id = v_id::text
              and metadata ->> 'to' = 'vehicle'
              and metadata -> 'settings' ->> 'entryTtlMinutes' = '600'),
    'les réglages quittés sont conservés dans audit_logs');
  perform internal.assert(
    not (public.switch_queue_profile(v_resto, 'table', v_owner) ->> 'changed')::boolean,
    'même profil : rien ne change');
  v_res := public.switch_queue_profile(v_shop, 'walkin', v_owner);
  select * into v_queue from public.queues where id = v_shop;
  perform internal.assert(
    v_queue.profile = 'walkin' and v_queue.profile_options = '{}'::jsonb
    and v_queue.advance_mode = 'auto_serve' and v_queue.entry_ttl_minutes = 240
    and v_queue.mode = 'shared',
    'ramenée en walkin : les réglages d''un barbier qui s''inscrit');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 12. Atelier appareil et garde-fous ──';

  perform public.set_queue_status(v_device, 'open', v_owner);
  v_res := public.join_queue(v_device,
    (public.upsert_client_session((v_o ->> 'phone_repair')::uuid, 'p13-device-1', 'web', null) ->> 'id')::uuid,
    null, null, null, 'qr', null,
    '{"deviceKind":"phone","model":"iPhone 13","reasonText":"écran fissuré"}'::jsonb);
  perform internal.assert(
    v_res -> 'entry' ->> 'ticketNo' = '0001' and v_res -> 'entry' ->> 'stage' = 'received',
    'atelier appareil : dossier 0001, étape reçu');
  begin
    perform public.join_queue(v_device,
      (public.upsert_client_session((v_o ->> 'phone_repair')::uuid, 'p13-device-2', 'web', null) ->> 'id')::uuid,
      null, null, null, 'qr', null, '{"deviceKind":"toaster"}'::jsonb);
    raise exception 'ÉCHEC: type d''appareil inconnu accepté';
  exception when sqlstate 'VT015' then
    raise notice '  ok  type d''appareil hors liste : refusé (VT015)';
  end;
  begin
    update public.queue_entries set details = jsonb_build_object('model', repeat('x', 3000))
     where public_id = v_res -> 'entry' ->> 'id';
    raise exception 'ÉCHEC: informations de plus de 2 Ko stockées';
  exception when check_violation then
    raise notice '  ok  informations de plus de 2 Ko : refusées par la contrainte';
  end;

  -- Horaires du jour avec une pause : pendant la pause, on annonce la
  -- réouverture, jamais « ouvert jusqu'à » la fermeture du soir. Créneaux
  -- posés autour de l'heure locale (sautés près de minuit).
  v_id := (v_l ->> 'phone_repair')::uuid;
  if (now() at time zone 'Europe/Paris')::time between time '03:00' and time '21:00' then
    delete from public.opening_hours
     where location_id = v_id
       and weekday = extract(isodow from (now() at time zone 'Europe/Paris'))::int - 1;
    insert into public.opening_hours (organization_id, location_id, weekday, opens_at, closes_at, is_closed, sort_order)
    select (v_o ->> 'phone_repair')::uuid, v_id,
           extract(isodow from (now() at time zone 'Europe/Paris'))::int - 1,
           (now() at time zone 'Europe/Paris')::time + s.o,
           (now() at time zone 'Europe/Paris')::time + s.c, false, s.n
    from (values (interval '-3 hours', interval '-2 hours', 0),
                 (interval '1 hour', interval '2 hours', 1)) as s(o, c, n);
    v_state := internal.today_hours(v_id);
    perform internal.assert(
      not (v_state ->> 'closed')::boolean and jsonb_array_length(v_state -> 'slots') = 2
      and not (v_state ->> 'openNow')::boolean
      and v_state ->> 'opensAt' = v_state -> 'slots' -> 1 ->> 'opensAt'
      and v_state ->> 'closesAt' = v_state -> 'slots' -> 1 ->> 'closesAt',
      'pause de midi : fermé maintenant, les deux créneaux, et le prochain annoncé');
  else
    raise notice '  ..  horaires avec pause : sauté près de minuit (heure de Paris)';
  end if;

  -- Accessoires déposés : la liste du registre TypeScript, rien d'autre.
  v_res := public.add_walkin(v_device, null, null, null, v_owner, null,
    '{"deviceKind":"phone","accessories":["sim_removed","charger","charger"]}'::jsonb);
  perform internal.assert(
    v_res -> 'entry' -> 'details' -> 'accessories' = '["charger", "sim_removed"]'::jsonb,
    'accessoires déposés : dédoublonnés et triés');
  begin
    perform public.add_walkin(v_device, null, null, null, v_owner, null,
      '{"accessories":["code_pin"]}'::jsonb);
    raise exception 'ÉCHEC: accessoire hors liste accepté';
  exception when sqlstate 'VT015' then
    raise notice '  ok  accessoire hors liste : refusé (VT015)';
  end;

  -- Masquage : seuls les 3 derniers caractères restent lisibles.
  perform internal.assert_eq(internal.mask_registration('AB-123-CD'), '••-••3-CD', 'masquage SIV');
  perform internal.assert_eq(internal.mask_registration('1234 AB 75'), '•••• •B 75', 'masquage FNI');
  perform internal.assert_eq(internal.mask_registration('AB1'), '•B1', 'plaque de 3 caractères : un caractère masqué au moins');
  perform internal.assert_eq(internal.mask_registration('b-7'), '•-7', 'plaque de 2 caractères : un caractère masqué au moins');
  perform internal.assert_eq(internal.mask_registration('ABC1'), '•BC1', 'plaque de 4 caractères : 3 lisibles');

  -- Adresses web (miroir de containsUrl, lib/profiles/templates.ts).
  perform internal.assert(
    internal.contains_url('https://exemple.fr') and internal.contains_url('voir www.exemple')
    and internal.contains_url('bit.ly/x') and internal.contains_url('Payez sur exemple.fr.')
    and internal.contains_url('HTTP://X'),
    'adresse web détectée : schéma, www., domaine nu');
  perform internal.assert(
    not internal.contains_url('Plaquettes + disques AV') and not internal.contains_url('19 h 00')
    and not internal.contains_url('184,00 €') and not internal.contains_url('n° 12.5')
    and not internal.contains_url('M. Dupont, 2.0 TDI') and not internal.contains_url(null),
    'texte ordinaire : aucune fausse alerte');

  -- Le nom d'un champ refusé est tronqué dans le message d'erreur.
  begin
    perform public.add_walkin(v_device, null, null, null, v_owner, null,
      jsonb_build_object(repeat('k', 500), 'x'));
    raise exception 'ÉCHEC: champ inconnu accepté';
  exception when sqlstate 'VT015' then
    perform internal.assert(length(sqlerrm) < 120 and sqlerrm like '%' || repeat('k', 32) || '%',
      'champ refusé : nom tronqué à 32 caractères dans le message');
  end;

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 13. Purge RGPD des informations métier ──';

  -- Probe F de la relecture : rétention de 3 jours, véhicule déposé il y a
  -- 4 jours, étape changée il y a 1 h. Il est EN COURS : ni l'expiration
  -- ni la purge n'y touchent, et la session du téléphone qui le suit
  -- survit même si elle a expiré.
  update public.organization_settings set data_retention_days = 3
   where organization_id = (v_o ->> 'garage')::uuid;
  perform public.staff_queue_action(v_v2, 'set_stage', v_owner, v_tech, '{"stage":"waiting_parts"}');
  update public.queue_entries
     set joined_at = now() - interval '4 days', stage_changed_at = now() - interval '1 hour'
   where public_id = v_v2;
  update public.client_sessions
     set last_seen_at = now() - interval '10 days', expires_at = now() - interval '1 day'
   where id = v_s[6];
  perform public.expire_stale_entries();
  v_state := public.purge_expired_data();
  perform internal.assert(
    (select status = 'serving' and stage = 'waiting_parts' and details ->> 'registration' = 'AA-001-AA'
            and registration_key = 'AA001AA' and client_session_id = v_s[6] and client_name = 'Inès'
     from public.queue_entries where public_id = v_v2),
    'véhicule en atelier depuis plus que la rétention : rien n''est effacé tant qu''il est en cours');
  perform internal.assert(exists (select 1 from public.client_sessions where id = v_s[6]),
    'la session du téléphone qui suit un véhicule en cours n''est pas supprimée');

  -- Le même véhicule, rendu aujourd'hui : la rétention court depuis la fin.
  -- (La cliente revient chercher sa voiture : sa session est prolongée,
  -- comme le fait upsert_client_session.)
  update public.client_sessions
     set last_seen_at = now(), expires_at = now() + interval '30 days'
   where id = v_s[6];
  perform public.staff_queue_action(v_v2, 'complete', v_owner, v_tech);
  perform public.purge_expired_data();
  perform internal.assert(
    (select details <> '{}'::jsonb and client_session_id is not null
     from public.queue_entries where public_id = v_v2),
    'rendu aujourd''hui : conservé pendant la rétention, comptée depuis la fin');
  -- … et rendu il y a 4 jours, le téléphone n'étant plus revenu depuis :
  -- purgé, et sa session avec lui.
  update public.queue_entries set completed_at = now() - interval '4 days' where public_id = v_v2;
  update public.client_sessions
     set last_seen_at = now() - interval '4 days', expires_at = now() - interval '1 day'
   where id = v_s[6];
  perform public.purge_expired_data();
  perform internal.assert(
    (select details = '{}'::jsonb and registration_key is null and client_session_id is null
            and client_name is null
     from public.queue_entries where public_id = v_v2)
    and not exists (select 1 from public.client_sessions where id = v_s[6]),
    'rendu il y a 4 jours (rétention 3) : fiche, immatriculation, prénom et session effacés');

  -- Tous les tickets terminés du garage, au-delà de la rétention : tout part
  -- ensemble ; les tickets encore en cours restent intacts.
  update public.organization_settings set data_retention_days = 1
   where organization_id = (v_o ->> 'garage')::uuid;
  perform public.staff_queue_action(v_v6, 'cancel', v_owner, v_tech);
  update public.queue_entries
     set claim_token_hash = v_hash3, claim_expires_at = now() + interval '1 hour', client_session_id = null
   where public_id = v_v6;
  update public.queue_entries
     set joined_at = now() - interval '10 days',
         completed_at = case when completed_at is not null then now() - interval '10 days' end,
         cancelled_at = case when cancelled_at is not null then now() - interval '10 days' end,
         expired_at   = case when expired_at   is not null then now() - interval '10 days' end,
         absent_at    = case when absent_at    is not null then now() - interval '10 days' end
   where organization_id = (v_o ->> 'garage')::uuid;
  insert into public.queue_ticket_counters (queue_id, scope_day, last_no)
  values (v_desk, current_date - 5, 12);
  v_state := public.purge_expired_data();
  perform internal.assert(
    not exists (
      select 1 from public.queue_entries
      where organization_id = (v_o ->> 'garage')::uuid
        and not public.entry_is_active(status)
        and (details <> '{}'::jsonb or registration_key is not null or claim_token_hash is not null
             or client_name is not null or client_session_id is not null)),
    'tickets terminés au-delà de la rétention : immatriculation, fiche, jeton et prénom effacés ensemble');
  perform internal.assert(
    (select count(*) >= 3 and bool_and(details <> '{}'::jsonb and registration_key is not null)
     from public.queue_entries
     where organization_id = (v_o ->> 'garage')::uuid and public.entry_is_active(status)),
    'tickets du garage encore en cours : intacts');
  perform internal.assert(
    not exists (select 1 from public.queue_ticket_counters where queue_id = v_desk and scope_day = current_date - 5)
    and exists (select 1 from public.queue_ticket_counters where queue_id = v_device and scope_day = date '1970-01-01'),
    'compteurs des jours passés supprimés, compteur continu conservé');
  perform internal.assert((v_state ->> 'deletedTicketCounters')::int >= 1,
    'la purge compte les compteurs supprimés');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 14. Droits ──';

  perform internal.assert(
    not exists (
      select 1 from unnest(array[
        'public.join_queue(uuid,uuid,text,uuid,uuid,public.entry_source,uuid,jsonb)',
        'public.add_walkin(uuid,text,uuid,uuid,uuid,uuid,jsonb)',
        'public.claim_entry_notification_key(uuid,text)',
        'public.claim_due_review_notifications(int)',
        'public.desk_call_next(uuid,uuid,uuid)',
        'public.peek_claim(text)',
        'public.claim_entry(text,uuid)',
        'public.switch_queue_profile(uuid,public.queue_profile,uuid)',
        'public.create_location(uuid,text,public.activity_type,text,text,text,text,text,text,public.queue_mode,uuid,text)',
        'public.purge_expired_data()',
        'public.ticket_state(text,uuid)',
        'public.queue_snapshot(uuid,boolean)',
        'public.client_queue_action(text,uuid,text,jsonb)',
        'public.staff_queue_action(text,text,uuid,uuid,jsonb)',
        'public.claim_entry_notification(uuid,public.notification_kind)'
      ]) fn
      where has_function_privilege('anon', fn, 'execute')
         or has_function_privilege('authenticated', fn, 'execute')
         or not has_function_privilege('service_role', fn, 'execute')),
    'fonctions des profils : service_role seulement, jamais anon ni authenticated');
  perform internal.assert(
    not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('join_queue', 'add_walkin', 'client_queue_action', 'queue_snapshot')
      group by p.proname having count(*) > 1),
    'une seule signature de join_queue, add_walkin, client_queue_action et queue_snapshot (PostgREST sans ambiguïté)');
  perform internal.assert(
    not has_schema_privilege('anon', 'internal', 'usage')
    and not has_schema_privilege('authenticated', 'internal', 'usage'),
    'schéma internal fermé à anon et authenticated');

  insert into p13 values
    ('owner', v_owner::text), ('rival', v_rival::text),
    ('org_garage', v_o ->> 'garage'), ('loc_garage', v_l ->> 'garage'),
    ('org_barber', v_o ->> 'barber'), ('loc_barber', v_l ->> 'barber'),
    ('org_rival', v_rival_org::text);

  raise notice '';
  raise notice '✅ Moteur des profils : tous les tests passent.';
end
$$;

-- =====================================================================
-- Modèles de messages : lecture par les membres seulement
-- =====================================================================
do $$
begin
  insert into public.message_templates (organization_id, location_id, profile, key, label, body)
  select (select v::uuid from p13 where k = 'org_garage'), (select v::uuid from p13 where k = 'loc_garage'),
         'vehicle', 'keys_ready', 'Clés à l''accueil', 'Vos clés sont disponibles à l''accueil.';
  insert into public.message_templates (organization_id, profile, key, label, body)
  select (select v::uuid from p13 where k = 'org_rival'), 'vehicle', 'late', 'Retard', 'Votre véhicule sera prêt demain matin.';
  begin
    insert into public.message_templates (organization_id, location_id, profile, key, label, body)
    select (select v::uuid from p13 where k = 'org_rival'), (select v::uuid from p13 where k = 'loc_garage'),
           'vehicle', 'pirate', 'Pirate', 'x';
    raise exception 'ÉCHEC: modèle rattaché à l''établissement d''une autre organisation';
  exception when others then
    if sqlerrm like 'ÉCHEC%' then raise; end if;
    raise notice '  ok  modèle multi-tenant refusé';
  end;
end
$$;

-- Les identifiants sont lus avant de prendre le rôle du navigateur :
-- la table temporaire p13 ne lui est pas accessible.
begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', (select v from p13 where k = 'rival'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- (Le schéma internal est fermé à ce rôle : contrôles écrits en clair.)
  do $$
  begin
    if (select count(*) from public.message_templates) <> 1
       or (select key from public.message_templates) <> 'late' then
      raise exception 'ÉCHEC: un membre lit les modèles d''une autre organisation';
    end if;
    raise notice '  ok  un membre ne lit que les modèles de son organisation';
    if (select count(*) from public.queue_entries) <> 0
       or (select count(*) from public.queue_ticket_counters) <> 0 then
      raise exception 'ÉCHEC: un membre lit les tickets d''une autre organisation';
    end if;
    raise notice '  ok  ni les tickets ni les compteurs des autres organisations';
    begin
      insert into public.message_templates (organization_id, profile, key, label, body)
      values ((select id from public.organizations limit 1), 'vehicle', 'direct', 'Direct', 'x');
      raise exception 'ÉCHEC: écriture directe d''un modèle depuis le navigateur';
    exception when insufficient_privilege then
      raise notice '  ok  aucune écriture directe des modèles depuis le navigateur';
    end;
  end $$;
rollback;

begin;
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  do $$
  begin
    begin
      perform count(*) from public.message_templates;
      raise exception 'ÉCHEC: anon lit les modèles de messages';
    exception when insufficient_privilege then
      raise notice '  ok  anon ne lit pas les modèles de messages';
    end;
    begin
      perform count(*) from public.queue_ticket_counters;
      raise exception 'ÉCHEC: anon lit les compteurs de tickets';
    exception when insufficient_privilege then
      raise notice '  ok  anon ne lit pas les compteurs de tickets';
    end;
  end $$;
rollback;

-- =====================================================================
-- Concurrence (deux sessions) : changement de profil, rattachement par
-- QR, devis renvoyé pendant que le client décide
-- ---------------------------------------------------------------------
-- La seconde session est une vraie connexion (dblink). Si l'extension
-- n'est pas disponible, chaque scénario est rejoué dans l'ordre, dans
-- une seule session, et le test le signale. L'extension n'est supprimée
-- à la fin que si ce test l'a lui-même créée.
-- =====================================================================
do $$
declare
  v_prov jsonb;
  v_org  uuid;
begin
  raise notice '';
  raise notice '── 15. Concurrence : changement de profil, rattachement, devis ──';
  v_prov := internal.test_provision_metier(
    (select v::uuid from p13 where k = 'owner'), 'P13 Concurrence', 'counter', 'P13 Concurrence Centre');
  v_org := (v_prov -> 'organization' ->> 'id')::uuid;
  perform public.set_queue_status((v_prov -> 'queue' ->> 'id')::uuid, 'open', null);
  insert into p13 values
    ('cq', v_prov -> 'queue' ->> 'id'),
    ('cs1', public.upsert_client_session(v_org, 'p13-conc-1', 'web', null) ->> 'id'),
    ('cs2', public.upsert_client_session(v_org, 'p13-conc-2', 'web', null) ->> 'id');

  -- Garage : une fiche à rattacher, une fiche avec un devis en attente.
  v_prov := internal.test_provision_metier(
    (select v::uuid from p13 where k = 'owner'), 'P13 Concurrence Garage', 'garage',
    'P13 Concurrence Garage Centre');
  v_org := (v_prov -> 'organization' ->> 'id')::uuid;
  perform public.set_queue_status((v_prov -> 'queue' ->> 'id')::uuid, 'open', null);
  insert into p13 values
    ('gq', v_prov -> 'queue' ->> 'id'),
    ('gs_a', public.upsert_client_session(v_org, 'p13-conc-g-a', 'web', null) ->> 'id'),
    ('gs_b', public.upsert_client_session(v_org, 'p13-conc-g-b', 'web', null) ->> 'id'),
    ('gs_q', public.upsert_client_session(v_org, 'p13-conc-g-q', 'web', null) ->> 'id'),
    ('gtoken', encode(extensions.digest('p13-jeton-concurrence', 'sha256'), 'hex'));
  insert into p13 values
    ('gclaim', public.add_walkin((select v::uuid from p13 where k = 'gq'), null, null, null, null, null,
                                 '{"registration":"GH-321-JK"}'::jsonb) -> 'entry' ->> 'id'),
    ('gquote', public.join_queue((select v::uuid from p13 where k = 'gq'), (select v::uuid from p13 where k = 'gs_q'),
                                 null, null, null, 'qr', null, '{"registration":"JK-654-LM"}'::jsonb) -> 'entry' ->> 'id');
  perform public.staff_queue_action((select v from p13 where k = 'gclaim'), 'set_claim', null, null,
    jsonb_build_object('tokenHash', (select v from p13 where k = 'gtoken')));
  perform public.staff_queue_action((select v from p13 where k = 'gquote'), 'send_quote', null, null,
    '{"amountCents":18400,"label":"Plaquettes"}');

  insert into p13 values ('dblink_preexisting',
    case when exists (select 1 from pg_extension where extname = 'dblink') then 'yes' else 'no' end);
  begin
    create extension if not exists dblink with schema extensions;
    perform extensions.dblink_connect('p13_s2', format('host=%s port=%s dbname=%s user=%s',
      coalesce(host(inet_server_addr()), '127.0.0.1'), current_setting('port'),
      current_database(), current_user));
    insert into p13 values ('dblink', 'on');
  exception when others then
    insert into p13 values ('dblink', 'off');
    raise notice '  ..  seconde connexion indisponible (%) : scénario rejoué dans l''ordre', sqlerrm;
  end;
end
$$;

-- L'inscription gagne : elle tient le verrou de file quand le changement
-- de profil arrive, qui attend puis échoue en VT017.
begin;
  do $$
  begin
    perform public.join_queue((select v::uuid from p13 where k = 'cq'),
                              (select v::uuid from p13 where k = 'cs1'), null);
    if (select v from p13 where k = 'dblink') = 'on' then
      perform extensions.dblink_send_query('p13_s2', format(
        'select public.switch_queue_profile(%L::uuid, %L::public.queue_profile, null)',
        (select v from p13 where k = 'cq'), 'walkin'));
      perform pg_sleep(0.3);
      perform internal.assert(extensions.dblink_is_busy('p13_s2') = 1,
        'session 2 : le changement de profil attend le verrou de la file');
    end if;
  end $$;
commit;

do $$
declare
  v_ok boolean := false;
begin
  if (select v from p13 where k = 'dblink') = 'on' then
    begin
      perform * from extensions.dblink_get_result('p13_s2') as t(r jsonb);
    exception when sqlstate 'VT017' then
      v_ok := true;
    end;
    perform * from extensions.dblink_get_result('p13_s2') as t(r jsonb);
  else
    begin
      perform public.switch_queue_profile((select v::uuid from p13 where k = 'cq'), 'walkin', null);
    exception when sqlstate 'VT017' then
      v_ok := true;
    end;
  end if;
  perform internal.assert(v_ok, 'l''inscription gagne, le changement échoue en VT017');
  perform internal.assert_eq(
    (select profile::text from public.queues where id = (select v::uuid from p13 where k = 'cq')),
    'desk', 'la file garde son profil');

  -- On vide la file pour le scénario inverse.
  perform public.staff_queue_action(
    (select public_id from public.queue_entries
     where queue_id = (select v::uuid from p13 where k = 'cq') and public.entry_is_active(status)),
    'remove', null, null);
end
$$;

-- Le changement gagne : il tient le verrou quand l'inscription arrive,
-- qui attend puis suit le nouveau profil.
begin;
  do $$
  begin
    perform public.switch_queue_profile((select v::uuid from p13 where k = 'cq'), 'walkin', null);
    if (select v from p13 where k = 'dblink') = 'on' then
      perform extensions.dblink_send_query('p13_s2', format(
        'select public.join_queue(%L::uuid, %L::uuid, null)',
        (select v from p13 where k = 'cq'), (select v from p13 where k = 'cs2')));
      perform pg_sleep(0.3);
      perform internal.assert(extensions.dblink_is_busy('p13_s2') = 1,
        'session 2 : l''inscription attend la fin du changement de profil');
    end if;
  end $$;
commit;

do $$
declare
  v_entry jsonb;
begin
  if (select v from p13 where k = 'dblink') = 'on' then
    select r into v_entry from extensions.dblink_get_result('p13_s2') as t(r jsonb);
    perform * from extensions.dblink_get_result('p13_s2') as t(r jsonb);
  else
    v_entry := public.join_queue((select v::uuid from p13 where k = 'cq'),
                                 (select v::uuid from p13 where k = 'cs2'), null);
  end if;
  perform internal.assert(
    v_entry -> 'entry' ->> 'profile' = 'walkin' and v_entry -> 'entry' -> 'ticketNo' = 'null'::jsonb,
    'le changement gagne, l''inscription suit le nouveau profil (plus de numéro)');
end
$$;

-- Deux téléphones présentent le même QR de suivi au même instant : le
-- premier tient le verrou de la fiche, le second attend puis est refusé.
begin;
  do $$
  begin
    perform internal.assert(
      public.claim_entry((select v from p13 where k = 'gtoken'), (select v::uuid from p13 where k = 'gs_a')) is not null,
      'session 1 : rattachement en cours');
    if (select v from p13 where k = 'dblink') = 'on' then
      perform extensions.dblink_send_query('p13_s2', format(
        'select public.claim_entry(%L, %L::uuid)',
        (select v from p13 where k = 'gtoken'), (select v from p13 where k = 'gs_b')));
      perform pg_sleep(0.3);
      perform internal.assert(extensions.dblink_is_busy('p13_s2') = 1,
        'session 2 : le même jeton attend le verrou de la fiche');
    end if;
  end $$;
commit;

do $$
declare
  v_second jsonb;
begin
  if (select v from p13 where k = 'dblink') = 'on' then
    select r into v_second from extensions.dblink_get_result('p13_s2') as t(r jsonb);
    perform * from extensions.dblink_get_result('p13_s2') as t(r jsonb);
  else
    v_second := public.claim_entry((select v from p13 where k = 'gtoken'), (select v::uuid from p13 where k = 'gs_b'));
  end if;
  perform internal.assert(
    v_second is null
    and (select client_session_id = (select v::uuid from p13 where k = 'gs_a') and claim_token_hash is null
         from public.queue_entries where public_id = (select v from p13 where k = 'gclaim')),
    'double rattachement simultané : un seul téléphone suit la fiche, le second est refusé');
end
$$;

-- Le garage renvoie un devis pendant que le client accepte le premier :
-- la décision attend le verrou de la file, puis est refusée, parce que le
-- devis qu'elle vise n'est plus le devis en cours.
begin;
  do $$
  begin
    perform public.staff_queue_action((select v from p13 where k = 'gquote'), 'send_quote', null, null,
      '{"amountCents":25000,"label":"Plaquettes + disques"}');
    if (select v from p13 where k = 'dblink') = 'on' then
      perform extensions.dblink_send_query('p13_s2', format(
        'select public.client_queue_action(%L, %L::uuid, %L, %L::jsonb)',
        (select v from p13 where k = 'gquote'), (select v from p13 where k = 'gs_q'),
        'quote_accept', '{"quoteN":1}'));
      perform pg_sleep(0.3);
      perform internal.assert(extensions.dblink_is_busy('p13_s2') = 1,
        'session 2 : l''accord du client attend la fin de l''envoi du nouveau devis');
    end if;
  end $$;
commit;

do $$
declare
  v_refused boolean := false;
begin
  if (select v from p13 where k = 'dblink') = 'on' then
    begin
      perform * from extensions.dblink_get_result('p13_s2') as t(r jsonb);
    exception when sqlstate 'VT006' then
      v_refused := true;
    end;
    perform * from extensions.dblink_get_result('p13_s2') as t(r jsonb);
  else
    begin
      perform public.client_queue_action((select v from p13 where k = 'gquote'),
        (select v::uuid from p13 where k = 'gs_q'), 'quote_accept', '{"quoteN":1}');
    exception when sqlstate 'VT006' then
      v_refused := true;
    end;
  end if;
  perform internal.assert(
    v_refused
    and (select (details -> 'quote' ->> 'n')::int = 2 and details -> 'quote' -> 'decision' = 'null'::jsonb
                and (details -> 'quote' ->> 'amountCents')::int = 25000
         from public.queue_entries where public_id = (select v from p13 where k = 'gquote')),
    'accord concurrent d''un devis remplacé : refusé, le nouveau devis attend toujours sa décision');

  if (select v from p13 where k = 'dblink') = 'on' then
    perform extensions.dblink_disconnect('p13_s2');
    -- On ne retire l'extension que si ce test l'a installée.
    if (select v from p13 where k = 'dblink_preexisting') = 'no' then
      drop extension dblink;
    end if;
  end if;

  raise notice '';
  raise notice '✅ Profils métier : concurrence vérifiée (profil, rattachement, devis).';
end
$$;
