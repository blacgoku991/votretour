-- =====================================================================
-- VotreTour — isolation multi-tenant vue depuis le navigateur
-- ---------------------------------------------------------------------
-- On se place réellement dans la peau des rôles PostgREST (anon /
-- authenticated) en positionnant les mêmes GUC que Supabase, puis on
-- vérifie qu'aucune fuite n'est possible entre deux commerces.
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- Jeu de données : deux commerces concurrents
-- ---------------------------------------------------------------------
do $$
declare
  v_a uuid := '11111111-1111-4111-8111-111111111111';
  v_b uuid := '22222222-2222-4222-8222-222222222222';
  v_admin uuid := '33333333-3333-4333-8333-333333333333';
  v_prov jsonb;
  v_sess uuid;
begin
  delete from public.organizations where slug in ('rls-barber', 'rls-garage');
  delete from auth.users where id in (v_a, v_b, v_admin);

  insert into auth.users (id, email) values
    (v_a, 'a@rls.test'), (v_b, 'b@rls.test'), (v_admin, 'admin@rls.test');
  update public.profiles set is_platform_admin = true where id = v_admin;

  v_prov := public.provision_organization(v_a, 'RLS Barber', 'barber', 'RLS Barber Centre');
  perform public.set_queue_status((v_prov -> 'queue' ->> 'id')::uuid, 'open', v_a);
  v_sess := (public.upsert_client_session(
    (v_prov -> 'organization' ->> 'id')::uuid, 'rls-hash-a', 'web', 'Client A') ->> 'id')::uuid;
  perform public.join_queue((v_prov -> 'queue' ->> 'id')::uuid, v_sess, 'Client A');

  v_prov := public.provision_organization(v_b, 'RLS Garage', 'garage', 'RLS Garage Nord');
  perform public.set_queue_status((v_prov -> 'queue' ->> 'id')::uuid, 'open', v_b);
  v_sess := (public.upsert_client_session(
    (v_prov -> 'organization' ->> 'id')::uuid, 'rls-hash-b', 'web', 'Client B') ->> 'id')::uuid;
  perform public.join_queue((v_prov -> 'queue' ->> 'id')::uuid, v_sess, 'Client B');
end
$$;

-- ---------------------------------------------------------------------
-- 1. Rôle anon : aucune donnée métier accessible
-- ---------------------------------------------------------------------
begin;
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';

  do $$
  declare v_ok boolean;
  begin
    foreach v_ok in array array[true] loop null; end loop;
  end $$;

  -- Chaque table métier doit refuser l'accès au rôle anonyme.
  do $$
  declare
    t text;
    n int;
    tables text[] := array[
      'organizations','locations','staff','queues','queue_entries','queue_events',
      'client_sessions','notification_subscriptions','plates','profiles',
      'organization_members','audit_logs','system_errors','rate_limits'
    ];
  begin
    foreach t in array tables loop
      begin
        execute format('select count(*) from public.%I', t) into n;
        if n > 0 then
          raise exception 'ÉCHEC: le rôle anon lit %I (% lignes)', t, n;
        end if;
        raise notice '  ok  anon ne lit aucune ligne de %', t;
      exception when insufficient_privilege then
        raise notice '  ok  anon n''a aucun privilège sur %', t;
      end;
    end loop;
  end $$;

  -- Les offres publiques restent lisibles (page tarifs).
  do $$
  declare n int;
  begin
    select count(*) into n from public.plans;
    if n < 1 then raise exception 'ÉCHEC: la grille tarifaire publique est inaccessible'; end if;
    raise notice '  ok  anon lit le catalogue d''offres public (% offres)', n;
  end $$;

  -- Les fonctions métier ne sont pas appelables depuis le navigateur.
  do $$
  begin
    begin
      perform public.platform_stats();
      raise exception 'ÉCHEC: anon a pu appeler platform_stats()';
    exception when insufficient_privilege then
      raise notice '  ok  anon ne peut pas appeler platform_stats()';
    end;
    begin
      perform public.resolve_entry_point('x');
      raise exception 'ÉCHEC: anon a pu appeler resolve_entry_point()';
    exception when insufficient_privilege then
      raise notice '  ok  anon ne peut pas appeler resolve_entry_point()';
    end;
  end $$;
rollback;

-- ---------------------------------------------------------------------
-- 2. Rôle authenticated : chacun chez soi
-- ---------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

  do $$
  declare n int; v_names text;
  begin
    select count(*) into n from public.organizations;
    if n <> 1 then raise exception 'ÉCHEC: le patron A voit % organisations', n; end if;
    select string_agg(name, ',') into v_names from public.organizations;
    if v_names <> 'RLS Barber' then raise exception 'ÉCHEC: A voit %', v_names; end if;
    raise notice '  ok  le professionnel A ne voit que son organisation';

    select count(*) into n from public.queue_entries;
    if n <> 1 then raise exception 'ÉCHEC: A voit % tickets', n; end if;
    select string_agg(client_name, ',') into v_names from public.queue_entries;
    if v_names <> 'Client A' then raise exception 'ÉCHEC: A voit le ticket %', v_names; end if;
    raise notice '  ok  A ne voit que les tickets de sa propre file';

    select count(*) into n from public.locations;
    if n <> 1 then raise exception 'ÉCHEC: A voit % établissements', n; end if;
    raise notice '  ok  A ne voit que son établissement';

    select count(*) into n from public.plates;
    if n <> 1 then raise exception 'ÉCHEC: A voit % plaques', n; end if;
    raise notice '  ok  A ne voit que ses plaques';

    -- Les secrets d'appareil ne sont jamais exposés à un professionnel.
    select count(*) into n from public.client_sessions;
    if n <> 0 then raise exception 'ÉCHEC: A voit % sessions clients (jetons push)', n; end if;
    raise notice '  ok  aucun professionnel n''accède aux jetons d''appareil des clients';

    select count(*) into n from public.notification_subscriptions;
    if n <> 0 then raise exception 'ÉCHEC: A voit % abonnements push', n; end if;
    raise notice '  ok  aucun professionnel n''accède aux abonnements push';

    select count(*) into n from public.system_errors;
    if n <> 0 then raise exception 'ÉCHEC: A voit les erreurs système de la plateforme'; end if;
    raise notice '  ok  les journaux plateforme restent réservés au super-admin';
  end $$;

  -- Impossible de s'auto-promouvoir super-admin.
  do $$
  begin
    begin
      update public.profiles set is_platform_admin = true
      where id = '11111111-1111-4111-8111-111111111111';
      if (select is_platform_admin from public.profiles
          where id = '11111111-1111-4111-8111-111111111111') then
        raise exception 'ÉCHEC: un professionnel s''est promu super-admin';
      end if;
      raise notice '  ok  l''auto-promotion en super-admin est bloquée';
    exception when check_violation or insufficient_privilege then
      raise notice '  ok  l''auto-promotion en super-admin est refusée par RLS';
    end;
  end $$;

  -- Aucune écriture directe sur la file : tout passe par le serveur.
  do $$
  begin
    begin
      insert into public.queue_entries (organization_id, location_id, queue_id, sort_order)
      select organization_id, location_id, id, 1 from public.queues limit 1;
      raise exception 'ÉCHEC: écriture directe autorisée sur queue_entries';
    exception when insufficient_privilege then
      raise notice '  ok  aucune écriture directe possible sur la file depuis le navigateur';
    end;
    begin
      update public.queue_entries set client_name = 'pirate';
      raise exception 'ÉCHEC: mise à jour directe autorisée sur queue_entries';
    exception when insufficient_privilege then
      raise notice '  ok  aucune modification directe possible sur la file';
    end;
    begin
      delete from public.locations;
      raise exception 'ÉCHEC: suppression directe autorisée sur locations';
    exception when insufficient_privilege then
      raise notice '  ok  aucune suppression directe possible sur les établissements';
    end;
  end $$;
rollback;

-- ---------------------------------------------------------------------
-- 3. Le concurrent ne voit rien de plus
-- ---------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
  do $$
  declare v_names text;
  begin
    select string_agg(client_name, ',') into v_names from public.queue_entries;
    if coalesce(v_names, '') <> 'Client B' then
      raise exception 'ÉCHEC: le professionnel B voit %', v_names;
    end if;
    raise notice '  ok  le professionnel B ne voit que sa propre file';
  end $$;
rollback;

-- ---------------------------------------------------------------------
-- 4. Un compte sans organisation ne voit rien
-- ---------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}';
  do $$
  declare n int;
  begin
    select count(*) into n from public.organizations;
    if n <> 0 then raise exception 'ÉCHEC: un inconnu voit % organisations', n; end if;
    select count(*) into n from public.queue_entries;
    if n <> 0 then raise exception 'ÉCHEC: un inconnu voit % tickets', n; end if;
    raise notice '  ok  un compte sans organisation ne voit strictement rien';
  end $$;
rollback;

-- ---------------------------------------------------------------------
-- 5. Le super-admin voit l'ensemble de la plateforme
-- ---------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
  do $$
  declare n int;
  begin
    if not public.is_platform_admin() then raise exception 'ÉCHEC: super-admin non reconnu'; end if;
    select count(*) into n from public.organizations;
    if n < 2 then raise exception 'ÉCHEC: le super-admin ne voit que % organisations', n; end if;
    raise notice '  ok  le super-admin voit les % organisations de la plateforme', n;
    select count(*) into n from public.queue_entries;
    if n < 2 then raise exception 'ÉCHEC: le super-admin ne voit que % tickets', n; end if;
    raise notice '  ok  le super-admin voit toutes les files actives';
  end $$;
rollback;

do $$ begin raise notice ''; raise notice '✅ Isolation multi-tenant : tous les tests passent.'; end $$;
