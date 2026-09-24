-- =====================================================================
-- Rangvia — contrat de non-régression des files « walkin » (barbiers)
-- ---------------------------------------------------------------------
-- Lot R0 du chantier « profils métier ». Ce test est écrit AVANT le
-- chantier, sur le moteur tel qu'il tourne aujourd'hui, et doit rester
-- vert après chaque lot. Il fige ce que le web et l'App Clip lisent :
--
--   · les ensembles de clés EXACTS de entry_json_client,
--     entry_json_staff, ticket_state, resolve_entry_point,
--     queue_snapshot et public_queue_state ;
--   · les réglages posés par create_location pour un barbier ;
--   · le déroulé d'une file : VT010, promotion, paliers de
--     notification, avis de fin de visite, expiration, purge ;
--   · la sortie de location_stats sur un jeu de données fixe.
--
-- Seule évolution tolérée : l'AJOUT des clés prévues par la conception
-- des profils (v2/secteurs.md § 6.5, plan § 4 migration 0035, plus le
-- « profile » de la file renvoyée par create_location, migration 0037),
-- et seulement avec leur valeur neutre en walkin (null, {}, [], 'walkin',
-- préfixe par défaut). Toute autre clé ajoutée, toute clé retirée ou
-- renommée, toute valeur neutre qui ne l'est plus fait échouer le test :
-- c'est précisément ce qu'un ancien App Clip ou un écran barbier ne
-- saurait pas lire.
--
-- Données : une organisation « r0-contrat-barbier » dédiée, effacée au
-- début (rejouable sur une base déjà peuplée) et à la fin.
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- Outils d'assertion, propres à ce fichier (préfixe r0_) : le test se
-- lance seul comme dans la suite complète, et ne dépend pas des
-- fonctions d'assertion créées par 01.
-- ---------------------------------------------------------------------
create or replace function internal.r0_assert(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'ÉCHEC: %', p_label;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

create or replace function internal.r0_eq(p_actual jsonb, p_expected jsonb, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ÉCHEC: % (attendu %, obtenu %)', p_label, p_expected, p_actual;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

-- Une valeur est-elle acceptée par l'une des formes neutres listées ?
-- Forme littérale : égalité jsonb stricte (null, {}, [], "walkin"…).
-- Forme {"$shape": {"keys": [...], "values": [...] | "types": [...]}} :
-- un objet dont chaque clé appartient à "keys" et chaque valeur à
-- "values" (littéraux) ou à "types" (jsonb_typeof). Sert aux objets
-- d'options, dont toutes les entrées doivent être neutres en walkin.
create or replace function internal.r0_accepts(p_value jsonb, p_forms jsonb)
returns boolean language plpgsql immutable as $$
declare
  f jsonb;
  s jsonb;
begin
  for f in select value from jsonb_array_elements(p_forms) loop
    if jsonb_typeof(f) = 'object' and f ? '$shape' then
      s := f -> '$shape';
      if jsonb_typeof(p_value) = 'object' and not exists (
        select 1 from jsonb_each(p_value) kv
        where not ((s -> 'keys') ? kv.key)
           or (s ? 'values' and not exists (
                 select 1 from jsonb_array_elements(s -> 'values') v where v.value = kv.value))
           or (s ? 'types' and not ((s -> 'types') ? jsonb_typeof(kv.value)))
      ) then
        return true;
      end if;
    elsif p_value = f then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Ensemble de clés exact d'un objet, avec les ajouts tolérés.
--   p_expected  : les clés d'aujourd'hui, toutes obligatoires ;
--   p_tolerated : { clé ajoutée : [formes neutres acceptées] }.
create or replace function internal.r0_keys(
  p_obj jsonb, p_expected text[], p_tolerated jsonb, p_label text
) returns void language plpgsql as $$
declare
  v_missing text[];
  v_extra   text[];
  v_bad     text[];
begin
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' then
    raise exception 'ÉCHEC: % : objet attendu, obtenu %', p_label, p_obj;
  end if;

  select coalesce(array_agg(k order by k), '{}') into v_missing
  from unnest(p_expected) k where not (p_obj ? k);

  select coalesce(array_agg(k order by k), '{}') into v_extra
  from jsonb_object_keys(p_obj) k
  where k <> all (p_expected) and not (coalesce(p_tolerated, '{}'::jsonb) ? k);

  select coalesce(array_agg(k || ' = ' || (p_obj -> k)::text order by k), '{}') into v_bad
  from jsonb_object_keys(p_obj) k
  where k <> all (p_expected) and coalesce(p_tolerated, '{}'::jsonb) ? k
    and not internal.r0_accepts(p_obj -> k, p_tolerated -> k);

  if cardinality(v_missing) > 0 or cardinality(v_extra) > 0 or cardinality(v_bad) > 0 then
    raise exception 'ÉCHEC: % : clés manquantes %, clés inattendues %, valeurs non neutres %',
      p_label, v_missing, v_extra, v_bad;
  end if;
  raise notice '  ok  % : % clés exactes', p_label, cardinality(p_expected);
end;
$$;

-- Même contrôle sur chaque élément d'un tableau, qui ne doit pas être
-- vide : un tableau vide ne prouverait rien sur la forme de ses lignes.
create or replace function internal.r0_item_keys(
  p_arr jsonb, p_expected text[], p_tolerated jsonb, p_label text
) returns void language plpgsql as $$
declare
  v_item jsonb;
  v_i    int := 0;
begin
  if p_arr is null or jsonb_typeof(p_arr) <> 'array' or jsonb_array_length(p_arr) = 0 then
    raise exception 'ÉCHEC: % : tableau non vide attendu, obtenu %', p_label, p_arr;
  end if;
  for v_item in select value from jsonb_array_elements(p_arr) loop
    v_i := v_i + 1;
    perform internal.r0_keys(v_item, p_expected, p_tolerated, p_label || ' [' || v_i || ']');
  end loop;
end;
$$;

-- Réclame les notifications de la file et les rend sous la forme
-- { prénom : genre }, pour comparer le lot entier d'un coup.
create or replace function internal.r0_claim(p_queue_id uuid)
returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(c.client_name, c.kind::text), '{}'::jsonb)
  from public.claim_pending_notifications(p_queue_id) c;
$$;

-- =====================================================================
do $$
declare
  -- Identifiants fixes : le test est rejouable, et location_stats
  -- (byStaff) peut être comparé à un JSON écrit en clair.
  c_owner   constant uuid := '0a000000-0000-4000-8000-000000000011';
  c_karim   constant uuid := '0a000000-0000-4000-8000-0000000000a1';
  c_sofia   constant uuid := '0a000000-0000-4000-8000-0000000000a2';
  c_stat_k  constant uuid := '0a000000-0000-4000-8000-0000000000b1';
  c_stat_s  constant uuid := '0a000000-0000-4000-8000-0000000000b2';

  -- ── Contrat des clés ────────────────────────────────────────────────
  -- Clés d'aujourd'hui (obligatoires) et ajouts tolérés en walkin, avec
  -- leur valeur neutre. La liste des ajouts est celle de secteurs.md
  -- § 6.5 ; rien d'autre ne passe.
  -- File décrite par create_location (et provision_organization).
  k_created_queue constant text[] := array['id', 'name', 'mode', 'status'];
  t_created_queue constant jsonb := '{"profile": ["walkin"]}';

  k_entry_client constant text[] := array[
    'id', 'name', 'status', 'peopleAhead', 'joinedAt', 'calledAt', 'returningAt',
    'serviceStartedAt', 'completedAt', 'staffName', 'eventId', 'eventTicketNumber'];
  t_entry_client constant jsonb := '{
    "profile": ["walkin"], "stage": [null], "stageChangedAt": [null], "ticketNo": [null],
    "details": [{}], "deskLabel": [null], "readyEta": [null]}';

  k_entry_staff constant text[] := array[
    'id', 'name', 'status', 'peopleAhead', 'staffId', 'serviceId', 'source', 'note',
    'rejoinCount', 'joinedAt', 'calledAt', 'returningAt', 'presentAt', 'serviceStartedAt',
    'completedAt', 'absentAt', 'notified', 'eventId', 'eventTicketNumber'];
  t_entry_staff constant jsonb := '{
    "stage": [null], "stageChangedAt": [null], "details": [{}], "ticketNo": [null],
    "registrationKey": [null], "claimPending": [false, null], "deskLabel": [null]}';

  -- Options publiques d'une file walkin : absentes, vides, ou toutes
  -- neutres (aucun couvert, aucun choix de séjour, pas de numéro…).
  t_public_options constant jsonb := '[null, {}, {"$shape": {
    "keys": ["partyMax", "stayChoice", "numbering", "sensitive", "quotes"],
    "values": [null, false]}}]';

  k_ticket constant text[] := array['entry', 'queue', 'location', 'organization', 'at'];
  t_ticket constant jsonb := '{"stages": [[], null], "otherTickets": [[], null]}';
  k_ticket_queue constant text[] := array['id', 'status', 'mode', 'name', 'pauseReason', 'waiting'];
  k_ticket_location constant text[] := array[
    'id', 'name', 'slug', 'city', 'addressLine1', 'postalCode', 'phone', 'latitude',
    'longitude', 'mapsUrl', 'logoUrl', 'googleReviewUrl'];
  -- todayHours décrit l'établissement, pas le profil : seule sa forme
  -- est contrainte ({opensAt, closesAt}, texte ou null).
  t_ticket_location constant jsonb := '{"todayHours": [null, {"$shape": {
    "keys": ["opensAt", "closesAt"], "types": ["string", "null"]}}]}';
  k_ticket_org constant text[] := array['name', 'logoUrl'];

  k_resolve constant text[] := array[
    'status', 'slug', 'organization', 'location', 'plate', 'queue', 'settings', 'staff', 'services'];
  k_resolve_org constant text[] := array['id', 'name', 'activity', 'logoUrl'];
  k_resolve_location constant text[] := array[
    'id', 'name', 'slug', 'city', 'addressLine1', 'postalCode', 'latitude', 'longitude',
    'mapsUrl', 'phone', 'logoUrl', 'coverUrl', 'timezone', 'hasReviewLink'];
  k_resolve_plate constant text[] := array['id', 'code', 'label', 'kind', 'staffId'];
  k_resolve_queue constant text[] := array[
    'id', 'name', 'mode', 'status', 'askClientName', 'clientNameRequired', 'allowStaffChoice',
    'allowServiceChoice', 'pauseReason', 'waitingCount'];
  k_resolve_settings constant text[] := array['showPeopleAhead', 'allowClientLeave', 'brandAccent', 'locale'];
  k_resolve_staff constant text[] := array['id', 'name', 'roleTitle', 'avatarUrl', 'accent', 'onBreak', 'waiting'];
  k_resolve_service constant text[] := array['id', 'name', 'durationMinutes', 'priceCents'];

  k_snap constant text[] := array[
    'queue', 'location', 'serving', 'called', 'waiting', 'parked', 'staff', 'services',
    'counts', 'generatedAt'];
  k_snap_queue constant text[] := array[
    'id', 'name', 'mode', 'status', 'advanceMode', 'absentPolicy', 'absentMoveBackBy',
    'notifyAheadThreshold', 'askClientName', 'clientNameRequired', 'allowStaffChoice',
    'allowServiceChoice', 'pauseReason', 'maxActiveEntries', 'locationId', 'organizationId'];
  t_snap_queue constant jsonb := '{
    "profile": ["walkin"], "profileOptions": [{}], "ticketPrefix": ["A"]}';
  k_snap_location constant text[] := array['id', 'name', 'slug', 'timezone', 'googleReviewUrl'];
  k_snap_staff constant text[] := array[
    'id', 'name', 'roleTitle', 'avatarUrl', 'accent', 'isOnBreak', 'acceptsQueue', 'userId',
    'servingEntryId', 'waitingCount'];
  t_snap_staff constant jsonb := '{"deskLabel": [null]}';
  k_snap_service constant text[] := array['id', 'name', 'durationMinutes'];
  k_snap_counts constant text[] := array['active', 'waiting', 'serving', 'completedToday'];
  t_snap_counts constant jsonb := '{
    "byStage": [null, {}], "coversWaiting": [null, 0], "coversSeatedToday": [null, 0]}';

  -- public_queue_state est diffusé à tous : il ne reçoit AUCUN ajout.
  k_public constant text[] := array[
    'queueId', 'status', 'mode', 'waiting', 'serving', 'entries', 'closedEntries', 'at'];
  k_public_entry constant text[] := array['id', 'ahead', 'status', 'staffId'];
  k_public_closed constant text[] := array['id', 'status'];

  v_prov   jsonb;
  v_loc2   jsonb;
  v_org    uuid;
  v_loc    uuid;
  v_queue  uuid;
  v_queue2 uuid;
  v_plate  text;
  v_q      public.queues;
  v_s      uuid[] := '{}';
  v_name   text;
  v_join   jsonb;
  v_id     jsonb := '{}';   -- prénom → public_id
  v_res    jsonb;
  v_snap   jsonb;
  v_state  jsonb;
  v_seq    text[] := '{}';
  v_claim  jsonb;
  v_n      int;
  v_old    uuid;
  v_recent uuid;
  v_ev_old bigint;
  v_ev_new bigint;
  v_stat_loc   uuid;
  v_stat_queue uuid;
  v_expected   jsonb;
begin
  raise notice '';
  raise notice '══ Contrat walkin (barbiers) : référence de non-régression ══';

  delete from public.organizations where slug like 'r0-contrat-barbier%';
  delete from auth.users where id = c_owner;
  insert into auth.users (id, email, raw_user_meta_data)
  values (c_owner, 'owner@r0-contrat.test', '{"full_name":"Karim R."}'::jsonb);

  -- ───────────────────────────────────────────────────────────────────
  raise notice '';
  raise notice '── 1. Provisionnement d''un barbier : réglages posés par create_location ──';

  v_prov  := public.provision_organization(
    c_owner, 'R0 Contrat Barbier', 'barber', 'R0 Contrat Barbier — Bastille', 'shared', 'pro');
  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  v_plate := v_prov -> 'plate' ->> 'code';

  perform internal.r0_eq(v_prov -> 'organization' -> 'slug', '"r0-contrat-barbier"', 'slug d''organisation');
  -- La file renvoyée par create_location annonce son profil depuis la
  -- migration 0037 : ajout toléré, à condition qu'un barbier reste walkin.
  perform internal.r0_keys(v_prov -> 'queue', k_created_queue, t_created_queue,
    'create_location.queue');
  perform internal.r0_eq(
    (v_prov -> 'queue') - 'id' - 'profile',
    '{"name": "File principale", "mode": "shared", "status": "closed"}',
    'file renvoyée par create_location : principale, commune, fermée');

  select * into v_q from public.queues where id = v_queue;
  perform internal.r0_eq(
    jsonb_build_object(
      'mode', v_q.mode, 'status', v_q.status, 'isDefault', v_q.is_default,
      'advanceMode', v_q.advance_mode, 'entryTtlMinutes', v_q.entry_ttl_minutes,
      'absentPolicy', v_q.absent_policy, 'absentMoveBackBy', v_q.absent_move_back_by,
      'absentGraceMinutes', v_q.absent_grace_minutes,
      'notifyAheadThreshold', v_q.notify_ahead_threshold,
      'askClientName', v_q.ask_client_name, 'clientNameRequired', v_q.client_name_required,
      'allowStaffChoice', v_q.allow_staff_choice, 'allowServiceChoice', v_q.allow_service_choice,
      'maxActiveEntries', v_q.max_active_entries, 'joinCooldownSeconds', v_q.join_cooldown_seconds),
    '{"mode": "shared", "status": "closed", "isDefault": true,
      "advanceMode": "auto_serve", "entryTtlMinutes": 240,
      "absentPolicy": "move_back", "absentMoveBackBy": 2, "absentGraceMinutes": 5,
      "notifyAheadThreshold": 2,
      "askClientName": true, "clientNameRequired": false,
      "allowStaffChoice": false, "allowServiceChoice": false,
      "maxActiveEntries": null, "joinCooldownSeconds": 45}',
    'réglages de la file d''un barbier (auto_serve, 240 min, move_back de 2…)');
  perform internal.r0_eq(
    to_jsonb((select count(*) from public.services where location_id = v_loc)), '0',
    'aucune prestation créée pour un barbier');
  perform internal.r0_eq(
    to_jsonb((select data_retention_days from public.organization_settings where organization_id = v_org)),
    '30', 'conservation des données : 30 jours par défaut');
  perform internal.r0_eq(
    (select jsonb_build_object('label', label, 'kind', kind, 'queue', queue_id = v_queue)
       from public.plates where code = v_plate),
    '{"label": "Comptoir", "kind": "both", "queue": true}',
    'plaque « Comptoir » NFC et QR, reliée à la file');

  -- Second établissement créé directement : mêmes défauts, mode respecté.
  v_loc2 := public.create_location(
    v_org, 'R0 Contrat Barbier — Stats', 'barber', null, null, null, 'FR', 'Europe/Paris',
    null, 'per_staff', c_owner, 'r0-contrat-barbier-stats');
  v_stat_loc   := (v_loc2 -> 'location' ->> 'id')::uuid;
  v_stat_queue := (v_loc2 -> 'queue' ->> 'id')::uuid;
  perform internal.r0_keys(v_loc2 -> 'queue', k_created_queue, t_created_queue,
    'create_location.queue (établissement ajouté)');
  select * into v_q from public.queues where id = v_stat_queue;
  perform internal.r0_eq(
    jsonb_build_object('mode', v_q.mode, 'advanceMode', v_q.advance_mode,
                       'entryTtlMinutes', v_q.entry_ttl_minutes, 'absentPolicy', v_q.absent_policy,
                       'services', (select count(*) from public.services where location_id = v_stat_loc)),
    '{"mode": "per_staff", "advanceMode": "auto_serve", "entryTtlMinutes": 240,
      "absentPolicy": "move_back", "services": 0}',
    'create_location direct : mêmes défauts, mode par professionnel respecté');

  -- ───────────────────────────────────────────────────────────────────
  raise notice '';
  raise notice '── 2. Équipe, ouverture, résolution de la plaque ──';

  insert into public.staff (id, organization_id, location_id, display_name, role_title, sort_order)
  values (c_karim, v_org, v_loc, 'Karim', 'Barbier', 0),
         (c_sofia, v_org, v_loc, 'Sofia', 'Barbière', 1);
  -- Une prestation, ajoutée APRÈS le contrôle « aucune prestation »,
  -- pour que la forme des lignes services[] soit vérifiable.
  insert into public.services (organization_id, location_id, name, duration_minutes, price_cents)
  values (v_org, v_loc, 'Coupe', 30, 2500);
  update public.locations
     set google_review_url = 'https://search.google.com/local/writereview?placeid=R0'
   where id = v_loc;
  perform public.set_queue_status(v_queue, 'open', c_owner);

  v_res := public.resolve_entry_point(v_plate);
  perform internal.r0_keys(v_res, k_resolve, null, 'resolve_entry_point');
  perform internal.r0_keys(v_res -> 'organization', k_resolve_org, null, 'resolve_entry_point.organization');
  perform internal.r0_keys(v_res -> 'location', k_resolve_location, null, 'resolve_entry_point.location');
  perform internal.r0_keys(v_res -> 'plate', k_resolve_plate, null, 'resolve_entry_point.plate');
  perform internal.r0_keys(v_res -> 'queue', k_resolve_queue,
    jsonb_build_object('profile', '["walkin"]'::jsonb, 'publicOptions', t_public_options),
    'resolve_entry_point.queue');
  perform internal.r0_keys(v_res -> 'settings', k_resolve_settings, null, 'resolve_entry_point.settings');
  perform internal.r0_item_keys(v_res -> 'staff', k_resolve_staff, null, 'resolve_entry_point.staff');
  perform internal.r0_item_keys(v_res -> 'services', k_resolve_service, null, 'resolve_entry_point.services');
  perform internal.r0_eq(
    jsonb_build_object('status', v_res -> 'status', 'activity', v_res -> 'organization' -> 'activity',
                       'queue', (v_res -> 'queue') - 'id' - 'profile' - 'publicOptions',
                       'settings', v_res -> 'settings'),
    '{"status": "ok", "activity": "barber",
      "queue": {"name": "File principale", "mode": "shared", "status": "open",
                "askClientName": true, "clientNameRequired": false, "allowStaffChoice": false,
                "allowServiceChoice": false, "pauseReason": null, "waitingCount": 0},
      "settings": {"showPeopleAhead": true, "allowClientLeave": true,
                   "brandAccent": "signal", "locale": "fr"}}',
    'resolve_entry_point : valeurs lues par l''écran d''inscription');

  -- ───────────────────────────────────────────────────────────────────
  raise notice '';
  raise notice '── 3. Quatre clients rejoignent : Amine, Bilal, Chloé, Driss ──';

  foreach v_name in array array['Amine', 'Bilal', 'Chloé', 'Driss'] loop
    v_s := v_s || (public.upsert_client_session(
      v_org, 'r0-hash-' || lower(v_name), 'web', v_name) ->> 'id')::uuid;
    v_join := public.join_queue(v_queue, v_s[cardinality(v_s)], v_name, null, null, 'qr');
    v_id := v_id || jsonb_build_object(v_name, v_join -> 'entry' ->> 'id');
    perform internal.r0_keys(v_join -> 'entry', k_entry_client, t_entry_client,
      'entry_json_client (inscription de ' || v_name || ')');
  end loop;

  perform internal.r0_eq(
    (v_join -> 'entry') - 'id' - 'joinedAt'
      - 'profile' - 'stage' - 'stageChangedAt' - 'ticketNo' - 'details' - 'deskLabel' - 'readyEta',
    '{"name": "Driss", "status": "waiting", "peopleAhead": 3, "calledAt": null,
      "returningAt": null, "serviceStartedAt": null, "completedAt": null, "staffName": null,
      "eventId": null, "eventTicketNumber": null}',
    'entry_json_client de Driss : 3 personnes devant, aucun numéro');
  perform internal.r0_eq(v_join - 'entry', jsonb_build_object('rejoined', false, 'queueId', v_queue),
    'join_queue renvoie entry, rejoined = false et queueId');

  perform internal.r0_eq(internal.r0_claim(v_queue), '{}',
    'aucune notification juste après l''inscription (paliers neutralisés)');

  -- ───────────────────────────────────────────────────────────────────
  raise notice '';
  raise notice '── 4. Un pro ne sert qu''une personne : VT010 ──';

  v_res := public.staff_queue_action(v_id ->> 'Amine', 'start_serving', c_owner, c_karim);
  perform internal.r0_eq(v_res -> 'entry' -> 'status', '"serving"', 'Amine passe au fauteuil de Karim');
  perform internal.r0_keys(v_res -> 'entry', k_entry_staff, t_entry_staff, 'entry_json_staff (action du pro)');

  begin
    perform public.staff_queue_action(v_id ->> 'Bilal', 'start_serving', c_owner, c_karim);
    raise exception 'ÉCHEC: Karim a démarré une seconde prestation';
  exception when sqlstate 'VT010' then
    raise notice '  ok  start_serving sur un pro occupé : VT010';
  end;

  -- ───────────────────────────────────────────────────────────────────
  raise notice '';
  raise notice '── 5. Terminer promeut le suivant ; paliers ahead_two → ahead_one → your_turn ──';

  v_res := public.staff_queue_action(v_id ->> 'Amine', 'complete', c_owner, c_karim);
  perform internal.r0_eq(v_res -> 'entry' -> 'status', '"completed"', 'Amine est terminé');
  perform internal.r0_eq(
    jsonb_build_object('name', v_res -> 'promoted' -> 'name', 'status', v_res -> 'promoted' -> 'status',
                       'staffId', v_res -> 'promoted' -> 'staffId'),
    jsonb_build_object('name', 'Bilal', 'status', 'serving', 'staffId', c_karim),
    'complete promeut Bilal, pris en charge par Karim (auto_serve)');
  perform internal.r0_keys(v_res -> 'promoted', k_entry_staff, t_entry_staff, 'entry_json_staff (promu)');
  perform internal.r0_eq(v_res - 'entry' - 'promoted',
    jsonb_build_object('queueId', v_queue, 'organizationId', v_org, 'locationId', v_loc),
    'staff_queue_action renvoie aussi queueId, organizationId, locationId');

  v_claim := internal.r0_claim(v_queue);
  perform internal.r0_eq(v_claim, '{"Bilal": "your_turn", "Chloé": "ahead_one", "Driss": "ahead_two"}',
    'lot 1 : Bilal your_turn, Chloé ahead_one, Driss ahead_two');
  v_seq := v_seq || (v_claim ->> 'Driss');

  perform public.staff_queue_action(v_id ->> 'Bilal', 'complete', c_owner, c_karim);
  v_claim := internal.r0_claim(v_queue);
  perform internal.r0_eq(v_claim, '{"Chloé": "your_turn", "Driss": "ahead_one"}',
    'lot 2 : Chloé your_turn, Driss ahead_one');
  v_seq := v_seq || (v_claim ->> 'Driss');

  perform public.staff_queue_action(v_id ->> 'Chloé', 'complete', c_owner, c_karim);
  v_claim := internal.r0_claim(v_queue);
  perform internal.r0_eq(v_claim, '{"Driss": "your_turn"}', 'lot 3 : Driss your_turn');
  v_seq := v_seq || (v_claim ->> 'Driss');

  perform internal.r0_eq(to_jsonb(v_seq), '["ahead_two", "ahead_one", "your_turn"]',
    'Driss reçoit exactement ahead_two, ahead_one puis your_turn, dans cet ordre');
  perform internal.r0_eq(internal.r0_claim(v_queue), '{}', 'rien n''est réclamé deux fois');

  -- ───────────────────────────────────────────────────────────────────
  raise notice '';
  raise notice '── 6. Formes des instantanés : pro, client, diffusion publique ──';

  -- Driss au fauteuil ; Emma appelée ; Farid en attente ; Gaël retiré.
  foreach v_name in array array['Emma', 'Farid', 'Gaël'] loop
    v_s := v_s || (public.upsert_client_session(
      v_org, 'r0-hash-' || lower(v_name), 'web', v_name) ->> 'id')::uuid;
    v_join := public.join_queue(v_queue, v_s[cardinality(v_s)], v_name, null, null, 'nfc');
    v_id := v_id || jsonb_build_object(v_name, v_join -> 'entry' ->> 'id');
  end loop;
  perform public.staff_queue_action(v_id ->> 'Emma', 'call', c_owner, c_sofia);
  -- Retrait fait depuis le compte du gérant, sans poste de pro : aucun
  -- fauteuil n'est libéré, donc personne n'est promu (Sofia l'aurait été).
  perform public.staff_queue_action(v_id ->> 'Gaël', 'remove', c_owner, null);
  perform public.staff_queue_action(v_id ->> 'Farid', 'note', c_owner, c_sofia,
    '{"note": "Dégradé bas"}'::jsonb);

  v_snap := public.queue_snapshot(v_queue);
  perform internal.r0_keys(v_snap, k_snap, null, 'queue_snapshot');
  perform internal.r0_keys(v_snap -> 'queue', k_snap_queue, t_snap_queue, 'queue_snapshot.queue');
  perform internal.r0_keys(v_snap -> 'location', k_snap_location, null, 'queue_snapshot.location');
  perform internal.r0_item_keys(v_snap -> 'serving', k_entry_staff, t_entry_staff, 'queue_snapshot.serving');
  perform internal.r0_item_keys(v_snap -> 'called',  k_entry_staff, t_entry_staff, 'queue_snapshot.called');
  perform internal.r0_item_keys(v_snap -> 'waiting', k_entry_staff, t_entry_staff, 'queue_snapshot.waiting');
  perform internal.r0_item_keys(v_snap -> 'parked',  k_entry_staff, t_entry_staff, 'queue_snapshot.parked');
  perform internal.r0_item_keys(v_snap -> 'staff', k_snap_staff, t_snap_staff, 'queue_snapshot.staff');
  perform internal.r0_item_keys(v_snap -> 'services', k_snap_service, null, 'queue_snapshot.services');
  perform internal.r0_keys(v_snap -> 'counts', k_snap_counts, t_snap_counts, 'queue_snapshot.counts');

  -- Depuis 0035, le poste d'un pro peut demander les informations métier
  -- (p_include_details => true, paramètre ajouté en dernier). En walkin il
  -- n'y en a aucune : l'instantané complet est identique à celui par
  -- défaut, horodatage mis à part. Contrôle sauté sur un moteur antérieur.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'queue_snapshot' and p.pronargs = 2) then
    execute 'select public.queue_snapshot($1, true)' into v_res using v_queue;
    perform internal.r0_eq(v_res - 'generatedAt', v_snap - 'generatedAt',
      'queue_snapshot avec les informations métier : identique en walkin');
  end if;

  perform internal.r0_eq(
    jsonb_build_object(
      'serving', (select jsonb_agg(e ->> 'name') from jsonb_array_elements(v_snap -> 'serving') e),
      'called',  (select jsonb_agg(e ->> 'name') from jsonb_array_elements(v_snap -> 'called') e),
      'waiting', (select jsonb_agg(e ->> 'name') from jsonb_array_elements(v_snap -> 'waiting') e),
      'parked',  (select jsonb_agg(e ->> 'name') from jsonb_array_elements(v_snap -> 'parked') e),
      'note',    v_snap -> 'waiting' -> 0 -> 'note',
      'counts',  (v_snap -> 'counts') - 'byStage' - 'coversWaiting' - 'coversSeatedToday',
      'karimServing', (select s -> 'servingEntryId' from jsonb_array_elements(v_snap -> 'staff') s
                       where s ->> 'name' = 'Karim'),
      'queue', (v_snap -> 'queue') - 'id' - 'locationId' - 'organizationId'
                 - 'profile' - 'profileOptions' - 'ticketPrefix'),
    jsonb_build_object(
      'serving', '["Driss"]'::jsonb, 'called', '["Emma"]'::jsonb,
      'waiting', '["Farid"]'::jsonb, 'parked', '["Gaël"]'::jsonb,
      'note', 'Dégradé bas',
      'counts', '{"active": 3, "waiting": 1, "serving": 1, "completedToday": 3}'::jsonb,
      'karimServing', v_id -> 'Driss',
      'queue', '{"name": "File principale", "mode": "shared", "status": "open",
                 "advanceMode": "auto_serve", "absentPolicy": "move_back", "absentMoveBackBy": 2,
                 "notifyAheadThreshold": 2, "askClientName": true, "clientNameRequired": false,
                 "allowStaffChoice": false, "allowServiceChoice": false, "pauseReason": null,
                 "maxActiveEntries": null}'::jsonb),
    'queue_snapshot : répartition, note du pro, compteurs et réglages exposés');

  v_state := public.ticket_state(v_id ->> 'Farid', v_s[6]);
  perform internal.r0_keys(v_state, k_ticket, t_ticket, 'ticket_state');
  perform internal.r0_keys(v_state -> 'entry', k_entry_client, t_entry_client, 'ticket_state.entry');
  perform internal.r0_keys(v_state -> 'queue', k_ticket_queue,
    jsonb_build_object('profile', '["walkin"]'::jsonb, 'ticketPrefix', '["A", null]'::jsonb,
                       'publicOptions', t_public_options),
    'ticket_state.queue');
  perform internal.r0_keys(v_state -> 'location', k_ticket_location, t_ticket_location, 'ticket_state.location');
  perform internal.r0_keys(v_state -> 'organization', k_ticket_org, null, 'ticket_state.organization');
  perform internal.r0_assert(not ((v_state -> 'entry') ? 'note') and not ((v_state -> 'entry') ? 'notified'),
    'le client ne voit ni la note du pro ni le journal des notifications');
  perform internal.r0_eq(v_state -> 'location' -> 'googleReviewUrl', 'null',
    'lien d''avis masqué tant que la visite n''est pas terminée');

  v_state := public.ticket_state(v_id ->> 'Chloé', v_s[3]);
  perform internal.r0_keys(v_state, k_ticket, t_ticket, 'ticket_state (visite terminée)');
  perform internal.r0_eq(v_state -> 'location' -> 'googleReviewUrl',
    '"https://search.google.com/local/writereview?placeid=R0"',
    'lien d''avis révélé une fois la visite terminée');

  v_res := public.public_queue_state(v_queue);
  perform internal.r0_keys(v_res, k_public, null, 'public_queue_state');
  perform internal.r0_item_keys(v_res -> 'entries', k_public_entry, null, 'public_queue_state.entries');
  perform internal.r0_item_keys(v_res -> 'closedEntries', k_public_closed, null, 'public_queue_state.closedEntries');
  perform internal.r0_eq(
    jsonb_build_object('waiting', v_res -> 'waiting', 'serving', v_res -> 'serving',
                       'ahead', (select jsonb_agg(e -> 'ahead' order by (e ->> 'ahead')::int)
                                 from jsonb_array_elements(v_res -> 'entries') e),
                       'closed', jsonb_array_length(v_res -> 'closedEntries')),
    '{"waiting": 1, "serving": 1, "ahead": [0, 1, 2], "closed": 4}',
    'public_queue_state : compteurs et positions, sans aucun prénom');
  perform internal.r0_assert(position('Farid' in v_res::text) = 0 and position('Dégradé' in v_res::text) = 0,
    'la diffusion publique ne contient ni prénom ni note');

  -- ───────────────────────────────────────────────────────────────────
  raise notice '';
  raise notice '── 7. Fin de visite : l''avis part tout de suite ──';

  perform public.staff_queue_action(v_id ->> 'Driss', 'complete', c_owner, c_karim);
  perform internal.r0_assert(
    public.claim_entry_notification(
      (select id from public.queue_entries where public_id = v_id ->> 'Driss'), 'visit_completed'),
    'visit_completed réclamable immédiatement après Terminer');
  perform internal.r0_assert(
    not public.claim_entry_notification(
      (select id from public.queue_entries where public_id = v_id ->> 'Driss'), 'visit_completed'),
    'et une seule fois');

  -- ───────────────────────────────────────────────────────────────────
  raise notice '';
  raise notice '── 8. Expiration après 240 minutes ──';

  -- Emma (appelée) a rejoint il y a 241 min, Farid (au fauteuil depuis
  -- la fin de Driss) il y a 239 min.
  update public.queue_entries set joined_at = now() - interval '241 minutes'
   where public_id = v_id ->> 'Emma';
  update public.queue_entries set joined_at = now() - interval '239 minutes'
   where public_id = v_id ->> 'Farid';
  select coalesce(sum(x.expired), 0) into v_n
    from public.expire_stale_entries() x where x.queue_id = v_queue;
  perform internal.r0_eq(to_jsonb(v_n), '1', 'un seul ticket expiré dans la file');
  perform internal.r0_eq(
    (select jsonb_object_agg(client_name, status) from public.queue_entries
      where public_id in (v_id ->> 'Emma', v_id ->> 'Farid')),
    '{"Emma": "expired", "Farid": "serving"}',
    'expiré au-delà de 240 min, conservé en deçà');
  perform internal.r0_assert(
    (select expired_at is not null from public.queue_entries where public_id = v_id ->> 'Emma'),
    'l''heure d''expiration est posée');

  -- ───────────────────────────────────────────────────────────────────
  raise notice '';
  raise notice '── 9. Purge au-delà de la rétention (30 jours) ──';

  select id into v_old    from public.queue_entries where public_id = v_id ->> 'Amine';
  select id into v_recent from public.queue_entries where public_id = v_id ->> 'Bilal';
  update public.queue_entries
     set joined_at = now() - interval '31 days', staff_note = 'Contour net',
         metadata = '{"r0": true}'
   where id = v_old;
  update public.queue_entries
     set joined_at = now() - interval '29 days', staff_note = 'Barbe'
   where id = v_recent;
  update public.client_sessions set last_seen_at = now() - interval '31 days' where id = v_s[1];
  select id into v_ev_old from public.queue_events where entry_id = v_old order by created_at limit 1;
  select id into v_ev_new from public.queue_events where entry_id = v_recent order by created_at limit 1;
  update public.queue_events set created_at = now() - interval '31 days' where id = v_ev_old;
  update public.queue_events set created_at = now() - interval '29 days' where id = v_ev_new;

  v_res := public.purge_expired_data();
  perform internal.r0_assert((v_res ->> 'anonymizedEntries')::int >= 1, 'la purge anonymise au moins un ticket');

  perform internal.r0_eq(
    (select jsonb_build_object('name', client_name, 'session', client_session_id,
                               'note', staff_note, 'metadata', metadata, 'status', status)
       from public.queue_entries where id = v_old),
    '{"name": null, "session": null, "note": null, "metadata": {}, "status": "completed"}',
    'ticket de 31 jours : prénom, session, note et métadonnées effacés, statut gardé');
  perform internal.r0_eq(
    (select jsonb_build_object('name', client_name, 'session', client_session_id is not null,
                               'note', staff_note)
       from public.queue_entries where id = v_recent),
    '{"name": "Bilal", "session": true, "note": "Barbe"}',
    'ticket de 29 jours : intact');
  perform internal.r0_assert(not exists (select 1 from public.client_sessions where id = v_s[1]),
    'session inactive depuis 31 jours supprimée');
  perform internal.r0_assert(exists (select 1 from public.client_sessions where id = v_s[2]),
    'session récente conservée');
  perform internal.r0_assert(
    not exists (select 1 from public.queue_events where id = v_ev_old)
      and exists (select 1 from public.queue_events where id = v_ev_new),
    'historique : événement de 31 jours supprimé, de 29 jours conservé');

  -- ───────────────────────────────────────────────────────────────────
  raise notice '';
  raise notice '── 10. location_stats sur un jeu fixe ──';

  insert into public.staff (id, organization_id, location_id, display_name, sort_order)
  values (c_stat_k, v_org, v_stat_loc, 'Karim', 0),
         (c_stat_s, v_org, v_stat_loc, 'Sofia', 1);

  -- Mars 2026, établissement à Paris (UTC+1 jusqu'au 29, UTC+2 ensuite).
  -- Les heures sont écrites en UTC ; le commentaire donne l'heure locale.
  insert into public.queue_entries (
    organization_id, location_id, queue_id, staff_id, served_by_staff_id, client_name,
    status, source, sort_order, joined_at, service_started_at, completed_at,
    cancelled_at, absent_at, expired_at)
  values
    -- 10 mars, 9 h 00 : attente 10 min, coupe 20 min (Karim)
    (v_org, v_stat_loc, v_stat_queue, c_stat_k, c_stat_k, 'S1', 'completed', 'qr', 1,
     '2026-03-10 08:00+00', '2026-03-10 08:10+00', '2026-03-10 08:30+00', null, null, null),
    -- 10 mars, 9 h 05 : attente 15 min, coupe 30 min (Sofia)
    (v_org, v_stat_loc, v_stat_queue, c_stat_s, c_stat_s, 'S2', 'completed', 'nfc', 2,
     '2026-03-10 08:05+00', '2026-03-10 08:20+00', '2026-03-10 08:50+00', null, null, null),
    -- 10 mars, 9 h 40 : attente 10 min, coupe 15 min (Karim)
    (v_org, v_stat_loc, v_stat_queue, c_stat_k, c_stat_k, 'S3', 'completed', 'appclip', 3,
     '2026-03-10 08:40+00', '2026-03-10 08:50+00', '2026-03-10 09:05+00', null, null, null),
    -- 10 mars, 10 h 10 : parti au bout de 10 min
    (v_org, v_stat_loc, v_stat_queue, null, null, 'S4', 'cancelled', 'qr', 4,
     '2026-03-10 09:10+00', null, null, '2026-03-10 09:20+00', null, null),
    -- 12 mars, 0 h 30 heure de Paris (11 mars en UTC) : absent
    (v_org, v_stat_loc, v_stat_queue, null, null, 'S5', 'absent', 'link', 5,
     '2026-03-11 23:30+00', null, null, null, '2026-03-11 23:50+00', null),
    -- 12 mars, 11 h 00 : oublié, expiré
    (v_org, v_stat_loc, v_stat_queue, null, null, 'S6', 'expired', 'staff', 6,
     '2026-03-12 10:00+00', null, null, null, null, '2026-03-12 14:00+00'),
    -- 12 mars, 11 h 15 : retiré par le pro
    (v_org, v_stat_loc, v_stat_queue, null, null, 'S7', 'skipped', 'qr', 7,
     '2026-03-12 10:15+00', null, null, null, null, null),
    -- 12 mars, 11 h 20 : terminé sans « Démarrer » (attente et prestation
    -- se replient sur completed_at et joined_at)
    (v_org, v_stat_loc, v_stat_queue, c_stat_k, c_stat_k, 'S8', 'completed', 'staff', 8,
     '2026-03-12 10:20+00', null, '2026-03-12 10:40+00', null, null, null),
    -- 1er avril, 0 h 30 heure de Paris (31 mars en UTC) : dans la période
    (v_org, v_stat_loc, v_stat_queue, null, null, 'S9', 'cancelled', 'link', 9,
     '2026-03-31 22:30+00', null, null, '2026-03-31 22:45+00', null, null),
    -- 1er mars, 0 h 30 heure de Paris (28 février en UTC) : hors période
    (v_org, v_stat_loc, v_stat_queue, c_stat_s, c_stat_s, 'H1', 'completed', 'qr', 10,
     '2026-02-28 23:30+00', '2026-02-28 23:40+00', '2026-02-28 23:59+00', null, null, null),
    -- 1er avril, 9 h : hors période
    (v_org, v_stat_loc, v_stat_queue, c_stat_s, c_stat_s, 'H2', 'completed', 'qr', 11,
     '2026-04-01 07:00+00', '2026-04-01 07:05+00', '2026-04-01 07:30+00', null, null, null);

  -- Valeurs recalculées à la main (et non recopiées d'une exécution) :
  --   9 tickets dans la période (H1 et H2 exclus, bornes en UTC) ;
  --   attentes 600, 900, 600, 1200 s → moyenne 825, médiane 750 ;
  --   prestations 1200, 1800, 900, 1200 s → moyenne 1275 ;
  --   4 terminés sur 9 → 44,4 % ; absent + expiré, 2 sur 9 → 22,2 % ;
  --   jours et heures à Paris : S5 compte le 12 à 0 h, S9 le 1er avril à 0 h ;
  --   Karim : 1200, 900, 1200 → 1100 ; Sofia : 1800 ;
  --   pic : le 12 à 11 h 20, S5 (absent, jamais clos), S6, S7 et S8 → 4.
  v_expected := '{
    "range": {"from": "2026-03-01T00:00:00+00:00", "to": "2026-04-01T00:00:00+00:00"},
    "totals": {"joined": 9, "completed": 4, "cancelled": 2, "absent": 1, "skipped": 1, "expired": 1},
    "completionRate": 44.4,
    "avgWaitSeconds": 825,
    "medianWaitSeconds": 750,
    "avgServiceSeconds": 1275,
    "noShowRate": 22.2,
    "bySource": {"qr": 3, "nfc": 1, "appclip": 1, "link": 2, "staff": 2},
    "byDay": [
      {"day": "2026-03-10", "joined": 4, "completed": 3},
      {"day": "2026-03-12", "joined": 4, "completed": 1},
      {"day": "2026-04-01", "joined": 1, "completed": 0}],
    "byHour": [
      {"hour": 0, "joined": 2}, {"hour": 9, "joined": 3},
      {"hour": 10, "joined": 1}, {"hour": 11, "joined": 3}],
    "byStaff": [
      {"staffId": "0a000000-0000-4000-8000-0000000000b1", "name": "Karim",
       "completed": 3, "avgServiceSeconds": 1100},
      {"staffId": "0a000000-0000-4000-8000-0000000000b2", "name": "Sofia",
       "completed": 1, "avgServiceSeconds": 1800}],
    "peakConcurrent": 4
  }';

  -- La sortie est comparée sous le fuseau UTC de la session, celui du
  -- serveur en production : seul « range » en dépend.
  perform set_config('timezone', 'UTC', true);
  perform internal.r0_eq(
    public.location_stats(v_stat_loc, '2026-03-01 00:00+00', '2026-04-01 00:00+00'),
    v_expected, 'location_stats : sortie identique au JSON attendu');

  -- ───────────────────────────────────────────────────────────────────
  delete from public.organizations where id = v_org;
  delete from auth.users where id = c_owner;

  raise notice '';
  raise notice '✅ Contrat walkin : tous les tests passent.';
end
$$;

drop function internal.r0_claim(uuid);
drop function internal.r0_item_keys(jsonb, text[], jsonb, text);
drop function internal.r0_keys(jsonb, text[], jsonb, text);
drop function internal.r0_accepts(jsonb, jsonb);
drop function internal.r0_eq(jsonb, jsonb, text);
drop function internal.r0_assert(boolean, text);
