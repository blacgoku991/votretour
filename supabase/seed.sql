-- =====================================================================
-- VotreTour — jeu de démonstration
-- ---------------------------------------------------------------------
-- Exécuté automatiquement par `supabase db reset` en local. Crée un
-- barbier parisien avec sa file ouverte, trois professionnels, trois
-- prestations et quatre personnes déjà en attente : de quoi tester le
-- parcours complet immédiatement.
--
-- Ne contient AUCUNE donnée réelle et n'est jamais appliqué en
-- production (supabase db push n'exécute pas seed.sql).
-- =====================================================================

do $$
declare
  v_owner uuid := '44444444-4444-4444-8444-444444444444';
  v_prov  jsonb;
  v_org   uuid;
  v_loc   uuid;
  v_queue uuid;
  v_plate text;
begin
  if exists (select 1 from public.organizations where slug like 'demo-barber%') then
    raise notice 'Jeu de démonstration déjà présent.';
    return;
  end if;

  -- Compte professionnel de démonstration.
  if not exists (select 1 from auth.users where id = v_owner) then
    insert into auth.users (id, email)
    values (v_owner, 'demo@votretour.test')
    on conflict do nothing;
  end if;
  insert into public.profiles (id, email, full_name)
  values (v_owner, 'demo@votretour.test', 'Karim Benali')
  on conflict (id) do nothing;

  v_prov := public.provision_organization(
    v_owner, 'Demo Barber House', 'barber', 'Barber House — Paris 11', 'shared', 'pro');

  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc   := (v_prov -> 'location'     ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue'        ->> 'id')::uuid;
  v_plate := v_prov -> 'plate' ->> 'code';

  update public.locations set
    google_review_url = 'https://search.google.com/local/writereview?placeid=ChIJDemoBarberHouse',
    address_line1 = '42 rue Oberkampf',
    postal_code   = '75011',
    city          = 'Paris',
    phone         = '+33140000000',
    latitude      = 48.8649,
    longitude     = 2.3765
  where id = v_loc;

  update public.queues
     set allow_staff_choice = true, allow_service_choice = true
   where id = v_queue;

  insert into public.staff (organization_id, location_id, display_name, role_title, accent, sort_order)
  values
    (v_org, v_loc, 'Karim', 'Barbier',  'signal', 0),
    (v_org, v_loc, 'Sofia', 'Barbière', 'jade',   1),
    (v_org, v_loc, 'Mehdi', 'Barbier',  'cobalt', 2);

  insert into public.services (organization_id, location_id, name, duration_minutes, price_cents, sort_order)
  values
    (v_org, v_loc, 'Coupe',          30, 2500, 0),
    (v_org, v_loc, 'Coupe + barbe',  45, 3500, 1),
    (v_org, v_loc, 'Barbe',          20, 1800, 2),
    (v_org, v_loc, 'Contour',        15, 1200, 3);

  perform public.set_queue_status(v_queue, 'open', v_owner);

  perform public.add_walkin(v_queue, 'Alexandre', null, null, v_owner);
  perform public.add_walkin(v_queue, 'Thomas',    null, null, v_owner);
  perform public.add_walkin(v_queue, 'Sarah',     null, null, v_owner);
  perform public.add_walkin(v_queue, 'Mohamed',   null, null, v_owner);

  raise notice '';
  raise notice 'Démonstration prête.';
  raise notice '  URL de plaque : /e/%', v_plate;
  raise notice '  Compte pro    : demo@votretour.test (définissez son mot de passe dans Supabase Auth)';
  raise notice '';
end
$$;
