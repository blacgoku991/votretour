-- =====================================================================
-- Rangvia — le métier attribué par l'équipe Rangvia (0042)
-- ---------------------------------------------------------------------
-- Le commerçant déclare son activité ; il ne choisit pas son métier. La
-- base le garantit à la création :
--
--   - provision_organization (inscription, création par le super-admin)
--     et create_location (« Ajouter un établissement ») donnent TOUJOURS
--     une file au passage (walkin), pour chacune des activités, avec les
--     réglages exacts d'un barbier et sans aucune prestation créée ;
--     seules exceptions, en attendant l'installation : ni avis Google en
--     santé et en service administratif ({"review": false}, respecté par
--     claim_entry_notification), ni prénom demandé en santé ;
--   - l'activité déclarée est gardée telle quelle sur l'organisation ;
--   - l'attribution par switch_queue_profile marche toujours : réglages
--     et motifs du métier, activité relue (santé → guichet sans prénom ni
--     avis), refus VT017 tant qu'un ticket est actif, retour au passage ;
--   - les deux fonctions restent SECURITY DEFINER, search_path figé, et
--     refusées à anon et à authenticated.
--
-- Tout se joue dans une transaction annulée à la fin.
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

-- Les réglages de fonctionnement d'une file, en une ligne comparable.
create or replace function internal.p42_settings(p_queue_id uuid)
returns text language sql stable as $$
  select concat_ws(' · ',
    q.profile, q.profile_options::text, q.advance_mode, q.entry_ttl_minutes,
    q.absent_policy, q.absent_grace_minutes, q.ask_client_name,
    q.client_name_required, q.allow_service_choice, q.allow_staff_choice)
  from public.queues q where q.id = p_queue_id;
$$;

do $$
declare
  v_owner    uuid := extensions.gen_random_uuid();
  v_admin    uuid := extensions.gen_random_uuid();
  v_act      public.activity_type;
  v_prov     jsonb;
  v_queue    public.queues;
  v_barber   text;
  v_q        jsonb := '{}'::jsonb;
  v_o        jsonb := '{}'::jsonb;
  v_res      jsonb;
  v_loc      jsonb;
  v_entry    jsonb;
  v_services int;
  v_org      uuid;
  v_fn       text;
  v_expected text;
  v_uuid     uuid;
begin
  raise notice '';
  raise notice '══ Métier attribué par l’équipe Rangvia ══';

  insert into auth.users (id, email) values
    (v_owner, 'p42-owner@metier.test'),
    (v_admin, 'p42-admin@metier.test');
  update public.profiles set is_platform_admin = true where id = v_admin;

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 1. Inscription : toujours au passage, l’activité gardée ──';

  -- Le barbier sert d'étalon : c'est le produit d'aujourd'hui (test 11).
  v_prov := public.provision_organization(
    v_owner, 'P42 barber', 'barber', 'P42 barber Centre', 'per_staff', 'pro');
  v_barber := internal.p42_settings((v_prov -> 'queue' ->> 'id')::uuid);
  perform internal.assert(v_barber like 'walkin · {} · auto_serve · 240 · move_back · 5 · t · f · f · f',
    'barbier : réglages d’aujourd’hui');

  for v_act in select unnest(enum_range(null::public.activity_type)) loop
    v_prov := public.provision_organization(
      v_owner, 'P42 ' || v_act::text, v_act, 'P42 ' || v_act::text || ' Centre', 'per_staff', 'pro');
    select * into v_queue from public.queues where id = (v_prov -> 'queue' ->> 'id')::uuid;

    if v_queue.profile <> 'walkin' or v_prov -> 'queue' ->> 'profile' is distinct from 'walkin' then
      raise exception 'ÉCHEC: % donne le métier % (attendu walkin)', v_act, v_queue.profile;
    end if;
    -- Réglages du barbier, à la lettre, sauf santé et service
    -- administratif : sans avis Google, et sans prénom en santé.
    v_expected := case v_act
      when 'health' then 'walkin · {"review": false} · auto_serve · 240 · move_back · 5 · f · f · f · f'
      when 'admin_service' then 'walkin · {"review": false} · auto_serve · 240 · move_back · 5 · t · f · f · f'
      else v_barber
    end;
    if internal.p42_settings(v_queue.id) is distinct from v_expected then
      raise exception 'ÉCHEC: % : réglages % (attendu %)',
        v_act, internal.p42_settings(v_queue.id), v_expected;
    end if;
    -- Le mode choisi est gardé, comme pour un barbier.
    if v_queue.mode <> 'per_staff' then
      raise exception 'ÉCHEC: % : mode % (attendu per_staff)', v_act, v_queue.mode;
    end if;
    select count(*) into v_services from public.services where location_id = v_queue.location_id;
    if v_services <> 0 then
      raise exception 'ÉCHEC: % : % prestation(s) créée(s)', v_act, v_services;
    end if;
    if (select activity from public.organizations where id = v_queue.organization_id) <> v_act then
      raise exception 'ÉCHEC: % : activité non gardée', v_act;
    end if;
    v_q := v_q || jsonb_build_object(v_act::text, v_queue.id);
    v_o := v_o || jsonb_build_object(v_act::text, v_queue.organization_id);
  end loop;
  raise notice '  ok  les % activités : file au passage, réglages du barbier (santé et administration : sans avis, santé : sans prénom), aucune prestation, activité gardée',
    (select count(*) from unnest(enum_range(null::public.activity_type)));

  -- La demande d'avis ne part pas d'un cabinet de santé au passage, même
  -- avec un lien d'avis collé plus tard dans les Réglages ; elle part
  -- toujours chez le barbier.
  update public.locations set google_review_url = 'https://g.page/r/p42/review'
   where id in (select location_id from public.queues where id in ((v_q ->> 'health')::uuid, (v_q ->> 'barber')::uuid));
  foreach v_fn in array array['health', 'admin_service', 'barber', 'garage'] loop
    update public.queues set status = 'open' where id = (v_q ->> v_fn)::uuid;
    v_entry := public.add_walkin(p_queue_id => (v_q ->> v_fn)::uuid, p_client_name => null, p_actor_user_id => v_owner);
    select id into v_uuid from public.queue_entries where public_id = v_entry -> 'entry' ->> 'id';
    update public.queue_entries set status = 'completed', completed_at = now() where id = v_uuid;
    perform internal.assert_eq(
      public.claim_entry_notification(v_uuid, 'visit_completed'),
      v_fn in ('barber', 'garage'),
      v_fn || ' au passage : demande d’avis de fin de visite');
    update public.queues set status = 'closed' where id = (v_q ->> v_fn)::uuid;
  end loop;

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 2. « Ajouter un établissement » : même règle ──';

  -- Garage : l'activité est relue sur l'organisation (settings.ts envoie null).
  v_loc := public.create_location((v_o ->> 'garage')::uuid, 'P42 Garage Sud', null);
  perform internal.assert_eq(v_loc -> 'queue' ->> 'profile', 'walkin', 'garage, deuxième établissement');
  perform internal.assert_eq(
    internal.p42_settings((v_loc -> 'queue' ->> 'id')::uuid), v_barber, 'garage, deuxième établissement : réglages');

  -- Santé : l'activité relue sur l'organisation garde les deux exceptions.
  v_loc := public.create_location((v_o ->> 'health')::uuid, 'P42 Cabinet Nord', null);
  perform internal.assert_eq(
    internal.p42_settings((v_loc -> 'queue' ->> 'id')::uuid),
    'walkin · {"review": false} · auto_serve · 240 · move_back · 5 · f · f · f · f',
    'santé, deuxième établissement : ni avis ni prénom');
  select count(*) into v_services from public.services where location_id = (v_loc -> 'location' ->> 'id')::uuid;
  perform internal.assert_eq(v_services, 0, 'garage, deuxième établissement : prestations');

  -- Activité passée explicitement à une organisation « other » : elle est
  -- inscrite, la file reste au passage.
  v_loc := public.create_location((v_o ->> 'other')::uuid, 'P42 Chez Paul', 'restaurant');
  perform internal.assert_eq(v_loc -> 'queue' ->> 'profile', 'walkin', 'restaurant déclaré à la création');
  perform internal.assert_eq(
    (select activity from public.organizations where id = (v_o ->> 'other')::uuid),
    'restaurant'::public.activity_type, 'activité « other » remplacée par celle déclarée');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 3. Attribution par l’équipe Rangvia (switch_queue_profile) ──';

  v_res := public.switch_queue_profile((v_q ->> 'garage')::uuid, 'vehicle', v_admin);
  select * into v_queue from public.queues where id = (v_q ->> 'garage')::uuid;
  perform internal.assert(
    (v_res ->> 'changed')::boolean and v_queue.profile = 'vehicle'
    and v_queue.profile_options ->> 'tvRegistration' = 'masked'
    and (v_queue.profile_options ->> 'quotes')::boolean
    and v_queue.mode = 'shared',
    'garage → atelier véhicule : devis en ligne, plaque masquée à l’écran, file commune');
  select count(*) into v_services from public.services where location_id = v_queue.location_id and is_active;
  perform internal.assert_eq(v_services, 7, 'garage → atelier : motifs du métier');
  perform internal.assert(exists (
    select 1 from public.audit_logs a
    where a.action = 'queue.profile_changed' and a.target_id = v_queue.id::text
      and a.actor_user_id = v_admin and a.metadata ->> 'to' = 'vehicle'
  ), 'le changement est journalisé avec son auteur');

  -- Santé : l'activité gardée à l'inscription donne le bon guichet.
  perform public.switch_queue_profile((v_q ->> 'health')::uuid, 'desk', v_admin);
  select * into v_queue from public.queues where id = (v_q ->> 'health')::uuid;
  perform internal.assert(
    v_queue.profile = 'desk'
    and (v_queue.profile_options ->> 'sensitive')::boolean
    and not (v_queue.profile_options ->> 'review')::boolean
    and not v_queue.ask_client_name,
    'santé → guichet : ni prénom ni avis Google par défaut');

  -- N'importe quel métier, même sans rapport avec l'activité déclarée.
  v_res := public.switch_queue_profile((v_q ->> 'barber')::uuid, 'event', v_admin);
  perform internal.assert_eq(v_res ->> 'profile', 'event', 'barbier → événement (choix du super-admin)');
  perform public.switch_queue_profile((v_q ->> 'barber')::uuid, 'walkin', v_admin);

  -- VT017 : un ticket actif bloque le changement.
  update public.queues set status = 'open' where id = (v_q ->> 'restaurant')::uuid;
  v_entry := public.add_walkin(
    p_queue_id => (v_q ->> 'restaurant')::uuid, p_client_name => 'Nadia', p_actor_user_id => v_owner);
  begin
    perform public.switch_queue_profile((v_q ->> 'restaurant')::uuid, 'table', v_admin);
    raise exception 'ÉCHEC: changement de métier avec un client en file';
  exception when sqlstate 'VT017' then
    raise notice '  ok  file non vide : refus VT017';
  end;
  perform internal.assert_eq(
    (select profile from public.queues where id = (v_q ->> 'restaurant')::uuid),
    'walkin'::public.queue_profile, 'refusé : la file reste au passage');
  perform public.staff_queue_action(v_entry -> 'entry' ->> 'id', 'remove', v_owner, null);
  v_res := public.switch_queue_profile((v_q ->> 'restaurant')::uuid, 'table', v_admin);
  perform internal.assert_eq(v_res ->> 'profile', 'table', 'file vidée : restaurant → table');

  -- Santé revenue au passage : ses réglages d'avant (sans avis ni prénom).
  v_res := public.switch_queue_profile((v_q ->> 'health')::uuid, 'walkin', v_admin);
  perform internal.assert_eq(
    internal.p42_settings((v_q ->> 'health')::uuid),
    'walkin · {"review": false} · auto_serve · 240 · move_back · 5 · f · f · f · f',
    'santé revenue au passage : toujours ni avis ni prénom');

  -- Retour au passage : réglages d'avant rétablis.
  v_res := public.switch_queue_profile((v_q ->> 'garage')::uuid, 'walkin', v_admin);
  perform internal.assert((v_res ->> 'settingsRestored')::boolean, 'retour au passage : réglages d’avant rétablis');
  perform internal.assert_eq(
    split_part(internal.p42_settings((v_q ->> 'garage')::uuid), ' · ', 1), 'walkin', 'garage revenu au passage');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 4. Droits ──';

  foreach v_fn in array array[
    'public.create_location(uuid,text,public.activity_type,text,text,text,text,text,text,public.queue_mode,uuid,text)',
    'public.provision_organization(uuid,text,public.activity_type,text,public.queue_mode,text)',
    'public.switch_queue_profile(uuid,public.queue_profile,uuid)'
  ] loop
    perform internal.assert(
      not has_function_privilege('anon', v_fn, 'execute')
      and not has_function_privilege('authenticated', v_fn, 'execute')
      and has_function_privilege('service_role', v_fn, 'execute'),
      v_fn || ' : service_role seulement');
  end loop;
  perform internal.assert(
    (select p.prosecdef and 'search_path=public, internal, extensions' = any(p.proconfig)
       from pg_proc p where p.oid = 'public.create_location(uuid,text,public.activity_type,text,text,text,text,text,text,public.queue_mode,uuid,text)'::regprocedure),
    'create_location : SECURITY DEFINER, search_path figé');
end
$$;

rollback;
