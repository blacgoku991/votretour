-- =====================================================================
-- Rangvia — sécurité des écrans TV / codes d'appairage
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
  v_pair uuid;
  v_result jsonb;
  v_device uuid;
  v_code_hash text := repeat('a', 64);
  v_token_hash text := repeat('b', 64);
begin
  raise notice '';
  raise notice '── TV Kiosk : isolation et appairage ──';

  insert into auth.users (id, email)
  values
    (v_owner, 'display-owner@test.local'),
    (v_rival, 'display-rival@test.local');

  v_prov := public.provision_organization(
    v_owner, 'Display Shop', 'event', 'Display Paris', 'shared', 'pro'
  );
  v_org := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;

  v_prov := public.provision_organization(
    v_rival, 'Rival Display', 'event', 'Rival Lyon', 'shared', 'pro'
  );
  v_rival_queue := (v_prov -> 'queue' ->> 'id')::uuid;

  -- Impossible de relier un code TV à la file d'un autre tenant.
  begin
    insert into public.display_pair_codes (
      organization_id, location_id, queue_id, display_name,
      code_hash, expires_at, created_by
    ) values (
      v_org, v_loc, v_rival_queue, 'Écran pirate',
      repeat('c', 64), now() + interval '10 minutes', v_owner
    );
    raise exception 'ÉCHEC: code TV multi-tenant accepté';
  exception when others then
    if sqlerrm like 'ÉCHEC:%' then raise; end if;
    raise notice '  ok  binding TV multi-tenant refusé';
  end;

  insert into public.display_pair_codes (
    organization_id, location_id, queue_id, display_name,
    code_hash, expires_at, created_by
  ) values (
    v_org, v_loc, v_queue, 'TV accueil',
    v_code_hash, now() + interval '10 minutes', v_owner
  )
  returning id into v_pair;

  v_result := public.consume_display_pair_code(v_code_hash, v_token_hash);
  if v_result is null then
    raise exception 'ÉCHEC: code TV valide non consommé';
  end if;

  v_device := (v_result ->> 'id')::uuid;
  if not exists (
    select 1
    from public.display_devices
    where id = v_device
      and organization_id = v_org
      and location_id = v_loc
      and queue_id = v_queue
      and token_hash = v_token_hash
      and status = 'active'
  ) then
    raise exception 'ÉCHEC: appareil TV mal créé';
  end if;

  if not exists (
    select 1 from public.display_pair_codes
    where id = v_pair and consumed_at is not null
  ) then
    raise exception 'ÉCHEC: code TV non marqué consommé';
  end if;
  raise notice '  ok  code valide consommé atomiquement et appareil créé';

  -- Un code déjà consommé ne peut pas être rejoué.
  v_result := public.consume_display_pair_code(v_code_hash, repeat('d', 64));
  if v_result is not null then
    raise exception 'ÉCHEC: rejeu d''un code TV consommé accepté';
  end if;
  raise notice '  ok  rejeu du code TV refusé';

  -- Le même code à six chiffres peut être généré plus tard : l'unicité
  -- ne porte que sur les codes encore utilisables.
  insert into public.display_pair_codes (
    organization_id, location_id, queue_id, display_name,
    code_hash, expires_at, created_by
  ) values (
    v_org, v_loc, v_queue, 'TV secondaire',
    v_code_hash, now() + interval '10 minutes', v_owner
  );

  if (
    select count(*)
    from public.display_pair_codes
    where code_hash = v_code_hash and consumed_at is null
  ) <> 1 then
    raise exception 'ÉCHEC: réutilisation sûre du code impossible';
  end if;
  raise notice '  ok  code consommé réutilisable sans collision';

  -- Un code expiré ne crée jamais de device.
  insert into public.display_pair_codes (
    organization_id, location_id, queue_id, display_name,
    code_hash, expires_at, created_by
  ) values (
    v_org, v_loc, v_queue, 'TV expirée',
    repeat('e', 64), now() - interval '1 minute', v_owner
  );

  v_result := public.consume_display_pair_code(repeat('e', 64), repeat('f', 64));
  if v_result is not null then
    raise exception 'ÉCHEC: code TV expiré accepté';
  end if;
  raise notice '  ok  code expiré refusé';

  -- Les primitives de pairing restent strictement serveur.
  begin
    execute 'set local role anon';
    perform public.consume_display_pair_code(v_code_hash, repeat('1', 64));
    execute 'reset role';
    raise exception 'ÉCHEC: anon a pu consommer un code TV';
  exception when insufficient_privilege then
    execute 'reset role';
    raise notice '  ok  anon ne peut pas appeler la RPC TV';
  end;
end
$$;
