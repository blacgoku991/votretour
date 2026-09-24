-- =====================================================================
-- Rangvia — écran de salle : ce que reçoit le téléviseur (0031)
-- ---------------------------------------------------------------------
-- Le téléviseur est public. display_snapshot ne doit lui donner que ce que
-- TVBoard affiche : aucune note du pro, aucun journal de notifications,
-- aucune session client, aucun prénom de la file d'attente (des initiales
-- seulement). Et l'affichage doit rester celui d'avant : mêmes prénoms au
-- comptoir, mêmes initiales, mêmes compteurs que queue_snapshot.
--
-- Rejoué après 0036 (profils) : en walkin, la sortie ne doit pas bouger.
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

do $$
declare
  v_owner  uuid := extensions.gen_random_uuid();
  v_prov   jsonb;
  v_org    uuid;
  v_loc    uuid;
  v_queue  uuid;
  v_staff  uuid[] := '{}';
  v_sid    uuid;
  v_old    uuid;
  v_id     text;
  v_name   text;
  v_disp   jsonb;
  v_snap   jsonb;
  v_text   text;
  v_row    jsonb;
  v_expect jsonb;
  v_upc    jsonb;
  i        int;
  -- Prénoms saisis, et les initiales que l'écran affichait jusqu'ici
  -- (initials() de lib/format.ts, valeurs relevées dans le navigateur).
  c_waiting constant text[] := array[
    'Sarah', 'Jean-Luc Picard', null, 'Émilie', 'Zoé Dupont — Paris',
    E'Léa Martin', '92 Studio', 'Иван Петров', 'Hugo', 'Ömer'
  ];
  c_initials constant jsonb := jsonb_build_object(
    'Thomas Martin', 'TM', 'Sarah', 'S', 'Jean-Luc Picard', 'JP', 'Émilie', 'É',
    'Zoé Dupont — Paris', 'ZD', E'Léa Martin', 'LM', '92 Studio', 'S',
    'Иван Петров', 'ИП', 'Hugo', 'H', 'Ömer', 'Ö'
  );
begin
  raise notice '';
  raise notice '── Écran de salle : display_snapshot ──';

  insert into auth.users (id, email) values (v_owner, 'tv-display@test.local');
  v_prov := public.provision_organization(
    v_owner, 'Salon Écran', 'barber', 'Salon Écran — Lyon 2', 'shared', 'pro');
  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;

  -- Sept pros (l'écran en montre six), dont une en pause.
  for i in 1..7 loop
    insert into public.staff (organization_id, location_id, display_name, sort_order, is_on_break)
    values (v_org, v_loc, (array['Karim','Sofia','Yanis','Nora','Malik','Lina','Théo'])[i], i, i = 3)
    returning id into v_sid;
    v_staff := v_staff || v_sid;
  end loop;
  -- Un ancien pro, désactivé plus bas en pleine prestation.
  insert into public.staff (organization_id, location_id, display_name, sort_order)
  values (v_org, v_loc, 'Ancien', 99) returning id into v_old;

  perform public.set_queue_status(v_queue, 'open', v_owner);

  -- Deux clients servis aujourd'hui.
  foreach v_name in array array['Paul', 'Nadia'] loop
    v_id := public.add_walkin(v_queue, v_name, null, null, v_owner, null) -> 'entry' ->> 'id';
    perform public.staff_queue_action(v_id, 'start_serving', v_owner, v_staff[1]);
    perform public.staff_queue_action(v_id, 'complete', v_owner, v_staff[1]);
  end loop;

  -- Quatre prestations (l'écran montre trois volets), avec des notes privées.
  -- Alexandre vient d'un téléphone : il a une session client.
  v_sid := (public.upsert_client_session(v_org, 'hash-tv-alexandre', 'ios_appclip', 'Alexandre') ->> 'id')::uuid;
  v_id := public.join_queue(v_queue, v_sid, 'Alexandre', null, null, 'nfc') -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_id, 'start_serving', v_owner, v_staff[1]);
  perform public.staff_queue_action(v_id, 'note', v_owner, v_staff[1], '{"note":"NOTE-PRIVEE allergie au baume"}');
  v_id := public.add_walkin(v_queue, 'Inès', null, null, v_owner, null) -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_id, 'start_serving', v_owner, v_staff[2]);
  v_id := public.add_walkin(v_queue, 'Bruno', null, null, v_owner, null) -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_id, 'start_serving', v_owner, v_old);
  v_id := public.add_walkin(v_queue, 'Chloé', null, null, v_owner, null) -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_id, 'start_serving', v_owner, v_staff[4]);
  update public.staff set is_active = false where id = v_old;

  -- Un appelé, puis dix personnes en attente (l'écran montre sept lattes).
  v_sid := (public.upsert_client_session(v_org, 'hash-tv-thomas', 'web', 'Thomas Martin') ->> 'id')::uuid;
  v_id := public.join_queue(v_queue, v_sid, 'Thomas Martin', null, null, 'qr') -> 'entry' ->> 'id';
  perform public.staff_queue_action(v_id, 'call', v_owner, null);
  perform public.staff_queue_action(v_id, 'note', v_owner, null, '{"note":"NOTE-PRIVEE paie en espèces"}');
  foreach v_name in array c_waiting loop
    v_id := public.add_walkin(v_queue, v_name, null, null, v_owner, null) -> 'entry' ->> 'id';
    perform public.staff_queue_action(v_id, 'note', v_owner, null, '{"note":"NOTE-PRIVEE rappeler au 06 12 34 56 78"}');
  end loop;
  perform public.claim_pending_notifications(v_queue);

  perform internal.assert(
    exists (select 1 from public.queue_entries where queue_id = v_queue and notification_status <> '{}'::jsonb),
    'le journal des notifications est bien rempli (sinon le test ne prouverait rien)');

  v_disp := public.display_snapshot(v_queue);
  v_snap := public.queue_snapshot(v_queue);
  v_text := v_disp::text;

  raise notice '';
  raise notice '   Rien de ce que l''écran n''affiche pas';

  perform internal.assert_eq(internal.test_keys(v_disp),
    array['counts','location','queue','serving','staff','upcoming'], 'clés de premier niveau');
  perform internal.assert(
    not (internal.test_all_keys(v_disp) && array['note','notified','clientSessionId','details',
      'organizationId','locationId','servingEntryId','userId','joinedAt','source','peopleAhead']),
    'aucune clé note, notified, clientSessionId, details… à aucune profondeur');
  perform internal.assert(position('NOTE-PRIVEE' in v_text) = 0, 'aucune note du pro dans le texte envoyé');
  perform internal.assert(
    not exists (select 1 from public.client_sessions s
                where s.organization_id = v_org and position(s.id::text in v_text) > 0),
    'aucun identifiant de session client');
  perform internal.assert(
    position(v_org::text in v_text) = 0 and position(v_loc::text in v_text) = 0,
    'ni l''organisation ni l''établissement');
  perform internal.assert(
    position('Jean-Luc' in v_text) = 0 and position('Picard' in v_text) = 0
      and position('Thomas' in v_text) = 0 and position('Sarah' in v_text) = 0,
    'aucun prénom de la file d''attente (des initiales seulement)');
  perform internal.assert(position('Chloé' in v_text) = 0,
    'la quatrième prestation, qui n''a pas de volet, n''est pas envoyée');

  perform internal.assert_eq(internal.test_keys(v_disp -> 'queue'), array['id','status'], 'clés de queue');
  perform internal.assert_eq(internal.test_keys(v_disp -> 'location'), array['name'], 'clés de location');
  perform internal.assert_eq(internal.test_keys(v_disp -> 'counts'),
    array['active','completedToday','serving','upcoming','waiting'], 'clés de counts');
  perform internal.assert_eq(internal.test_keys(v_disp -> 'staff' -> 0),
    array['id','isOnBreak','isServing','name'], 'clés d''un pro');
  perform internal.assert_eq(internal.test_keys(v_disp -> 'serving' -> 0),
    array['id','name','staffName'], 'clés d''un volet au comptoir');
  perform internal.assert_eq(internal.test_keys(v_disp -> 'upcoming' -> 0),
    array['called','id','initials'], 'clés d''une latte à suivre');

  raise notice '';
  raise notice '   Le même affichage que queue_snapshot';

  perform internal.assert_eq(v_disp -> 'queue' ->> 'id', v_snap -> 'queue' ->> 'id', 'même file');
  perform internal.assert_eq(v_disp -> 'queue' ->> 'status', v_snap -> 'queue' ->> 'status', 'même état');
  perform internal.assert_eq(v_disp -> 'location' ->> 'name', v_snap -> 'location' ->> 'name', 'même établissement');
  perform internal.assert_eq(v_disp -> 'counts' -> 'active', v_snap -> 'counts' -> 'active', 'counts.active');
  perform internal.assert_eq(v_disp -> 'counts' -> 'waiting', v_snap -> 'counts' -> 'waiting', 'counts.waiting');
  perform internal.assert_eq(v_disp -> 'counts' -> 'serving', v_snap -> 'counts' -> 'serving', 'counts.serving');
  perform internal.assert_eq(v_disp -> 'counts' -> 'completedToday', v_snap -> 'counts' -> 'completedToday',
    'counts.completedToday');
  perform internal.assert_eq((v_disp -> 'counts' ->> 'upcoming')::int,
    jsonb_array_length(v_snap -> 'called') + jsonb_array_length(v_snap -> 'waiting'),
    'counts.upcoming = appelés + en attente');
  perform internal.assert_eq((v_disp -> 'counts' ->> 'completedToday')::int, 2, 'deux clients servis aujourd''hui');

  -- Équipe : les six premiers de queue_snapshot, même ordre, même état.
  perform internal.assert_eq(jsonb_array_length(v_disp -> 'staff'), 6, 'six pros au plus');
  for i in 0..5 loop
    v_row := v_snap -> 'staff' -> i;
    perform internal.assert(
      v_disp -> 'staff' -> i = jsonb_build_object(
        'id', v_row -> 'id', 'name', v_row -> 'name', 'isOnBreak', v_row -> 'isOnBreak',
        'isServing', to_jsonb(v_row ->> 'servingEntryId' is not null)),
      format('pro %s identique (%s)', i + 1, v_row ->> 'name'));
  end loop;

  -- Au comptoir : les trois premiers volets, mêmes prénoms, même pro que
  -- celui que l'écran trouvait dans la liste staff de queue_snapshot.
  perform internal.assert_eq(jsonb_array_length(v_snap -> 'serving'), 4, 'quatre prestations en cours');
  perform internal.assert_eq(jsonb_array_length(v_disp -> 'serving'), 3, 'trois volets au plus');
  for i in 0..2 loop
    v_row := v_snap -> 'serving' -> i;
    v_expect := jsonb_build_object(
      'id', v_row -> 'id',
      'name', v_row -> 'name',
      'staffName', coalesce((
        select s -> 'name' from jsonb_array_elements(v_snap -> 'staff') s
        where s ->> 'id' = v_row ->> 'staffId'), 'null'::jsonb));
    perform internal.assert(v_disp -> 'serving' -> i = v_expect,
      format('volet %s identique (%s)', i + 1, v_row ->> 'name'));
  end loop;
  perform internal.assert(
    exists (select 1 from jsonb_array_elements(v_disp -> 'serving') r
            where r ->> 'name' = 'Bruno' and r -> 'staffName' = 'null'::jsonb),
    'pro désactivé : « En prestation », comme avant');

  -- À suivre : appelés puis attente, sept lattes, initiales identiques.
  v_upc := coalesce(v_snap -> 'called', '[]') || coalesce(v_snap -> 'waiting', '[]');
  perform internal.assert_eq(jsonb_array_length(v_disp -> 'upcoming'), 7, 'sept lattes au plus');
  for i in 0..6 loop
    v_row := v_upc -> i;
    if coalesce(v_row ->> 'name', '') <> '' and not c_initials ? (v_row ->> 'name') then
      raise exception 'ÉCHEC: initiales de référence absentes pour %', v_row ->> 'name';
    end if;
    v_expect := jsonb_build_object(
      'id', v_row -> 'id',
      'called', to_jsonb(v_row ->> 'status' = 'next'),
      'initials', case when coalesce(v_row ->> 'name', '') = '' then 'null'::jsonb
                       else c_initials -> (v_row ->> 'name') end);
    perform internal.assert(v_disp -> 'upcoming' -> i = v_expect,
      format('latte %s identique (%s → %s)', i + 1, coalesce(v_row ->> 'name', 'sans prénom'),
             coalesce(v_expect ->> 'initials', 'rien')));
  end loop;

  raise notice '';
  raise notice '   Initiales (parité avec initials() de lib/format.ts)';
  perform internal.assert_eq(internal.display_initials('Zoé Dupont – Paris'), 'ZD', 'tiret demi-cadratin isolé');
  perform internal.assert_eq(internal.display_initials('Zoé Dupont-Paris'), 'ZD', 'trait d''union collé : un seul mot');
  perform internal.assert_eq(internal.display_initials('Garage 92 — Nanterre'), 'G', 'les chiffres ne font pas d''initiale');
  perform internal.assert_eq(internal.display_initials('92 44'), '94', 'sans lettre : premiers caractères');
  perform internal.assert_eq(internal.display_initials(E' Hugo Blanc '), 'HB', 'blancs Unicode');
  perform internal.assert_eq(internal.display_initials('élodie marie claire'), 'ÉM', 'deux mots, en capitales');
  perform internal.assert_eq(internal.display_initials(E' '), '?', 'rien d''exploitable : « ? »');

  raise notice '';
  raise notice '   File inconnue, file vide';
  perform internal.assert(public.display_snapshot(extensions.gen_random_uuid()) is null, 'file inconnue : null');
  update public.queue_entries set status = 'cancelled'
   where queue_id = v_queue and public.entry_is_active(status);
  v_disp := public.display_snapshot(v_queue);
  perform internal.assert(
    v_disp -> 'serving' = '[]'::jsonb and v_disp -> 'upcoming' = '[]'::jsonb
      and (v_disp -> 'counts' ->> 'upcoming')::int = 0,
    'file vide : listes vides, compteurs à zéro');
end
$$;

-- ---------------------------------------------------------------------
-- Droits : le navigateur (anon, authenticated) ne peut pas l'appeler.
-- ---------------------------------------------------------------------
do $$
declare
  v_role text;
begin
  raise notice '';
  raise notice '   Droits';
  perform internal.assert(
    has_function_privilege('service_role', 'public.display_snapshot(uuid)', 'execute'),
    'service_role peut exécuter display_snapshot');
  perform internal.assert(
    not has_function_privilege('anon', 'public.display_snapshot(uuid)', 'execute'),
    'anon ne peut pas exécuter display_snapshot');
  perform internal.assert(
    not has_function_privilege('authenticated', 'public.display_snapshot(uuid)', 'execute'),
    'authenticated ne peut pas exécuter display_snapshot');
  perform internal.assert(
    (select prosecdef from pg_proc where oid = 'public.display_snapshot(uuid)'::regprocedure),
    'display_snapshot est security definer');
  perform internal.assert(
    (select proconfig @> array['search_path=public, internal, extensions']
       from pg_proc where oid = 'public.display_snapshot(uuid)'::regprocedure),
    'search_path figé');

  -- Et l'appel réel est refusé.
  foreach v_role in array array['anon', 'authenticated'] loop
    begin
      execute format('set local role %I', v_role);
      perform public.display_snapshot(extensions.gen_random_uuid());
      raise exception 'ÉCHEC: % a exécuté display_snapshot', v_role;
    exception when insufficient_privilege then
      raise notice '  ok  appel refusé pour %', v_role;
    end;
  end loop;
  reset role;
end
$$;
