-- =====================================================================
-- Rangvia — stock de plaques fournisseur
-- ---------------------------------------------------------------------
-- Une plaque physique porte un lien gravé une fois pour toutes. Ces
-- tests prouvent les trois règles de la migration 0017 : le lien est
-- réservé dès la génération, il n'est jamais libéré, et une plaque ne
-- peut jamais servir deux sociétés à la fois.
-- =====================================================================

\set ON_ERROR_STOP on

do $$
declare
  v_admin uuid := '66666666-6666-4666-8666-666666666666';
  v_a     uuid := '77777777-7777-4777-8777-777777777777';
  v_b     uuid := '88888888-8888-4888-8888-888888888888';
  v_prov  jsonb;
  v_org_a uuid; v_loc_a uuid; v_q_a uuid;
  v_org_b uuid; v_loc_b uuid; v_q_b uuid;
  v_batch jsonb;
  v_codes text[];
  v_res   jsonb;
  v_ep    jsonb;
  v_n     int;
  v_plate uuid;
  v_text  text;
begin
  raise notice '';
  raise notice '══ Stock de plaques fournisseur ══';

  delete from public.organizations where slug in ('stock-barber', 'stock-garage');
  delete from auth.users where id in (v_admin, v_a, v_b);
  insert into auth.users (id, email) values
    (v_admin, 'admin@stock.test'), (v_a, 'a@stock.test'), (v_b, 'b@stock.test');

  v_prov := public.provision_organization(v_a, 'Stock Barber', 'barber', 'Stock Barber Centre');
  v_org_a := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc_a := (v_prov -> 'location' ->> 'id')::uuid;
  v_q_a   := (v_prov -> 'queue' ->> 'id')::uuid;

  v_prov := public.provision_organization(v_b, 'Stock Garage', 'garage', 'Stock Garage Sud');
  v_org_b := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc_b := (v_prov -> 'location' ->> 'id')::uuid;
  v_q_b   := (v_prov -> 'queue' ->> 'id')::uuid;

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 1. Génération d''un lot ──';
  v_batch := public.create_plate_batch('TEST lot fournisseur', 50, 'both', 'Gravure laser', v_admin);
  perform internal.assert_eq((v_batch ->> 'quantity')::int, 50, 'le lot contient exactement 50 plaques');

  select array_agg(code order by serial) into v_codes
  from public.plate_stock where batch_id = (v_batch ->> 'id')::uuid;
  perform internal.assert_eq(coalesce(array_length(v_codes, 1), 0), 50, '50 lignes de stock créées');

  select count(*)::int into v_n from unnest(v_codes) c
  where c !~ '^rv-[0-9abcdefghjkmnpqrstvwxyz]{5}-[0-9abcdefghjkmnpqrstvwxyz]{5}$';
  perform internal.assert_eq(v_n, 0, 'tous les codes suivent le format rv-xxxxx-xxxxx sans lettre ambiguë');

  select count(*)::int into v_n from public.slug_registry
  where slug = any(v_codes) and kind = 'stock' and organization_id is null;
  perform internal.assert_eq(v_n, 50, 'chaque lien est réservé dans le registre, sans société');

  select count(distinct serial)::int into v_n from public.plate_stock where code = any(v_codes);
  perform internal.assert_eq(v_n, 50, 'chaque plaque a son propre numéro de série');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 2. Bornes de quantité ──';
  begin
    perform public.create_plate_batch('TEST vide', 0);
    raise exception 'ÉCHEC: un lot de 0 plaque a été accepté';
  exception when sqlstate 'VT014' then
    raise notice '  ok  un lot vide est refusé';
  end;
  begin
    perform public.create_plate_batch('TEST énorme', 1001);
    raise exception 'ÉCHEC: un lot de 1001 plaques a été accepté';
  exception when sqlstate 'VT014' then
    raise notice '  ok  un lot de plus de 1000 plaques est refusé';
  end;

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 3. Une plaque en stock n''ouvre aucune file ──';
  perform internal.assert(public.resolve_entry_point(v_codes[1]) is null,
    'le lien d''une plaque non attribuée ne mène à aucun établissement');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 4. Attribution ──';
  v_res := public.assign_stock_plate(v_codes[1], v_loc_a, null, null, 'Comptoir', v_admin);
  v_plate := (v_res ->> 'plateId')::uuid;
  perform internal.assert_eq((v_res ->> 'organizationId')::uuid::text, v_org_a::text,
    'la plaque est attribuée à la société choisie');

  v_ep := public.resolve_entry_point(v_codes[1]);
  perform internal.assert_eq(v_ep ->> 'status', 'ok', 'le lien gravé ouvre désormais la file');
  perform internal.assert_eq(v_ep -> 'organization' ->> 'id', v_org_a::text,
    'et c''est bien la file de cette société');
  perform internal.assert_eq(v_ep -> 'queue' ->> 'id', v_q_a::text,
    'sans file précisée, la file par défaut de l''établissement est prise');

  select count(*)::int into v_n from public.slug_registry
  where slug = v_codes[1] and kind = 'plate' and organization_id = v_org_a and ref_id = v_plate;
  perform internal.assert_eq(v_n, 1, 'le registre suit la plaque attribuée');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 5. Une plaque ne sert qu''une société à la fois ──';
  begin
    perform public.assign_stock_plate(v_codes[1], v_loc_b);
    raise exception 'ÉCHEC: une plaque attribuée a été réattribuée sans le demander';
  exception when sqlstate 'VT013' then
    raise notice '  ok  réattribuer exige une demande explicite';
  end;

  begin
    perform public.assign_stock_plate(v_codes[2], v_loc_a, v_q_b);
    raise exception 'ÉCHEC: une file d''une autre société a été acceptée';
  exception when sqlstate 'VT005' then
    raise notice '  ok  une file d''une autre société est refusée';
  end;
  perform internal.assert_eq(
    (select status from public.plate_stock where code = v_codes[2]), 'available',
    'la tentative refusée n''a rien attribué');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 6. Réattribution vers une autre société ──';
  v_res := public.assign_stock_plate(v_codes[1], v_loc_b, v_q_b, null, null, v_admin, true);
  perform internal.assert_eq(v_res ->> 'previousOrganizationId', v_org_a::text,
    'la réattribution rapporte l''ancienne société (pour l''audit)');
  perform internal.assert_eq(public.resolve_entry_point(v_codes[1]) -> 'organization' ->> 'id', v_org_b::text,
    'le même lien gravé ouvre maintenant la file de la nouvelle société');
  select count(*)::int into v_n from public.plates where code = v_codes[1];
  perform internal.assert_eq(v_n, 1, 'une seule plaque porte ce lien');
  select count(*)::int into v_n from public.plates where code = v_codes[1] and organization_id = v_org_a;
  perform internal.assert_eq(v_n, 0, 'l''ancienne société ne voit plus cette plaque');

  -- Une réattribution vers une cible invalide ne doit RIEN défaire.
  begin
    perform public.assign_stock_plate(v_codes[1], v_loc_a, v_q_b, null, null, v_admin, true);
    raise exception 'ÉCHEC: une réattribution invalide a été acceptée';
  exception when sqlstate 'VT005' then
    raise notice '  ok  une réattribution invalide est refusée';
  end;
  perform internal.assert_eq(public.resolve_entry_point(v_codes[1]) -> 'organization' ->> 'id', v_org_b::text,
    'et la plaque est restée chez sa société actuelle');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 7. Supprimer une plaque la rend au stock, le lien reste réservé ──';
  select plate_id into v_plate from public.plate_stock where code = v_codes[1];
  -- Exactement ce que fait adminDeletePlate côté serveur.
  delete from public.plates where id = v_plate;
  delete from public.slug_registry where kind = 'plate' and ref_id = v_plate;

  perform internal.assert_eq((select status from public.plate_stock where code = v_codes[1]), 'available',
    'la plaque supprimée retourne au stock');
  select count(*)::int into v_n from public.slug_registry
  where slug = v_codes[1] and kind = 'stock' and organization_id is null;
  perform internal.assert_eq(v_n, 1, 'son lien gravé reste réservé : il ne sera jamais réutilisé ailleurs');
  perform internal.assert(public.resolve_entry_point(v_codes[1]) is null,
    'et il n''ouvre plus aucune file');

  v_res := public.assign_stock_plate(v_codes[1], v_loc_a, null, null, null, v_admin);
  perform internal.assert_eq(public.resolve_entry_point(v_codes[1]) -> 'organization' ->> 'id', v_org_a::text,
    'une plaque revenue au stock s''attribue de nouveau');
  select label into v_text from public.plates where code = v_codes[1];
  perform internal.assert(v_text like 'Plaque n° %', 'sans nom fourni, la plaque porte son numéro de série');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 8. Rebut ──';
  perform public.set_stock_plate_void(v_codes[3], true);
  begin
    perform public.assign_stock_plate(v_codes[3], v_loc_a);
    raise exception 'ÉCHEC: une plaque au rebut a été attribuée';
  exception when sqlstate 'VT013' then
    raise notice '  ok  une plaque au rebut ne s''attribue pas';
  end;
  perform public.set_stock_plate_void(v_codes[3], false);
  perform internal.assert_eq((select status from public.plate_stock where code = v_codes[3]), 'available',
    'une plaque retrouvée revient disponible');
  begin
    perform public.set_stock_plate_void(v_codes[1], true);
    raise exception 'ÉCHEC: une plaque en service est partie au rebut';
  exception when sqlstate 'VT013' then
    raise notice '  ok  une plaque en service ne part pas au rebut sans être libérée';
  end;

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 9. Suppression d''une société ──';
  v_res := public.assign_stock_plate(v_codes[4], v_loc_b, null, null, null, v_admin);
  delete from public.organizations where id = v_org_b;
  perform internal.assert_eq((select status from public.plate_stock where code = v_codes[4]), 'available',
    'les plaques d''une société supprimée retournent au stock');
  select count(*)::int into v_n from public.slug_registry where slug = v_codes[4] and kind = 'stock';
  perform internal.assert_eq(v_n, 1, 'leurs liens restent réservés');

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 10. Un établissement ne peut pas prendre un lien de stock ──';
  begin
    insert into public.slug_registry (slug, kind, organization_id, ref_id)
    values (v_codes[5], 'location', v_org_a, extensions.gen_random_uuid());
    raise exception 'ÉCHEC: un lien de stock a été réservé une seconde fois';
  exception when unique_violation then
    raise notice '  ok  un lien de stock ne peut pas être repris';
  end;
  begin
    insert into public.slug_registry (slug, kind, organization_id, ref_id)
    values ('rv-test-orphelin', 'plate', null, extensions.gen_random_uuid());
    raise exception 'ÉCHEC: une plaque sans société a été acceptée';
  exception when check_violation then
    raise notice '  ok  seul le stock peut exister sans société';
  end;

  -- -------------------------------------------------------------------
  raise notice '';
  raise notice '── 11. Comptes calculés en base ──';
  v_res := public.plate_stock_summary(array[(v_batch ->> 'id')::uuid]);
  perform internal.assert_eq(jsonb_array_length(v_res -> 'batches'), 1, 'un détail par lot demandé');
  perform internal.assert_eq(
    (v_res -> 'batches' -> 0 ->> 'available')::int
      + (v_res -> 'batches' -> 0 ->> 'assigned')::int
      + (v_res -> 'batches' -> 0 ->> 'void')::int,
    50, 'le détail du lot compte ses 50 plaques');
  select count(*)::int into v_n from public.plate_stock
  where batch_id = (v_batch ->> 'id')::uuid and status = 'assigned';
  perform internal.assert_eq((v_res -> 'batches' -> 0 ->> 'assigned')::int, v_n,
    'les plaques attribuées du lot sont comptées en base');
  select count(*)::int into v_n from public.plate_stock where status = 'available';
  perform internal.assert_eq((v_res -> 'totals' ->> 'available')::int, v_n,
    'les totaux couvrent toute la plateforme');
  perform internal.assert_eq(jsonb_array_length(public.plate_stock_summary() -> 'batches'), 0,
    'sans lot demandé, aucun détail');

  raise notice '';
  raise notice '✅ Stock de plaques : tous les tests passent.';
end
$$;

-- ---------------------------------------------------------------------
-- Aucun accès depuis le navigateur
-- ---------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';

  do $$
  begin
    begin
      perform count(*) from public.plate_stock;
      raise exception 'ÉCHEC: un professionnel lit le stock de plaques';
    exception when insufficient_privilege then
      raise notice '  ok  le stock de plaques est invisible depuis le navigateur';
    end;
    begin
      perform public.create_plate_batch('pirate', 10);
      raise exception 'ÉCHEC: un professionnel génère des plaques';
    exception when insufficient_privilege then
      raise notice '  ok  seul le serveur peut générer un lot';
    end;
    begin
      perform public.plate_stock_summary();
      raise exception 'ÉCHEC: un professionnel lit les comptes du stock';
    exception when insufficient_privilege then
      raise notice '  ok  les comptes du stock sont réservés au serveur';
    end;
    begin
      perform public.assign_stock_plate('rv-00000-00000', gen_random_uuid());
      raise exception 'ÉCHEC: un professionnel s''attribue une plaque';
    exception when insufficient_privilege then
      raise notice '  ok  seul le serveur peut attribuer une plaque';
    end;
  end
  $$;
rollback;
